import {
  chatComplete,
  chatStream,
  estimateTokens,
  ChatMessage,
  ToolDef,
} from "./llm";
import * as memory from "./memory";
import { trySpend, recordSpend } from "./budget";

export class BudgetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BudgetError";
  }
}

export const BUDGET_HINDI_MSG =
  "Aaj ka free demo limit khatm ho gaya hai. Kal phir se try karo! 🙏";

interface RunChatOpts {
  message: string;
  studentId: string;
  mode: "chat" | "revision";
  ip: string;
  onToken: (chunk: string) => void;
}

interface RunChatResult {
  inputTokens: number;
  outputTokens: number;
}

const TOOLS: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "memory_search",
      description: "Search the student's memory for facts, past quiz results, or weak topics.",
      parameters: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "memory_add",
      description: "Save a durable fact about the student (name, class, weak topic, interest).",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string" },
          kind: { type: "string", enum: ["fact"] },
        },
        required: ["text"],
      },
    },
  },
];

function containsDevanagari(s: string): boolean {
  return /[\u0900-\u097f]/.test(s);
}

function buildSystemPrompt(
  profileText: string,
  memoryHits: memory.MemoryRecord[],
  mode: "chat" | "revision"
): string {
  const memBlock =
    memoryHits.length > 0
      ? "Student ke baare me yaad rakhi hui baatein:\n" +
        memoryHits.map((r) => `- (${r.kind}) ${r.text}`).join("\n")
      : "Student ke baare me abhi kuch yaad nahi hai.";
  const modeBlock =
    mode === "revision"
      ? "REVISION MODE: weak topics dohraao, chhote sawal poocho, aur galtiyon par gently guide karo."
      : "CHAT MODE: student ke sawal ka seedha, simple jawab do.";
  return [
    "Tum Guruji ho — Classes 6-10 ke Maths aur Science ke patient, encouraging Hindi tutor.",
    modeBlock,
    "",
    "Rules:",
    "- SIMPLE Hindi me jawab do. Student Roman Hindi me likhe to tum bhi Roman Hindi me likho; Devanagari me likhe to Devanagari me likho.",
    "- Technical English shabd (jaise photosynthesis, fraction, gravity) English me hi rakho.",
    "- Socratic style: seedha homework ka poora answer mat do — hints aur chhote sawalon se student ko khud sochne me madad karo.",
    "- Rozmarra ki life se examples do. Jawaab short aur clear rakho.",
    "- Har jawab ke ant me, jab natural lage, ek chhota check-sawal poocho taaki samajh confirm ho.",
    "- Agar student quiz maange to batao ki quiz mode me jaakar quiz shuru kar sakta hai.",
    "",
    memBlock,
    profileText ? `\nStudent profile: ${profileText}` : "",
  ].join("\n");
}

function profileTextFor(studentId: string): string {
  const prof = memory
    .list(studentId)
    .filter((r) => r.kind === "profile" && !r.superseded);
  return prof.map((r) => r.text).join(" ");
}

export async function runChat(opts: RunChatOpts): Promise<RunChatResult> {
  const message = (opts.message || "").trim();
  if (message.length < 1 || message.length > 2000) {
    throw new Error("Message 1 se 2000 characters ke beech hona chahiye.");
  }
  const studentId = memory.sanitizeStudentId(opts.studentId || "anonymous");
  const ip = opts.ip || "unknown";

  // Budget pre-check on the estimated incoming cost.
  const pre = trySpend(ip, estimateTokens(message) + 500, 0);
  if (!pre.ok) throw new BudgetError(BUDGET_HINDI_MSG);

  const profile = profileTextFor(studentId);
  const hits = memory.search(studentId, message);
  const system = buildSystemPrompt(profile, hits, opts.mode);
  const inDevanagari = containsDevanagari(message);
  const scriptNote = inDevanagari
    ? "Student Devanagari me likh raha hai — tum bhi Devanagari me jawab do."
    : "Student Roman Hindi me likh raha hai — tum bhi Roman Hindi me jawab do.";

  const messages: ChatMessage[] = [
    { role: "system", content: system + "\n" + scriptNote },
    { role: "user", content: message },
  ];

  // Tool loop (max 3 iterations).
  let inputTokens = 0;
  let outputTokens = 0;
  for (let i = 0; i < 3; i++) {
    const res = await chatComplete({ messages, tools: TOOLS, maxTokens: 1024 });
    inputTokens += res.inputTokens;
    outputTokens += res.outputTokens;
    if (!res.toolCalls || res.toolCalls.length === 0) {
      messages.push({ role: "assistant", content: res.content });
      break;
    }
    messages.push({
      role: "assistant",
      content: res.content || "",
      tool_calls: res.toolCalls.map((tc) => ({
        id: tc.id,
        type: "function" as const,
        function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
      })),
    });
    for (const tc of res.toolCalls) {
      const args = tc.arguments;
      let result: string;
      try {
        if (tc.name === "memory_search") {
          const q = String(args.query || "");
          const found = memory.search(studentId, q);
          result =
            found.length > 0
              ? found.map((r) => `- (${r.kind}) ${r.text}`).join("\n")
              : "Koi yaad nahi mili.";
        } else if (tc.name === "memory_add") {
          const text = String(args.text || "").slice(0, 500);
          if (!text) {
            result = "Khaali text save nahi hua.";
          } else {
            memory.add(studentId, text, "fact");
            result = "Yaad kar liya.";
          }
        } else {
          result = "Unknown tool.";
        }
      } catch (e) {
        result = `Tool error: ${(e as Error).message}`;
      }
      messages.push({
        role: "tool",
        content: result,
        tool_call_id: tc.id,
        name: tc.name,
      });
    }
  }

  // Stream the final answer to the client.
  let streamed = "";
  const streamRes = await chatStream({
    messages,
    onToken: (chunk) => {
      streamed += chunk;
      opts.onToken(chunk);
    },
    maxTokens: 1024,
  });
  inputTokens += streamRes.inputTokens;
  outputTokens += streamRes.outputTokens;

  recordSpend(ip, inputTokens, outputTokens);

  // Fire-and-forget auto-memory: extract durable facts from this exchange.
  const auto = process.env.GURUJI_AUTO_REMEMBER;
  if (!streamed || process.env.LLM_MOCK === "1" || auto === "0") return { inputTokens, outputTokens };
  autoRemember(studentId, message, streamed).catch(() => {
    // never break the response
  });
  return { inputTokens, outputTokens };
}

async function autoRemember(
  studentId: string,
  userMsg: string,
  assistantMsg: string
): Promise<void> {
  const res = await chatComplete({
    messages: [
      {
        role: "system",
        content:
          "Extract DURABLE facts about the student from this tutor conversation. " +
          "Return ONLY a JSON array of short fact strings (max 3). " +
          "Examples: student name, class level, weak topics, interests. " +
          "If nothing durable, return [].",
      },
      {
        role: "user",
        content: `Student: ${userMsg.slice(0, 800)}\nGuruji: ${assistantMsg.slice(0, 800)}`,
      },
    ],
    maxTokens: 200,
    jsonMode: true,
  });
  try {
    const arr = JSON.parse(res.content) as unknown;
    if (Array.isArray(arr)) {
      for (const item of arr.slice(0, 3)) {
        if (typeof item === "string" && item.trim().length > 2) {
          memory.add(studentId, item.trim().slice(0, 300), "fact");
        }
      }
    }
  } catch {
    // ignore malformed extraction
  }
}
