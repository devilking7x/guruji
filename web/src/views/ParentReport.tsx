/**
 * "Mata-Pita" report — weekly view for parents.
 * Mastery deltas (this week vs last), streaks, weak topics, suggested plan,
 * and an honest child-safety note. Print-friendly via .print-sheet CSS.
 */
import { useMemo } from "react";
import type { ProgressData } from "../api";

interface QItem {
  date: string;
  topic: string;
  score: number;
  total: number;
}

const DAY_MS = 86_400_000;

/** Prefer the new quizHistory; fall back to v1 history (field `at`). */
function toItems(p: ProgressData): QItem[] {
  if (p.quizHistory && p.quizHistory.length > 0) {
    return p.quizHistory.map((q) => ({
      date: q.date,
      topic: q.topic,
      score: q.score,
      total: q.total,
    }));
  }
  return p.history.map((h) => ({
    date: h.at,
    topic: h.topic,
    score: h.score,
    total: h.total,
  }));
}

function avgPct(items: QItem[]): number | null {
  const valid = items.filter((i) => i.total > 0);
  if (valid.length === 0) return null;
  return valid.reduce((s, i) => s + (i.score / i.total) * 100, 0) / valid.length;
}

function fmtPct(v: number | null): string {
  return v === null ? "—" : `${Math.round(v)}%`;
}

const PLAN_DAYS = ["Somvaar", "Mangalvaar", "Budhvaar", "Guruvaar"];

export default function ParentReport({
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
  const calc = useMemo(() => {
    if (!progress) return null;
    const items = toItems(progress).filter(
      (i) => !Number.isNaN(new Date(i.date).getTime())
    );
    const now = Date.now();
    const thisWeek = items.filter(
      (i) => now - new Date(i.date).getTime() <= 7 * DAY_MS
    );
    const lastWeek = items.filter((i) => {
      const d = now - new Date(i.date).getTime();
      return d > 7 * DAY_MS && d <= 14 * DAY_MS;
    });
    const avgFor = (arr: QItem[], topic: string) =>
      avgPct(arr.filter((i) => i.topic === topic));
    const topics = Array.from(
      new Set([...thisWeek, ...lastWeek].map((i) => i.topic))
    );
    const rows = topics.map((topic) => ({
      topic,
      last: avgFor(lastWeek, topic),
      cur: avgFor(thisWeek, topic),
    }));
    return { items, thisWeek, rows };
  }, [progress]);

  if (loading) {
    return <p className="text-white/50 text-sm">Report ban rahi hai…</p>;
  }

  if (!progress || !calc || calc.items.length === 0) {
    return (
      <div className="rounded-2xl bg-white/5 border border-white/10 shadow-xl shadow-black/20 backdrop-blur p-8 text-center">
        <p className="text-3xl mb-2">👨‍👩‍👧</p>
        <p className="text-white/80 font-semibold">Abhi report banane ke liye data nahi hai</p>
        <p className="text-sm text-white/50 mt-1 mb-4">
          Baccha jab quiz dega, tab yahan hafte-dar-hafte progress dikhegi.
        </p>
        <button
          onClick={onRefresh}
          className="rounded-xl bg-gradient-to-r from-accent to-accentdeep text-white font-bold px-6 py-2 hover:opacity-90 transition-opacity"
        >
          🔄 Refresh
        </button>
      </div>
    );
  }

  const xp = progress.xp ?? 0;
  const streak = progress.streak ?? 0;
  const level = Math.floor(xp / 100) + 1;
  const weak = progress.weakTopics ?? [];
  const name = progress.student.name || "Baccha";

  return (
    <div className="print-sheet space-y-4">
      {/* header */}
      <div className="rounded-2xl bg-white/5 border border-white/10 shadow-xl shadow-black/20 backdrop-blur p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold text-slate-100 tracking-tight">👨‍👩‍👧 Mata-Pita Report</h2>
            <p className="text-sm text-white/60 mt-0.5">
              {name} ki padhai — ek nazar me
            </p>
          </div>
          <div className="flex gap-2 no-print shrink-0">
            <button
              onClick={() => window.print()}
              className="text-xs font-semibold text-accentlight border border-accent/40 rounded-full px-3 py-1.5 hover:border-accent"
            >
              🖨 Print
            </button>
            <button
              onClick={onRefresh}
              className="text-xs font-semibold text-accentlight border border-accent/40 rounded-full px-3 py-1.5 hover:border-accent"
            >
              🔄
            </button>
          </div>
        </div>

        {/* summary strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
          <div className="rounded-xl bg-ink/60 border border-white/10 p-3 text-center">
            <p className="text-2xl font-extrabold text-accentlight">{calc.thisWeek.length}</p>
            <p className="text-[11px] text-white/50">quiz is hafte</p>
          </div>
          <div className="rounded-xl bg-ink/60 border border-white/10 p-3 text-center">
            <p className="text-2xl font-extrabold text-accentlight">{fmtPct(avgPct(calc.thisWeek))}</p>
            <p className="text-[11px] text-white/50">avg score is hafte</p>
          </div>
          <div className="rounded-xl bg-ink/60 border border-white/10 p-3 text-center">
            <p className="text-2xl font-extrabold text-emerald-400">🔥 {streak}</p>
            <p className="text-[11px] text-white/50">din streak</p>
          </div>
          <div className="rounded-xl bg-ink/60 border border-white/10 p-3 text-center">
            <p className="text-2xl font-extrabold text-accentlight">Lv {level}</p>
            <p className="text-[11px] text-white/50">{xp} XP</p>
          </div>
        </div>
      </div>

      {/* mastery deltas */}
      <div className="rounded-2xl bg-white/5 border border-white/10 shadow-xl shadow-black/20 backdrop-blur p-5 overflow-x-auto">
        <h3 className="font-bold text-slate-100 tracking-tight mb-3">📈 Hafte-dar-hafte badlav</h3>
        {calc.rows.length === 0 ? (
          <p className="text-sm text-white/50">
            Pichhle 14 din me koi quiz nahi hua — tulna ke liye data nahi hai.
          </p>
        ) : (
          <table className="w-full text-sm min-w-[320px]">
            <thead>
              <tr className="text-left text-white/50 border-b border-white/10">
                <th className="pb-2 pr-3 font-medium">Topic</th>
                <th className="pb-2 pr-3 font-medium">Pichhla hafta</th>
                <th className="pb-2 pr-3 font-medium">Is hafta</th>
                <th className="pb-2 font-medium">Badlav</th>
              </tr>
            </thead>
            <tbody>
              {calc.rows.map((r) => {
                const delta =
                  r.last !== null && r.cur !== null
                    ? Math.round(r.cur - r.last)
                    : null;
                return (
                  <tr key={r.topic} className="border-b border-white/5 last:border-0">
                    <td className="py-2.5 pr-3 text-white/90 font-medium">{r.topic}</td>
                    <td className="py-2.5 pr-3 text-white/70">{fmtPct(r.last)}</td>
                    <td className="py-2.5 pr-3 text-white/70">{fmtPct(r.cur)}</td>
                    <td className="py-2.5 font-bold">
                      {delta === null ? (
                        <span className="text-white/30">—</span>
                      ) : delta > 0 ? (
                        <span className="text-emerald-400">▲ +{delta}</span>
                      ) : delta < 0 ? (
                        <span className="text-red-400">▼ {delta}</span>
                      ) : (
                        <span className="text-white/40">= 0</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* weak topics + weekly plan */}
      <div className="rounded-2xl bg-white/5 border border-white/10 shadow-xl shadow-black/20 backdrop-blur p-5">
        <h3 className="font-bold text-slate-100 tracking-tight mb-3">🎯 Is hafte ka plan</h3>
        {weak.length === 0 ? (
          <p className="text-sm text-white/70">
            ✅ Abhi koi kamzor topic nahi dikh raha — badhiya chal raha hai! Naye
            topics try karte raho.
          </p>
        ) : (
          <div className="space-y-2.5">
            {weak.slice(0, 4).map((t, i) => (
              <div
                key={t}
                className="flex items-center justify-between gap-2 rounded-xl bg-ink/60 border border-white/10 px-4 py-2.5"
              >
                <p className="text-sm text-white/85">
                  <span className="font-semibold text-accentlight">{PLAN_DAYS[i] ?? "Ravivaar"}:</span>{" "}
                  📉 {t}
                  <span className="text-white/40"> — 5 min cards → 10 min quiz → 5 min dobara</span>
                </p>
                <button
                  onClick={() => onQuizTopic(t)}
                  className="no-print shrink-0 text-xs font-bold bg-gradient-to-r from-accent to-accentdeep text-white rounded-full px-3 py-1 hover:opacity-90"
                >
                  Quiz 📝
                </button>
              </div>
            ))}
            <p className="text-xs text-white/40 pt-1">
              💡 Salah: roz 20–30 minute padhai, Revision tab ke roz ke cards, aur
              streak tootne na do 🔥
            </p>
          </div>
        )}
      </div>

      {/* safety note */}
      <div className="rounded-2xl bg-white/5 border border-white/10 shadow-xl shadow-black/20 backdrop-blur p-5">
        <h3 className="font-bold text-slate-100 tracking-tight mb-2">🔒 Suraksha note</h3>
        <p className="text-sm text-white/70 leading-relaxed">
          Guruji kabhi naam, pata ya phone number nahi maangta. Har student ka
          saara data alag JSON file me server par surakshit rehta hai — kisi
          teesre ke saath share nahi hota.
        </p>
      </div>
    </div>
  );
}
