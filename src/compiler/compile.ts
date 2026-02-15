import type { Newsletter, Discovery } from "../types";
import { toLeanNewsletter } from "../types/newsletter";
import { generateId, generateName } from "./names";
import { 
  scrapeGitHubReleases, 
  scrapeDiscoveries,
  scrapeGitHubTrending,
  scrapeClawIndex,
  scrapeTwitterFeed,
  scrapeXApiSearch,
  scrapeEditorDMs,
  resetTwitterBudget,
} from "../scrapers";
import { curateDiscoveries, type CuratedDiscovery } from "../curation";
import { judgeBatch, isJudgeAvailable, type JudgeInput, type JudgeVerdict } from "../curation/llm-judge";
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";

// ── Thinking log types ──

interface ThinkingLogEntry {
  title: string;
  url?: string;
  source: string;
  phase: string;
  decision: "included" | "excluded" | "pending";
  reason?: string;
  llmVerdict?: {
    actionable: boolean;
    confidence?: number;
    skipReason?: string;
    scores?: Record<string, number>;
    failedCriteria?: string[];
  };
  curationScore?: number;
}

interface ThinkingLog {
  newsletterId: string;
  date: string;
  generatedAt: string;
  summary: {
    totalCandidates: number;
    llmJudgedCount: number;
    llmPassedCount: number;
    curatedCount: number;
    finalPicks: number;
    onRadarCount: number;
    skippedCount: number;
  };
  candidates: ThinkingLogEntry[];
}

/**
 * Hard cap: max discoveries in a newsletter.
 * Editor tips always get a slot. Remaining slots filled by best of timeline/HN/GH/search.
 */
const MAX_PICKS = 6;

/**
 * Minimum discoveries required to publish a newsletter.
 * If fewer than this pass curation, the generation is scrapped.
 */
const MIN_PICKS = 6;

export interface CompileOptions {
  date?: Date;
  skipDiscoveries?: boolean;
  skipGitHubTrending?: boolean;
  skipGitHubReleases?: boolean;
  skipClawIndex?: boolean;     // Skip ClawIndex directory scrape (default: true — off for now)
  skipTwitter?: boolean;       // Skip all Twitter (timeline + search)
  skipEditorDMs?: boolean;     // Skip checking editor tips
  skipCuration?: boolean;      // Skip quality filtering (for testing)
  maxPicks?: number;           // Override MAX_PICKS (default: 6)
  overrideId?: string;         // Force a specific newsletter ID (e.g. "MS-#0" for seed)
  skipMinimumCheck?: boolean;  // Skip the minimum picks enforcement (seed/backfill use only)
}

/**
 * Compile all sources into a single newsletter issue.
 * 
 * PIPELINE (order matters for cost control):
 * 1. Editor tips (free, highest signal) — always included
 * 2. Home timeline (Following feed) — PRIMARY Twitter source, you curate who to follow
 * 3. HackerNews + GitHub (free) — bulk discovery, parallel
 * 4. LLM judge everything against 5-point checklist
 * 5. If still short on picks, run keyword search queries (BACKUP)
 * 6. Quality curation — final ranking, hard cap at 6
 */
export async function compileNewsletter(
  options: CompileOptions = {}
): Promise<Newsletter> {
  const date = options.date || new Date();
  const dateStr = date.toISOString().split("T")[0];
  const maxPicks = options.maxPicks || MAX_PICKS;

  console.log(`[compile] Generating newsletter for ${dateStr} (max ${maxPicks} picks)`);

  // Initialize thinking log
  const thinkingLog: ThinkingLog = {
    newsletterId: "",  // filled in at the end
    date: dateStr,
    generatedAt: new Date().toISOString(),
    summary: { totalCandidates: 0, llmJudgedCount: 0, llmPassedCount: 0, curatedCount: 0, finalPicks: 0, onRadarCount: 0, skippedCount: 0 },
    candidates: [],
  };

  // Reset Twitter API spend tracker — $0.75 hard cap per generation
  resetTwitterBudget(0.75);

  // ── PHASE 1: Editor tips (free, instant) ──

  const editorPicks = options.skipEditorDMs ? [] : await scrapeEditorDMs();
  console.log(`[compile] Editor tips: ${editorPicks.length}`);

  // ── PHASE 2: Twitter — alternating Following feed + keyword search ──
  // Reads ~15 tweets from Following, then ~15 from keyword search, repeat.
  // Keeps going until target discoveries met, budget hit, or sources exhausted.
  // The LLM judge is never forced to accept — if it's strict, we just keep alternating.

  let twitterDiscoveries: Discovery[] = [];
  if (!options.skipTwitter) {
    const slotsNeeded = Math.max(1, maxPicks - editorPicks.length);
    console.log(`[compile] Twitter: need ~${slotsNeeded} discoveries (${editorPicks.length} editor picks already)`);
    twitterDiscoveries = await scrapeTwitterFeed({
      targetDiscoveries: slotsNeeded,
      batchSize: 15,        // alternate source every 15 tweets
      maxBatches: 10,       // hard cap: 10 batches = 150 tweets max
      sinceHours: 48,
    });
    console.log(`[compile] Twitter: ${twitterDiscoveries.length} discoveries from alternating feed`);
  }

  // ── PHASE 3: Free sources (HN + GitHub + ClawIndex) in parallel ──

  const [hnDiscoveries, ghDiscoveries, frameworkUpdates, clawIndexDiscoveries] = await Promise.all([
    options.skipDiscoveries ? [] : scrapeDiscoveries({ maxPerCategory: 3, minPoints: 20, hoursAgo: 48 }),
    options.skipGitHubTrending ? [] : scrapeGitHubTrending({ maxResults: 15, minStars: 30, sinceDays: 7 }),
    options.skipGitHubReleases ? [] : scrapeGitHubReleases({ since: new Date(Date.now() - 48 * 60 * 60 * 1000) }),
    (options.skipClawIndex !== false) ? [] : scrapeClawIndex({ maxProjects: 15 }),
  ]);

  console.log(`[compile] Free sources: HN=${hnDiscoveries.length}, GH=${ghDiscoveries.length}, ClawIndex=${clawIndexDiscoveries.length}`);

  // ── PHASE 4: LLM-enrich editor tips ──

  let enrichedEditorPicks = editorPicks;
  if (isJudgeAvailable() && editorPicks.length > 0) {
    console.log(`[compile] Enriching ${editorPicks.length} editor tips with LLM...`);
    const editorInputs: JudgeInput[] = editorPicks.map((d) => ({
      content: `${d.title}\n\n${d.what}\n\nURL: ${d.source.url}`,
      source: d.source.type,
      author: d.source.author,
      externalUrl: d.source.url,
      engagement: 9999,
    }));

    const editorVerdicts = await judgeBatch(editorInputs, 3);
    enrichedEditorPicks = editorPicks.map((d, i) => {
      const v = editorVerdicts[i];
      if (v && v.actionable) {
        return {
          ...d,
          title: v.title || d.title,
          oneLiner: v.oneLiner || d.oneLiner,
          what: v.oneLiner || d.what,
          why: v.valueProp || d.why,
          impact: v.valueProp || d.impact,
          install: v.installHint
            ? { ...d.install, steps: [v.installHint] }
            : d.install,
        };
      }
      return d; // Editor tips always stay regardless
    });
  }

  // ── PHASE 5: LLM judge on HN + GitHub ──
  // Editor picks are pre-enriched. Timeline discoveries are pre-judged in the scraper.
  // Only HN and GitHub need judging here.

  const allRaw = dedupeDiscoveries([
    ...enrichedEditorPicks,
    ...twitterDiscoveries,
    ...clawIndexDiscoveries,
    ...hnDiscoveries,
    ...ghDiscoveries,
  ]);

  const isPreJudged = (d: Discovery) =>
    d.id.startsWith("editor-") || d.id.startsWith("x-api-") || d.id.startsWith("clawindex-");
  const preJudged = allRaw.filter(isPreJudged);
  const needsJudging = allRaw.filter((d) => !isPreJudged(d));

  let judgedAll = allRaw;
  if (isJudgeAvailable() && !options.skipCuration && needsJudging.length > 0) {
    console.log(`[compile] LLM judging ${needsJudging.length} HN/GitHub discoveries (${preJudged.length} pre-judged)...`);

    const inputs: JudgeInput[] = needsJudging.map((d) => ({
      content: `${d.title}\n\n${d.what}`,
      source: d.source.type,
      author: d.source.author,
      externalUrl: d.source.url,
      engagement: d.signals?.engagement,
    }));

    const verdicts = await judgeBatch(inputs, 5);
    const passed: Discovery[] = [];

    thinkingLog.summary.llmJudgedCount += needsJudging.length;

    for (let i = 0; i < needsJudging.length; i++) {
      const d = needsJudging[i];
      const v = verdicts[i];
      if (v && v.actionable && v.confidence >= 0.5) {
        const s = v.scores;
        const allPass = s && s.utility >= 0.5 && s.downloadability >= 0.5 && s.specificity >= 0.5 && s.signal >= 0.5 && s.novelty >= 0.5;
        if (allPass || !s) {
          passed.push({
            ...d,
            title: v.title || d.title,
            oneLiner: v.oneLiner || d.oneLiner,
            what: v.oneLiner || d.what,
            why: v.valueProp || d.why,
            impact: v.valueProp || d.impact,
          });
          thinkingLog.candidates.push({ title: v.title || d.title, url: d.source.url, source: d.source.type, phase: "llm-judge", decision: "pending", llmVerdict: { actionable: true, confidence: v.confidence, scores: s as any } });
        } else {
          const failedKeys = Object.entries(s!).filter(([, score]) => score < 0.5).map(([k]) => k);
          const failedCriteria = failedKeys.join(", ");
          console.log(`[compile]   SKIP (score fail): "${d.title.slice(0, 50)}..." → failed: ${failedCriteria}`);
          thinkingLog.candidates.push({ title: d.title, url: d.source.url, source: d.source.type, phase: "llm-judge", decision: "excluded", reason: `Failed LLM criteria: ${failedCriteria}`, llmVerdict: { actionable: true, confidence: v.confidence, scores: s as any, failedCriteria: failedKeys } });
        }
      } else if (v && !v.actionable) {
        console.log(`[compile]   SKIP: "${d.title.slice(0, 50)}..." → ${v.skipReason || "Not actionable"}`);
        thinkingLog.candidates.push({ title: d.title, url: d.source.url, source: d.source.type, phase: "llm-judge", decision: "excluded", reason: v.skipReason || "Not actionable", llmVerdict: { actionable: false, confidence: v.confidence, skipReason: v.skipReason } });
      } else {
        passed.push(d);
        thinkingLog.candidates.push({ title: d.title, url: d.source.url, source: d.source.type, phase: "llm-judge", decision: "pending", reason: "No verdict — passed through" });
      }
    }

    thinkingLog.summary.llmPassedCount += passed.length;
    console.log(`[compile] LLM judge: ${passed.length}/${needsJudging.length} passed`);
    judgedAll = [...preJudged, ...passed];
  }

  // ── PHASE 6: Need more? Extra keyword search (LAST RESORT) ──
  // The alternating loop already tried both Following + search.
  // This only fires if we still need picks AND have budget left.

  if (!options.skipTwitter && judgedAll.length < maxPicks) {
    const deficit = maxPicks - judgedAll.length;
    const extraQueries = Math.min(4, Math.ceil(deficit / 2));

    console.log(`[compile] Still only ${judgedAll.length}/${maxPicks} picks — trying ${extraQueries} more keyword queries as last resort...`);

    const extraDiscoveries = await scrapeXApiSearch({
      maxResultsPerQuery: 15,
      sinceHours: 48,
      queries: getTopQueries(extraQueries),
    });

    if (extraDiscoveries.length > 0) {
      judgedAll = dedupeDiscoveries([...judgedAll, ...extraDiscoveries]);
      console.log(`[compile] After extra search: ${judgedAll.length} total candidates`);
    } else {
      console.log(`[compile] No new discoveries from extra search`);
    }
  }

  // ── PHASE 7: Quality curation + final assembly ──

  const allDiscoveries = judgedAll;

  console.log(`[compile] Total candidates for curation: ${allDiscoveries.length}`);

  let picks: CuratedDiscovery[] = [];
  let onRadar: { title: string; url: string; reason: string }[] = [];
  let skipped: { title: string; url?: string; reason: string }[] = [];
  let isQuietWeek = false;

  if (options.skipCuration) {
    console.log(`[compile] Skipping curation (test mode)`);
    picks = allDiscoveries.slice(0, maxPicks).map(d => ({
      ...d,
      qualityScore: { total: 0, novelValue: 0, realUsage: 0, installProcess: 0, documentation: 0, genuineUtility: 0, reasons: [] },
      valueProp: d.oneLiner,
    }));
  } else {
    const curation = await curateDiscoveries(allDiscoveries, { 
      minScore: 3, 
      maxPicks,
    });

    picks = curation.picks;
    isQuietWeek = curation.isQuietWeek;

    onRadar = curation.onRadar.map(d => ({
      title: d.title,
      url: d.source.url,
      reason: d.skipReason || "Needs more traction",
    }));

    skipped = curation.skipped.map(d => ({
      title: d.title,
      url: d.source.url,
      reason: d.skipReason || "Did not meet quality threshold",
    }));

    // Log curation decisions
    for (const d of curation.picks) {
      const existing = thinkingLog.candidates.find(c => c.url === d.source.url);
      if (existing) { existing.decision = "included"; existing.phase = "curation"; existing.curationScore = d.qualityScore.total; }
      else thinkingLog.candidates.push({ title: d.title, url: d.source.url, source: d.source.type, phase: "curation", decision: "included", curationScore: d.qualityScore.total });
    }
    for (const d of curation.onRadar) {
      const existing = thinkingLog.candidates.find(c => c.url === d.source.url);
      if (existing) { existing.decision = "excluded"; existing.reason = d.skipReason || "On radar — needs more traction"; existing.curationScore = d.qualityScore.total; }
      else thinkingLog.candidates.push({ title: d.title, url: d.source.url, source: d.source.type, phase: "curation", decision: "excluded", reason: d.skipReason || "On radar — needs more traction", curationScore: d.qualityScore.total });
    }
    for (const d of curation.skipped) {
      const existing = thinkingLog.candidates.find(c => c.url === d.source.url);
      if (existing) { existing.decision = "excluded"; existing.reason = d.skipReason || "Below quality threshold"; existing.curationScore = d.qualityScore.total; }
      else thinkingLog.candidates.push({ title: d.title, url: d.source.url, source: d.source.type, phase: "curation", decision: "excluded", reason: d.skipReason || "Below quality threshold", curationScore: d.qualityScore.total });
    }
  }

  // Ensure editor picks are always included (they outrank everything)
  const editorIds = new Set(enrichedEditorPicks.map((d) => d.id));
  const editorInPicks = picks.filter((p) => editorIds.has(p.id));
  const nonEditorPicks = picks.filter((p) => !editorIds.has(p.id));

  const missingEditors = enrichedEditorPicks.filter(
    (d) => !picks.some((p) => p.id === d.id)
  );
  if (missingEditors.length > 0) {
    console.log(`[compile] Forcing ${missingEditors.length} editor picks back into newsletter`);
    const forcedPicks: CuratedDiscovery[] = missingEditors.map((d) => ({
      ...d,
      qualityScore: { total: 5, novelValue: 5, realUsage: 5, installProcess: 3, documentation: 3, genuineUtility: 5, reasons: ["Editor pick"] },
      valueProp: d.oneLiner,
    }));
    picks = [...forcedPicks, ...editorInPicks, ...nonEditorPicks].slice(0, maxPicks);
  }

  // Enforce minimum picks — scrap the newsletter if quality bar isn't met
  if (!options.skipCuration && !options.skipMinimumCheck && picks.length < MIN_PICKS) {
    throw new Error(
      `[compile] Insufficient quality content: only ${picks.length}/${MIN_PICKS} picks found. Newsletter scrapped.`
    );
  }

  const securityNotes = generateSecuritySummary(picks);

  const newsletter: Newsletter = {
    id: options.overrideId || generateId(date),
    name: options.overrideId ? `Issue #${options.overrideId.replace("MS-#", "")}` : generateName(date),
    date: dateStr,
    discoveries: picks,
    onRadar: onRadar.length > 0 ? onRadar : undefined,
    skipped: skipped.length > 0 ? skipped : undefined,
    isQuietWeek,
    frameworkUpdates,
    securityNotes,
    tokenCount: 0,
  };

  newsletter.tokenCount = Math.ceil(JSON.stringify(newsletter).length / 4);

  // Generate the lean (agent-consumable) version
  const lean = toLeanNewsletter(newsletter);
  (newsletter as any)._lean = lean;

  console.log(`[compile] Generated "${newsletter.name}" (${newsletter.id})`);
  console.log(`[compile] Stats: ${picks.length} picks, ${onRadar.length} on radar, ${skipped.length} skipped`);
  if (isQuietWeek) {
    console.log(`[compile] QUIET WEEK - fewer than 3 quality discoveries`);
  }
  console.log(`[compile] Categories: ${summarizeCategories(picks)}`);
  const leanTokens = Math.ceil(JSON.stringify(lean).length / 4);
  console.log(`[compile] Lean output: ~${leanTokens} tokens (vs ${newsletter.tokenCount} full)`);

  // Finalize and save thinking log
  thinkingLog.newsletterId = newsletter.id;
  thinkingLog.summary.totalCandidates = thinkingLog.candidates.length;
  thinkingLog.summary.finalPicks = picks.length;
  thinkingLog.summary.onRadarCount = onRadar.length;
  thinkingLog.summary.skippedCount = skipped.length;
  thinkingLog.summary.curatedCount = picks.length + onRadar.length + skipped.length;
  saveThinkingLog(thinkingLog);

  return newsletter;
}

// ── Thinking log persistence ──

function saveThinkingLog(log: ThinkingLog): void {
  try {
    const dataDir = process.env.DATA_DIR || join(process.cwd(), ".morning-stew");
    const logsDir = join(dataDir, "thinking-logs");
    if (!existsSync(logsDir)) mkdirSync(logsDir, { recursive: true });
    const safeId = log.newsletterId.replace(/[^a-zA-Z0-9#-]/g, "_");
    const filePath = join(logsDir, `${safeId}.json`);
    writeFileSync(filePath, JSON.stringify(log, null, 2));
    console.log(`[compile] Thinking log saved: ${filePath}`);
  } catch (err) {
    console.error(`[compile] Failed to save thinking log:`, err);
  }
}

// ── Search queries ranked by value ──

import { SEARCH_QUERIES } from "../scrapers/twitter-api";

function getTopQueries(count: number): string[] {
  return SEARCH_QUERIES.slice(0, count);
}

// ── Helpers ──

function loadHistoricalKeys(lookbackCount = 10): Set<string> {
  const keys = new Set<string>();
  const dataDir = process.env.DATA_DIR || join(process.cwd(), ".morning-stew");
  const issuesDir = join(dataDir, "issues");

  if (!existsSync(issuesDir)) return keys;

  try {
    const files = readdirSync(issuesDir)
      .filter((f) => f.endsWith(".json"))
      .sort()
      .slice(-lookbackCount);

    for (const file of files) {
      try {
        const data = JSON.parse(readFileSync(join(issuesDir, file), "utf-8"));
        const discoveries: any[] = data.discoveries || [];
        for (const d of discoveries) {
          if (d.source?.url) keys.add(d.source.url);
          if (d.title) {
            keys.add(d.title.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 30));
          }
        }
      } catch {
        // Skip corrupt files
      }
    }

    if (keys.size > 0) {
      console.log(`[compile] Loaded ${keys.size} historical keys from ${files.length} past issues`);
    }
  } catch {}

  return keys;
}

function dedupeDiscoveries(discoveries: Discovery[]): Discovery[] {
  const seen = loadHistoricalKeys();

  return discoveries.filter((d) => {
    const key = d.source.url;
    if (seen.has(key)) return false;
    seen.add(key);

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

  if (verified > 0) notes.push(`${verified} discovery(ies) from verified sources`);
  if (unverified > 0) notes.push(`${unverified} discovery(ies) not yet verified - review before installing`);
  if (caution > 0) notes.push(`${caution} discovery(ies) flagged for caution`);
  notes.push("Always review code before running install commands");
  
  return notes;
}

export function validateNewsletter(newsletter: Newsletter): boolean {
  if (!newsletter.id || !newsletter.name || !newsletter.date) return false;
  return true;
}
