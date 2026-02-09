import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import { paymentMiddleware, x402ResourceServer } from "@x402/hono";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { facilitator as cdpFacilitator } from "@coinbase/x402";
import cron from "node-cron";
import type { Newsletter, Subscription } from "../types";
import { DEFAULT_PRICING, BULK_ISSUE_COUNT } from "../types";
import { NETWORKS, centsToPriceString } from "../payment/x402";
import { compileNewsletter } from "../compiler/compile";

/**
 * Morning Stew API Server
 * 
 * X402 payment-gated newsletter API for AI agents.
 */

// Config from environment
const RECEIVER_ADDRESS = process.env.RECEIVER_ADDRESS || "0x7873D7d9DABc0722c1e88815193c83B260058553";
const USE_TESTNET = process.env.USE_TESTNET !== "false";
const NETWORK = USE_TESTNET ? NETWORKS.BASE_SEPOLIA : NETWORKS.BASE_MAINNET;

// Facilitator: Use CDP for mainnet, x402.org for testnet
const FACILITATOR_URL = USE_TESTNET 
  ? "https://x402.org/facilitator" 
  : "cdp"; // CDP facilitator for mainnet (built into @coinbase/x402)

// In-memory store (replace with Filecoin/IPFS in production)
const newsletters = new Map<string, Newsletter>();

// Subscription store: wallet address (lowercase) -> subscription
const subscriptions = new Map<string, Subscription>();

/**
 * Check if a wallet has an active subscription with remaining issues
 */
function checkSubscription(walletAddress: string): { active: boolean; remaining?: number } {
  const sub = subscriptions.get(walletAddress.toLowerCase());
  if (!sub) return { active: false };
  
  if (sub.tier === "bulk_250" && sub.issuesRemaining && sub.issuesRemaining > 0) {
    return { active: true, remaining: sub.issuesRemaining };
  }
  
  return { active: false };
}

/**
 * Decrement subscription issue count
 */
function useSubscriptionIssue(walletAddress: string): boolean {
  const sub = subscriptions.get(walletAddress.toLowerCase());
  if (!sub || !sub.issuesRemaining || sub.issuesRemaining <= 0) return false;
  
  sub.issuesRemaining--;
  subscriptions.set(walletAddress.toLowerCase(), sub);
  console.log(`[subscription] ${walletAddress} used 1 issue, ${sub.issuesRemaining} remaining`);
  return true;
}

// Initialize X402 facilitator client and resource server
// For mainnet, use CDP's facilitator which handles auth automatically via env vars
// Set CDP_API_KEY_ID and CDP_API_KEY_SECRET in environment
const facilitatorClient = USE_TESTNET
  ? new HTTPFacilitatorClient({ url: "https://x402.org/facilitator" })
  : new HTTPFacilitatorClient(cdpFacilitator);

const x402Server = new x402ResourceServer(facilitatorClient)
  .register(NETWORK, new ExactEvmScheme());

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
// Layer 2: Self-describing / Discoverable endpoints
// ============================================================================

// Machine-readable X402 discovery
app.get("/.well-known/x402.json", (c) => {
  const baseUrl = c.req.url.replace("/.well-known/x402.json", "");
  
  return c.json({
    x402Version: 2,
    service: {
      name: "Morning Stew",
      description: "Daily AI agent newsletter with actionable discoveries, framework updates, and security alerts. Optimized for minimal token consumption.",
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
        description: "Full newsletter issue with discoveries and updates",
        price: centsToPriceString(DEFAULT_PRICING.perIssue),
        priceCents: DEFAULT_PRICING.perIssue,
        mimeType: "application/json",
        schema: {
          response: {
            id: "string (e.g., MS-2026-039)",
            name: "string (creative issue name)",
            date: "string (ISO date)",
            discoveries: "array of actionable discoveries with install steps",
            frameworkUpdates: "array of version updates",
            securityAlerts: "array of CVEs and fixes",
            tokenCount: "number (estimated tokens)",
          },
        },
      },
    ],
    freeEndpoints: [
      {
        path: "/v1/latest",
        method: "GET",
        description: "Preview of latest issue (discovery count, token count, pricing)",
      },
      {
        path: "/v1/issues",
        method: "GET",
        description: "List all available issues with metadata",
      },
      {
        path: "/v1/subscribe",
        method: "GET",
        description: "Subscription tiers and pricing",
      },
      {
        path: "/skill.md",
        method: "GET",
        description: "Human/agent-readable usage instructions",
      },
    ],
    usage: {
      workflow: [
        "1. GET /v1/latest to see today's issue preview",
        "2. GET /v1/issues/{id} with X-PAYMENT header to purchase",
        "3. Parse discoveries[].install for actionable commands",
      ],
      agentTip: "Each discovery includes 'install' field with shell commands your agent can execute directly.",
    },
  });
});

// Human/agent-readable skill documentation
app.get("/skill.md", (c) => {
  const issues = Array.from(newsletters.values()).sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  );
  const latestId = issues[0]?.id || "MS-YYYY-NNN";
  const latestName = issues[0]?.name || "(none yet)";

  const baseUrl = c.req.url.replace("/skill.md", "");
  
  const markdown = `# Morning Stew

> Daily AI agent newsletter. ${centsToPriceString(DEFAULT_PRICING.perIssue)} USDC per issue. Base mainnet.

## Quick Start (One-liner)

\`\`\`typescript
const newsletter = await x402.fetch("${baseUrl}/v1/issues/${latestId}");
\`\`\`

That's it. Your agent pays ${centsToPriceString(DEFAULT_PRICING.perIssue)} USDC, gets today's discoveries with install commands.

## What You Get

Each issue contains curated discoveries. Only tools scoring 3+/5 on our quality rubric make it in.

\`\`\`json
{
  "date": "2026-02-08",
  "discoveries": [
    {
      "title": "awesome-claude-code-toolkit",
      "what": "Curated extensions for Claude Code agents",
      "utility": "GitHub integration + Claude-optimized for your agent",
      "install": ["git clone https://github.com/...", "npm install"],
      "signals": { "stars": 401, "qualityScore": 4.0 },
      "url": "https://github.com/rohitg00/awesome-claude-code-toolkit"
    }
  ],
  "onRadar": [...],
  "frameworkUpdates": [...],
  "securityNotes": [...]
}
\`\`\`

## Subscription (Recommended)

Pay once, get ${BULK_ISSUE_COUNT} issues. No per-request payments.

\`\`\`typescript
// Subscribe for ${BULK_ISSUE_COUNT} issues ($${(DEFAULT_PRICING.bulk250 / 100).toFixed(2)} USDC)
await x402.fetch("${baseUrl}/v1/subscribe/bulk", { method: "POST" });

// Then access issues with just your wallet header (no payment needed)
const newsletter = await fetch("${baseUrl}/v1/issues/${latestId}", {
  headers: { "X-SUBSCRIBER-WALLET": "0xYourWallet..." }
});
\`\`\`

Check your status: \`GET /v1/subscribe/status/{wallet}\`

## Endpoints

| Endpoint | Cost | Description |
|----------|------|-------------|
| \`GET /v1/latest\` | Free | Preview: issue ID, discovery count |
| \`GET /v1/issues/{id}\` | ${centsToPriceString(DEFAULT_PRICING.perIssue)} | Full issue (or free with subscription) |
| \`POST /v1/subscribe/bulk\` | $${(DEFAULT_PRICING.bulk250 / 100).toFixed(2)} | Subscribe for ${BULK_ISSUE_COUNT} issues |
| \`GET /v1/subscribe/status/{wallet}\` | Free | Check subscription status |
| \`GET /skill.md\` | Free | This document |

## For Your Agent

1. **Subscribe once**: \`POST /v1/subscribe/bulk\` with x402 payment ($${(DEFAULT_PRICING.bulk250 / 100).toFixed(2)})
2. **Access issues**: \`GET /v1/issues/{id}\` with \`X-SUBSCRIBER-WALLET\` header
3. **Execute**: Loop through \`discoveries[].install\` and run the commands

## Current Issue

- **ID**: \`${latestId}\`
- **Name**: "${latestName}"
- **Price**: ${centsToPriceString(DEFAULT_PRICING.perIssue)} USDC on Base

## Payment

- **Network**: Base mainnet (\`eip155:8453\`)
- **Currency**: USDC
- **Protocol**: [X402](https://x402.org) - HTTP-native micropayments

Your agent needs a funded wallet on Base with USDC. Use \`@x402/fetch\` or any x402-compatible client.

---

*Morning Stew - The first newsletter for AI agents.*
`;

  c.header("Content-Type", "text/markdown");
  return c.body(markdown);
});

// Get latest newsletter preview (free)
app.get("/v1/latest", (c) => {
  const issues = Array.from(newsletters.values()).sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  );

  if (issues.length === 0) {
    return c.json({ error: "No newsletters yet" }, 404);
  }

  const latest = issues[0];

  return c.json({
    id: latest.id,
    name: latest.name,
    date: latest.date,
    preview: {
      discoveryCount: latest.discoveries.length,
      updateCount: latest.frameworkUpdates.length,
    },
    tokenCount: latest.tokenCount,
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
      tokenCount: n.tokenCount,
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

// X402 payment middleware - applied globally, routes are matched by config keys
// Get specific newsletter - handles both subscription and per-issue payment
app.get("/v1/issues/:id", async (c, next) => {
  const id = c.req.param("id");
  const newsletter = newsletters.get(id);

  if (!newsletter) {
    return c.json({ error: "Newsletter not found" }, 404);
  }

  // Check for subscription header (wallet address)
  const subscriberWallet = c.req.header("X-SUBSCRIBER-WALLET");
  
  if (subscriberWallet) {
    const status = checkSubscription(subscriberWallet);
    if (status.active) {
      // Valid subscription - decrement and serve
      useSubscriptionIssue(subscriberWallet);
      const remaining = checkSubscription(subscriberWallet).remaining || 0;
      console.log(`[api] Subscriber ${subscriberWallet} accessed ${newsletter.id} (${remaining} remaining)`);
      return serveNewsletter(c, newsletter, remaining);
    }
  }
  
  // No valid subscription - require X402 payment via middleware
  return paymentMiddleware(
    {
      "GET /v1/issues/*": {
        accepts: {
          scheme: "exact",
          price: centsToPriceString(DEFAULT_PRICING.perIssue),
          network: NETWORK,
          payTo: RECEIVER_ADDRESS,
        },
        description: "Morning Stew newsletter issue",
        mimeType: "application/json",
      },
    },
    x402Server
  )(c, async () => {
    // Payment verified - serve the newsletter
    console.log(`[api] Payment received for ${newsletter.id}`);
    return serveNewsletter(c, newsletter);
  });
});

// Helper to serve newsletter in agent-optimized format
function serveNewsletter(c: any, newsletter: Newsletter, subscriptionRemaining?: number) {
  
  // Return agent-optimized format
  const agentResponse: Record<string, any> = {
    id: newsletter.id,
    name: newsletter.name,
    date: newsletter.date,
    isQuietWeek: newsletter.isQuietWeek || false,
    
    // Main content: curated discoveries in agent-readable format
    discoveries: newsletter.discoveries.map(d => ({
      title: d.title,
      what: d.oneLiner.slice(0, 120),
      utility: d.valueProp,
      install: d.install.steps.filter((s: string) => 
        !s.startsWith("#") || s.includes("npm") || s.includes("pip") || s.includes("git")
      ).slice(0, 5),
      signals: {
        stars: d.signals?.engagement,
        source: d.source.type,
        qualityScore: d.qualityScore?.total || 0,
      },
      url: d.source.url,
    })),
    
    // Promising but not ready
    onRadar: newsletter.onRadar?.map(item => ({
      title: item.title,
      reason: item.reason,
      url: item.url,
    })),
    
    // Framework updates
    frameworkUpdates: newsletter.frameworkUpdates.map(u => ({
      title: u.title,
      summary: u.summary,
      breaking: u.breaking,
      url: u.url,
    })),
    
    // Security notes
    securityNotes: newsletter.securityNotes,
    
    // Meta
    tokenCount: newsletter.tokenCount,
  };
  
  // Add subscription info if applicable
  if (subscriptionRemaining !== undefined) {
    agentResponse.subscription = {
      issuesRemaining: subscriptionRemaining,
    };
  }
  
  return c.json(agentResponse);
}

// Subscription info (free)
app.get("/v1/subscribe", (c) => {
  return c.json({
    tiers: {
      per_issue: {
        price: centsToPriceString(DEFAULT_PRICING.perIssue),
        priceCents: DEFAULT_PRICING.perIssue,
        description: "Pay per newsletter",
      },
      bulk_250: {
        price: centsToPriceString(DEFAULT_PRICING.bulk250),
        priceCents: DEFAULT_PRICING.bulk250,
        issues: BULK_ISSUE_COUNT,
        description: `Pay $${(DEFAULT_PRICING.bulk250 / 100).toFixed(2)} upfront for ${BULK_ISSUE_COUNT} issues. No per-request payments needed.`,
        endpoint: "/v1/subscribe/bulk",
      },
    },
    currency: "USDC",
    network: NETWORK,
    chains: ["base"],
    recommended: "bulk_250",
  });
});

// Check subscription status (free)
app.get("/v1/subscribe/status/:wallet", (c) => {
  const wallet = c.req.param("wallet");
  const status = checkSubscription(wallet);
  
  return c.json({
    wallet: wallet.toLowerCase(),
    subscribed: status.active,
    issuesRemaining: status.remaining || 0,
    tier: status.active ? "bulk_250" : null,
  });
});

// X402 payment middleware for bulk subscription
app.use(
  "/v1/subscribe/bulk",
  paymentMiddleware(
    {
      "POST /v1/subscribe/bulk": {
        accepts: {
          scheme: "exact",
          price: centsToPriceString(DEFAULT_PRICING.bulk250),
          network: NETWORK,
          payTo: RECEIVER_ADDRESS,
        },
        description: `Morning Stew bulk subscription - ${BULK_ISSUE_COUNT} issues`,
        mimeType: "application/json",
      },
    },
    x402Server
  )
);

// Purchase bulk subscription (X402 payment required)
app.post("/v1/subscribe/bulk", async (c) => {
  // Extract payer wallet from x402 payment header
  // The payment was already verified by middleware
  const paymentHeader = c.req.header("X-PAYMENT");
  let payerWallet = "unknown";
  
  // Try to extract wallet from payment header (base64 JSON)
  if (paymentHeader) {
    try {
      const decoded = JSON.parse(Buffer.from(paymentHeader, "base64").toString());
      payerWallet = decoded.payload?.authorization?.from || decoded.from || "unknown";
    } catch {
      // Try to get from request body as fallback
      const body = await c.req.json().catch(() => ({}));
      payerWallet = body.wallet || "unknown";
    }
  }
  
  // Create subscription
  const subscription: Subscription = {
    id: `sub-${Date.now()}`,
    walletAddress: payerWallet.toLowerCase(),
    tier: "bulk_250",
    chain: "base",
    currency: "USDC",
    createdAt: new Date().toISOString(),
    issuesRemaining: BULK_ISSUE_COUNT,
  };
  
  subscriptions.set(payerWallet.toLowerCase(), subscription);
  
  console.log(`[subscription] New bulk subscription: ${payerWallet} - ${BULK_ISSUE_COUNT} issues`);
  
  return c.json({
    success: true,
    subscription: {
      id: subscription.id,
      wallet: subscription.walletAddress,
      issuesRemaining: subscription.issuesRemaining,
      tier: subscription.tier,
    },
    message: `Subscribed! You have ${BULK_ISSUE_COUNT} issues available. Access /v1/issues/{id} without payment.`,
  });
});

// Internal: Add newsletter (for generation script)
app.post("/internal/newsletters", async (c) => {
  const newsletter = await c.req.json<Newsletter>();
  newsletters.set(newsletter.id, newsletter);
  console.log(`[api] Added newsletter: ${newsletter.id} - "${newsletter.name}"`);
  return c.json({ success: true, id: newsletter.id });
});

// Internal: List all newsletters
app.get("/internal/newsletters", (c) => {
  return c.json({
    count: newsletters.size,
    ids: Array.from(newsletters.keys()),
  });
});

// ============================================================================
// Layer 3: Autonomous Daily Generation (in-server cron)
// ============================================================================

async function generateAndPublish(): Promise<Newsletter | null> {
  console.log(`\n[cron] 🍵 Starting daily newsletter generation at ${new Date().toISOString()}`);
  
  try {
    const newsletter = await compileNewsletter({
      headless: true,
    });
    
    newsletters.set(newsletter.id, newsletter);
    console.log(`[cron] ✅ Published: ${newsletter.id} - "${newsletter.name}"`);
    console.log(`[cron]    Discoveries: ${newsletter.discoveries.length}`);
    console.log(`[cron]    Tokens: ${newsletter.tokenCount}`);
    
    return newsletter;
  } catch (error) {
    console.error(`[cron] ❌ Generation failed:`, error);
    return null;
  }
}

// Schedule: 6 AM PT = 1 PM UTC (13:00)
// Cron: minute hour day month weekday
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
    const newsletter = await generateAndPublish();
    
    if (newsletter) {
      // Notify OpenClaw via Telegram
      await notifyTelegram(
        `🍵 *Morning Stew Generated*\n\n` +
        `*Issue:* ${newsletter.id}\n` +
        `*Name:* "${newsletter.name}"\n` +
        `*Discoveries:* ${newsletter.discoveries.length}\n\n` +
        `Please announce this on Twitter. Link: https://morning-stew-production.up.railway.app/v1/issues/${newsletter.id}`
      );
    } else {
      await notifyTelegram(
        `❌ *Morning Stew Generation Failed*\n\n` +
        `Check Railway logs and diagnose the issue.`
      );
    }
  }, {
    timezone: "UTC",
  });
  console.log(`[cron] Scheduled daily generation: ${CRON_SCHEDULE} UTC`);
}

// Manual trigger endpoint (for testing)
app.post("/internal/generate", async (c) => {
  const newsletter = await generateAndPublish();
  if (newsletter) {
    return c.json({ success: true, id: newsletter.id, name: newsletter.name });
  }
  return c.json({ success: false, error: "Generation failed" }, 500);
});

// Start server
const port = Number(process.env.PORT) || 3000;

export default {
  port,
  fetch: app.fetch,
};

// Start server
console.log(`
╔══════════════════════════════════════════════════════════════╗
║  🍵 Morning Stew API Server                                   ║
╚══════════════════════════════════════════════════════════════╝

   URL:        http://localhost:${port}
   Network:    ${NETWORK}
   Receiver:   ${RECEIVER_ADDRESS}
   Facilitator: ${FACILITATOR_URL}
   Cron:       ${ENABLE_CRON ? CRON_SCHEDULE + " UTC (6 AM PT)" : "DISABLED"}

Endpoints:
   GET  /                       Health check + discovery
   GET  /.well-known/x402.json  Machine-readable API spec
   GET  /skill.md               Agent-readable docs
   GET  /v1/latest              Latest issue preview (free)
   GET  /v1/issues              List all issues (free)
   GET  /v1/issues/:id          Full issue (X402 gated - $0.05)
   POST /internal/generate      Trigger generation manually
`);

serve({
  fetch: app.fetch,
  port,
});
