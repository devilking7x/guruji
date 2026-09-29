/**
 * 📸 "Copy check" — notebook photo upload, Guruji ki Hindi Socratic feedback.
 * Camera capture + file picker, client-side type/size validation (<=5MB),
 * preview, and result rendering. Photo kabhi localStorage me save nahi hoti —
 * sirf check ke liye bheji jaati hai, object URL revoke kar diya jaata hai.
 */
import { useEffect, useRef, useState } from "react";
import { postCopyCheck } from "../api";
import { MessageContent } from "../chat/MessageContent";
import { useLang } from "../i18n";

const MAX_BYTES = 5 * 1024 * 1024;

function Err({ msg }: { msg: string }) {
  if (!msg) return null;
  return (
    <p className="text-sm text-red-300 bg-red-950/40 border border-red-500/30 rounded-xl px-3 py-2">
      {msg}
    </p>
  );
}

export default function CopyCheckView({
  classLevel,
}: {
  classLevel?: string | number;
}) {
  const { t } = useLang();
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [subject, setSubject] = useState("Maths");
  const [cls, setCls] = useState(String(classLevel ?? "8"));
  const [checking, setChecking] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const cameraRef = useRef<HTMLInputElement>(null);
  const pickerRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (classLevel !== undefined && classLevel !== null) {
      setCls(String(classLevel));
    }
  }, [classLevel]);

  // Preview URL revoke karo — memory leak bhi nahi, persist bhi nahi.
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const pickFile = (f: File | null) => {
    setErr("");
    setFeedback(null);
    if (!f) return;
    if (!f.type.startsWith("image/")) {
      setErr(t.copycheck.errType);
      return;
    }
    if (f.size > MAX_BYTES) {
      setErr(t.copycheck.errSize);
      return;
    }
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(URL.createObjectURL(f));
    setFile(f);
  };

  const check = async () => {
    if (!file) {
      setErr(t.copycheck.errNone);
      return;
    }
    setChecking(true);
    setErr("");
    setFeedback(null);
    try {
      const r = await postCopyCheck(file, cls, subject);
      setFeedback(r.feedback);
    } catch (e) {
      setErr(e instanceof Error ? e.message : t.copycheck.errCheck);
    } finally {
      setChecking(false);
    }
  };

  const reset = () => {
    setFile(null);
    setFeedback(null);
    setErr("");
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-white/5 border border-white/10 shadow-xl shadow-black/20 backdrop-blur p-5">
        <h2 className="text-lg font-bold text-slate-100 tracking-tight mb-1">
          {t.copycheck.title}
        </h2>
        <p className="text-sm text-white/60 mb-4">{t.copycheck.desc}</p>

        <div className="flex flex-col sm:flex-row gap-3 mb-4">
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
          <select
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="rounded-xl bg-ink border border-white/10 px-4 py-2.5 text-white outline-none focus:border-accent"
            aria-label="Subject"
          >
            <option value="Maths">Maths</option>
            <option value="Science">Science</option>
          </select>
        </div>

        {/* Hidden inputs: camera capture + normal picker */}
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
        />
        <input
          ref={pickerRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
        />

        {!file ? (
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => cameraRef.current?.click()}
              className="rounded-xl bg-gradient-to-r from-accent to-accentdeep text-white font-bold py-3 hover:opacity-90 transition-opacity"
            >
              {t.copycheck.camera}
            </button>
            <button
              onClick={() => pickerRef.current?.click()}
              className="rounded-xl border border-accent/50 text-accentlight font-bold py-3 hover:bg-accent/10 transition-colors"
            >
              {t.copycheck.gallery}
            </button>
          </div>
        ) : (
          <div>
            {previewUrl && (
              <img
                src={previewUrl}
                alt="Notebook photo preview"
                className="rounded-xl border border-white/10 max-h-72 object-contain w-full bg-ink mb-3"
              />
            )}
            <div className="flex flex-col sm:flex-row gap-3">
              <button
                onClick={check}
                disabled={checking}
                className="flex-1 rounded-xl bg-gradient-to-r from-accent to-accentdeep text-white font-bold py-3 hover:opacity-90 disabled:opacity-50 transition-opacity"
              >
                {checking ? t.copycheck.checking : t.copycheck.check}
              </button>
              <button
                onClick={reset}
                disabled={checking}
                className="rounded-xl border border-white/15 text-white/70 font-semibold px-5 py-3 hover:border-white/40 disabled:opacity-40 transition-colors"
              >
                {t.copycheck.newPhoto}
              </button>
            </div>
          </div>
        )}

        <div className="mt-3 space-y-2">
          <Err msg={err} />
          {checking && (
            <p className="text-sm text-accentlight animate-pulse">
              {t.copycheck.checkingNote}
            </p>
          )}
        </div>

        <p className="text-xs text-white/40 mt-4">{t.copycheck.privacy}</p>
      </div>

      {feedback && (
        <div className="rounded-2xl bg-white/5 border border-emerald-500/30 shadow-xl shadow-black/20 backdrop-blur p-5">
          <h3 className="font-bold text-emerald-300 mb-3">{t.copycheck.feedbackTitle}</h3>
          <div className="text-sm leading-relaxed text-white/90">
            <MessageContent text={feedback} rich />
          </div>
        </div>
      )}
    </div>
  );
}
