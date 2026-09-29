/**
 * Study planner: deterministic day-wise plan generation (Hindi template),
 * optional one-shot LLM polish of titles when a real key is configured,
 * atomic persistence in data/plans-<studentId>.json.
 *
 * Due FSRS cards (srs.dueCards) are auto-included as "revision" tasks,
 * spread across the plan's days.
 */

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { atomicWriteJson } from "./fsutil";
import { sanitizeStudentId } from "./memory";
import { loadChapters } from "./chapters";
import { dueCards } from "./srs";
import { chatComplete } from "./llm";
import { trySpend, recordSpend } from "./budget";
import { BudgetError } from "./agent";

export type PlanTaskType = "padho" | "quiz" | "revision";

export interface PlanTask {
  type: PlanTaskType;
  title: string;
  detail: string;
  done: boolean;
}

export interface PlanDay {
  day: number;
  tasks: PlanTask[];
}

export interface StudyPlan {
  studentId: string;
  class: string;
  createdAt: string;
  daysTotal: number;
  minutesPerDay: number;
  chapterIds: string[];
  days: PlanDay[];
}

const DATA_DIR = join(process.cwd(), "data");
const MAX_DUE_CARDS = 60;

function ensureDir(): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

function fileFor(studentId: string): string {
  return join(DATA_DIR, `plans-${studentId}.json`);
}

export interface ChapterValidation {
  ok: boolean;
  titles?: Map<string, string>;
  error?: string;
}

/** Validate chapter ids against the chapters index (dedup, keep order). */
export function validateChapterIds(ids: string[]): ChapterValidation {
  if (!Array.isArray(ids) || ids.length === 0) {
    return { ok: false, error: "Kam se kam ek chapter id chahiye." };
  }
  if (ids.length > 20) {
    return { ok: false, error: "Zyada se zyada 20 chapters ek plan me." };
  }
  const chapters = loadChapters();
  const titles = new Map<string, string>();
  for (const raw of ids) {
    const id = String(raw ?? "").trim().toLowerCase().slice(0, 100);
    if (!id) return { ok: false, error: "Khali chapter id nahi chalegi." };
    if (titles.has(id)) continue;
    const ch = chapters.find((c) => c.id === id);
    if (!ch) return { ok: false, error: `Chapter id galat hai: ${id}` };
    titles.set(id, ch.title);
  }
  if (titles.size === 0) return { ok: false, error: "Kam se kam ek valid chapter chahiye." };
  return { ok: true, titles };
}

export interface GeneratePlanOpts {
  studentId: string;
  classLevel: string;
  chapterIds: string[];
  days: number;
  minutesPerDay: number;
  ip: string;
}

/** Deterministic Hindi plan; LLM polish applied only when not in mock mode. */
export async function generatePlan(opts: GeneratePlanOpts): Promise<StudyPlan> {
  const sid = sanitizeStudentId(opts.studentId);
  if (!sid) throw new Error("Valid studentId chahiye.");
  const v = validateChapterIds(opts.chapterIds);
  if (!v.ok || !v.titles) throw new Error(v.error ?? "Chapter ids galat hain.");
  const ids = [...v.titles.keys()];
  const titles = v.titles;

  const perDay = Math.ceil(ids.length / opts.days);
  const days: PlanDay[] = [];
  for (let d = 1; d <= opts.days; d++) {
    const tasks: PlanTask[] = [];
    const slice = ids.slice((d - 1) * perDay, d * perDay);
    for (const id of slice) {
      const title = titles.get(id) ?? id;
      tasks.push({
        type: "padho",
        title: `${title} — padho aur samjho`,
        detail:
          `Key points dhyan se padho, phir khud se 2-3 sawal banao. ` +
          `Roz lagbhag ${opts.minutesPerDay} minute padhai ka lakshya rakho.`,
        done: false,
      });
      tasks.push({
        type: "quiz",
        title: `${title} — chhota quiz do`,
        detail: "Is chapter par quiz attempt karo aur galat jawab note karo.",
        done: false,
      });
    }
    if (slice.length === 0) {
      tasks.push({
        type: "revision",
        title: "Purane chapters revise karo",
        detail: "Pichhle dinon ke weak topics dobara padho aur ek baar phir quiz do.",
        done: false,
      });
    }
    days.push({ day: d, tasks });
  }

  // Auto-include due FSRS cards as revision tasks, spread across days.
  try {
    const due = dueCards(sid).slice(0, MAX_DUE_CARDS);
    due.forEach((card, i) => {
      const dayIdx = i % days.length;
      days[dayIdx].tasks.push({
        type: "revision",
        title: `Revision: ${card.front.slice(0, 80)}${card.front.length > 80 ? "…" : ""}`,
        detail: `Flashcard revise karo${card.topic ? ` (topic: ${card.topic.slice(0, 60)})` : ""} — jawab yaad karo, phir palat ke dekho.`,
        done: false,
      });
    });
  } catch {
    // revision lookup must never fail plan generation
  }

  let plan: StudyPlan = {
    studentId: sid,
    class: opts.classLevel,
    createdAt: new Date().toISOString(),
    daysTotal: opts.days,
    minutesPerDay: opts.minutesPerDay,
    chapterIds: ids,
    days,
  };

  // One-shot LLM polish of titles (real key only; mock stays deterministic).
  if (process.env.LLM_MOCK !== "1") {
    try {
      plan = await polishPlan(plan, opts.ip);
    } catch {
      // fall back to the deterministic plan
    }
  }

  ensureDir();
  atomicWriteJson(fileFor(sid), plan);
  return plan;
}

/**
 * Ask the LLM to make task titles/details punchier (same structure back).
 * Budget-checked; a BudgetError here only skips the polish, never fails the plan.
 */
async function polishPlan(plan: StudyPlan, ip: string): Promise<StudyPlan> {
  const pre = trySpend(ip || "unknown", 1200, 1200);
  if (!pre.ok) throw new BudgetError("budget");
  const res = await chatComplete({
    messages: [
      {
        role: "system",
        content:
          "Tum ek Hindi study-coach ho. Neeche ek study plan ka JSON hai. " +
          "Har task ka title aur detail aur aakarshak, chhota aur prernadayak banao (Hindi me). " +
          "Structure EXACT same rakho: days array, har day me tasks array, har task me type/title/detail/done. " +
          "type aur done mat badlo. Sirf JSON wapas karo, koi extra text nahi.",
      },
      { role: "user", content: JSON.stringify({ days: plan.days }) },
    ],
    maxTokens: 2000,
    jsonMode: true,
  });
  recordSpend(ip || "unknown", res.inputTokens, res.outputTokens);
  const parsed = JSON.parse(stripCodeFences(res.content)) as {
    days?: Array<{ tasks?: Array<{ title?: string; detail?: string }> }>;
  };
  if (!Array.isArray(parsed.days) || parsed.days.length !== plan.days.length) return plan;
  const merged: StudyPlan = {
    ...plan,
    days: plan.days.map((day, di) => {
      const pday = parsed.days![di];
      if (!pday || !Array.isArray(pday.tasks) || pday.tasks.length !== day.tasks.length) {
        return day;
      }
      return {
        ...day,
        tasks: day.tasks.map((task, ti) => {
          const pt = pday.tasks![ti] ?? {};
          const title = typeof pt.title === "string" && pt.title.trim() ? pt.title.trim().slice(0, 160) : task.title;
          const detail = typeof pt.detail === "string" && pt.detail.trim() ? pt.detail.trim().slice(0, 400) : task.detail;
          return { ...task, title, detail };
        }),
      };
    }),
  };
  return merged;
}

function stripCodeFences(s: string): string {
  return s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
}

/** Load the stored plan, or null when none exists. */
export function loadPlan(studentId: string): StudyPlan | null {
  const sid = sanitizeStudentId(studentId);
  if (!sid) return null;
  ensureDir();
  const f = fileFor(sid);
  if (!existsSync(f)) return null;
  try {
    const v = JSON.parse(readFileSync(f, "utf8")) as StudyPlan;
    if (!v || !Array.isArray(v.days)) return null;
    return v;
  } catch {
    return null;
  }
}

/** Toggle a task's done flag. Returns false when plan/day/task is missing. */
export function toggleTask(
  studentId: string,
  day: number,
  taskIndex: number,
  done: boolean
): boolean {
  const sid = sanitizeStudentId(studentId);
  if (!sid) return false;
  const plan = loadPlan(sid);
  if (!plan) return false;
  const dayObj = plan.days.find((d) => d.day === day);
  if (!dayObj) return false;
  if (taskIndex < 0 || taskIndex >= dayObj.tasks.length) return false;
  dayObj.tasks[taskIndex].done = done;
  ensureDir();
  atomicWriteJson(fileFor(sid), plan);
  return true;
}
