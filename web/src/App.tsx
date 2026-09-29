import { useCallback, useEffect, useRef, useState } from "react";
import {
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

type Tab = "chat" | "quiz" | "progress" | "memory";

const TABS: { id: Tab; label: string }[] = [
  { id: "chat", label: "💬 Chat" },
  { id: "quiz", label: "📝 Quiz" },
  { id: "progress", label: "📊 Progress" },
  { id: "memory", label: "🧠 Yaadein" },
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

/** Minimal rich text: **bold** + line breaks. */
function renderRich(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, i) =>
    p.startsWith("**") && p.endsWith("**") && p.length > 4 ? (
      <strong key={i} className="text-gold font-semibold">
        {p.slice(2, -2)}
      </strong>
    ) : (
      <span key={i}>{p}</span>
    )
  );
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl bg-card border border-gold/20 shadow-lg shadow-black/40 ${className}`}>
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
    <Card className="p-5 mb-4 border-gold/40">
      <h2 className="text-xl font-bold text-gold mb-1">Namaste! Main Guruji hoon 🙏</h2>
      <p className="text-sm text-white/70 mb-4">
        Tumhara naam aur class bata do — main tumhe yaad rakhunga aur us hisaab se
        padhaunga.
      </p>
      <div className="flex flex-col sm:flex-row gap-3">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Tumhara naam"
          className="flex-1 rounded-xl bg-ink border border-gold/30 px-4 py-2.5 text-white placeholder-white/30 outline-none focus:border-gold"
        />
        <select
          value={cls}
          onChange={(e) => setCls(e.target.value)}
          className="rounded-xl bg-ink border border-gold/30 px-4 py-2.5 text-white outline-none focus:border-gold"
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
          className="rounded-xl bg-gold text-ink font-bold px-6 py-2.5 hover:bg-golddeep disabled:opacity-50 transition-colors"
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

function ChatView({ showOnboarding, onOnboarded }: { showOnboarding: boolean; onOnboarded: () => void }) {
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
  const idRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Web Speech API (Chrome). Gracefully hidden when unsupported.
  const SR: any =
    typeof window !== "undefined"
      ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
      : null;

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = useCallback(async () => {
    const msg = input.trim();
    if (!msg || sending) return;
    setInput("");
    const uid = ++idRef.current;
    const aid = ++idRef.current;
    setMessages((m) => [
      ...m,
      { id: uid, role: "user", text: msg },
      { id: aid, role: "assistant", text: "" },
    ]);
    setSending(true);
    try {
      await streamChat(
        { message: msg, studentId: getStudentId(), mode: revision ? "revision" : "chat" },
        (tok) =>
          setMessages((m) =>
            m.map((x) => (x.id === aid ? { ...x, text: x.text + tok } : x))
          )
      );
    } catch (e) {
      if (e instanceof BudgetError) {
        setMessages((m) => [...m, { id: ++idRef.current, role: "system", text: e.message }]);
      } else {
        setMessages((m) => [
          ...m,
          { id: ++idRef.current, role: "system", text: "Maaf karo, jawab nahi aa paya. Dobara try karo 🙏" },
        ]);
      }
    } finally {
      setSending(false);
    }
  }, [input, sending, revision]);

  const startListening = () => {
    if (!SR || listening || sending) return;
    const rec = new SR();
    rec.lang = "hi-IN";
    rec.interimResults = false;
    rec.onresult = (ev: any) => {
      const t: string | undefined = ev?.results?.[0]?.[0]?.transcript;
      if (t) setInput((prev) => (prev ? prev + " " + t : t));
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    setListening(true);
    try {
      rec.start();
    } catch {
      setListening(false);
    }
  };

  return (
    <div className="flex flex-col" style={{ height: "calc(100dvh - 220px)", minHeight: 380 }}>
      {showOnboarding && <OnboardingCard onDone={onOnboarded} />}

      <div className="flex-1 overflow-y-auto space-y-3 pr-1 pb-2">
        {messages.map((m) => {
          if (m.role === "system") {
            return (
              <div key={m.id} className="flex justify-center">
                <p className="text-xs italic text-gold/90 bg-gold/10 border border-gold/30 rounded-full px-4 py-1.5 max-w-md text-center">
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
                    ? "bg-gold/90 text-ink font-medium rounded-br-md"
                    : "bg-card border border-gold/20 text-white/90 rounded-bl-md"
                }`}
              >
                {mine ? m.text : renderRich(m.text)}
                {!mine && m.text === "" && (
                  <span className="inline-block w-2 h-4 bg-gold/70 animate-pulse align-middle" />
                )}
              </div>
            </div>
          );
        })}
        <div ref={scrollRef} />
      </div>

      <div className="pt-2">
        <div className="flex items-center gap-2 mb-2">
          <button
            onClick={() => setRevision((r) => !r)}
            className={`text-xs font-semibold rounded-full px-3 py-1.5 border transition-colors ${
              revision
                ? "bg-gold text-ink border-gold"
                : "bg-transparent text-gold border-gold/40 hover:border-gold"
            }`}
            title="Revision mode: kamzor topics dohrao"
          >
            🔁 Revision {revision ? "ON" : "OFF"}
          </button>
          {revision && (
            <span className="text-xs text-white/50">Kamzor topics ki revision hogi</span>
          )}
        </div>
        <div className="flex gap-2">
          {SR && (
            <button
              onClick={startListening}
              disabled={sending}
              title="Bolo — Hindi voice input"
              className={`rounded-xl px-3 border transition-colors disabled:opacity-40 ${
                listening
                  ? "bg-red-500/20 border-red-400 text-red-300 animate-pulse"
                  : "bg-card border-gold/30 text-gold hover:border-gold"
              }`}
            >
              🎙
            </button>
          )}
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") sendMessage();
            }}
            placeholder="Apna sawal likho... (Hindi ya English)"
            disabled={sending}
            className="flex-1 rounded-xl bg-card border border-gold/30 px-4 py-3 text-white placeholder-white/30 outline-none focus:border-gold disabled:opacity-60"
          />
          <button
            onClick={sendMessage}
            disabled={sending || !input.trim()}
            className="rounded-xl bg-gold text-ink font-bold px-5 hover:bg-golddeep disabled:opacity-40 transition-colors"
          >
            {sending ? "…" : "➤"}
          </button>
        </div>
        {listening && (
          <p className="text-xs text-gold mt-1.5 animate-pulse">🎙 Sun raha hoon… bolo!</p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- quiz

function QuizView({
  onProgressRefresh,
  classLevel,
}: {
  onProgressRefresh: () => void;
  classLevel?: string | number;
}) {
  const [topic, setTopic] = useState("");
  const [count, setCount] = useState("5");
  const [quiz, setQuiz] = useState<QuizStart | null>(null);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [result, setResult] = useState<QuizSubmitResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const begin = async () => {
    if (!topic.trim()) {
      setErr("Pehle topic likho — jaise 'Fractions' ya 'Photosynthesis' 📝");
      return;
    }
    setBusy(true);
    setErr("");
    try {
      const q = await startQuiz(topic.trim(), Number(count) || 5, classLevel);
      setQuiz(q);
      setAnswers({});
      setResult(null);
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

  const reset = () => {
    setQuiz(null);
    setAnswers({});
    setResult(null);
    setErr("");
    setTopic("");
  };

  // ---- results
  if (result && quiz) {
    const qById = new Map(quiz.questions.map((q) => [q.id, q]));
    const pct = result.total > 0 ? Math.round((result.score / result.total) * 100) : 0;
    return (
      <div className="space-y-4">
        <Card className="p-5 text-center">
          <p className="text-sm text-white/60 mb-1">Tumhara score</p>
          <p className="text-4xl font-extrabold text-gold">
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
                          ? "border-green-500/60 bg-green-950/40 text-green-200"
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
          className="w-full rounded-xl bg-gold text-ink font-bold py-3 hover:bg-golddeep transition-colors"
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
          <h2 className="text-lg font-bold text-gold">📝 {quiz.topic}</h2>
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
                      ? "bg-gold/20 border-gold text-gold font-semibold"
                      : "bg-ink border-white/10 text-white/80 hover:border-gold/50"
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
          className="w-full rounded-xl bg-gold text-ink font-bold py-3 hover:bg-golddeep disabled:opacity-50 transition-colors"
        >
          {busy ? "Check ho raha…" : "Submit karo ✔"}
        </button>
      </div>
    );
  }

  // ---- setup
  return (
    <Card className="p-5">
      <h2 className="text-lg font-bold text-gold mb-1">📝 Quiz shuru karo</h2>
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
          className="flex-1 rounded-xl bg-ink border border-gold/30 px-4 py-2.5 text-white placeholder-white/30 outline-none focus:border-gold"
        />
        <select
          value={count}
          onChange={(e) => setCount(e.target.value)}
          className="rounded-xl bg-ink border border-gold/30 px-4 py-2.5 text-white outline-none focus:border-gold"
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
          className="rounded-xl bg-gold text-ink font-bold px-6 py-2.5 hover:bg-golddeep disabled:opacity-50 transition-colors"
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

// ---------------------------------------------------------------- progress

function ProgressView({
  progress,
  loading,
  onRefresh,
}: {
  progress: ProgressData | null;
  loading: boolean;
  onRefresh: () => void;
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
          className="rounded-xl bg-gold text-ink font-bold px-6 py-2 hover:bg-golddeep transition-colors"
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
            <h2 className="text-lg font-bold text-gold">
              {progress.student.name ? `👋 ${progress.student.name}` : "👋 Namaste!"}
            </h2>
            <p className="text-sm text-white/60">
              {progress.student.classLevel ? `Class ${progress.student.classLevel}` : "Class pata nahi"}
            </p>
          </div>
          <button
            onClick={onRefresh}
            className="text-xs text-gold border border-gold/40 rounded-full px-3 py-1.5 hover:border-gold"
          >
            🔄 Refresh
          </button>
        </div>
        {progress.weakTopics.length > 0 && (
          <div className="mt-3">
            <p className="text-xs text-white/50 mb-1.5">Kamzor topics — inpe dhyan do:</p>
            <div className="flex flex-wrap gap-2">
              {progress.weakTopics.map((t) => (
                <span
                  key={t}
                  className="text-xs bg-red-950/50 border border-red-500/40 text-red-200 rounded-full px-3 py-1"
                >
                  📉 {t}
                </span>
              ))}
            </div>
          </div>
        )}
      </Card>

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
              <h3 className="font-bold text-gold mb-3">📚 Topics</h3>
              <table className="w-full text-sm">
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
              <h3 className="font-bold text-gold mb-3">🕘 Score history</h3>
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
                    <span className="font-bold text-gold">
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
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                <span className="text-[11px] font-semibold uppercase tracking-wide bg-gold/15 text-gold border border-gold/30 rounded-full px-2.5 py-0.5">
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

  return (
    <div className="min-h-dvh bg-ink text-[#f5f1e3]">
      <div className="max-w-3xl mx-auto px-4 pb-8">
        <header className="py-5 text-center border-b border-gold/20 mb-4">
          <h1 className="text-3xl font-extrabold text-gold tracking-tight">🙏 Guruji</h1>
          <p className="text-sm text-white/60 mt-1">Tumhara Personal AI Tutor</p>
        </header>

        <nav className="grid grid-cols-4 gap-2 mb-5">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`rounded-xl px-2 py-2.5 text-sm font-semibold border transition-colors ${
                tab === t.id
                  ? "bg-gold text-ink border-gold"
                  : "bg-card text-white/70 border-gold/20 hover:border-gold/60 hover:text-gold"
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>

        <main>
          {tab === "chat" && (
            <ChatView
              showOnboarding={needsOnboarding}
              onOnboarded={refreshProgress}
            />
          )}
          {tab === "quiz" && (
            <QuizView
              onProgressRefresh={refreshProgress}
              classLevel={progress?.student.classLevel ?? undefined}
            />
          )}
          {tab === "progress" && (
            <ProgressView
              progress={progress}
              loading={loadingProgress}
              onRefresh={refreshProgress}
            />
          )}
          {tab === "memory" && <MemoryView />}
        </main>

        <footer className="mt-8 text-center text-xs text-white/30">
          Guruji se padho, roz thoda-thoda 📚
        </footer>
      </div>
    </div>
  );
}
