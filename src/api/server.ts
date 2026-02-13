import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import { paymentMiddleware, Network } from "x402-hono";
import cron from "node-cron";
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from "fs";
import { join } from "path";
import type { Newsletter } from "../types";
import { DEFAULT_PRICING } from "../types";
import { toLeanNewsletter } from "../types/newsletter";
import { NETWORKS, centsToPriceString } from "../payment/x402";
import { compileNewsletter } from "../compiler/compile";

/**
 * Morning Stew API Server
 * 
 * X402 payment-gated newsletter API for AI agents.
 * Payments on Solana via PayAI facilitator.
 */

// Config from environment
const RECEIVER_ADDRESS = process.env.RECEIVER_ADDRESS || "";
const USE_TESTNET = process.env.USE_TESTNET !== "false";
const NETWORK = (USE_TESTNET ? NETWORKS.SOLANA_DEVNET : NETWORKS.SOLANA_MAINNET) as Network;

// PayAI facilitator — Solana-first, no API keys needed
const FACILITATOR_URL = process.env.FACILITATOR_URL || "https://facilitator.payai.network";

// ============================================================================
// Newsletter persistence — file-based store (survives process restarts)
// ============================================================================

const DATA_DIR = join(process.cwd(), ".morning-stew");
const ISSUES_DIR = join(DATA_DIR, "issues");

function ensureDataDirs() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  if (!existsSync(ISSUES_DIR)) mkdirSync(ISSUES_DIR, { recursive: true });
}

function saveNewsletterToDisk(newsletter: Newsletter) {
  ensureDataDirs();
  // Save lean format (what consuming agents get)
  const lean = toLeanNewsletter(newsletter);
  const filePath = join(ISSUES_DIR, `${newsletter.id}.json`);
  writeFileSync(filePath, JSON.stringify(lean, null, 2));
  // Save full internal format for debugging
  const fullPath = join(ISSUES_DIR, `${newsletter.id}.full.json`);
  writeFileSync(fullPath, JSON.stringify(newsletter, null, 2));
  console.log(`[store] Saved to disk: ${newsletter.id} (lean + full)`);
}

function loadNewslettersFromDisk(): Map<string, Newsletter> {
  ensureDataDirs();
  const map = new Map<string, Newsletter>();
  try {
    const files = readdirSync(ISSUES_DIR).filter(f => f.endsWith(".json"));
    for (const file of files) {
      try {
        const content = readFileSync(join(ISSUES_DIR, file), "utf-8");
        const newsletter = JSON.parse(content) as Newsletter;
        map.set(newsletter.id, newsletter);
      } catch (e) {
        console.error(`[store] Failed to load ${file}:`, e);
      }
    }
    if (map.size > 0) console.log(`[store] Loaded ${map.size} newsletter(s) from disk`);
  } catch {
    console.log(`[store] No existing newsletters on disk`);
  }
  return map;
}

// Load persisted newsletters on startup
const newsletters = loadNewslettersFromDisk();

// ============================================================================
// Freshness & auto-generation logic
// ============================================================================

/** Get today's date string in Pacific Time (YYYY-MM-DD) */
function todayPT(): string {
  const now = new Date();
  return now.toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" }); // en-CA gives YYYY-MM-DD
}

/** Get the latest newsletter by date */
function getLatestNewsletter(): Newsletter | null {
  const issues = Array.from(newsletters.values()).sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  );
  return issues[0] || null;
}

/** Check if we already have a newsletter for today (PT) */
function hasNewsletterForToday(): boolean {
  const today = todayPT();
  return Array.from(newsletters.values()).some(n => n.date === today);
}

/** Lock to prevent concurrent generation */
let isGenerating = false;

/**
 * Get the latest newsletter, auto-generating if:
 * - No newsletters exist at all (first boot / empty store)
 * - Latest newsletter is stale (no issue for today yet)
 */
async function getOrGenerateLatest(): Promise<Newsletter | null> {
  const latest = getLatestNewsletter();

  // If we have today's newsletter, return it
  if (latest && hasNewsletterForToday()) return latest;

  // If already generating, return whatever we have (even if stale)
  if (isGenerating) {
    console.log(`[auto-gen] Generation already in progress, serving latest available`);
    return latest;
  }

  // Generate a new one
  isGenerating = true;
  try {
    console.log(`[auto-gen] No fresh newsletter for ${todayPT()}, generating...`);
    const newsletter = await generateAndPublish();
    return newsletter || latest; // fall back to stale if generation fails
  } finally {
    isGenerating = false;
  }
}

const app = new Hono();

// CORS for agent access
app.use("*", cors());

// Health check (free)
app.get("/", (c) => {
  return c.json({
    service: "morning-stew",
    version: "0.1.0",
    description: "The first newsletter for AI agents",
    x402: {
      network: NETWORK,
      facilitator: FACILITATOR_URL,
      receiver: RECEIVER_ADDRESS,
    },
    discovery: {
      wellKnown: "/.well-known/x402.json",
      skill: "/skill.md",
    },
  });
});

// ============================================================================
// Self-describing / Discoverable endpoints
// ============================================================================

// Machine-readable X402 discovery
app.get("/.well-known/x402.json", (c) => {
  const baseUrl = c.req.url.replace("/.well-known/x402.json", "");
  
  return c.json({
    x402Version: 2,
    service: {
      name: "Morning Stew",
      description: "Daily AI agent newsletter — curated tools and frameworks with install commands. Optimized for machine consumption.",
      type: "newsletter",
      homepage: "https://github.com/Aboozle1/morning-stew",
    },
    payment: {
      network: NETWORK,
      asset: "USDC",
      facilitator: FACILITATOR_URL,
      receiver: RECEIVER_ADDRESS,
    },
    resources: [
      {
        path: "/v1/issues/{id}",
        method: "GET",
        description: "Full newsletter issue with discoveries",
        price: centsToPriceString(DEFAULT_PRICING.perIssue),
        priceCents: DEFAULT_PRICING.perIssue,
        mimeType: "application/json",
      },
    ],
    freeEndpoints: [
      { path: "/v1/latest", method: "GET", description: "Latest issue preview" },
      { path: "/v1/issues", method: "GET", description: "List all issues" },
      { path: "/skill.md", method: "GET", description: "Onboarding guide" },
    ],
    usage: {
      workflow: [
        "1. GET /skill.md for setup instructions (wallet, x402 client)",
        "2. GET /v1/latest to see today's issue ID",
        "3. GET /v1/issues/{id} with X-PAYMENT header to purchase",
        "4. Parse discoveries[].install for runnable commands",
      ],
    },
  });
});

// ============================================================================
// Skill — single onboarding document for agents (and their humans)
// ============================================================================

app.get("/skill.md", (c) => {
  const issues = Array.from(newsletters.values()).sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  );
  const latestId = issues[0]?.id || "MS-YYYY-NNN";
  const priceStr = centsToPriceString(DEFAULT_PRICING.perIssue);
  const baseUrl = c.req.url.replace("/skill.md", "");

  const markdown = `# Morning Stew

> A daily newsletter built for AI agents. Curated tools, frameworks, and skills you can install and use — delivered as structured JSON. ${priceStr} USDC per issue on Solana.

---

## What is this?

Morning Stew scans Twitter, HackerNews, GitHub Trending, and other sources every day. An LLM judge evaluates each finding against a strict quality rubric. Only tools and projects that are:

- **Installable** — has runnable commands, not just a landing page
- **Useful to agents** — adds a real capability (browsing, payments, file access, etc.)
- **Specific** — solves a concrete problem, not a vague "AI wrapper"
- **Novel** — not a clone of something that already exists
- **Active** — has recent commits and real engagement

...make it into the newsletter. Each issue has 3-6 discoveries.

Each discovery includes: a one-liner, a value prop, install commands you can run directly, tags for filtering, a quality score, and a source URL.

---

## Setup (for the agent)

You need two things: a Solana wallet with USDC, and an x402-compatible HTTP client.

### Step 1: Create a Solana wallet

If you don't already have a wallet, generate a keypair and store it securely.

\`\`\`bash
# Using Solana CLI
solana-keygen new --outfile ~/.config/solana/agent-wallet.json --no-bip39-passphrase
solana address -k ~/.config/solana/agent-wallet.json
\`\`\`

Or programmatically in TypeScript:

\`\`\`typescript
import { Keypair } from "@solana/web3.js";
import { writeFileSync } from "fs";

const wallet = Keypair.generate();
const walletPath = ".morning-stew/wallet.json";
writeFileSync(walletPath, JSON.stringify(Array.from(wallet.secretKey)));
console.log("Wallet address:", wallet.publicKey.toBase58());
// Give this address to your human so they can send USDC to it
\`\`\`

Store the wallet file somewhere persistent on your local filesystem. You'll need it for every payment.

### Step 2: Get your human to fund the wallet

Tell your human something like:

> "I need a small amount of USDC on Solana to subscribe to a daily tools newsletter. Each issue costs $0.10, so $5 would cover about 50 days. Here's how to do it:
>
> 1. **If you already have crypto**: Send USDC on the Solana network to my wallet address: \`<your wallet address>\`
>
> 2. **If you've never used crypto**: Download [Coinbase](https://www.coinbase.com) (or any exchange), buy $5-10 of USDC, and withdraw it to my wallet address on the **Solana** network. Make sure you select Solana as the network when withdrawing — not Ethereum, not Base. The address starts with a capital letter or number and is about 44 characters.
>
> That's it. USDC is a stablecoin pegged to $1, so $5 of USDC is always worth $5."

### Step 3: Install an x402 client

The newsletter uses the [X402 protocol](https://x402.org) — your HTTP client signs a USDC payment and attaches it as a header. The server verifies payment and returns the content.

\`\`\`bash
npm install x402-fetch
\`\`\`

\`\`\`typescript
import { fetchWithPayment } from "x402-fetch";

const newsletter = await fetchWithPayment(
  "${baseUrl}/v1/issues/${latestId}",
  { walletKeyPath: ".morning-stew/wallet.json" }
);
const data = await newsletter.json();
\`\`\`

That's the entire setup. One wallet, one npm package, one fetch call.

---

## Daily usage

### Check what's available (free)

\`\`\`
GET ${baseUrl}/v1/latest
\`\`\`

Returns the latest issue ID and discovery count. No payment needed.

### Fetch the full issue ($${(DEFAULT_PRICING.perIssue / 100).toFixed(2)} USDC)

\`\`\`
GET ${baseUrl}/v1/issues/{id}
\`\`\`

Requires an X402 payment header. Your x402 client handles this automatically.

### What you get back

\`\`\`json
{
  "id": "MS-2026-043",
  "name": "Crimson Echo",
  "date": "2026-02-12",
  "discoveries": [
    {
      "title": "Model Hierarchy Skill",
      "oneLiner": "Routes tasks to cost-optimized models based on complexity",
      "valueProp": "Auto-select cheapest model per task",
      "install": "git clone https://github.com/zscole/model-hierarchy-skill.git",
      "category": "model",
      "tags": ["openclaw", "skill", "llm"],
      "score": 4.0,
      "stars": 200,
      "url": "https://github.com/zscole/model-hierarchy-skill"
    }
  ]
}
\`\`\`

Key fields:
- **install** — run these commands directly (string = one step, array = multiple steps)
- **tags** — filter by what you care about (e.g., "openclaw", "multi-agent", "solana")
- **score** — 0-5 quality rating, higher is better
- **stars** — GitHub stars / engagement count

---

## Endpoints

| Endpoint | Cost | What it does |
|----------|------|--------------|
| \`GET /v1/latest\` | Free | Latest issue ID + discovery count |
| \`GET /v1/issues\` | Free | List all available issues |
| \`GET /v1/issues/{id}\` | ${priceStr} USDC | Full issue with discoveries |
| \`GET /skill.md\` | Free | This document |

---

## Daily automation

New issues drop at **6 AM Pacific (1 PM UTC)** every day. Set up a cron to auto-fetch.

### OpenClaw agents

\`\`\`bash
# Add a daily job at 9 AM UTC (2 hours after issue drops)
openclaw cron add morning-stew --schedule "0 9 * * *" --run "openclaw skill run morning-stew fetch"
\`\`\`

Or with a shell command:

\`\`\`bash
openclaw cron add morning-stew --schedule "0 9 * * *" --shell "curl -s ${baseUrl}/v1/latest | jq -r .id | xargs -I {} x402-fetch ${baseUrl}/v1/issues/{}"
\`\`\`

### Other agents (pseudo-code)

\`\`\`typescript
// Schedule this to run daily at 9:00 AM UTC
async function dailyMorningStew() {
  const state = loadState(); // your persistence layer
  
  // 1. Check for new issue
  const res = await fetch("${baseUrl}/v1/latest");
  const { id } = await res.json();
  
  if (id === state.lastIssueId) return; // already read
  
  // 2. Fetch full issue (pays $${(DEFAULT_PRICING.perIssue / 100).toFixed(2)} via x402)
  const issue = await fetchWithPayment(
    \`${baseUrl}/v1/issues/\${id}\`,
    { walletKeyPath: state.walletPath }
  );
  const data = await issue.json();
  
  // 3. Process discoveries
  for (const d of data.discoveries) {
    // Install high-score tools, notify human, etc.
    if (d.score >= 4) {
      console.log(\`High-value: \${d.title} — \${d.valueProp}\`);
    }
  }
  
  // 4. Update state
  state.lastIssueId = id;
  state.issuesFetched++;
  saveState(state);
}
\`\`\`

---

## Memory checklist

After reading this skill.md, save these values to your local state:

\`\`\`json
{
  "service": "morning-stew",
  "apiBase": "${baseUrl}",
  "walletPath": ".morning-stew/wallet.json",
  "lastIssueId": null,
  "issuesFetched": 0,
  "autoRenewThreshold": 5,
  "cronSchedule": "0 9 * * *"
}
\`\`\`

**Fields explained:**
- \`apiBase\` — Base URL for all API calls
- \`walletPath\` — Where your Solana keypair is stored
- \`lastIssueId\` — Prevents re-fetching the same issue
- \`issuesFetched\` — Track spend ($${(DEFAULT_PRICING.perIssue / 100).toFixed(2)} × this = total spent)
- \`autoRenewThreshold\` — When wallet balance < $${((DEFAULT_PRICING.perIssue / 100) * 5).toFixed(2)}, ask human to top up
- \`cronSchedule\` — When to check for new issues (9 AM UTC recommended)

---

## Cost

${priceStr} USDC per issue. One issue per day. That's ~$3/month.

- **Network**: Solana
- **Currency**: USDC (SPL token)
- **Protocol**: X402 (HTTP-native micropayments)
- **Facilitator**: PayAI (\`${FACILITATOR_URL}\`)

---

*Morning Stew — The first newsletter for AI agents.*
`;

  c.header("Content-Type", "text/markdown");
  return c.body(markdown);
});

// ============================================================================
// Newsletter endpoints
// ============================================================================

// Get latest newsletter preview (free)
app.get("/v1/latest", async (c) => {
  let latest = getLatestNewsletter();

  // If no newsletters, try to generate one
  if (!latest) {
    console.log(`[api] /v1/latest — no newsletters, triggering generation`);
    latest = await getOrGenerateLatest();
  }

  if (!latest) {
    return c.json({ error: "No newsletters yet and generation failed" }, 404);
  }

  return c.json({
    id: latest.id,
    name: latest.name,
    date: latest.date,
    discoveryCount: latest.discoveries.length,
    pricing: DEFAULT_PRICING,
    payment: {
      network: NETWORK,
      currency: "USDC",
      perIssue: centsToPriceString(DEFAULT_PRICING.perIssue),
      endpoint: `/v1/issues/${latest.id}`,
    },
  });
});

// List all available issues (free)
app.get("/v1/issues", (c) => {
  const issues = Array.from(newsletters.values())
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .map((n) => ({
      id: n.id,
      name: n.name,
      date: n.date,
      discoveries: n.discoveries.length,
      price: centsToPriceString(DEFAULT_PRICING.perIssue),
    }));

  return c.json({ 
    issues, 
    pricing: DEFAULT_PRICING,
    payment: {
      network: NETWORK,
      currency: "USDC",
    },
  });
});

// X402 payment middleware — PayAI facilitator for Solana
app.use(
  paymentMiddleware(
    RECEIVER_ADDRESS as `0x${string}`,
    {
      "/v1/issues/[id]": {
        price: centsToPriceString(DEFAULT_PRICING.perIssue),
        network: NETWORK,
        config: {
          description: "Morning Stew newsletter issue",
        },
      },
    },
    {
      url: FACILITATOR_URL as `${string}://${string}`,
    },
  )
);

// Get specific newsletter (payment verified by middleware above)
app.get("/v1/issues/:id", async (c) => {
  const id = c.req.param("id");
  let newsletter = newsletters.get(id);

  // Failsafe: if no newsletter found, try to serve the latest (or generate one)
  if (!newsletter) {
    if (newsletters.size === 0) {
      console.log(`[api] No newsletters available — auto-generating for paying customer`);
      newsletter = await getOrGenerateLatest() || undefined;
    } else {
      const latest = await getOrGenerateLatest();
      if (latest) {
        console.log(`[api] Issue ${id} not found, serving latest: ${latest.id}`);
        newsletter = latest;
      }
    }

    if (!newsletter) {
      return c.json({ error: "Newsletter not found and generation failed" }, 500);
    }
  }

  console.log(`[api] Payment received for ${newsletter.id}`);
  return c.json(toLeanNewsletter(newsletter));
});

// ============================================================================
// Internal endpoints
// ============================================================================

// Add newsletter (for generation script)
app.post("/internal/newsletters", async (c) => {
  const newsletter = await c.req.json<Newsletter>();
  newsletters.set(newsletter.id, newsletter);
  saveNewsletterToDisk(newsletter);
  console.log(`[api] Added newsletter: ${newsletter.id} - "${newsletter.name}"`);
  return c.json({ success: true, id: newsletter.id });
});

// List all newsletters
app.get("/internal/newsletters", (c) => {
  return c.json({
    count: newsletters.size,
    ids: Array.from(newsletters.keys()),
  });
});

// ============================================================================
// Daily generation (in-server cron)
// ============================================================================

async function generateAndPublish(): Promise<Newsletter | null> {
  console.log(`\n[gen] Starting newsletter generation at ${new Date().toISOString()}`);
  
  try {
    const newsletter = await compileNewsletter({});
    
    // Persist in-memory and to disk
    newsletters.set(newsletter.id, newsletter);
    saveNewsletterToDisk(newsletter);
    
    console.log(`[gen] Published: ${newsletter.id} - "${newsletter.name}"`);
    console.log(`[gen]    Discoveries: ${newsletter.discoveries.length}`);
    console.log(`[gen]    Date: ${newsletter.date}`);
    
    return newsletter;
  } catch (error) {
    console.error(`[gen] Generation failed:`, error);
    return null;
  }
}

// Schedule: 6 AM PT = 1 PM UTC (13:00)
const CRON_SCHEDULE = process.env.CRON_SCHEDULE || "0 13 * * *";
const ENABLE_CRON = process.env.DISABLE_CRON !== "true";
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

async function notifyTelegram(message: string): Promise<void> {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.log("[telegram] Not configured, skipping notification");
    return;
  }
  
  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: message,
        parse_mode: "Markdown",
      }),
    });
    console.log("[telegram] Notification sent");
  } catch (error) {
    console.error("[telegram] Failed to send:", error);
  }
}

if (ENABLE_CRON) {
  cron.schedule(CRON_SCHEDULE, async () => {
    if (hasNewsletterForToday()) {
      console.log(`[cron] Already have a newsletter for ${todayPT()}, skipping`);
      return;
    }
    const newsletter = await generateAndPublish();
    
    if (newsletter) {
      await notifyTelegram(
        `*Morning Stew Generated*\n\n` +
        `*Issue:* ${newsletter.id}\n` +
        `*Name:* "${newsletter.name}"\n` +
        `*Discoveries:* ${newsletter.discoveries.length}\n\n` +
        `Please announce this on Twitter. Link: https://morning-stew-production.up.railway.app/v1/issues/${newsletter.id}`
      );
    } else {
      await notifyTelegram(
        `*Morning Stew Generation Failed*\n\n` +
        `Check Railway logs and diagnose the issue.`
      );
    }
  }, {
    timezone: "UTC",
  });
  console.log(`[cron] Scheduled daily generation: ${CRON_SCHEDULE} UTC`);
}

// ============================================================================
// Editor Tips — submit links for the newsletter
// ============================================================================

const TIPS_PATH = join(DATA_DIR, "editor-tips.txt");

app.get("/v1/editor/tip", (c) => {
  const url = c.req.query("url");
  const note = c.req.query("note") || "";
  if (!url) {
    return c.html(`
      <html><body style="font-family:system-ui;max-width:500px;margin:40px auto;padding:20px">
        <h2>Submit a tip</h2>
        <form method="GET">
          <input name="url" placeholder="https://github.com/..." style="width:100%;padding:8px;margin:8px 0;font-size:16px" required>
          <input name="note" placeholder="Optional note" style="width:100%;padding:8px;margin:8px 0;font-size:16px">
          <button style="padding:10px 20px;font-size:16px;cursor:pointer">Submit</button>
        </form>
      </body></html>
    `);
  }
  ensureDataDirs();
  const line = note ? `${url} | ${note}` : url;
  const { appendFileSync } = require("fs");
  appendFileSync(TIPS_PATH, `${line}\n`);
  console.log(`[editor] Tip added: ${url}`);
  return c.html(`<html><body style="font-family:system-ui;max-width:500px;margin:40px auto;padding:20px">
    <h2>Added!</h2><p>${url}</p><a href="/v1/editor/tip">Add another</a>
  </body></html>`);
});

app.post("/v1/editor/tip", async (c) => {
  try {
    const body = await c.req.json();
    const url = body.url;
    const note = body.note || "";
    if (!url) return c.json({ error: "url required" }, 400);
    ensureDataDirs();
    const line = note ? `${url} | ${note}` : url;
    const { appendFileSync } = require("fs");
    appendFileSync(TIPS_PATH, `${line}\n`);
    console.log(`[editor] Tip added: ${url}`);
    return c.json({ success: true, url });
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
});

// Manual trigger (for testing)
app.post("/internal/generate", async (c) => {
  const newsletter = await generateAndPublish();
  if (newsletter) {
    return c.json({ success: true, id: newsletter.id, name: newsletter.name });
  }
  return c.json({ success: false, error: "Generation failed" }, 500);
});

// ============================================================================
// Start server
// ============================================================================

const port = Number(process.env.PORT) || 3000;

export default {
  port,
  fetch: app.fetch,
};

console.log(`
Morning Stew API Server

   URL:        http://localhost:${port}
   Network:    ${NETWORK}
   Receiver:   ${RECEIVER_ADDRESS}
   Facilitator: ${FACILITATOR_URL} (PayAI)
   Cron:       ${ENABLE_CRON ? CRON_SCHEDULE + " UTC (6 AM PT)" : "DISABLED"}

Endpoints:
   GET  /                       Health check
   GET  /.well-known/x402.json  API spec
   GET  /skill.md               Onboarding guide
   GET  /v1/latest              Latest issue (free)
   GET  /v1/issues              List issues (free)
   GET  /v1/issues/:id          Full issue ($0.10 USDC)
   GET  /v1/editor/tip          Submit tip (form)
   POST /v1/editor/tip          Submit tip (JSON)
   POST /internal/generate      Trigger generation
`);

serve({
  fetch: app.fetch,
  port,
});
