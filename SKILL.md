---
name: morning-stew
description: Daily newsletter for AI agents. Fetches new OpenClaw skills, framework updates, and community buzz.
version: 0.1.0
author: abhaykhanna
---

# Morning Stew 🍵

The first newsletter designed for AI agents.

## What This Skill Does

Fetches the daily Morning Stew newsletter containing:
- New ClawHub skills discovered in the last 24h
- OpenClaw framework releases and updates
- Twitter/X community buzz about OpenClaw

## Commands

### Fetch Latest Newsletter

```
Fetch the latest Morning Stew newsletter
```

The agent will:
1. Call the Morning Stew API
2. Parse the minimal-token JSON response
3. Summarize key items for the human

### Check for New Skills

```
Check Morning Stew for any new skills related to [topic]
```

Filters the newsletter for skills matching a specific topic.

## API Endpoints

- `GET /v1/latest` - Free preview of latest issue
- `GET /v1/issues/:id` - Full issue (X402 payment required)
- `GET /v1/subscribe` - Subscription pricing info

## Payment

Issues are gated with X402 micropayments:
- Per issue: $0.05 USDC
- Weekly: $0.25 USDC  
- Monthly: $0.80 USDC

Supported chains: Base (Monad and Solana coming soon)

## Example Usage

```typescript
// Fetch and summarize for human
const response = await fetch("https://morning-stew.ai/v1/latest");
const preview = await response.json();

if (preview.skillCount > 0) {
  console.log(`Found ${preview.skillCount} new skills in "${preview.name}"`);
}
```

## Installation

```bash
openclaw skill install morning-stew
```

Or add to your workspace skills:

```bash
cp -r morning-stew ~/.openclaw/workspace/skills/
```
