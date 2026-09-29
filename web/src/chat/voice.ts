/**
 * Hindi voice loop helpers — Web Speech API (input) + speechSynthesis (output).
 * Everything is client-side and free. All failures degrade to text chat.
 */

const SPEAK_KEY = "guruji-speak-enabled";

export function getSpeakEnabled(): boolean {
  try {
    const v = localStorage.getItem(SPEAK_KEY);
    return v === null ? true : v === "1";
  } catch {
    return true;
  }
}

export function setSpeakEnabled(on: boolean): void {
  try {
    localStorage.setItem(SPEAK_KEY, on ? "1" : "0");
  } catch {
    /* storage unavailable — toggle still works for this session */
  }
}

export function supportsTTS(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

let cachedVoices: SpeechSynthesisVoice[] | null = null;

function allVoices(): SpeechSynthesisVoice[] {
  if (!supportsTTS()) return [];
  if (cachedVoices === null) {
    try {
      cachedVoices = window.speechSynthesis.getVoices();
    } catch {
      cachedVoices = [];
    }
  }
  return cachedVoices;
}

// Voices load async in some browsers — refresh the cache when they arrive.
if (typeof window !== "undefined" && "speechSynthesis" in window) {
  try {
    window.speechSynthesis.onvoiceschanged = () => {
      cachedVoices = null;
    };
  } catch {
    /* ignore */
  }
}

/** Prefer an hi-IN voice, fall back to any Hindi voice, else null. */
export function pickHindiVoice(): SpeechSynthesisVoice | null {
  const vs = allVoices();
  return (
    vs.find((v) => !!v.lang && v.lang.toLowerCase() === "hi-in") ??
    vs.find((v) => !!v.lang && v.lang.toLowerCase().startsWith("hi")) ??
    null
  );
}

/**
 * Strip markdown / math / diagrams down to speakable plain text.
 * Math is dropped (reading raw TeX aloud is noise); diagrams are skipped.
 */
export function cleanForSpeech(text: string): string {
  return text
    .replace(/```mermaid[\s\S]*?```/g, " ")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\$\$[\s\S]*?\$\$/g, " ")
    .replace(/\$([^$\n]+)\$/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/[*_#>`|]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1200);
}

export function speakHindi(text: string): void {
  if (!supportsTTS()) return;
  const clean = cleanForSpeech(text);
  if (!clean) return;
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(clean);
    u.lang = "hi-IN";
    const v = pickHindiVoice();
    if (v) u.voice = v;
    u.rate = 0.95;
    window.speechSynthesis.speak(u);
  } catch {
    /* TTS failed — chat still works, stay silent */
  }
}

export function stopSpeaking(): void {
  if (!supportsTTS()) return;
  try {
    window.speechSynthesis.cancel();
  } catch {
    /* ignore */
  }
}
