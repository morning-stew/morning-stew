#!/usr/bin/env tsx

import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { loadRegistry, type ToolRegistryEntry } from "../registry";

// ── Load .env ──
const envPath = join(process.cwd(), ".env");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}

function main() {
  console.log("🍵 Morning Stew — Tool Registry Stats\n");

  const registry = loadRegistry();
  const entries = Object.values(registry.entries);

  if (entries.length === 0) {
    console.log("Registry is empty. Run a newsletter generation to populate it.");
    return;
  }

  // ── Total ──
  console.log(`Total tools indexed: ${entries.length}\n`);

  // ── By source ──
  const bySource: Record<string, number> = {};
  for (const e of entries) {
    bySource[e.source] = (bySource[e.source] || 0) + 1;
  }
  console.log("By source:");
  for (const [source, count] of Object.entries(bySource).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${source.padEnd(16)} ${count}`);
  }

  // ── By category ──
  const byCategory: Record<string, number> = {};
  for (const e of entries) {
    byCategory[e.category] = (byCategory[e.category] || 0) + 1;
  }
  console.log("\nBy category:");
  for (const [cat, count] of Object.entries(byCategory).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${cat.padEnd(16)} ${count}`);
  }

  // ── Top 10 most recently seen ──
  const sorted = [...entries].sort(
    (a, b) => new Date(b.lastSeen).getTime() - new Date(a.lastSeen).getTime(),
  );
  console.log("\nTop 10 most recently seen:");
  for (const e of sorted.slice(0, 10)) {
    const lastSeen = e.lastSeen.split("T")[0];
    console.log(`  ${lastSeen}  ${e.title}`);
  }

  // ── Picked vs never picked ──
  const picked = entries.filter((e) => e.timesPicked > 0);
  const neverPicked = entries.filter((e) => e.timesPicked === 0);
  console.log(`\nPicked for newsletter: ${picked.length}`);
  console.log(`Never picked:          ${neverPicked.length}`);
}

main();
