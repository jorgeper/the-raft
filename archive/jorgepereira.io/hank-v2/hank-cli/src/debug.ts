import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const LOG_DIR = path.join(os.homedir(), ".config", "hank", "logs");

let logFile: string | null = null;
let stream: fs.WriteStream | null = null;

export function initDebug(): string {
  fs.mkdirSync(LOG_DIR, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  logFile = path.join(LOG_DIR, `hank-${timestamp}.log`);
  stream = fs.createWriteStream(logFile, { flags: "a" });

  debug("session", "Debug logging started");
  return logFile;
}

export function debug(tag: string, message: string, data?: unknown): void {
  if (!stream) return;

  const ts = new Date().toISOString();
  let line = `[${ts}] [${tag}] ${message}`;
  if (data !== undefined) {
    try {
      line += " " + JSON.stringify(data);
    } catch {
      line += " [unserializable]";
    }
  }
  stream.write(line + "\n");
}

export function getLogFile(): string | null {
  return logFile;
}
