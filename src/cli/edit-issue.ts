#!/usr/bin/env tsx
/**
 * Manual Issue Editor
 *
 * Edit the date, name, or id of an existing issue JSON file in-place.
 *
 * Usage:
 *   npm run edit-issue -- <file> --date 2026-02-13
 *   npm run edit-issue -- <file> --name "Neon Drift" --date 2026-02-14
 *   npm run edit-issue -- <file> --id MS-2026-044
 *
 * Paths can be relative to cwd or absolute.
 */

import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";

function usage(): never {
  console.error(`Usage: edit-issue <file> [--date YYYY-MM-DD] [--name "..."] [--id "..."]`);
  process.exit(1);
}

function main() {
  const args = process.argv.slice(2);
  if (args.length < 3) usage();

  const filepath = resolve(args[0]);
  const patches: Record<string, string> = {};

  for (let i = 1; i < args.length; i += 2) {
    const flag = args[i];
    const value = args[i + 1];
    if (!value) usage();

    if (flag === "--date") patches.date = value;
    else if (flag === "--name") patches.name = value;
    else if (flag === "--id") patches.id = value;
    else { console.error(`Unknown flag: ${flag}`); usage(); }
  }

  if (Object.keys(patches).length === 0) usage();

  const issue = JSON.parse(readFileSync(filepath, "utf-8"));
  const before = { id: issue.id, name: issue.name, date: issue.date };

  Object.assign(issue, patches);
  writeFileSync(filepath, JSON.stringify(issue, null, 2) + "\n");

  console.log(`✏️  Edited ${filepath}`);
  for (const [key, val] of Object.entries(patches)) {
    console.log(`   ${key}: ${(before as any)[key]} → ${val}`);
  }
}

main();
