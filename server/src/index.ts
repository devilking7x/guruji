import express, { Request, Response, NextFunction } from "express";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import * as memory from "./memory";
import * as srs from "./srs";
import * as mastery from "./mastery";
import { searchChapters, loadChapters } from "./chapters";
import { runChat, BudgetError, BUDGET_HINDI_MSG } from "./agent";
import { startQuiz, submitQuiz, generateQuestionItems, QuizNotFoundError } from "./quiz";
import { checkBudget, recordSpend, istDayKey } from "./budget";
import { estimateTokens } from "./llm";
import { checkSelfHarm, checkJailbreak } from "./guard";
// Round 3 modules.
import { checkCopy } from "./copycheck";
import * as planner from "./planner";
import * as nickname from "./nickname";
import * as challenge from "./challenge";
import * as leaderboard from "./leaderboard";
import { teacherStats } from "./teacher";
import { getBoundary, parseMultipart, decodeField, detectImageMime } from "./multipart";

const app = express();
app.set("trust proxy", true);
app.use(express.json({ limit: "1mb" }));

// CORS allow-all.
app.use((req: Request, res: Response, next: NextFunction) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
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

/** Guruji serves Classes 6-10. */
function validClassLevel(cls: unknown): string | null {
  const c = String(cls ?? "").trim();
  return /^(6|7|8|9|10)$/.test(c) ? c : null;
}

/** Guard helper: returns the refusal text or null when input is clean. */
function guardText(text: string): string | null {
  return checkSelfHarm(text) ?? checkJailbreak(text);
}

/** Read the raw request body (for multipart routes express.json skips). */
function readRawBody(req: Request, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;
    const fail = (err: Error) => {
      if (done) return;
      done = true;
      try {
        req.destroy();
      } catch {
        // ignore
      }
      reject(err);
    };
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > maxBytes) {
        fail(new Error("body-too-large"));
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      if (done) return;
      done = true;
      resolve(Buffer.concat(chunks));
    });
    req.on("error", (e) => fail(e instanceof Error ? e : new Error("body-read-error")));
  });
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
  // Round 3: every student gets an auto-generated anonymous nickname.
  let nick = "";
  try {
    nick = nickname.getNickname(sid).nickname;
  } catch {
    // nickname must never fail student creation
  }
  res.status(200).json({
    ok: true,
    student: { studentId: sid, name: name.trim(), classLevel: cls, nickname: nick },
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

// ---------- copycheck (Round 3) ----------
// Privacy: the image is processed IN MEMORY and discarded — never written to
// disk, never logged. Strict type/size checks via declared type + magic bytes.
const COPYCHECK_MAX_FILE_BYTES = 5 * 1024 * 1024;
const COPYCHECK_MAX_BODY_BYTES = 6500000;

app.post("/api/copycheck", async (req: Request, res: Response) => {
  const reject = (message: string) => res.status(400).json({ ok: false, error: message });
  try {
    const ctHeader = req.headers["content-type"];
    const boundary = getBoundary(Array.isArray(ctHeader) ? ctHeader[0] : ctHeader);
    if (!boundary) {
      reject("multipart/form-data body with boundary chahiye.");
      return;
    }
    let raw: Buffer;
    try {
      raw = await readRawBody(req, COPYCHECK_MAX_BODY_BYTES);
    } catch {
      reject("File bahut badi hai — image 5MB se chhoti honi chahiye.");
      return;
    }
    const { fields, files } = parseMultipart(raw, boundary);
    const file = files.find((f) => f.fieldName === "photo");
    if (!file || file.data.length === 0) {
      reject("photo field me image file chahiye.");
      return;
    }
    if (file.data.length > COPYCHECK_MAX_FILE_BYTES) {
      reject("Image 5MB se chhoti honi chahiye.");
      return;
    }
    // Declared type AND magic bytes must both agree it's jpeg/png/webp.
    const declared = file.contentType.replace("image/jpg", "image/jpeg");
    const magic = detectImageMime(file.data);
    if (
      !magic ||
      (declared !== "image/jpeg" && declared !== "image/png" && declared !== "image/webp")
    ) {
      reject("Sirf JPEG, PNG ya WebP image allowed hai.");
      return;
    }
    const sid = requireStudentId(decodeField(fields.studentId ?? ""));
    if (!sid) {
      reject("Valid studentId chahiye.");
      return;
    }
    const cls = validClassLevel(decodeField(fields.class ?? ""));
    if (!cls) {
      reject("Class 6 se 10 ke beech honi chahiye.");
      return;
    }
    const subject = decodeField(fields.subject ?? "").trim().slice(0, 100);
    if (!subject) {
      reject("Subject chahiye.");
      return;
    }
    const guardReply = guardText(subject);
    if (guardReply) {
      reject(guardReply);
      return;
    }

    const out = await checkCopy({
      studentId: sid,
      classLevel: cls,
      subject,
      imageBase64: file.data.toString("base64"),
      mimeType: magic,
      ip: clientIp(req),
    });
    // file + raw go out of scope here: the image is discarded, never persisted.
    res.status(200).json({ ok: true, feedback: out.feedback });
  } catch (err) {
    if (err instanceof BudgetError) {
      res.status(429).json({ ok: false, error: "budgetExceeded", message: err.message });
      return;
    }
    console.error("copycheck error:", err instanceof Error ? err.message : err);
    res.status(500).json({ ok: false, error: "Copy check nahi ho paya. Thodi der baad phir try karo." });
  }
});

// ---------- planner (Round 3) ----------
app.post("/api/planner", async (req: Request, res: Response) => {
  try {
    const sid = requireStudentId(req.body?.studentId);
    if (!sid) {
      badRequest(res, "Valid studentId chahiye.");
      return;
    }
    const cls = validClassLevel(req.body?.class);
    if (!cls) {
      badRequest(res, "Class 6 se 10 ke beech honi chahiye.");
      return;
    }
    const chapters = req.body?.chapters;
    if (!Array.isArray(chapters) || chapters.length === 0 || chapters.length > 20) {
      badRequest(res, "chapters 1 se 20 chapter ids ki array honi chahiye.");
      return;
    }
    for (const c of chapters) {
      if (typeof c !== "string" || c.trim().length === 0 || c.trim().length > 100) {
        badRequest(res, "Har chapter id 1-100 characters ki string honi chahiye.");
        return;
      }
    }
    const v = planner.validateChapterIds(chapters);
    if (!v.ok) {
      badRequest(res, v.error ?? "Chapter ids galat hain.");
      return;
    }
    const days = req.body?.days;
    if (!Number.isInteger(days) || days < 1 || days > 60) {
      badRequest(res, "days 1 se 60 ke beech hona chahiye.");
      return;
    }
    const mpd = req.body?.minutesPerDay;
    if (!Number.isInteger(mpd) || mpd < 10 || mpd > 300) {
      badRequest(res, "minutesPerDay 10 se 300 ke beech hona chahiye.");
      return;
    }
    const plan = await planner.generatePlan({
      studentId: sid,
      classLevel: cls,
      chapterIds: chapters,
      days,
      minutesPerDay: mpd,
      ip: clientIp(req),
    });
    res.status(200).json({ ok: true, plan });
  } catch (err) {
    if (err instanceof BudgetError) {
      res.status(429).json({ error: "budgetExceeded", message: err.message });
      return;
    }
    badRequest(res, err instanceof Error ? err.message : "Plan nahi ban paya.");
  }
});

app.get("/api/planner", (req: Request, res: Response) => {
  const sid = requireStudentId(req.query.studentId);
  if (!sid) {
    badRequest(res, "Valid studentId chahiye.");
    return;
  }
  res.status(200).json({ ok: true, plan: planner.loadPlan(sid) });
});

app.patch("/api/planner", (req: Request, res: Response) => {
  const sid = requireStudentId(req.body?.studentId);
  if (!sid) {
    badRequest(res, "Valid studentId chahiye.");
    return;
  }
  const day = req.body?.day;
  const taskIndex = req.body?.taskIndex;
  const done = req.body?.done;
  if (!Number.isInteger(day) || day < 1) {
    badRequest(res, "day 1 se shuru hone wala integer hona chahiye.");
    return;
  }
  if (!Number.isInteger(taskIndex) || taskIndex < 0) {
    badRequest(res, "taskIndex 0 ya usse bada integer hona chahiye.");
    return;
  }
  if (typeof done !== "boolean") {
    badRequest(res, "done boolean hona chahiye.");
    return;
  }
  const ok = planner.toggleTask(sid, day, taskIndex, done);
  if (!ok) {
    res.status(404).json({ error: "notFound", message: "Plan ya task nahi mila." });
    return;
  }
  res.status(200).json({ ok: true });
});

// ---------- worksheet (Round 3) ----------
// Reuses quiz.ts question generation; answers are stripped server-side —
// the client only ever sees {n, q, hint}.
app.post("/api/worksheet", async (req: Request, res: Response) => {
  try {
    const sid = requireStudentId(req.body?.studentId);
    if (!sid) {
      badRequest(res, "Valid studentId chahiye.");
      return;
    }
    const cls = validClassLevel(req.body?.class);
    if (!cls) {
      badRequest(res, "Class 6 se 10 ke beech honi chahiye.");
      return;
    }
    const count = req.body?.count === undefined ? 10 : req.body.count;
    if (!Number.isInteger(count) || count < 1 || count > 20) {
      badRequest(res, "count 1 se 20 ke beech hona chahiye.");
      return;
    }
    const chapterIdRaw = req.body?.chapterId;
    const topicsRaw = req.body?.topics;
    let topic: string;
    let title: string;
    if (typeof chapterIdRaw === "string" && chapterIdRaw.trim()) {
      const ch = loadChapters().find((c) => c.id === chapterIdRaw.trim().toLowerCase());
      if (!ch) {
        badRequest(res, "Chapter id galat hai.");
        return;
      }
      topic = ch.title;
      title = `Worksheet — ${ch.title} (Class ${cls})`;
    } else if (Array.isArray(topicsRaw) && topicsRaw.length > 0) {
      if (topicsRaw.length > 10) {
        badRequest(res, "Zyada se zyada 10 topics.");
        return;
      }
      const clean: string[] = [];
      for (const t of topicsRaw) {
        const s = String(t ?? "").trim();
        if (s.length < 1 || s.length > 200) {
          badRequest(res, "Har topic 1-200 characters ka hona chahiye.");
          return;
        }
        const guardReply = guardText(s);
        if (guardReply) {
          res.status(400).json({ error: "badRequest", message: guardReply });
          return;
        }
        clean.push(s);
      }
      topic = clean.join(", ");
      title = `Worksheet — ${clean.slice(0, 2).join(", ")}${clean.length > 2 ? ", ..." : ""} (Class ${cls})`;
    } else {
      badRequest(res, "chapterId ya topics me se ek chahiye.");
      return;
    }
    const items = await generateQuestionItems({
      topic,
      count,
      classLevel: cls,
      studentId: sid,
      ip: clientIp(req),
      maxTokens: Math.min(4000, 300 * count),
      outputEstimate: 120 * count,
    });
    res.status(200).json({
      ok: true,
      title,
      class: cls,
      questions: items.map((it, i) => ({
        n: i + 1,
        q: it.question,
        hint: it.explanation.slice(0, 200),
      })),
    });
  } catch (err) {
    if (err instanceof BudgetError) {
      res.status(429).json({ error: "budgetExceeded", message: err.message });
      return;
    }
    badRequest(res, err instanceof Error ? err.message : "Worksheet nahi ban payi.");
  }
});

// ---------- teacher stats (Round 3: aggregates only, k-anonymity) ----------
app.get("/api/teacher/stats", (req: Request, res: Response) => {
  const cls = validClassLevel(req.query.class);
  if (!cls) {
    badRequest(res, "class query param 6 se 10 ke beech hona chahiye.");
    return;
  }
  res.status(200).json(teacherStats(cls));
});

// ---------- nicknames (Round 3: anonymous identity) ----------
app.get("/api/nickname", (req: Request, res: Response) => {
  const sid = requireStudentId(req.query.studentId);
  if (!sid) {
    badRequest(res, "Valid studentId chahiye.");
    return;
  }
  const out = nickname.getNickname(sid);
  res.status(200).json({ ok: true, nickname: out.nickname, canChange: out.canChange });
});

app.post("/api/nickname", (req: Request, res: Response) => {
  const sid = requireStudentId(req.body?.studentId);
  if (!sid) {
    badRequest(res, "Valid studentId chahiye.");
    return;
  }
  const nn = typeof req.body?.nickname === "string" ? req.body.nickname.trim() : "";
  if (!nickname.isValidNickname(nn)) {
    badRequest(res, "Nickname 3-20 characters ka hona chahiye (Hindi/Roman akshar, number, - ya _).");
    return;
  }
  const guardReply = guardText(nn);
  if (guardReply) {
    res.status(400).json({ error: "badRequest", message: guardReply });
    return;
  }
  try {
    const out = nickname.setNickname(sid, nn);
    res.status(200).json({ ok: true, nickname: out.nickname });
  } catch (err) {
    badRequest(res, err instanceof Error ? err.message : "Nickname set nahi ho paya.");
  }
});

// ---------- daily challenge (Round 3) ----------
app.get("/api/challenge/today", async (req: Request, res: Response) => {
  const sid = requireStudentId(req.query.studentId);
  if (!sid) {
    badRequest(res, "Valid studentId chahiye.");
    return;
  }
  const cls = validClassLevel(req.query.class);
  if (!cls) {
    badRequest(res, "class query param 6 se 10 ke beech hona chahiye.");
    return;
  }
  try {
    const q = await challenge.ensureTodayQuestion(cls, clientIp(req));
    res.status(200).json({
      ok: true,
      date: istDayKey(),
      question: challenge.publicQuestion(q),
      alreadyAnswered: challenge.answeredToday(sid, cls),
    });
  } catch (err) {
    if (err instanceof BudgetError) {
      res.status(429).json({ error: "budgetExceeded", message: err.message });
      return;
    }
    console.error("challenge error:", err instanceof Error ? err.message : err);
    res.status(500).json({ error: "internal", message: "Challenge nahi mil paya." });
  }
});

app.post("/api/challenge/answer", async (req: Request, res: Response) => {
  try {
    const sid = requireStudentId(req.body?.studentId);
    if (!sid) {
      badRequest(res, "Valid studentId chahiye.");
      return;
    }
    const cls = validClassLevel(req.body?.class);
    if (!cls) {
      badRequest(res, "Class 6 se 10 ke beech honi chahiye.");
      return;
    }
    const questionId =
      typeof req.body?.questionId === "string" ? req.body.questionId.trim().slice(0, 100) : "";
    if (!questionId) {
      badRequest(res, "questionId chahiye.");
      return;
    }
    const answer = req.body?.answer;
    if (!Number.isInteger(answer) || answer < 0 || answer > 3) {
      badRequest(res, "answer 0 se 3 ke beech integer hona chahiye.");
      return;
    }
    const q = await challenge.ensureTodayQuestion(cls, clientIp(req));
    if (q.id !== questionId) {
      badRequest(res, "Ye sawal aaj ka challenge nahi hai.");
      return;
    }
    if (challenge.answeredToday(sid, cls)) {
      badRequest(res, "Aaj ka challenge tum pehle hi khel chuke ho. Kal phir aana!");
      return;
    }
    const correct = answer === q.answerIndex;
    challenge.recordAnswer(sid, cls, q.id, correct);
    const xp = mastery.awardChallengeXp(sid, correct);
    try {
      leaderboard.touch(sid);
    } catch {
      // leaderboard refresh must never fail the answer
    }
    res.status(200).json({ ok: true, correct, xpAwarded: xp.xpGained });
  } catch (err) {
    if (err instanceof BudgetError) {
      res.status(429).json({ error: "budgetExceeded", message: err.message });
      return;
    }
    console.error("challenge answer error:", err instanceof Error ? err.message : err);
    res.status(500).json({ error: "internal", message: "Jawab save nahi ho paya." });
  }
});

// ---------- leaderboard (Round 3: nicknames only, never ids) ----------
app.get("/api/leaderboard", (req: Request, res: Response) => {
  const cls = validClassLevel(req.query.class);
  if (!cls) {
    badRequest(res, "class query param 6 se 10 ke beech hona chahiye.");
    return;
  }
  res.status(200).json({
    ok: true,
    week: leaderboard.isoWeekLabel(),
    entries: leaderboard.topForClass(cls, 10),
  });
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
