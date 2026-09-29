/**
 * NCERT-grounded RAG-lite: original concise chapter summaries (Classes 6-10,
 * Maths + Science) loaded from data/chapters/*.json, with simple TF-IDF /
 * keyword scoring retrieval. No external deps.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface Chapter {
  id: string;
  class: string;
  subject: string;
  title: string;
  keyPoints: string[];
  keyTerms: string[];
}

export interface ChapterHit {
  chapter: Chapter;
  score: number;
}

/** Citation format the tutor must use, e.g. [Class 8 Science · Adhyay: Prakash] */
export function citationFor(c: Chapter): string {
  return `[Class ${c.class} ${c.subject} · Adhyay: ${c.title}]`;
}

function chaptersDir(): string | null {
  const candidates = [
    join(process.cwd(), "data", "chapters"), // dev / local (cwd = server/)
    join(process.cwd(), "server", "data", "chapters"), // Render (cwd = repo root)
    join(__dirname, "..", "data", "chapters"), // bundled dist (dist/../data)
    join(__dirname, "data", "chapters"),
  ];
  for (const d of candidates) {
    if (existsSync(d)) return d;
  }
  return null;
}

let cache: Chapter[] | null = null;

function parseChapter(raw: string): Chapter | null {
  try {
    const v = JSON.parse(raw) as Record<string, unknown>;
    const id = String(v.id || "").trim();
    const title = String(v.title || "").trim();
    if (!id || !title) return null;
    const keyPoints = Array.isArray(v.keyPoints)
      ? v.keyPoints.map((p) => String(p)).filter((p) => p.trim())
      : [];
    const keyTerms = Array.isArray(v.keyTerms)
      ? v.keyTerms.map((p) => String(p)).filter((p) => p.trim())
      : [];
    if (keyPoints.length === 0) return null;
    return {
      id,
      class: String(v.class || "").trim(),
      subject: String(v.subject || "").trim(),
      title,
      keyPoints,
      keyTerms,
    };
  } catch {
    return null;
  }
}

/** Load all chapters (cached after first call). */
export function loadChapters(): Chapter[] {
  if (cache) return cache;
  const dir = chaptersDir();
  const out: Chapter[] = [];
  if (dir) {
    for (const f of readdirSync(dir)) {
      if (!f.endsWith(".json")) continue;
      try {
        const c = parseChapter(readFileSync(join(dir, f), "utf8"));
        if (c) out.push(c);
      } catch {
        // skip unreadable files
      }
    }
  }
  cache = out;
  return out;
}

function tokenize(s: string): string[] {
  return (s || "")
    .toLowerCase()
    .split(/[^a-z0-9\u0900-\u097f\u0980-\u09ff]+/u)
    .map((t) => t.trim())
    .filter((t) => t.length > 1);
}

/**
 * Simple TF-IDF-ish keyword scoring:
 *  title hit ×3, keyTerm hit ×2, keyPoint hit ×1,
 *  prefix/substring partials ×0.5. Deterministic.
 */
export function searchChapters(query: string, topN = 3): ChapterHit[] {
  const chapters = loadChapters();
  const tokens = tokenize(query);
  if (tokens.length === 0 || chapters.length === 0) return [];

  const scored: ChapterHit[] = [];
  for (const c of chapters) {
    const titleToks = new Set(tokenize(c.title));
    const termToks = new Set(c.keyTerms.flatMap(tokenize));
    const pointToks = new Set(c.keyPoints.flatMap(tokenize));
    let score = 0;
    for (const t of tokens) {
      if (titleToks.has(t)) score += 3;
      else if (termToks.has(t)) score += 2;
      else if (pointToks.has(t)) score += 1;
      else {
        // partial / prefix matches count less
        let partial = false;
        for (const pool of [titleToks, termToks, pointToks]) {
          for (const h of pool) {
            if (
              h !== t &&
              h.length > 3 &&
              t.length > 3 &&
              (h.startsWith(t) || t.startsWith(h) || h.includes(t) || t.includes(h))
            ) {
              partial = true;
              break;
            }
          }
          if (partial) break;
        }
        if (partial) score += 0.5;
      }
    }
    if (score > 0) scored.push({ chapter: c, score });
  }
  scored.sort((a, b) => b.score - a.score || a.chapter.id.localeCompare(b.chapter.id));
  return scored.slice(0, Math.max(1, topN));
}

/** Force reload (tests). */
export function reloadChapters(): void {
  cache = null;
}
