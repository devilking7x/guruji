// Typed client for the Guruji backend API.
// API base = import.meta.env.VITE_API_URL + path (no trailing slash).

const API = ((import.meta.env.VITE_API_URL as string | undefined) ?? "").replace(
  /\/+$/,
  ""
);

export const apiBase = API;

/** Thrown when the demo budget is exhausted (HTTP 429 with error=budgetExceeded). */
export class BudgetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BudgetError";
  }
}

const STUDENT_KEY = "guruji-student-id";

/** Stable per-browser student id, generated once and persisted in localStorage. */
export function getStudentId(): string {
  try {
    const existing = localStorage.getItem(STUDENT_KEY);
    if (existing) return existing;
    const id = `student-${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    localStorage.setItem(STUDENT_KEY, id);
    return id;
  } catch {
    return "student-1";
  }
}

async function throwForStatus(res: Response): Promise<never> {
  let message = "Kuch galat ho gaya. Dobara try karo 🙏";
  try {
    const data = await res.json();
    if (data && typeof data.message === "string" && data.message) {
      message = data.message;
    } else if (data && typeof data.error === "string" && data.error) {
      message = data.error;
    }
  } catch {
    /* keep the default Hindi message */
  }
  throw new Error(message);
}

// ---------------------------------------------------------------- students

export interface StudentProfile {
  studentId: string;
  name: string;
  classLevel: string | number;
}

export async function postStudent(
  name: string,
  classLevel: string | number
): Promise<StudentProfile> {
  const res = await fetch(`${API}/api/student`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ studentId: getStudentId(), name, classLevel }),
  });
  if (!res.ok) await throwForStatus(res);
  const data = await res.json();
  return data.student as StudentProfile;
}

// ---------------------------------------------------------------- chat (SSE)

export interface ChatUsage {
  inputTokens: number;
  outputTokens: number;
}

/**
 * Streams a chat reply. Calls onToken for each `t: "tok"` event.
 * Resolves with token usage from the `t: "done"` event.
 * Throws BudgetError on 429 (budgetExceeded).
 */
export async function streamChat(
  body: { message: string; studentId?: string; mode?: "chat" | "revision" },
  onToken: (token: string) => void
): Promise<ChatUsage> {
  const res = await fetch(`${API}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (res.status === 429) {
    let message = "Demo budget khatm ho gaya hai. Thodi der baad dobara try karo 🙏";
    try {
      const data = await res.json();
      if (data && typeof data.message === "string" && data.message) {
        message = data.message;
      }
    } catch {
      /* keep default */
    }
    throw new BudgetError(message);
  }

  if (!res.ok) await throwForStatus(res);
  const bodyStream = res.body;
  if (!bodyStream) throw new Error("Jawab ka stream start nahi ho paya");

  const reader = bodyStream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let inputTokens = 0;
  let outputTokens = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let sep: number;
    while ((sep = buffer.indexOf("\n\n")) >= 0) {
      const chunk = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      for (const rawLine of chunk.split("\n")) {
        const line = rawLine.trim();
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload) continue;
        let evt: { t?: string; x?: unknown; message?: unknown } & Record<string, unknown>;
        try {
          evt = JSON.parse(payload);
        } catch {
          continue;
        }
        if (evt.t === "tok" && typeof evt.x === "string") {
          onToken(evt.x);
        } else if (evt.t === "done") {
          inputTokens = Number(evt.inputTokens ?? 0) || 0;
          outputTokens = Number(evt.outputTokens ?? 0) || 0;
        } else if (evt.t === "error") {
          throw new Error(
            typeof evt.message === "string" && evt.message
              ? evt.message
              : "Jawab aate-aate ruk gaya"
          );
        }
      }
    }
  }

  return { inputTokens, outputTokens };
}

// ---------------------------------------------------------------- quiz

export interface QuizQuestion {
  id: string;
  question: string;
  options: string[];
}

export interface QuizStart {
  quizId: string;
  topic: string;
  questions: QuizQuestion[];
}

export async function startQuiz(
  topic: string,
  count = 5,
  classLevel?: string | number
): Promise<QuizStart> {
  const res = await fetch(`${API}/api/quiz/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      topic,
      studentId: getStudentId(),
      count,
      ...(classLevel !== undefined ? { classLevel } : {}),
    }),
  });
  if (!res.ok) await throwForStatus(res);
  return (await res.json()) as QuizStart;
}

export interface QuizAnswer {
  questionId: string;
  selected: number;
}

export interface QuizResultEntry {
  questionId: string;
  correct: boolean;
  correctIndex: number;
  explanation: string;
}

export interface QuizSubmitResult {
  score: number;
  total: number;
  results: QuizResultEntry[];
  weakTopics: string[];
  message: string;
}

export async function submitQuiz(
  quizId: string,
  answers: QuizAnswer[]
): Promise<QuizSubmitResult> {
  const res = await fetch(`${API}/api/quiz/submit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ quizId, answers, studentId: getStudentId() }),
  });
  if (!res.ok) await throwForStatus(res);
  return (await res.json()) as QuizSubmitResult;
}

// ---------------------------------------------------------------- progress

export interface ProgressTopic {
  topic: string;
  quizzes: number;
  avgScore: number | null;
  lastAt: string | null;
}

export interface ProgressHistoryItem {
  at: string;
  topic: string;
  score: number;
  total: number;
}

/** New in Round 2: quiz history with plain `date` field (v1 `history` still works as fallback). */
export interface QuizHistoryItem {
  date: string;
  topic: string;
  score: number;
  total: number;
}

export interface ProgressData {
  student: { name: string | null; classLevel: string | number | null };
  topics: ProgressTopic[];
  history: ProgressHistoryItem[];
  weakTopics: string[];
  /** Round 2 fields — optional so the UI degrades gracefully if the backend is older. */
  mastery?: Record<string, number>;
  xp?: number;
  streak?: number;
  badges?: string[];
  quizHistory?: QuizHistoryItem[];
}

export async function getProgress(): Promise<ProgressData> {
  const res = await fetch(
    `${API}/api/progress?studentId=${encodeURIComponent(getStudentId())}`
  );
  if (!res.ok) await throwForStatus(res);
  return (await res.json()) as ProgressData;
}

// ---------------------------------------------------------------- memory

export interface MemoryItem {
  id: string;
  text: string;
  kind: string;
  createdAt: string;
  updatedAt: string;
  superseded: boolean;
}

export async function getMemory(): Promise<MemoryItem[]> {
  const res = await fetch(
    `${API}/api/memory?studentId=${encodeURIComponent(getStudentId())}`
  );
  if (!res.ok) await throwForStatus(res);
  const data = await res.json();
  return (data.memories ?? []) as MemoryItem[];
}

export async function deleteMemory(id: string): Promise<void> {
  const res = await fetch(
    `${API}/api/memory/${encodeURIComponent(id)}?studentId=${encodeURIComponent(
      getStudentId()
    )}`,
    { method: "DELETE" }
  );
  if (!res.ok) await throwForStatus(res);
}

// ---------------------------------------------------------------- copycheck (notebook photo)

export interface CopyCheckResult {
  ok: boolean;
  feedback: string;
}

/**
 * Sends a notebook photo for Hindi Socratic feedback.
 * Backend contract: POST /api/copycheck (multipart: photo, studentId, class, subject)
 * -> 200 { ok, feedback } | 400 { ok:false, error }.
 * The image is never persisted on the client (no localStorage of data URLs).
 */
export async function postCopyCheck(
  file: File,
  classLevel: string | number,
  subject: string
): Promise<CopyCheckResult> {
  const fd = new FormData();
  fd.append("photo", file);
  fd.append("studentId", getStudentId());
  fd.append("class", String(classLevel));
  fd.append("subject", subject);
  const res = await fetch(`${API}/api/copycheck`, { method: "POST", body: fd });
  if (!res.ok) await throwForStatus(res);
  const data = (await res.json()) as CopyCheckResult;
  if (!data.ok) {
    throw new Error("Feedback nahi mil paya. Dobara try karo 🙏");
  }
  return data;
}

// ---------------------------------------------------------------- chapters (static index)

export interface ChapterInfo {
  id: string;
  title: string;
  class: string;
  subject: string;
}

/**
 * Static chapter index derived from server/data/chapters/*.json.
 * Used as the reliable chapter picker list (the backend only exposes
 * /api/chapters/search with a query, no full index endpoint).
 */
export const CHAPTERS: ChapterInfo[] = [
  { id: "food-components", title: "Bhojan ke Ghatak", class: "6", subject: "Science" },
  { id: "fractions", title: "Bhinn", class: "6", subject: "Maths" },
  { id: "heat", title: "Ushma", class: "7", subject: "Science" },
  { id: "integers", title: "Purnank", class: "7", subject: "Maths" },
  { id: "photosynthesis", title: "Prakash Sanshleshan", class: "7", subject: "Science" },
  { id: "algebra", title: "Beejganit", class: "8", subject: "Maths" },
  { id: "cell", title: "Koshika", class: "8", subject: "Science" },
  { id: "geometry-basics", title: "Rekhaganit ke Aadhaar", class: "8", subject: "Maths" },
  { id: "light", title: "Prakash", class: "8", subject: "Science" },
  { id: "motion", title: "Gati", class: "9", subject: "Science" },
  { id: "polynomials", title: "Bahupad", class: "9", subject: "Maths" },
  { id: "acids-bases-salts", title: "Amal, Kshaar aur Lavan", class: "10", subject: "Science" },
  { id: "electricity", title: "Vidhyut", class: "10", subject: "Science" },
  { id: "quadratic", title: "Dvighaat Samikaran", class: "10", subject: "Maths" },
];

/** Free-text chapter search via the backend RAG-lite endpoint. */
export async function searchChapters(q: string): Promise<ChapterInfo[]> {
  const res = await fetch(
    `${API}/api/chapters/search?q=${encodeURIComponent(q)}`
  );
  if (!res.ok) await throwForStatus(res);
  const data = await res.json();
  return ((data.chapters ?? []) as Array<Partial<ChapterInfo>>).map((c) => ({
    id: String(c.id ?? ""),
    title: String(c.title ?? c.id ?? ""),
    class: String(c.class ?? ""),
    subject: String(c.subject ?? ""),
  }));
}

// ---------------------------------------------------------------- planner (study plan)

export interface PlannerTask {
  title: string;
  done: boolean;
}

export interface PlannerDay {
  day: number;
  label?: string;
  date?: string;
  tasks: PlannerTask[];
}

export interface StudyPlan {
  days: PlannerDay[];
  chapters?: string[];
  class?: string | number;
}

export async function createPlanner(body: {
  class: string | number;
  chapters: string[];
  days: number;
  minutesPerDay: number;
}): Promise<StudyPlan> {
  const res = await fetch(`${API}/api/planner`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ studentId: getStudentId(), ...body }),
  });
  if (!res.ok) await throwForStatus(res);
  const data = await res.json();
  return (data.plan ?? data) as StudyPlan;
}

export async function getPlanner(): Promise<StudyPlan | null> {
  const res = await fetch(
    `${API}/api/planner?studentId=${encodeURIComponent(getStudentId())}`
  );
  if (!res.ok) await throwForStatus(res);
  const data = await res.json();
  return (data.plan ?? null) as StudyPlan | null;
}

export async function togglePlannerTask(
  day: number,
  taskIndex: number,
  done: boolean
): Promise<void> {
  const res = await fetch(`${API}/api/planner`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ studentId: getStudentId(), day, taskIndex, done }),
  });
  if (!res.ok) await throwForStatus(res);
}

// ---------------------------------------------------------------- worksheet (printable)

export interface WorksheetQuestion {
  n: number;
  q: string;
  hint?: string;
}

export interface Worksheet {
  ok: boolean;
  title: string;
  class: string | number;
  questions: WorksheetQuestion[];
}

export async function generateWorksheet(body: {
  class?: string | number;
  chapterId?: string;
  topics?: string[];
  count: number;
}): Promise<Worksheet> {
  const res = await fetch(`${API}/api/worksheet`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ studentId: getStudentId(), ...body }),
  });
  if (!res.ok) await throwForStatus(res);
  const data = (await res.json()) as Worksheet;
  if (!data.ok) {
    throw new Error("Worksheet nahi ban payi. Dobara try karo 🙏");
  }
  return data;
}

// ---------------------------------------------------------------- teacher (class aggregates)

export interface TeacherStats {
  ok: boolean;
  reason?: string;
  class?: string | number;
  students?: number;
  avgMasteryByTopic?: Record<string, number>;
  weakestTopics?: string[];
  quizzesThisWeek?: number;
  streaksActive?: number;
}

/** Aggregates only — never personal data. Handles { ok:false, reason:"insufficient-data" }. */
export async function getTeacherStats(
  classLevel: string | number
): Promise<TeacherStats> {
  const res = await fetch(
    `${API}/api/teacher/stats?class=${encodeURIComponent(String(classLevel))}`
  );
  if (!res.ok) await throwForStatus(res);
  return (await res.json()) as TeacherStats;
}

// ---------------------------------------------------------------- nickname

export interface NicknameInfo {
  ok: boolean;
  nickname: string;
  canChange: boolean;
}

export async function getNickname(): Promise<NicknameInfo> {
  const res = await fetch(
    `${API}/api/nickname?studentId=${encodeURIComponent(getStudentId())}`
  );
  if (!res.ok) await throwForStatus(res);
  return (await res.json()) as NicknameInfo;
}

export async function setNickname(nickname: string): Promise<NicknameInfo> {
  const res = await fetch(`${API}/api/nickname`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ studentId: getStudentId(), nickname }),
  });
  if (!res.ok) await throwForStatus(res);
  return (await res.json()) as NicknameInfo;
}

// ---------------------------------------------------------------- challenge (daily)

export interface ChallengeQuestion {
  id: string;
  text: string;
  options: string[];
  topic: string;
}

export interface TodayChallenge {
  ok: boolean;
  date: string;
  question: ChallengeQuestion | null;
  alreadyAnswered: boolean;
  streak?: number;
}

export async function getTodayChallenge(
  classLevel?: string | number
): Promise<TodayChallenge> {
  const qs = new URLSearchParams({ studentId: getStudentId() });
  if (classLevel !== undefined && classLevel !== null && classLevel !== "") {
    qs.set("class", String(classLevel));
  }
  const res = await fetch(`${API}/api/challenge/today?${qs.toString()}`);
  if (!res.ok) await throwForStatus(res);
  return (await res.json()) as TodayChallenge;
}

export interface ChallengeAnswerResult {
  ok: boolean;
  correct: boolean;
  xpAwarded: number;
  message?: string;
  streak?: number;
}

export async function answerChallenge(
  questionId: string,
  answer: number,
  classLevel?: string | number
): Promise<ChallengeAnswerResult> {
  const res = await fetch(`${API}/api/challenge/answer`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      studentId: getStudentId(),
      questionId,
      answer,
      ...(classLevel !== undefined && classLevel !== null && classLevel !== ""
        ? { class: String(classLevel) }
        : {}),
    }),
  });
  if (!res.ok) await throwForStatus(res);
  return (await res.json()) as ChallengeAnswerResult;
}

export interface LeaderboardEntry {
  nickname: string;
  xp: number;
  streak: number;
}

export interface Leaderboard {
  ok: boolean;
  week: string;
  entries: LeaderboardEntry[];
}

export async function getLeaderboard(
  classLevel?: string | number
): Promise<Leaderboard> {
  const qs = new URLSearchParams();
  if (classLevel !== undefined && classLevel !== null && classLevel !== "") {
    qs.set("class", String(classLevel));
  }
  const res = await fetch(`${API}/api/leaderboard?${qs.toString()}`);
  if (!res.ok) await throwForStatus(res);
  return (await res.json()) as Leaderboard;
}

// ---------------------------------------------------------------- revision (FSRS flashcards)

export interface RevisionCard {
  id: string;
  front: string;
  back: string;
  topic: string;
}

/** Cards due for review today. Contract: 200 {"cards":[{"id","front","back","topic"}]} */
export async function getDueRevisionCards(): Promise<RevisionCard[]> {
  const res = await fetch(
    `${API}/api/revision/due?studentId=${encodeURIComponent(getStudentId())}`
  );
  if (!res.ok) await throwForStatus(res);
  const data = await res.json();
  return (data.cards ?? []) as RevisionCard[];
}

/** Grade a card: 1 = phir se, 3 = mushkil tha, 4 = aasaan tha. */
export async function gradeRevisionCard(
  cardId: string,
  rating: 1 | 3 | 4
): Promise<void> {
  const res = await fetch(`${API}/api/revision/grade`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ studentId: getStudentId(), cardId, rating }),
  });
  if (!res.ok) await throwForStatus(res);
}

/** Add new cards (e.g. built from wrong quiz answers). Returns count added. */
export async function addRevisionCards(
  cards: { front: string; back: string; topic: string }[]
): Promise<number> {
  const res = await fetch(`${API}/api/revision/cards`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ studentId: getStudentId(), cards }),
  });
  if (!res.ok) await throwForStatus(res);
  const data = await res.json();
  return Number(data.added ?? 0);
}
