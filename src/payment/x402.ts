import type { Subscription, SubscriptionTier, Pricing } from "../types";
import { DEFAULT_PRICING } from "../types";

/**
 * X402 payment integration for Base USDC.
 * 
 * X402 is an open protocol for HTTP 402 Payment Required responses.
 * Uses CAIP-2 network identifiers: eip155:8453 (Base mainnet), eip155:84532 (Base Sepolia)
 * 
 * Docs: https://docs.x402.org
 */

// CAIP-2 Network identifiers
export const NETWORKS = {
  BASE_MAINNET: "eip155:8453",
  BASE_SEPOLIA: "eip155:84532",
  // Future chains
  SOLANA_MAINNET: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
  SOLANA_DEVNET: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
} as const;

export type Network = (typeof NETWORKS)[keyof typeof NETWORKS];

export interface X402Config {
  network: Network;
  receiverAddress: string;
  facilitatorUrl: string;
  pricing?: Pricing;
}

/**
 * Default config for testnet development
 */
export const TESTNET_CONFIG: Partial<X402Config> = {
  network: NETWORKS.BASE_SEPOLIA,
  facilitatorUrl: "https://x402.org/facilitator",
};

/**
 * Default config for Base mainnet production
 */
export const MAINNET_CONFIG: Partial<X402Config> = {
  network: NETWORKS.BASE_MAINNET,
  // Use a production facilitator from https://x402.org/ecosystem
  facilitatorUrl: "https://x402.org/facilitator", // TODO: Use production facilitator
};

/**
 * Convert cents to price string for x402 SDK
 */
export function centsToPriceString(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/**
 * Build x402 route config for Hono middleware
 */
export function buildRouteConfig(
  issueId: string,
  config: X402Config
): {
  accepts: Array<{
    scheme: string;
    price: string;
    network: string;
    payTo: string;
  }>;
  description: string;
  mimeType: string;
} {
  const pricing = config.pricing || DEFAULT_PRICING;

  return {
    accepts: [
      {
        scheme: "exact",
        price: centsToPriceString(pricing.perIssue),
        network: config.network,
        payTo: config.receiverAddress,
      },
    ],
    description: `Morning Stew newsletter issue ${issueId}`,
    mimeType: "application/json",
  };
}

/**
 * Create a subscription record after successful payment.
 */
export function createSubscription(
  agentId: string,
  tier: SubscriptionTier,
  network: Network,
  transactionHash: string
): Subscription {
  const now = new Date();
  let expiresAt: string | undefined;

  if (tier === "weekly") {
    expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
  } else if (tier === "monthly") {
    expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
  }

  // Map network to chain name
  const chainMap: Record<Network, "base" | "monad" | "solana"> = {
    [NETWORKS.BASE_MAINNET]: "base",
    [NETWORKS.BASE_SEPOLIA]: "base",
    [NETWORKS.SOLANA_MAINNET]: "solana",
    [NETWORKS.SOLANA_DEVNET]: "solana",
  };

  return {
    id: `sub_${transactionHash.slice(0, 16)}`,
    walletAddress: agentId.toLowerCase(),
    tier,
    chain: chainMap[network] || "base",
    currency: "USDC",
    createdAt: now.toISOString(),
    expiresAt,
    issuesRemaining: tier === "bulk_250" ? 250 : undefined,
  };
}
