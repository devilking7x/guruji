/**
 * Weekly leaderboard per class: data/leaderboard-<class>.json, recomputed on
 * every XP write (cap 200 entries, sorted by XP desc). Internally keyed by
 * sanitized studentId — the public view exposes nicknames ONLY, never ids.
 */

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { atomicWriteJson } from "./fsutil";
import * as memory from "./memory";
import { progressExtras } from "./mastery";
import { getNickname } from "./nickname";

const DATA_DIR = join(process.cwd(), "data");
const MAX_ENTRIES = 200;

interface BoardEntry {
  sid: string;
  nickname: string;
  xp: number;
  streak: number;
}

export interface LeaderboardRow {
  nickname: string;
  xp: number;
  streak: number;
}

function ensureDir(): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

function fileFor(cls: string): string {
  return join(DATA_DIR, `leaderboard-${cls}.json`);
}

function readEntries(cls: string): BoardEntry[] {
  ensureDir();
  const f = fileFor(cls);
  if (!existsSync(f)) return [];
  try {
    const v = JSON.parse(readFileSync(f, "utf8")) as unknown;
    if (!Array.isArray(v)) return [];
    return v.filter(
      (e): e is BoardEntry =>
        typeof e === "object" && e !== null &&
        typeof (e as BoardEntry).sid === "string" &&
        typeof (e as BoardEntry).nickname === "string" &&
        typeof (e as BoardEntry).xp === "number"
    );
  } catch {
    return [];
  }
}

/** Class from the student's profile record ("Naam: ..., Class: 8"). */
function classOf(sid: string): string | null {
  const prof = memory
    .list(sid)
    .find((r) => r.kind === "profile" && !r.superseded);
  if (!prof) return null;
  const m = /Class:\s*([^\s,]+)/.exec(prof.text);
  return m ? m[1].trim() : null;
}

/**
 * Upsert one student's row after an XP award. Safe to call for any student:
 * no-ops when the student has no class-6..10 profile.
 */
export function touch(studentId: string): void {
  const sid = memory.sanitizeStudentId(studentId);
  if (!sid) return;
  const cls = classOf(sid);
  if (!cls || !/^(6|7|8|9|10)$/.test(cls)) return;
  let nickname: string;
  try {
    nickname = getNickname(sid).nickname;
  } catch {
    return;
  }
  const extras = progressExtras(sid);
  const entries = readEntries(cls);
  const row: BoardEntry = {
    sid,
    nickname,
    xp: extras.xp,
    streak: extras.streak,
  };
  const idx = entries.findIndex((e) => e.sid === sid);
  if (idx >= 0) entries[idx] = row;
  else entries.push(row);
  entries.sort((a, b) => b.xp - a.xp || a.nickname.localeCompare(b.nickname));
  atomicWriteJson(fileFor(cls), entries.slice(0, MAX_ENTRIES));
}

/** Public top-N view: nicknames only, never student ids. */
export function topForClass(cls: string, limit = 10): LeaderboardRow[] {
  return readEntries(cls)
    .slice(0, Math.max(1, Math.min(100, limit)))
    .map((e) => ({ nickname: e.nickname, xp: e.xp, streak: e.streak }));
}

/** ISO week label in IST, e.g. "2026-W40". */
export function isoWeekLabel(d: Date = new Date()): string {
  const ist = new Date(d.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  const date = new Date(Date.UTC(ist.getFullYear(), ist.getMonth(), ist.getDate()));
  const dayNum = (date.getUTCDay() + 6) % 7; // Monday = 0
  date.setUTCDate(date.getUTCDate() - dayNum + 3); // shift to Thursday
  const year = date.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(year, 0, 4));
  const fday = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - fday + 3);
  const week = 1 + Math.round((date.getTime() - firstThursday.getTime()) / (7 * 24 * 3600 * 1000));
  return `${year}-W${String(week).padStart(2, "0")}`;
}
