# 🍵 Morning Stew

**The first newsletter for AI agents.**

Daily discoveries, framework updates, and actionable install steps—delivered in minimal tokens so your agent stays informed without burning context.

## What is this?

Morning Stew is a daily newsletter designed for AI agents. Instead of humans reading newsletters, *agents* subscribe, parse the structured feed, and brief their humans on what's worth adopting.

Each discovery includes:
- **What** — What is this thing?
- **Why** — Why should you care?
- **Install** — Exact commands to get started
- **Impact** — What becomes possible?

## Features

- **Actionable Discoveries** — HackerNews, GitHub trending, with install steps
- **Minimal Token Format** — ~500 tokens for the compact version
- **X402 Payment Gate** — $0.05 USDC per issue on Base
- **Creative Issue Names** — Each issue gets a unique ID + witty name
- **Daily Cron** — Auto-generates at 6 AM PT

## Quick Start

```bash
pnpm install
pnpm generate      # Generate today's newsletter
pnpm serve         # Start the API server
pnpm x402:e2e      # Test payment flow
```

## Deploy to Railway

1. Push to GitHub
2. Connect to Railway
3. Set environment variables:
   - `RECEIVER_ADDRESS` — Your wallet for payments
   - `USE_TESTNET` — `true` for Base Sepolia, `false` for mainnet
4. Deploy

For daily automation, add a cron service:
- **Schedule:** `0 13 * * *` (6 AM PT = 1 PM UTC)
- **Command:** `npm run cron`

## API

```
GET /                       # Health check (free)
GET /v1/latest              # Latest issue preview (free)
GET /v1/issues              # List all issues (free)
GET /v1/issues/:id          # Full issue (X402 payment required)
GET /v1/subscribe           # Subscription pricing info
```

## Discovery Format

```json
{
  "id": "MS-2026-038",
  "name": "Solar Paradox",
  "date": "2026-02-08",
  "discoveries": [
    {
      "title": "excalidraw-mcp-app",
      "category": "integration",
      "oneLiner": "Hand-drawn diagrams for Claude",
      "what": "Excalidraw MCP App Server",
      "why": "862 stars, actively maintained",
      "impact": "Connect your agent to external systems",
      "install": {
        "steps": [
          "git clone https://github.com/antonpk1/excalidraw-mcp-app.git",
          "cd excalidraw-mcp-app",
          "npm install"
        ]
      }
    }
  ],
  "frameworkUpdates": [...],
  "securityNotes": [...]
}
```

## X402 Payment

Issues are gated with X402 micropayments:
- **Per issue:** $0.05 USDC
- **Network:** Base (mainnet or Sepolia testnet)

Agents automatically pay using `@x402/fetch`:

```typescript
import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { registerExactEvmScheme } from "@x402/evm/exact/client";

const client = new x402Client();
registerExactEvmScheme(client, { signer: myWallet });

const fetch402 = wrapFetchWithPayment(fetch, client);
const newsletter = await fetch402("https://morning-stew.up.railway.app/v1/issues/MS-2026-038");
```

## License

MIT
