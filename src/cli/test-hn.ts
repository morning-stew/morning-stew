#!/usr/bin/env tsx
/**
 * Integration test for the HackerNews scraper.
 * No API keys needed — HN Algolia is public.
 *
 * Usage: npm run hn:test
 */

import { scrapeDiscoveries } from "../scrapers/discoveries";

async function main() {
  console.log("Testing HackerNews scraper\n");

  const discoveries = await scrapeDiscoveries({
    maxPerCategory: 2,
    minPoints: 5,
    hoursAgo: 48,
    enrichWithComments: false,
  });

  console.log(`\nTotal discoveries: ${discoveries.length}`);

  if (discoveries.length === 0) {
    console.log("No discoveries found.");
    return;
  }

  console.log("\nTop 5:\n");
  discoveries.slice(0, 5).forEach((d, i) => {
    console.log(`${i + 1}. ${d.title}`);
    console.log(`   ${d.oneLiner}`);
    console.log(`   URL: ${d.source.url}`);
    console.log(`   Engagement: ${d.signals?.engagement ?? 0}`);
    console.log("");
  });
}

main().catch(console.error);
