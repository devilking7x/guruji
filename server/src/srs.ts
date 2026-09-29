/**
 * FSRS-lite revision queue: hand-rolled deterministic spaced-repetition
 * scheduler (FSRS-inspired SM-2). No npm deps — deliberate, avoids lockfile
 * races with the parallel frontend worker.
 *
 * Per-student state lives in data/cards-<studentId>.json (atomic writes).
 * Rating: 1=fail (reschedule ~10 min), 2=hard, 3=good, 4=easy (growing intervals).
 */

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { atomicWriteJson } from "./fsutil";
import { sanitizeStudentId } from "./memory";

export interface Card {
  id: string;
  front: string;
  back: string;
  topic: string;
  /** ease factor, starts 2.5 */
  ease: number;
  /** consecutive successful reviews (rating >= 2) */
  reps: number;
  /** last interval in minutes */
  intervalMin: number;
  /** ISO timestamp when the card becomes due */
  dueAt: string;
  createdAt: string;
  reviews: number;
}

export interface NewCard {
  front: string;
  back: string;
  topic?: string;
}

const DATA_DIR = join(process.cwd(), "data");
const MAX_INTERVAL_MIN = 180 * 24 * 60; // 180 days cap

function ensureDir(): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

function fileFor(studentId: string): string {
  return join(DATA_DIR, `cards-${studentId}.json`);
}

function readAll(studentId: string): Card[] {
  ensureDir();
  const f = fileFor(studentId);
  if (!existsSync(f)) return [];
  try {
    const parsed = JSON.parse(readFileSync(f, "utf8"));
    return Array.isArray(parsed) ? (parsed as Card[]) : [];
  } catch {
    return [];
  }
}

function writeAll(studentId: string, cards: Card[]): void {
  ensureDir();
  atomicWriteJson(fileFor(studentId), cards);
}

function nowIso(): string {
  return new Date().toISOString();
}

/** Add cards for a student. New cards are due immediately. */
export function addCards(
  studentId: string,
  items: NewCard[]
): { added: number; cards: Card[] } {
  const sid = sanitizeStudentId(studentId);
  if (!sid) throw new Error("Valid studentId chahiye.");
  const existing = readAll(sid);
  const created = items.map((it) => {
    const card: Card = {
      id: randomUUID(),
      front: it.front,
      back: it.back,
      topic: (it.topic || "").slice(0, 200),
      ease: 2.5,
      reps: 0,
      intervalMin: 0,
      dueAt: nowIso(),
      createdAt: nowIso(),
      reviews: 0,
    };
    return card;
  });
  const all = existing.concat(created);
  writeAll(sid, all);
  return { added: created.length, cards: created };
}

/** Cards whose review interval has elapsed (dueAt <= now), oldest-due first. */
export function dueCards(studentId: string): Card[] {
  const sid = sanitizeStudentId(studentId);
  if (!sid) return [];
  const now = Date.now();
  return readAll(sid)
    .filter((c) => {
      const t = Date.parse(c.dueAt);
      return Number.isFinite(t) && t <= now;
    })
    .sort((a, b) => (a.dueAt < b.dueAt ? -1 : a.dueAt > b.dueAt ? 1 : 0));
}

/** List all cards (for debugging/admin views). */
export function listCards(studentId: string): Card[] {
  const sid = sanitizeStudentId(studentId);
  if (!sid) return [];
  return readAll(sid);
}

export interface GradeResult {
  ok: true;
  nextDueAt: string;
  intervalMin: number;
}

/**
 * Grade a card 1-4. Returns null when the card does not exist.
 * 1=fail → reps reset, due in ~10 min. 2=hard, 3=good, 4=easy → growing intervals.
 */
export function gradeCard(
  studentId: string,
  cardId: string,
  rating: number
): GradeResult | null {
  const sid = sanitizeStudentId(studentId);
  if (!sid) return null;
  if (!Number.isInteger(rating) || rating < 1 || rating > 4) {
    throw new Error("Rating 1 se 4 ke beech honi chahiye.");
  }
  const cards = readAll(sid);
  const card = cards.find((c) => c.id === cardId);
  if (!card) return null;

  let intervalMin: number;
  if (rating === 1) {
    card.reps = 0;
    card.ease = Math.max(1.3, card.ease - 0.2);
    intervalMin = 10;
  } else if (rating === 2) {
    card.ease = Math.max(1.3, card.ease - 0.15);
    intervalMin = card.reps === 0 ? 12 * 60 : card.intervalMin * 1.2;
    card.reps += 1;
  } else if (rating === 3) {
    intervalMin = card.reps === 0 ? 24 * 60 : card.intervalMin * card.ease;
    card.reps += 1;
  } else {
    card.ease = card.ease + 0.15;
    intervalMin = card.reps === 0 ? 4 * 24 * 60 : card.intervalMin * card.ease * 1.3;
    card.reps += 1;
  }
  intervalMin = Math.min(MAX_INTERVAL_MIN, Math.max(1, Math.round(intervalMin)));
  card.intervalMin = intervalMin;
  card.dueAt = new Date(Date.now() + intervalMin * 60_000).toISOString();
  card.reviews += 1;
  writeAll(sid, cards);
  return { ok: true, nextDueAt: card.dueAt, intervalMin };
}
