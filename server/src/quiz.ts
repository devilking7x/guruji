import { randomUUID } from "node:crypto";
import { chatComplete, estimateTokens } from "./llm";
import * as memory from "./memory";
import * as mastery from "./mastery";
import { addCards } from "./srs";
import { trySpend, recordSpend } from "./budget";
import { BudgetError, BUDGET_HINDI_MSG } from "./agent";
import { touch as touchLeaderboard } from "./leaderboard";

export interface QuizQuestionPublic {
  id: string;
  question: string;
  options: string[];
}

export interface QuizItem extends QuizQuestionPublic {
  answerIndex: number;
  explanation: string;
}

interface ActiveQuiz {
  quizId: string;
  topic: string;
  studentId: string;
  items: QuizItem[];
  expiresAt: number;
}

const quizzes = new Map<string, ActiveQuiz>();
const QUIZ_TTL_MS = 30 * 60 * 1000;

// Sweep expired quizzes hourly.
setInterval(() => {
  const now = Date.now();
  for (const [k, q] of quizzes) {
    if (q.expiresAt < now) quizzes.delete(k);
  }
}, 60 * 60 * 1000).unref();

interface StartQuizOpts {
  topic: string;
  studentId: string;
  count?: number;
  classLevel?: string;
  ip: string;
}

interface StartQuizResult {
  quizId: string;
  topic: string;
  questions: QuizQuestionPublic[];
}

function devanagari(s: string): boolean {
  return /[\u0900-\u097f]/.test(s);
}

const QUIZ_PROMPT = (
  topic: string,
  count: number,
  classLevel: string,
  script: "roman" | "devanagari",
  difficulty: mastery.Difficulty
) =>
  `Generate ${count} multiple-choice questions in simple Hindi (${script === "devanagari" ? "Devanagari script" : "Roman Hindi script"}) on the topic "${topic}", for class ${classLevel}. ` +
  `Difficulty: ${difficulty} — the student's mastery on this topic is ${difficulty === "easy" ? "low, so ask basic concept-checking questions" : difficulty === "hard" ? "high, so ask tricky application-based questions" : "average, so ask standard questions"}. ` +
  `Keep technical English terms like "photosynthesis" in English. ` +
  `Return ONLY a JSON array (no code fences, no extra text) of objects: ` +
  `[{"question": "...", "options": ["a","b","c","d"], "answerIndex": 0, "explanation": "..."}]. ` +
  `Each question must have exactly 4 options and answerIndex 0-3.`;

interface GenerateQuestionOpts {
  topic: string;
  count: number;
  classLevel: string;
  studentId: string;
  ip: string;
  /** override the LLM max_tokens (worksheets ask for more questions) */
  maxTokens?: number;
  /** estimated output tokens for the budget pre-check */
  outputEstimate?: number;
}

/**
 * Shared question generator used by /api/quiz/start and /api/worksheet.
 * Budget-checked (429 on over-quota); falls back to the built-in bank for
 * known topics when the LLM fails. Returns items WITH answers — callers
 * that face the client must strip answerIndex.
 */
export async function generateQuestionItems(opts: GenerateQuestionOpts): Promise<QuizItem[]> {
  const topic = (opts.topic || "").trim();
  if (topic.length < 1 || topic.length > 500) {
    throw new Error("Topic 1 se 500 characters ke beech hona chahiye.");
  }
  const count = Math.min(20, Math.max(1, Math.floor(opts.count) || 5));
  const classLevel = (opts.classLevel || "8").trim().slice(0, 10);
  const studentId = memory.sanitizeStudentId(opts.studentId || "anonymous");
  const ip = opts.ip || "unknown";

  const pre = trySpend(ip, estimateTokens(topic) + 500, opts.outputEstimate ?? 0);
  if (!pre.ok) throw new BudgetError(BUDGET_HINDI_MSG);

  // Adaptive difficulty from the student's per-topic mastery.
  const difficulty = mastery.difficultyFor(studentId, topic);

  let items: QuizItem[];
  let inputTokens = 0;
  let outputTokens = 0;
  try {
    const res = await chatComplete({
      messages: [
        {
          role: "system",
          content:
            "Tum ek Hindi tutor ho. Sirf JSON array output karo, koi extra text nahi.",
        },
        {
          role: "user",
          content: QUIZ_PROMPT(topic, count, classLevel, devanagari(topic) ? "devanagari" : "roman", difficulty),
        },
      ],
      maxTokens: opts.maxTokens ?? 2000,
      jsonMode: true,
    });
    inputTokens = res.inputTokens;
    outputTokens = res.outputTokens;
    items = parseQuizItems(res.content, count);
    recordSpend(ip, inputTokens, outputTokens);
  } catch (err) {
    if (err instanceof BudgetError) throw err;
    // Fallback to built-in bank for known topics (repeated to fill count).
    const bank = fallbackBank(topic);
    if (!bank) throw err;
    items = [];
    while (items.length < count) items.push(...bank);
    items = items.slice(0, count);
  }
  return items;
}

export async function startQuiz(opts: StartQuizOpts): Promise<StartQuizResult> {
  const topic = (opts.topic || "").trim();
  if (topic.length < 1 || topic.length > 200) {
    throw new Error("Topic 1 se 200 characters ke beech hona chahiye.");
  }
  const count =
    typeof opts.count === "number" && opts.count >= 3 && opts.count <= 10
      ? Math.floor(opts.count)
      : 5;
  const classLevel = (opts.classLevel || "8").trim().slice(0, 10);
  const studentId = memory.sanitizeStudentId(opts.studentId || "anonymous");
  const ip = opts.ip || "unknown";

  const items = await generateQuestionItems({
    topic,
    count,
    classLevel,
    studentId,
    ip,
  });

  const quizId = randomUUID();
  const withIds = items.map((it) => ({ ...it, id: randomUUID() }));
  quizzes.set(quizId, {
    quizId,
    topic,
    studentId,
    items: withIds,
    expiresAt: Date.now() + QUIZ_TTL_MS,
  });

  return {
    quizId,
    topic,
    questions: withIds.map((it) => ({
      id: it.id,
      question: it.question,
      options: it.options,
    })),
  };
}

interface SubmitQuizOpts {
  quizId: string;
  answers: Array<{ questionId: string; selected: number }>;
  studentId: string;
}

interface SubmitQuizResult {
  score: number;
  total: number;
  results: Array<{
    questionId: string;
    correct: boolean;
    correctIndex: number;
    explanation: string;
  }>;
  weakTopics: string[];
  message: string;
  // Round 2 additions (v1 fields above are unchanged).
  xpGained: number;
  xp: number;
  streak: number;
  mastery: number;
  badges: string[];
}

export async function submitQuiz(opts: SubmitQuizOpts): Promise<SubmitQuizResult> {
  const quiz = quizzes.get(opts.quizId);
  if (!quiz || quiz.expiresAt < Date.now()) {
    quizzes.delete(opts.quizId);
    throw new QuizNotFoundError("Quiz nahi mila ya expire ho gaya hai. Naya quiz shuru karo.");
  }
  const studentId = memory.sanitizeStudentId(opts.studentId || "anonymous");
  const byId = new Map(quiz.items.map((it) => [it.id, it]));
  const selectedById = new Map(
    (opts.answers || []).map((a) => [a.questionId, a.selected])
  );

  const results = quiz.items.map((it) => {
    const sel = selectedById.get(it.id);
    const correct = sel === it.answerIndex;
    return {
      questionId: it.id,
      correct,
      correctIndex: it.answerIndex,
      explanation: it.explanation,
    };
  });
  const score = results.filter((r) => r.correct).length;
  const total = results.length;
  const pct = total > 0 ? (score / total) * 100 : 0;

  // Remember the result.
  memory.add(
    studentId,
    JSON.stringify({ topic: quiz.topic, score, total, at: new Date().toISOString() }),
    "quiz_result"
  );

  // Weak-topic tracking when below 60%.
  const weakTopics: string[] = [];
  if (pct < 60) {
    const existing = memory
      .list(studentId)
      .filter((r) => r.kind === "weak_topic" && !r.superseded)
      .map((r) => r.text.toLowerCase());
    if (!existing.some((t) => t.includes(quiz.topic.toLowerCase()))) {
      memory.add(studentId, quiz.topic, "weak_topic");
    }
    weakTopics.push(quiz.topic);
  }
  // One-shot quiz: remove it after submission.
  quizzes.delete(opts.quizId);

  // Round 2: mastery/XP/streak update (server-side).
  const correctFlags = results.map((r) => r.correct);
  const mres = mastery.recordQuiz(studentId, quiz.topic, correctFlags);

  // Round 3: refresh the class leaderboard after every XP award.
  try {
    touchLeaderboard(studentId);
  } catch {
    // leaderboard refresh must never fail the quiz submit
  }

  // Round 2: FSRS hook — auto-create a revision card for each wrong answer.
  const wrongItems = quiz.items.filter((_, i) => !correctFlags[i]);
  if (wrongItems.length > 0) {
    try {
      addCards(
        studentId,
        wrongItems.map((it) => ({
          front: it.question,
          back: `Sahi jawab: ${it.options[it.answerIndex]}. ${it.explanation}`,
          topic: quiz.topic,
        }))
      );
    } catch {
      // revision-card creation must never fail the quiz submit
    }
  }

  const message =
    pct >= 80
      ? "Bahut badhiya! Tumne kamaal kar diya. Aise hi aage badho! 🎉"
      : pct >= 60
        ? "Achha prayas! Thodi aur practice karo, tum aur behtar kar sakte ho. 💪"
        : "Koi baat nahi, galtiyon se hi seekhte hain. Revision mode me is topic ko phir se padhte hain. 📚";

  return {
    score,
    total,
    results,
    weakTopics,
    message,
    xpGained: mres.xpGained,
    xp: mres.xp,
    streak: mres.streak,
    mastery: mres.mastery,
    badges: mres.badges,
  };
}

export class QuizNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QuizNotFoundError";
  }
}

/** Defensive parse of the LLM quiz JSON. */
function parseQuizItems(raw: string, count: number): QuizItem[] {
  const cleaned = stripCodeFences(raw).trim();
  const parsed = JSON.parse(cleaned) as unknown;
  if (!Array.isArray(parsed)) throw new Error("Quiz JSON array nahi hai.");
  const items: QuizItem[] = [];
  for (const row of parsed.slice(0, count)) {
    if (typeof row !== "object" || row === null) continue;
    const r = row as Record<string, unknown>;
    const question = String(r.question || "").trim();
    const options = Array.isArray(r.options)
      ? r.options.map((o) => String(o)).slice(0, 4)
      : [];
    const answerIndex = Number(r.answerIndex);
    const explanation = String(r.explanation || "").trim();
    if (!question || options.length !== 4) continue;
    if (!Number.isInteger(answerIndex) || answerIndex < 0 || answerIndex > 3) continue;
    items.push({
      id: "",
      question,
      options,
      answerIndex,
      explanation: explanation || "Sahi jawab upar diya gaya hai.",
    });
  }
  if (items.length < 2) throw new Error("Quiz questions parse nahi ho paye.");
  return items;
}

function stripCodeFences(s: string): string {
  return s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
}

/** Built-in 5-question banks for known topics (fallback when LLM fails). */
function fallbackBank(topic: string): QuizItem[] | null {
  const t = topic.toLowerCase();
  if (t.includes("fraction") || t.includes("भिन्न")) return fractionBank();
  if (t.includes("photosynthesis") || t.includes("प्रकाश संश्लेषण")) return photosynthesisBank();
  return null;
}

function fractionBank(): QuizItem[] {
  return [
    {
      id: "",
      question: "1/2 + 1/4 kitna hota hai?",
      options: ["1/6", "2/6", "3/4", "1/3"],
      answerIndex: 2,
      explanation: "1/2 = 2/4, to 2/4 + 1/4 = 3/4.",
    },
    {
      id: "",
      question: "2/3 ka sabse simple form kya hai?",
      options: ["4/6", "2/3", "6/9", "8/12"],
      answerIndex: 1,
      explanation: "2/3 pehle se hi simplest form me hai.",
    },
    {
      id: "",
      question: "3/4 me se 1/4 ghatao, jawab kya hoga?",
      options: ["2/4", "1/2", "dono sahi", "4/8"],
      answerIndex: 2,
      explanation: "3/4 - 1/4 = 2/4, aur 2/4 = 1/2.",
    },
    {
      id: "",
      question: "Kaun sa fraction sabse bada hai?",
      options: ["1/5", "1/4", "1/3", "1/6"],
      answerIndex: 2,
      explanation: "Numerator same ho to chhota denominator bada fraction deta hai.",
    },
    {
      id: "",
      question: "1/2 ko decimal me likho.",
      options: ["0.2", "0.25", "0.5", "1.2"],
      answerIndex: 2,
      explanation: "1 ÷ 2 = 0.5.",
    },
  ];
}

function photosynthesisBank(): QuizItem[] {
  return [
    {
      id: "",
      question: "Photosynthesis me paudhe energy kahan se lete hain?",
      options: ["Mitti se", "Paani se", "Sunlight se", "Hawa se"],
      answerIndex: 2,
      explanation: "Chlorophyll sunlight ki energy pakadta hai.",
    },
    {
      id: "",
      question: "Photosynthesis ke liye kaun si gas zaroori hai?",
      options: ["Oxygen", "Nitrogen", "Carbon dioxide", "Hydrogen"],
      answerIndex: 2,
      explanation: "Paudhe hawa se carbon dioxide lete hain.",
    },
    {
      id: "",
      question: "Photosynthesis me paudhe kya banate hain?",
      options: ["Protein", "Glucose (khana)", "Vitamin", "Namak"],
      answerIndex: 1,
      explanation: "Glucose paudhe ka khana hai.",
    },
    {
      id: "",
      question: "Photosynthesis me kaun sa hissa sabse zyada kaam karta hai?",
      options: ["Jad (root)", "Patte (leaves)", "Tana (stem)", "Phool"],
      answerIndex: 1,
      explanation: "Patton me chlorophyll hota hai jo sunlight pakadta hai.",
    },
    {
      id: "",
      question: "Photosynthesis ke baad kaun si gas bahar nikalti hai?",
      options: ["Carbon dioxide", "Oxygen", "Nitrogen", "Helium"],
      answerIndex: 1,
      explanation: "Photosynthesis me oxygen by-product ke roop me nikalti hai.",
    },
  ];
}
