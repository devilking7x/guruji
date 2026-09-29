/**
 * Anonymous identity: auto-generated Hindi nicknames like "Chintu-Champion-42".
 * Stored as a "nickname" memory record: {nickname, changed}. A nickname can
 * be changed exactly ONCE; the generated one is used until then.
 */

import { randomInt } from "node:crypto";
import * as memory from "./memory";

const ADJECTIVES = [
  "Chintu", "Mast", "Tez", "Hoshiyar", "Chulbula", "Chatur", "Bahadur",
  "Natkhat", "Mehnati", "Diler", "Chamak", "Samajhdar", "Jolly", "Fauji",
];

const NOUNS = [
  "Champion", "Star", "Tiger", "Scholar", "Hero", "Wizard", "Explorer",
  "Genius", "Captain", "Scientist", "Pandit", "Raja",
];

interface NicknameData {
  nickname: string;
  changed: boolean;
}

/** Hindi/Roman letters + digits (+ hyphen/underscore), 3-20 chars. */
export function isValidNickname(nickname: string): boolean {
  return /^[A-Za-z0-9_\-\u0900-\u097F]{3,20}$/u.test(nickname || "");
}

export function generateNickname(): string {
  const adj = ADJECTIVES[randomInt(ADJECTIVES.length)];
  const noun = NOUNS[randomInt(NOUNS.length)];
  const num = 10 + randomInt(90); // 10-99
  return `${adj}-${noun}-${num}`;
}

function readActive(sid: string): { rec: memory.MemoryRecord; data: NicknameData } | null {
  const rec = memory
    .list(sid)
    .find((r) => r.kind === "nickname" && !r.superseded);
  if (!rec) return null;
  try {
    const data = JSON.parse(rec.text) as Partial<NicknameData>;
    if (typeof data.nickname === "string" && isValidNickname(data.nickname)) {
      return { rec, data: { nickname: data.nickname, changed: data.changed === true } };
    }
  } catch {
    // malformed record: treat as absent
  }
  return null;
}

/**
 * Get the student's nickname, auto-generating + persisting one on first use.
 * canChange is false once the nickname has been changed once.
 */
export function getNickname(studentId: string): { nickname: string; canChange: boolean } {
  const sid = memory.sanitizeStudentId(studentId);
  if (!sid) throw new Error("Valid studentId chahiye.");
  const found = readActive(sid);
  if (found) return { nickname: found.data.nickname, canChange: !found.data.changed };
  const nickname = generateNickname();
  memory.add(sid, JSON.stringify({ nickname, changed: false }), "nickname");
  return { nickname, canChange: true };
}

/**
 * Change the nickname — allowed exactly ONCE. Throws when the nickname was
 * already changed once, or the format is invalid.
 */
export function setNickname(studentId: string, nickname: string): { nickname: string } {
  const sid = memory.sanitizeStudentId(studentId);
  if (!sid) throw new Error("Valid studentId chahiye.");
  const nn = (nickname || "").trim();
  if (!isValidNickname(nn)) {
    throw new Error("Nickname 3-20 characters ka hona chahiye (Hindi/Roman akshar, number, - ya _).");
  }
  const found = readActive(sid);
  if (found && found.data.changed) {
    throw new Error("Nickname sirf ek baar badla ja sakta hai — tum apna mauka use kar chuke ho.");
  }
  if (found) {
    memory.markSupersededIfExists(sid, "nickname", found.data.nickname.toLowerCase());
  }
  memory.add(sid, JSON.stringify({ nickname: nn, changed: true }), "nickname");
  return { nickname: nn };
}
