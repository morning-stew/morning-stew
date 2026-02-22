#!/usr/bin/env tsx
/**
 * Morning Stew Install Diagnostics
 * Usage: npm run diagnose
 * Audits every discovery's install instructions with static analysis.
 */

import { existsSync, readFileSync, readdirSync } from "fs";
import { join } from "path";
import { diagnoseIssue } from "../diagnostics/install-checks";
import type { IssueDiagnosis, DiscoveryDiagnosis, CheckResult } from "../diagnostics/install-checks";

// ── Config ──────────────────────────────────────────────────────────────────
const DATA_DIR = process.env.DATA_DIR ?? join(process.cwd(), ".morning-stew");
const ISSUES_DIR = join(DATA_DIR, "issues");

// ── ANSI ────────────────────────────────────────────────────────────────────
const R = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const GRAY = "\x1b[90m";

const ok   = (s: string) => `${GREEN}✓${R} ${s}`;
const no   = (s: string) => `${RED}✗${R} ${s}`;
const warn = (s: string) => `${YELLOW}⚠${R} ${s}`;
const dim  = (s: string) => `${DIM}${s}${R}`;
const bold = (s: string) => `${BOLD}${s}${R}`;

// ── Load issues ──────────────────────────────────────────────────────────────
function loadIssues(): Array<{ id: string; name: string; date: string; discoveries: any[] }> {
  if (!existsSync(ISSUES_DIR)) return [];
  const leanFiles = readdirSync(ISSUES_DIR)
    .filter(f => f.endsWith(".json") && !f.endsWith(".full.json"))
    .sort();
  return leanFiles.flatMap(f => {
    try {
      const id = f.replace(".json", "");
      const fullPath = join(ISSUES_DIR, `${id}.full.json`);
      const path = existsSync(fullPath) ? fullPath : join(ISSUES_DIR, f);
      return [JSON.parse(readFileSync(path, "utf-8"))];
    } catch {
      return [];
    }
  });
}

// ── Render ───────────────────────────────────────────────────────────────────
function renderCheckResult(label: string, result: CheckResult): string {
  const lbl = `    ${CYAN}${label.padEnd(14)}${R}`;
  if (result.status === "pass") return `${lbl}${ok(result.message)}`;
  if (result.status === "warn") return `${lbl}${warn(result.message)}`;
  return `${lbl}${no(result.message)}`;
}

function gradeSymbol(grade: "pass" | "warn" | "fail"): string {
  if (grade === "pass") return `${GREEN}✓${R}`;
  if (grade === "warn") return `${YELLOW}⚠${R}`;
  return `${RED}✗${R}`;
}

function renderDiscovery(d: DiscoveryDiagnosis): void {
  const sym = gradeSymbol(d.grade);
  const title = d.title.length > 58 ? d.title.slice(0, 55) + "..." : d.title;
  console.log(`  ${sym} ${bold(title)}`);
  for (const [label, result] of Object.entries(d.checks)) {
    console.log(renderCheckResult(label, result));
  }
  if (d.grade === "fail") {
    const reasons = Object.values(d.checks)
      .filter(c => c.status === "fail")
      .map(c => c.message)
      .join(", ");
    console.log(`    ${RED}Grade: FAIL — ${reasons}${R}`);
  }
  console.log();
}

function renderIssueDiagnosis(diag: IssueDiagnosis): void {
  const { pass, warn: w, fail } = diag.summary;
  const parts = [
    pass > 0 ? `${GREEN}${pass} pass${R}` : "",
    w > 0 ? `${YELLOW}${w} warn${R}` : "",
    fail > 0 ? `${RED}${fail} fail${R}` : "",
  ].filter(Boolean);

  console.log(`\n${BOLD}${diag.issueId}${R}  ${dim(diag.name)}  ${dim(diag.date)}`);
  console.log(`${GRAY}${"─".repeat(46)}${R}`);
  if (diag.discoveries.length === 0) {
    console.log(`  ${dim("no discoveries")}`);
    return;
  }
  console.log(`  ${parts.join("  ")}`);
  console.log();
  for (const d of diag.discoveries) {
    renderDiscovery(d);
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  console.log(`\n${BOLD}${CYAN}╔═══════════════════════════════════════════╗${R}`);
  console.log(`${BOLD}${CYAN}║   Morning Stew Install Diagnostics        ║${R}`);
  console.log(`${BOLD}${CYAN}╚═══════════════════════════════════════════╝${R}`);
  console.log(dim(`  ${ISSUES_DIR}`));

  const issues = loadIssues().sort((a, b) => b.date.localeCompare(a.date));

  if (issues.length === 0) {
    console.log(`\n  ${YELLOW}⚠${R} No issues found in ${ISSUES_DIR}`);
    return;
  }

  console.log(dim(`\n  Running checks on ${issues.length} issue(s)...\n`));

  const diagnoses = await Promise.all(issues.map(i => diagnoseIssue(i)));

  let totalPass = 0, totalWarn = 0, totalFail = 0;
  for (const d of diagnoses) {
    totalPass += d.summary.pass;
    totalWarn += d.summary.warn;
    totalFail += d.summary.fail;
    renderIssueDiagnosis(d);
  }

  const totalDiscoveries = totalPass + totalWarn + totalFail;
  console.log(`${BOLD}${CYAN}Summary${R}  ${GRAY}${"─".repeat(38)}${R}`);
  console.log(`  Issues       ${bold(String(issues.length))}`);
  console.log(`  Discoveries  ${bold(String(totalDiscoveries))}  (${GREEN}${totalPass} pass${R}  ${YELLOW}${totalWarn} warn${R}  ${RED}${totalFail} fail${R})`);
  console.log();
}

main().catch(e => {
  console.error(`${RED}diagnose error:${R}`, e?.message ?? e);
  process.exit(1);
});
