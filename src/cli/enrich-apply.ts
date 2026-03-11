#!/usr/bin/env tsx
/**
 * Apply manual enrichment data from Hermes Agent.
 * 
 * After the Hermes Agent browses URLs, they provide enrichment data
 * which gets applied back to the output JSON.
 * 
 * Usage:
 *   pnpm enrich:apply 1 --what "A tool for X" --why "Does Y" --install "npm install x"
 *   pnpm enrich:apply 2 --what "..." --why "..." --install "..."
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

function parseArgs() {
  // Get args after the script path
  const args = process.argv.slice(process.argv[0].includes('tsx') ? 3 : 2);
  console.log("Raw args:", args);
  const result: Record<string, string> = {};
  
  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    // Handle -- separator
    if (arg === "--") {
      i++;
      continue;
    }
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const value = args[i + 1];
      if (value && !value.startsWith("--")) {
        result[key] = value;
        i += 2;
      } else {
        i++;
      }
    } else if (!isNaN(Number(arg))) {
      // First numeric arg is the index
      if (!result.index) {
        result.index = arg;
      }
      i++;
    } else {
      i++;
    }
  }
  
  return result;
}

function main() {
  const args = parseArgs();
  
  if (!args.index) {
    console.log("Usage: pnpm enrich:apply <index> --what '...' --why '...' --install '...'");
    console.log("");
    console.log("Arguments:");
    console.log("  index     Discovery index (from enrich:list)");
    console.log("  what      What the tool does");
    console.log("  why       Why it matters");
    console.log("  install   Install command(s)");
    console.log("  impact    What becomes possible");
    process.exit(1);
  }

  const index = parseInt(args.index);
  const latestFile = findLatestOutput();
  
  if (!latestFile) {
    console.log("No output files found.");
    process.exit(1);
  }

  const filepath = path.join(OUTPUT_DIR, latestFile);
  const data = JSON.parse(fs.readFileSync(filepath, "utf8"));

  if (index < 1 || index > data.discoveries.length) {
    console.log(`Invalid index. Must be between 1 and ${data.discoveries.length}`);
    process.exit(1);
  }

  const discovery = data.discoveries[index - 1];
  
  // Apply enrichment
  if (args.what) discovery.what = args.what;
  if (args.why) discovery.why = args.why;
  if (args.impact) discovery.impact = args.impact;
  if (args.install) {
    // Parse install as array (comma-separated or single)
    discovery.install = {
      steps: args.install.split("|").map(s => s.trim()),
      requirements: [],
      timeEstimate: "1 min",
      considerations: []
    };
  }

  // Save both full and lean versions
  fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
  
  // Also update lean version
  const leanPath = filepath.replace(".full.json", ".json");
  const leanData = {
    id: data.id,
    name: data.name,
    date: data.date,
    discoveries: data.discoveries.map((d: any) => ({
      title: d.title,
      oneLiner: d.oneLiner,
      what: d.what,
      why: d.why,
      impact: d.impact,
      install: d.install,
      category: d.category,
      tags: d.tags,
      score: d.score,
      stars: d.stars,
      url: d.url
    })),
    securityNotes: data.securityNotes
  };
  fs.writeFileSync(leanPath, JSON.stringify(leanData, null, 2));

  console.log(`✅ Applied enrichment to "${discovery.title}"`);
  console.log(`   Updated: ${latestFile} and lean version`);
}

main();