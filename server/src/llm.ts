/**
 * OpenAI-compatible chat client (Nebius Token Factory by default).
 * When LLM_MOCK=1 everything is canned — zero network.
 */

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_call_id?: string;
  name?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
}

export interface ToolDef {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ChatResult {
  content: string;
  toolCalls?: ToolCall[];
  inputTokens: number;
  outputTokens: number;
}

const BASE_URL = (process.env.LLM_BASE_URL || "https://api.tokenfactory.nebius.com/v1").replace(/\/+$/, "");
const API_KEY = process.env.LLM_API_KEY || "";
const MODEL = process.env.LLM_MODEL || "meta-llama/Llama-3.3-70B-Instruct";

const MOCK = () => process.env.LLM_MOCK === "1";

/** Rough token estimate: ~4 chars per token. */
export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil((text || "").length / 4));
}

function headers(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    ...(API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {}),
  };
}

function isMock(): boolean {
  return MOCK();
}

interface ChatCompleteOpts {
  messages: ChatMessage[];
  tools?: ToolDef[];
  maxTokens?: number;
  jsonMode?: boolean;
}

function mockReply(messages: ChatMessage[], opts: ChatCompleteOpts): ChatResult {
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const q = (lastUser?.content || "").slice(0, 120);
  let content: string;
  if (opts.jsonMode) {
    // Honor the requested question count so mock demos behave like the real LLM.
    const m = (lastUser?.content || "").match(/Generate (\d+) multiple-choice/);
    const want = Math.min(10, Math.max(1, m ? parseInt(m[1], 10) : 2));
    const bank = [
      {
        question: "1/2 + 1/4 kitna hota hai?",
        options: ["1/2", "3/4", "1/6", "2/6"],
        answerIndex: 1,
        explanation: "1/2 = 2/4, to 2/4 + 1/4 = 3/4.",
      },
      {
        question: "Paudhe khana kaise banate hain?",
        options: ["Saanse lena", "Photosynthesis", "Paani peena", "Mitti khana"],
        answerIndex: 1,
        explanation: "Photosynthesis me paudhe sunlight se khana banate hain.",
      },
      {
        question: "3/5 ka simplest form kya hai?",
        options: ["3/5", "6/10", "1/2", "3/10"],
        answerIndex: 0,
        explanation: "3 aur 5 me koi common factor nahi, to 3/5 hi simplest hai.",
      },
      {
        question: "Photosynthesis ke liye kya zaroori NAHI hai?",
        options: ["Sunlight", "Paani", "Oxygen", "Carbon dioxide"],
        answerIndex: 2,
        explanation: "Oxygen photosynthesis ka product hai, input nahi.",
      },
      {
        question: "2/3 + 1/6 kitna hota hai?",
        options: ["3/9", "5/6", "1/2", "3/6"],
        answerIndex: 1,
        explanation: "2/3 = 4/6, to 4/6 + 1/6 = 5/6.",
      },
      {
        question: "Paudhon me khana banane wala hissa kaunsa hai?",
        options: ["Jad", "Tana", "Patti", "Phool"],
        answerIndex: 2,
        explanation: "Pattiyon me chlorophyll hota hai jo photosynthesis karta hai.",
      },
    ];
    const items = [];
    for (let i = 0; i < want; i++) items.push(bank[i % bank.length]);
    content = JSON.stringify(items);
  } else {
    content =
      "Namaste! Main Guruji hoon, aapka Hindi tutor. " +
      (q ? `Aapne poocha: "${q}". ` : "") +
      "Main Maths aur Science (Class 6-10) padhata hoon. Pehle batao, aaj kya padhna hai?";
  }
  return {
    content,
    inputTokens: estimateTokens(JSON.stringify(messages)),
    outputTokens: estimateTokens(content),
  };
}

export async function chatComplete(opts: ChatCompleteOpts): Promise<ChatResult> {
  if (isMock()) return mockReply(opts.messages, opts);

  const body: Record<string, unknown> = {
    model: MODEL,
    messages: opts.messages.map((m) => ({
      role: m.role,
      content: m.content,
      ...(m.tool_call_id ? { tool_call_id: m.tool_call_id } : {}),
      ...(m.name ? { name: m.name } : {}),
      ...(m.tool_calls ? { tool_calls: m.tool_calls } : {}),
    })),
    ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}),
    ...(opts.jsonMode ? { response_format: { type: "json_object" } } : {}),
    ...(opts.tools ? { tools: opts.tools, tool_choice: "auto" } : {}),
  };

  let lastErr: Error | null = null;
  const delays = [500, 1000, 2000]; // exponential backoff, up to 3 retries
  for (let attempt = 0; attempt <= 3; attempt++) {
    try {
      const res = await fetch(`${BASE_URL}/chat/completions`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(90000),
      });
      if (res.status === 429 || res.status >= 500) {
        if (attempt < 3) {
          await sleep(delays[attempt]);
          continue;
        }
        throw new Error(`LLM upstream ${res.status}`);
      }
      if (!res.ok) throw new Error(`LLM upstream ${res.status}`);
      const data = (await res.json()) as {
        choices?: Array<{
          message?: {
            content?: string | null;
            tool_calls?: Array<{
              id: string;
              function: { name: string; arguments: string };
            }>;
          };
        }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      const msg = data.choices?.[0]?.message;
      const toolCalls: ToolCall[] | undefined = msg?.tool_calls?.map((tc) => ({
        id: tc.id,
        name: tc.function.name,
        arguments: safeParseArgs(tc.function.arguments),
      }));
      const content = msg?.content ?? "";
      return {
        content,
        toolCalls: toolCalls && toolCalls.length > 0 ? toolCalls : undefined,
        inputTokens: data.usage?.prompt_tokens ?? estimateTokens(JSON.stringify(body)),
        outputTokens: data.usage?.completion_tokens ?? estimateTokens(content),
      };
    } catch (err) {
      lastErr = err as Error;
      if (attempt < 3 && isRetryable(err)) {
        await sleep(delays[attempt]);
        continue;
      }
      throw lastErr;
    }
  }
  throw lastErr ?? new Error("LLM request failed");
}

interface ChatStreamOpts {
  messages: ChatMessage[];
  onToken: (chunk: string) => void;
  maxTokens?: number;
}

const MOCK_STREAM_REPLY =
  "Namaste! Main Guruji hoon. Aaj kya padhna hai — Maths ya Science?";

export async function chatStream(
  opts: ChatStreamOpts
): Promise<{ inputTokens: number; outputTokens: number }> {
  if (isMock()) {
    // Emit the canned reply in a few chunks, then stop.
    for (const chunk of chunkString(MOCK_STREAM_REPLY, 12)) {
      opts.onToken(chunk);
    }
    return {
      inputTokens: estimateTokens(JSON.stringify(opts.messages)),
      outputTokens: estimateTokens(MOCK_STREAM_REPLY),
    };
  }

  let full = "";
  const body = {
    model: MODEL,
    messages: opts.messages.map((m) => ({ role: m.role, content: m.content })),
    stream: true,
    ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}),
  };

  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(90000),
  });
  if (!res.ok || !res.body) throw new Error(`LLM stream upstream ${res.status}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === "[DONE]") continue;
        try {
          const json = JSON.parse(payload) as {
            choices?: Array<{ delta?: { content?: string } }>;
          };
          const delta = json.choices?.[0]?.delta?.content;
          if (delta) {
            full += delta;
            opts.onToken(delta);
          }
        } catch {
          // ignore malformed SSE lines
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
  return {
    inputTokens: estimateTokens(JSON.stringify(body)),
    outputTokens: Math.max(1, estimateTokens(full)),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function isRetryable(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /429|5\d\d|timeout|network|fetch/i.test(msg);
}

function safeParseArgs(raw: string): Record<string, unknown> {
  try {
    const v = JSON.parse(raw);
    return typeof v === "object" && v !== null ? v : {};
  } catch {
    return {};
  }
}

function chunkString(s: string, n: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < s.length; i += n) out.push(s.slice(i, i + n));
  return out;
}
