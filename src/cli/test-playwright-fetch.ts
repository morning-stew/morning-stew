#!/usr/bin/env tsx
/**
 * Test: Playwright fetch helper
 *
 * Verifies that playwrightFetch returns real rendered content from JS SPAs
 * where a plain fetch would return near-empty HTML.
 *
 * Run: pnpm exec tsx src/cli/test-playwright-fetch.ts https://bankr.bot/
 */

import { playwrightFetch } from "../scrapers/twitter-api";

async function main() {
  const url = process.argv[2];
  if (!url) {
    console.error("Usage: test-playwright-fetch.ts <url>");
    process.exit(1);
  }

  console.log(`Fetching with Playwright: ${url}\n`);
  const start = Date.now();
  const content = await playwrightFetch(url);
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);

  console.log(`${content.length} chars in ${elapsed}s\n`);
  console.log(content.slice(0, 3000));
  if (content.length > 3000) {
    console.log(`\n... (${content.length - 3000} more chars)`);
  }
}

main().catch(console.error);
