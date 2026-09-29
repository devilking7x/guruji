/**
 * "Aaj ka revision" — FSRS flip-card review.
 * GET /api/revision/due -> queue -> flip (sawal/jawab) -> grade 1/3/4 -> next.
 */
import { useCallback, useEffect, useState } from "react";
import {
  getDueRevisionCards,
  gradeRevisionCard,
  type RevisionCard,
} from "../api";

const GRADES: { rating: 1 | 3 | 4; label: string; hint: string }[] = [
  { rating: 1, label: "Phir se 😟", hint: "Yaad nahi aaya" },
  { rating: 3, label: "Mushkil tha 😐", hint: "Sochna pada" },
  { rating: 4, label: "Aasaan tha 🙂", hint: "Turant yaad aaya" },
];

function CardShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl bg-white/5 border border-white/10 shadow-xl shadow-black/20 backdrop-blur p-6 min-h-[280px] flex flex-col">
      {children}
    </div>
  );
}

export default function RevisionView() {
  const [cards, setCards] = useState<RevisionCard[] | null>(null);
  const [idx, setIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [done, setDone] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    setErr("");
    try {
      const list = await getDueRevisionCards();
      setCards(list);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Revision cards load nahi ho paye");
      setCards([]);
    } finally {
      setIdx(0);
      setFlipped(false);
      setDone(0);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const advance = useCallback(() => {
    setFlipped(false);
    setIdx((i) => i + 1);
  }, []);

  const grade = async (rating: 1 | 3 | 4) => {
    const card = cards?.[idx];
    if (!card || busy) return;
    setBusy(true);
    setErr("");
    try {
      await gradeRevisionCard(card.id, rating);
      setDone((d) => d + 1);
      advance();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Grade save nahi ho paya — skip kar sakte ho");
    } finally {
      setBusy(false);
    }
  };

  if (cards === null) {
    return <p className="text-white/50 text-sm">Aaj ke cards load ho rahe hain… 🃏</p>;
  }

  const finished = idx >= cards.length;

  // ---- completion state
  if (finished) {
    return (
      <div className="rounded-2xl bg-white/5 border border-white/10 shadow-xl shadow-black/20 backdrop-blur p-8 text-center">
        <p className="text-4xl mb-3">🎉</p>
        <h2 className="text-xl font-bold text-slate-100 tracking-tight mb-2">Ho gaya!</h2>
        <p className="text-white/70 text-sm mb-1">
          {done > 0
            ? `Aaj ${done} card${done === 1 ? "" : "s"} revise kiye — bahut badhiya! 💪`
            : "Aaj ke liye koi card baaki nahi hai."}
        </p>
        <p className="text-xs text-white/40 mb-5">
          Naye cards quiz me galat hue sawalon se bante hain.
        </p>
        <button
          onClick={load}
          className="rounded-xl bg-gradient-to-r from-accent to-accentdeep text-white font-bold px-6 py-2.5 hover:opacity-90 transition-opacity"
        >
          🔄 Dobara check karo
        </button>
      </div>
    );
  }

  // ---- empty queue
  if (cards.length === 0) {
    return (
      <div className="rounded-2xl bg-white/5 border border-white/10 shadow-xl shadow-black/20 backdrop-blur p-8 text-center">
        <p className="text-4xl mb-3">🃏</p>
        <h2 className="text-xl font-bold text-slate-100 tracking-tight mb-2">Aaj ke liye koi card nahi</h2>
        <p className="text-white/70 text-sm mb-5">
          Quiz do — galat hue sawal apne aap yahan revision cards ban jayenge.
        </p>
        {err && (
          <p className="text-sm text-red-300 bg-red-950/40 border border-red-500/30 rounded-xl px-3 py-2 mb-4">
            {err}
          </p>
        )}
        <button
          onClick={load}
          className="rounded-xl bg-gradient-to-r from-accent to-accentdeep text-white font-bold px-6 py-2.5 hover:opacity-90 transition-opacity"
        >
          🔄 Refresh
        </button>
      </div>
    );
  }

  const card = cards[idx];

  return (
    <div className="space-y-4 max-w-xl mx-auto">
      <div className="flex items-center justify-between text-sm">
        <p className="text-white/60">
          🃏 Card <span className="font-bold text-accentlight">{idx + 1}/{cards.length}</span>
          {done > 0 && <span className="text-white/40"> · ✅ {done} ho gaye</span>}
        </p>
        <button
          onClick={load}
          className="text-xs text-accentlight border border-accent/40 rounded-full px-3 py-1.5 hover:border-accent"
        >
          🔄 Refresh
        </button>
      </div>

      {err && (
        <p className="text-sm text-red-300 bg-red-950/40 border border-red-500/30 rounded-xl px-3 py-2">
          {err}
        </p>
      )}

      <div className="flip-scene">
        <div className={`flip-inner ${flipped ? "flipped" : ""}`}>
          {/* front: sawal */}
          <div className="flip-face">
            <CardShell>
              <span className="self-start text-[11px] font-semibold uppercase tracking-wide bg-accent/15 text-accentlight border border-accent/30 rounded-full px-2.5 py-0.5 mb-4">
                {card.topic || "revision"}
              </span>
              <p className="text-[11px] text-white/40 mb-1">SAWAL</p>
              <p className="text-lg text-white/90 font-medium leading-relaxed flex-1 whitespace-pre-wrap">
                {card.front}
              </p>
              <button
                onClick={() => setFlipped(true)}
                className="mt-6 w-full rounded-xl bg-gradient-to-r from-accent to-accentdeep text-white font-bold py-3 hover:opacity-90 transition-opacity"
              >
                Jawab dekho 👀
              </button>
            </CardShell>
          </div>
          {/* back: jawab + grade */}
          <div className="flip-face flip-back">
            <CardShell>
              <p className="text-[11px] text-white/40 mb-1">JAWAB</p>
              <p className="text-base text-white/90 leading-relaxed flex-1 whitespace-pre-wrap">
                {card.back}
              </p>
              <p className="text-xs text-white/50 mt-4 mb-2">Kitna aasaan tha?</p>
              <div className="grid grid-cols-3 gap-2">
                {GRADES.map((g) => (
                  <button
                    key={g.rating}
                    onClick={() => grade(g.rating)}
                    disabled={busy}
                    title={g.hint}
                    className="rounded-xl border border-accent/40 text-accentlight text-sm font-semibold px-2 py-2.5 hover:bg-accent hover:text-white disabled:opacity-40 transition-colors"
                  >
                    {g.label}
                  </button>
                ))}
              </div>
              <button
                onClick={advance}
                className="mt-2 text-xs text-white/40 hover:text-white/70 underline"
              >
                ⏭ Skip (grade nahi hoga)
              </button>
            </CardShell>
          </div>
        </div>
      </div>
    </div>
  );
}
