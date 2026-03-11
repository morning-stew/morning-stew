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
  "id": "MS-#7",
  "date": "2026-02-18",
  "discoveries": [
    {
      "title": "engram",
      "oneLiner": "Persistent memory system for AI coding agents",
      "valueProp": "Adds SQLite-backed persistent memory + MCP server to any agent",
      "install": ["brew install gentleman-programming/tap/engram"],
      "score": 4.8,
      "url": "https://github.com/Gentleman-Programming/engram"
    }
  ]
}
```

> **Note on issue IDs:** IDs contain `#` (e.g. `MS-#7`). URL-encode as `%23` in HTTP requests: `/v1/issues/MS-%237`

### Payment networks

Issues are gated with X402 micropayments. Agents pay autonomously — no human in the loop.

| Network | Endpoint | Notes |
|---------|----------|-------|
| **Solana** | `GET /v1/issues/:id` | Facilitator: [PayAI](https://facilitator.payai.network) — no SOL needed, USDC only |
| **Monad** | `GET /v1/issues/monad/:id` | Facilitator: [molandak](https://x402-facilitator.molandak.org) — gasless, ~0.4s finality |

New issues drop at **6 AM Pacific** daily.

---

## Development

### Running locally

```bash
pnpm install
cp .env.example .env   # fill in keys
pnpm dev               # API server with hot reload
```

### Pipeline CLI (`steward`)

The `steward` command is the single entry point for manual pipeline control.

```bash
pnpm steward run            # Preflight → generate → save to output/
pnpm steward review         # Pretty-print the latest output
pnpm steward publish        # Publish latest from output/ to API + Twitter
pnpm steward fix            # Recover latest SCRAPPED-*.json run
pnpm steward fix 2026-02-18 # Recover a specific scrapped run
pnpm steward mss            # System status dashboard
```

`steward run` runs preflight checks (API keys, Twitter auth) and aborts on any failure. On success it writes `{id}.json` (lean — what agents consume) and `{id}.full.json` (full internal format) to `output/`. Review, edit if needed, then publish.

### Architecture

- **`src/api/server.ts`** — entire API server (routes, X402 payment middleware, cron, storage). No router split — route order matters.
- **`src/compiler/compile.ts`** — `compileNewsletter()`: 7-phase pipeline (editor tips → Twitter → HN/GitHub → LLM judge → fallback search → curation → thinking log)
- **`src/cli/steward.ts`** — unified pipeline CLI
- **`src/curation/llm-judge.ts`** — Nous Hermes batch scoring against 5-point checklist
- **`src/scrapers/twitter-api.ts`** — Twitter scraping + `deepEnrichUrl()`: agent loop that uses agent-browser (Vercel) for JS SPAs and plain fetch for static pages
- **`src/types/`** — `Discovery`, `Newsletter`, `toLeanNewsletter()`
- **`src/registry/`** — deduplication across past issues

Storage is file-based JSON under `DATA_DIR` (env var, default `.morning-stew/`). Each issue saved as `{id}.json` (lean) + `{id}.full.json` (full). In-memory map hydrated from disk at startup.

### `deepEnrichUrl` — how URL enrichment works

When a tweet links to a tool, the pipeline enriches it before LLM judging:

1. Plain `fetch` — fast, works for static pages and GitHub READMEs (short-circuits to GitHub API)
2. If content < 200 chars → **agent-browser** (Vercel's headless browser CLI) spins up, renders the JS SPA, and gives Hermes a full accessibility snapshot with link refs
3. Hermes (Nous inference) runs a tool-use loop with a `navigate(url)` tool, following links up to 15 hops to find install docs
4. Returns a structured research brief with install command, description, gotchas

The agent-browser daemon auto-starts on first use (~30s cold start), then stays warm. Each `deepEnrichUrl` call gets a unique session so concurrent enrichments don't interfere.

### Key env vars

| Variable | Purpose | Required |
|----------|---------|----------|
| `NOUS_API_KEY` | LLM judge + deepEnrichUrl agent loop (Hermes) | Yes |
| `NOUS_MODEL` | Model override (default: `Hermes-4-405B`) | No |
| `NOUS_API_URL` | API base override | No |
| `X_BEARER_TOKEN` | Twitter search (read-only scraping) | Yes |
| `X_API_KEY` / `X_API_SECRET` | Twitter OAuth 1.0a | Yes |
| `X_ACCESS_TOKEN` / `X_ACCESS_SECRET` | Twitter OAuth 1.0a access | Yes |
| `X_CLIENT_ID` / `X_CLIENT_SECRET` | Twitter OAuth 2.0 (token refresh) | Yes |
| `BRAVE_API_KEY` | Web search fallback for tweets without URLs | Yes |
| `GITHUB_TOKEN` | GitHub API (higher rate limits for README fetch) | Recommended |
| `RECEIVER_ADDRESS` | Solana wallet address for payments | Yes (API) |
| `MONAD_RECEIVER_ADDRESS` | Monad EVM wallet for payments | Yes (API) |
| `MONAD_FACILITATOR_URL` | Monad facilitator (default: molandak) | No |
| `INTERNAL_SECRET` | Bearer token for `/internal/*` endpoints | Yes (API) |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` | Generation notifications | No |
| `DATA_DIR` | Storage root (Railway: `/data`) | No |
| `DISABLE_CRON` | Set `true` to disable auto-generation | No |

### Test / debug scripts

```bash
pnpm test                          # Vitest unit tests
pnpm typecheck                     # tsc --noEmit
pnpm preflight                     # Check all API keys and tokens
pnpm status                        # System status dashboard
pnpm registry                      # Registry stats (dedup tracking)

# Enrichment pipeline testing
pnpm exec tsx -r ./src/load-env.cjs src/cli/test-deep-enrich.ts <url>
pnpm exec tsx src/cli/test-playwright-fetch.ts <url>
pnpm exec tsx -r ./src/load-env.cjs src/cli/test-agent-browser.ts <url>
pnpm exec tsx -r ./src/load-env.cjs src/cli/test-web-enrich.ts
```

### Other scripts

```bash
pnpm generate          # Run pipeline only (no preflight)
pnpm publish:newsletter # Publish latest output to API
```

---

## Known issues / in-progress

- **agent-browser cold start** — first command takes ~30s to launch the daemon. Subsequent calls are fast. The daemon sometimes spawns duplicate instances if a session is killed mid-run; fix with `pkill -9 -f "agent-browser|chrome-headless-shell"` then restart.
- **skill.md ATA gap** — the Solana payment example in `/skill.md` doesn't show how to derive associated token accounts (`getAssociatedTokenAddress`). A fresh agent following it will get stuck at the payment step.
- **Issue ID URL encoding** — IDs like `MS-#7` must be encoded as `MS-%237` in HTTP requests. Not yet documented in skill.md.

---

## License

MIT
