import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { atomicWriteJson } from "./fsutil";

const DATA_DIR = join(process.cwd(), "data");
const SPEND_FILE = join(DATA_DIR, "ip-spend.json");
const MAX_IPS = 2000; // evict oldest beyond this

interface DaySpend {
  day: string;
  spent: number;
  lastSeen: number;
}
type SpendState = Record<string, DaySpend>;

function capUsd(): number {
  const v = parseFloat(process.env.GURUJI_IP_DAILY_CAP_USD || "0.15");
  return Number.isFinite(v) && v > 0 ? v : 0.15;
}

export function priceInputPer1M(): number {
  const v = parseFloat(process.env.LLM_PRICE_INPUT_PER_1M || "0.2");
  return Number.isFinite(v) && v >= 0 ? v : 0.2;
}

export function priceOutputPer1M(): number {
  const v = parseFloat(process.env.LLM_PRICE_OUTPUT_PER_1M || "0.6");
  return Number.isFinite(v) && v >= 0 ? v : 0.6;
}

export function tokenCostUsd(inputTokens: number, outputTokens: number): number {
  return (
    (inputTokens / 1_000_000) * priceInputPer1M() +
    (outputTokens / 1_000_000) * priceOutputPer1M()
  );
}

/** Day key in IST (Asia/Kolkata) so the daily cap rolls over at midnight IST. */
export function istDayKey(d: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  const day = parts.find((p) => p.type === "day")?.value;
  return `${y}-${m}-${day}`;
}

function load(): SpendState {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  if (!existsSync(SPEND_FILE)) return {};
  try {
    const v = JSON.parse(readFileSync(SPEND_FILE, "utf8"));
    return typeof v === "object" && v !== null ? (v as SpendState) : {};
  } catch {
    return {};
  }
}

function save(state: SpendState): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  atomicWriteJson(SPEND_FILE, state);
}

function evictOldest(state: SpendState): void {
  const keys = Object.keys(state);
  if (keys.length <= MAX_IPS) return;
  keys.sort((a, b) => (state[a].lastSeen ?? 0) - (state[b].lastSeen ?? 0));
  for (const k of keys.slice(0, keys.length - MAX_IPS)) delete state[k];
}

function costOf(inputTokens: number, outputTokens: number): number {
  return tokenCostUsd(inputTokens, outputTokens);
}

function daySpent(state: SpendState, key: string, day: string): number {
  const entry = state[key];
  return entry && entry.day === day ? entry.spent : 0;
}

/**
 * Read-only budget check: would this spend exceed the cap? Never records.
 */
export function checkBudget(
  ip: string,
  inputTokens: number,
  outputTokens: number
): { ok: boolean; spentToday: number } {
  const key = (ip || "unknown").slice(0, 64);
  const spent = daySpent(load(), key, istDayKey());
  return {
    ok: spent + costOf(inputTokens, outputTokens) <= capUsd(),
    spentToday: spent,
  };
}

/**
 * Try to spend token cost for an IP. Refuses (ok:false) when the spend would
 * exceed the per-IP daily cap. Returns the day's spent total (after adding).
 */
export function trySpend(
  ip: string,
  inputTokens: number,
  outputTokens: number
): { ok: boolean; spentToday: number } {
  const key = (ip || "unknown").slice(0, 64);
  const cost = costOf(inputTokens, outputTokens);
  const day = istDayKey();
  const state = load();
  const spent = daySpent(state, key, day);
  if (spent + cost > capUsd()) {
    return { ok: false, spentToday: spent };
  }
  state[key] = { day, spent: spent + cost, lastSeen: Date.now() };
  evictOldest(state);
  save(state);
  return { ok: true, spentToday: spent + cost };
}

/** Spend already incurred (no cap check — used to record actual usage). */
export function recordSpend(ip: string, inputTokens: number, outputTokens: number): void {
  const key = (ip || "unknown").slice(0, 64);
  const cost = tokenCostUsd(inputTokens, outputTokens);
  const day = istDayKey();
  const state = load();
  const entry = state[key];
  const spent = entry && entry.day === day ? entry.spent : 0;
  state[key] = { day, spent: spent + cost, lastSeen: Date.now() };
  evictOldest(state);
  save(state);
}

/** Read-only: how much has this IP spent today (IST). */
export function spentToday(ip: string): number {
  const state = load();
  const entry = state[(ip || "unknown").slice(0, 64)];
  return entry && entry.day === istDayKey() ? entry.spent : 0;
}
