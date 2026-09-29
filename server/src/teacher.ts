/**
 * Teacher dashboard aggregates — computed ONLY from persisted per-student
 * data (mastery files + quiz_result memory records). K-ANONYMITY: when
 * fewer than 3 distinct students have data for the class, refuse with
 * "insufficient-data". NEVER includes names, ids, nicknames or per-student rows.
 */

import * as memory from "./memory";
import { progressExtras } from "./mastery";

export interface TeacherStats {
  ok: true;
  class: string;
  students: number;
  avgMasteryByTopic: Record<string, number>;
  weakestTopics: string[];
  quizzesThisWeek: number;
  streaksActive: number;
}

export type TeacherStatsResult = TeacherStats | { ok: false; reason: "insufficient-data" };

const MIN_STUDENTS = 3;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function classOfProfile(sid: string): string | null {
  const prof = memory
    .list(sid)
    .find((r) => r.kind === "profile" && !r.superseded);
  if (!prof) return null;
  const m = /Class:\s*([^\s,]+)/.exec(prof.text);
  return m ? m[1].trim() : null;
}

/** A student "has data" when they earned XP, have mastery topics, or quiz results. */
function hasData(sid: string): boolean {
  const extras = progressExtras(sid);
  if (extras.xp > 0 || Object.keys(extras.mastery).length > 0) return true;
  return memory
    .list(sid)
    .some((r) => r.kind === "quiz_result" && !r.superseded);
}

export function teacherStats(cls: string): TeacherStatsResult {
  const inClass = memory.allStudentIds().filter((sid) => classOfProfile(sid) === cls);
  const withData = inClass.filter(hasData);
  if (withData.length < MIN_STUDENTS) {
    return { ok: false, reason: "insufficient-data" };
  }

  // Average mastery per topic across students who have that topic.
  const sums = new Map<string, { total: number; n: number }>();
  let streaksActive = 0;
  for (const sid of withData) {
    const extras = progressExtras(sid);
    for (const [topic, m] of Object.entries(extras.mastery)) {
      const e = sums.get(topic) ?? { total: 0, n: 0 };
      e.total += m;
      e.n += 1;
      sums.set(topic, e);
    }
    if (extras.streak >= 2) streaksActive += 1;
  }
  const avgMasteryByTopic: Record<string, number> = {};
  for (const [topic, e] of sums) {
    avgMasteryByTopic[topic] = Math.round((e.total / e.n) * 10) / 10;
  }
  const weakestTopics = [...sums.entries()]
    .sort((a, b) => a[1].total / a[1].n - b[1].total / b[1].n)
    .slice(0, 5)
    .map(([topic]) => topic);

  // Quiz attempts in the last 7 days (timestamped memory records).
  const weekAgo = Date.now() - WEEK_MS;
  let quizzesThisWeek = 0;
  for (const sid of withData) {
    for (const r of memory.list(sid)) {
      if (r.kind !== "quiz_result" || r.superseded) continue;
      let at = r.createdAt;
      try {
        const d = JSON.parse(r.text) as { at?: string };
        if (typeof d.at === "string" && d.at) at = d.at;
      } catch {
        // keep createdAt
      }
      const t = Date.parse(at);
      if (Number.isFinite(t) && t >= weekAgo) quizzesThisWeek += 1;
    }
  }

  return {
    ok: true,
    class: cls,
    students: withData.length,
    avgMasteryByTopic,
    weakestTopics,
    quizzesThisWeek,
    streaksActive,
  };
}
