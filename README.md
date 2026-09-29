# 🙏 Guruji — Tumhara Personal AI Tutor

> **Har student ka AI tutor, jo use yaad rakhta hai.** Hindi-first (Roman + Devanagari), Classes 6–10, Maths/Science.

[![Live Demo](https://img.shields.io/badge/demo-live-gold)](https://devilking7x.github.io/guruji/)
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
| **Quality of solution** | Streaming Hindi tutor + quiz engine + spaced revision + progress tracking, dark+gold polished UI |
| **Proven impact** | Deployed on free cloud; per-student memory + quiz history = real usage data from day one |

---

## Features

- 💬 **Chat tutor** — streaming answers (SSE), patient-teacher persona, Socratic follow-ups
- 🎙 **Voice input** — Hindi (hi-IN) speech recognition, no typing needed
- 🧠 **Student memory** — naam, class, weak topics, quiz scores auto-saved (JSON store, 7-op interface)
- 📝 **Quiz mode** — "quiz lo" → LLM-generated MCQs, instant grading, explanations
- 🔁 **Revision mode** — weak topics se spaced revision prompts
- 📊 **Progress view** — topics covered, quiz score history (100% real data, no fake charts)
- 🛡 **Demo armor** — per-IP daily token budget, friendly Hindi over-quota message (no surprise bills)

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
web/ (React+Vite+Tailwind, /guruji/ on GitHub Pages)
  │  HTTPS + SSE
  ▼
server/ (Express+TS, Render free tier, Singapore)
  ├── agent.ts      — tutor loop: persona + tools (memory_search/add), max 3 iters
  ├── llm.ts        — OpenAI-compatible client, 429/5xx retry, streaming
  ├── quiz.ts       — MCQ generation (LLM JSON mode) + grading + weak-topic update
  ├── memory.ts     — per-student JSON store, atomic writes, keyword search
  └── budget.ts     — per-IP daily spend cap (atomic ip-spend.json, IST rollover)
```

No secrets in the repo — `LLM_API_KEY` is set in the Render dashboard only. Memory JSONs live in `data/` (gitignored; ephemeral on Render free tier — fine for the demo).

## Deploy (Render)

1. Render dashboard → **New → Web Service** → connect `devilking7x/guruji` repo
2. Region **Singapore**, plan **Free** — `render.yaml` fills build/start/health-check automatically
3. **Environment** tab → add `LLM_API_KEY` = your Nebius Token Factory key → **Deploy**
4. Copy the service URL (e.g. `https://guruji.onrender.com`) → set it as `VITE_API_URL` in `web/.env.production` → commit + push (frontend rebuilds on GitHub Pages)

## Roadmap

- [ ] Devanagari handwriting/photo questions (vision model)
- [ ] Parent/teacher dashboard
- [ ] Offline question bank for low-connectivity areas
- [ ] More subjects (SST, English grammar)

---

Built with ❤️ for the students of Bharat. MIT licensed.
