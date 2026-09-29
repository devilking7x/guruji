/** Small shared header controls: language toggle + PWA install button. */
import { useEffect, useState } from "react";
import { useLang, type Lang } from "./i18n";

export function LangToggle({ compact = false }: { compact?: boolean }) {
  const { lang, setLang, t } = useLang();
  const btn = (l: Lang, label: string) => (
    <button
      key={l}
      onClick={() => setLang(l)}
      aria-pressed={lang === l}
      title={t.app.langLabel}
      className={`rounded-full px-3 py-1.5 text-xs font-bold transition-colors ${
        lang === l
          ? "bg-gradient-to-r from-accent to-accentdeep text-white"
          : "text-white/60 hover:text-accentlight"
      }`}
    >
      {label}
    </button>
  );
  return (
    <div
      className={`flex items-center gap-1 rounded-full border border-white/10 bg-white/5 p-1 ${
        compact ? "" : ""
      }`}
      role="group"
      aria-label={t.app.langLabel}
    >
      {btn("hi", "हिन्दी")}
      {btn("mr", "मराठी")}
    </div>
  );
}

/**
 * "Install app" button — only renders when the browser fires
 * beforeinstallprompt (graceful no-op otherwise).
 */
export function InstallButton() {
  const { t } = useLang();
  const [deferred, setDeferred] = useState<any>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferred(e);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  if (!deferred) return null;

  const install = async () => {
    try {
      await deferred.prompt();
    } catch {
      /* user dismissed — stay silent */
    } finally {
      setDeferred(null);
    }
  };

  return (
    <button
      onClick={install}
      className="rounded-full border border-accent/40 text-accentlight text-xs font-bold px-3 py-1.5 hover:border-accent transition-colors"
    >
      {t.app.install}
    </button>
  );
}
