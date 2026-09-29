/**
 * 🗓 "Planner" — study plan builder: chapters multi-select, days, minutes/day
 * -> POST /api/planner -> day-wise checklist. PATCH toggles tasks.
 * GET /api/planner on load se plan persist hota hai.
 */
import { useCallback, useEffect, useState } from "react";
import {
  CHAPTERS,
  createPlanner,
  getPlanner,
  togglePlannerTask,
  type StudyPlan,
} from "../api";
import { useLang } from "../i18n";

function Err({ msg }: { msg: string }) {
  if (!msg) return null;
  return (
    <p className="text-sm text-red-300 bg-red-950/40 border border-red-500/30 rounded-xl px-3 py-2">
      {msg}
    </p>
  );
}

export default function PlannerView({
  classLevel,
}: {
  classLevel?: string | number;
}) {
  const { t } = useLang();
  const [plan, setPlan] = useState<StudyPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [building, setBuilding] = useState(false);
  const [toggling, setToggling] = useState<string | null>(null);

  // form state
  const [cls, setCls] = useState(String(classLevel ?? "8"));
  const [selected, setSelected] = useState<string[]>([]);
  const [days, setDays] = useState("7");
  const [minutes, setMinutes] = useState("30");

  useEffect(() => {
    if (classLevel !== undefined && classLevel !== null) {
      setCls(String(classLevel));
    }
  }, [classLevel]);

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      setPlan(await getPlanner());
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Plan load nahi ho paya");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const classChapters = CHAPTERS.filter((c) => c.class === cls);

  const toggleChapter = (id: string) => {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  };

  const build = async () => {
    if (selected.length === 0) {
      setErr("Kam se kam ek chapter choose karo 📚");
      return;
    }
    const nDays = Number(days);
    const nMin = Number(minutes);
    if (!Number.isFinite(nDays) || nDays < 1 || nDays > 30) {
      setErr("Days 1 se 30 ke beech likho 🗓");
      return;
    }
    if (!Number.isFinite(nMin) || nMin < 10 || nMin > 180) {
      setErr("Minutes/day 10 se 180 ke beech likho ⏱");
      return;
    }
    setBuilding(true);
    setErr("");
    try {
      const p = await createPlanner({
        class: cls,
        chapters: selected,
        days: nDays,
        minutesPerDay: nMin,
      });
      setPlan(p);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Plan nahi ban paya");
    } finally {
      setBuilding(false);
    }
  };

  const toggleTask = async (day: number, taskIndex: number, done: boolean) => {
    const key = `${day}:${taskIndex}`;
    setToggling(key);
    try {
      await togglePlannerTask(day, taskIndex, done);
      // Optimistic update.
      setPlan((p) => {
        if (!p) return p;
        return {
          ...p,
          days: p.days.map((d) =>
            d.day === day
              ? {
                  ...d,
                  tasks: d.tasks.map((t, i) => (i === taskIndex ? { ...t, done } : t)),
                }
              : d
          ),
        };
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Task update nahi ho paya");
    } finally {
      setToggling(null);
    }
  };

  const discard = () => {
    setPlan(null);
    setSelected([]);
  };

  if (loading) {
    return <p className="text-white/50 text-sm">{t.common.loading}</p>;
  }

  // ---- existing plan: day-wise checklist
  if (plan && plan.days && plan.days.length > 0) {
    const total = plan.days.reduce((s, d) => s + (d.tasks?.length ?? 0), 0);
    const done = plan.days.reduce(
      (s, d) => s + (d.tasks?.filter((t) => t.done).length ?? 0),
      0
    );
    return (
      <div className="space-y-4">
        <div className="rounded-2xl bg-white/5 border border-white/10 shadow-xl shadow-black/20 backdrop-blur p-5">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-lg font-bold text-slate-100 tracking-tight">
              {t.planner.planTitle}
            </h2>
            <button
              onClick={discard}
              className="text-xs text-white/50 hover:text-red-300 underline"
            >
              {t.planner.newPlan}
            </button>
          </div>
          <p className="text-sm text-white/60">
            {done}/{total} {t.planner.tasksComplete}
          </p>
          <div className="h-2 mt-2 rounded-full bg-white/10 overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-accent to-accentdeep rounded-full transition-all"
              style={{ width: total > 0 ? `${Math.round((done / total) * 100)}%` : "0%" }}
            />
          </div>
        </div>

        {plan.days.map((d) => (
          <div
            key={d.day}
            className="rounded-2xl bg-white/5 border border-white/10 shadow-xl shadow-black/20 backdrop-blur p-4"
          >
            <p className="font-bold text-accentlight mb-3">
              📅 Day {d.day}
              {d.label ? ` — ${d.label}` : ""}
            </p>
            <div className="space-y-2">
              {(d.tasks ?? []).map((t, i) => {
                const key = `${d.day}:${i}`;
                return (
                  <label
                    key={key}
                    className="flex items-start gap-3 rounded-xl bg-ink/60 border border-white/5 px-4 py-2.5 cursor-pointer hover:border-accent/40 transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={!!t.done}
                      disabled={toggling === key}
                      onChange={(e) => toggleTask(d.day, i, e.target.checked)}
                      className="mt-1 w-4 h-4 accent-[#8B5CF6]"
                    />
                    <span
                      className={`text-sm ${
                        t.done ? "line-through text-white/40" : "text-white/85"
                      }`}
                    >
                      {t.title}
                      {toggling === key && " …"}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        ))}
        <Err msg={err} />
      </div>
    );
  }

  // ---- builder form
  return (
    <div className="space-y-4">
      <Err msg={err} />
      <div className="rounded-2xl bg-white/5 border border-white/10 shadow-xl shadow-black/20 backdrop-blur p-5">
        <h2 className="text-lg font-bold text-slate-100 tracking-tight mb-1">
          {t.planner.buildTitle}
        </h2>
        <p className="text-sm text-white/60 mb-4">{t.planner.buildDesc}</p>

        <p className="text-xs text-white/50 mb-2">{t.planner.classLabel}</p>
        <select
          value={cls}
          onChange={(e) => {
            setCls(e.target.value);
            setSelected([]);
          }}
          className="rounded-xl bg-ink border border-white/10 px-4 py-2.5 text-white outline-none focus:border-accent mb-4"
        >
          {[6, 7, 8, 9, 10].map((c) => (
            <option key={c} value={c}>
              Class {c}
            </option>
          ))}
        </select>

        <p className="text-xs text-white/50 mb-2">
          Chapters chuno ({selected.length} selected)
        </p>
        <div className="flex flex-wrap gap-2 mb-4">
          {classChapters.length === 0 && (
            <p className="text-sm text-white/50">
              Is class ke liye chapters abhi add nahi hue 🙏
            </p>
          )}
          {classChapters.map((c) => {
            const on = selected.includes(c.id);
            return (
              <button
                key={c.id}
                onClick={() => toggleChapter(c.id)}
                className={`text-xs font-semibold rounded-full px-3 py-1.5 border transition-colors ${
                  on
                    ? "bg-gradient-to-r from-accent to-accentdeep text-white border-transparent"
                    : "bg-transparent text-white/60 border-white/15 hover:border-accent/50"
                }`}
              >
                {on ? "✔ " : ""}
                {c.title} · {c.subject}
              </button>
            );
          })}
        </div>

        <div className="flex flex-col sm:flex-row gap-3 mb-4">
          <label className="flex-1">
            <span className="text-xs text-white/50">{t.planner.daysLabel}</span>
            <input
              type="number"
              min={1}
              max={30}
              value={days}
              onChange={(e) => setDays(e.target.value)}
              className="mt-1 w-full rounded-xl bg-ink border border-white/10 px-4 py-2.5 text-white outline-none focus:border-accent"
            />
          </label>
          <label className="flex-1">
            <span className="text-xs text-white/50">{t.planner.minutesLabel}</span>
            <input
              type="number"
              min={10}
              max={180}
              step={5}
              value={minutes}
              onChange={(e) => setMinutes(e.target.value)}
              className="mt-1 w-full rounded-xl bg-ink border border-white/10 px-4 py-2.5 text-white outline-none focus:border-accent"
            />
          </label>
        </div>

        <button
          onClick={build}
          disabled={building}
          className="w-full rounded-xl bg-gradient-to-r from-accent to-accentdeep text-white font-bold py-3 hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          {building ? t.planner.building : t.planner.build}
        </button>
      </div>

      <div className="rounded-2xl bg-white/5 border border-white/10 p-6 text-center">
        <p className="text-3xl mb-2">🗓</p>
        <p className="text-white/80 font-semibold">{t.planner.noPlanTitle}</p>
        <p className="text-sm text-white/50 mt-1">{t.planner.noPlanDesc}</p>
      </div>
    </div>
  );
}
