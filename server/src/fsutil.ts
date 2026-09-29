import { writeFileSync, renameSync } from "node:fs";

/**
 * Atomically write JSON to disk: write to a unique temp file, then rename.
 * Readers never see a half-written file.
 */
export function atomicWriteJson(path: string, data: unknown): void {
  const tmp = `${path}.tmp.${process.pid}.${Date.now()}`;
  writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  renameSync(tmp, path);
}
