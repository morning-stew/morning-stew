#!/usr/bin/env tsx
/**
 * Seed the free issue (Issue #0 = MS-#0) dated 2026-02-13.
 *
 * Run once after deployment to create the free edition:
 *   pnpm tsx src/cli/seed-free-issue.ts
 *
 * Or to publish to a live server:
 *   API_BASE=https://morning-stew-production.up.railway.app \
 *   INTERNAL_SECRET=<your-secret> \
 *   pnpm tsx src/cli/seed-free-issue.ts
 */

import { compileNewsletter } from "../compiler/compile";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";

const FREE_ISSUE_ID = "MS-#0";
const FREE_ISSUE_DATE = new Date("2026-02-13");
const API_BASE = process.env.API_BASE || "";
const INTERNAL_SECRET = process.env.INTERNAL_SECRET || "";

async function main() {
  console.log(`[seed] Generating free issue ${FREE_ISSUE_ID} for ${FREE_ISSUE_DATE.toISOString().split("T")[0]}...`);

  const newsletter = await compileNewsletter({
    date: FREE_ISSUE_DATE,
    overrideId: FREE_ISSUE_ID,
    skipMinimumCheck: true, // Allow fewer than 6 picks for the seed issue
  });

  console.log(`[seed] Generated: ${newsletter.id} "${newsletter.name}" (${newsletter.discoveries.length} discoveries)`);

  // Save locally
  const dataDir = process.env.DATA_DIR || join(process.cwd(), ".morning-stew");
  const issuesDir = join(dataDir, "issues");
  if (!existsSync(issuesDir)) mkdirSync(issuesDir, { recursive: true });

  writeFileSync(join(issuesDir, `${FREE_ISSUE_ID}.json`), JSON.stringify(newsletter, null, 2));
  console.log(`[seed] Saved locally: ${join(issuesDir, `${FREE_ISSUE_ID}.json`)}`);

  // Optionally publish to live server
  if (API_BASE && INTERNAL_SECRET) {
    console.log(`[seed] Publishing to ${API_BASE}...`);
    const res = await fetch(`${API_BASE}/internal/newsletters`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${INTERNAL_SECRET}`,
      },
      body: JSON.stringify(newsletter),
    });
    if (res.ok) {
      console.log(`[seed] Published to server.`);
    } else {
      console.error(`[seed] Server publish failed: ${res.status} ${await res.text()}`);
    }
  } else {
    console.log(`[seed] Set API_BASE and INTERNAL_SECRET to also publish to a live server.`);
  }
}

main().catch(console.error);
