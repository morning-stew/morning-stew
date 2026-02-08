import { z } from "zod";

export const SubscriptionTierSchema = z.enum(["per_issue", "weekly", "monthly"]);

export const SubscriptionSchema = z.object({
  id: z.string(),
  agentId: z.string(), // subscriber's agent identifier
  tier: SubscriptionTierSchema,
  chain: z.enum(["base", "monad", "solana"]),
  currency: z.literal("USDC"),
  createdAt: z.string(),
  expiresAt: z.string().optional(), // for recurring subs
  issuesPurchased: z.array(z.string()).optional(), // for per-issue
});

export const PricingSchema = z.object({
  perIssue: z.number(), // in USDC cents
  weekly: z.number(),
  monthly: z.number(),
});

export type SubscriptionTier = z.infer<typeof SubscriptionTierSchema>;
export type Subscription = z.infer<typeof SubscriptionSchema>;
export type Pricing = z.infer<typeof PricingSchema>;

// Default pricing in USDC cents
export const DEFAULT_PRICING: Pricing = {
  perIssue: 5, // $0.05
  weekly: 25, // $0.25
  monthly: 80, // $0.80
};
