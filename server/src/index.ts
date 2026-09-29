import express, { Request, Response, NextFunction } from "express";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import * as memory from "./memory";
import * as srs from "./srs";
import * as mastery from "./mastery";
import { searchChapters } from "./chapters";
import { runChat, BudgetError, BUDGET_HINDI_MSG } from "./agent";
import { startQuiz, submitQuiz, QuizNotFoundError } from "./quiz";
import { checkBudget, recordSpend } from "./budget";
import { estimateTokens } from "./llm";
import { checkSelfHarm, checkJailbreak } from "./guard";

const app = express();
app.set("trust proxy", true);
app.use(express.json({ limit: "1mb" }));

// CORS allow-all.
app.use((req: Request, res: Response, next: NextFunction) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
});

const DATA_DIR = join(process.cwd(), "data");
if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

function clientIp(req: Request): string {
  const xff = req.headers["x-forwarded-for"];
  const first = Array.isArray(xff) ? xff[0] : (xff || "").split(",")[0];
  return (first || req.ip || "unknown").trim().slice(0, 64);
}

function badRequest(res: Response, message: string): void {
  res.status(400).json({ error: "badRequest", message });
}

/**
 * Strict studentId for the new (Round 2) endpoints: must be present and
 * sanitize to a non-empty id. Returns null when invalid.
 */
function requireStudentId(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.trim().length === 0) return null;
  const sid = memory.sanitizeStudentId(raw);
  return sid || null;
}

// ---------- health ----------
app.get("/api/health", (_req: Request, res: Response) => {
  res.status(200).json({ ok: true, service: "guruji", time: new Date().toISOString() });
});

// ---------- student ----------
app.post("/api/student", (req: Request, res: Response) => {
  const { studentId, name, classLevel } = req.body ?? {};
  if (typeof name !== "string" || name.trim().length < 1 || name.trim().length > 100) {
    res.status(400).json({ error: "badRequest", message: "Naam 1-100 characters ka hona chahiye." });
    return;
  }
  const cls = String(classLevel ?? "").trim();
  if (!/^\d{1,2}$/.test(cls) || Number(cls) < 1 || Number(cls) > 12) {
    res.status(400).json({ error: "badRequest", message: "Class 1 se 12 ke beech honi chahiye." });
    return;
  }
  const sid =
    typeof studentId === "string" && studentId.trim()
      ? memory.sanitizeStudentId(studentId)
      : memory.sanitizeStudentId(name);
  if (!sid) {
    res.status(400).json({ error: "badRequest", message: "Valid studentId nahi ban paya." });
    return;
  }
  // Upsert profile memory: supersede old profile, add new one.
  for (const rec of memory.list(sid)) {
    if (rec.kind === "profile") memory.markSupersededIfExists(sid, "profile", rec.text.slice(0, 20));
  }
  memory.add(sid, `Naam: ${name.trim()}, Class: ${cls}`, "profile");
  res.status(200).json({
    ok: true,
    student: { studentId: sid, name: name.trim(), classLevel: cls },
  });
});

// ---------- chat (SSE) ----------
app.post("/api/chat", async (req: Request, res: Response) => {
  const { message, studentId, mode } = req.body ?? {};
  if (typeof message !== "string" || message.trim().length < 1 || message.trim().length > 2000) {
    res.status(400).json({ error: "badRequest", message: "Message 1-2000 characters ka hona chahiye." });
    return;
  }
  const m = mode === "revision" ? "revision" : "chat";
  const sid = memory.sanitizeStudentId(typeof studentId === "string" ? studentId : "anonymous") || "anonymous";
  const ip = clientIp(req);
  const cleanMsg = message.trim();

  // Server-side safety guards: self-harm + prompt-injection. These never call
  // the LLM and never cost the real budget — only a tiny accounting entry so
  // refusal loops can't be abused for free.
  const crisis = checkSelfHarm(cleanMsg);
  const jailbreak = crisis ? null : checkJailbreak(cleanMsg);
  const guardReply = crisis ?? jailbreak;
  if (guardReply) {
    recordSpend(ip, 1, estimateTokens(guardReply));
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write(`data: ${JSON.stringify({ t: "tok", x: guardReply })}\n\n`);
    res.write(`data: ${JSON.stringify({ t: "done", inputTokens: 1, outputTokens: estimateTokens(guardReply) })}\n\n`);
    res.end();
    return;
  }

  // Dry budget check BEFORE SSE headers so an over-quota client gets 429 JSON
  // per the contract (not a half-opened SSE stream). Read-only: runChat does
  // the real reservation when it starts.
  if (!checkBudget(ip, estimateTokens(String(message)) + 500, 0).ok) {
    res.status(429).json({ error: "budgetExceeded", message: BUDGET_HINDI_MSG });
    return;
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  const send = (obj: Record<string, unknown>) => {
    res.write(`data: ${JSON.stringify(obj)}\n\n`);
  };

  try {
    const result = await runChat({
      message: cleanMsg,
      studentId: sid,
      mode: m,
      ip,
      onToken: (chunk) => send({ t: "tok", x: chunk }),
    });
    send({ t: "done", inputTokens: result.inputTokens, outputTokens: result.outputTokens });
    res.end();
  } catch (err) {
    if (err instanceof BudgetError) {
      // Only reachable via a race (cap hit between dry-check and pre-check);
      // SSE headers are already sent, so report it as an SSE error event.
      send({ t: "error", message: err.message });
      res.end();
      return;
    }
    console.error("chat error:", err instanceof Error ? err.message : err);
    send({ t: "error", message: "Maaf karo, kuch gadbad ho gayi. Thodi der baad phir try karo." });
    res.end();
  }
});

// ---------- quiz ----------
app.post("/api/quiz/start", async (req: Request, res: Response) => {
  try {
    const { topic, studentId, count, classLevel } = req.body ?? {};
    const topicStr = String(topic ?? "");
    // Server-side guard on quiz topic (prompt is interpolated from it) —
    // refuse without calling the LLM.
    const crisis = checkSelfHarm(topicStr);
    const jailbreak = crisis ? null : checkJailbreak(topicStr);
    const guardReply = crisis ?? jailbreak;
    if (guardReply) {
      res.status(400).json({ error: "badRequest", message: guardReply });
      return;
    }
    const out = await startQuiz({
      topic: topicStr,
      studentId: typeof studentId === "string" ? studentId : "anonymous",
      count: typeof count === "number" ? count : undefined,
      classLevel: typeof classLevel === "string" ? classLevel : undefined,
      ip: clientIp(req),
    });
    res.status(200).json(out);
  } catch (err) {
    if (err instanceof BudgetError) {
      res.status(429).json({ error: "budgetExceeded", message: err.message });
      return;
    }
    res.status(400).json({
      error: "badRequest",
      message: err instanceof Error ? err.message : "Quiz start nahi ho paya.",
    });
  }
});

app.post("/api/quiz/submit", async (req: Request, res: Response) => {
  try {
    const { quizId, answers, studentId } = req.body ?? {};
    const out = await submitQuiz({
      quizId: String(quizId ?? ""),
      answers: Array.isArray(answers) ? answers : [],
      studentId: typeof studentId === "string" ? studentId : "anonymous",
    });
    res.status(200).json(out);
  } catch (err) {
    if (err instanceof QuizNotFoundError) {
      res.status(404).json({ error: "notFound", message: err.message });
      return;
    }
    res.status(400).json({
      error: "badRequest",
      message: err instanceof Error ? err.message : "Quiz submit nahi ho paya.",
    });
  }
});

// ---------- revision queue (FSRS-lite) ----------
app.post("/api/revision/cards", (req: Request, res: Response) => {
  const sid = requireStudentId(req.body?.studentId);
  if (!sid) {
    badRequest(res, "Valid studentId chahiye.");
    return;
  }
  const cards = req.body?.cards;
  if (!Array.isArray(cards) || cards.length === 0 || cards.length > 50) {
    badRequest(res, "cards 1 se 50 items ki array honi chahiye.");
    return;
  }
  const clean: Array<{ front: string; back: string; topic: string }> = [];
  for (const c of cards) {
    const front = typeof c?.front === "string" ? c.front.trim() : "";
    const back = typeof c?.back === "string" ? c.back.trim() : "";
    const topic = typeof c?.topic === "string" ? c.topic.trim().slice(0, 200) : "";
    if (front.length < 1 || front.length > 2000 || back.length < 1 || back.length > 2000) {
      badRequest(res, "Har card ka front/back 1-2000 characters ka hona chahiye.");
      return;
    }
    clean.push({ front, back, topic });
  }
  try {
    const out = srs.addCards(sid, clean);
    res.status(200).json({ added: out.added });
  } catch (err) {
    badRequest(res, err instanceof Error ? err.message : "Cards add nahi ho paye.");
  }
});

app.get("/api/revision/due", (req: Request, res: Response) => {
  const sid = requireStudentId(req.query.studentId);
  if (!sid) {
    badRequest(res, "Valid studentId chahiye.");
    return;
  }
  const cards = srs.dueCards(sid).map((c) => ({
    id: c.id,
    front: c.front,
    back: c.back,
    topic: c.topic,
  }));
  res.status(200).json({ cards });
});

app.post("/api/revision/grade", (req: Request, res: Response) => {
  const sid = requireStudentId(req.body?.studentId);
  if (!sid) {
    badRequest(res, "Valid studentId chahiye.");
    return;
  }
  const cardId = typeof req.body?.cardId === "string" ? req.body.cardId.trim() : "";
  if (!cardId) {
    badRequest(res, "cardId chahiye.");
    return;
  }
  const rating = req.body?.rating;
  if (!Number.isInteger(rating) || rating < 1 || rating > 4) {
    badRequest(res, "Rating 1 se 4 ke beech honi chahiye.");
    return;
  }
  try {
    const out = srs.gradeCard(sid, cardId, rating);
    if (!out) {
      res.status(404).json({ error: "notFound", message: "Card nahi mila." });
      return;
    }
    res.status(200).json({ ok: true });
  } catch (err) {
    badRequest(res, err instanceof Error ? err.message : "Grade nahi ho paya.");
  }
});

// ---------- chapters search (RAG-lite) ----------
app.get("/api/chapters/search", (req: Request, res: Response) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  if (q.length < 1 || q.length > 200) {
    badRequest(res, "Search query 1-200 characters ki honi chahiye.");
    return;
  }
  const hits = searchChapters(q, 3).map((h) => ({
    id: h.chapter.id,
    class: h.chapter.class,
    subject: h.chapter.subject,
    title: h.chapter.title,
    keyPoints: h.chapter.keyPoints,
    keyTerms: h.chapter.keyTerms,
    score: Math.round(h.score * 100) / 100,
  }));
  res.status(200).json({ chapters: hits });
});

// ---------- progress ----------
app.get("/api/progress", (req: Request, res: Response) => {
  const sid = memory.sanitizeStudentId(String(req.query.studentId ?? "anonymous")) || "anonymous";
  const records = memory.list(sid);
  const profile = records.find((r) => r.kind === "profile" && !r.superseded);
  const quizResults = records.filter((r) => r.kind === "quiz_result" && !r.superseded);
  const weak = records
    .filter((r) => r.kind === "weak_topic" && !r.superseded)
    .map((r) => r.text);

  const byTopic = new Map<string, { scores: number[]; lastAt: string | null }>();
  const history: Array<{ at: string; topic: string; score: number; total: number }> = [];
  for (const r of quizResults) {
    try {
      const d = JSON.parse(r.text) as { topic: string; score: number; total: number; at: string };
      if (!d.topic) continue;
      history.push({ at: d.at || r.createdAt, topic: d.topic, score: d.score, total: d.total });
      const e = byTopic.get(d.topic) ?? { scores: [], lastAt: null };
      e.scores.push(d.total > 0 ? d.score / d.total : 0);
      const at = d.at || r.createdAt;
      if (!e.lastAt || at > e.lastAt) e.lastAt = at;
      byTopic.set(d.topic, e);
    } catch {
      // skip malformed result records
    }
  }
  const topics = [...byTopic.entries()].map(([topic, e]) => ({
    topic,
    quizzes: e.scores.length,
    avgScore: e.scores.length > 0 ? Math.round((e.scores.reduce((a, b) => a + b, 0) / e.scores.length) * 100) : null,
    lastAt: e.lastAt,
  }));
  history.sort((a, b) => (a.at < b.at ? 1 : -1));

  let name: string | null = null;
  let classLevel: string | null = null;
  if (profile) {
    const nm = /Naam:\s*([^,]+)/.exec(profile.text);
    const cl = /Class:\s*([^\s,]+)/.exec(profile.text);
    if (nm) name = nm[1].trim();
    if (cl) classLevel = cl[1].trim();
  }

  // Round 2: mastery/XP/streak/badges (server-side). weakTopics merges the
  // v1 weak_topic memory records with mastery-based weak topics (<60).
  const extras = mastery.progressExtras(sid);
  const mergedWeak = [...new Set([...weak, ...extras.weakTopics])];

  res.status(200).json({
    student: { name, classLevel },
    topics,
    history,
    weakTopics: mergedWeak,
    mastery: extras.mastery,
    xp: extras.xp,
    streak: extras.streak,
    badges: extras.badges,
  });
});

// ---------- memory ----------
app.get("/api/memory", (req: Request, res: Response) => {
  const sid = memory.sanitizeStudentId(String(req.query.studentId ?? "anonymous")) || "anonymous";
  res.status(200).json({
    memories: memory.list(sid).map((r) => ({
      id: r.id,
      text: r.text,
      kind: r.kind,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      superseded: r.superseded,
    })),
  });
});

app.delete("/api/memory/:id", (req: Request, res: Response) => {
  const sid = memory.sanitizeStudentId(String(req.query.studentId ?? "anonymous")) || "anonymous";
  const ok = memory.remove(sid, req.params.id);
  if (!ok) {
    res.status(404).json({ error: "notFound", message: "Memory nahi mili." });
    return;
  }
  res.status(200).json({ ok: true });
});

// ---------- 404 + error handling ----------
app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: "notFound", message: "Route nahi mila." });
});

// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error("unhandled error:", err instanceof Error ? err.message : err);
  res.status(500).json({ error: "internal", message: "Server me kuch gadbad ho gayi." });
});

const PORT = Number(process.env.PORT) || 3001;
app.listen(PORT, () => {
  console.log(`guruji-server listening on :${PORT}`);
});
