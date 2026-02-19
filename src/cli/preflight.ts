#!/usr/bin/env tsx
/**
 * Preflight check — verify all API keys are live before generation.
 *
 * Makes one lightweight call to each service. Reports pass/fail.
 * Usage: npm run preflight
 */

import { runPreflight, type CheckResult } from "./preflight-checks";

const R = "\x1b[0m";
const BOLD = "\x1b[1m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const DIM = "\x1b[2m";

function formatResult(result: CheckResult): string {
  switch (result.status) {
    case "pass":
      return `  ${GREEN}PASS${R}  ${result.name} — ${result.message}`;
    case "fail":
      return `  ${RED}FAIL${R}  ${result.name} — ${result.message}`;
    case "skip":
      return `  ${YELLOW}SKIP${R}  ${result.name}  ${DIM}(${result.message})${R}`;
  }
}

async function main() {
  console.log(`\n${BOLD}Preflight check — verifying API keys${R}\n`);

  const results = await runPreflight();

  for (const result of results) {
    console.log(formatResult(result));
  }

  const failures = results.filter((r) => r.status === "fail").length;

  console.log();
  if (failures > 0) {
    console.log(`${RED}${failures} check(s) failed.${R} Fix before running generation.\n`);
    process.exit(1);
  } else {
    console.log(`${GREEN}All checks passed.${R} Ready to generate.\n`);
  }
}

main().catch(console.error);
