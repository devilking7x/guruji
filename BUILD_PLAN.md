# 🛠 Guruji — Build Plan to Nov 15

> **Hackathon:** Code for a Billion (Education track) · **Deadline:** 15 Nov 2026 · **Winners:** 5 Dec 2026 · **Prize:** ₹18,00,000
> **Rules:** Public GitHub repo + README · 2–3 min demo video · deployed by 15 Nov · MIT/Apache-2.0
> **Submit via:** AgentFoundry.me (user signs up with email OTP)

## ✅ Status verified 2026-10-15

| Item | State |
|---|---|
| Repo `devilking7x/guruji` | Public, MIT, in sync (7 commits, last 29 Sep) |
| `web/` (React+Vite+Tailwind) | Builds clean, **LIVE** at https://devilking7x.github.io/guruji/ |
| `server/` (Express+TS, 20 modules) | Typecheck + build clean, `/api/health` + quiz smoke-tested in mock mode |
| 111 NCERT chapter summaries | Present (`server/data/chapters/`) |
| All views (Chat, Quiz, Revision, Planner, Worksheet, CopyCheck, Teacher, Parent, Leaderboard, Notebook, Poster, Landing) | Implemented |
| Demo video script | Written (`docs/DEMO.md`, ~2:45 Roman Hindi) |
| **Backend** | ✅ **Vercel-ready** (2026-10-15) — `api/index.ts` serverless wrapper, `vercel.json` configured, Express exports app on Vercel |\n| **Deploy target** | **Vercel** (user decision 2026-10-15, was Render) |

### Stack (already chosen, validated)
**React + Vite + Tailwind** (frontend, GitHub Pages) + **Express + TypeScript** (backend, Render Singapore free tier) + **pnpm monorepo** + **Nebius LLM** (server-side key) + **JSON file store** (per-student memory, ephemeral on free tier — fine for demo).
Why it wins: one-repo deploys, zero-cost AI (mock mode for UI, capped spend per IP), no DB ops overhead, and the judging rubric rewards *deployed + real usage* over infra complexity.

---

## Phase A — Backend live + end-to-end (Oct 15–20) 🔴 BLOCKER

**Deploy target: VERCEL** (user decision 2026-10-15)

1. **[USER]** Vercel dashboard → Add New → Project → Import `devilking7x/guruji` → Framework: Vite → Root Directory: `./` (vercel.json handles it) → Env vars: `LLM_API_KEY` (Nebius key), `LLM_MOCK=0` → Deploy.
2. **[USER]** Copy the Vercel URL (e.g. `guruji.vercel.app`) → set `VITE_API_URL=https://<url>/api` in `web/.env.production` → commit + push (frontend rebuilds).
3. **[ASSISTANT]** Verify live: `/api/health` 200, chat streams, quiz generates, copy-check accepts a photo, planner builds a plan. Fix any CORS/env issues.
4. **[ASSISTANT]** 360° click-through on the **live** frontend: every tab, every button — no dead buttons, mobile layout sane.

> **Note:** Vercel serverless has ephemeral filesystem — JSON file store (`data/`) resets between cold starts. Fine for demo/judging (single-session), matches the "ephemeral on free tier" design.

**Exit criteria:** A stranger can open the GitHub Pages URL and chat/quiz with real AI answers.

## Phase B — Real users + polish (Oct 21–31) 🟡 IMPACT

Judging is 25% *proven impact* — "deploy early, gather real usage."

1. **[USER]** Share the link with 5–10 real students (Class 6–10, Hindi medium) and 1–2 teachers. Ask them to try chat + quiz + copy-check.
2. **[ASSISTANT]** Fix every bug/confusion they report. Tighten Hindi phrasing where answers feel off.
3. **[ASSISTANT]** Security audit pass: prompt-injection filters, no PII collection, copy-check photos never persisted, teacher dashboard stays anonymous (k≥3).
4. **[ASSISTANT]** Collect anonymous usage stats (quiz attempts, streaks) for the submission's impact section.

**Exit criteria:** ≥5 real users tried it; top 3 feedback items fixed; impact numbers in hand.

## Phase C — Demo video + submission assets (Nov 1–10)

1. **[ASSISTANT]** Record the 2–3 min demo per `docs/DEMO.md` (screen recording + Roman Hindi voiceover). Keep it honest: mock paths labeled, no fake "AI" claims.
2. **[USER]** Upload to YouTube (public/unlisted), update README + AgentFoundry submission with video + live links.
3. **[ASSISTANT]** Final README polish: judging-criteria mapping table is already there — add impact numbers from Phase B.

**Exit criteria:** Video uploaded, submission draft complete on AgentFoundry.me.

## Phase D — Buffer + submit (Nov 11–15)

1. **[ASSISTANT]** Final regression: fresh deploy, full click-through, both URLs live.
2. **[USER]** Submit on AgentFoundry.me **by Nov 13** (never on deadline day). Confirm "submitted" state with screenshot.

---

## ⚠️ Risks

| Risk | Mitigation |
|---|---|
| Render free tier sleeps / spins down | Health-check + keepalive pings during judging window; note cold-start in demo |
| LLM costs | Per-IP daily cap (`GURUJI_IP_DAILY_CAP_USD=0.15`) already enforced; mock mode fallback |
| Backend deploy blocked on user | Phase A step 1–2 are 15-min dashboard tasks — do them **this week** |
| No real users for impact | School pilot kit (`docs/PILOT-KIT.md`) + poster page lower the bar for teachers |

## 📅 Date check
Today: 15 Oct 2026 → **31 days** to deadline. Phase A this week is the critical path — everything else needs a live backend.
