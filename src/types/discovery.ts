import { z } from "zod";

/**
 * Discovery - An actionable finding for AI agents.
 * 
 * Each discovery should give an agent everything it needs to:
 * 1. Understand what this is and why it matters
 * 2. Install or set it up (exact commands)
 * 3. Know what becomes possible after using it
 */

export const DiscoveryCategorySchema = z.enum([
  "infrastructure",  // VMs, containers, sandboxing, E2B, Firecracker
  "privacy",         // Local models, VPNs, data isolation, self-hosting
  "integration",     // Home automation, APIs, browsers, file systems
  "workflow",        // Real user stories, "I built X with my agent"
  "skill",           // High-impact OpenClaw skills with clear setup
  "tool",            // CLI tools, utilities, dev tools for agents
  "security",        // Sandboxing, permissions, safe execution
  "model",           // New models, fine-tunes, specialized agents
]);

export type DiscoveryCategory = z.infer<typeof DiscoveryCategorySchema>;

export const DiscoverySchema = z.object({
  // Core identity
  id: z.string(),                        // Unique ID for deduplication
  category: DiscoveryCategorySchema,
  
  // The pitch (for humans skimming)
  title: z.string(),                     // Short, punchy title
  oneLiner: z.string(),                  // One sentence: what + why
  
  // Actionable details (for agents)
  what: z.string(),                      // What is this thing?
  why: z.string(),                       // Why should an agent/human care?
  impact: z.string(),                    // What becomes possible after using this?
  
  // Installation (the key differentiator)
  install: z.object({
    steps: z.array(z.string()),          // Ordered steps (commands, instructions)
    requirements: z.array(z.string()).optional(), // Prerequisites
    timeEstimate: z.string().optional(), // "2 min", "10 min setup"
  }),
  
  // Metadata
  source: z.object({
    url: z.string().url(),
    type: z.enum(["twitter", "hackernews", "reddit", "github", "clawhub", "blog"]),
    author: z.string().optional(),
    date: z.string().optional(),
  }),
  
  // Engagement/relevance signals
  signals: z.object({
    engagement: z.number().optional(),   // likes, stars, upvotes
    comments: z.number().optional(),
    trending: z.boolean().optional(),
  }).optional(),
  
  // Security (from Clawdex or manual review)
  security: z.enum(["verified", "unverified", "caution"]).default("unverified"),
  
  // For minimal token version
  tokenCount: z.number().optional(),
});

export type Discovery = z.infer<typeof DiscoverySchema>;

/**
 * Helper to create a discovery with sensible defaults
 */
export function createDiscovery(
  partial: Partial<Discovery> & Pick<Discovery, "id" | "category" | "title" | "oneLiner" | "what" | "why" | "impact" | "install" | "source">
): Discovery {
  return {
    security: "unverified",
    ...partial,
  };
}

/**
 * Generate a minimal version for token-constrained agents
 */
export function toMinimalDiscovery(d: Discovery): {
  title: string;
  category: string;
  oneLiner: string;
  install: string[];
  url: string;
} {
  return {
    title: d.title,
    category: d.category,
    oneLiner: d.oneLiner,
    install: d.install.steps.slice(0, 3), // First 3 steps only
    url: d.source.url,
  };
}
