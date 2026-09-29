/**
 * /api/impact: fully anonymous aggregate counters for public display
 * (landing page / marketing / "proven impact" for the hackathon).
 *
 * K-ANONYMITY:
 * - If fewer than MIN_LEARNERS distinct learners exist, refuse with
 *   { ok:false, insufficient:true } — small numbers could identify students.
 * - activeLearners is rounded DOWN to the nearest 10 and returned as a
 *   string like "50+" so it can never pinpoint an exact count.
 * - NEVER exposes studentIds, names, nicknames or per-student rows.
 *
 * Sources (all server-side JSON, no new writes):
 * - data/memory-<sid>.json  → quiz_result records (quizzesTaken,
 *   totalQuestionsAnswered) + activity timestamps
 * - data/challenge-log-<cls>.json → daily challenge answers
 * - data/cards-<sid>.json (via srs) → distinct revised topics
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as memory from "./memory";
import * as srs from "./srs";
import { istDayKey } from "./budget";

export interface ImpactOk {
  ok: true;
  totalQuestionsAnswered: number;
  quizzesTaken: number;
  chaptersRevised: number;
  /** rounded down to nearest 10, displayed as e.g. "50+" */
  activeLearners: string;
}

export interface ImpactInsufficient {
  ok: false;
  insufficient: true;
}

export type ImpactResult = ImpactOk | ImpactInsufficient;

const DATA_DIR = join(process.cwd(), "data");
const CACHE_MS = 5 * 60 * 1000;
const MIN_LEARNERS = 5;
const ACTIVE_DAYS = 7;

let cache: { at: number; result: ImpactResult } | null = null;

function dayKeysLast(n: number): Set<string> {
  const keys = new Set<string>();
  for (let i = 0; i < n; i++) {
    keys.add(istDayKey(new Date(Date.now() - i * 24 * 60 * 60 * 1000)));
  }
  return keys;
}

interface ChallengeLogEntry {
  date?: string;
}

function countChallengeAnswers(activeKeys: Set<string>, activeLearners: Set<string>): number {
  let total = 0;
  if (!existsSync(DATA_DIR)) return 0;
  for (const f of readdirSync(DATA_DIR)) {
    if (!/^challenge-log-\d+\.json$/.test(f)) continue;
    try {
      const log = JSON.parse(readFileSync(join(DATA_DIR, f), "utf8")) as Record<
        string,
        ChallengeLogEntry
      >;
      for (const [sid, entry] of Object.entries(log)) {
        if (!entry || typeof entry !== "object") continue;
        total += 1;
        if (typeof entry.date === "string" && activeKeys.has(entry.date)) {
          activeLearners.add(sid);
        }
      }
    } catch {
      // skip unreadable logs
    }
  }
  return total;
}

export function impactStats(): ImpactResult {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_MS) return cache.result;

  const activeKeys = dayKeysLast(ACTIVE_DAYS);
  const activeLearners = new Set<string>();
  const revisedTopics = new Set<string>();

  let totalQuestionsAnswered = 0;
  let quizzesTaken = 0;

  const sids = memory.allStudentIds();
  if (sids.length < MIN_LEARNERS) {
    const res: ImpactResult = { ok: false, insufficient: true };
    cache = { at: now, result: res };
    return res;
  }

  for (const sid of sids) {
    // Quiz counters + activity from memory records.
    for (const r of memory.list(sid)) {
      if (r.kind === "quiz_result" && !r.superseded) {
        quizzesTaken += 1;
        try {
          const d = JSON.parse(r.text) as { total?: unknown };
          const t = typeof d.total === "number" && Number.isFinite(d.total) ? d.total : 0;
          totalQuestionsAnswered += t;
        } catch {
          // malformed record: quiz taken but uncountable questions
        }
      }
      const t = Date.parse(r.updatedAt || r.createdAt);
      if (Number.isFinite(t) && t >= now - ACTIVE_DAYS * 24 * 60 * 60 * 1000) {
        activeLearners.add(sid);
      }
    }
    // Revised chapters: distinct SRS topics with at least one review.
    try {
      for (const c of srs.listCards(sid)) {
        if (c.reviews > 0 && c.topic.trim()) {
          revisedTopics.add(c.topic.trim().toLowerCase());
        }
      }
    } catch {
      // skip unreadable card files
    }
  }

  totalQuestionsAnswered += countChallengeAnswers(activeKeys, activeLearners);

  // Round DOWN to nearest 10; minimum display is "10+" so a small-but-valid
  // cohort (5-9) never renders "0+".
  const rounded = Math.floor(activeLearners.size / 10) * 10;
  const activeDisplay = rounded <= 0 ? "10+" : `${rounded}+`;

  const res: ImpactResult = {
    ok: true,
    totalQuestionsAnswered,
    quizzesTaken,
    chaptersRevised: revisedTopics.size,
    activeLearners: activeDisplay,
  };
  cache = { at: now, result: res };
  return res;
}

/** Test/admin helper: clear the 5-minute cache. */
export function clearImpactCache(): void {
  cache = null;
}
