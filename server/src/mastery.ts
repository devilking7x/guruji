/**
 * Adaptive quiz brain: per-student per-topic mastery (0-100), XP, daily
 * streaks and badges — all persisted in data/mastery-<studentId>.json
 * (atomic writes). Deterministic, no deps.
 *
 * Mastery updates on grading: correct → +8 (cap 100), wrong → -5 (floor 0).
 * Mastery < 60 counts as a weak topic.
 * Quiz difficulty adapts: mastery < 40 → easy, 40-70 → medium, > 70 → hard.
 */

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { atomicWriteJson } from "./fsutil";
import { sanitizeStudentId } from "./memory";
import { istDayKey } from "./budget";

export type Difficulty = "easy" | "medium" | "hard";

export interface MasteryState {
  topics: Record<string, number>;
  xp: number;
  streak: number;
  lastQuizDay: string | null;
  quizCount: number;
}

const DATA_DIR = join(process.cwd(), "data");
const DEFAULT_MASTERY = 50;
const WEAK_THRESHOLD = 60;
const MASTER_BADGE_AT = 85;

function ensureDir(): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

function fileFor(studentId: string): string {
  return join(DATA_DIR, `mastery-${studentId}.json`);
}

function defaults(): MasteryState {
  return { topics: {}, xp: 0, streak: 0, lastQuizDay: null, quizCount: 0 };
}

function readState(studentId: string): MasteryState {
  ensureDir();
  const f = fileFor(studentId);
  if (!existsSync(f)) return defaults();
  try {
    const v = JSON.parse(readFileSync(f, "utf8")) as Partial<MasteryState>;
    return {
      topics:
        v.topics && typeof v.topics === "object" ? (v.topics as Record<string, number>) : {},
      xp: typeof v.xp === "number" && v.xp >= 0 ? Math.floor(v.xp) : 0,
      streak: typeof v.streak === "number" && v.streak >= 0 ? Math.floor(v.streak) : 0,
      lastQuizDay: typeof v.lastQuizDay === "string" ? v.lastQuizDay : null,
      quizCount:
        typeof v.quizCount === "number" && v.quizCount >= 0 ? Math.floor(v.quizCount) : 0,
    };
  } catch {
    return defaults();
  }
}

function writeState(studentId: string, state: MasteryState): void {
  ensureDir();
  atomicWriteJson(fileFor(studentId), state);
}

/** Canonical per-topic key (stable across spellings/case). */
export function topicKey(topic: string): string {
  return (topic || "").trim().toLowerCase().slice(0, 200);
}

/** URL/badge-safe slug, e.g. "fractions" for the "fractions-master" badge. */
export function topicSlug(topic: string): string {
  return topicKey(topic)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

/** Current mastery for a topic (0-100). Unseen topics start neutral at 50. */
export function masteryFor(studentId: string, topic: string): number {
  const sid = sanitizeStudentId(studentId);
  if (!sid) return DEFAULT_MASTERY;
  const key = topicKey(topic);
  const v = readState(sid).topics[key];
  return typeof v === "number" ? v : DEFAULT_MASTERY;
}

/** Difficulty band derived from mastery. */
export function difficultyFor(studentId: string, topic: string): Difficulty {
  const m = masteryFor(studentId, topic);
  if (m < 40) return "easy";
  if (m > 70) return "hard";
  return "medium";
}

/** Touch the daily-activity streak (IST calendar days). Shared by quizzes and challenges. */
function touchStreak(state: MasteryState): void {
  const today = istDayKey();
  const yesterday = istDayKey(new Date(Date.now() - 24 * 60 * 60 * 1000));
  if (state.lastQuizDay === today) {
    // same day: streak unchanged
  } else if (state.lastQuizDay === yesterday) {
    state.streak += 1;
  } else {
    state.streak = 1;
  }
  // NOTE: lastQuizDay doubles as "last activity day" (quiz OR challenge)
  // so the streak survives mixed activity. Existing files keep working.
  state.lastQuizDay = today;
}

/**
 * Award XP for the daily challenge WITHOUT touching quiz stats:
 * +15 for a correct answer, +5 for an attempt. Streak still advances —
 * any daily learning activity keeps the streak alive.
 */
export function awardChallengeXp(
  studentId: string,
  correct: boolean
): { xpGained: number; xp: number; streak: number } {
  const sid = sanitizeStudentId(studentId);
  if (!sid) throw new Error("Valid studentId chahiye.");
  const state = readState(sid);
  touchStreak(state);
  const xpGained = correct ? 15 : 5;
  state.xp += xpGained;
  writeState(sid, state);
  return { xpGained, xp: state.xp, streak: state.streak };
}

export interface RecordQuizResult {
  xpGained: number;
  xp: number;
  streak: number;
  mastery: number;
  badges: string[];
}

/**
 * Record one finished quiz. correctFlags[i] = question i answered correctly.
 * XP: +10 per correct answer, plus a streak bonus (5 × streak when streak ≥ 2).
 * Streak: consecutive IST calendar days with at least one quiz.
 */
export function recordQuiz(
  studentId: string,
  topic: string,
  correctFlags: boolean[]
): RecordQuizResult {
  const sid = sanitizeStudentId(studentId);
  if (!sid) throw new Error("Valid studentId chahiye.");
  const key = topicKey(topic);
  const state = readState(sid);

  let mastery = state.topics[key];
  if (typeof mastery !== "number") mastery = DEFAULT_MASTERY;
  let correct = 0;
  for (const ok of correctFlags) {
    if (ok) {
      correct += 1;
      mastery = Math.min(100, mastery + 8);
    } else {
      mastery = Math.max(0, mastery - 5);
    }
  }
  state.topics[key] = mastery;

  // Streak over IST calendar days (shared helper — challenge answers also count).
  touchStreak(state);
  state.quizCount += 1;

  const xpGained = 10 * correct + (state.streak >= 2 ? 5 * state.streak : 0);
  state.xp += xpGained;

  writeState(sid, state);
  return {
    xpGained,
    xp: state.xp,
    streak: state.streak,
    mastery,
    badges: badgesFor(state),
  };
}

/** Badges computed purely from persisted data. */
export function badgesFor(state: MasteryState): string[] {
  const badges: string[] = [];
  if (state.quizCount >= 1) badges.push("pehla-quiz");
  if (state.streak >= 7) badges.push("7-din-streak");
  if (state.quizCount >= 25) badges.push("quiz-25");
  for (const [topic, m] of Object.entries(state.topics)) {
    if (m >= MASTER_BADGE_AT) {
      const slug = topicSlug(topic);
      if (slug) badges.push(`${slug}-master`);
    }
  }
  return badges;
}

/** Topics with mastery < 60 (weak). */
export function weakTopicsFor(state: MasteryState): string[] {
  return Object.entries(state.topics)
    .filter(([, m]) => m < WEAK_THRESHOLD)
    .map(([t]) => t);
}

export interface ProgressExtras {
  mastery: Record<string, number>;
  xp: number;
  streak: number;
  badges: string[];
  weakTopics: string[];
  quizCount: number;
}

/** Everything GET /api/progress adds on top of the v1 fields. */
export function progressExtras(studentId: string): ProgressExtras {
  const sid = sanitizeStudentId(studentId);
  const state = sid ? readState(sid) : defaults();
  return {
    mastery: state.topics,
    xp: state.xp,
    streak: state.streak,
    badges: badgesFor(state),
    weakTopics: weakTopicsFor(state),
    quizCount: state.quizCount,
  };
}
