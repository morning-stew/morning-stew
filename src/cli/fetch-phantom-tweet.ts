#!/usr/bin/env tsx
/**
 * Fetch the Phantom tweet via X API and update the 6th discovery in MS-2026-048.
 * Run: pnpm exec tsx -r ./src/load-env.cjs src/cli/fetch-phantom-tweet.ts
 */

import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { fetchTweetContent } from "../scrapers/twitter-api";
import { createDiscovery } from "../types/discovery";
import type { CuratedDiscovery, Newsletter } from "../types";
import { toLeanNewsletter } from "../types/newsletter";

const DATA_DIR = process.env.DATA_DIR || join(process.cwd(), ".morning-stew");
const ISSUES_DIR = join(DATA_DIR, "issues");
const ISSUE_ID = "MS-2026-048";
const PHANTOM_TWEET_URL = "https://x.com/phantom/status/2023866789860675625";

function makeQualityScore(total: number, reasons: string[]): CuratedDiscovery["qualityScore"] {
  const t = Math.min(5, Math.max(0, total));
  return {
    total: t,
    novelValue: t / 5,
    realUsage: 0.8,
    installProcess: 1,
    documentation: 0.8,
    genuineUtility: t / 5,
    reasons,
  };
}

async function main() {
  console.log("Fetching Phantom tweet via X API...\n");

  const tweet = await fetchTweetContent(PHANTOM_TWEET_URL);

  if (!tweet.tweetText || !tweet.author) {
    console.error("Could not fetch tweet content. Check X API credentials (OAuth 1.0a or Bearer).");
    process.exit(1);
  }

  console.log(`Got: @${tweet.author}\n${tweet.tweetText.slice(0, 200)}${tweet.tweetText.length > 200 ? "..." : ""}\n`);

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

  const sixthPick: CuratedDiscovery = {
    ...d,
    qualityScore: makeQualityScore(4.2, ["Editor pick", "Phantom/Solana ecosystem"]),
    valueProp: oneLiner.slice(0, 100),
  };

  // Load full issue, replace 6th discovery, save back
  const fullPath = join(ISSUES_DIR, `${ISSUE_ID}.full.json`);
  const fullContent = readFileSync(fullPath, "utf-8");
  const newsletter: Newsletter = JSON.parse(fullContent);

  if (newsletter.discoveries.length < 6) {
    console.error("Issue does not have 6 discoveries.");
    process.exit(1);
  }

  newsletter.discoveries[5] = sixthPick;
  writeFileSync(fullPath, JSON.stringify(newsletter, null, 2));

  const lean = toLeanNewsletter(newsletter);
  const leanPath = join(ISSUES_DIR, `${ISSUE_ID}.json`);
  writeFileSync(leanPath, JSON.stringify(lean, null, 2));

  const outputPath = join(process.cwd(), "output", `${ISSUE_ID}.json`);
  writeFileSync(outputPath, JSON.stringify(newsletter, null, 2));

  console.log("Updated 6th pick with X API content:");
  console.log(`   ${leanPath}`);
  console.log(`   ${fullPath}`);
  console.log(`   output/${ISSUE_ID}.json`);
}

main().catch(console.error);
