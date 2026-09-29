/**
 * Server-side safety guards — run BEFORE any LLM call (and before spend).
 * Deterministic, zero-network. Refusals are polite Hindi and never mention
 * internal mechanics.
 */

/** Jailbreak / prompt-injection patterns (English + Roman Hindi + Devanagari). */
const JAILBREAK_PATTERNS: RegExp[] = [
  /ignore\s+(all\s+|your\s+|the\s+)?(previous\s+)?(instructions|rules|guidelines)/i,
  /previous\s+instructions/i,
  /(system\s+prompt|tumhara\s+(system\s+)?prompt).{0,30}(dikhao|batao|show|reveal|print|likho)/i,
  /(dikhao|batao|show|reveal).{0,30}(system\s+prompt|tumhare\s+niyam)/i,
  /सिस्टम\s*प्रॉम्प्ट.{0,30}(दिखाओ|बताओ|लिखो)/,
  /(दिखाओ|बताओ).{0,30}सिस्टम\s*प्रॉम्प्ट/,
  /पिछले\s*निर्देश.{0,30}(भूल|भुला|ignore)/,
  /(भूल\s*जाओ|भुला\s*दो).{0,30}(निर्देश|नियम)/,
  /(निर्देश(ों)?|नियम(ों)?).{0,30}(भूल\s*जाओ|भुला\s*दो|भूलो|भुलाओ)/,
  /(नियम|निर्देश).{0,20}(तोड़\s*(दो|डालो)|तोड)/,
  /\bdan\b.{0,20}(mode|do anything now)|do anything now/i,
  /jailbreak/i,
  /developer\s+mode/i,
  /pretend\s+(to\s+be|you\s+are|you're)/i,
  /role\s*play|natak\s+karo/i,
  /tum\s+(ek\s+)?(human|insaan|aadmi)\s+ho/i,
  /tum\s+(asli|real|sachcha)\s+(teacher|insaan|human|guruji)/i,
  /main\s+tumhara\s+(developer|admin|owner|malik|creator)\s+hoon/i,
  /(bhool\s+jao|bhula\s+do).{0,30}(niyam|instructions|rules|hidayat)/i,
  /(niyam|instructions|rules).{0,30}(bhool|bhula)\s+(jao|do|dena)/i,
  /apne.{0,20}(niyam|instructions).{0,20}(bhool|tod|todo|bhula)/i,
  /apne\s+niyam\s+(bhool|tod|todo)/i,
  /\boverride\b.{0,20}(instructions|safety)/i,
  /(girlfriend|boyfriend|pati|patni)\s+bano/i,
  /i[\s_-]+love[\s_-]+you|love[\s_-]+you[\s_-]+guruji/i,
  /mujhse\s+(pyaar|shaadi)/i,
];

/**
 * Self-harm / crisis patterns (English + Roman Hindi + Devanagari).
 * Matched BEFORE jailbreak patterns so a cry for help is never misclassified.
 */
const SELF_HARM_PATTERNS: RegExp[] = [
  /marna\s+(hai|chahta|chahti|chahunga|chahungi|chahta\s+hoon)/i,
  /mar\s+(jana|jaana|jaunga|jaungi|jaana\s+chahta|jana\s+chahta)/i,
  /मरना\s+(है|चाहता|चाहती|चाहूँगा|चाहूँगी)/,
  /मर\s+(जाना|जाऊंगा|जाऊंगी)/,
  /suicide/i,
  /khudkushi|खुदकुशी/,
  /आत्महत्या/,
  /kill\s+myself|killing\s+myself/i,
  /end\s+my\s+life/i,
  /jeena\s+nahi(n)?\s+(chahta|chahti|hai)/i,
  /जीना\s+नहीं\s+(चाहता|चाहती|चाहता\s+हूँ)/,
  /apni\s+jaan\s+(dena|lena|de\s+dunga)/i,
  /अपनी\s+जान\s+(देना|लेना)/,
  /khud\s+ko\s+(nuksaan|nuqsan|chot)/i,
  /खुद\s+को\s+(नुकसान|चोट)/,
  /zindagi\s+khatm\s+kar/i,
  /जिंदगी\s+खत्म\s+कर/,
];

export const JAILBREAK_REFUSAL =
  "Maaf karo, main isme tumhari madad nahi kar sakta 🙂. " +
  "Main Guruji hoon — Classes 6-10 ke Maths aur Science ka tutor. " +
  "Chalo koi padhai ka sawal poochho!";

export const SELF_HARM_REPLY =
  "Ye sunke mujhe tumhari fikr ho rahi hai. Tum akela ye bojh mat uthao — " +
  "kisi bharosemand adult (mata-pita ya teacher) se turant baat karo. " +
  "Agar tumhe abhi madad chahiye to apne aas-paas ke kisi bade se kaho. " +
  "Tumhari zindagi bahut keemti hai. 💛 " +
  "Padhai me main hamesha tumhare saath hoon.";

/** Returns the safe-completion text when input matches a crisis pattern, else null. */
export function checkSelfHarm(text: string): string | null {
  const t = (text || "").slice(0, 2000);
  for (const re of SELF_HARM_PATTERNS) {
    if (re.test(t)) return SELF_HARM_REPLY;
  }
  return null;
}

/** Returns the refusal text when input matches a jailbreak pattern, else null. */
export function checkJailbreak(text: string): string | null {
  const t = (text || "").slice(0, 2000);
  for (const re of JAILBREAK_PATTERNS) {
    if (re.test(t)) return JAILBREAK_REFUSAL;
  }
  return null;
}
