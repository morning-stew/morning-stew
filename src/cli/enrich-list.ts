#!/usr/bin/env tsx
/**
 * List URLs that need manual enrichment by Hermes Agent.
 * 
 * Run this after generate to see which URLs need browsing.
 * The Hermes Agent will use browser tools to fetch each URL and extract:
 * - What: What the tool does
 * - Why: Why it's useful
 * - Install: Exact install commands
 * - Impact: What becomes possible
 */

import fs from "fs";
import path from "path";

const OUTPUT_DIR = path.join(process.cwd(), "output");

function findLatestOutput(): string | null {
  const files = fs.readdirSync(OUTPUT_DIR)
    .filter(f => f.startsWith("MS-") && f.endsWith(".full.json"))
    .sort()
    .reverse();
  return files[0] || null;
}

function main() {
  const latestFile = findLatestOutput();
  if (!latestFile) {
    console.log("No output files found. Run 'pnpm generate' first.");
    process.exit(1);
  }

  const filepath = path.join(OUTPUT_DIR, latestFile);
  const data = JSON.parse(fs.readFileSync(filepath, "utf8"));

  console.log(`\n🍵 URLs needing enrichment (from ${latestFile})\n`);
  console.log("The Hermes Agent should browse each URL and provide:\n");
  console.log("  - what: What this tool does (1-2 sentences)");
  console.log("  - why: Why it matters for AI agent developers");
  console.log("  - install: Exact commands to install");
  console.log("  - impact: What becomes possible\n");
  console.log("---\n");

  const urls: { index: number; title: string; url: string }[] = [];

  for (let i = 0; i < data.discoveries.length; i++) {
    const d = data.discoveries[i];
    const url = d.source?.url || d.url;
    
    // Skip if it's a Twitter/X URL or no URL
    if (!url || url.includes("x.com") || url.includes("twitter.com")) {
      continue;
    }

    // Check if already enriched (has what/why/install)
    const needsEnrichment = !d.what || !d.install || d.install.length === 0;
    
    if (needsEnrichment) {
      urls.push({ index: i + 1, title: d.title, url });
      console.log(`[${i + 1}] ${d.title}`);
      console.log(`    ${url}`);
      if (!d.what) console.log(`    ⚠️  missing: what`);
      if (!d.install || d.install.length === 0) console.log(`    ⚠️  missing: install`);
      console.log("");
    }
  }

  console.log(`Total: ${urls.length} URLs need enrichment\n`);
  
  // Save to a file for easy copy/paste
  const listPath = path.join(OUTPUT_DIR, "pending-enrichment.json");
  fs.writeFileSync(listPath, JSON.stringify({ file: latestFile, urls }, null, 2));
  console.log(`Saved to: ${listPath}`);
}

main();