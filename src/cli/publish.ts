#!/usr/bin/env tsx

import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import type { Newsletter } from "../types";

/**
 * Publish the latest newsletter to various channels.
 * 
 * Channels:
 * 1. Twitter/X announcement
 * 2. ClawHub skill registry update
 * 3. API server (if running)
 */

export async function publishToTwitter(newsletter: Newsletter): Promise<boolean> {
  // Summarize discoveries by category
  const categories = new Map<string, number>();
  for (const d of newsletter.discoveries) {
    categories.set(d.category, (categories.get(d.category) || 0) + 1);
  }
  const categoryStr = Array.from(categories.entries())
    .map(([cat, count]) => `${count} ${cat}`)
    .slice(0, 3)
    .join(", ");

  const tweet = `🍵 Morning Stew #${newsletter.id}

"${newsletter.name}"

🔍 ${newsletter.discoveries.length} actionable discoveries
   (${categoryStr})
🔄 ${newsletter.frameworkUpdates.length} framework updates

Each discovery includes install steps your agent can run.

https://morning-stew.ai/v1/issues/${newsletter.id}

#OpenClaw #AIAgents`;

  console.log("[publish] Would tweet:\n");
  console.log(tweet);
  console.log("\n[publish] Twitter publishing not yet implemented");

  // TODO: Use x402 social-intelligence skill to post
  return false;
}

export async function publishToApi(newsletter: Newsletter): Promise<boolean> {
  const apiUrl = process.env.API_URL || "http://localhost:3000";

  try {
    const response = await fetch(`${apiUrl}/internal/newsletters`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newsletter),
    });

    if (response.ok) {
      console.log(`[publish] Published to API: ${apiUrl}`);
      return true;
    } else {
      console.error(`[publish] API error: ${response.status}`);
      return false;
    }
  } catch (error) {
    console.log(`[publish] API not available at ${apiUrl}`);
    return false;
  }
}

async function main() {
  console.log("🍵 Morning Stew Publisher\n");

  // Find latest newsletter
  const outputDir = join(process.cwd(), "output");
  let files: string[];

  try {
    files = readdirSync(outputDir).filter(
      (f) => f.endsWith(".json") && !f.endsWith(".min.json")
    );
  } catch {
    console.error("No output directory found. Run `pnpm generate` first.");
    process.exit(1);
  }

  if (files.length === 0) {
    console.error("No newsletters found. Run `pnpm generate` first.");
    process.exit(1);
  }

  // Sort by name (which includes date) and get latest
  files.sort().reverse();
  const latestFile = files[0];
  const filepath = join(outputDir, latestFile);

  const newsletter: Newsletter = JSON.parse(readFileSync(filepath, "utf-8"));
  console.log(`Publishing: ${newsletter.id} - "${newsletter.name}"\n`);

  // Publish to all channels
  await Promise.all([
    publishToTwitter(newsletter),
    publishToApi(newsletter),
  ]);

  console.log("\n✅ Publishing complete");
}

main().catch(console.error);
