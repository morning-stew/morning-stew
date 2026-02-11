# Morning Stew - Build Session Blueprint

This document contains the exact changes made during this session. Use this to understand the architecture and modify the codebase.

---

## 1. Base Mainnet Deployment with CDP Facilitator

### What Changed
Switched from testnet (Base Sepolia) to mainnet (Base) using Coinbase's CDP facilitator for x402 payments.

### Files Modified

**`src/api/server.ts`** (lines 21-38)
```typescript
const USE_TESTNET = process.env.USE_TESTNET !== "false";
const NETWORK = USE_TESTNET ? NETWORKS.BASE_SEPOLIA : NETWORKS.BASE_MAINNET;

const FACILITATOR_URL = USE_TESTNET 
  ? "https://x402.org/facilitator" 
  : "cdp"; // CDP facilitator for mainnet

const facilitatorClient = USE_TESTNET
  ? new HTTPFacilitatorClient({ url: "https://x402.org/facilitator" })
  : new HTTPFacilitatorClient(cdpFacilitator);
```

### Environment Variables (Railway)
```
CDP_API_KEY_ID=<from portal.cdp.coinbase.com>
CDP_API_KEY_SECRET=<from portal.cdp.coinbase.com>
USE_TESTNET=false
RECEIVER_ADDRESS=0x7873D7d9DABc0722c1e88815193c83B260058553
```

---

## 2. Quality Curation Layer

### What Changed
Added a 5-point quality rubric to filter discoveries. Only tools scoring 3+/5 make it into the newsletter.

### New Files Created

**`src/curation/quality.ts`**
- `scoreDiscovery(discovery)` - Scores 0-5 based on:
  1. Novel value (0-1)
  2. Evidence of real usage (0-1) - stars, forks, engagement
  3. Reasonable install process (0-1)
  4. Documentation quality (0-1)
  5. Genuine utility (0-1)
- `fetchRepoMetadata(url)` - Fetches GitHub repo stats (stars, last commit, README quality)
- `generateValueProp(discovery)` - Creates specific "why should I care" statements
- `curateDiscoveries(discoveries)` - Returns `{ picks, onRadar, skipped, isQuietWeek }`
- `toAgentFormat(discovery)` - Converts to agent-readable JSON

**`src/curation/index.ts`**
```typescript
export { 
  scoreDiscovery, curateDiscoveries, generateValueProp,
  fetchRepoMetadata, isDuplicate, toAgentFormat,
  type QualityScore, type CuratedDiscovery, type CurationResult,
  type RepoMetadata, type AgentDiscovery,
} from "./quality";
```

### Files Modified

**`src/types/newsletter.ts`**
Added new schemas:
```typescript
export const CuratedDiscoverySchema = DiscoverySchema.extend({
  qualityScore: z.object({
    total: z.number(),
    novelValue: z.number(),
    realUsage: z.number(),
    installProcess: z.number(),
    documentation: z.number(),
    genuineUtility: z.number(),
    reasons: z.array(z.string()),
  }),
  valueProp: z.string(),
  skipReason: z.string().optional(),
});

export const OnRadarItemSchema = z.object({
  title: z.string(),
  url: z.string().url(),
  reason: z.string(),
});

export const SkippedItemSchema = z.object({
  title: z.string(),
  url: z.string().url().optional(),
  reason: z.string(),
});
```

Newsletter now includes:
- `discoveries` - Curated picks (score >= 3)
- `onRadar` - Promising but not ready (score 2-3)
- `skipped` - Didn't make it (score < 2)
- `isQuietWeek` - Boolean if < 3 quality picks

**`src/compiler/compile.ts`**
```typescript
import { curateDiscoveries, type CuratedDiscovery } from "../curation";

// After gathering discoveries:
const curation = await curateDiscoveries(allDiscoveries, { minScore: 3, maxPicks: 10 });
picks = curation.picks;
isQuietWeek = curation.isQuietWeek;
```

---

## 3. Twitter Feed Scoring Improvements

### What Changed
Tiered keyword scoring with source credibility signals.

### File Modified

**`src/scrapers/twitter-feed.ts`** - `scoretweet()` function (lines 231-339)

```typescript
// HIGH-VALUE keywords (+15 per match)
const highValueKeywords = [
  "npm install", "pip install", "git clone", "npx", "cargo install",
  "skill.md", "clawhub", "openclaw", "x402", "mcp server"
];

// MEDIUM-VALUE keywords (+8 per match)
const mediumValueKeywords = [
  "agent", "claude", "mcp", "bounty", "hackathon", "launch", "release",
  "api", "sdk", "framework", "tool"
];

// LOW-VALUE keywords (+3)
const lowValueKeywords = ["ai", "llm", "automate", "workflow"];

// NEGATIVE patterns (-40 each)
const NEGATIVE_KEYWORDS = ["price", "pump", "moon", "nft drop", "giveaway", ...];
const extraNegative = ["gm", "wagmi", "thread 🧵", "hiring", ...];

// Priority account tiers
const priorityTier1 = ["openclaw", "clawnewsio", "anthropic", "coinbasedev"]; // +25
const priorityTier2 = ["steipete", "langchainai", "openrouterai", "solana_devs"]; // +15

// Actionability bonuses
if (content.includes("github.com")) score += 15;
if (content.includes("```") || content.includes("npm i")) score += 20;
```

---

## 4. Bulk Subscription ($25 for 250 issues)

### What Changed
Agents can pay $25 upfront for 250 issues instead of paying per-request.

### Files Modified

**`src/types/payment.ts`**
```typescript
export const DEFAULT_PRICING: Pricing = {
  perIssue: 10, // $0.10
  weekly: 50,   // $0.50
  monthly: 80,  // $0.80
  bulk250: 2500, // $25.00 for 250 issues
};

export const BULK_ISSUE_COUNT = 250;
```

**`src/api/server.ts`**

Added subscription storage:
```typescript
const subscriptions = new Map<string, Subscription>();

function checkSubscription(walletAddress: string): { active: boolean; remaining?: number } {
  const sub = subscriptions.get(walletAddress.toLowerCase());
  if (!sub) return { active: false };
  if (sub.tier === "bulk_250" && sub.issuesRemaining && sub.issuesRemaining > 0) {
    return { active: true, remaining: sub.issuesRemaining };
  }
  return { active: false };
}

function useSubscriptionIssue(walletAddress: string): boolean {
  const sub = subscriptions.get(walletAddress.toLowerCase());
  if (!sub || !sub.issuesRemaining || sub.issuesRemaining <= 0) return false;
  sub.issuesRemaining--;
  subscriptions.set(walletAddress.toLowerCase(), sub);
  return true;
}
```

New endpoints:
```typescript
// Check subscription status (free)
app.get("/v1/subscribe/status/:wallet", ...)

// Purchase bulk subscription ($25 x402 payment)
app.post("/v1/subscribe/bulk", ...)
```

Modified issue endpoint to check subscription:
```typescript
app.get("/v1/issues/:id", async (c, next) => {
  const subscriberWallet = c.req.header("X-SUBSCRIBER-WALLET");
  
  if (subscriberWallet) {
    const status = checkSubscription(subscriberWallet);
    if (status.active) {
      useSubscriptionIssue(subscriberWallet);
      return serveNewsletter(c, newsletter, remaining);
    }
  }
  
  // Fall through to x402 payment middleware
  return paymentMiddleware(...)(c, next);
});
```

---

## 5. Agent-Optimized Output Format

### What Changed
API returns clean JSON optimized for agent consumption.

### File Modified

**`src/api/server.ts`** - `serveNewsletter()` function

```typescript
function serveNewsletter(c: any, newsletter: Newsletter, subscriptionRemaining?: number) {
  const agentResponse: Record<string, any> = {
    id: newsletter.id,
    name: newsletter.name,
    date: newsletter.date,
    isQuietWeek: newsletter.isQuietWeek || false,
    
    discoveries: newsletter.discoveries.map(d => ({
      title: d.title,
      what: d.oneLiner.slice(0, 120),
      utility: d.valueProp,
      install: d.install.steps.filter(s => 
        !s.startsWith("#") || s.includes("npm") || s.includes("pip") || s.includes("git")
      ).slice(0, 5),
      signals: {
        stars: d.signals?.engagement,
        source: d.source.type,
        qualityScore: d.qualityScore?.total || 0,
      },
      url: d.source.url,
    })),
    
    onRadar: newsletter.onRadar?.map(...),
    frameworkUpdates: newsletter.frameworkUpdates.map(...),
    securityNotes: newsletter.securityNotes,
    tokenCount: newsletter.tokenCount,
  };
  
  if (subscriptionRemaining !== undefined) {
    agentResponse.subscription = { issuesRemaining: subscriptionRemaining };
  }
  
  return c.json(agentResponse);
}
```

---

## 6. Editor DM Feature (@aboozle suggestions)

### What Changed
Agent checks DMs from @aboozle for editorial suggestions that bypass normal curation.

### New File Created

**`src/scrapers/twitter-dms.ts`**

```typescript
const EDITOR_HANDLE = "aboozle";
const SEEN_DMS_PATH = join(DATA_DIR, "seen-dms.json");

export async function scrapeEditorDMs(config: DMScraperConfig = {}): Promise<Discovery[]> {
  // 1. Load cookies and navigate to DMs
  // 2. Find conversation with @aboozle
  // 3. Extract messages with URLs
  // 4. Create high-priority discoveries (engagement: 9999)
  // 5. Track seen DMs to avoid duplicates
}
```

Key features:
- Only reads from @aboozle
- Stores seen DM hashes in `.morning-stew/seen-dms.json`
- Editor picks get `signals.engagement = 9999` (highest priority)
- Bypasses normal quality scoring

### Files Modified

**`src/scrapers/index.ts`**
```typescript
export { scrapeEditorDMs, EDITOR_HANDLE } from "./twitter-dms";
```

**`src/compiler/compile.ts`**
```typescript
import { scrapeEditorDMs } from "../scrapers";

// In CompileOptions:
skipEditorDMs?: boolean;

// In compileNewsletter():
const [hnDiscoveries, ghDiscoveries, twitterDiscoveries, editorPicks, frameworkUpdates] = await Promise.all([
  ...
  options.skipEditorDMs ? [] : scrapeEditorDMs({ headless: true }),
  ...
]);

// Editor picks go first (highest priority)
const allDiscoveries = dedupeDiscoveries([...editorPicks, ...hnDiscoveries, ...ghDiscoveries, ...twitterDiscoveries]);
```

---

## 7. Simplified skill.md

### File Modified

**`src/api/server.ts`** - skill.md endpoint

Key sections:
```markdown
## Quick Start (One-liner)
const newsletter = await x402.fetch("${baseUrl}/v1/issues/${latestId}");

## Subscription (Recommended)
// Subscribe for 250 issues ($25 USDC)
await x402.fetch("${baseUrl}/v1/subscribe/bulk", { method: "POST" });

// Access with wallet header (no payment)
headers: { "X-SUBSCRIBER-WALLET": "0xYourWallet..." }
```

---

## Directory Structure

```
morning-stew/
├── src/
│   ├── api/
│   │   └── server.ts          # Main API server
│   ├── compiler/
│   │   ├── compile.ts         # Newsletter compilation
│   │   └── names.ts           # Issue naming
│   ├── curation/
│   │   ├── index.ts           # Exports
│   │   └── quality.ts         # Quality rubric & scoring
│   ├── scrapers/
│   │   ├── index.ts           # Exports
│   │   ├── twitter-feed.ts    # Priority account scraping
│   │   ├── twitter-dms.ts     # Editor DM scraping
│   │   ├── github-trending.ts # GitHub repo discovery
│   │   ├── discoveries.ts     # HackerNews scraping
│   │   └── github.ts          # GitHub releases
│   ├── types/
│   │   ├── newsletter.ts      # Newsletter/Discovery schemas
│   │   ├── payment.ts         # Pricing & subscription schemas
│   │   └── discovery.ts       # Discovery schema
│   └── payment/
│       └── x402.ts            # X402 helpers
├── .morning-stew/
│   ├── twitter-cookies.json   # Auth cookies
│   └── seen-dms.json          # Tracked DM hashes
└── STEWARD.md                 # OpenClaw agent instructions
```

---

## API Endpoints Summary

| Endpoint | Method | Cost | Description |
|----------|--------|------|-------------|
| `/` | GET | Free | Service info |
| `/skill.md` | GET | Free | Agent docs |
| `/.well-known/x402.json` | GET | Free | Payment discovery |
| `/v1/latest` | GET | Free | Preview latest issue |
| `/v1/issues` | GET | Free | List all issues |
| `/v1/issues/:id` | GET | $0.10 | Full issue (or free with subscription) |
| `/v1/subscribe` | GET | Free | Subscription tiers |
| `/v1/subscribe/bulk` | POST | $25 | Buy 250 issues |
| `/v1/subscribe/status/:wallet` | GET | Free | Check subscription |
| `/internal/generate` | POST | Free | Trigger newsletter generation |

---

## Test Commands

```bash
pnpm build           # TypeScript check
pnpm curation:test   # Test quality pipeline
pnpm twitter:test    # Test Twitter scraper
pnpm generate        # Generate newsletter locally
```
