import { z } from "zod";

export const SubscriptionTierSchema = z.enum(["per_issue", "weekly", "monthly", "bulk_250"]);

export const SubscriptionSchema = z.object({
  id: z.string(),
  walletAddress: z.string(), // subscriber's wallet address (lowercase)
  tier: SubscriptionTierSchema,
  chain: z.enum(["base", "monad", "solana"]),
  currency: z.literal("USDC"),
  createdAt: z.string(),
  expiresAt: z.string().optional(), // for time-based subs
  issuesRemaining: z.number().optional(), // for bulk subs
});

export const PricingSchema = z.object({
  perIssue: z.number(), // in USDC cents
  weekly: z.number(),
  monthly: z.number(),
  bulk250: z.number(), // 250 issues upfront
});

export type SubscriptionTier = z.infer<typeof SubscriptionTierSchema>;
export type Subscription = z.infer<typeof SubscriptionSchema>;
export type Pricing = z.infer<typeof PricingSchema>;

// Default pricing in USDC cents
export const DEFAULT_PRICING: Pricing = {
  perIssue: 10, // $0.10
  weekly: 50, // $0.50
  monthly: 80, // $0.80
  bulk250: 2500, // $25.00 for 250 issues
};

// Bulk subscription constants
export const BULK_ISSUE_COUNT = 250;
