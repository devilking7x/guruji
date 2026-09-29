/**
 * 👩‍🏫 "Teacher" — class-level anonymous aggregates for teachers.
 * GET /api/teacher/stats?class= -> students, avg mastery bars, weakest
 * topics, quizzes this week, active streaks. Insufficient data -> Hindi
 * empty state. Koi personal data kabhi nahi dikhta.
 */
import { useCallback, useEffect, useState } from "react";
import { getTeacherStats, type TeacherStats } from "../api";
import { useLang } from "../i18n";

function Err({ msg }: { msg: string }) {
  if (!msg) return null;
  return (
    <p className="text-sm text-red-300 bg-red-950/40 border border-red-500/30 rounded-xl px-3 py-2">
      {msg}
    </p>
  );
}

export default function TeacherView() {
  const { t } = useLang();
  const [cls, setCls] = useState("8");
  const [stats, setStats] = useState<TeacherStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const load = useCallback(async (c: string) => {
    setLoading(true);
    setErr("");
    try {
      setStats(await getTeacherStats(c));
    } catch (e) {
      setStats(null);
      setErr(e instanceof Error ? e.message : t.teacher.loadErr);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(cls);
  }, [cls, load]);

  const insufficient = stats !== null && stats.ok === false && stats.reason === "insufficient-data";
  const mastery = stats?.avgMasteryByTopic ?? {};
  const masteryEntries = Object.entries(mastery).sort((a, b) => b[1] - a[1]);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-white/5 border border-white/10 shadow-xl shadow-black/20 backdrop-blur p-5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-lg font-bold text-slate-100 tracking-tight">
              {t.teacher.title}
            </h2>
            <p className="text-sm text-white/60">{t.teacher.desc}</p>
          </div>
          <select
            value={cls}
            onChange={(e) => setCls(e.target.value)}
            className="rounded-xl bg-ink border border-white/10 px-4 py-2.5 text-white outline-none focus:border-accent"
            aria-label="Class"
          >
            {[6, 7, 8, 9, 10].map((c) => (
              <option key={c} value={c}>
                Class {c}
              </option>
            ))}
          </select>
        </div>
      </div>

      <Err msg={err} />

      {loading ? (
        <p className="text-white/50 text-sm">{t.teacher.loading}</p>
      ) : insufficient ? (
        <div className="rounded-2xl bg-white/5 border border-white/10 p-8 text-center">
          <p className="text-3xl mb-2">📊</p>
          <p className="text-white/80 font-semibold">{t.teacher.insufficientTitle}</p>
          <p className="text-sm text-white/50 mt-1">{t.teacher.insufficientDesc}</p>
        </div>
      ) : stats && stats.ok !== false ? (
        <>
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-2xl bg-white/5 border border-white/10 p-4 text-center">
              <p className="text-2xl font-extrabold text-accentlight">
                {stats.students ?? 0}
              </p>
              <p className="text-[11px] text-white/50">{t.teacher.students}</p>
            </div>
            <div className="rounded-2xl bg-white/5 border border-white/10 p-4 text-center">
              <p className="text-2xl font-extrabold text-accentlight">
                {stats.quizzesThisWeek ?? 0}
              </p>
              <p className="text-[11px] text-white/50">{t.teacher.quizzesWeek}</p>
            </div>
            <div className="rounded-2xl bg-white/5 border border-white/10 p-4 text-center">
              <p className="text-2xl font-extrabold text-emerald-400">
                🔥 {stats.streaksActive ?? 0}
              </p>
              <p className="text-[11px] text-white/50">{t.teacher.activeStreaks}</p>
            </div>
          </div>

          {masteryEntries.length > 0 && (
            <div className="rounded-2xl bg-white/5 border border-white/10 p-5">
              <h3 className="font-bold text-slate-100 tracking-tight mb-3">
                {t.teacher.masteryTitle}
              </h3>
              <div className="space-y-2.5">
                {masteryEntries.map(([topic, v]) => (
                  <div key={topic}>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-white/80 font-medium truncate pr-2">
                        {topic}
                      </span>
                      <span className="text-accentlight font-bold shrink-0">
                        {Math.round(v)}
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-white/10 overflow-hidden">
                      <div
                        className={`h-full rounded-full ${
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
            </div>
          )}

          {(stats.weakestTopics?.length ?? 0) > 0 && (
            <div className="rounded-2xl bg-white/5 border border-white/10 p-5">
              <h3 className="font-bold text-slate-100 tracking-tight mb-3">
                {t.teacher.weakestTitle}
              </h3>
              <div className="flex flex-wrap gap-2">
                {stats.weakestTopics!.map((t) => (
                  <span
                    key={t}
                    className="text-xs bg-red-950/50 border border-red-500/40 text-red-200 rounded-full px-3 py-1.5"
                  >
                    📉 {t}
                  </span>
                ))}
              </div>
            </div>
          )}
        </>
      ) : (
        !err && (
          <div className="rounded-2xl bg-white/5 border border-white/10 p-8 text-center">
            <p className="text-white/70">{t.teacher.insufficientTitle}</p>
            <button
              onClick={() => load(cls)}
              className="mt-3 rounded-xl bg-gradient-to-r from-accent to-accentdeep text-white font-bold px-6 py-2 hover:opacity-90 transition-opacity"
            >
              {t.teacher.retry}
            </button>
          </div>
        )
      )}

      <p className="text-xs text-white/40 text-center px-4">
        🔒 Sirf anonymous aggregates — kisi bacche ka naam/personal data nahi.
      </p>
    </div>
  );
}
