// The helpers' output, kept in a file: an app opened from the Finder has no terminal to print to, and this
// is what says why translation or the voice didn't start on someone's computer.

import fs from "node:fs";
import path from "node:path";

/** Appends each line of `chunk` to `file`, tagged. A file past `maxBytes` is moved to `<file>.1` first
 * (replacing the one before), so the log never grows without end. Never throws. */
export function helperLog(file: string, maxBytes = 2_000_000): (tag: string, chunk: Buffer | string) => void {
  return (tag, chunk) => {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      if (fs.existsSync(file) && fs.statSync(file).size > maxBytes) fs.renameSync(file, `${file}.1`);
      const stamp = new Date().toISOString();
      const lines = String(chunk).split(/\r?\n/).filter((l) => l.trim());
      if (lines.length) fs.appendFileSync(file, lines.map((l) => `${stamp} [${tag}] ${l}\n`).join(""));
    } catch {
      /* a log that can't be written must not stop the app */
    }
  };
}
