# 🙏 Guruji — Tumhara Personal AI Tutor

> **Har student ka AI tutor, jo use yaad rakhta hai.** Hindi-first (Roman + Devanagari), Classes 6–10, Maths/Science.

[![Live Demo](https://img.shields.io/badge/demo-live-8B5CF6)](https://devilking7x.github.io/guruji/)
[![API](https://img.shields.io/badge/api-live-green)](https://guruji.onrender.com/api/health)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

**Hackathon:** [Code for a Billion — Bharat Agentic-AI Hackathon 2026](https://codeforindia.org/hackathon) · **Track:** Education · Deadline: 15 Nov 2026

---

## Problem statement

Crores of Indian students study in Hindi or their mother tongue, but almost every AI tutor speaks English first. The result: the students who need the most help get the least understandable answers. Dropout rates and weak learning outcomes follow — not from lack of intelligence, but lack of access.

**Guruji fixes this with three ideas:**
1. **Hindi-first teaching** — sawal Roman Hindi ya Devanagari me, jawab simple Hindi me (technical English terms intact, e.g. *photosynthesis*).
2. **A tutor with memory** — Guruji remembers your name, class, weak topics, and past quiz scores. *"Mujhe yaad hai tumhe fractions me dikkat thi — chalo aaj wahi revise karte hain."*
3. **Socratic, not spoon-fed** — homework ke jawab seedha nahi deta; hints deta hai, tumse sochwata hai. Jaise ek achha teacher.

## Judging-criteria mapping (25% each)

| Criterion | How Guruji scores |
|---|---|
| **Size of problem** | 25+ crore school students in India; majority learn in regional languages |
| **Severity** | Weak foundations in 6–10 decide dropout vs. degree; vernacular gap is worst where help is needed most |
| **Quality of solution** | Strict Socratic hint-ladder tutor + NCERT-grounded RAG (111 chapters) with citations + FSRS revision + adaptive quiz/mastery/XP + copy-check photo feedback + study planner + printable worksheets + teacher dashboard + leaderboard, premium violet-glass UI |
| **Proven impact** | Deployed on free cloud; per-student memory + quiz history = real usage data from day one; teacher dashboard shows anonymous class-level aggregates |

---

## Features

- 💬 **Chat tutor** — streaming answers (SSE), patient-teacher persona, Socratic follow-ups
- 🪜 **Strict hint-ladder** — homework ke final answers KABHI nahi; mistake diagnose karke ek-ek guiding question, hints escalate hote hain (few-shot good/bad dialogues, cross-turn ladder memory)
- 📚 **NCERT-grounded RAG-lite** — **111 original chapter summaries** (Classes 6–10 Maths/Science — poora syllabus) server-side retrieve hote hain; jawab me chapter citations; out-of-syllabus sawalon ko politely refuse
- 🎙 **Voice conversation loop** — mic (hi-IN) → jawab → Hindi TTS readout, speaker toggle; sab client-side, zero cost
- 🧠 **Student memory** — naam, class, weak topics, quiz scores auto-saved (JSON store, 7-op interface)
- 📝 **Adaptive quiz mode** — mastery se difficulty adapt (easy/medium/hard), instant grading + explanations; galat sawal auto-bante hain revision cards
- 🃏 **FSRS revision queue** — "Aaj ka revision" flip cards, deterministic spaced repetition, server computes due cards
- ⭐ **Mastery / XP / streaks / badges** — per-topic mastery 0–100, XP + levels, din-ki-streak, unlockable badges, weak topics ke liye 20-min study plan
- 📐 **Math + diagrams** — KaTeX equations aur Mermaid diagrams chat me render (lazy-loaded, strict sanitization)
- 👪 **Parent report** — weekly mastery deltas, streaks, weak topics, study plan + print view (child-safety visibility)
- 📸 **Copy check** — notebook ka photo lo (camera/file) → Guruji pehli galat step pehchanta hai aur ek guiding question poochhta hai (Socratic, full solution kabhi nahi); photo **process-and-discard** — kabhi save nahi hoti
- 🗓 **Smart study planner** — chapters + bache hue din + roz ke minutes → day-wise checklist plan; due FSRS cards auto-include; check-off karke track karo
- 🖨 **Printable worksheets** — kamzor topics ya chapter se practice sheets, writing space ke saath, ek click me print (teachers ke liye perfect)
- 👩‍🏫 **Teacher dashboard** — class 6–10 ke **anonymous aggregates**: kitne students, topic-wise avg mastery, weakest topics, hafte ke quizzes, active streaks. 3 se kam students par "insufficient data" — naam/ID kabhi nahi
- 🏆 **Leaderboard + daily challenge** — anonymous Hindi nicknames (ek baar change), roz ek class-appropriate sawal, XP bonus; weekly top-10 sirf nicknames ke saath
- 🛡 **Child-safety guardrails** — prompt-injection filter (EN + Roman Hindi + Devanagari jailbreak patterns), self-harm safe-completion, AI-identity disclosure, no romantic/emotional framing, PII minimization
- 🛡 **Demo armor** — per-IP daily token budget, friendly Hindi over-quota message (no surprise bills)

> 🔒 **Privacy:** Guruji sirf nickname + class store karta hai — kabhi phone number, address, school ka naam nahi maangta. Copy-check photos **process-and-discard** hoti hain (disk par save nahi, logs me nahi). Teacher dashboard sirf anonymous aggregates dikhata hai (k-anonymity: 3+ students), leaderboard me sirf nicknames. Saara student data per-student JSON me rehta hai; koi tracker/analytics nahi.

## Quick start (local)

```bash
# 1. Install
pnpm install

# 2. Configure (server) — copy and fill your key
cp .env.example server/.env
# edit server/.env → set LLM_API_KEY (Nebius Token Factory key)

# 3. Run (mock mode needs NO key — for UI testing)
pnpm --filter guruji-server build && (cd server && LLM_MOCK=1 node dist/index.js &)
pnpm --filter guruji-web dev
# open http://localhost:5173
```

Env vars (see `.env.example`): `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`, `LLM_PRICE_INPUT_PER_1M`, `LLM_PRICE_OUTPUT_PER_1M`, `GURUJI_IP_DAILY_CAP_USD`, `GURUJI_AUTO_REMEMBER`, `PORT`.

## Architecture

```
web/ (React+Vite+Tailwind, /guruji/ on GitHub Pages, violet-indigo premium theme)
  │  HTTPS + SSE
  ▼
server/ (Express+TS, Render free tier, Singapore)
  ├── agent.ts      — strict Socratic tutor loop (hint-ladder, few-shot dialogues, chapter citations)
  ├── guard.ts      — prompt-injection + self-harm filters (EN/Roman-Hindi/Devanagari), zero-LLM refusals
  ├── llm.ts        — OpenAI-compatible client, 429/5xx retry, streaming, LLM_MOCK=1 test mode
  ├── quiz.ts       — adaptive MCQ generation (mastery-based difficulty) + grading + XP/streak/mastery
  ├── srs.ts        — FSRS-lite spaced-repetition scheduler (deterministic, no LLM cost)
  ├── mastery.ts    — per-topic mastery 0–100, XP, IST streaks, badges
  ├── chapters.ts   — RAG-lite retrieval over data/chapters/ (111 original summaries, TF-IDF, ~40ms)
  ├── copycheck.ts  — Socratic vision feedback (process-and-discard, magic-byte validated)
  ├── planner.ts    — deterministic day-wise study plans (data/plans-<sid>.json, FSRS-aware)
  ├── teacher.ts    — anonymous class aggregates (k-anonymity ≥ 3 students)
  ├── challenge.ts  — deterministic daily MCQ per class (cached, once/day)
  ├── leaderboard.ts— weekly XP top-10, nicknames only
  ├── nickname.ts   — auto Hindi nicknames, one-time change
  ├── multipart.ts  — dependency-free multipart parser (magic-byte image detection)
  ├── memory.ts     — per-student JSON store, atomic writes, keyword search
  └── budget.ts     — per-IP daily spend cap (atomic ip-spend.json, IST rollover; vision/planner/worksheet spend attributed)
```

No secrets in the repo — `LLM_API_KEY` is set in the Render dashboard only. Memory JSONs live in `data/` (gitignored; ephemeral on Render free tier — fine for the demo).

## Deploy (Render)

1. Render dashboard → **New → Web Service** → connect `devilking7x/guruji` repo
2. Region **Singapore**, plan **Free** — `render.yaml` fills build/start/health-check automatically
3. **Environment** tab → add `LLM_API_KEY` = your Nebius Token Factory key → **Deploy**
4. Copy the service URL (e.g. `https://guruji.onrender.com`) → set it as `VITE_API_URL` in `web/.env.production` → commit + push (frontend rebuilds on GitHub Pages)

## Roadmap

- [x] Copy check — notebook photo se Socratic feedback (vision model)
- [x] Full NCERT coverage — 111 chapters (Classes 6–10 Maths/Science)
- [x] Smart study planner + printable worksheets
- [x] Teacher dashboard (anonymous aggregates) + leaderboard/daily challenge
- [x] Parent report view (weekly mastery deltas + print)
- [ ] Offline question bank for low-connectivity areas
- [ ] More subjects (SST, English grammar)
- [ ] Quiz topic off-syllabus filter (optional)

---

Built with ❤️ for the students of Bharat. MIT licensed.
