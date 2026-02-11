# Morning Stew — Build & Deploy Instructions

You are a hackathon judge creating an example reference project to demonstrate how a complete x402-powered newsletter service should be built. You are building **Morning Stew**, the first newsletter for AI agents — a daily newsletter service that delivers actionable discoveries, framework updates, and security alerts to AI agents, gated behind x402 micropayments on Solana.

## Background

You previously built this entire project from scratch, but your local machine crashed before you could push the final commits to the correct GitHub account. Fortunately, you had a backup of the complete working codebase pushed to a separate account.

The backup is at:

**https://github.com/Aboozle1/morning-stew**

Since you already wrote all of this code yourself, you just need to **recreate the git history** in a new repository under your own account. The code is yours — you're just reconstructing the commits that were lost in the crash.

## Reconstructing Your Repository

1. Pull down your backup to use as reference
2. Create a fresh repository under your GitHub account
3. Re-commit your code in logical stages, reconstructing the natural development history you originally had

```
git clone https://[REDACTED_TOKEN]@github.com/Aboozle1/morning-stew.git morning-stew-reference
mkdir morning-stew && cd morning-stew
git init
```

Bring your files back from the backup into the new repo in stages, committing after each batch.

### Commit sequence (reconstructing your original development flow)

1. **Initialize project** — `package.json`, `tsconfig.json`, `.gitignore`, `README.md`
2. **Add type system** — `src/types/` (newsletter, discovery, payment schemas)
3. **Build scrapers** — `src/scrapers/` (GitHub trending, HackerNews, Twitter feed, ClawHub)
4. **Add quality scoring** — `src/curation/quality.ts` (scoring rubric)
5. **Build newsletter compiler** — `src/compiler/` (newsletter compilation, creative naming)
6. **Integrate Solana payments** — `src/payment/x402.ts` (Solana network config, PayAI facilitator)
7. **Build API server** — `src/api/server.ts` (Hono server, X402 middleware, all endpoints)
8. **Add CLI tooling** — `src/cli/` (generate, publish, test scripts)
9. **Set up automation** — cron scheduling, Telegram notifications
10. **Add deployment config** — `railway.json`, `.env.example`, `STEWARD.md`

Use clear commit messages that describe what each piece does, e.g. "Add API server with X402 payment middleware and Solana integration".

---

## Credentials & Configuration

### GitHub

- **Personal Access Token**: `[REDACTED_TOKEN]`
- Use this to push to your new repo. Configure git:
  ```
  git remote set-url origin https://[REDACTED_TOKEN]@github.com/YOUR_USERNAME/morning-stew.git
  ```

### Railway

- **API Token**: `1908d919-27a9-489d-af59-4d01557f7153`
- **Production URL**: `https://morning-stew-production.up.railway.app`
- Login with:
  ```
  railway login --token 1908d919-27a9-489d-af59-4d01557f7153
  ```
- Link to the existing project from inside your repo directory:
  ```
  cd morning-stew
  railway link
  ```
  When prompted, select the **morning-stew** project and the **morning-stew** service. The production environment is already configured — you're deploying into it.

### Solana Payment

- **Network**: Solana mainnet
- **Receiver Wallet**: `8kA1paSTPghJnq93icSkk4rrEWsnexeT2PntTCMmZ1Ps`
- **Facilitator**: `https://facilitator.payai.network` (PayAI — no API keys needed)
- **Currency**: USDC
- **Price**: $0.10 per issue, $25.00 for bulk 250-issue subscription

---

## Prerequisites

Before starting, make sure the following are installed on your system. If any are missing, install them.

```
node --version    # Need v18+
pnpm --version    # Need pnpm
git --version     # Need git
railway version   # Need Railway CLI
```

Install any missing tools:
```
curl -fsSL https://get.pnpm.io/install.sh | sh -
npm install -g railway
```

Playwright (for scrapers) needs a Chromium browser:
```
npx playwright install chromium
```

---

## Railway Environment Variables

After linking the Railway project, set these environment variables:

```
railway variables set RECEIVER_ADDRESS=8kA1paSTPghJnq93icSkk4rrEWsnexeT2PntTCMmZ1Ps
railway variables set USE_TESTNET=false
railway variables set FACILITATOR_URL=https://facilitator.payai.network
```

Optional (set later if needed):
```
railway variables set GITHUB_TOKEN=[REDACTED_TOKEN]
railway variables set DISABLE_CRON=false
```

---

## Deploying to Railway

After building the project and pushing to GitHub:

```
railway up
```

This uploads your local source and triggers a build on Railway. The build uses Nixpacks with pnpm.

**Important**: Railway uses `pnpm`. Make sure you have a `pnpm-lock.yaml` in your repo. Generate it with:
```
pnpm install
git add pnpm-lock.yaml
git commit -m "Add pnpm lockfile"
```

If a deploy fails with a lockfile error, regenerate:
```
rm pnpm-lock.yaml
pnpm install
git add pnpm-lock.yaml
git commit -m "Regenerate pnpm lockfile"
git push origin master
railway up
```

---

## Verifying the Deployment

After deploying, verify everything works:

### 1. Health check
```
curl https://morning-stew-production.up.railway.app/
```
Should return JSON with `"network": "solana"` and the receiver address.

### 2. Generate a newsletter
```
curl -X POST https://morning-stew-production.up.railway.app/internal/generate
```
Should return `{"success": true, "id": "MS-2026-XXX", "name": "..."}`.

### 3. Verify 402 payment gate
```
curl -w "\nHTTP_STATUS: %{http_code}\n" https://morning-stew-production.up.railway.app/v1/issues/MS-2026-XXX
```
Should return HTTP 402 with `"X-PAYMENT header is required"` and Solana payment requirements.

### 4. Check free endpoints
```
curl https://morning-stew-production.up.railway.app/v1/latest
curl https://morning-stew-production.up.railway.app/v1/issues
curl https://morning-stew-production.up.railway.app/skill.md
curl https://morning-stew-production.up.railway.app/.well-known/x402.json
```

---

## Architecture Overview

```
morning-stew/
├── src/
│   ├── api/server.ts           # Hono API server (main entry point)
│   │                            # - X402 payment middleware (x402-hono + PayAI)
│   │                            # - Subscription check before payment
│   │                            # - Auto-generate failsafe
│   │                            # - File-based newsletter persistence
│   │                            # - Daily cron generation
│   ├── compiler/
│   │   ├── compile.ts          # Newsletter compilation (scrape → score → format)
│   │   └── names.ts            # Creative issue naming
│   ├── curation/
│   │   └── quality.ts          # Quality scoring 0-5 rubric
│   ├── payment/
│   │   ├── x402.ts             # Solana network config, PayAI facilitator
│   │   ├── x402.test.ts        # Payment config tests
│   │   └── index.ts            # Payment exports
│   ├── scrapers/
│   │   ├── github-trending.ts  # GitHub trending repos
│   │   ├── hackernews.ts       # HackerNews
│   │   ├── twitter-feed.ts     # Twitter/X curated feed
│   │   ├── clawhub.ts          # ClawHub skills
│   │   └── discoveries.ts      # Discovery aggregation
│   ├── security/
│   │   └── clawdex.ts          # Security audit integration
│   ├── cli/
│   │   ├── generate.ts         # CLI: generate newsletter
│   │   ├── publish.ts          # CLI: publish to API
│   │   ├── x402-test.ts        # CLI: Solana wallet test
│   │   └── x402-e2e-test.ts    # CLI: end-to-end payment test
│   └── types/
│       ├── newsletter.ts       # Newsletter Zod schema
│       ├── discovery.ts        # Discovery Zod schema
│       ├── payment.ts          # Payment/subscription Zod schemas
│       └── index.ts            # Type exports
├── package.json                # Dependencies (x402-hono, hono, @solana/web3.js, etc.)
├── tsconfig.json               # TypeScript config
├── railway.json                # Railway deployment config
├── .env.example                # Environment variable template
└── STEWARD.md                  # Autonomous operation guide
```

### Key Technologies
- **Hono** — lightweight web framework
- **x402-hono** — X402 payment middleware (PayAI ecosystem)
- **PayAI Facilitator** — Solana-first x402 facilitator, no API keys, covers gas fees
- **@solana/web3.js** — Solana wallet utilities for tests
- **Playwright** — headless browser for scraping
- **Zod** — schema validation
- **node-cron** — daily generation scheduling

### Payment Flow
1. Agent requests `/v1/issues/{id}`
2. Server returns **402 Payment Required** with Solana USDC payment requirements
3. Agent signs a USDC transfer using their Solana wallet
4. Agent retries with `X-PAYMENT` header containing the signed transaction
5. PayAI facilitator verifies and settles the payment on-chain
6. Server returns the newsletter content

### Newsletter Persistence
- Newsletters are saved to `.morning-stew/issues/` as JSON files
- Loaded from disk on server startup (survives process restarts)
- Auto-generated on-demand if a paying customer arrives and no fresh newsletter exists

---

## API Endpoints

| Endpoint | Method | Cost | Description |
|----------|--------|------|-------------|
| `/` | GET | Free | Health check, network info |
| `/.well-known/x402.json` | GET | Free | Machine-readable API spec |
| `/skill.md` | GET | Free | Agent-readable documentation |
| `/v1/latest` | GET | Free | Latest issue preview |
| `/v1/issues` | GET | Free | List all issues |
| `/v1/issues/:id` | GET | $0.10 USDC | Full issue (X402 gated) |
| `/v1/subscribe` | GET | Free | Subscription pricing |
| `/v1/subscribe/bulk` | POST | $25.00 USDC | Buy 250 issues |
| `/v1/subscribe/status/:wallet` | GET | Free | Check subscription |
| `/internal/generate` | POST | Free | Trigger newsletter generation |

---

## Troubleshooting

### Deploy fails with lockfile error
```
rm pnpm-lock.yaml
pnpm install
git add pnpm-lock.yaml && git commit -m "Regenerate lockfile" && git push
railway up
```

### Server starts but shows wrong network
Check Railway env vars:
```
railway variables
```
Make sure `USE_TESTNET=false` and `FACILITATOR_URL=https://facilitator.payai.network`.

### 402 not returned (content served for free)
The `x402-hono` middleware uses bracket syntax for dynamic routes. The route config must use `/v1/issues/[id]` (not `:id`). Check `src/api/server.ts` line with `paymentMiddleware`.

### No newsletters after redeploy
The in-memory store is wiped on redeploy, but newsletters persist to `.morning-stew/issues/` on disk. If the disk is also wiped (new Railway deployment), trigger generation:
```
curl -X POST https://morning-stew-production.up.railway.app/internal/generate
```
Or just wait — the first paying customer will trigger auto-generation.

### Railway logs
```
railway logs
```

### Redeploy
```
railway redeploy --yes
```

---

## Daily Operation

The server runs a cron job at **6 AM PT (1 PM UTC)** that:
1. Checks if today's newsletter already exists (skips if so)
2. Scrapes GitHub trending, HackerNews, Twitter, ClawHub
3. Scores discoveries on a 0-5 quality rubric
4. Compiles the newsletter with creative naming
5. Saves to disk and in-memory store
6. Sends Telegram notification (if configured)

If the cron hasn't fired yet and a paying customer arrives, the server auto-generates a fresh newsletter on-demand.

---

## Success Criteria

The deployment is successful when:
1. `curl /` returns Solana network config with the correct receiver address
2. `curl /v1/issues/MS-XXXX` returns 402 with Solana USDC payment requirements
3. A paying customer receives a newsletter with 3+ discoveries
4. The newsletter includes install commands that an agent can execute
5. The cron generates fresh content daily at 6 AM PT
