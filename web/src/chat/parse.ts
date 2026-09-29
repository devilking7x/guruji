/**
 * Pure parsing helpers for chat message rendering.
 * No React / DOM here so the logic stays unit-testable in plain node.
 */

export type Segment =
  | { kind: "text"; text: string }
  | { kind: "math"; math: string; display: boolean }
  | { kind: "mermaid"; code: string };

const MERMAID_FENCE = /```mermaid[ \t]*\r?\n([\s\S]*?)```/g;
const DISPLAY_MATH = /\$\$([\s\S]+?)\$\$/g;
// Inline $...$: the inner text must contain at least one math-ish character,
// so prices like $5 are left alone. Lookarounds keep $$...$$ from clashing.
const INLINE_MATH =
  /(?<!\$)\$(?!\$)([^$\n]*[\\^_{}=+\-*/|<>×÷⋅][^$\n]*)\$(?!\$)/g;

function splitInlineMath(chunk: string): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  INLINE_MATH.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = INLINE_MATH.exec(chunk)) !== null) {
    if (m.index > last) out.push({ kind: "text", text: chunk.slice(last, m.index) });
    out.push({ kind: "math", math: m[1], display: false });
    last = m.index + m[0].length;
  }
  if (last < chunk.length) out.push({ kind: "text", text: chunk.slice(last) });
  return out;
}

function splitDisplayMath(chunk: string): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  DISPLAY_MATH.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = DISPLAY_MATH.exec(chunk)) !== null) {
    if (m.index > last) out.push(...splitInlineMath(chunk.slice(last, m.index)));
    out.push({ kind: "math", math: m[1].trim(), display: true });
    last = m.index + m[0].length;
  }
  if (last < chunk.length) out.push(...splitInlineMath(chunk.slice(last)));
  return out;
}

/**
 * Split a tutor message into renderable segments:
 * mermaid fences first, then $$display$$ math, then $inline$ math,
 * everything else stays plain text.
 */
export function splitSegments(src: string): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  MERMAID_FENCE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = MERMAID_FENCE.exec(src)) !== null) {
    if (m.index > last) out.push(...splitDisplayMath(src.slice(last, m.index)));
    out.push({ kind: "mermaid", code: m[1].trim() });
    last = m.index + m[0].length;
  }
  if (last < src.length) out.push(...splitDisplayMath(src.slice(last)));
  return out.filter((s) => (s.kind === "text" ? s.text.length > 0 : true));
}
