/**
 * Notebook: per-student saved notes (bookmarks from chat, self-study notes).
 * Per-student isolation: one file per sanitized student id,
 * data/notebook-<studentId>.json, atomic writes. A student can only ever
 * touch their own file (caller must pass a sanitizeStudentId-validated id).
 */

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { atomicWriteJson } from "./fsutil";
import { sanitizeStudentId } from "./memory";

export interface Note {
  id: string;
  studentId: string;
  text: string;
  title?: string;
  source?: string;
  createdAt: string;
  updatedAt: string;
}

export const MAX_NOTES_PER_STUDENT = 200;
export const NOTE_ID_RE = /^[a-z0-9-]{1,64}$/;

const DATA_DIR = join(process.cwd(), "data");

function ensureDir(): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

function fileFor(studentId: string): string {
  // sanitizeStudentId guarantees [a-z0-9-] so the path cannot escape DATA_DIR.
  return join(DATA_DIR, `notebook-${sanitizeStudentId(studentId)}.json`);
}

function readAll(studentId: string): Note[] {
  ensureDir();
  const f = fileFor(studentId);
  if (!existsSync(f)) return [];
  try {
    const parsed = JSON.parse(readFileSync(f, "utf8"));
    return Array.isArray(parsed) ? (parsed as Note[]) : [];
  } catch {
    return [];
  }
}

function writeAll(studentId: string, notes: Note[]): void {
  ensureDir();
  atomicWriteJson(fileFor(studentId), notes);
}

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Save a note. Throws when the per-student cap is hit.
 * text/title/source length + guard validation happen at the route layer.
 */
export function addNote(
  studentId: string,
  text: string,
  title?: string,
  source?: string
): Note {
  const sid = sanitizeStudentId(studentId);
  if (!sid) throw new Error("Valid studentId chahiye.");
  const notes = readAll(sid);
  if (notes.length >= MAX_NOTES_PER_STUDENT) {
    throw new Error("Notebook full hai — purane notes delete karo.");
  }
  const note: Note = {
    id: randomUUID(),
    studentId: sid,
    text,
    title: title || undefined,
    source: source || undefined,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  notes.push(note);
  writeAll(sid, notes);
  return note;
}

/**
 * List notes newest first. q = optional case-insensitive substring search
 * over text + title.
 */
export function listNotes(studentId: string, q?: string): Note[] {
  const sid = sanitizeStudentId(studentId);
  const query = (q || "").trim().toLowerCase();
  const notes = readAll(sid).sort((a, b) =>
    a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0
  );
  if (!query) return notes;
  return notes.filter((n) =>
    `${n.text} ${n.title ?? ""}`.toLowerCase().includes(query)
  );
}

/** Hard-delete a note. Returns false when the id is not found. */
export function deleteNote(studentId: string, id: string): boolean {
  const sid = sanitizeStudentId(studentId);
  if (!sid) return false;
  if (!NOTE_ID_RE.test(id)) return false;
  const notes = readAll(sid);
  const idx = notes.findIndex((n) => n.id === id);
  if (idx === -1) return false;
  notes.splice(idx, 1);
  writeAll(sid, notes);
  return true;
}

/** Validate the note-id path param format (no traversal, no wildcards). */
export function isValidNoteId(id: string): boolean {
  return NOTE_ID_RE.test(id);
}
