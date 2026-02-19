#!/usr/bin/env tsx
/**
 * One-off: Build today's newsletter from the SCRAPPED thinking log (5 picks)
 * plus one editor pick (Phantom tweet) as the 6th. Saves to DATA_DIR/issues/
 * so it can be published.
 *
 * Run: pnpm exec tsx -r ./src/load-env.cjs src/cli/fix-scrapped-issue.ts
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { createHash } from "crypto";
import { createDiscovery } from "../types/discovery";
import type { Newsletter, CuratedDiscovery } from "../types";
import { toLeanNewsletter } from "../types/newsletter";
import { fetchTweetContent } from "../scrapers/twitter-api";
import { judgeBatch, isJudgeAvailable, type JudgeInput, type JudgeVerdict } from "../curation/llm-judge";

const DATA_DIR = process.env.DATA_DIR || join(process.cwd(), ".morning-stew");
const SCRAPPED_LOG = join(DATA_DIR, "thinking-logs", "SCRAPPED-2026-02-18.json");
const ISSUES_DIR = join(DATA_DIR, "issues");
const PHANTOM_TWEET_URL = "https://x.com/phantom/status/2023866789860675625";

function makeQualityScore(total: number, reasons: string[] = []): CuratedDiscovery["qualityScore"] {
  const t = Math.min(5, Math.max(0, total));
  return {
    total: t,
    novelValue: t / 5,
    realUsage: 0.8,
    installProcess: 1,
    documentation: 0.8,
    genuineUtility: t / 5,
    reasons: reasons.length ? reasons : [`Editor/recovery pick (score ${t})`],
  };
}

function discoveryFromLogEntry(
  entry: { title: string; url: string; source: string; curationScore?: number; enriched?: { oneLiner?: string; what?: string; why?: string; impact?: string; installHint?: string; valueProp?: string } },
  verdict?: JudgeVerdict | null,
): CuratedDiscovery {
  const url = entry.url;
  const isGitHub = url.includes("github.com");
  const cloneUrl = isGitHub ? url.replace(/\/blob\/.*$/, "").replace(/\/tree\/.*$/, "") : url;

  // Prefer live verdict > saved enriched > title fallback
  const title = verdict?.title || entry.title;
  const oneLiner = verdict?.oneLiner || entry.enriched?.oneLiner || entry.title;
  const what = verdict?.oneLiner || entry.enriched?.what || entry.title;
  const why = verdict?.valueProp || entry.enriched?.why || "From scrapped run — quality pick";
  const impact = verdict?.valueProp || entry.enriched?.impact || "Included from curation";
  const valueProp = verdict?.valueProp || entry.enriched?.valueProp || entry.title;
  const installHint = verdict?.installHint || entry.enriched?.installHint;
  const steps = installHint
    ? [installHint]
    : isGitHub
    ? [`git clone ${cloneUrl}`, "See repo README for setup"]
    : [`See ${url}`];

  const d = createDiscovery({
    id: `recovery-${createHash("sha256").update(url).digest("base64url").slice(0, 16)}`,
    category: isGitHub ? "tool" : "workflow",
    title,
    oneLiner,
    what,
    why,
    impact,
    install: { steps, timeEstimate: "5 min" },
    source: {
      url: entry.url,
      type: (entry.source as any) || "github",
      author: undefined,
    },
    signals: { engagement: 50 },
  });

  const score = entry.curationScore ?? 4;
  return {
    ...d,
    qualityScore: makeQualityScore(score, ["Recovered from scrapped run"]),
    valueProp,
  };
}

async function buildPhantomDiscovery(): Promise<CuratedDiscovery> {
  console.log("[fix-scrapped] Fetching Phantom tweet...");
  try {
    const tweet = await fetchTweetContent(PHANTOM_TWEET_URL);
    if (tweet.tweetText && tweet.author) {
      const title = tweet.tweetText.slice(0, 80) + (tweet.tweetText.length > 80 ? "..." : "");
      const oneLiner = tweet.tweetText.slice(0, 200);
      const bestUrl = tweet.urls.length > 0 ? tweet.urls[0] : PHANTOM_TWEET_URL;
      const isGitHub = bestUrl.includes("github.com");
      const steps = isGitHub ? [`git clone ${bestUrl}`, "See repo README"] : [`See ${bestUrl}`];

      const d = createDiscovery({
        id: "editor-phantom-2026-02-18",
        category: isGitHub ? "tool" : "integration",
        title: `@${tweet.author}: ${title}`,
        oneLiner,
        what: tweet.tweetText,
        why: "Editor pick — Phantom (Solana wallet)",
        impact: "Relevant for payments/agents",
        install: { steps, timeEstimate: "5 min" },
        source: {
          url: bestUrl,
          type: isGitHub ? "github" : "twitter",
          author: tweet.author,
        },
        signals: { engagement: 9999 },
      });

      return {
        ...d,
        qualityScore: makeQualityScore(4.2, ["Editor pick", "Phantom/Solana ecosystem"]),
        valueProp: oneLiner.slice(0, 100),
      };
    }
  } catch (err: any) {
    console.warn("[fix-scrapped] Tweet fetch failed:", err.message);
  }

  // Fallback when API fails: minimal but valid entry
  const d = createDiscovery({
    id: "editor-phantom-2026-02-18",
    category: "integration",
    title: "Phantom (Solana wallet) — editor pick",
    oneLiner: "Phantom wallet announcement or update — see tweet for details. Relevant for Solana Pay / agent payments.",
    what: "Editor pick from Phantom tweet. Phantom is the leading Solana wallet; tweet may cover Pay, x402, or agent-related updates.",
    why: "Editor pick — Phantom/Solana ecosystem",
    impact: "Relevant for payments and agent integrations",
    install: { steps: [`See ${PHANTOM_TWEET_URL}`], timeEstimate: "2 min" },
    source: { url: PHANTOM_TWEET_URL, type: "twitter", author: "phantom" },
    signals: { engagement: 9999 },
  });

  return {
    ...d,
    qualityScore: makeQualityScore(4, ["Editor pick — Phantom"]),
    valueProp: "Phantom/Solana wallet update — see tweet",
  };
}

async function main() {
  if (!existsSync(SCRAPPED_LOG)) {
    console.error("Scrapped log not found:", SCRAPPED_LOG);
    process.exit(1);
  }

  const log = JSON.parse(readFileSync(SCRAPPED_LOG, "utf-8"));
  const included = (log.candidates || []).filter((c: any) => c.decision === "included");
  if (included.length !== 5) {
    console.error(`Expected 5 included candidates, found ${included.length}`);
    process.exit(1);
  }

  // Re-enrich with LLM if available (fixes thin title-only content from scrapped log)
  let verdicts: (JudgeVerdict | null)[] = included.map(() => null);
  if (isJudgeAvailable()) {
    console.log("[fix-scrapped] Re-enriching 5 picks with LLM judge...");
    const inputs: JudgeInput[] = included.map((c: any) => ({
      content: c.enriched?.oneLiner ? `${c.title}\n\n${c.enriched.oneLiner}` : c.title,
      source: c.source || "github",
      externalUrl: c.url,
      engagement: 50,
    }));
    try {
      verdicts = await judgeBatch(inputs, 5);
      console.log(`[fix-scrapped] Got ${verdicts.filter(Boolean).length}/5 verdicts`);
    } catch (err: any) {
      console.warn("[fix-scrapped] LLM enrichment failed, falling back to log data:", err.message);
    }
  }

  const fivePicks: CuratedDiscovery[] = included.map((c: any, i: number) => discoveryFromLogEntry(c, verdicts[i]));
  const sixthPick = await buildPhantomDiscovery();
  const discoveries = [...fivePicks, sixthPick];

  const nextId = "MS-2026-048";
  const newsletter: Newsletter = {
    id: nextId,
    name: "Issue #5",
    date: "2026-02-18",
    discoveries,
    onRadar: [],
    skipped: [],
    isQuietWeek: false,
    frameworkUpdates: [],
    securityNotes: [
      "6 discovery(ies) not yet verified - review before installing",
      "Always review code before running install commands",
    ],
    tokenCount: Math.ceil(JSON.stringify(discoveries).length / 4),
  };

  if (!existsSync(ISSUES_DIR)) mkdirSync(ISSUES_DIR, { recursive: true });

  const lean = toLeanNewsletter(newsletter);
  const leanPath = join(ISSUES_DIR, `${nextId}.json`);
  const fullPath = join(ISSUES_DIR, `${nextId}.full.json`);

  writeFileSync(leanPath, JSON.stringify(lean, null, 2));
  writeFileSync(fullPath, JSON.stringify(newsletter, null, 2));

  // Also write full newsletter to output/ so "npm run publish:newsletter" picks it up
  const outputDir = join(process.cwd(), "output");
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });
  writeFileSync(join(outputDir, `${nextId}.json`), JSON.stringify(newsletter, null, 2));

  console.log("\n✅ Fixed issue saved:");
  console.log(`   ${leanPath}`);
  console.log(`   ${fullPath}`);
  console.log(`   output/${nextId}.json (for publish)`);
  console.log(`   ID: ${nextId}  |  Picks: 6  |  Date: ${newsletter.date}`);
  console.log("\nPublish with: npm run publish:newsletter");
}

main().catch(console.error);
