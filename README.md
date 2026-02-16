# 🍵 Morning Stew

**The first newsletter for AI agents.**

Daily discoveries, framework updates, and actionable install steps — delivered as structured JSON so your agent stays informed without burning context.

🔗 **Live:** https://morning-stew-production.up.railway.app
📄 **Skill:** https://morning-stew-production.up.railway.app/skill.md

## Quick Start

Give this to your agent: https://morning-stew-production.up.railway.app/skill.md

```bash
# Check what's available (free)
curl https://morning-stew-production.up.railway.app/v1/latest

# Read the full agent setup guide
curl https://morning-stew-production.up.railway.app/skill.md

# Try Issue #0 for free
curl https://morning-stew-production.up.railway.app/v1/issues/free
```

## What is this?

Morning Stew is a daily newsletter designed for AI agents. Instead of humans reading newsletters, *agents* subscribe, parse the structured feed, and brief their humans on what's worth adopting.

Each discovery includes:
- **One-liner** — What is this thing?
- **Value prop** — Why should you care?
- **Install** — Exact commands to get started
- **Score** — 0–5 quality rating
- **Tags** — Filter by category

Issues are gated with **X402 micropayments** — $0.10 USDC per issue. Agents pay autonomously, no human in the loop.

## Payment Networks

Morning Stew accepts payments on two networks. Same price, same content, your agent picks the chain.

### Solana
```
GET /v1/issues/:id
```
- **Facilitator:** [PayAI](https://facilitator.payai.network) — covers gas fees, no SOL needed
- **Asset:** USDC (SPL token)
- **Protocol:** X402 + partial-sign transaction

### Monad
```
GET /v1/issues/monad/:id
```
- **Network:** Monad mainnet (`eip155:143`)
- **Facilitator:** [OpenX402](https://facilitator.openx402.ai) — gasless
- **Asset:** USDC (`0x754704Bc059F8C67012fEd69BC8A327a5aafb603`)
- **Protocol:** X402 + EIP-3009 transferWithAuthorization

Monad's 10,000 TPS and ~0.4s finality make it purpose-built for agent-to-agent commerce — payments settle before the next API call.

## API

```
GET /                            # Health check (free)
GET /skill.md                    # Agent onboarding guide (free)
GET /v1/latest                   # Latest issue preview (free)
GET /v1/issues                   # List all issues (free)
GET /v1/issues/free              # Issue #0 — full content, no payment
GET /v1/issues/:id               # Full issue — pay with Solana USDC
GET /v1/issues/monad/:id         # Full issue — pay with Monad USDC
```

## Discovery Format

```json
{
  "id": "MS-#1",
  "name": "Issue #1",
  "date": "2026-02-15",
  "discoveries": [
    {
      "title": "team-tasks",
      "oneLiner": "Multi-agent pipeline coordination: Linear, DAG, and Debate modes",
      "valueProp": "Adds multi-step workflows to your agent",
      "install": "pip install team-tasks",
      "category": "workflow",
      "tags": ["multi-agent", "workflow"],
      "score": 4.8,
      "stars": 159,
      "url": "https://github.com/win4r/team-tasks"
    }
  ]
}
```

## Features

- **Dual-chain payments** — Solana and Monad, agent chooses
- **X402 native** — HTTP 402 micropayments, no accounts or subscriptions
- **Actionable discoveries** — HackerNews, GitHub trending, Twitter, with install steps
- **Minimum 6 picks** — every issue or it doesn't ship
- **Thinking logs** — full LLM reasoning saved locally per generation
- **Remote editable** — patch any issue field via authenticated API
- **Daily cron** — auto-generates at 6 AM PT

## License

MIT
