import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import { paymentMiddleware } from "@x402/hono";
import { x402ResourceServer, HTTPFacilitatorClient } from "@x402/core/server";
import { registerExactSvmScheme } from "@x402/svm/exact/server";
import { SOLANA_MAINNET_CAIP2, SOLANA_DEVNET_CAIP2 } from "@x402/svm";
import { registerExactEvmScheme } from "@x402/evm/exact/server";
import cron from "node-cron";
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, unlinkSync } from "fs";
import { join } from "path";
import type { Newsletter } from "../types";
import { DEFAULT_PRICING } from "../types";
import { toLeanNewsletter } from "../types/newsletter";
import { centsToPriceString } from "../payment/x402";
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
const NETWORK = USE_TESTNET ? SOLANA_DEVNET_CAIP2 : SOLANA_MAINNET_CAIP2;

// PayAI facilitator — Solana-first, no API keys needed
const FACILITATOR_URL = process.env.FACILITATOR_URL || "https://facilitator.payai.network";

// x402 v2 — Solana server (PayAI facilitator)
const facilitatorClient = new HTTPFacilitatorClient({ url: FACILITATOR_URL as `${string}://${string}` });
const x402Server = new x402ResourceServer(facilitatorClient);
registerExactSvmScheme(x402Server);

// x402 v2 — Monad server (OpenX402 facilitator)
const MONAD_RECEIVER_ADDRESS = process.env.MONAD_RECEIVER_ADDRESS || "";
const MONAD_FACILITATOR_URL = process.env.MONAD_FACILITATOR_URL || "https://facilitator.openx402.ai";
const MONAD_NETWORK = "eip155:143"; // Monad mainnet
const MONAD_USDC = "0x754704Bc059F8C67012fEd69BC8A327a5aafb603";

const monadFacilitatorClient = new HTTPFacilitatorClient({ url: MONAD_FACILITATOR_URL as `${string}://${string}` });
const monadServer = new x402ResourceServer(monadFacilitatorClient);
registerExactEvmScheme(monadServer);

// ============================================================================
// Newsletter persistence — file-based store (survives process restarts)
// ============================================================================

const DATA_DIR = process.env.DATA_DIR || join(process.cwd(), ".morning-stew");
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

/** Get the latest newsletter by date, then by ID descending as tiebreaker */
function getLatestNewsletter(): Newsletter | null {
  const issues = Array.from(newsletters.values()).sort((a, b) => {
    const dateDiff = new Date(b.date).getTime() - new Date(a.date).getTime();
    if (dateDiff !== 0) return dateDiff;
    // Same date — compare IDs so the highest-numbered issue wins
    return b.id.localeCompare(a.id, undefined, { numeric: true });
  });
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
    x402Version: 2, // protocol version
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
        description: "Full newsletter issue — pay with Solana USDC",
        price: centsToPriceString(DEFAULT_PRICING.perIssue),
        network: NETWORK,
        mimeType: "application/json",
      },
      {
        path: "/v1/issues/monad/{id}",
        method: "GET",
        description: "Full newsletter issue — pay with Monad USDC",
        price: centsToPriceString(DEFAULT_PRICING.perIssue),
        network: MONAD_NETWORK,
        mimeType: "application/json",
      },
    ],
    freeEndpoints: [
      { path: "/v1/latest", method: "GET", description: "Latest issue preview" },
      { path: "/v1/issues", method: "GET", description: "List all issues" },
      { path: "/v1/issues/free", method: "GET", description: "Free edition (Issue #0) — full content, no payment required" },
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
  const baseUrl = "https://morning-stew-production.up.railway.app";

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

...make it into the newsletter. Each issue has exactly 6 discoveries.

Each discovery includes: a one-liner, a value prop, install commands you can run directly, tags for filtering, a quality score, and a source URL.

---

## Paying with Solana

**Endpoint:** \`GET /v1/issues/{id}\`
**Facilitator:** PayAI — covers all gas fees, no SOL needed, only USDC

### Wallet setup

**No wallet yet:**

\`\`\`javascript
const { Keypair } = require('@solana/web3.js');
const { writeFileSync } = require('fs');

const keypair = Keypair.generate();
const privateKey = Buffer.from(keypair.secretKey).toString('base64');
const publicKey = keypair.publicKey.toBase58();

writeFileSync('./solana-key.json', JSON.stringify({ privateKey, publicKey }, null, 2));
console.log('Send USDC to:', publicKey);
\`\`\`

> Never used crypto before? Download **Coinbase** or **Binance**, buy USDC, and send it to the address above. $1 is enough for 10 issues. No SOL needed.

**Already have a wallet:**

\`\`\`javascript
const { Keypair } = require('@solana/web3.js');
const { privateKey } = JSON.parse(require('fs').readFileSync('./solana-key.json', 'utf-8'));
const keypair = Keypair.fromSecretKey(Buffer.from(privateKey, 'base64'));
\`\`\`

### Step 1: Get payment requirements

\`\`\`bash
curl -s ${baseUrl}/v1/issues/${latestId}
\`\`\`

Returns 402. From the \`accepts\` array extract: \`maxAmountRequired\`, \`payTo\`, \`asset\`, \`extra.feePayer\`.

### Step 2: Build the transaction

PayAI requires **exactly 3 instructions**:

\`\`\`javascript
const { Transaction, ComputeBudgetProgram } = require('@solana/web3.js');
const { createTransferCheckedInstruction } = require('@solana/spl-token');

const tx = new Transaction();
tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 10000 }));
tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1000 }));
tx.add(createTransferCheckedInstruction(
  sourceATA,      // your USDC token account
  USDC_MINT,      // EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
  destATA,        // recipient's USDC token account
  keypair.publicKey,
  amount,         // BigInt from maxAmountRequired
  6               // USDC decimals
));

tx.feePayer = new PublicKey(extra.feePayer);
tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
tx.partialSign(keypair);
\`\`\`

### Step 3: Send payment

\`\`\`javascript
const payload = {
  x402Version: 2,
  scheme: 'exact',
  network: '${NETWORK}',
  payload: { transaction: tx.serialize({ requireAllSignatures: false }).toString('base64') }
};

const response = await fetch('${baseUrl}/v1/issues/${latestId}', {
  headers: { 'PAYMENT-SIGNATURE': Buffer.from(JSON.stringify(payload)).toString('base64') }
});
const newsletter = await response.json();
\`\`\`

**Key requirements:** Use \`createTransferCheckedInstruction\` (not \`Transfer\`), keep compute units at 10000, use \`payload.transaction\` (not \`serializedTransaction\`).

---

## Paying with Monad

**Endpoint:** \`GET /v1/issues/monad/{id}\`
**Network:** Monad mainnet (\`eip155:143\`) — 10,000 TPS, ~0.4s finality
**Facilitator:** OpenX402 — gasless via EIP-3009 transferWithAuthorization

### Wallet setup

**No wallet yet:**

\`\`\`javascript
const { ethers } = require('ethers');
const { writeFileSync } = require('fs');

const wallet = ethers.Wallet.createRandom();
writeFileSync('./monad-key.json', JSON.stringify({
  address: wallet.address,
  privateKey: wallet.privateKey
}, null, 2));
console.log('Send USDC to:', wallet.address);
\`\`\`

> Send Monad USDC (\`0x754704Bc059F8C67012fEd69BC8A327a5aafb603\`) to that address. No MONAD token needed for gas.

**Already have a wallet:**

\`\`\`javascript
const { ethers } = require('ethers');
const { privateKey } = JSON.parse(require('fs').readFileSync('./monad-key.json', 'utf-8'));
const wallet = new ethers.Wallet(privateKey);
\`\`\`

### Step 1: Get payment requirements

\`\`\`bash
curl -s ${baseUrl}/v1/issues/monad/${latestId}
\`\`\`

Returns 402. Extract: \`amount\`, \`asset\` (USDC contract), \`payTo\`, \`extra.name\`, \`extra.version\`.

### Step 2: Sign EIP-3009 authorization

\`\`\`javascript
const now = Math.floor(Date.now() / 1000);
const nonce = ethers.hexlify(ethers.randomBytes(32));

const domain = { name: extra.name, version: extra.version, chainId: 143,
  verifyingContract: asset };

const types = { TransferWithAuthorization: [
  { name: 'from', type: 'address' }, { name: 'to', type: 'address' },
  { name: 'value', type: 'uint256' }, { name: 'validAfter', type: 'uint256' },
  { name: 'validBefore', type: 'uint256' }, { name: 'nonce', type: 'bytes32' }
]};

const message = { from: wallet.address, to: payTo, value: amount,
  validAfter: now - 60, validBefore: now + 900, nonce };

const signature = await wallet.signTypedData(domain, types, message);
\`\`\`

### Step 3: Send payment

\`\`\`javascript
const payload = {
  x402Version: 2,
  scheme: 'exact',
  network: 'eip155:143',
  payload: { authorization: message, signature }
};

const response = await fetch('${baseUrl}/v1/issues/monad/${latestId}', {
  headers: { 'PAYMENT-SIGNATURE': Buffer.from(JSON.stringify(payload)).toString('base64') }
});
const newsletter = await response.json();
\`\`\`

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
  "id": "MS-#3",
  "name": "Issue #3",
  "date": "2026-02-15",
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

## Free Edition

Issue #0 is available for free — no payment, no wallet required:

\`\`\`
GET ${baseUrl}/v1/issues/free
\`\`\`

Returns the full Issue #0 content in the same JSON format as paid issues.

---

## Endpoints

| Endpoint | Cost | Network | What it does |
|----------|------|---------|--------------|
| \`GET /v1/latest\` | Free | — | Latest issue ID + discovery count |
| \`GET /v1/issues\` | Free | — | List all available issues |
| \`GET /v1/issues/free\` | Free | — | Issue #0 — full content, no payment |
| \`GET /v1/issues/{id}\` | ${priceStr} USDC | Solana | Full issue — default payment path |
| \`GET /v1/issues/monad/{id}\` | ${priceStr} USDC | Monad | Full issue — pay with Monad USDC |
| \`GET /skill.md\` | Free | — | This document |

### Paying with Monad

If you have a Monad wallet instead of Solana, use the \`/v1/issues/monad/{id}\` endpoint:

\`\`\`
GET ${baseUrl}/v1/issues/monad/{id}
\`\`\`

- **Network**: Monad mainnet (\`eip155:143\`)
- **USDC contract**: \`0x754704Bc059F8C67012fEd69BC8A327a5aafb603\`
- **Facilitator**: OpenX402 (\`https://facilitator.openx402.ai\`)
- **Payment method**: EIP-3009 transferWithAuthorization — no ETH required for gas
- **Price**: same ${priceStr} USDC per issue

The content returned is identical to the Solana endpoint — same JSON, same discoveries.

---

## Daily automation

New issues drop at **6 AM Pacific (1 PM UTC)** every day.

### Memory checklist

After reading this skill.md, save to \`~/.morning-stew/state.json\`:

\`\`\`json
{
  "service": "morning-stew",
  "apiBase": "${baseUrl}",
  "usdcMint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  "lastIssueId": null,
  "issuesFetched": 0
}
\`\`\`

**Fields:**
- \`apiBase\` — Base URL for API calls
- \`usdcMint\` — USDC token mint on Solana mainnet
- \`lastIssueId\` — Prevents re-fetching same issue
- \`issuesFetched\` — Track spend ($${(DEFAULT_PRICING.perIssue / 100).toFixed(2)} × this = total)

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

// Free issue — no payment required (Issue #0 = MS-#0)
app.get("/v1/issues/free", (c) => {
  // Find the free issue: the one with id "MS-#0"
  const freeIssue = newsletters.get("MS-#0");
  if (!freeIssue) {
    return c.json({ error: "Free issue not yet available" }, 404);
  }
  return c.json(toLeanNewsletter(freeIssue));
});

// X402 v2 payment middleware — PayAI facilitator for Solana
app.use(
  paymentMiddleware(
    {
      "/v1/issues/:id": {
        accepts: [
          {
            scheme: "exact",
            network: NETWORK,
            payTo: RECEIVER_ADDRESS,
            price: centsToPriceString(DEFAULT_PRICING.perIssue),
          },
        ],
        description: "Morning Stew newsletter issue",
        mimeType: "application/json",
      },
    },
    x402Server,
  )
);

// Monad payment middleware
app.use(
  paymentMiddleware(
    {
      "/v1/issues/monad/:id": {
        accepts: [
          {
            scheme: "exact",
            network: MONAD_NETWORK,
            payTo: MONAD_RECEIVER_ADDRESS,
            price: centsToPriceString(DEFAULT_PRICING.perIssue),
          },
        ],
        description: "Morning Stew newsletter issue (Monad)",
        mimeType: "application/json",
      },
    },
    monadServer,
  )
);

// Get specific newsletter via Monad payment
app.get("/v1/issues/monad/:id", async (c) => {
  const id = c.req.param("id");
  const newsletter = newsletters.get(id) ?? (await getOrGenerateLatest()) ?? undefined;
  if (!newsletter) return c.json({ error: "Not found" }, 404);
  console.log(`[api] Monad payment received for ${newsletter.id}`);
  return c.json(toLeanNewsletter(newsletter));
});

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

// Delete a newsletter by ID
app.delete("/internal/newsletters/:id", (c) => {
  const authHeader = c.req.header("Authorization");
  const providedSecret = authHeader?.replace("Bearer ", "");
  if (!INTERNAL_SECRET || providedSecret !== INTERNAL_SECRET) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const id = c.req.param("id");
  if (!newsletters.has(id)) {
    return c.json({ error: "Not found", id }, 404);
  }

  newsletters.delete(id);
  // Remove from disk
  for (const suffix of [".json", ".full.json"]) {
    const p = join(ISSUES_DIR, `${id}${suffix}`);
    if (existsSync(p)) unlinkSync(p);
  }
  console.log(`[api] Deleted newsletter: ${id}`);
  return c.json({ success: true, deleted: id });
});

// Edit any field of a newsletter (remote build authority)
app.patch("/internal/newsletters/:id", async (c) => {
  const authHeader = c.req.header("Authorization");
  const providedSecret = authHeader?.replace("Bearer ", "");
  if (!INTERNAL_SECRET || providedSecret !== INTERNAL_SECRET) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const id = c.req.param("id");
  const existing = newsletters.get(id);
  if (!existing) {
    return c.json({ error: "Not found", id }, 404);
  }

  const updates = await c.req.json<Partial<Newsletter>>();

  // Merge updates into existing newsletter (only provided fields)
  const updated: Newsletter = { ...existing, ...updates, id }; // id is immutable

  newsletters.set(id, updated);
  saveNewsletterToDisk(updated);

  console.log(`[api] Updated newsletter: ${id} — fields: ${Object.keys(updates).join(", ")}`);
  return c.json({ success: true, id, updated: Object.keys(updates) });
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

// Manual trigger (protected by secret)
const INTERNAL_SECRET = process.env.INTERNAL_SECRET || "";

app.post("/internal/generate", async (c) => {
  const authHeader = c.req.header("Authorization");
  const providedSecret = authHeader?.replace("Bearer ", "");
  
  if (!INTERNAL_SECRET || providedSecret !== INTERNAL_SECRET) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  
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
   POST /internal/generate              Trigger generation
   PATCH /internal/newsletters/:id      Edit any newsletter field
   GET  /v1/issues/monad/:id            Full issue ($0.10 USDC, Monad)
`);

serve({
  fetch: app.fetch,
  port,
});
