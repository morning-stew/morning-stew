#!/usr/bin/env tsx

import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";

import { compileNewsletter } from "../compiler";
import { toLeanNewsletter } from "../types/newsletter";

async function main() {
  console.log("🍵 Morning Stew Generator\n");

  const date = new Date();
  const newsletter = await compileNewsletter({ date });

  // Ensure output directory exists
  const outputDir = join(process.cwd(), "output");
  mkdirSync(outputDir, { recursive: true });

  // Write lean format (what consuming agents actually get)
  const lean = toLeanNewsletter(newsletter);
  const filename = `${newsletter.id}.json`;
  const filepath = join(outputDir, filename);
  writeFileSync(filepath, JSON.stringify(lean, null, 2));

  console.log(`\n✅ Generated (lean): ${filepath}`);
  console.log(`   ID: ${newsletter.id}`);
  console.log(`   Name: "${newsletter.name}"`);
  console.log(`   Date: ${newsletter.date}`);

  const leanTokens = Math.ceil(JSON.stringify(lean).length / 4);
  console.log(`   Tokens: ~${leanTokens}`);

  // Also write full internal format for debugging/archival
  const fullFilename = `${newsletter.id}.full.json`;
  const fullFilepath = join(outputDir, fullFilename);
  writeFileSync(fullFilepath, JSON.stringify(newsletter, null, 2));
  console.log(`   Full (debug): ${fullFilepath}`);
}

main().catch(console.error);
