/**
 * 📝 "Worksheet" — printable practice sheet: chapter ya weak topics chuno,
 * sawalon ki sankhya -> POST /api/worksheet -> print view with ruled
 * writing space + "🖨 Print karo" (print CSS .worksheet-sheet hides nav).
 */
import { useEffect, useState } from "react";
import { CHAPTERS, generateWorksheet, waShareUrl, type ProgressData, type Worksheet } from "../api";
import { useLang } from "../i18n";

function Err({ msg }: { msg: string }) {
  if (!msg) return null;
  return (
    <p className="text-sm text-red-300 bg-red-950/40 border border-red-500/30 rounded-xl px-3 py-2">
      {msg}
    </p>
  );
}

const LINES_PER_QUESTION = 8;

export default function WorksheetView({
  progress,
}: {
  progress: ProgressData | null;
}) {
  const { t } = useLang();
  const [cls, setCls] = useState(
    String(progress?.student.classLevel ?? "8")
  );
  const [mode, setMode] = useState<"chapter" | "weak">("chapter");
  const [chapterId, setChapterId] = useState("");
  const [count, setCount] = useState("10");
  const [sheet, setSheet] = useState<Worksheet | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (progress?.student.classLevel) {
      setCls(String(progress.student.classLevel));
    }
  }, [progress]);

  const classChapters = CHAPTERS.filter((c) => c.class === cls);
  const weakTopics = progress?.weakTopics ?? [];

  const generate = async () => {
    const n = Number(count);
    if (mode === "chapter" && !chapterId) {
      setErr(t.worksheet.errChapter);
      return;
    }
    if (mode === "weak" && weakTopics.length === 0) {
      setErr(t.worksheet.errWeak);
      return;
    }
    setBusy(true);
    setErr("");
    setSheet(null);
    try {
      const body =
        mode === "chapter"
          ? { class: cls, chapterId, count: n }
          : { class: cls, topics: weakTopics, count: n };
      setSheet(await generateWorksheet(body));
    } catch (e) {
      setErr(e instanceof Error ? e.message : t.common.retry);
    } finally {
      setBusy(false);
    }
  };

  const printSheet = () => window.print();

  return (
    <div className="space-y-4">
      {/* builder (hidden in print via no-print) */}
      <div className="no-print rounded-2xl bg-white/5 border border-white/10 shadow-xl shadow-black/20 backdrop-blur p-5">
        <h2 className="text-lg font-bold text-slate-100 tracking-tight mb-1">
          {t.worksheet.buildTitle}
        </h2>
        <p className="text-sm text-white/60 mb-4">{t.worksheet.buildDesc}</p>

        <div className="flex gap-2 mb-4">
          <button
            onClick={() => setMode("chapter")}
            className={`flex-1 text-sm font-semibold rounded-xl px-4 py-2.5 border transition-colors ${
              mode === "chapter"
                ? "bg-gradient-to-r from-accent to-accentdeep text-white border-transparent"
                : "bg-transparent text-white/60 border-white/15 hover:border-accent/50"
            }`}
          >
            {t.worksheet.chapterMode}
          </button>
          <button
            onClick={() => setMode("weak")}
            className={`flex-1 text-sm font-semibold rounded-xl px-4 py-2.5 border transition-colors ${
              mode === "weak"
                ? "bg-gradient-to-r from-accent to-accentdeep text-white border-transparent"
                : "bg-transparent text-white/60 border-white/15 hover:border-accent/50"
            }`}
          >
            {t.worksheet.weakMode}
          </button>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 mb-4">
          <select
            value={cls}
            onChange={(e) => {
              setCls(e.target.value);
              setChapterId("");
            }}
            className="rounded-xl bg-ink border border-white/10 px-4 py-2.5 text-white outline-none focus:border-accent"
            aria-label="Class"
          >
            {[6, 7, 8, 9, 10].map((c) => (
              <option key={c} value={c}>
                Class {c}
              </option>
            ))}
          </select>

          {mode === "chapter" ? (
            <select
              value={chapterId}
              onChange={(e) => setChapterId(e.target.value)}
              className="flex-1 rounded-xl bg-ink border border-white/10 px-4 py-2.5 text-white outline-none focus:border-accent"
              aria-label="Chapter"
            >
              <option value="">{t.worksheet.chapterPh}</option>
              {classChapters.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title} · {c.subject}
                </option>
              ))}
            </select>
          ) : (
            <div className="flex-1 rounded-xl bg-ink border border-white/10 px-4 py-2.5 text-sm text-white/70">
              {weakTopics.length > 0 ? (
                <span className="flex flex-wrap gap-1.5">
                  {weakTopics.map((t) => (
                    <span
                      key={t}
                      className="bg-red-950/50 border border-red-500/40 text-red-200 rounded-full px-2.5 py-0.5 text-xs"
                    >
                      📉 {t}
                    </span>
                  ))}
                </span>
              ) : (
                t.worksheet.weakEmpty
              )}
            </div>
          )}

          <select
            value={count}
            onChange={(e) => setCount(e.target.value)}
            className="rounded-xl bg-ink border border-white/10 px-4 py-2.5 text-white outline-none focus:border-accent"
            aria-label="Question count"
          >
            {[5, 10, 15, 20].map((n) => (
              <option key={n} value={n}>
                {n} sawal
              </option>
            ))}
          </select>
        </div>

        <button
          onClick={generate}
          disabled={busy}
          className="w-full rounded-xl bg-gradient-to-r from-accent to-accentdeep text-white font-bold py-3 hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          {busy ? t.worksheet.making : t.worksheet.make}
        </button>
        <div className="mt-3">
          <Err msg={err} />
        </div>
      </div>

      {/* printable sheet */}
      {sheet && (
        <div className="worksheet-sheet rounded-2xl bg-white/[0.03] border border-white/10 p-6">
          <div className="flex items-start justify-between gap-3 mb-1">
            <div>
              <h3 className="text-xl font-extrabold">{sheet.title}</h3>
              {sheet.class && (
                <p className="text-sm opacity-70">Class {sheet.class}</p>
              )}
            </div>
            <div className="no-print flex gap-2 shrink-0 flex-wrap justify-end">
              <a
                href={waShareUrl(
                  `${t.share.worksheetPrefix} "${sheet.title}" — ${sheet.questions.length} ${t.worksheet.countLabel}.\n${t.share.worksheetEncourage}\n${t.share.appLink}`
                )}
                target="_blank"
                rel="noopener noreferrer"
                title={t.common.shareWhatsApp}
                className="rounded-xl border border-emerald-500/40 text-emerald-200 text-sm font-bold px-4 py-2.5 hover:bg-emerald-500/10 transition-colors"
              >
                {t.common.shareWhatsApp}
              </a>
              <button
                onClick={printSheet}
                className="rounded-xl bg-gradient-to-r from-accent to-accentdeep text-white font-bold px-5 py-2.5 hover:opacity-90 transition-opacity"
              >
                {t.worksheet.print}
              </button>
            </div>
          </div>

          <div className="rounded-xl border px-4 py-3 mb-6 text-sm leading-relaxed">
            <p className="font-bold mb-1">{t.worksheet.instructions}</p>
            <ul className="list-disc list-inside space-y-0.5 opacity-80">
              <li>Har sawal ka jawab neeche di gayi jagah me likho.</li>
              <li>Pehle khud socho, phir likho — jaldi mat karo.</li>
              <li>Galat hua to bhi koi baat nahi — Guruji se poochh lo! 🙏</li>
            </ul>
          </div>

          {sheet.questions.map((q) => (
            <div key={q.n} className="mb-6 break-inside-avoid">
              <p className="font-semibold mb-1">
                {q.n}. {q.q}
              </p>
              {q.hint && (
                <p className="text-xs italic opacity-60 mb-2">💡 Hint: {q.hint}</p>
              )}
              <div aria-hidden>
                {Array.from({ length: LINES_PER_QUESTION }).map((_, i) => (
                  <div key={i} className="h-7 border-b border-slate-300/60" />
                ))}
              </div>
            </div>
          ))}

          <p className="text-center text-xs opacity-50 mt-8">{t.worksheet.footer}</p>
        </div>
      )}
    </div>
  );
}
