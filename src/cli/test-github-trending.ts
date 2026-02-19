#!/usr/bin/env tsx
/**
 * Integration test for the GitHub trending scraper.
 * GITHUB_TOKEN is optional (unauthenticated rate limit is lower).
 *
 * Usage: npm run github:test
 */

import { scrapeGitHubTrending } from "../scrapers/github-trending";

async function main() {
  const hasToken = !!process.env.GITHUB_TOKEN;
  console.log(`Testing GitHub trending scraper (token: ${hasToken ? "yes" : "no"})\n`);

  const discoveries = await scrapeGitHubTrending({
    maxResults: 10,
    minStars: 30,
    sinceDays: 7,
  });

  console.log(`\nTotal repos: ${discoveries.length}`);

  if (discoveries.length === 0) {
    console.log("No repos found.");
    return;
  }

  console.log("\nTop 5:\n");
  discoveries.slice(0, 5).forEach((d, i) => {
    console.log(`${i + 1}. ${d.title}`);
    console.log(`   Stars: ${d.signals?.engagement ?? 0}`);
    console.log(`   URL: ${d.source.url}`);
    console.log("");
  });
}

main().catch(console.error);
