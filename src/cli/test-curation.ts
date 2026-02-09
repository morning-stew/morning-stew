#!/usr/bin/env tsx

import { scrapeTwitterFeed } from "../scrapers/twitter-feed";
import { scrapeGitHubTrending } from "../scrapers/github-trending";
import { curateDiscoveries } from "../curation";

async function main() {
  console.log("🎯 Testing Quality Curation Pipeline\n");
  console.log("This will scrape sources and run them through the quality rubric.\n");

  // Gather candidates
  console.log("📡 Gathering candidates...\n");
  
  const [twitterDiscoveries, githubDiscoveries] = await Promise.all([
    scrapeTwitterFeed({ 
      maxPerAccount: 3, 
      hoursAgo: 72,
      minRelevanceScore: 15, // Lower threshold to get more candidates for curation
      headless: true,
    }),
    scrapeGitHubTrending({ 
      maxResults: 10, 
      minStars: 30, // Lower threshold to get more candidates
      sinceDays: 7 
    }),
  ]);

  console.log(`\n📊 Raw candidates: Twitter=${twitterDiscoveries.length}, GitHub=${githubDiscoveries.length}\n`);

  // Combine and curate
  const allDiscoveries = [...twitterDiscoveries, ...githubDiscoveries];
  
  console.log("🔍 Running quality curation...\n");
  const result = await curateDiscoveries(allDiscoveries, { minScore: 3, maxPicks: 10 });

  // Display results
  console.log("\n" + "=".repeat(60));
  console.log("📰 THIS WEEK'S PICKS (Quality Score >= 3)");
  console.log("=".repeat(60) + "\n");

  if (result.picks.length === 0) {
    console.log("No discoveries met the quality bar this week.\n");
  } else {
    result.picks.forEach((d, i) => {
      console.log(`${i+1}. ${d.title}`);
      console.log(`   📝 ${d.valueProp}`);
      console.log(`   ⭐ Quality Score: ${d.qualityScore.total}/5`);
      console.log(`   📊 Breakdown: novel=${d.qualityScore.novelValue}, usage=${d.qualityScore.realUsage}, install=${d.qualityScore.installProcess}, docs=${d.qualityScore.documentation}, utility=${d.qualityScore.genuineUtility}`);
      console.log(`   💡 ${d.qualityScore.reasons.slice(0, 3).join(" | ")}`);
      console.log(`   🔗 ${d.source.url}`);
      console.log("");
    });
  }

  console.log("\n" + "=".repeat(60));
  console.log("👀 ON OUR RADAR (Promising, not ready yet)");
  console.log("=".repeat(60) + "\n");

  if (result.onRadar.length === 0) {
    console.log("Nothing notable in the pipeline.\n");
  } else {
    result.onRadar.forEach((d, i) => {
      console.log(`${i+1}. ${d.title}`);
      console.log(`   ⏳ ${d.skipReason || "Needs more traction"}`);
      console.log(`   ⭐ Score: ${d.qualityScore.total}/5`);
      console.log(`   🔗 ${d.source.url}`);
      console.log("");
    });
  }

  console.log("\n" + "=".repeat(60));
  console.log("❌ DIDN'T MAKE THE CUT");
  console.log("=".repeat(60) + "\n");

  if (result.skipped.length === 0) {
    console.log("Everything was at least worth watching.\n");
  } else {
    result.skipped.forEach((d, i) => {
      console.log(`${i+1}. ${d.title.slice(0, 50)}...`);
      console.log(`   ❌ ${d.skipReason}`);
      console.log(`   ⭐ Score: ${d.qualityScore.total}/5`);
      console.log("");
    });
  }

  // Summary
  console.log("\n" + "=".repeat(60));
  console.log("📈 SUMMARY");
  console.log("=".repeat(60));
  console.log(`Total candidates: ${allDiscoveries.length}`);
  console.log(`Quality picks: ${result.picks.length}`);
  console.log(`On radar: ${result.onRadar.length}`);
  console.log(`Skipped: ${result.skipped.length}`);
  console.log(`Quiet week: ${result.isQuietWeek ? "YES ⚠️" : "NO ✅"}`);
}

main().catch(console.error);
