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

// Curated discovery with quality score and value prop
export const CuratedDiscoverySchema = DiscoverySchema.extend({
  qualityScore: z.object({
    total: z.number(),
    novelValue: z.number(),
    realUsage: z.number(),
    installProcess: z.number(),
    documentation: z.number(),
    genuineUtility: z.number(),
    reasons: z.array(z.string()),
  }),
  valueProp: z.string(),
  skipReason: z.string().optional(),
});

// "On Radar" item - promising but not ready
export const OnRadarItemSchema = z.object({
  title: z.string(),
  url: z.string().url(),
  reason: z.string(),  // Why we're watching
});

// "Skipped" item - didn't make the cut
export const SkippedItemSchema = z.object({
  title: z.string(),
  url: z.string().url().optional(),
  reason: z.string(),  // Why it was skipped
});

// New newsletter structure centered on Discoveries
export const NewsletterSchema = z.object({
  id: z.string(),                              // e.g., "MS-2026-038"
  name: z.string(),                            // e.g., "Lobster's Gambit"
  date: z.string(),                            // ISO date
  
  // Primary content: curated discoveries (quality score >= 3)
  discoveries: z.array(CuratedDiscoverySchema),
  
  // On our radar - promising but not ready (quality score 2-3)
  onRadar: z.array(OnRadarItemSchema).optional(),
  
  // Didn't make the cut - transparency section
  skipped: z.array(SkippedItemSchema).optional(),
  
  // Is this a quiet week? (< 3 quality picks)
  isQuietWeek: z.boolean().optional(),
  
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
export type CuratedDiscovery = z.infer<typeof CuratedDiscoverySchema>;
export type OnRadarItem = z.infer<typeof OnRadarItemSchema>;
export type SkippedItem = z.infer<typeof SkippedItemSchema>;

// Re-export discovery types
export { DiscoverySchema, type Discovery, type DiscoveryCategory } from "./discovery";
import { toLeanDiscovery } from "./discovery";

/**
 * Lean newsletter format — what consuming agents actually receive.
 * No essays, no noise, just actionable commands and scores.
 */
export function toLeanNewsletter(n: Newsletter) {
  const lean: Record<string, any> = {
    id: n.id,
    name: n.name,
    date: n.date,
    discoveries: n.discoveries.map(toLeanDiscovery),
  };

  // Only include frameworkUpdates if non-empty and has breaking changes
  if (n.frameworkUpdates?.length > 0) {
    lean.frameworkUpdates = n.frameworkUpdates.map((u) => ({
      title: u.title,
      url: u.url,
      breaking: u.breaking,
      summary: u.summary,
    }));
  }

  // Only include securityNotes if there's something worth flagging
  const importantNotes = n.securityNotes?.filter(
    (s) => !s.includes("Always review") // skip generic advice
  );
  if (importantNotes?.length > 0) {
    lean.securityNotes = importantNotes;
  }

  return lean;
}
