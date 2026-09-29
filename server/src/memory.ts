import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { atomicWriteJson } from "./fsutil";

export type MemoryKind = "profile" | "fact" | "quiz_result" | "weak_topic" | "hint_ladder" | "nickname";

export interface MemoryRecord {
  id: string;
  studentId: string;
  kind: MemoryKind;
  text: string;
  createdAt: string;
  updatedAt: string;
  superseded: boolean;
}

const DATA_DIR = join(process.cwd(), "data");

function ensureDir(): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

/** Sanitize to lowercase [a-z0-9-], max 40 chars. */
export function sanitizeStudentId(raw: string): string {
  return (raw || "")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function fileFor(studentId: string): string {
  return join(DATA_DIR, `memory-${studentId}.json`);
}

function readAll(studentId: string): MemoryRecord[] {
  ensureDir();
  const f = fileFor(studentId);
  if (!existsSync(f)) return [];
  try {
    const parsed = JSON.parse(readFileSync(f, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeAll(studentId: string, records: MemoryRecord[]): void {
  ensureDir();
  atomicWriteJson(fileFor(studentId), records);
}

function now(): string {
  return new Date().toISOString();
}

/** Add a new memory record. */
export function add(
  studentId: string,
  text: string,
  kind: MemoryKind = "fact"
): MemoryRecord {
  const sid = sanitizeStudentId(studentId);
  const rec: MemoryRecord = {
    id: randomUUID(),
    studentId: sid,
    kind,
    text,
    createdAt: now(),
    updatedAt: now(),
    superseded: false,
  };
  const records = readAll(sid);
  records.push(rec);
  writeAll(sid, records);
  return rec;
}

/** List all records for a student (newest first). */
export function list(studentId: string): MemoryRecord[] {
  const sid = sanitizeStudentId(studentId);
  return readAll(sid).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

/** Get one record by id. */
export function get(studentId: string, id: string): MemoryRecord | undefined {
  const sid = sanitizeStudentId(studentId);
  return readAll(sid).find((r) => r.id === id);
}

/** Update the text of a record (marks updatedAt, clears superseded). */
export function update(
  studentId: string,
  id: string,
  text: string
): MemoryRecord | undefined {
  const sid = sanitizeStudentId(studentId);
  const records = readAll(sid);
  const rec = records.find((r) => r.id === id);
  if (!rec) return undefined;
  rec.text = text;
  rec.updatedAt = now();
  rec.superseded = false;
  writeAll(sid, records);
  return rec;
}

/** Hard-delete a record. Returns false when not found. */
export function remove(studentId: string, id: string): boolean {
  const sid = sanitizeStudentId(studentId);
  const records = readAll(sid);
  const idx = records.findIndex((r) => r.id === id);
  if (idx === -1) return false;
  records.splice(idx, 1);
  writeAll(sid, records);
  return true;
}

/** Export all records as JSON. */
export function exportJson(studentId: string): MemoryRecord[] {
  return list(sanitizeStudentId(studentId));
}

/** Keyword-overlap search over non-superseded records. Top 8 by score. */
export function search(studentId: string, query: string): MemoryRecord[] {
  const sid = sanitizeStudentId(studentId);
  const tokens = tokenize(query);
  if (tokens.size === 0) return [];
  const scored: Array<{ rec: MemoryRecord; score: number }> = [];
  for (const rec of readAll(sid)) {
    if (rec.superseded) continue;
    const hay = tokenize(`${rec.kind} ${rec.text}`);
    let score = 0;
    for (const t of tokens) {
      if (hay.has(t)) score += 2;
      // partial / prefix matches count less
      for (const h of hay) {
        if (h !== t && (h.startsWith(t) || t.startsWith(h)) && h.length > 3 && t.length > 3) {
          score += 0.5;
        }
      }
    }
    if (score > 0) scored.push({ rec, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 8).map((s) => s.rec);
}

/** Mark an existing record of a given kind+text-prefix as superseded (dedup helper). */
export function markSupersededIfExists(
  studentId: string,
  kind: MemoryKind,
  textIncludes: string
): void {
  const sid = sanitizeStudentId(studentId);
  const records = readAll(sid);
  let changed = false;
  for (const rec of records) {
    if (
      !rec.superseded &&
      rec.kind === kind &&
      rec.text.toLowerCase().includes(textIncludes.toLowerCase())
    ) {
      rec.superseded = true;
      rec.updatedAt = now();
      changed = true;
    }
  }
  if (changed) writeAll(sid, records);
}

/** Danger utility (tests/admin): wipe a student's file. */
export function clearStudent(studentId: string): void {
  const sid = sanitizeStudentId(studentId);
  const f = fileFor(sid);
  if (existsSync(f)) rmSync(f);
}

/** List every sanitized student id that has a memory file. */
export function allStudentIds(): string[] {
  ensureDir();
  return readdirSync(DATA_DIR)
    .filter((f) => f.startsWith("memory-") && f.endsWith(".json"))
    .map((f) => f.slice("memory-".length, -".json".length));
}

function tokenize(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .split(/[^a-z0-9\u0900-\u097f\u0980-\u09ff]+/u)
      .map((t) => t.trim())
      .filter((t) => t.length > 1)
  );
}
