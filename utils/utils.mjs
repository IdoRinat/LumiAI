import fs from "fs";
import path from "path";

/**
 * Ensure a directory exists, creating it if necessary.
 * @param {string} dir - Directory path to check and create.
 */
export function ensureDirExists(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

const recordingsDir = path.join(process.cwd(), "recordings");

/**
 * Get a unique file path for a recording based on the user ID and current timestamp.
 * @param {string} userId - The user ID to generate the recording file name.
 * @returns {string} - The unique file path.
 */
export function getUniqueRecordingPath(userId) {
  return path.join(recordingsDir, `${userId}_${Date.now()}.wav`);
}
