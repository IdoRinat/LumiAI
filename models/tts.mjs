import fetch from "node-fetch";
import fs from "fs";
import fsPromises from "fs/promises";
import path from "path";

const OUTPUT_DIR = path.join(process.cwd(), "output");

async function ensureOutputDir() {
  try {
    await fsPromises.mkdir(OUTPUT_DIR, { recursive: true });
  } catch (err) {
    console.error(`❌ Error ensuring output directory: ${err.message}`);
  }
}


export async function generateTTS(text) {
  await ensureOutputDir();

  const timestamp = Date.now();
  const outputFilePath = path.join(OUTPUT_DIR, `output_${timestamp}.mp3`);

  try {
    const response = await fetch("http://localhost:8880/v1/audio/speech", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "kokoro",
        voice: "af_v0sarah",
        speed: 1.1,
        input: text
      })
    });

    if (!response.ok) {
      throw new Error(`TTS API responded with status ${response.status}`);
    }

    const fileStream = fs.createWriteStream(outputFilePath);
    await new Promise((resolve, reject) => {
      response.body.pipe(fileStream);
      response.body.on("error", reject);
      fileStream.on("finish", resolve);
    });

    console.log(`✅ TTS generated: ${outputFilePath}`);
    return outputFilePath;
  } catch (err) {
    console.error(`❌ TTS generation error: ${err.message}`);
    throw err;
  }
}
