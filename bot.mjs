// bot.mjs
import dotenv from "dotenv";
dotenv.config();

import { Client, GatewayIntentBits } from "discord.js";
import { joinVoiceChannel, createAudioPlayer, createAudioResource, entersState, AudioPlayerStatus, EndBehaviorType, getVoiceConnection } from "@discordjs/voice";
import fs from "fs";
import path from "path";
import ffmpeg from "fluent-ffmpeg";
import { exec, spawn } from "child_process";

import { transcribeWithWhisper } from "./models/whisper.mjs";
import { chatWithOllama } from "./models/ollama.mjs";
import { generateTTS } from "./models/tts.mjs";
import { ensureDirExists, getUniqueRecordingPath } from "./utils/utils.mjs";
import { MongoClient } from "mongodb";

const BOT_TOKEN = process.env.DISCORD_TOKEN;
const recordingsDir = path.join(process.cwd(), "recordings");
ensureDirExists(recordingsDir);

const MONGO_URI = process.env.MONGO_URI;
const MongoDBClient = new MongoClient(MONGO_URI);
const dbName = "lumi_bot";
const collectionName = "chat_history";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

const pendingTranscripts = new Map();
const transcriptStartTimes = new Map();
const finalizationTimers = new Map();
const utteranceInProgress = new Map();
const lastChunkTimes = new Map();

const CHUNK_SILENCE_DURATION = 500;
const FINALIZE_DELAY = 100;
const MAX_WAIT_TIME = 3000;
const GAP_THRESHOLD = 1500;

function isCompleteSentence(text) {
  return /[.!?]\s*$/.test(text.trim());
}

client.once("ready", () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  const powerShellScript = "E:\\AI\\Kokoro-FastAPI\\start-gpu.ps1";
  console.log(`🔄 Executing PowerShell script: ${powerShellScript}`);
  
  const scriptCommand = `
    # Change to the script's directory
    Set-Location -Path "${path.dirname(powerShellScript)}"
    
    # Execute the script with all output redirected to stdout
    & "${powerShellScript}" 2>&1
    
    # Signal completion
    Write-Output "SCRIPT_EXECUTION_COMPLETED"
  `;
  
  const tempScriptPath = path.join(process.cwd(), "temp_script.ps1");
  fs.writeFileSync(tempScriptPath, scriptCommand);

  const ps = spawn('powershell.exe', [
    '-ExecutionPolicy', 
    'Bypass', 
    '-File', 
    tempScriptPath
  ]);
  
  let serverStarted = false;
  let fullOutput = '';

  ps.stdout.on('data', (data) => {
    const output = data.toString();
    fullOutput += output;
    console.log(`📝 ${output.trim()}`);

    if (!serverStarted && 
        (output.includes("Application startup complete") || 
         output.includes("Uvicorn running on http://"))) {
      
      serverStarted = true;
      console.log("🚀 FastAPI server detected as running!");

      if (fullOutput.includes("voice packs loaded")) {
        const voicesMatch = fullOutput.match(/(\d+) voice packs loaded/);
        if (voicesMatch) {
          console.log(`🎙️ ${voicesMatch[1]} voice packs available`);
        }
      }
      
      if (fullOutput.includes("Beta Web Player:")) {
        const webPlayerMatch = fullOutput.match(/Beta Web Player: (http:\/\/[^\s]+)/);
        if (webPlayerMatch) {
          console.log(`🌐 Web Player URL: ${webPlayerMatch[1]}`);
        }
      }
      
      if (fullOutput.includes("Uvicorn running on")) {
        const serverMatch = fullOutput.match(/Uvicorn running on (http:\/\/[^\s]+)/);
        if (serverMatch) {
          console.log(`🌐 API Server URL: ${serverMatch[1]}`);
        }
      }
    }
  });
  
  ps.on('exit', (code) => {
    if (fs.existsSync(tempScriptPath)) {
      fs.unlinkSync(tempScriptPath);
    }
    
    if (code === 0) {
      console.log(`✅ PowerShell script completed with exit code ${code}`);

      if (!serverStarted && 
          (fullOutput.includes("Application startup complete") || 
           fullOutput.includes("Uvicorn running on http://"))) {
        console.log("🚀 FastAPI server detected as running!");
      }
    } else {
      console.error(`❌ PowerShell script failed with exit code ${code}`);
    }
    
    if (!serverStarted) {
      console.log("⚠️ FastAPI server may not have started correctly. Check the logs for details.");
    }
  });

  ps.on('error', (err) => {
    console.error(`❌ Error spawning PowerShell process: ${err.message}`);
    if (fs.existsSync(tempScriptPath)) {
      fs.unlinkSync(tempScriptPath);
    }
  });
});

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (message.content === "!clearmsgs") {
    const fetched = await message.channel.messages.fetch({ limit: 100 });
    message.channel.bulkDelete(fetched);
    return
  }
  if (message.content === "!clearhistory") {
    async function flushChatHistory() {
        try {
            await MongoDBClient.connect();
            const db = MongoDBClient.db(dbName);
            const collection = db.collection(collectionName);
    
            const result = await collection.deleteMany({});
            console.log(`✅ Deleted ${result.deletedCount} chat history entries.`);
    
            await MongoDBClient.close();
            return message.reply("🔹 Cleared chat history.");
        } catch (error) {
            console.error("❌ Error flushing history:", error);
            return message.reply("❌ Failed to clear chat history.");
        }
    }
    await flushChatHistory();
  }

  if (message.content === "!leave") {
    const { member } = message;
    if (!member?.voice?.channel) {
      return message.reply("❌ You need to be in a voice channel first!");
    }

    const connection = getVoiceConnection(member.voice.channel.guild.id);
    if (connection) {
      connection.destroy();
      return message.reply("🔹 Left the voice channel.");
    } else {
      return message.reply("❌ Not connected to a voice channel.");
    }
  }

  if (message.content === "!help") {
    return message.reply("🔹 Commands: \n - !join \n - !leave \n - !clearhistory \n - !clearmsgs");
  }

  if (message.content === "!join") {
    const { member } = message;
    if (!member?.voice?.channel) {
      return message.reply("❌ You need to be in a voice channel first!");
    }

    const connection = joinVoiceChannel({
      channelId: member.voice.channel.id,
      guildId: member.voice.channel.guild.id,
      adapterCreator: member.voice.channel.guild.voiceAdapterCreator,
      selfDeaf: false,
    });

    const receiver = connection.receiver;

    receiver.speaking.on("start", async (userId) => {
      console.log(`🎤 User ${userId} started speaking.`);

      const recordingPath = getUniqueRecordingPath(userId);
      const opusStream = receiver.subscribe(userId, {
        end: { behavior: EndBehaviorType.AfterSilence, duration: CHUNK_SILENCE_DURATION },
      });

      const prism = await import("prism-media");
      const pcmStream = new prism.opus.Decoder({
        frameSize: 960,
        channels: 1,
        rate: 48000,
      });
      opusStream.pipe(pcmStream);

      ffmpeg()
        .input(pcmStream)
        .inputFormat("s16le")
        .audioFrequency(16000)
        .audioChannels(1)
        .audioCodec("pcm_s16le")
        .toFormat("wav")
        .save(recordingPath)
        .on("end", async () => {
          console.log(`🎵 Chunk finished: ${recordingPath}`);
          try {
            const chunkTranscript = await transcribeWithWhisper(recordingPath);
            console.log(`💬 Chunk transcript for user ${userId}: "${chunkTranscript}"`);

            if (fs.existsSync(recordingPath)) fs.unlinkSync(recordingPath);

            const trimmedChunk = chunkTranscript.trim();
            const now = Date.now();

            if (lastChunkTimes.has(userId)) {
              const gap = now - lastChunkTimes.get(userId);
              if (gap > GAP_THRESHOLD && pendingTranscripts.has(userId) && pendingTranscripts.get(userId).trim() !== "") {
                console.log(`🔹 Gap threshold exceeded for user ${userId} (${gap}ms). Finalizing previous utterance.`);
                finalizeTranscript(userId, message, connection);
              }
            }
            lastChunkTimes.set(userId, now);

            if (utteranceInProgress.get(userId)) {
              pendingTranscripts.set(userId, trimmedChunk);
              transcriptStartTimes.set(userId, Date.now());
            } else {
              const currentTranscript = (pendingTranscripts.get(userId) || "").trim();

              if (currentTranscript && currentTranscript.endsWith(trimmedChunk)) {
                console.log(`🔹 Duplicate chunk detected for user ${userId}, skipping.`);
              } else {
                const updatedTranscript = currentTranscript
                  ? (currentTranscript + " " + trimmedChunk).trim()
                  : trimmedChunk;
                pendingTranscripts.set(userId, updatedTranscript);
                if (!transcriptStartTimes.has(userId)) {
                  transcriptStartTimes.set(userId, Date.now());
                }
              }
            }

            if (finalizationTimers.has(userId)) {
              clearTimeout(finalizationTimers.get(userId));
            }

            const timer = setTimeout(() => {
              maybeFinalizeTranscript(userId, message, connection);
            }, FINALIZE_DELAY);
            finalizationTimers.set(userId, timer);
          } catch (err) {
            console.error(`❌ Transcription error for user ${userId}: ${err.message}`);
          }
        })
        .on("error", (err) => console.error(`❌ FFmpeg error: ${err.message}`));
    });

    message.reply("✅ Joined your voice channel and started transcribing speech!");
  }
});

function maybeFinalizeTranscript(userId, message, connection) {
  if (utteranceInProgress.get(userId)) return;

  if (finalizationTimers.has(userId)) {
    clearTimeout(finalizationTimers.get(userId));
    finalizationTimers.delete(userId);
  }
  
  const pending = pendingTranscripts.get(userId);
  const startTime = transcriptStartTimes.get(userId) || Date.now();
  const elapsed = Date.now() - startTime;

  if ((pending && isCompleteSentence(pending)) || elapsed >= MAX_WAIT_TIME) {
    finalizeTranscript(userId, message, connection);
  } else {
    const timer = setTimeout(() => {
      maybeFinalizeTranscript(userId, message, connection);
    }, FINALIZE_DELAY);
    finalizationTimers.set(userId, timer);
  }
}

async function finalizeTranscript(userId, message, connection) {
  if (utteranceInProgress.get(userId)) return;
  utteranceInProgress.set(userId, true);

  if (finalizationTimers.has(userId)) {
    clearTimeout(finalizationTimers.get(userId));
    finalizationTimers.delete(userId);
  }
  
  const transcript = pendingTranscripts.get(userId);
  pendingTranscripts.delete(userId);
  transcriptStartTimes.delete(userId);
  
  if (!transcript) {
    console.log(`⚠️ No transcript to finalize for user ${userId}.`);
    utteranceInProgress.set(userId, false);
    return;
  }

  if (/^\[.*\]$/.test(transcript)) {
    console.log(`⚠️ Ignored transcript: ${transcript}`);
    utteranceInProgress.set(userId, false);
    return;
  }
  
  try {
    const user = await message.guild.members.fetch(userId);
    const username = user?.displayName || "Unknown";
    const formattedMessage = `[${username}]: ${transcript}`;
    
    const ollamaResponse = await chatWithOllama(userId, formattedMessage);
    
    if (transcript.length < 4000) {
      await message.channel.send(`[${username}]: ${transcript}`);
      if (ollamaResponse) {
        await message.channel.send(`[Lumi]: ${ollamaResponse}`);
        const audioPath = await generateTTS(ollamaResponse);
        await playAudio(connection, audioPath);
      }
    } else {
      await message.channel.send(`⚠️ Transcript too long (${transcript.length} chars).`);
    }
  } catch (e) {
    console.error(`❌ Finalization error for user ${userId}: ${e.message}`);
  }

  utteranceInProgress.set(userId, false);
  lastChunkTimes.delete(userId);
}

async function playAudio(connection, audioPath) {
  try {
    const player = createAudioPlayer();
    const resource = createAudioResource(audioPath);
    connection.subscribe(player);
    player.play(resource);

    await entersState(player, AudioPlayerStatus.Playing, 5000);
    console.log("🎵 Audio is playing...");
    await entersState(player, AudioPlayerStatus.Idle, 30000);
    console.log("🎵 Audio finished playing.");
  } catch (err) {
    console.error(`❌ Audio playback error: ${err.message}`);
  }
}


client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (message.content === "!loadmodel") {
    await loadOllamaModel();
    message.reply("🔹 Model loaded and kept alive for 30 minutes.");
  } else if (message.content === "!unloadmodel") {
    await unloadOllamaModel();
    message.reply("🔹 Model unloaded from memory.");
  }
});

async function loadOllamaModel() {
  try {
    const response = await fetch("http://localhost:11434/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "llama3.1:8b", keep_alive: -1 }),
    });
    const data = await response.json();
    console.log("🔹 Model loaded:", data);
  } catch (error) {
    console.error("❌ Error loading model:", error);
  }
}

async function unloadOllamaModel() {
  try {
    const response = await fetch("http://localhost:11434/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "llama3.1:8b", keep_alive: 0 }),
    });
    const data = await response.json();
    console.log("🔹 Model unloaded:", data);
  } catch (error) {
    console.error("❌ Error unloading model:", error);
  }
}


client.login(BOT_TOKEN);
