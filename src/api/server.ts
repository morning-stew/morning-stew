import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import { paymentMiddleware, x402ResourceServer } from "@x402/hono";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { facilitator as cdpFacilitator } from "@coinbase/x402";
import cron from "node-cron";
import type { Newsletter } from "../types";
import { DEFAULT_PRICING } from "../types";
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

  const markdown = `# Morning Stew

> The first newsletter for AI agents. Daily discoveries, minimal tokens.

## What is this?

Morning Stew is a daily newsletter designed for AI agents, not humans. Each issue contains:

- **Discoveries**: New tools, integrations, and capabilities with install commands
- **Framework Updates**: Version bumps for popular AI/agent frameworks
- **Security Alerts**: CVEs and patches relevant to agent infrastructure

## Pricing

- **Per issue**: ${centsToPriceString(DEFAULT_PRICING.perIssue)} USDC
- **Network**: ${NETWORK} (${USE_TESTNET ? "Base Sepolia testnet" : "Base mainnet"})

## How to use (for agents)

### 1. Check latest issue (free)

\`\`\`bash
curl ${c.req.url.replace("/skill.md", "")}/v1/latest
\`\`\`

### 2. Purchase an issue (X402 payment)

\`\`\`typescript
import { x402Fetch } from "@x402/fetch";

const response = await x402Fetch(
  "${c.req.url.replace("/skill.md", "")}/v1/issues/${latestId}",
  { wallet }  // your funded wallet
);

const newsletter = await response.json();

// Execute discoveries
for (const discovery of newsletter.discoveries) {
  if (discovery.install) {
    console.log(\`Installing: \${discovery.name}\`);
    // exec(discovery.install)
  }
}
\`\`\`

### 3. Schema

Each discovery has:
\`\`\`json
{
  "title": "Tool name",
  "what": "One-line description of what this is",
  "utility": "One-line explanation of how it's specifically useful to you",
  "install": ["git clone ...", "npm install", "..."],
  "signals": {
    "stars": 500,
    "source": "github|twitter|hackernews",
    "qualityScore": 4.2
  },
  "url": "https://github.com/..."
}
\`\`\`

Quality scores range 0-5. Only discoveries scoring 3+ are included.

## Current Issue

- **ID**: ${latestId}
- **Name**: "${latestName}"
- **Issues available**: ${issues.length}

## Discovery endpoints

- \`/.well-known/x402.json\` - Machine-readable API spec
- \`/skill.md\` - This document

---

*Morning Stew is part of the OpenClaw ecosystem.*
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
app.use(
  paymentMiddleware(
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
  )
);

// Get specific newsletter (X402 middleware handles payment verification above)
app.get("/v1/issues/:id", async (c) => {
  const id = c.req.param("id");
  const newsletter = newsletters.get(id);

  if (!newsletter) {
    return c.json({ error: "Newsletter not found" }, 404);
  }

  // If we reach here, payment was verified by X402 middleware
  console.log(`[api] Payment received for ${newsletter.id}`);
  
  // Return agent-optimized format
  const agentResponse = {
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
  
  return c.json(agentResponse);
});

// Subscription info (free)
app.get("/v1/subscribe", (c) => {
  return c.json({
    tiers: {
      per_issue: {
        price: centsToPriceString(DEFAULT_PRICING.perIssue),
        priceCents: DEFAULT_PRICING.perIssue,
        description: "Pay per newsletter",
      },
      weekly: {
        price: centsToPriceString(DEFAULT_PRICING.weekly),
        priceCents: DEFAULT_PRICING.weekly,
        description: "7 days of access",
      },
      monthly: {
        price: centsToPriceString(DEFAULT_PRICING.monthly),
        priceCents: DEFAULT_PRICING.monthly,
        description: "30 days of access",
      },
    },
    currency: "USDC",
    network: NETWORK,
    chains: ["base"],
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
