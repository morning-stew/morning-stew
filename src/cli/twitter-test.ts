#!/usr/bin/env tsx
/**
 * Quick test of Twitter scraper with saved cookies.
 */

import { scrapeTwitter } from "../scrapers/twitter";

async function main() {
  console.log("🐦 Testing Twitter scraper...\n");
  
  const results = await scrapeTwitter({ 
    maxResults: 5, 
    headless: true,
    slowMode: true,
  });
  
  console.log(`\nFound ${results.length} tweets:\n`);
  
  for (const r of results) {
    console.log(`${r.handle} (${r.engagement} engagement)`);
    console.log(`  ${r.content.slice(0, 80)}${r.content.length > 80 ? "..." : ""}`);
    console.log(`  ${r.url}`);
    console.log();
  }
}

main().catch(console.error);
