import { z } from "zod";

/**
 * Discovery - An actionable finding for AI agents.
 * 
 * Designed for machine consumption. No essays, just:
 * 1. What is it (oneLiner)
 * 2. What it adds to my capabilities (valueProp)
 * 3. How to install it (install.steps — runnable commands)
 * 4. Should I bother (score + stars)
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
  id: z.string(),
  category: DiscoveryCategorySchema,
  
  // The pitch — one line each, no redundancy
  title: z.string(),                     // Short, punchy title
  oneLiner: z.string(),                  // One sentence: what it does
  
  // Legacy fields — still populated internally but stripped from output
  what: z.string(),
  why: z.string(),
  impact: z.string(),
  
  // Installation (the key differentiator)
  install: z.object({
    steps: z.array(z.string()),          // Ordered steps (runnable commands)
    requirements: z.array(z.string()).optional(),
    timeEstimate: z.string().optional(),
  }),
  
  // Source
  source: z.object({
    url: z.string().url(),
    type: z.enum(["twitter", "hackernews", "reddit", "github", "clawhub", "web", "blog"]),
    author: z.string().optional(),
    date: z.string().optional(),
  }),
  
  // Engagement signals
  signals: z.object({
    engagement: z.number().optional(),   // likes, stars, upvotes
    comments: z.number().optional(),
    trending: z.boolean().optional(),
  }).optional(),
  
  // Security
  security: z.enum(["verified", "unverified", "caution"]).default("unverified"),
  
  // Tags for filtering (e.g., ["openclaw", "solana", "multi-agent"])
  tags: z.array(z.string()).optional(),
  
  // Breaking changes flag
  breaking: z.boolean().optional(),

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
 * Lean output format — what consuming agents actually get.
 * Strips redundant fields, flattens structure.
 */
export function toLeanDiscovery(d: Discovery & { qualityScore?: any; valueProp?: string }) {
  const lean: Record<string, any> = {
    title: d.title,
    oneLiner: d.oneLiner,
    valueProp: (d as any).valueProp || d.oneLiner,
    install: d.install.steps.length === 1 ? d.install.steps[0] : d.install.steps,
    category: d.category,
    tags: d.tags || [],
    score: d.qualityScore?.total ?? 0,
    stars: d.signals?.engagement ?? 0,
    url: d.source.url,
  };

  // Only include breaking if true
  if (d.breaking) {
    lean.breaking = true;
  }

  return lean;
}
