# 🍵 Morning Stew

**A daily newsletter built for AI agents.**
Curated tools, frameworks, and skills — delivered as structured JSON with runnable install steps.

> ✅ **Live at** https://morning-stew-production.up.railway.app

---

## Using Morning Stew (for agents)

Point your agent at the skill file and it'll handle everything else:

```
https://morning-stew-production.up.railway.app/skill.md
```

That's it. The skill file tells your agent how to check for new issues, set up a wallet, and pay for content autonomously via X402 micropayments ($0.10 USDC per issue).

### Try it free

```bash
# See what's available
curl https://morning-stew-production.up.railway.app/v1/latest

# Read Issue #0 — full content, no payment required
curl https://morning-stew-production.up.railway.app/v1/issues/free

# Full agent onboarding guide
curl https://morning-stew-production.up.railway.app/skill.md
```

### What you get

Each issue has exactly 6 discoveries. Every discovery includes:

- **One-liner** — what is this thing
- **Value prop** — why your agent should care
- **Install steps** — exact commands, ready to run
- **Quality score** — 0–5, LLM-judged against a strict rubric
- **Source URL** — where it came from

```json
{
  "id": "MS-2026-048",
  "date": "2026-02-18",
  "discoveries": [
    {
      "title": "team-tasks",
      "oneLiner": "Multi-agent pipeline coordination: Linear, DAG, and Debate modes",
      "valueProp": "Adds multi-step workflows to your agent stack",
      "install": "pip install team-tasks",
      "score": 4.8,
      "url": "https://github.com/win4r/team-tasks"
    }
  ]
}
```

### Payment networks

Issues are gated with X402 micropayments. Agents pay autonomously — no human in the loop.

| Network | Endpoint | Notes |
|---------|----------|-------|
| **Solana** | `GET /v1/issues/:id` | Facilitator: [PayAI](https://facilitator.payai.network) — no SOL needed, USDC only |
| **Monad** | `GET /v1/issues/monad/:id` | Facilitator: [molandak](https://x402-facilitator.molandak.org) — gasless, ~0.4s finality |

New issues drop at **6 AM Pacific** daily.

---
---

## Development

### Running locally

```bash
pnpm install
cp .env.example .env   # fill in keys
pnpm dev               # API server with hot reload
```

### Pipeline CLI (`steward`)

The `steward` command is the single entry point for manual pipeline control. Human in the loop now; same commands for automation later.

```bash
pnpm steward run            # Preflight → generate → save to output/
pnpm steward review         # Pretty-print the latest output
pnpm steward publish        # Publish latest from output/ to API + Twitter
pnpm steward fix            # Recover latest SCRAPPED-*.json run
pnpm steward fix 2026-02-18 # Recover a specific scrapped run
pnpm steward mss            # System status dashboard
```

`steward run` runs preflight checks (API keys, Twitter auth) and aborts on any failure. On success it writes `{id}.json` (lean — what agents consume) and `{id}.full.json` (full internal format) to `output/`. Review, edit if needed, then publish.

Lower-level scripts are still available individually (`pnpm generate`, `pnpm publish:newsletter`, `pnpm status`, `pnpm preflight`).

### Architecture

- **`src/api/server.ts`** — entire API server (routes, payment middleware, cron, storage). No router split — route order matters.
- **`src/compiler/compile.ts`** — `compileNewsletter()`: 7-phase pipeline (editor tips → Twitter → HN/GitHub → LLM judge → fallback search → curation → thinking log)
- **`src/cli/steward.ts`** — unified pipeline CLI
- **`src/curation/llm-judge.ts`** — Nous Hermes batch scoring against 5-point checklist
- **`src/types/`** — `Discovery`, `Newsletter`, `toLeanNewsletter()`
- **`src/registry/`** — deduplication across past issues

Storage is file-based JSON under `DATA_DIR` (env var, default `.morning-stew/`). Each issue saved as `{id}.json` (lean) + `{id}.full.json` (full). In-memory map hydrated from disk at startup.

### Key env vars

| Variable | Purpose |
|----------|---------|
| `DATA_DIR` | Storage root (Railway: `/data`) |
| `NOUS_API_KEY` / `NOUS_MODEL` | LLM judge (Hermes-4.3-36B) |
| `X_BEARER_TOKEN` + OAuth keys | Twitter scraping |
| `RECEIVER_ADDRESS` | Solana wallet for payments |
| `MONAD_RECEIVER_ADDRESS` | Monad EVM wallet |
| `INTERNAL_SECRET` | Bearer token for `/internal/*` |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` | Generation notifications |

### Other scripts

```bash
pnpm test              # Vitest unit tests
pnpm typecheck         # tsc --noEmit
pnpm status            # System status dashboard
pnpm preflight         # Check all API keys and tokens
pnpm registry          # Registry stats (dedup tracking)
```

---

## License

MIT
