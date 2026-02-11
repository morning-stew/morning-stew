import type { Newsletter, Discovery } from "../types";
import { generateId, generateName } from "./names";
import { 
  scrapeGitHubReleases, 
  scrapeDiscoveries,
  scrapeGitHubTrending,
  scrapeTwitterFeed,
  scrapeEditorDMs,
} from "../scrapers";
import { curateDiscoveries, type CuratedDiscovery } from "../curation";

export interface CompileOptions {
  date?: Date;
  skipDiscoveries?: boolean;
  skipGitHubTrending?: boolean;
  skipGitHubReleases?: boolean;
  skipTwitterFeed?: boolean;
  skipEditorDMs?: boolean;   // Skip checking @aboozle DMs
  skipCuration?: boolean;    // Skip quality filtering (for testing)
  headless?: boolean;
}

/**
 * Compile all sources into a single newsletter issue.
 * 
 * QUALITY-FIRST APPROACH:
 * 1. Gather candidates from multiple sources
 * 2. Run through quality rubric (5-point scale)
 * 3. Only include discoveries scoring 3+ 
 * 4. Generate "On Our Radar" for promising but not-ready items
 * 5. Include "Didn't Make the Cut" for transparency
 * 
 * Sources:
 * - HackerNews - Actionable discoveries with install steps
 * - GitHub Trending - New agent-related repositories
 * - GitHub Releases - OpenClaw framework updates
 * - Twitter Feed - Curated accounts for agent tooling
 */
export async function compileNewsletter(
  options: CompileOptions = {}
): Promise<Newsletter> {
  const date = options.date || new Date();
  const dateStr = date.toISOString().split("T")[0];

  console.log(`[compile] Generating newsletter for ${dateStr}`);
  console.log(`[compile] Quality-first curation enabled`);

  // Scrape all sources in parallel
  const [hnDiscoveries, ghDiscoveries, twitterDiscoveries, editorPicks, frameworkUpdates] = await Promise.all([
    options.skipDiscoveries 
      ? [] 
      : scrapeDiscoveries({ maxPerCategory: 3, minPoints: 20, hoursAgo: 48 }),
    options.skipGitHubTrending 
      ? [] 
      : scrapeGitHubTrending({ maxResults: 10, minStars: 50, sinceDays: 7 }),
    options.skipTwitterFeed
      ? []
      : scrapeTwitterFeed({ maxPerAccount: 5, hoursAgo: 48, minRelevanceScore: 25, headless: options.headless ?? true }),
    options.skipEditorDMs
      ? []
      : scrapeEditorDMs({ headless: options.headless ?? true }),
    options.skipGitHubReleases 
      ? [] 
      : scrapeGitHubReleases({ since: new Date(Date.now() - 48 * 60 * 60 * 1000) }),
  ]);

  console.log(`[compile] Raw candidates: HN=${hnDiscoveries.length}, GH=${ghDiscoveries.length}, Twitter=${twitterDiscoveries.length}, Editor=${editorPicks.length}`);

  // Combine and dedupe discoveries
  // Editor picks go first (highest priority), then other sources
  const allDiscoveries = dedupeDiscoveries([...editorPicks, ...hnDiscoveries, ...ghDiscoveries, ...twitterDiscoveries]);
  console.log(`[compile] After dedupe: ${allDiscoveries.length} unique discoveries`);

  // Run through quality curation
  let picks: CuratedDiscovery[] = [];
  let onRadar: { title: string; url: string; reason: string }[] = [];
  let skipped: { title: string; url?: string; reason: string }[] = [];
  let isQuietWeek = false;

  if (options.skipCuration) {
    // Skip curation - just use raw discoveries (for testing)
    console.log(`[compile] Skipping curation (test mode)`);
    picks = allDiscoveries.map(d => ({
      ...d,
      qualityScore: { total: 0, novelValue: 0, realUsage: 0, installProcess: 0, documentation: 0, genuineUtility: 0, reasons: [] },
      valueProp: d.oneLiner,
    }));
  } else {
    // Full curation with quality rubric
    const curation = await curateDiscoveries(allDiscoveries, { 
      minScore: 3, 
      maxPicks: 10 
    });

    picks = curation.picks;
    isQuietWeek = curation.isQuietWeek;

    // Convert onRadar to newsletter format
    onRadar = curation.onRadar.map(d => ({
      title: d.title,
      url: d.source.url,
      reason: d.skipReason || "Needs more traction",
    }));

    // Convert skipped to newsletter format
    skipped = curation.skipped.map(d => ({
      title: d.title,
      url: d.source.url,
      reason: d.skipReason || "Did not meet quality threshold",
    }));
  }

  // Generate security notes
  const securityNotes = generateSecuritySummary(picks);

  const newsletter: Newsletter = {
    id: generateId(date),
    name: generateName(date),
    date: dateStr,
    discoveries: picks,
    onRadar: onRadar.length > 0 ? onRadar : undefined,
    skipped: skipped.length > 0 ? skipped : undefined,
    isQuietWeek,
    frameworkUpdates,
    securityNotes,
    tokenCount: 0,
  };

  // Estimate token count (rough: 4 chars per token)
  newsletter.tokenCount = Math.ceil(JSON.stringify(newsletter).length / 4);

  console.log(`[compile] Generated "${newsletter.name}" (${newsletter.id})`);
  console.log(`[compile] Stats: ${picks.length} picks, ${onRadar.length} on radar, ${skipped.length} skipped`);
  if (isQuietWeek) {
    console.log(`[compile] ⚠️ QUIET WEEK - fewer than 3 quality discoveries`);
  }
  console.log(`[compile] Categories: ${summarizeCategories(picks)}`);
  console.log(`[compile] Estimated tokens: ${newsletter.tokenCount}`);

  return newsletter;
}

function dedupeDiscoveries(discoveries: Discovery[]): Discovery[] {
  const seen = new Set<string>();
  return discoveries.filter((d) => {
    // Dedupe by source URL
    const key = d.source.url;
    if (seen.has(key)) return false;
    seen.add(key);
    
    // Also dedupe by similar titles
    const titleKey = d.title.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 30);
    if (seen.has(titleKey)) return false;
    seen.add(titleKey);
    
    return true;
  });
}

function summarizeCategories(discoveries: CuratedDiscovery[]): string {
  const counts: Record<string, number> = {};
  for (const d of discoveries) {
    counts[d.category] = (counts[d.category] || 0) + 1;
  }
  return Object.entries(counts)
    .map(([cat, count]) => `${cat}:${count}`)
    .join(", ");
}

function generateSecuritySummary(discoveries: CuratedDiscovery[]): string[] {
  const notes: string[] = [];
  
  const verified = discoveries.filter((d) => d.security === "verified").length;
  const unverified = discoveries.filter((d) => d.security === "unverified").length;
  const caution = discoveries.filter((d) => d.security === "caution").length;

  if (verified > 0) {
    notes.push(`✅ ${verified} discovery(ies) from verified sources`);
  }
  if (unverified > 0) {
    notes.push(`⚠️ ${unverified} discovery(ies) not yet verified - review before installing`);
  }
  if (caution > 0) {
    notes.push(`🚨 ${caution} discovery(ies) flagged for caution`);
  }
  
  notes.push("💡 Always review code before running install commands");
  
  return notes;
}

/**
 * Validate newsletter structure.
 */
export function validateNewsletter(newsletter: Newsletter): boolean {
  // Basic validation
  if (!newsletter.id || !newsletter.name || !newsletter.date) {
    return false;
  }
  return true;
}
