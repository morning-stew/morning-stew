#!/usr/bin/env tsx

import { compileNewsletter } from "../compiler";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";

async function main() {
  console.log("🍵 Morning Stew Generator\n");

  const date = new Date();
  const newsletter = await compileNewsletter({ date });

  // Ensure output directory exists
  const outputDir = join(process.cwd(), "output");
  mkdirSync(outputDir, { recursive: true });

  // Write to file
  const filename = `${newsletter.id}.json`;
  const filepath = join(outputDir, filename);
  writeFileSync(filepath, JSON.stringify(newsletter, null, 2));

  console.log(`\n✅ Generated: ${filepath}`);
  console.log(`   ID: ${newsletter.id}`);
  console.log(`   Name: "${newsletter.name}"`);
  console.log(`   Date: ${newsletter.date}`);
  console.log(`   Tokens: ~${newsletter.tokenCount}`);

  // Also write a minimal version for ultra-low token consumption
  const minimalNewsletter = {
    id: newsletter.id,
    n: newsletter.name,
    d: newsletter.date,
    // Minimal discovery format: title, category, first install step, url
    disc: newsletter.discoveries.map((d) => ({
      t: d.title,
      c: d.category,
      i: d.install.steps[0] || "",
      u: d.source.url,
    })),
    u: newsletter.frameworkUpdates.map((u) => ({ t: u.title, u: u.url, b: u.breaking })),
  };

  const minimalFilename = `${newsletter.id}.min.json`;
  const minimalFilepath = join(outputDir, minimalFilename);
  writeFileSync(minimalFilepath, JSON.stringify(minimalNewsletter));

  const minimalTokens = Math.ceil(JSON.stringify(minimalNewsletter).length / 4);
  console.log(`\n✅ Minimal version: ${minimalFilepath}`);
  console.log(`   Tokens: ~${minimalTokens}`);
}

main().catch(console.error);
