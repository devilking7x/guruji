import { useCallback, useEffect, useRef, useState } from "react";
import {
  addNotebook,
  addRevisionCards,
  BudgetError,
  deleteMemory,
  getMemory,
  getProgress,
  getStudentId,
  postStudent,
  getNickname,
  startQuiz,
  streamChat,
  submitQuiz,
  waShareUrl,
  type MemoryItem,
  type ProgressData,
  type QuizStart,
  type QuizSubmitResult,
} from "./api";
import { MessageContent } from "./chat/MessageContent";
import {
  getSpeakEnabled,
  setSpeakEnabled,
  speak,
  stopSpeaking,
  supportsTTS,
} from "./chat/voice";
import { LangProvider, useLang } from "./i18n";
import { InstallButton, LangToggle } from "./components";
import { useHashRoute, useScrollTopOnRoute } from "./router";
import Landing from "./views/Landing";
import PosterPage from "./views/PosterPage";
import NotebookView from "./views/NotebookView";
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
  | "notebook"
  | "copycheck"
  | "planner"
  | "worksheet"
  | "teacher"
  | "challenge";

const TAB_IDS: Tab[] = [
  "chat",
  "quiz",
  "revision",
  "progress",
  "parent",
  "memory",
  "notebook",
  "copycheck",
  "planner",
  "worksheet",
  "teacher",
  "challenge",
];

function tabFromPath(path: string): Tab | null {
  const seg = path.replace(/^\/app\/?/, "");
  return (TAB_IDS as string[]).includes(seg) ? (seg as Tab) : null;
}

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
  const { t } = useLang();
  const [name, setName] = useState("");
  const [cls, setCls] = useState("8");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const save = async () => {
    if (!name.trim()) {
      setErr(t.onboarding.errName);
      return;
    }
    setSaving(true);
    setErr("");
    try {
      await postStudent(name.trim(), Number(cls));
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : t.common.retry);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="p-5 mb-4 border-accent/40">
      <h2 className="text-xl font-bold text-slate-100 tracking-tight mb-1">{t.onboarding.title}</h2>
      <p className="text-sm text-white/70 mb-4">{t.onboarding.desc}</p>
      <p className="text-xs text-white/50 mb-4">{t.onboarding.privacy}</p>
      <div className="flex flex-col sm:flex-row gap-3">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t.onboarding.namePh}
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
          {saving ? t.onboarding.saving : t.onboarding.start}
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
  const { t, lang } = useLang();
  const [messages, setMessages] = useState<ChatMsg[]>([
    { id: 0, role: "assistant", text: t.chat.welcome },
  ]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [revision, setRevision] = useState(false);
  const [listening, setListening] = useState(false);
  const [speakOn, setSpeakOnState] = useState(getSpeakEnabled());
  const [savedIds, setSavedIds] = useState<Set<number>>(new Set());
  const idRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const speakRef = useRef(speakOn);

  useEffect(() => {
    speakRef.current = speakOn;
  }, [speakOn]);

  // Web Speech API (Chrome). Button stays visible when unsupported and
  // explains instead of silently doing nothing.
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

  /** 🔖 Save a tutor answer to the Notebook tab. */
  const bookmark = useCallback(
    async (m: ChatMsg) => {
      if (!m.text.trim() || savedIds.has(m.id)) return;
      try {
        await addNotebook(m.text);
        setSavedIds((s) => new Set(s).add(m.id));
        pushSystem(t.chat.bookmarkSaved);
      } catch {
        pushSystem(t.chat.bookmarkErr);
      }
    },
    [savedIds, pushSystem, t]
  );

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
        // Voice loop: read the tutor's reply aloud (free TTS, hi-IN / mr-IN).
        if (speakRef.current && full.trim()) speak(full, lang);
      } catch (e) {
        if (e instanceof BudgetError) {
          pushSystem(e.message);
        } else {
          pushSystem(t.chat.sendErr);
        }
      } finally {
        setSending(false);
      }
    },
    [input, sending, revision, pushSystem, lang, t]
  );

  const startListening = () => {
    if (listening || sending) return;
    if (!SR) {
      pushSystem(t.chat.voiceUnsupported);
      return;
    }
    const rec = new SR();
    rec.lang = lang === "mr" ? "mr-IN" : "hi-IN";
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.onresult = (ev: any) => {
      const res = ev?.results?.[0];
      const tr: string | undefined = res?.[0]?.transcript;
      // Full voice loop: speech -> auto-send as a chat message.
      if (res?.isFinal !== false && tr && tr.trim()) {
        void sendMessage(tr.trim());
      }
    };
    rec.onend = () => setListening(false);
    rec.onerror = (ev: any) => {
      setListening(false);
      const code = ev?.error as string | undefined;
      if (code === "not-allowed" || code === "service-not-allowed") {
        pushSystem(t.chat.micPermission);
      } else if (code === "no-speech") {
        pushSystem(t.chat.micNoSpeech);
      } else if (code === "audio-capture") {
        pushSystem(t.chat.micMissing);
      } else if (code === "aborted") {
        /* user cancelled — stay silent */
      } else {
        pushSystem(t.chat.micError);
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
              <div className={`flex flex-col ${mine ? "items-end" : "items-start"} max-w-[85%]`}>
                <div
                  className={`rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
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
                {!mine && m.text.trim() !== "" && (
                  <button
                    onClick={() => void bookmark(m)}
                    disabled={savedIds.has(m.id)}
                    title={t.chat.bookmarkTitle}
                    className="mt-1 text-xs text-white/40 hover:text-accentlight border border-white/10 hover:border-accent/50 rounded-full px-2.5 py-1 transition-colors disabled:opacity-70"
                  >
                    {savedIds.has(m.id) ? "🔖 ✓" : "🔖"}
                  </button>
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
            title={t.chat.revisionBtnTitle}
          >
            {revision ? t.chat.revisionOn : t.chat.revisionOff}
          </button>
          <button
            onClick={onOpenRevision}
            className="text-xs font-semibold rounded-full px-3 py-1.5 border bg-transparent text-accentlight border-accent/40 hover:border-accent transition-colors"
            title={t.chat.revisionCardTitle}
          >
            {t.chat.todayRevision}
          </button>
          {supportsTTS() && (
            <button
              onClick={toggleSpeak}
              className={`text-xs font-semibold rounded-full px-3 py-1.5 border transition-colors ${
                speakOn
                  ? "bg-gradient-to-r from-accent to-accentdeep text-white border-transparent"
                  : "bg-transparent text-accentlight border-accent/40 hover:border-accent"
              }`}
              title={speakOn ? t.chat.voiceTitleOn : t.chat.voiceTitleOff}
            >
              {speakOn ? t.chat.voiceOn : t.chat.voiceOff}
            </button>
          )}
          {revision && (
            <span className="text-xs text-white/50">{t.chat.revisionHint}</span>
          )}
        </div>
        <div className="flex gap-2">
          <button
            onClick={startListening}
            disabled={sending}
            title={t.chat.voiceBtnTitle}
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
            placeholder={t.chat.inputPh}
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
          <p className="text-xs text-accentlight mt-1.5 animate-pulse">{t.chat.listening}</p>
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
  const { t } = useLang();
  const [topic, setTopic] = useState("");
  const [count, setCount] = useState("5");
  const [quiz, setQuiz] = useState<QuizStart | null>(null);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [result, setResult] = useState<QuizSubmitResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [info, setInfo] = useState("");
  const [cardsAdded, setCardsAdded] = useState(false);
  const [nick, setNick] = useState("");

  // Anonymous challenge nickname — share-safe. Loaded best-effort; the
  // share button simply omits the name until it arrives.
  useEffect(() => {
    let alive = true;
    getNickname()
      .then((n) => {
        if (alive && n.nickname) setNick(n.nickname);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

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
      setErr(t.quiz.errTopic);
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
      setErr(e instanceof Error ? e.message : t.common.retry);
    } finally {
      setBusy(false);
    }
  };

  const finish = async () => {
    if (!quiz) return;
    const unanswered = quiz.questions.filter((q) => answers[q.id] === undefined);
    if (unanswered.length > 0) {
      setErr(`${t.quiz.stillLeft} ${unanswered.length} ${t.quiz.errUnanswered}`);
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
      setErr(e instanceof Error ? e.message : t.common.retry);
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
      setInfo(`🃏 ${added} ${t.quiz.cardsDone}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : t.common.retry);
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
    // Share-safe: score + anonymous nickname + encouraging line only —
    // never the real name, never studentId.
    const shareText = `${t.share.quizPrefix} — ${quiz.topic}: ${result.score}/${result.total} (${pct}%)${
      nick ? ` — ${nick}` : ""
    }\n${t.share.quizEncourage}\n${t.share.appLink}`;
    return (
      <div className="space-y-4">
        <Card className="p-5 text-center">
          <p className="text-sm text-white/60 mb-1">{t.quiz.resultYourScore}</p>
          <p className="text-4xl font-extrabold text-accentlight">
            {result.score}/{result.total}
          </p>
          <p className="text-sm text-white/60 mt-1">{pct}%</p>
          {result.message && <p className="text-sm text-white/80 mt-3">{result.message}</p>}
          <a
            href={waShareUrl(shareText)}
            target="_blank"
            rel="noopener noreferrer"
            title={t.quiz.shareTitle}
            className="mt-3 inline-block rounded-xl border border-emerald-500/40 text-emerald-200 text-sm font-bold px-5 py-2.5 hover:bg-emerald-500/10 transition-colors"
          >
            {t.common.shareWhatsApp}
          </a>
          {result.weakTopics.length > 0 && (
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              {result.weakTopics.map((wt) => (
                <span
                  key={wt}
                  className="text-xs bg-red-950/50 border border-red-500/40 text-red-200 rounded-full px-3 py-1"
                >
                  📉 {wt}
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
              {busy ? t.quiz.makingCards : `🃏 ${wrongCount} ${t.quiz.makeCards}`}
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
          {t.quiz.newQuiz}
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
            {t.quiz.cancel}
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
          {busy ? t.quiz.submitting : t.quiz.submit}
        </button>
      </div>
    );
  }

  // ---- setup
  return (
    <Card className="p-5">
      <h2 className="text-lg font-bold text-slate-100 tracking-tight mb-1">{t.quiz.setupTitle}</h2>
      <p className="text-sm text-white/60 mb-4">{t.quiz.setupDesc}</p>
      <div className="flex flex-col sm:flex-row gap-3">
        <input
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") begin();
          }}
          placeholder={t.quiz.topicPh}
          className="flex-1 rounded-xl bg-ink border border-white/10 px-4 py-2.5 text-white placeholder-white/30 outline-none focus:border-accent"
        />
        <select
          value={count}
          onChange={(e) => setCount(e.target.value)}
          aria-label={t.quiz.questions}
          className="rounded-xl bg-ink border border-white/10 px-4 py-2.5 text-white outline-none focus:border-accent"
        >
          {[3, 5, 8, 10].map((n) => (
            <option key={n} value={n}>
              {n} {t.quiz.questions}
            </option>
          ))}
        </select>
        <button
          onClick={begin}
          disabled={busy}
          className="rounded-xl bg-gradient-to-r from-accent to-accentdeep text-white font-bold px-6 py-2.5 hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          {busy ? t.quiz.starting : t.quiz.start}
        </button>
      </div>
      <div className="mt-3">
        <Err msg={err} />
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------- progress (mastery / XP)

const BADGE_DEFS: { id: string; emoji: string; descHi: string; descMr: string }[] = [
  { id: "pehla-quiz", emoji: "🥉", descHi: "Pehla Quiz", descMr: "पहिला क्विझ" },
  { id: "7-din-streak", emoji: "🚀", descHi: "Hafta Paar", descMr: "आठवडा पार" },
  { id: "quiz-25", emoji: "🌟", descHi: "Quiz Legend", descMr: "क्विझ लेजंड" },
];

const BADGE_DESC: Record<string, { hi: string; mr: string }> = {
  "pehla-quiz": { hi: "Pehla quiz complete kiya", mr: "पहिला क्विझ पूर्ण केला" },
  "7-din-streak": { hi: "7 din ki lagatar streak", mr: "7 दिवसांची सलग स्ट्रीक" },
  "quiz-25": { hi: "25 quiz complete kiye", mr: "25 क्विझ पूर्ण केले" },
};

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
  const { t, lang } = useLang();
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
        ? { id: `${slug}-master`, emoji: "🏆", name: `${topic} Master` }
        : null;
    })
    .filter((b): b is { id: string; emoji: string; name: string } => b !== null);
  const weak = progress.weakTopics ?? [];
  const level = Math.floor(xp / 100) + 1;
  const levelPct = xp % 100;

  const hasStats = entries.length > 0 || xp > 0 || streak > 0 || earned.size > 0;

  return (
    <Card className="p-5">
      <h3 className="font-bold text-slate-100 tracking-tight mb-4">{t.progress.masteryTitle}</h3>

      {!hasStats && weak.length === 0 ? (
        <div className="text-center py-4">
          <p className="text-3xl mb-2">🌱</p>
          <p className="text-white/80 font-semibold">{t.progress.noDataTitle}</p>
          <p className="text-sm text-white/50 mt-1">{t.progress.noDataDesc}</p>
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
                    title={`${t.progress.nextLevel}: ${100 - levelPct} ${t.progress.xpLeft}`}
                  >
                    <div className="h-full bg-gradient-to-r from-accent to-accentdeep rounded-full" style={{ width: `${levelPct}%` }} />
                  </div>
                  <p className="text-[11px] text-white/50 mt-1">{t.progress.level}</p>
                </div>
                <div className="rounded-xl bg-ink/60 border border-white/10 p-3 text-center">
                  <p className="text-2xl font-extrabold text-emerald-400">🔥 {streak}</p>
                  <p className="text-[11px] text-white/50">{t.progress.streakDays}</p>
                </div>
              </div>

              {/* badges */}
              <p className="text-xs text-white/50 mb-2">{t.progress.badges}</p>
              <div className="flex flex-wrap gap-2 mb-5">
                {[...BADGE_DEFS.map((b) => ({
                  id: b.id,
                  emoji: b.emoji,
                  name: lang === "mr" ? b.descMr : b.descHi,
                  desc: (BADGE_DESC[b.id]?.[lang] ?? "") as string,
                })), ...masterBadges.map((b) => ({ ...b, desc: "" }))].map((b) => {
                  const isEarned = earned.has(b.id);
                  return (
                    <div
                      key={b.id}
                      title={isEarned ? `${b.name}${b.desc ? ` — ${b.desc}` : ""}` : `${b.name} (${t.progress.locked})`}
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
                  <p className="text-xs text-white/50 mb-2">{t.progress.topicMastery}</p>
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
              <p className="text-xs text-white/50 mb-2">{t.progress.weakTitle}</p>
              <div className="space-y-2.5">
                {weak.map((wt) => (
                  <div key={wt} className="rounded-xl bg-ink/60 border border-red-500/20 p-3">
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <p className="text-sm font-semibold text-white/90 min-w-0 break-words">
                        📉 {wt}
                        {mastery[wt] !== undefined && (
                          <span className="text-white/40 font-normal"> · {t.progress.masteryOf} {mastery[wt]}</span>
                        )}
                      </p>
                      <button
                        onClick={() => onQuizTopic(wt)}
                        className="shrink-0 text-xs font-bold bg-gradient-to-r from-accent to-accentdeep text-white rounded-full px-3 py-1 hover:opacity-90 transition-opacity"
                      >
                        {t.progress.quizCta}
                      </button>
                    </div>
                    <div className="flex items-center gap-1.5 text-[11px] flex-wrap">
                      <span className="bg-white/5 border border-white/10 rounded-full px-2.5 py-1 text-white/70">
                        {t.progress.planRevision}
                      </span>
                      <span className="text-accentlight">→</span>
                      <span className="bg-white/5 border border-white/10 rounded-full px-2.5 py-1 text-white/70">
                        {t.progress.planQuiz}
                      </span>
                      <span className="text-accentlight">→</span>
                      <span className="bg-white/5 border border-white/10 rounded-full px-2.5 py-1 text-white/70">
                        {t.progress.planAgain}
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
  const { t } = useLang();
  if (loading) {
    return <p className="text-white/50 text-sm">{t.progress.loading}</p>;
  }
  if (!progress) {
    return (
      <Card className="p-6 text-center">
        <p className="text-white/70 mb-3">{t.progress.loadErr}</p>
        <button
          onClick={onRefresh}
          className="rounded-xl bg-gradient-to-r from-accent to-accentdeep text-white font-bold px-6 py-2 hover:opacity-90 transition-opacity"
        >
          {t.progress.retry}
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
              {progress.student.name ? `👋 ${progress.student.name}` : t.progress.hello}
            </h2>
            <p className="text-sm text-white/60">
              {progress.student.classLevel ? `Class ${progress.student.classLevel}` : t.progress.classUnknown}
            </p>
          </div>
          <button
            onClick={onRefresh}
            className="text-xs text-accentlight border border-accent/40 rounded-full px-3 py-1.5 hover:border-accent"
          >
            {t.progress.refresh}
          </button>
        </div>
      </Card>

      <MasterySection progress={progress} onQuizTopic={onQuizTopic} />

      {!hasData ? (
        <Card className="p-8 text-center">
          <p className="text-3xl mb-2">📝</p>
          <p className="text-white/80 font-semibold">{t.progress.noQuizTitle}</p>
          <p className="text-sm text-white/50 mt-1">{t.progress.noQuizDesc}</p>
        </Card>
      ) : (
        <>
          {progress.topics.length > 0 && (
            <Card className="p-5 overflow-x-auto">
              <h3 className="font-bold text-slate-100 tracking-tight mb-3">{t.progress.topicsTitle}</h3>
              <table className="w-full text-sm min-w-[300px]">
                <thead>
                  <tr className="text-left text-white/50 border-b border-white/10">
                    <th className="pb-2 pr-3 font-medium">{t.progress.thTopic}</th>
                    <th className="pb-2 pr-3 font-medium">{t.progress.thQuiz}</th>
                    <th className="pb-2 pr-3 font-medium">{t.progress.thAvg}</th>
                    <th className="pb-2 font-medium">{t.progress.thLast}</th>
                  </tr>
                </thead>
                <tbody>
                  {progress.topics.map((tp) => (
                    <tr key={tp.topic} className="border-b border-white/5 last:border-0">
                      <td className="py-2.5 pr-3 text-white/90 font-medium">{tp.topic}</td>
                      <td className="py-2.5 pr-3 text-white/70">{tp.quizzes}</td>
                      <td className="py-2.5 pr-3 text-white/70">
                        {tp.avgScore === null ? "—" : String(tp.avgScore)}
                      </td>
                      <td className="py-2.5 text-white/70">{fmtDate(tp.lastAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}

          {progress.history.length > 0 && (
            <Card className="p-5">
              <h3 className="font-bold text-slate-100 tracking-tight mb-3">{t.progress.historyTitle}</h3>
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
  const { t } = useLang();
  const [mems, setMems] = useState<MemoryItem[] | null>(null);
  const [err, setErr] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr("");
    try {
      const list = await getMemory();
      setMems(list.filter((m) => !m.superseded));
    } catch (e) {
      setErr(e instanceof Error ? e.message : t.memory.loadErr);
    }
  }, [t]);

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
      setErr(e instanceof Error ? e.message : t.memory.deleteErr);
    } finally {
      setDeleting(null);
    }
  };

  if (mems === null) {
    return <p className="text-white/50 text-sm">{t.memory.loading}</p>;
  }

  return (
    <div className="space-y-3">
      <Err msg={err} />
      {mems.length === 0 ? (
        <Card className="p-8 text-center">
          <p className="text-3xl mb-2">🧠</p>
          <p className="text-white/80 font-semibold">{t.memory.emptyTitle}</p>
          <p className="text-sm text-white/50 mt-1">{t.memory.emptyDesc}</p>
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
              title={t.memory.deleteTitle}
              className="shrink-0 text-white/40 hover:text-red-300 border border-white/10 hover:border-red-400/50 rounded-lg px-2.5 py-1.5 text-sm disabled:opacity-40 transition-colors"
            >
              {deleting === m.id ? "…" : t.common.delete}
            </button>
          </Card>
        ))
      )}
    </div>
  );
}

// ---------------------------------------------------------------- app shell (the /app route)

function AppShell() {
  const { t } = useLang();
  const [path, navigate] = useHashRoute();
  const [tab, setTab] = useState<Tab>(() => tabFromPath(path) ?? "chat");
  const [progress, setProgress] = useState<ProgressData | null>(null);
  const [loadingProgress, setLoadingProgress] = useState(true);
  const [quizPrefill, setQuizPrefill] = useState("");

  // Keep tab in sync when the hash changes (back/forward, deep links).
  useEffect(() => {
    const fromHash = tabFromPath(path);
    if (fromHash) setTab(fromHash);
  }, [path]);

  const goTab = useCallback(
    (id: Tab) => {
      setTab(id);
      navigate(`/app/${id}`);
    },
    [navigate]
  );

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
  const startQuizFor = useCallback(
    (topic: string) => {
      setQuizPrefill(topic);
      goTab("quiz");
    },
    [goTab]
  );

  const isNewTab = (id: Tab) =>
    id === "copycheck" || id === "planner" || id === "worksheet" || id === "teacher" || id === "challenge";

  return (
    <div className="min-h-dvh text-slate-100">
      <div className="max-w-3xl mx-auto px-4 pb-8">
        <header className="no-print py-5 border-b border-white/10 mb-4">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <a href="#/" className="text-center sm:text-left">
              <h1 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-accentlight to-accentdeep bg-clip-text text-transparent">{t.app.title}</h1>
              <p className="text-sm text-white/60 mt-1">{t.app.subtitle}</p>
            </a>
            <div className="flex items-center gap-2 flex-wrap">
              <InstallButton />
              <a
                href="#/"
                className="text-xs font-bold text-white/60 hover:text-accentlight border border-white/10 hover:border-accent/50 rounded-full px-3 py-1.5 transition-colors"
              >
                {t.app.home}
              </a>
              <a
                href="#/poster"
                className="text-xs font-bold text-white/60 hover:text-accentlight border border-white/10 hover:border-accent/50 rounded-full px-3 py-1.5 transition-colors"
              >
                {t.app.poster}
              </a>
              <LangToggle compact />
            </div>
          </div>
        </header>

        <nav className="no-print grid grid-cols-3 gap-2 mb-5">
          {TAB_IDS.map((id) => (
            <button
              key={id}
              onClick={() => goTab(id)}
              className={`relative rounded-xl px-2 py-2.5 text-sm font-semibold border transition-colors ${
                tab === id
                  ? "bg-gradient-to-r from-accent to-accentdeep text-white border-transparent"
                  : "bg-white/5 text-white/70 border-white/10 hover:border-accent/60 hover:text-accentlight"
              }`}
            >
              {t.tabs[id]}
              {isNewTab(id) && (
                <span
                  className={`absolute -top-2 -right-1 text-[10px] font-bold rounded-full px-1.5 py-0.5 ${
                    tab === id
                      ? "bg-white text-accentdeep"
                      : "bg-gradient-to-r from-accent to-accentdeep text-white"
                  }`}
                >
                  {t.app.newBadge}
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
              onOpenRevision={() => goTab("revision")}
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
          {tab === "notebook" && <NotebookView />}
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
          {t.app.footer}
        </footer>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- root

function RootRoutes() {
  const [path, navigate] = useHashRoute();
  useScrollTopOnRoute(path);

  useEffect(() => {
    if (
      path !== "/" &&
      path !== "/poster" &&
      path !== "/app" &&
      !path.startsWith("/app/")
    ) {
      navigate("/");
    }
  }, [path, navigate]);

  if (path === "/poster") return <PosterPage />;
  if (path === "/app" || path.startsWith("/app/")) return <AppShell />;
  return <Landing />;
}

export default function App() {
  return (
    <LangProvider>
      <RootRoutes />
    </LangProvider>
  );
}
