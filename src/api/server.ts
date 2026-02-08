import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import { paymentMiddleware, x402ResourceServer } from "@x402/hono";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";
import type { Newsletter } from "../types";
import { DEFAULT_PRICING } from "../types";
import { NETWORKS, centsToPriceString } from "../payment/x402";

/**
 * Morning Stew API Server
 * 
 * X402 payment-gated newsletter API for AI agents.
 */

// Config from environment
const RECEIVER_ADDRESS = process.env.RECEIVER_ADDRESS || "0x7873D7d9DABc0722c1e88815193c83B260058553";
const USE_TESTNET = process.env.USE_TESTNET !== "false";
const NETWORK = USE_TESTNET ? NETWORKS.BASE_SEPOLIA : NETWORKS.BASE_MAINNET;
const FACILITATOR_URL = process.env.FACILITATOR_URL || "https://x402.org/facilitator";

// In-memory store (replace with Filecoin/IPFS in production)
const newsletters = new Map<string, Newsletter>();

// Initialize X402 facilitator client and resource server
const facilitatorClient = new HTTPFacilitatorClient({
  url: FACILITATOR_URL,
});

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
  });
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
  return c.json(newsletter);
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

Endpoints:
   GET  /                    Health check
   GET  /v1/latest           Latest issue preview (free)
   GET  /v1/issues           List all issues (free)
   GET  /v1/issues/:id       Full issue (X402 gated)
   GET  /v1/subscribe        Subscription info
   POST /internal/newsletters  Add newsletter
`);

serve({
  fetch: app.fetch,
  port,
});
