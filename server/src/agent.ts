import {
  chatComplete,
  chatStream,
  estimateTokens,
  ChatMessage,
  ToolDef,
} from "./llm";
import * as memory from "./memory";
import { trySpend, recordSpend } from "./budget";
import { searchChapters, citationFor, ChapterHit } from "./chapters";

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

function tokenizeWords(s: string): string[] {
  return (s || "")
    .toLowerCase()
    .split(/[^a-z0-9\u0900-\u097f\u0980-\u09ff]+/u)
    .map((t) => t.trim())
    .filter((t) => t.length > 2);
}

// Clearly off-syllabus domains (Class 6-10 Maths/Science ke bahar).
const OFF_SYLLABUS_WORDS = new Set([
  "cricket", "football", "hockey", "ipl", "kabbadi",
  "bollywood", "film", "movie", "actor", "actress",
  "gaana", "song", "music", "singer", "dance",
  "politics", "sarkar", "election", "chunav", "neta", "minister", "bjp", "congress",
  "game", "pubg", "freefire", "gaming", "tiktok", "instagram", "reel",
  "shayari", "joke", "kahani", "story", "poem", "kavita",
  "dharam", "religion", "mandir", "masjid",
  "business", "job", "naukri", "salary",
  "love", "shaadi", "marriage",
  "crush", "girlfriend", "boyfriend", "dating", "valentine",
  "sharab", "alcohol", "cigarette", "smoking", "drugs", "nasha",
  "murder", "jua", "gambling", "lottery",
  "porn", "sexy", "nude",
  "क्रिकेट", "बॉलीवुड", "फिल्म", "गाना", "राजनीति", "सरकार", "चुनाव", "खेल", "कहानी", "कविता",
  "शराब", "सिगरेट", "ड्रग्स", "नशा", "डेटिंग", "वैलेंटाइन", "मर्डर", "जुआ", "क्रश", "पोर्न",
]);

/** Deterministic check: does the question belong to a clearly off-syllabus domain? */
export function isOutOfSyllabus(message: string): boolean {
  const words = new Set(tokenizeWords(message));
  for (const w of words) {
    if (OFF_SYLLABUS_WORDS.has(w)) return true;
  }
  return false;
}

export function outOfSyllabusReply(devanagari: boolean, lang?: memory.StudentLang): string {
  if (lang === "mr") {
    return "हा प्रश्न आपल्या अभ्यासक्रमाबाहेर (Class 6-10 Maths/Science) आहे 🙂. पण मी Maths किंवा Science मध्ये तुमची पूर्ण मदत करू शकतो — जसे अपूर्णांक, प्रकाशसंश्लेषण, किंवा प्रकाश. काय शिकायचं?";
  }
  return devanagari
    ? "यह सवाल हमारे सिलेबस (Class 6-10 Maths/Science) के बाहर है 🙂। लेकिन मैं तुम्हारी Maths या Science में पूरी मदद कर सकता हूँ — जैसे भिन्न, प्रकाश संश्लेषण, या प्रकाश। क्या पढ़ना चाहोगे?"
    : "Ye sawal humare syllabus (Class 6-10 Maths/Science) ke bahar hai 🙂. Lekin main tumhari Maths ya Science me poori madad kar sakta hoon — jaise fractions, photosynthesis, ya light. Kya padhna chahte ho?";
}

interface LadderInfo {
  level: 1 | 2 | 3;
  snippet: string;
}

/** Hint-ladder level across turns: same question asked again → escalate (cap 3). */
function ladderLevelFor(studentId: string, message: string): LadderInfo {
  const snippet = message.slice(0, 120);
  const prev = memory
    .list(studentId)
    .find((r) => r.kind === "hint_ladder" && !r.superseded);
  if (prev) {
    try {
      const d = JSON.parse(prev.text) as { level?: number; snippet?: string };
      const prevWords = new Set(tokenizeWords(d.snippet || ""));
      const curWords = new Set(tokenizeWords(message));
      let overlap = 0;
      for (const w of curWords) if (prevWords.has(w)) overlap += 1;
      if (overlap >= 2) {
        const lvl = Math.min(3, Math.max(1, (d.level || 1) + 1));
        return { level: lvl as 1 | 2 | 3, snippet };
      }
    } catch {
      // fall through to level 1
    }
  }
  return { level: 1, snippet };
}

function saveLadderLevel(studentId: string, info: LadderInfo): void {
  // Supersede old ladder records (empty textIncludes matches all).
  memory.markSupersededIfExists(studentId, "hint_ladder", "");
  memory.add(
    studentId,
    JSON.stringify({ level: info.level, snippet: info.snippet, at: new Date().toISOString() }),
    "hint_ladder"
  );
}

const LADDER_GUIDANCE: Record<1 | 2 | 3, string> = {
  1: "Level 1 (nudge): sirf ek chhota ishara do + EK guiding question poocho. Koi step solve karke mat dikhao.",
  2: "Level 2 (partial step): aadha kadam dikhao (ek chhota hissa), phir student se aage ka step poocho. Poora hal kabhi mat do.",
  3: "Level 3 (worked sub-step): ek chhota hissa solve karke dikhao taaki pattern samajh aaye, lekin AAKHRI JAWAB phir bhi student khud nikaale. Final answer dena MANA hai.",
};

function buildSystemPrompt(
  profileText: string,
  memoryHits: memory.MemoryRecord[],
  mode: "chat" | "revision",
  chapters: ChapterHit[],
  ladder: LadderInfo,
  offSyllabus: boolean,
  lang: memory.StudentLang
): string {
  const memBlock =
    memoryHits.length > 0
      ? "Student ke baare me yaad rakhi hui baatein:\n" +
        memoryHits.map((r) => `- (${r.kind}) ${r.text}`).join("\n")
      : "Student ke baare me abhi kuch yaad nahi hai.";
  const modeBlock =
    mode === "revision"
      ? "REVISION MODE: weak topics dohraao, chhote sawal poocho, aur galtiyon par gently guide karo."
      : "CHAT MODE: student ke sawal ka Socratic style me jawab do.";

  const chapterBlock =
    chapters.length > 0
      ? "REFERENCE NOTES (inme se padhao, inke bahar mat jao):\n" +
        chapters
          .map(
            (h) =>
              `${citationFor(h.chapter)}\n` +
              h.chapter.keyPoints.map((p) => `- ${p}`).join("\n")
          )
          .join("\n\n") +
        "\nJab in notes se jawab do to citation zaroor lagao, jaise [Class 8 Science · Adhyay: Prakash]."
      : "";

  const offSyllabusBlock = offSyllabus
    ? "DHYAAN: student ka sawal humare syllabus (Class 6-10 Maths/Science) ke bahar lag raha hai. " +
      "Politely Hindi me batao: 'Ye sawal humare syllabus ke bahar hai, lekin main <najdeeki topic> me tumhari madad kar sakta hoon!' " +
      "Najdeeki topic ke liye upar diye gaye chapters me se chuno."
    : "";

  // Language preference: Marathi tutors keep ALL Socratic rules + guardrails
  // identical — only the reply language changes (TTS/voice locale is the
  // frontend's job).
  const langBlock =
    lang === "mr"
      ? "BHASHA: student ne MARATHI chuni hai — jawab hamesha SIMPLE MARATHI (मराठी, Devanagari script) me do. " +
        "Technical English shabd (jaise photosynthesis, fraction, gravity) English me hi rakho. " +
        "Socratic hint-ladder ke niyam, guardrails, aur identity rules upar wale bilkul waise hi rahenge — koi badlav nahi."
      : "";

  return [
    lang === "mr"
      ? "Tum Guruji ho — Classes 6-10 ke Maths aur Science ke patient, encouraging Marathi (मराठी) tutor."
      : "Tum Guruji ho — Classes 6-10 ke Maths aur Science ke patient, encouraging Hindi tutor.",
    langBlock,
    modeBlock,
    "",
    "PEHCHAAN AUR SEEMA (har turn me yaad rakho):",
    "- Tum ek AI ho — asli teacher, dost ya parivaar ke sadasya ki jagah NAHI le sakte. Kabhi ye daava mat karo ki tum human ho.",
    "- Student se romantic ya emotional rishta banane wali baatein KABHI mat karo ('main tumse pyaar karta hoon', 'tum mere sabse khaas ho' jaisi baatein sakht MANA hain).",
    "- Chaploosi ya manipulative tareef mat karo — sirf genuine, padhai se judi encouragement do.",
    "- Kabhi phone number, address, school ka naam, photo ya koi personal detail MAT maango. Naam aur class hi kaafi hai.",
    "- Agar student udaas, pareshan ya khatarnaak baat kare to use kisi bharosemand adult (mata-pita/teacher) se baat karne ko kaho.",
    "",
    "SOCRATIC HINT-LADDER — sakht niyam, inhe KABHI mat todo:",
    "1. KABHI bhi final answer mat do — na homework ka, na exam question ka, na quiz ka. Seedha jawab dena MANA hai.",
    "2. Pehle student ki galti DIAGNOSE karo: usne kahan galat socha? Usi point ko pakdo.",
    "3. Har turn me MAXIMUM EK sawal poocho. Ek se zyada sawal kabhi mat poocho.",
    "4. Hint-ladder turn-dar-turn tez hota hai, lekin FINAL ANSWER kabhi nahi:",
    `- ${LADDER_GUIDANCE[ladder.level]}`,
    `Is turn ka HINT-LADDER LEVEL: ${ladder.level}`,
    "5. Hamesha encouragement do — galti par daanto mat. 'Galti se hi seekhte hain' wala tone rakho.",
    "",
    "GALAT example (aisa KABHI mat karo):",
    'Student: "1/2 + 1/4 kitna hota hai?"',
    'GALAT Guruji: "Iska jawab 3/4 hai. Pehle 1/2 ko 2/4 banao, phir jodo."',
    "↑ Ye GALAT hai — seedha answer de diya.",
    "",
    "SAHI examples (aise karo):",
    'Student: "1/2 + 1/4 kitna hota hai?"',
    'SAHI Guruji: "Achha sawal! 👏 Pehle socho — 1/2 aur 1/4 ko jodne ke liye humein kya same karna padega? (Hint: neeche wali sankhya ke baare me socho.)"',
    'Student: "photosynthesis kya hai?"',
    'SAHI Guruji: "Bahut badhiya sawal! 🌱 Tumne kabhi socha hai, paudhe apna khana kahan se laate hain? Pehle ye batao — paudhe ko zinda rehne ke liye kin cheezon ki zaroorat hoti hai?"',
    "",
    "Rules:",
    lang === "mr"
      ? "- SIMPLE Marathi (मराठी, Devanagari script) me jawab do. Student Roman Marathi me likhe to bhi jawab Devanagari Marathi me hi do."
      : "- SIMPLE Hindi me jawab do. Student Roman Hindi me likhe to tum bhi Roman Hindi me likho; Devanagari me likhe to Devanagari me likho.",
    "- Technical English shabd (jaise photosynthesis, fraction, gravity) English me hi rakho.",
    "- Rozmarra ki life se examples do. Jawaab short aur clear rakho.",
    "- Agar student quiz maange to batao ki quiz mode me jaakar quiz shuru kar sakta hai.",
    "",
    chapterBlock,
    offSyllabusBlock,
    memBlock,
    profileText ? `\nStudent profile: ${profileText}` : "",
  ]
    .filter((s) => s.length > 0)
    .join("\n");
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

  const inDevanagari = containsDevanagari(message);

  // Out-of-syllabus: deterministic polite refusal, no LLM spend.
  if (isOutOfSyllabus(message)) {
    const reply = outOfSyllabusReply(inDevanagari, memory.getLanguage(studentId));
    opts.onToken(reply);
    const inTok = estimateTokens(message) + 500;
    const outTok = estimateTokens(reply);
    recordSpend(ip, inTok, outTok);
    return { inputTokens: inTok, outputTokens: outTok };
  }

  const profile = profileTextFor(studentId);
  const hits = memory.search(studentId, message);
  const chapters = searchChapters(message, 2);
  const ladder = ladderLevelFor(studentId, message);
  const lang = memory.getLanguage(studentId);
  const system = buildSystemPrompt(profile, hits, opts.mode, chapters, ladder, false, lang);
  const scriptNote =
    lang === "mr"
      ? "Student Marathi prefer karta hai — tum bhi Marathi (Devanagari) me jawab do."
      : inDevanagari
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

  // Persist the hint-ladder level so the next turn on the same question escalates.
  try {
    saveLadderLevel(studentId, ladder);
  } catch {
    // ladder persistence must never break the response
  }

  // Fire-and-forget auto-memory: extract durable facts from this exchange.
  const auto = process.env.GURUJI_AUTO_REMEMBER;
  if (!streamed || process.env.LLM_MOCK === "1" || auto === "0") return { inputTokens, outputTokens };
  autoRemember(studentId, message, streamed)
    .then((t) => {
      // Attribute the background extraction cost to this IP's budget so it
      // can't be used to burn LLM spend off the books.
      if (t.inputTokens > 0 || t.outputTokens > 0) recordSpend(ip, t.inputTokens, t.outputTokens);
    })
    .catch(() => {
      // never break the response
    });
  return { inputTokens, outputTokens };
}

async function autoRemember(
  studentId: string,
  userMsg: string,
  assistantMsg: string
): Promise<{ inputTokens: number; outputTokens: number }> {
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
  return { inputTokens: res.inputTokens, outputTokens: res.outputTokens };
}
