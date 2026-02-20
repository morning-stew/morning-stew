#!/usr/bin/env tsx
/**
 * Test: Web enrichment chain for a single tweet URL
 *
 * Validates that the scraper can:
 *   1. Fetch the tweet text + extract linked URLs
 *   2. Follow those links to get page/docs content
 *   3. Build the full context the LLM judge actually sees
 *
 * Run: pnpm exec tsx -r ./src/load-env.cjs src/cli/test-web-enrich.ts
 */

import { fetchTweetContent } from "../scrapers/twitter-api";
import { judgeContent } from "../curation/llm-judge";
import { chromium } from "playwright";

// Hard-coded test tweet — YC launch post
const TEST_TWEET_URL = "https://x.com/ycombinator/status/2024197228173185041";

function divider(label: string) {
  console.log(`\n${"─".repeat(60)}`);
  console.log(`  ${label}`);
  console.log("─".repeat(60));
}

async function main() {
  console.log("Web Enrichment Chain Test");
  console.log(`Tweet: ${TEST_TWEET_URL}\n`);

  // ── Step 1: Fetch tweet + linked URLs ──
  divider("STEP 1: Fetch tweet content");
  const result = await fetchTweetContent(TEST_TWEET_URL);

  if (!result.tweetText) {
    console.error("FAIL: Could not fetch tweet. Check X API credentials.");
    process.exit(1);
  }

  console.log(`Author:    @${result.author}`);
  console.log(`Tweet:\n  ${result.tweetText.replace(/\n/g, "\n  ")}`);
  console.log(`\nExternal URLs found: ${result.urls.length}`);
  for (const url of result.urls) {
    console.log(`  - ${url}`);
  }

  // ── Step 1b: Debug — what does Playwright actually see on paysponge.com? ──
  divider("STEP 1b: Playwright debug — all skill-related elements");
  {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto("https://paysponge.com", { waitUntil: "networkidle", timeout: 30000 });
    await page.screenshot({ path: "/tmp/paysponge.png" });
    console.log("Screenshot saved to /tmp/paysponge.png");

    const elements = await page.evaluate(() => {
      return Array.from(document.querySelectorAll("*"))
        .filter(el => {
          const t = (el as HTMLElement).innerText?.trim();
          return t && /skill/i.test(t) && t.length < 40;
        })
        .map(el => ({
          tag: el.tagName,
          text: (el as HTMLElement).innerText?.trim(),
          href: (el as HTMLAnchorElement).href || el.getAttribute("href") || null,
          role: el.getAttribute("role"),
        }));
    });
    console.log("Elements containing 'skill':");
    for (const e of elements) {
      console.log(`  <${e.tag}> "${e.text}" href=${e.href} role=${e.role}`);
    }
    await browser.close();
  }

  // ── Step 2: Linked page content ──
  divider("STEP 2: Linked page / docs content");
  if (result.urls.length > 0) {
    console.log(`Following: ${result.urls[0]}`);
  }
  if (result.linkedContent) {
    const charCount = result.linkedContent.length;
    // Heuristic: if content is rich, plain fetch worked; if it smells like rendered text, Playwright kicked in
    console.log(`Fetched ${charCount} chars\n`);
    console.log(result.linkedContent.slice(0, 1000));
    if (charCount > 1000) {
      console.log(`\n... (${charCount - 1000} more chars)`);
    }
  } else {
    console.log("No linked content fetched (no external URLs or all fetches failed).");
  }

  // ── Step 3: Full context sent to LLM judge ──
  divider("STEP 3: Full context the LLM judge sees");
  console.log(result.fullContent.slice(0, 2000));
  if (result.fullContent.length > 2000) {
    console.log(`\n... (${result.fullContent.length - 2000} more chars)`);
  }

  // ── Step 4: Run the LLM judge (if API key present) ──
  divider("STEP 4: LLM judge verdict");
  if (!process.env.NOUS_API_KEY) {
    console.log("NOUS_API_KEY not set — skipping LLM judge step.");
  } else {
    console.log("Running LLM judge...\n");
    const verdict = await judgeContent({
      content: result.fullContent,
      source: "twitter",
      author: result.author,
      externalUrl: result.urls[0] || TEST_TWEET_URL,
    });

    if (!verdict) {
      console.log("LLM judge returned no verdict.");
    } else {
      console.log(`Actionable:  ${verdict.actionable}`);
      console.log(`Confidence:  ${verdict.confidence}`);
      console.log(`Category:    ${verdict.category}`);
      console.log(`Title:       ${verdict.title}`);
      console.log(`One-liner:   ${verdict.oneLiner}`);
      console.log(`Value prop:  ${verdict.valueProp}`);
      console.log(`Install:     ${verdict.installHint}`);
      if (!verdict.actionable) {
        console.log(`Skip reason: ${verdict.skipReason}`);
      }
      if (verdict.scores) {
        console.log("\nScores:");
        for (const [k, v] of Object.entries(verdict.scores)) {
          const bar = "█".repeat(Math.round((v as number) * 10)).padEnd(10, "░");
          const pass = (v as number) >= 0.5 ? "✓" : "✗";
          console.log(`  ${pass} ${k.padEnd(16)} ${bar} ${(v as number).toFixed(2)}`);
        }
      }
    }
  }

  divider("SUMMARY");
  console.log(`Tweet fetched:        ${result.tweetText ? "YES" : "NO"}`);
  console.log(`URLs found:           ${result.urls.length}`);
  console.log(`Linked content:       ${result.linkedContent ? `YES (${result.linkedContent.length} chars)` : "NO"}`);
  console.log(`Full context length:  ${result.fullContent.length} chars`);
}

main().catch(console.error);
