#!/usr/bin/env tsx

import { scrapeTwitterFeed } from "../scrapers/twitter-feed";

async function main() {
  console.log("🐦 Testing Twitter Feed Scraper\n");
  
  const discoveries = await scrapeTwitterFeed({ 
    maxPerAccount: 3, 
    hoursAgo: 168, // 1 week
    minRelevanceScore: 20,
    headless: true,
  });
  
  console.log("\n=== TOP DISCOVERIES FROM TWITTER ===\n");
  
  discoveries.slice(0, 15).forEach((d, i) => {
    console.log(`${i+1}. [${d.category}] @${d.source.author}`);
    console.log(`   ${d.what.slice(0, 120)}`);
    console.log(`   Score reason: ${d.why}`);
    console.log(`   ${d.source.url}`);
    console.log("");
  });
  
  console.log(`\nTotal relevant tweets: ${discoveries.length}`);
}

main().catch(console.error);
