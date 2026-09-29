/**
 * 🏆 "Challenge" — daily challenge: nickname (one-time change), aaj ka
 * sawal, jawab -> XP + feedback, weekly leaderboard (nicknames only),
 * streak display.
 */
import { useCallback, useEffect, useState } from "react";
import {
  answerChallenge,
  getLeaderboard,
  getNickname,
  getTodayChallenge,
  setNickname,
  type Leaderboard,
  type TodayChallenge,
  waShareUrl,
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

function Info({ msg }: { msg: string }) {
  if (!msg) return null;
  return (
    <p className="text-sm text-emerald-200 bg-emerald-950/40 border border-emerald-500/30 rounded-xl px-3 py-2">
      {msg}
    </p>
  );
}

export default function ChallengeView({
  classLevel,
}: {
  classLevel?: string | number;
}) {
  const { t } = useLang();
  const [nickname, setNicknameState] = useState("");
  const [canChange, setCanChange] = useState(false);
  const [editing, setEditing] = useState(false);
  const [nickInput, setNickInput] = useState("");
  const [nickBusy, setNickBusy] = useState(false);

  const [today, setToday] = useState<TodayChallenge | null>(null);
  const [board, setBoard] = useState<Leaderboard | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  const [answering, setAnswering] = useState(false);
  const [answered, setAnswered] = useState(false);
  const [verdict, setVerdict] = useState<"" | "correct" | "wrong">("");
  const [xpNote, setXpNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const [n, t, b] = await Promise.all([
        getNickname(),
        getTodayChallenge(classLevel),
        getLeaderboard(classLevel),
      ]);
      setNicknameState(n.nickname);
      setNickInput(n.nickname);
      setCanChange(n.canChange);
      setToday(t);
      setBoard(b);
      setAnswered(t.alreadyAnswered);
    } catch (e) {
      setErr(e instanceof Error ? e.message : t.challenge.loadErr);
    } finally {
      setLoading(false);
    }
  }, [classLevel]);

  useEffect(() => {
    load();
  }, [load]);

  const saveNickname = async () => {
    const v = nickInput.trim();
    if (!v) {
      setErr(t.challenge.nickErrEmpty);
      return;
    }
    if (v.length > 24) {
      setErr(t.challenge.nickErrLong);
      return;
    }
    setNickBusy(true);
    setErr("");
    try {
      const n = await setNickname(v);
      setNicknameState(n.nickname);
      setCanChange(n.canChange);
      setEditing(false);
      // Nickname change -> leaderboard reload (nickname badal gaya hoga).
      setBoard(await getLeaderboard(classLevel));
    } catch (e) {
      setErr(e instanceof Error ? e.message : t.challenge.nickErrSave);
    } finally {
      setNickBusy(false);
    }
  };

  const submitAnswer = async () => {
    if (!today?.question || picked === null || answering || answered) return;
    setAnswering(true);
    setErr("");
    try {
      const r = await answerChallenge(today.question.id, picked, classLevel);
      setAnswered(true);
      setVerdict(r.correct ? "correct" : "wrong");
      setXpNote(
        r.correct
          ? `+${r.xpAwarded} XP mil gaye! 🎉`
          : r.message || "Koi baat nahi — kal phir try karo! 💪"
      );
      // Leaderboard fresh karo taaki XP dikhe.
      setBoard(await getLeaderboard(classLevel));
    } catch (e) {
      setErr(e instanceof Error ? e.message : t.challenge.answerErr);
    } finally {
      setAnswering(false);
    }
  };

  if (loading) {
    return <p className="text-white/50 text-sm">{t.challenge.loading}</p>;
  }

  const q = today?.question ?? null;
  const entries = (board?.entries ?? []).slice(0, 10);

  return (
    <div className="space-y-4">
      <Err msg={err} />

      {/* nickname card */}
      <div className="rounded-2xl bg-white/5 border border-white/10 shadow-xl shadow-black/20 backdrop-blur p-5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <p className="text-xs text-white/50">{t.challenge.nicknameLabel}</p>
            {!editing ? (
              <p className="text-xl font-extrabold text-accentlight">
                🏷 {nickname || "—"}
              </p>
            ) : (
              <div className="flex gap-2 mt-1">
                <input
                  value={nickInput}
                  onChange={(e) => setNickInput(e.target.value)}
                  maxLength={24}
                  placeholder="Naya nickname"
                  className="rounded-xl bg-ink border border-white/10 px-4 py-2 text-white placeholder-white/30 outline-none focus:border-accent"
                />
                <button
                  onClick={saveNickname}
                  disabled={nickBusy}
                  className="rounded-xl bg-gradient-to-r from-accent to-accentdeep text-white font-bold px-4 py-2 disabled:opacity-50 hover:opacity-90 transition-opacity"
                >
                  {nickBusy ? "…" : "✔"}
                </button>
                <button
                  onClick={() => {
                    setEditing(false);
                    setNickInput(nickname);
                  }}
                  className="rounded-xl border border-white/15 text-white/60 px-4 py-2 hover:border-white/40 transition-colors"
                >
                  ✕
                </button>
              </div>
            )}
          </div>
          {!editing && canChange && (
            <button
              onClick={() => setEditing(true)}
              className="text-xs font-bold border border-accent/50 text-accentlight rounded-full px-4 py-2 hover:bg-accent/10 transition-colors"
            >
              {t.challenge.change}
            </button>
          )}
          {!editing && !canChange && (
            <span className="text-xs text-white/40">{t.challenge.locked}</span>
          )}
        </div>
      </div>

      {/* today's question */}
      <div className="rounded-2xl bg-white/5 border border-white/10 shadow-xl shadow-black/20 backdrop-blur p-5">
        <h3 className="font-bold text-slate-100 tracking-tight mb-1">
          {t.challenge.todayTitle}
        </h3>
        {!q ? (
          <div className="text-center py-6">
            <p className="text-3xl mb-2">🏆</p>
            <p className="text-white/80 font-semibold">{t.challenge.noQTitle}</p>
            <p className="text-sm text-white/50 mt-1">{t.challenge.noQDesc}</p>
          </div>
        ) : (
          <>
            <p className="text-xs text-accentlight mb-2">
              📚 {q.topic}
              {today?.streak !== undefined && today.streak > 0 && (
                <span className="ml-2 text-emerald-300">🔥 {today.streak} {t.challenge.streakDays}</span>
              )}
            </p>
            <p className="font-semibold text-white/90 mb-3">{q.text}</p>
            <div className="grid gap-2 mb-3">
              {q.options.map((opt, i) => {
                const isPicked = picked === i;
                const locked = answered;
                return (
                  <button
                    key={i}
                    disabled={locked}
                    onClick={() => setPicked(i)}
                    className={`text-left text-sm rounded-xl px-4 py-2.5 border transition-colors ${
                      isPicked
                        ? "bg-accent/20 border-accent text-accentlight font-semibold"
                        : "bg-ink border-white/10 text-white/80 hover:border-accent/50"
                    } ${locked ? "opacity-70 cursor-not-allowed" : ""}`}
                  >
                    <span className="font-bold mr-2">{["A", "B", "C", "D"][i]}.</span>
                    {opt}
                  </button>
                );
              })}
            </div>
            {!answered ? (
              <button
                onClick={submitAnswer}
                disabled={picked === null || answering}
                className="w-full rounded-xl bg-gradient-to-r from-accent to-accentdeep text-white font-bold py-3 hover:opacity-90 disabled:opacity-40 transition-opacity"
              >
                {answering ? t.challenge.answering : t.challenge.answer}
              </button>
            ) : (
              <div className="space-y-2">
                {verdict === "correct" && (
                  <>
                    <Info msg={`✅ ${t.challenge.correct} ${xpNote}`} />
                    <a
                      href={waShareUrl(
                        `${t.share.challengePrefix} — ${nickname}${today?.streak ? ` (🔥 ${today.streak} ${t.challenge.streakDays})` : ""}\n${t.share.challengeEncourage}\n${t.share.appLink}`
                      )}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block text-center rounded-xl border border-emerald-500/40 text-emerald-200 text-sm font-bold px-5 py-2.5 hover:bg-emerald-500/10 transition-colors"
                    >
                      {t.common.shareWhatsApp}
                    </a>
                  </>
                )}
                {verdict === "wrong" && (
                  <Err msg={`❌ ${t.challenge.wrong} ${xpNote}`} />
                )}
                {verdict === "" && (
                  <Info msg={t.challenge.alreadyDone} />
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* leaderboard */}
      <div className="rounded-2xl bg-white/5 border border-white/10 shadow-xl shadow-black/20 backdrop-blur p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold text-slate-100 tracking-tight">
            {t.challenge.boardTitle}
          </h3>
          {board?.week && <span className="text-xs text-white/40">{board.week}</span>}
        </div>
        {entries.length === 0 ? (
          <div className="text-center py-6">
            <p className="text-3xl mb-2">🏁</p>
            <p className="text-white/80 font-semibold">{t.challenge.noEntriesTitle}</p>
            <p className="text-sm text-white/50 mt-1">{t.challenge.noEntriesDesc}</p>
          </div>
        ) : (
          <ol className="space-y-2">
            {entries.map((e, i) => {
              const me = e.nickname === nickname && nickname !== "";
              const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}.`;
              return (
                <li
                  key={`${e.nickname}-${i}`}
                  className={`flex items-center justify-between rounded-xl px-4 py-2.5 border ${
                    me
                      ? "bg-accent/15 border-accent/50"
                      : "bg-ink/60 border-white/5"
                  }`}
                >
                  <span className="text-sm font-semibold text-white/90 min-w-0 truncate">
                    {medal} {e.nickname}
                    {me && <span className="text-accentlight text-xs ml-1">{t.challenge.you}</span>}
                  </span>
                  <span className="text-sm shrink-0">
                    <span className="font-bold text-accentlight">{e.xp} {t.challenge.xpSuffix}</span>
                    {e.streak > 0 && (
                      <span className="text-emerald-300 text-xs ml-2">🔥{e.streak}</span>
                    )}
                  </span>
                </li>
              );
            })}
          </ol>
        )}
        <button
          onClick={load}
          className="mt-3 w-full text-xs text-accentlight border border-accent/40 rounded-full px-3 py-2 hover:border-accent transition-colors"
        >
          {t.challenge.refreshBoard}
        </button>
      </div>

      <p className="text-xs text-white/40 text-center px-4">{t.challenge.privacyNote}</p>
    </div>
  );
}
