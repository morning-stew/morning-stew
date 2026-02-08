import type { Newsletter, Discovery } from "../types";
import { generateId, generateName } from "./names";
import { 
  scrapeGitHubReleases, 
  scrapeDiscoveries,
  scrapeGitHubTrending,
  scrapeTwitterFeed,
} from "../scrapers";

export interface CompileOptions {
  date?: Date;
  skipDiscoveries?: boolean;
  skipGitHubTrending?: boolean;
  skipGitHubReleases?: boolean;
  skipTwitterFeed?: boolean;
  headless?: boolean;
}

/**
 * Compile all sources into a single newsletter issue.
 * 
 * NEW APPROACH: Focus on actionable Discoveries, not just skill listings.
 * 
 * Sources:
 * 1. HackerNews - Actionable discoveries with install steps
 * 2. GitHub Trending - New agent-related repositories
 * 3. GitHub Releases - OpenClaw framework updates
 * 
 * Each discovery includes:
 * - what: What is this thing?
 * - why: Why should an agent/human care?
 * - install: Exact steps to get started
 * - impact: What becomes possible after using this?
 */
export async function compileNewsletter(
  options: CompileOptions = {}
): Promise<Newsletter> {
  const date = options.date || new Date();
  const dateStr = date.toISOString().split("T")[0];

  console.log(`[compile] Generating newsletter for ${dateStr}`);

  // Scrape all sources in parallel
  const [hnDiscoveries, ghDiscoveries, frameworkUpdates] = await Promise.all([
    options.skipDiscoveries 
      ? [] 
      : scrapeDiscoveries({ maxPerCategory: 2, minPoints: 15, hoursAgo: 48 }),
    options.skipGitHubTrending 
      ? [] 
      : scrapeGitHubTrending({ maxResults: 5, minStars: 100, sinceDays: 7 }),
    options.skipGitHubReleases 
      ? [] 
      : scrapeGitHubReleases({ since: new Date(Date.now() - 24 * 60 * 60 * 1000) }),
  ]);

  // Combine and dedupe discoveries
  const allDiscoveries = dedupeDiscoveries([...hnDiscoveries, ...ghDiscoveries]);
  
  // Sort by engagement/quality signals
  const sortedDiscoveries = allDiscoveries
    .sort((a, b) => {
      const aScore = (a.signals?.engagement || 0) + (a.signals?.trending ? 100 : 0);
      const bScore = (b.signals?.engagement || 0) + (b.signals?.trending ? 100 : 0);
      return bScore - aScore;
    })
    .slice(0, 15); // Top 15 discoveries

  // Generate security notes
  const securityNotes = generateSecuritySummary(sortedDiscoveries);

  const newsletter: Newsletter = {
    id: generateId(date),
    name: generateName(date),
    date: dateStr,
    discoveries: sortedDiscoveries,
    frameworkUpdates,
    securityNotes,
    tokenCount: 0,
  };

  // Estimate token count (rough: 4 chars per token)
  newsletter.tokenCount = Math.ceil(JSON.stringify(newsletter).length / 4);

  console.log(`[compile] Generated "${newsletter.name}" (${newsletter.id})`);
  console.log(`[compile] Stats: ${sortedDiscoveries.length} discoveries, ${frameworkUpdates.length} updates`);
  console.log(`[compile] Categories: ${summarizeCategories(sortedDiscoveries)}`);
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
    return true;
  });
}

function summarizeCategories(discoveries: Discovery[]): string {
  const counts: Record<string, number> = {};
  for (const d of discoveries) {
    counts[d.category] = (counts[d.category] || 0) + 1;
  }
  return Object.entries(counts)
    .map(([cat, count]) => `${cat}:${count}`)
    .join(", ");
}

function generateSecuritySummary(discoveries: Discovery[]): string[] {
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
