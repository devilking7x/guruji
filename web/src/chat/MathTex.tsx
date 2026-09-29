/**
 * KaTeX math rendering for tutor messages.
 * Loaded lazily so the KaTeX bundle (~260 kB) only downloads when a message
 * actually contains math. Parse failures fall back to raw text — never crash.
 */
import katex from "katex";
import "katex/dist/katex.min.css";

export function MathTex({ math, display }: { math: string; display: boolean }) {
  let html: string | null = null;
  try {
    // KaTeX escapes its input while building markup, so this is XSS-safe.
    html = katex.renderToString(math, { displayMode: display, throwOnError: true });
  } catch {
    html = null;
  }
  if (html === null) {
    return (
      <span className="font-mono text-[13px] text-white/70 break-all">
        {display ? `$$${math}$$` : `$${math}$`}
      </span>
    );
  }
  return (
    <span
      className={display ? "block overflow-x-auto py-1 my-1" : "inline"}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
