# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Start server with hot reload (tsx watch)
npm start            # Start server (production, node --import tsx)
npm run build        # TypeScript check only (tsc --noEmit, no emit)
npm run lint         # ESLint on src/
npm test             # Vitest (unit tests)

pnpm steward run     # Preflight → generate → save lean+full to output/
pnpm steward review  # Pretty-print latest issue from output/
pnpm steward publish # Publish latest from output/ to API + Twitter
pnpm steward fix     # Recover latest SCRAPPED-*.json run
pnpm steward fix 2026-02-18  # Recover a specific scrapped run
pnpm steward mss     # System status dashboard

# Lower-level scripts (still available):
npm run generate     # Compile a new newsletter issue to local file
npm run publish:newsletter  # Publish local issue to running API
npm run cron         # generate + publish in one step (local)
npm run daily        # generate + publish against production Railway URL

npm run curation:test   # Test curation pipeline in isolation
npm run twitter:test    # Test Twitter scraper
npm run x402:test       # Test Solana x402 payment flow
npm run x402:e2e        # End-to-end payment test
```

Run a single vitest test file: `npx vitest run src/compiler/names.test.ts`

## Architecture

### Single-file API server
`src/api/server.ts` is the entire server — all routes, middleware, storage helpers, and the daily cron job live here. There is no router split. Route ordering matters: free routes must be registered **before** `app.use(paymentMiddleware(...))`, which gates everything after it.

### Newsletter generation pipeline (`src/compiler/compile.ts`)
`compileNewsletter()` runs 7 sequential phases:
1. Editor tips (DMs via Playwright)
2. Twitter home timeline
3. HackerNews + GitHub trending (parallel)
4. LLM judge — Nous Hermes batch scoring (5-point checklist)
5. Keyword search fallback (if still short on picks)
6. Quality curation — final ranking, hard cap at `MAX_PICKS = 6`
7. Thinking log written to `DATA_DIR/thinking-logs/`

If fewer than `MIN_PICKS = 6` survive curation, the newsletter is scrapped (throws). `skipMinimumCheck` bypasses this for seed/backfill only.

### Storage
File-based JSON in `DATA_DIR` (env var, default: `.morning-stew/`). Each issue is saved as two files:
- `{id}.json` — lean format (what API consumers receive, via `toLeanNewsletter()`)
- `{id}.full.json` — full internal format for debugging

The in-memory `Map<string, Newsletter>` is hydrated from disk at startup via `loadNewslettersFromDisk()`.

### Payment — two chains, two approaches
**Solana:** `@x402/hono` `paymentMiddleware` handles `/v1/issues/:id` automatically via the PayAI facilitator.

**Monad:** Manual EIP-3009 flow — no middleware. The `/v1/issues/monad/:id` handler calls the molandak facilitator directly (`verify` then `settle`) because the x402 Hono middleware doesn't support Monad's custom USDC contract.

### Data types (`src/types/`)
- `Discovery` — the core unit: title, oneLiner, install steps (runnable commands), source, signals, quality score
- `Newsletter` — container: id (`MS-#N`), name, date, `discoveries[]`, `frameworkUpdates[]`, `securityNotes[]`
- `toLeanDiscovery()` / `toLeanNewsletter()` — strip internal fields before API response

### Internal API (protected)
All `/internal/*` routes require `Authorization: Bearer <INTERNAL_SECRET>`. Used for CRUD on newsletters and triggering generation remotely. The `PATCH /internal/newsletters/:id` endpoint accepts partial updates to any newsletter field.

### Issue #0 (free issue)
`/v1/issues/free` serves `MS-#0` without payment. Generated once via `src/cli/seed-free-issue.ts` with `skipMinimumCheck: true` and `overrideId: "MS-#0"`.

## Key env vars

| Variable | Purpose |
|---|---|
| `DATA_DIR` | Storage root (Railway: `/data`) |
| `RECEIVER_ADDRESS` | Solana wallet for payments |
| `USE_TESTNET` | `"false"` for mainnet (default: testnet) |
| `MONAD_RECEIVER_ADDRESS` | Monad EVM wallet |
| `INTERNAL_SECRET` | Bearer token for `/internal/*` |
| `NOUS_API_KEY` / `NOUS_MODEL` | LLM judge (Hermes-4.3-36B) |
| `X_BEARER_TOKEN` + OAuth keys | Twitter scraping |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` | Generation notifications |
| `DISABLE_CRON` | Set to `"true"` to skip scheduled generation |
