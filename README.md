# 🍵 Morning Stew

**The first newsletter for AI agents.**

Daily discoveries, framework updates, and actionable install steps—delivered in minimal tokens so your agent stays informed without burning context.

🔗 **Live:** https://morning-stew-production.up.railway.app  
📄 **Skill:** https://morning-stew-production.up.railway.app/skill.md

## Quickstart

📄 Give this to your agent: https://morning-stew-production.up.railway.app/skill.md

## What is this?

Morning Stew is a daily newsletter designed for AI agents. Instead of humans reading newsletters, *agents* subscribe, parse the structured feed, and brief their humans on what's worth adopting.

Each discovery includes:
- **One-liner** — What is this thing?
- **Value prop** — Why should you care?
- **Install** — Exact commands to get started
- **Tags** — Filter by category

## Features

- **Actionable Discoveries** — HackerNews, GitHub trending, Twitter, with install steps
- **Minimal Token Format** — ~500 tokens for the compact version
- **X402 Payment Gate** — $0.10 USDC per issue on Solana
- **Numbered Issues** — Sequential issue IDs (Issue #0, #1, etc.)
- **Daily Cron** — Auto-generates at 6 AM PT

## Quick Start

```bash
pnpm install
pnpm generate      # Generate today's newsletter
pnpm serve         # Start the API server

API

GET /                       # Health check (free)
GET /skill.md               # Agent onboarding guide (free)
GET /v1/latest              # Latest issue preview (free)
GET /v1/issues              # List all issues (free)
GET /v1/issues/:id          # Full issue (X402 payment required)

Discovery Format

{
  "id": "MS-#0",
  "name": "Issue #0",
  "date": "2026-02-13",
  "discoveries": [
    {
      "title": "team-tasks",
      "oneLiner": "Multi-agent pipeline coordination: Linear, DAG, and Debate modes",
      "valueProp": "Adds multi-step workflows to your agent",
      "install": "pip install needed",
      "category": "workflow",
      "tags": ["multi-agent", "workflow"],
      "score": 4.8,
      "stars": 159,
      "url": "https://github.com/win4r/team-tasks"
    }
  ],
  "frameworkUpdates": [...],
  "securityNotes": [...]
}

X402 Payment

Issues are gated with X402 micropayments on Solana:

Per issue: $0.10 USDC
Network: Solana mainnet
Facilitator: PayAI — covers gas fees

See /skill.md for full payment instructions including transaction construction.

Deploy Your Own

Push to GitHub
Connect to Railway
Set environment variables:
RECEIVER_ADDRESS — Your Solana wallet for payments
INTERNAL_SECRET — Secret for triggering generation
FACILITATOR_URL — https://facilitator.payai.network
Deploy

Trigger generation:

curl -X POST https://your-app.up.railway.app/internal/generate \
  -H "Authorization: Bearer YOUR_INTERNAL_SECRET"

License

MIT
