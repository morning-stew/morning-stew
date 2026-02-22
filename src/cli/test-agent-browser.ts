#!/usr/bin/env tsx
/**
 * Test: agent-browser navigation helper
 *
 * Step 1 — raw navigate: verifies agentBrowserNavigate returns
 *   a snapshot with /url: paths + article text.
 *
 * Step 2 — full agent loop: runs deepEnrichUrl with the agent-browser
 *   path active (forces sparse-content branch regardless of actual length).
 *
 * Run: pnpm exec tsx -r ./src/load-env.cjs src/cli/test-agent-browser.ts https://bankr.bot/
 */

import { execFile } from "child_process";
import { promisify } from "util";
import { deepEnrichUrl } from "../scrapers/twitter-api";

const execFileAsync = promisify(execFile);

async function runAB(args: string[], session: string): Promise<string> {
  const { stdout } = await execFileAsync(
    "node_modules/.bin/agent-browser",
    [...args, "--session", session],
    { timeout: 120000 }
  );
  return stdout.trim();
}

async function runABSafe(args: string[], session: string): Promise<string> {
  try { return await runAB(args, session); } catch { return ""; }
}

async function agentBrowserNavigate(url: string, session: string): Promise<string> {
  await runAB(["open", url], session);
  const currentUrl = await runABSafe(["get", "url"], session);
  const snapshot = await runAB(["snapshot", "-d", "4"], session);
  const articleText =
    (await runABSafe(["get", "text", "article"], session)) ||
    (await runABSafe(["get", "text", "main"], session)) ||
    "";

  let result = `Current URL: ${currentUrl || url}\n\nPage structure:\n${snapshot.slice(0, 2000)}`;
  if (articleText) result += `\n\nPage content:\n${articleText.slice(0, 2000)}`;
  return result;
}

function divider(label: string) {
  console.log(`\n${"─".repeat(60)}`);
  console.log(`  ${label}`);
  console.log("─".repeat(60));
}

async function main() {
  const url = process.argv[2];
  if (!url) {
    console.error("Usage: test-agent-browser.ts <url>");
    process.exit(1);
  }

  // ── Step 1: Raw navigate helper ──
  divider(`STEP 1: agentBrowserNavigate\n  ${url}`);
  const session = `ms-test-${Date.now()}`;
  const start1 = Date.now();
  const navResult = await agentBrowserNavigate(url, session);
  console.log(`${navResult.length} chars in ${((Date.now() - start1) / 1000).toFixed(1)}s\n`);
  console.log(navResult.slice(0, 3000));
  if (navResult.length > 3000) console.log(`\n... (${navResult.length - 3000} more chars)`);

  // ── Step 2: Full deepEnrichUrl agent loop ──
  divider(`STEP 2: deepEnrichUrl (full loop)\n  ${url}`);
  if (!process.env.NOUS_API_KEY) {
    console.log("NOUS_API_KEY not set — skipping agent loop.");
  } else {
    const start2 = Date.now();
    const brief = await deepEnrichUrl(url);
    const elapsed = ((Date.now() - start2) / 1000).toFixed(1);

    if (!brief) {
      console.log(`RESULT: EMPTY (${elapsed}s)`);
    } else {
      console.log(`RESULT: ${brief.length} chars (${elapsed}s)\n`);
      console.log(brief.slice(0, 3000));
      const hasInstall = /pip install|npm install|git clone|cargo install|brew install|yarn add|npx /i.test(brief);
      console.log(`\nHas install commands: ${hasInstall ? "YES" : "NO"}`);
    }
  }

  divider("DONE");
}

main().catch(console.error);
