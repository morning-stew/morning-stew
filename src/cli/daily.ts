#!/usr/bin/env tsx

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";

// Load .env before anything else (so NOUS_API_KEY is available at module load)
const envPath = join(process.cwd(), ".env");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}

import { compileNewsletter } from "../compiler";
import { toLeanNewsletter } from "../types/newsletter";
import { publishToApi, publishToTwitter } from "./publish";

async function main() {
  console.log("🍵 Morning Stew Daily — Generate & Publish\n");

  // 1. Generate
  const date = new Date();
  const newsletter = await compileNewsletter({ date });

  // 2. Write to disk for archival
  const outputDir = join(process.cwd(), "output");
  mkdirSync(outputDir, { recursive: true });

  const lean = toLeanNewsletter(newsletter);
  const filepath = join(outputDir, `${newsletter.id}.json`);
  writeFileSync(filepath, JSON.stringify(lean, null, 2));

  const fullFilepath = join(outputDir, `${newsletter.id}.full.json`);
  writeFileSync(fullFilepath, JSON.stringify(newsletter, null, 2));

  const leanTokens = Math.ceil(JSON.stringify(lean).length / 4);
  console.log(`\n✅ Generated: ${newsletter.id} — "${newsletter.name}"`);
  console.log(`   Date: ${newsletter.date}  |  Tokens: ~${leanTokens}`);
  console.log(`   Lean: ${filepath}`);
  console.log(`   Full: ${fullFilepath}`);

  // 3. Publish directly — no filesystem round-trip
  console.log("\n📤 Publishing...\n");
  await Promise.all([
    publishToApi(newsletter),
    publishToTwitter(newsletter),
  ]);

  console.log("\n✅ Daily run complete");
}

main().catch(console.error);
