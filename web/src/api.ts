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

export interface ProgressData {
  student: { name: string | null; classLevel: string | number | null };
  topics: ProgressTopic[];
  history: ProgressHistoryItem[];
  weakTopics: string[];
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
