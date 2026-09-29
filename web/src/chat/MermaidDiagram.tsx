/**
 * Mermaid diagram rendering for tutor messages.
 * Loaded lazily so the mermaid bundle only downloads when a message actually
 * contains a ```mermaid block. securityLevel "strict" sanitizes the SVG.
 */
import { useEffect, useRef, useState } from "react";
import mermaid from "mermaid";

let mermaidReady = false;
function ensureMermaid(): void {
  if (!mermaidReady) {
    mermaid.initialize({
      securityLevel: "strict",
      theme: "dark",
      startOnLoad: false,
    });
    mermaidReady = true;
  }
}
let mmdSeq = 0;

export function MermaidDiagram({ code }: { code: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const renderRef = useRef(0);

  useEffect(() => {
    ensureMermaid();
    let alive = true;
    renderRef.current += 1;
    // Unique id per render — mermaid injects temp nodes keyed by id.
    const id = `guruji-mmd-${mmdSeq++}-r${renderRef.current}`;
    setFailed(false);
    setSvg(null);
    mermaid.render(id, code).then(
      (res) => {
        if (alive) setSvg(res.svg);
      },
      () => {
        // Invalid / incomplete diagram (common mid-stream) — show raw code.
        if (alive) setFailed(true);
      }
    );
    return () => {
      alive = false;
    };
  }, [code]);

  if (failed) {
    return (
      <pre className="text-xs bg-ink border border-white/10 rounded-xl p-3 my-2 overflow-x-auto whitespace-pre-wrap text-white/70">
        {code}
      </pre>
    );
  }
  if (!svg) {
    return <div className="text-xs text-white/40 py-2">📊 Diagram ban raha…</div>;
  }
  return (
    <div
      className="my-2 overflow-x-auto rounded-xl bg-white/5 border border-white/10 backdrop-blur p-2"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
