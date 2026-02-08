import { z } from "zod";
import { DiscoverySchema } from "./discovery";

// Legacy types (keeping for backward compatibility during migration)
export const SkillSchema = z.object({
  name: z.string(),
  description: z.string(),
  author: z.string(),
  url: z.string().url(),
  stars: z.number().optional(),
  added: z.string(),
  securityStatus: z.enum(["pending", "benign", "malicious", "unknown"]).default("pending"),
});

export const FrameworkUpdateSchema = z.object({
  type: z.enum(["release", "commit", "pr"]),
  title: z.string(),
  url: z.string().url(),
  summary: z.string(),
  breaking: z.boolean().default(false),
});

export const TwitterBuzzSchema = z.object({
  author: z.string(),
  handle: z.string(),
  content: z.string(),
  url: z.string().url(),
  engagement: z.number(),
});

// New newsletter structure centered on Discoveries
export const NewsletterSchema = z.object({
  id: z.string(),                              // e.g., "MS-2026-038"
  name: z.string(),                            // e.g., "Lobster's Gambit"
  date: z.string(),                            // ISO date
  
  // Primary content: actionable discoveries
  discoveries: z.array(DiscoverySchema),
  
  // Framework updates (releases, breaking changes)
  frameworkUpdates: z.array(FrameworkUpdateSchema),
  
  // Security summary
  securityNotes: z.array(z.string()),
  
  // Stats
  tokenCount: z.number(),
  
  // Legacy fields (for backward compat, will phase out)
  skills: z.array(SkillSchema).optional(),
  twitterBuzz: z.array(TwitterBuzzSchema).optional(),
});

export type Skill = z.infer<typeof SkillSchema>;
export type FrameworkUpdate = z.infer<typeof FrameworkUpdateSchema>;
export type TwitterBuzz = z.infer<typeof TwitterBuzzSchema>;
export type Newsletter = z.infer<typeof NewsletterSchema>;

// Re-export discovery types
export { DiscoverySchema, type Discovery, type DiscoveryCategory } from "./discovery";
