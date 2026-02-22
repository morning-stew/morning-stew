#!/usr/bin/env tsx
import "../load-env.cjs";
import { deepEnrichUrl } from "../scrapers/twitter-api";
import fs from "fs";

const data = JSON.parse(fs.readFileSync("output/MS-#3.full.json", "utf8"));

async function main() {
  for (let i = 0; i < data.discoveries.length; i++) {
    const d = data.discoveries[i];
    const url = d.source?.url;
    
    if (url && !url.includes("x.com") && !url.includes("twitter.com")) {
      console.log(`\n=== Enriching: ${d.title} ===`);
      console.log(`URL: ${url}`);
      
      const brief = await deepEnrichUrl(url);
      console.log(`Raw response:\n${brief.slice(0, 1500)}\n`);
    }
  }
}

main().catch(console.error);
