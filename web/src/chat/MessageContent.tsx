/**
 * Rich rendering for TUTOR messages only:
 * - ```mermaid blocks -> SVG diagrams (lazy-loaded mermaid, strict security)
 * - $$...$$ / $...$ math -> KaTeX (lazy-loaded; falls back to raw text on error)
 * - everything else -> **bold** + line breaks
 * Student messages are always rendered as plain text by the caller.
 */
import { Suspense, lazy } from "react";
import { splitSegments } from "./parse";

const MathTex = lazy(() =>
  import("./MathTex").then((m) => ({ default: m.MathTex }))
);
const MermaidDiagram = lazy(() =>
  import("./MermaidDiagram").then((m) => ({ default: m.MermaidDiagram }))
);

/** Minimal rich text: **bold** (line breaks come from CSS whitespace-pre-wrap). */
function renderRich(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, i) =>
    p.startsWith("**") && p.endsWith("**") && p.length > 4 ? (
      <strong key={i} className="text-accentlight font-semibold">
        {p.slice(2, -2)}
      </strong>
    ) : (
      <span key={i}>{p}</span>
    )
  );
}

export function MessageContent({ text, rich }: { text: string; rich: boolean }) {
  if (!rich) return <>{text}</>;
  const segs = splitSegments(text);
  return (
    <>
      {segs.map((s, i) => {
        if (s.kind === "mermaid")
          return (
            <Suspense key={i} fallback={<div className="text-xs text-white/40 py-2">📊 Diagram load ho raha…</div>}>
              <MermaidDiagram code={s.code} />
            </Suspense>
          );
        if (s.kind === "math")
          return (
            <Suspense key={i} fallback={<span className="font-mono text-[13px] text-white/70">{s.display ? `$$${s.math}$$` : `$${s.math}$`}</span>}>
              <MathTex math={s.math} display={s.display} />
            </Suspense>
          );
        return <span key={i}>{renderRich(s.text)}</span>;
      })}
    </>
  );
}
