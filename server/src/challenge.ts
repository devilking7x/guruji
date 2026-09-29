/**
 * Daily challenge: one deterministic MCQ per day per class.
 * Mock mode picks from a built-in Hindi pool (seeded by date+class);
 * with a real key the question is generated once via LLM and cached in
 * data/challenge-YYYY-MM-DD-<class>.json. Answers are once-per-day and
 * award XP via mastery.ts (+15 correct, +5 attempt).
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { atomicWriteJson } from "./fsutil";
import { sanitizeStudentId } from "./memory";
import { istDayKey, trySpend, recordSpend } from "./budget";
import { chatComplete } from "./llm";
import { BudgetError, BUDGET_HINDI_MSG } from "./agent";

export interface ChallengeQuestion {
  id: string;
  text: string;
  options: string[];
  topic: string;
  /** server-side only — never sent to the client */
  answerIndex: number;
}

export interface ChallengeQuestionPublic {
  id: string;
  text: string;
  options: string[];
  topic: string;
}

interface PoolItem {
  topic: string;
  text: string;
  options: [string, string, string, string];
  answerIndex: number;
}

const DATA_DIR = join(process.cwd(), "data");

function ensureDir(): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

function cacheFile(date: string, cls: string): string {
  return join(DATA_DIR, `challenge-${date}-${cls}.json`);
}

function logFile(cls: string): string {
  return join(DATA_DIR, `challenge-log-${cls}.json`);
}

const POOL: Record<string, PoolItem[]> = {
  "6": [
    {
      topic: "Bhinn (Fractions)",
      text: "1/2 + 1/4 kitna hota hai?",
      options: ["1/6", "2/6", "3/4", "1/3"],
      answerIndex: 2,
    },
    {
      topic: "Bhojan ke Ghatak",
      text: "Shareer ko sabse zyada energy dene wala bhojan ka ghatak kaunsa hai?",
      options: ["Protein", "Carbohydrate", "Vitamin", "Khanij lavan"],
      answerIndex: 1,
    },
    {
      topic: "Pattern",
      text: "10, 20, 30, ? — agla number kya hoga?",
      options: ["35", "40", "45", "50"],
      answerIndex: 1,
    },
  ],
  "7": [
    {
      topic: "Purnank (Integers)",
      text: "(-5) + 8 kitna hota hai?",
      options: ["-13", "13", "3", "-3"],
      answerIndex: 2,
    },
    {
      topic: "Prakash Sanshleshan",
      text: "Photosynthesis me paudhe hawa se kaun si gas lete hain?",
      options: ["Oxygen", "Nitrogen", "Carbon dioxide", "Hydrogen"],
      answerIndex: 2,
    },
    {
      topic: "Garmi (Heat)",
      text: "Garmi (heat energy) ka SI unit kya hai?",
      options: ["Degree Celsius", "Joule", "Watt", "Newton"],
      answerIndex: 1,
    },
  ],
  "8": [
    {
      topic: "Bijganit (Algebra)",
      text: "Agar x + 5 = 12 hai, to x kitna hai?",
      options: ["5", "6", "7", "17"],
      answerIndex: 2,
    },
    {
      topic: "Prakash (Light)",
      text: "Prakash hamesha seedhi rekha me chalta hai — is niyam ko kya kehte hain?",
      options: ["Paravartan", "Rectilinear propagation", "Apvartan", "Vikshepan"],
      answerIndex: 1,
    },
    {
      topic: "Koshika (Cell)",
      text: "Koshika ka 'powerhouse' kise kehte hain?",
      options: ["Nucleus", "Ribosome", "Mitochondria", "Vacuole"],
      answerIndex: 2,
    },
  ],
  "9": [
    {
      topic: "Gati (Motion)",
      text: "Koi gaadi 60 km doori 2 ghante me tay karti hai. Uski chaal kitni hai?",
      options: ["30 km/h", "60 km/h", "120 km/h", "15 km/h"],
      answerIndex: 0,
    },
    {
      topic: "Bahupad (Polynomials)",
      text: "x² + 5x + 6 ka ek gunankhand (factor) kaunsa hai?",
      options: ["(x + 1)", "(x + 2)", "(x + 5)", "(x + 6)"],
      answerIndex: 1,
    },
    {
      topic: "Parmanu",
      text: "Parmanu ke kendra (center) ko kya kehte hain?",
      options: ["Electron", "Nabhik (Nucleus)", "Kaksha", "Proton baadal"],
      answerIndex: 1,
    },
  ],
  "10": [
    {
      topic: "Dvighaat Samikaran",
      text: "x² - 5x + 6 = 0 ka ek mool (root) kya hai?",
      options: ["1", "2", "4", "6"],
      answerIndex: 1,
    },
    {
      topic: "Vidyut (Electricity)",
      text: "Ohm ka niyam kya kehta hai?",
      options: ["V = I × R", "P = V × I", "Q = I × t", "R = V + I"],
      answerIndex: 0,
    },
    {
      topic: "Amla-Kshar",
      text: "Neembu me kaun sa acid hota hai?",
      options: ["Hydrochloric acid", "Sulphuric acid", "Citric acid", "Acetic acid"],
      answerIndex: 2,
    },
  ],
};

/** Deterministic pick from the pool, seeded by date+class. */
function pickFromPool(cls: string, date: string): ChallengeQuestion {
  const pool = POOL[cls] ?? POOL["8"];
  const h = createHash("sha256").update(`guruji-challenge:${date}:${cls}`).digest();
  const item = pool[h.readUInt32BE(0) % pool.length];
  return {
    id: `ch-${date}-c${cls}`,
    text: item.text,
    options: [...item.options],
    topic: item.topic,
    answerIndex: item.answerIndex,
  };
}

function validQuestion(v: unknown): v is ChallengeQuestion {
  if (typeof v !== "object" || v === null) return false;
  const q = v as Record<string, unknown>;
  return (
    typeof q.id === "string" && q.id.length > 0 &&
    typeof q.text === "string" && q.text.length > 0 &&
    Array.isArray(q.options) && q.options.length === 4 &&
    q.options.every((o) => typeof o === "string") &&
    typeof q.topic === "string" &&
    Number.isInteger(q.answerIndex) && (q.answerIndex as number) >= 0 && (q.answerIndex as number) <= 3
  );
}

/**
 * Get (generating + caching when needed) today's question for a class.
 * The LLM path runs at most once per day per class and is budget-checked.
 */
export async function ensureTodayQuestion(cls: string, ip = "unknown"): Promise<ChallengeQuestion> {
  const date = istDayKey();
  ensureDir();
  const f = cacheFile(date, cls);
  if (existsSync(f)) {
    try {
      const v = JSON.parse(readFileSync(f, "utf8")) as unknown;
      if (validQuestion(v)) return v;
    } catch {
      // corrupt cache: regenerate below
    }
  }

  let q: ChallengeQuestion;
  if (process.env.LLM_MOCK === "1") {
    q = pickFromPool(cls, date);
  } else {
    try {
      q = await generateViaLlm(cls, date, ip);
    } catch {
      q = pickFromPool(cls, date); // LLM failure must never break the challenge
    }
  }
  atomicWriteJson(f, q);
  return q;
}

async function generateViaLlm(cls: string, date: string, ip: string): Promise<ChallengeQuestion> {
  const pre = trySpend(ip, 400, 400);
  if (!pre.ok) throw new BudgetError(BUDGET_HINDI_MSG);
  const res = await chatComplete({
    messages: [
      {
        role: "system",
        content:
          "Tum ek Hindi tutor ho. Sirf JSON object output karo, koi extra text nahi.",
      },
      {
        role: "user",
        content:
          `Class ${cls} (Maths ya Science) ke liye ek multiple-choice sawal banao, simple Hindi (Roman script) me. ` +
          `Technical English shabd English me hi rakho. ` +
          `Return ONLY a JSON object (no code fences): ` +
          `{"topic": "...", "text": "...", "options": ["a","b","c","d"], "answerIndex": 0}. ` +
          `Exactly 4 options, answerIndex 0-3.`,
      },
    ],
    maxTokens: 500,
    jsonMode: true,
  });
  recordSpend(ip, res.inputTokens, res.outputTokens);
  const parsed = JSON.parse(
    res.content.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "")
  ) as Record<string, unknown>;
  const options = Array.isArray(parsed.options)
    ? parsed.options.map((o) => String(o)).slice(0, 4)
    : [];
  const answerIndex = Number(parsed.answerIndex);
  const q: ChallengeQuestion = {
    id: `ch-${date}-c${cls}`,
    text: String(parsed.text || "").trim(),
    options,
    topic: String(parsed.topic || "General").trim().slice(0, 100),
    answerIndex,
  };
  if (!validQuestion(q)) throw new Error("Challenge question parse nahi ho paya.");
  return q;
}

interface AnswerLog {
  [sid: string]: { date: string; questionId: string; correct: boolean };
}

function readLog(cls: string): AnswerLog {
  ensureDir();
  const f = logFile(cls);
  if (!existsSync(f)) return {};
  try {
    const v = JSON.parse(readFileSync(f, "utf8")) as unknown;
    return typeof v === "object" && v !== null ? (v as AnswerLog) : {};
  } catch {
    return {};
  }
}

/** Has this student already answered today's challenge? */
export function answeredToday(studentId: string, cls: string): boolean {
  const sid = sanitizeStudentId(studentId);
  if (!sid) return false;
  const entry = readLog(cls)[sid];
  return !!entry && entry.date === istDayKey();
}

/** Record an answer (once per day is enforced by the route). */
export function recordAnswer(
  studentId: string,
  cls: string,
  questionId: string,
  correct: boolean
): void {
  const sid = sanitizeStudentId(studentId);
  if (!sid) throw new Error("Valid studentId chahiye.");
  ensureDir();
  const log = readLog(cls);
  log[sid] = { date: istDayKey(), questionId, correct };
  atomicWriteJson(logFile(cls), log);
}

/** Strip the server-side answer key before sending to the client. */
export function publicQuestion(q: ChallengeQuestion): ChallengeQuestionPublic {
  return { id: q.id, text: q.text, options: q.options, topic: q.topic };
}
