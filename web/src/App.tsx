import { useCallback, useEffect, useRef, useState } from "react";
import {
  addRevisionCards,
  BudgetError,
  deleteMemory,
  getMemory,
  getProgress,
  getStudentId,
  postStudent,
  startQuiz,
  streamChat,
  submitQuiz,
  type MemoryItem,
  type ProgressData,
  type QuizStart,
  type QuizSubmitResult,
} from "./api";
import { MessageContent } from "./chat/MessageContent";
import {
  getSpeakEnabled,
  setSpeakEnabled,
  speakHindi,
  stopSpeaking,
  supportsTTS,
} from "./chat/voice";
import RevisionView from "./views/RevisionView";
import ParentReport from "./views/ParentReport";
import CopyCheckView from "./views/CopyCheckView";
import PlannerView from "./views/PlannerView";
import WorksheetView from "./views/WorksheetView";
import TeacherView from "./views/TeacherView";
import ChallengeView from "./views/ChallengeView";

type Tab =
  | "chat"
  | "quiz"
  | "revision"
  | "progress"
  | "parent"
  | "memory"
  | "copycheck"
  | "planner"
  | "worksheet"
  | "teacher"
  | "challenge";

const TABS: { id: Tab; label: string; isNew?: boolean }[] = [
  { id: "chat", label: "💬 Chat" },
  { id: "quiz", label: "📝 Quiz" },
  { id: "revision", label: "🃏 Revision" },
  { id: "progress", label: "📊 Progress" },
  { id: "parent", label: "👪 Mata-Pita" },
  { id: "memory", label: "🧠 Yaadein" },
  { id: "copycheck", label: "📸 Copy check", isNew: true },
  { id: "planner", label: "🗓 Planner", isNew: true },
  { id: "worksheet", label: "📝 Worksheet", isNew: true },
  { id: "teacher", label: "👩‍🏫 Teacher", isNew: true },
  { id: "challenge", label: "🏆 Challenge", isNew: true },
];

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl bg-white/5 border border-white/10 shadow-xl shadow-black/20 backdrop-blur ${className}`}>
      {children}
    </div>
  );
}

function Err({ msg }: { msg: string }) {
  if (!msg) return null;
  return (
    <p className="text-sm text-red-300 bg-red-950/40 border border-red-500/30 rounded-xl px-3 py-2">
      {msg}
    </p>
  );
}

function Info({ msg }: { msg: string }) {
  if (!msg) return null;
  return (
    <p className="text-sm text-emerald-200 bg-emerald-950/40 border border-emerald-500/30 rounded-xl px-3 py-2">
      {msg}
    </p>
  );
}

// ---------------------------------------------------------------- onboarding

function OnboardingCard({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState("");
  const [cls, setCls] = useState("8");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const save = async () => {
    if (!name.trim()) {
      setErr("Apna naam likho 🙏");
      return;
    }
    setSaving(true);
    setErr("");
    try {
      await postStudent(name.trim(), Number(cls));
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save nahi ho paya");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="p-5 mb-4 border-accent/40">
      <h2 className="text-xl font-bold text-slate-100 tracking-tight mb-1">Namaste! Main Guruji hoon 🙏</h2>
      <p className="text-sm text-white/70 mb-4">
        Tumhara naam aur class bata do — main tumhe yaad rakhunga aur us hisaab se
        padhaunga.
      </p>
      <p className="text-xs text-white/50 mb-4">
        🔒 Sirf tumhara naam aur class save hota hai — Guruji kabhi phone number,
        address, school ka naam ya photo nahi maangta.
      </p>
      <div className="flex flex-col sm:flex-row gap-3">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Tumhara naam"
          className="flex-1 rounded-xl bg-ink border border-white/10 px-4 py-2.5 text-white placeholder-white/30 outline-none focus:border-accent"
        />
        <select
          value={cls}
          onChange={(e) => setCls(e.target.value)}
          className="rounded-xl bg-ink border border-white/10 px-4 py-2.5 text-white outline-none focus:border-accent"
        >
          {[6, 7, 8, 9, 10].map((c) => (
            <option key={c} value={c}>
              Class {c}
            </option>
          ))}
        </select>
        <button
          onClick={save}
          disabled={saving}
          className="rounded-xl bg-gradient-to-r from-accent to-accentdeep text-white font-bold px-6 py-2.5 hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          {saving ? "Save ho raha…" : "Shuru karo 🚀"}
        </button>
      </div>
      <div className="mt-3">
        <Err msg={err} />
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------- chat

interface ChatMsg {
  id: number;
  role: "user" | "assistant" | "system";
  text: string;
}

function ChatView({
  showOnboarding,
  onOnboarded,
  onOpenRevision,
}: {
  showOnboarding: boolean;
  onOnboarded: () => void;
  onOpenRevision: () => void;
}) {
  const [messages, setMessages] = useState<ChatMsg[]>([
    {
      id: 0,
      role: "assistant",
      text: "Namaste! Main **Guruji** hoon 🙏\n\nMaths ya Science ka koi bhi sawal poochho — Hindi ya English, jaise man kare. Agar samajh na aaye to main aur simple tareeke se samjha dunga!",
    },
  ]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [revision, setRevision] = useState(false);
  const [listening, setListening] = useState(false);
  const [speakOn, setSpeakOnState] = useState(getSpeakEnabled());
  const idRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const speakRef = useRef(speakOn);

  useEffect(() => {
    speakRef.current = speakOn;
  }, [speakOn]);

  // Web Speech API (Chrome). Button stays visible when unsupported and
  // explains in Hindi instead of silently doing nothing.
  const SR: any =
    typeof window !== "undefined"
      ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
      : null;

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Stop any ongoing speech when leaving the chat view.
  useEffect(() => {
    return () => stopSpeaking();
  }, []);

  const pushSystem = useCallback((text: string) => {
    setMessages((m) => [...m, { id: ++idRef.current, role: "system", text }]);
  }, []);

  const toggleSpeak = () => {
    const next = !speakOn;
    setSpeakOnState(next);
    setSpeakEnabled(next);
    if (!next) stopSpeaking();
  };

  const sendMessage = useCallback(
    async (override?: string) => {
      const msg = (override ?? input).trim();
      if (!msg || sending) return;
      stopSpeaking();
      setInput("");
      const uid = ++idRef.current;
      const aid = ++idRef.current;
      setMessages((m) => [
        ...m,
        { id: uid, role: "user", text: msg },
        { id: aid, role: "assistant", text: "" },
      ]);
      setSending(true);
      let full = "";
      try {
        await streamChat(
          { message: msg, studentId: getStudentId(), mode: revision ? "revision" : "chat" },
          (tok) => {
            full += tok;
            setMessages((m) =>
              m.map((x) => (x.id === aid ? { ...x, text: x.text + tok } : x))
            );
          }
        );
        // Voice loop: read the tutor's reply aloud (Hindi TTS, free).
        if (speakRef.current && full.trim()) speakHindi(full);
      } catch (e) {
        if (e instanceof BudgetError) {
          pushSystem(e.message);
        } else {
          pushSystem("Maaf karo, jawab nahi aa paya. Dobara try karo 🙏");
        }
      } finally {
        setSending(false);
      }
    },
    [input, sending, revision, pushSystem]
  );

  const startListening = () => {
    if (listening || sending) return;
    if (!SR) {
      pushSystem("🎙 Voice input is browser me supported nahi hai — Chrome me kholo 🙏");
      return;
    }
    const rec = new SR();
    rec.lang = "hi-IN";
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.onresult = (ev: any) => {
      const res = ev?.results?.[0];
      const t: string | undefined = res?.[0]?.transcript;
      // Full voice loop: speech -> auto-send as a chat message.
      if (res?.isFinal !== false && t && t.trim()) {
        void sendMessage(t.trim());
      }
    };
    rec.onend = () => setListening(false);
    rec.onerror = (ev: any) => {
      setListening(false);
      const code = ev?.error as string | undefined;
      if (code === "not-allowed" || code === "service-not-allowed") {
        pushSystem("🎙 Mic ki permission do — browser ki address bar me mic icon dabakar allow karo 🙏");
      } else if (code === "no-speech") {
        pushSystem("🎙 Kuch sunai nahi diya — thoda zor se dobara bolo 🙂");
      } else if (code === "audio-capture") {
        pushSystem("🎙 Mic nahi mila — device ka mic check karo 🙏");
      } else if (code === "aborted") {
        /* user cancelled — stay silent */
      } else {
        pushSystem("🎙 Voice me dikkat aayi — likh kar poochh lo 🙂");
      }
    };
    setListening(true);
    try {
      rec.start();
    } catch {
      setListening(false);
    }
  };

  return (
    <div className="flex flex-col" style={{ height: "calc(100dvh - 260px)", minHeight: 380 }}>
      {showOnboarding && <OnboardingCard onDone={onOnboarded} />}

      <div className="flex-1 overflow-y-auto space-y-3 pr-1 pb-2">
        {messages.map((m) => {
          if (m.role === "system") {
            return (
              <div key={m.id} className="flex justify-center">
                <p className="text-xs italic text-accentlight/90 bg-accent/10 border border-accent/30 rounded-full px-4 py-1.5 max-w-md text-center">
                  {m.text}
                </p>
              </div>
            );
          }
          const mine = m.role === "user";
          return (
            <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
                  mine
                    ? "bg-gradient-to-r from-accent to-accentdeep text-white font-medium rounded-br-md"
                    : "bg-white/5 border border-white/10 text-white/90 rounded-bl-md backdrop-blur"
                }`}
              >
                {mine ? (
                  m.text
                ) : (
                  <>
                    <MessageContent text={m.text} rich />
                    {m.text === "" && (
                      <span className="inline-block w-2 h-4 bg-accent/70 animate-pulse align-middle" />
                    )}
                  </>
                )}
              </div>
            </div>
          );
        })}
        <div ref={scrollRef} />
      </div>

      <div className="pt-2">
        <div className="flex items-center gap-2 mb-2 flex-wrap">
          <button
            onClick={() => setRevision((r) => !r)}
            className={`text-xs font-semibold rounded-full px-3 py-1.5 border transition-colors ${
              revision
                ? "bg-gradient-to-r from-accent to-accentdeep text-white border-transparent"
                : "bg-transparent text-accentlight border-accent/40 hover:border-accent"
            }`}
            title="Revision mode: kamzor topics dohrao"
          >
            🔁 Revision {revision ? "ON" : "OFF"}
          </button>
          <button
            onClick={onOpenRevision}
            className="text-xs font-semibold rounded-full px-3 py-1.5 border bg-transparent text-accentlight border-accent/40 hover:border-accent transition-colors"
            title="Aaj ke revision cards kholo"
          >
            🃏 Aaj ka revision
          </button>
          {supportsTTS() && (
            <button
              onClick={toggleSpeak}
              className={`text-xs font-semibold rounded-full px-3 py-1.5 border transition-colors ${
                speakOn
                  ? "bg-gradient-to-r from-accent to-accentdeep text-white border-transparent"
                  : "bg-transparent text-accentlight border-accent/40 hover:border-accent"
              }`}
              title={speakOn ? "Tutor ki awaaz band karo" : "Tutor ki awaaz suno"}
            >
              {speakOn ? "🔊 Awaaz ON" : "🔇 Awaaz OFF"}
            </button>
          )}
          {revision && (
            <span className="text-xs text-white/50">Kamzor topics ki revision hogi</span>
          )}
        </div>
        <div className="flex gap-2">
          <button
            onClick={startListening}
            disabled={sending}
            title="Bolo — Hindi voice input (jawab apne aap bhej diya jayega)"
            className={`rounded-xl px-3 border transition-colors disabled:opacity-40 ${
              listening
                ? "bg-red-500/20 border-red-400 text-red-300 animate-pulse"
                : "bg-white/5 border-accent/30 text-accentlight hover:border-accent"
            }`}
          >
            🎙
          </button>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void sendMessage();
            }}
            placeholder="Apna sawal likho... (Hindi ya English)"
            disabled={sending}
            className="flex-1 min-w-0 rounded-xl bg-white/5 border border-white/10 px-4 py-3 text-white placeholder-white/30 outline-none focus:border-accent disabled:opacity-60 backdrop-blur"
          />
          <button
            onClick={() => void sendMessage()}
            disabled={sending || !input.trim()}
            className="rounded-xl bg-gradient-to-r from-accent to-accentdeep text-white font-bold px-5 hover:opacity-90 disabled:opacity-40 transition-opacity"
          >
            {sending ? "…" : "➤"}
          </button>
        </div>
        {listening && (
          <p className="text-xs text-accentlight mt-1.5 animate-pulse">🎙 Sun raha hoon… bolo! (jawab apne aap jayega)</p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- quiz

function QuizView({
  onProgressRefresh,
  classLevel,
  prefillTopic,
}: {
  onProgressRefresh: () => void;
  classLevel?: string | number;
  prefillTopic?: string;
}) {
  const [topic, setTopic] = useState("");
  const [count, setCount] = useState("5");
  const [quiz, setQuiz] = useState<QuizStart | null>(null);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [result, setResult] = useState<QuizSubmitResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [info, setInfo] = useState("");
  const [cardsAdded, setCardsAdded] = useState(false);

  // Weak-topic shortcuts (Progress / Mata-Pita) prefill the topic box.
  useEffect(() => {
    if (prefillTopic) {
      setTopic(prefillTopic);
      setQuiz(null);
      setResult(null);
      setAnswers({});
      setErr("");
      setInfo("");
      setCardsAdded(false);
    }
  }, [prefillTopic]);

  const begin = async () => {
    if (!topic.trim()) {
      setErr("Pehle topic likho — jaise 'Fractions' ya 'Photosynthesis' 📝");
      return;
    }
    setBusy(true);
    setErr("");
    setInfo("");
    try {
      const q = await startQuiz(topic.trim(), Number(count) || 5, classLevel);
      setQuiz(q);
      setAnswers({});
      setResult(null);
      setCardsAdded(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Quiz start nahi ho paya");
    } finally {
      setBusy(false);
    }
  };

  const finish = async () => {
    if (!quiz) return;
    const unanswered = quiz.questions.filter((q) => answers[q.id] === undefined);
    if (unanswered.length > 0) {
      setErr(`Abhi ${unanswered.length} sawal ka jawab baaki hai 🙂`);
      return;
    }
    setBusy(true);
    setErr("");
    try {
      const r = await submitQuiz(
        quiz.quizId,
        quiz.questions.map((q) => ({ questionId: q.id, selected: answers[q.id] }))
      );
      setResult(r);
      onProgressRefresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Submit nahi ho paya");
    } finally {
      setBusy(false);
    }
  };

  /** Build revision cards from the wrong answers — real FSRS input. */
  const makeCards = async () => {
    if (!quiz || !result) return;
    const qById = new Map(quiz.questions.map((q) => [q.id, q]));
    const wrong = result.results.filter((r) => !r.correct);
    if (wrong.length === 0) return;
    setBusy(true);
    setErr("");
    setInfo("");
    try {
      const cards = wrong.map((r) => {
        const q = qById.get(r.questionId);
        const correctOpt = q ? q.options[r.correctIndex] ?? "" : "";
        return {
          front: q ? q.question : "Sawal",
          back: `${correctOpt}${r.explanation ? `\n\n💡 ${r.explanation}` : ""}`.trim(),
          topic: quiz.topic,
        };
      });
      const added = await addRevisionCards(cards);
      setCardsAdded(true);
      setInfo(`🃏 ${added} revision cards ban gaye! "Revision" tab me jaakar dohrao.`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Cards nahi ban paye");
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setQuiz(null);
    setAnswers({});
    setResult(null);
    setErr("");
    setInfo("");
    setCardsAdded(false);
    setTopic("");
  };

  // ---- results
  if (result && quiz) {
    const qById = new Map(quiz.questions.map((q) => [q.id, q]));
    const pct = result.total > 0 ? Math.round((result.score / result.total) * 100) : 0;
    const wrongCount = result.results.filter((r) => !r.correct).length;
    return (
      <div className="space-y-4">
        <Card className="p-5 text-center">
          <p className="text-sm text-white/60 mb-1">Tumhara score</p>
          <p className="text-4xl font-extrabold text-accentlight">
            {result.score}/{result.total}
          </p>
          <p className="text-sm text-white/60 mt-1">{pct}%</p>
          {result.message && <p className="text-sm text-white/80 mt-3">{result.message}</p>}
          {result.weakTopics.length > 0 && (
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              {result.weakTopics.map((t) => (
                <span
                  key={t}
                  className="text-xs bg-red-950/50 border border-red-500/40 text-red-200 rounded-full px-3 py-1"
                >
                  📉 {t}
                </span>
              ))}
            </div>
          )}
          {wrongCount > 0 && !cardsAdded && (
            <button
              onClick={makeCards}
              disabled={busy}
              className="mt-4 rounded-xl border border-accent/50 text-accentlight font-bold px-5 py-2.5 hover:bg-accent hover:text-white disabled:opacity-50 transition-colors"
            >
              {busy ? "Ban rahe…" : `🃏 ${wrongCount} galat sawalon se revision cards banao`}
            </button>
          )}
          <div className="mt-3">
            <Info msg={info} />
          </div>
        </Card>

        {result.results.map((r, i) => {
          const q = qById.get(r.questionId);
          if (!q) return null;
          return (
            <Card key={r.questionId} className="p-4">
              <p className="font-semibold text-white/90 mb-2">
                {r.correct ? "✅" : "❌"} Q{i + 1}. {q.question}
              </p>
              <div className="space-y-1.5 mb-2">
                {q.options.map((opt, oi) => {
                  const isCorrect = oi === r.correctIndex;
                  return (
                    <div
                      key={oi}
                      className={`text-sm rounded-lg px-3 py-1.5 border ${
                        isCorrect
                          ? "border-emerald-500/60 bg-emerald-950/40 text-emerald-200"
                          : "border-white/10 text-white/50"
                      }`}
                    >
                      {isCorrect ? "✔ " : ""}
                      {opt}
                    </div>
                  );
                })}
              </div>
              {r.explanation && (
                <p className="text-sm text-white/70 bg-white/5 rounded-lg px-3 py-2">
                  💡 {r.explanation}
                </p>
              )}
            </Card>
          );
        })}

        <button
          onClick={reset}
          className="w-full rounded-xl bg-gradient-to-r from-accent to-accentdeep text-white font-bold py-3 hover:opacity-90 transition-opacity"
        >
          Naya quiz lo 📝
        </button>
      </div>
    );
  }

  // ---- answering
  if (quiz) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-100 tracking-tight">📝 {quiz.topic}</h2>
          <button onClick={reset} className="text-xs text-white/50 hover:text-white underline">
            Cancel
          </button>
        </div>
        {quiz.questions.map((q, i) => (
          <Card key={q.id} className="p-4">
            <p className="font-semibold text-white/90 mb-3">
              Q{i + 1}. {q.question}
            </p>
            <div className="grid gap-2">
              {q.options.map((opt, oi) => (
                <button
                  key={oi}
                  onClick={() => setAnswers((a) => ({ ...a, [q.id]: oi }))}
                  className={`text-left text-sm rounded-xl px-4 py-2.5 border transition-colors ${
                    answers[q.id] === oi
                      ? "bg-accent/20 border-accent text-accentlight font-semibold"
                      : "bg-ink border-white/10 text-white/80 hover:border-accent/50"
                  }`}
                >
                  <span className="font-bold mr-2">{["A", "B", "C", "D"][oi]}.</span>
                  {opt}
                </button>
              ))}
            </div>
          </Card>
        ))}
        <Err msg={err} />
        <button
          onClick={finish}
          disabled={busy}
          className="w-full rounded-xl bg-gradient-to-r from-accent to-accentdeep text-white font-bold py-3 hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          {busy ? "Check ho raha…" : "Submit karo ✔"}
        </button>
      </div>
    );
  }

  // ---- setup
  return (
    <Card className="p-5">
      <h2 className="text-lg font-bold text-slate-100 tracking-tight mb-1">📝 Quiz shuru karo</h2>
      <p className="text-sm text-white/60 mb-4">
        Koi topic likho — usi pe sawal banenge. Galat jawab wale topics apne aap
        "kamzor topics" me jud jayenge.
      </p>
      <div className="flex flex-col sm:flex-row gap-3">
        <input
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") begin();
          }}
          placeholder="Topic — jaise 'Fractions' ya 'Photosynthesis'"
          className="flex-1 rounded-xl bg-ink border border-white/10 px-4 py-2.5 text-white placeholder-white/30 outline-none focus:border-accent"
        />
        <select
          value={count}
          onChange={(e) => setCount(e.target.value)}
          className="rounded-xl bg-ink border border-white/10 px-4 py-2.5 text-white outline-none focus:border-accent"
        >
          {[3, 5, 8, 10].map((n) => (
            <option key={n} value={n}>
              {n} sawal
            </option>
          ))}
        </select>
        <button
          onClick={begin}
          disabled={busy}
          className="rounded-xl bg-gradient-to-r from-accent to-accentdeep text-white font-bold px-6 py-2.5 hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          {busy ? "Ban raha…" : "Quiz shuru karo 🚀"}
        </button>
      </div>
      <div className="mt-3">
        <Err msg={err} />
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------- progress (mastery / XP)

const BADGE_DEFS: { id: string; emoji: string; name: string; desc: string }[] = [
  { id: "pehla-quiz", emoji: "🥉", name: "Pehla Quiz", desc: "Pehla quiz complete kiya" },
  { id: "7-din-streak", emoji: "🚀", name: "Hafta Paar", desc: "7 din ki lagatar streak" },
  { id: "quiz-25", emoji: "🌟", name: "Quiz Legend", desc: "25 quiz complete kiye" },
];

/** Backend ke topicSlug() jaisa slug — `${slug}-master` badge IDs match karne ke liye. */
function topicSlug(topic: string): string {
  return topic
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function MasterySection({
  progress,
  onQuizTopic,
}: {
  progress: ProgressData;
  onQuizTopic: (topic: string) => void;
}) {
  const mastery = progress.mastery ?? {};
  const entries = Object.entries(mastery).sort((a, b) => b[1] - a[1]);
  const xp = progress.xp ?? 0;
  const streak = progress.streak ?? 0;
  const earned = new Set(progress.badges ?? []);
  // Topic-master badges: backend `${slug}-master` (mastery >= 85) — entries se derive karo
  const masterBadges = entries
    .filter(([, m]) => m >= 85)
    .map(([topic]) => {
      const slug = topicSlug(topic);
      return slug
        ? { id: `${slug}-master`, emoji: "🏆", name: `${topic} Master`, desc: `${topic} me 85+ mastery` }
        : null;
    })
    .filter((b): b is { id: string; emoji: string; name: string; desc: string } => b !== null);
  const allBadges = [...BADGE_DEFS, ...masterBadges];
  const weak = progress.weakTopics ?? [];
  const level = Math.floor(xp / 100) + 1;
  const levelPct = xp % 100;

  const hasStats = entries.length > 0 || xp > 0 || streak > 0 || earned.size > 0;

  return (
    <Card className="p-5">
      <h3 className="font-bold text-slate-100 tracking-tight mb-4">⭐ Mastery & XP</h3>

      {!hasStats && weak.length === 0 ? (
        <div className="text-center py-4">
          <p className="text-3xl mb-2">🌱</p>
          <p className="text-white/80 font-semibold">Abhi XP aur mastery data nahi hai</p>
          <p className="text-sm text-white/50 mt-1">
            Quiz do aur revision karo — XP, streak aur mastery yahan dikhegi!
          </p>
        </div>
      ) : (
        <>
          {hasStats && (
            <>
              {/* XP / level / streak */}
              <div className="grid grid-cols-3 gap-3 mb-5">
                <div className="rounded-xl bg-ink/60 border border-white/10 p-3 text-center">
                  <p className="text-2xl font-extrabold text-accentlight">{xp}</p>
                  <p className="text-[11px] text-white/50">XP</p>
                </div>
                <div className="rounded-xl bg-ink/60 border border-white/10 p-3 text-center">
                  <p className="text-2xl font-extrabold text-accentlight">Lv {level}</p>
                  <div
                    className="h-1.5 mt-1.5 rounded-full bg-white/10 overflow-hidden"
                    title={`Agla level: ${100 - levelPct} XP baaki`}
                  >
                    <div className="h-full bg-gradient-to-r from-accent to-accentdeep rounded-full" style={{ width: `${levelPct}%` }} />
                  </div>
                  <p className="text-[11px] text-white/50 mt-1">Level</p>
                </div>
                <div className="rounded-xl bg-ink/60 border border-white/10 p-3 text-center">
                  <p className="text-2xl font-extrabold text-emerald-400">🔥 {streak}</p>
                  <p className="text-[11px] text-white/50">din streak</p>
                </div>
              </div>

              {/* badges */}
              <p className="text-xs text-white/50 mb-2">🏅 Badges</p>
              <div className="flex flex-wrap gap-2 mb-5">
                {allBadges.map((b) => {
                  const isEarned = earned.has(b.id);
                  return (
                    <div
                      key={b.id}
                      title={isEarned ? `${b.name} — ${b.desc}` : `${b.name} (locked) — ${b.desc}`}
                      className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs border ${
                        isEarned
                          ? "bg-accent/15 border-accent/50 text-accentlight"
                          : "bg-white/5 border-white/10 text-white/30"
                      }`}
                    >
                      <span className={isEarned ? "" : "grayscale opacity-50"}>{b.emoji}</span>
                      <span className="font-semibold">{b.name}</span>
                      {!isEarned && <span>🔒</span>}
                    </div>
                  );
                })}
              </div>

              {/* mastery bars */}
              {entries.length > 0 && (
                <>
                  <p className="text-xs text-white/50 mb-2">📊 Topic mastery</p>
                  <div className="space-y-2.5 mb-5">
                    {entries.map(([topic, v]) => (
                      <div key={topic}>
                        <div className="flex justify-between text-xs mb-1">
                          <span className="text-white/80 font-medium truncate pr-2">{topic}</span>
                          <span className="text-accentlight font-bold shrink-0">{v}</span>
                        </div>
                        <div className="h-2 rounded-full bg-white/10 overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${
                              v >= 60
                                ? "bg-gradient-to-r from-accent to-accentdeep"
                                : v >= 40
                                  ? "bg-emerald-500"
                                  : "bg-red-500"
                            }`}
                            style={{ width: `${Math.max(0, Math.min(100, v))}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </>
          )}

          {/* weak topics + client-side 20-minute plan */}
          {weak.length > 0 && (
            <>
              <p className="text-xs text-white/50 mb-2">🎯 Kamzor topics — 20-minute plan</p>
              <div className="space-y-2.5">
                {weak.map((t) => (
                  <div key={t} className="rounded-xl bg-ink/60 border border-red-500/20 p-3">
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <p className="text-sm font-semibold text-white/90 min-w-0 break-words">
                        📉 {t}
                        {mastery[t] !== undefined && (
                          <span className="text-white/40 font-normal"> · mastery {mastery[t]}</span>
                        )}
                      </p>
                      <button
                        onClick={() => onQuizTopic(t)}
                        className="shrink-0 text-xs font-bold bg-gradient-to-r from-accent to-accentdeep text-white rounded-full px-3 py-1 hover:opacity-90 transition-opacity"
                      >
                        Quiz do 📝
                      </button>
                    </div>
                    <div className="flex items-center gap-1.5 text-[11px] flex-wrap">
                      <span className="bg-white/5 border border-white/10 rounded-full px-2.5 py-1 text-white/70">
                        🃏 5 min revision cards
                      </span>
                      <span className="text-accentlight">→</span>
                      <span className="bg-white/5 border border-white/10 rounded-full px-2.5 py-1 text-white/70">
                        📝 10 min quiz
                      </span>
                      <span className="text-accentlight">→</span>
                      <span className="bg-white/5 border border-white/10 rounded-full px-2.5 py-1 text-white/70">
                        🔁 5 min dobara
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </Card>
  );
}

function ProgressView({
  progress,
  loading,
  onRefresh,
  onQuizTopic,
}: {
  progress: ProgressData | null;
  loading: boolean;
  onRefresh: () => void;
  onQuizTopic: (topic: string) => void;
}) {
  if (loading) {
    return <p className="text-white/50 text-sm">Progress load ho rahi hai…</p>;
  }
  if (!progress) {
    return (
      <Card className="p-6 text-center">
        <p className="text-white/70 mb-3">Progress abhi load nahi ho payi.</p>
        <button
          onClick={onRefresh}
          className="rounded-xl bg-gradient-to-r from-accent to-accentdeep text-white font-bold px-6 py-2 hover:opacity-90 transition-opacity"
        >
          Dobara try karo 🔄
        </button>
      </Card>
    );
  }

  const hasData = progress.topics.length > 0 || progress.history.length > 0;

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-100 tracking-tight">
              {progress.student.name ? `👋 ${progress.student.name}` : "👋 Namaste!"}
            </h2>
            <p className="text-sm text-white/60">
              {progress.student.classLevel ? `Class ${progress.student.classLevel}` : "Class pata nahi"}
            </p>
          </div>
          <button
            onClick={onRefresh}
            className="text-xs text-accentlight border border-accent/40 rounded-full px-3 py-1.5 hover:border-accent"
          >
            🔄 Refresh
          </button>
        </div>
      </Card>

      <MasterySection progress={progress} onQuizTopic={onQuizTopic} />

      {!hasData ? (
        <Card className="p-8 text-center">
          <p className="text-3xl mb-2">📝</p>
          <p className="text-white/80 font-semibold">Abhi koi quiz nahi diya — pehla quiz lo! 📝</p>
          <p className="text-sm text-white/50 mt-1">
            Quiz doge to yahan tumhari progress aur kamzor topics dikhenge.
          </p>
        </Card>
      ) : (
        <>
          {progress.topics.length > 0 && (
            <Card className="p-5 overflow-x-auto">
              <h3 className="font-bold text-slate-100 tracking-tight mb-3">📚 Topics</h3>
              <table className="w-full text-sm min-w-[300px]">
                <thead>
                  <tr className="text-left text-white/50 border-b border-white/10">
                    <th className="pb-2 pr-3 font-medium">Topic</th>
                    <th className="pb-2 pr-3 font-medium">Quiz</th>
                    <th className="pb-2 pr-3 font-medium">Avg score</th>
                    <th className="pb-2 font-medium">Last attempt</th>
                  </tr>
                </thead>
                <tbody>
                  {progress.topics.map((t) => (
                    <tr key={t.topic} className="border-b border-white/5 last:border-0">
                      <td className="py-2.5 pr-3 text-white/90 font-medium">{t.topic}</td>
                      <td className="py-2.5 pr-3 text-white/70">{t.quizzes}</td>
                      <td className="py-2.5 pr-3 text-white/70">
                        {t.avgScore === null ? "—" : String(t.avgScore)}
                      </td>
                      <td className="py-2.5 text-white/70">{fmtDate(t.lastAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}

          {progress.history.length > 0 && (
            <Card className="p-5">
              <h3 className="font-bold text-slate-100 tracking-tight mb-3">🕘 Score history</h3>
              <ul className="space-y-2">
                {progress.history.map((h, i) => (
                  <li
                    key={`${h.at}-${i}`}
                    className="flex items-center justify-between text-sm bg-ink/60 rounded-xl px-4 py-2.5 border border-white/5"
                  >
                    <span className="text-white/80">
                      <span className="font-semibold text-white/90">{h.topic}</span>
                      <span className="text-white/40"> · {fmtDateTime(h.at)}</span>
                    </span>
                    <span className="font-bold text-accentlight">
                      {h.score}/{h.total}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- memory

function MemoryView() {
  const [mems, setMems] = useState<MemoryItem[] | null>(null);
  const [err, setErr] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr("");
    try {
      const list = await getMemory();
      setMems(list.filter((m) => !m.superseded));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Yaadein load nahi ho payin");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const remove = async (id: string) => {
    setDeleting(id);
    setErr("");
    try {
      await deleteMemory(id);
      setMems((m) => (m ?? []).filter((x) => x.id !== id));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Delete nahi ho paya");
    } finally {
      setDeleting(null);
    }
  };

  if (mems === null) {
    return <p className="text-white/50 text-sm">Yaadein load ho rahi hain…</p>;
  }

  return (
    <div className="space-y-3">
      <Err msg={err} />
      {mems.length === 0 ? (
        <Card className="p-8 text-center">
          <p className="text-3xl mb-2">🧠</p>
          <p className="text-white/80 font-semibold">Abhi koi yaad nahi hai</p>
          <p className="text-sm text-white/50 mt-1">
            Guruji se baat karo — wo tumhare baare me zaroori baatein yaad rakhega.
          </p>
        </Card>
      ) : (
        mems.map((m) => (
          <Card key={m.id} className="p-4 flex items-start gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                <span className="text-[11px] font-semibold uppercase tracking-wide bg-accent/15 text-accentlight border border-accent/30 rounded-full px-2.5 py-0.5">
                  {m.kind || "yaad"}
                </span>
                <span className="text-[11px] text-white/40">{fmtDateTime(m.createdAt)}</span>
              </div>
              <p className="text-sm text-white/85 leading-relaxed">{m.text}</p>
            </div>
            <button
              onClick={() => remove(m.id)}
              disabled={deleting === m.id}
              title="Ye yaad mitao"
              className="shrink-0 text-white/40 hover:text-red-300 border border-white/10 hover:border-red-400/50 rounded-lg px-2.5 py-1.5 text-sm disabled:opacity-40 transition-colors"
            >
              {deleting === m.id ? "…" : "🗑"}
            </button>
          </Card>
        ))
      )}
    </div>
  );
}

// ---------------------------------------------------------------- app

export default function App() {
  const [tab, setTab] = useState<Tab>("chat");
  const [progress, setProgress] = useState<ProgressData | null>(null);
  const [loadingProgress, setLoadingProgress] = useState(true);
  const [quizPrefill, setQuizPrefill] = useState("");

  const refreshProgress = useCallback(async () => {
    try {
      setProgress(await getProgress());
    } catch {
      // Server down/offline — progress is optional, chat still works.
    } finally {
      setLoadingProgress(false);
    }
  }, []);

  useEffect(() => {
    refreshProgress();
  }, [refreshProgress]);

  const needsOnboarding =
    !loadingProgress && progress !== null && !progress.student.name;

  /** Jump to the Quiz tab with a topic prefilled (weak-topic shortcuts). */
  const startQuizFor = useCallback((topic: string) => {
    setQuizPrefill(topic);
    setTab("quiz");
  }, []);

  return (
    <div className="min-h-dvh text-slate-100">
      <div className="max-w-3xl mx-auto px-4 pb-8">
        <header className="no-print py-5 text-center border-b border-white/10 mb-4">
          <h1 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-accentlight to-accentdeep bg-clip-text text-transparent">🙏 Guruji</h1>
          <p className="text-sm text-white/60 mt-1">Tumhara Personal AI Tutor</p>
        </header>

        <nav className="no-print grid grid-cols-3 gap-2 mb-5">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`relative rounded-xl px-2 py-2.5 text-sm font-semibold border transition-colors ${
                tab === t.id
                  ? "bg-gradient-to-r from-accent to-accentdeep text-white border-transparent"
                  : "bg-white/5 text-white/70 border-white/10 hover:border-accent/60 hover:text-accentlight"
              }`}
            >
              {t.label}
              {t.isNew && (
                <span
                  className={`absolute -top-2 -right-1 text-[10px] font-bold rounded-full px-1.5 py-0.5 ${
                    tab === t.id
                      ? "bg-white text-accentdeep"
                      : "bg-gradient-to-r from-accent to-accentdeep text-white"
                  }`}
                >
                  ✨ Naya
                </span>
              )}
            </button>
          ))}
        </nav>

        <main>
          {tab === "chat" && (
            <ChatView
              showOnboarding={needsOnboarding}
              onOnboarded={refreshProgress}
              onOpenRevision={() => setTab("revision")}
            />
          )}
          {tab === "quiz" && (
            <QuizView
              onProgressRefresh={refreshProgress}
              classLevel={progress?.student.classLevel ?? undefined}
              prefillTopic={quizPrefill}
            />
          )}
          {tab === "revision" && <RevisionView />}
          {tab === "progress" && (
            <ProgressView
              progress={progress}
              loading={loadingProgress}
              onRefresh={refreshProgress}
              onQuizTopic={startQuizFor}
            />
          )}
          {tab === "parent" && (
            <ParentReport
              progress={progress}
              loading={loadingProgress}
              onRefresh={refreshProgress}
              onQuizTopic={startQuizFor}
            />
          )}
          {tab === "memory" && <MemoryView />}
          {tab === "copycheck" && (
            <CopyCheckView
              classLevel={progress?.student.classLevel ?? undefined}
            />
          )}
          {tab === "planner" && (
            <PlannerView
              classLevel={progress?.student.classLevel ?? undefined}
            />
          )}
          {tab === "worksheet" && <WorksheetView progress={progress} />}
          {tab === "teacher" && <TeacherView />}
          {tab === "challenge" && (
            <ChallengeView
              classLevel={progress?.student.classLevel ?? undefined}
            />
          )}
        </main>

        <footer className="no-print mt-8 text-center text-xs text-white/30">
          Guruji se padho, roz thoda-thoda 📚
        </footer>
      </div>
    </div>
  );
}
