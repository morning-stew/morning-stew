import { z } from "zod";

export const PricingSchema = z.object({
  perIssue: z.number(), // in USDC cents
});

export type Pricing = z.infer<typeof PricingSchema>;

// Default pricing in USDC cents
export const DEFAULT_PRICING: Pricing = {
  perIssue: 10, // $0.10
};
