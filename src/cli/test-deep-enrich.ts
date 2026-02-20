#!/usr/bin/env tsx
/**
 * Test: Deep enrichment agent loop
 *
 * Validates that deepEnrichUrl can:
 *   1. Short-circuit GitHub URLs (README fetch, 0 Hermes calls)
 *   2. Follow links from a landing page to find install docs
 *   3. Produce a structured research brief with install commands
 *
 * Run: pnpm exec tsx -r ./src/load-env.cjs src/cli/test-deep-enrich.ts
 */

import { deepEnrichUrl } from "../scrapers/twitter-api";

const TEST_URLS = [
  // GitHub — should short-circuit to README (1 hop, 0 Hermes calls)
  { url: "https://github.com/pydantic/pydantic-ai", label: "GitHub repo (short-circuit)" },
  // Product landing page — likely needs 2+ hops to find docs
  { url: "https://e2b.dev", label: "Landing page (needs doc navigation)" },
  // Direct docs page — should resolve in 1 hop
  { url: "https://docs.anthropic.com/en/docs/build-with-claude/tool-use", label: "Docs page (1 hop)" },
];

function divider(label: string) {
  console.log(`\n${"─".repeat(60)}`);
  console.log(`  ${label}`);
  console.log("─".repeat(60));
}

async function main() {
  console.log("Deep Enrichment Agent Test");

  if (!process.env.NOUS_API_KEY) {
    console.log("\nWARN: NOUS_API_KEY not set — GitHub URLs will use README fetch, others will fall back to single-hop.\n");
  }

  for (const { url, label } of TEST_URLS) {
    divider(`${label}\n  ${url}`);

    const start = Date.now();
    const brief = await deepEnrichUrl(url);
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);

    if (!brief) {
      console.log(`RESULT: EMPTY (${elapsed}s)`);
      continue;
    }

    console.log(`RESULT: ${brief.length} chars (${elapsed}s)\n`);
    console.log(brief.slice(0, 1500));
    if (brief.length > 1500) {
      console.log(`\n... (${brief.length - 1500} more chars)`);
    }

    // Validate structure
    const hasInstall = /pip install|npm install|git clone|cargo install|brew install|yarn add|npx /i.test(brief);
    console.log(`\nHas install commands: ${hasInstall ? "YES" : "NO"}`);
  }

  divider("DONE");
}

main().catch(console.error);
