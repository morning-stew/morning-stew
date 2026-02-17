import type { Pricing } from "../types";
import { DEFAULT_PRICING } from "../types";

/**
 * X402 payment integration for Solana USDC.
 * 
 * X402 is an open protocol for HTTP 402 Payment Required responses.
 * Uses PayAI facilitator (https://facilitator.payai.network) for Solana payments.
 * 
 * Docs: https://docs.payai.network
 */

// Network identifiers — CAIP-2 format (x402 v2)
export const NETWORKS = {
  SOLANA_MAINNET: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
} as const;

export type Network = (typeof NETWORKS)[keyof typeof NETWORKS];

export interface X402Config {
  network: Network;
  receiverAddress: string;
  facilitatorUrl: string;
  pricing?: Pricing;
}

/**
 * Default config for Solana mainnet production
 */
export const MAINNET_CONFIG: Partial<X402Config> = {
  network: NETWORKS.SOLANA_MAINNET,
  facilitatorUrl: "https://facilitator.payai.network",
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
