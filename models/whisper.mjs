import fs from "fs";
import { exec } from "child_process";

const WHISPER_PATH = "F:/AI/whisper.cpp/build/bin/Release/whisper-cli.exe";
const WHISPER_MODEL = "F:/AI/whisper.cpp/models/ggml-small.bin";


export async function transcribeWithWhisper(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`❌ Audio file not found: ${filePath}`);
  }

  const outTxtPath = filePath.replace(".wav", ".txt");
  const whisperCmd = `"${WHISPER_PATH}" -m "${WHISPER_MODEL}" -f "${filePath}" -of "${filePath.replace(
    ".wav",
    ""
  )}" -otxt -l en --threads 8 --best-of 1 --beam-size 1 --max-len 30"`;

  return new Promise((resolve, reject) => {
    exec(whisperCmd, async (error, stdout, stderr) => {
      if (error) {
        console.error(`❌ Whisper Error: ${error.message}`);
        return reject(error);
      }
      if (stderr) console.warn(`⚠️ Whisper stderr: ${stderr}`);

      let waited = 0;
      while (!fs.existsSync(outTxtPath)) {
        if (waited > 40000) {
          return reject(new Error(`❌ Timeout waiting for transcript: ${outTxtPath}`));
        }
        await new Promise((r) => setTimeout(r, 200));
        waited += 200;
      }

      let transcript = fs.readFileSync(outTxtPath, "utf8").trim();

      if (transcript.length > 0) {
        fs.unlinkSync(outTxtPath);
      } else {
        console.warn(`⚠️ Whisper generated an empty transcript.`);
      }

      resolve(transcript || "");
    });
  });
}
