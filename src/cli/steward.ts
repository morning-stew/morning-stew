#!/usr/bin/env tsx
/**
 * steward — unified CLI for Morning Stew pipeline control
 *
 * Commands:
 *   steward run         preflight → generate newsletter → save to output/
 *   steward review      pretty-print the latest issue from output/
 *   steward publish     publish latest from output/ to API + Twitter
 *   steward fix [date]  recover latest (or YYYY-MM-DD) SCRAPPED run
 *   steward mss         system status dashboard
 */

import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { createHash } from "crypto";
import { execSync } from "child_process";

import { runPreflight, type CheckResult } from "./preflight-checks";
import { compileNewsletter } from "../compiler";
import { toLeanNewsletter } from "../types/newsletter";
import type { Newsletter, CuratedDiscovery } from "../types";
import { createDiscovery } from "../types/discovery";
import { judgeBatch, isJudgeAvailable, type JudgeInput, type JudgeVerdict } from "../curation/llm-judge";

const DATA_DIR = process.env.DATA_DIR || join(process.cwd(), ".morning-stew");
const OUTPUT_DIR = join(process.cwd(), "output");

// ── Shared helpers ──

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/** Return the path to the latest *.json in `dir`, optionally excluding a pattern. */
function latestJson(dir: string, exclude?: RegExp): string | null {
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".json") && (!exclude || !exclude.test(f)))
    .sort()
    .reverse();
  return files.length ? join(dir, files[0]) : null;
}

// ── fix: inline helpers mirrored from fix-scrapped-issue.ts ──

function makeQualityScore(total: number, reasons: string[] = []): CuratedDiscovery["qualityScore"] {
  const t = Math.min(5, Math.max(0, total));
  return {
    total: t,
    novelValue: t / 5,
    realUsage: 0.8,
    installProcess: 1,
    documentation: 0.8,
    genuineUtility: t / 5,
    reasons: reasons.length ? reasons : [`Recovery pick (score ${t})`],
  };
}

type LogEntry = {
  title: string;
  url: string;
  source: string;
  curationScore?: number;
  enriched?: {
    oneLiner?: string;
    what?: string;
    why?: string;
    impact?: string;
    installHint?: string;
    valueProp?: string;
  };
};

function discoveryFromLogEntry(entry: LogEntry, verdict?: JudgeVerdict | null): CuratedDiscovery {
  const { url } = entry;
  const isGitHub = url.includes("github.com");
  const cloneUrl = isGitHub
    ? url.replace(/\/blob\/.*$/, "").replace(/\/tree\/.*$/, "")
    : url;

  const title = verdict?.title || entry.title;
  const oneLiner = verdict?.oneLiner || entry.enriched?.oneLiner || entry.title;
  const what = verdict?.oneLiner || entry.enriched?.what || entry.title;
  const why = verdict?.valueProp || entry.enriched?.why || "Recovered from scrapped run";
  const impact = verdict?.valueProp || entry.enriched?.impact || "Included from curation";
  const valueProp = verdict?.valueProp || entry.enriched?.valueProp || entry.title;
  const installHint = verdict?.installHint || entry.enriched?.installHint;
  const steps = installHint
    ? [installHint]
    : isGitHub
    ? [`git clone ${cloneUrl}`, "See repo README for setup"]
    : [`See ${url}`];

  const d = createDiscovery({
    id: `recovery-${createHash("sha256").update(url).digest("base64url").slice(0, 16)}`,
    category: isGitHub ? "tool" : "workflow",
    title,
    oneLiner,
    what,
    why,
    impact,
    install: { steps, timeEstimate: "5 min" },
    source: {
      url: entry.url,
      type: (entry.source as any) || "github",
      author: undefined,
    },
    signals: { engagement: 50 },
  });

  const score = entry.curationScore ?? 4;
  return {
    ...d,
    qualityScore: makeQualityScore(score, ["Recovered from scrapped run"]),
    valueProp,
  };
}

/** Compute the next newsletter ID by inspecting the issues directory. */
function nextIssueId(): string {
  const issuesDir = join(DATA_DIR, "issues");
  if (!existsSync(issuesDir)) {
    return `MS-${new Date().getFullYear()}-001`;
  }

  const ids = readdirSync(issuesDir)
    .filter((f) => /^MS-\d{4}-\d+\.json$/.test(f))
    .map((f) => {
      const m = f.match(/^MS-(\d{4})-(\d+)\.json$/);
      return m ? { year: m[1], num: parseInt(m[2], 10) } : null;
    })
    .filter((x): x is { year: string; num: number } => x !== null);

  if (!ids.length) {
    return `MS-${new Date().getFullYear()}-001`;
  }

  ids.sort((a, b) => a.year.localeCompare(b.year) || a.num - b.num);
  const last = ids[ids.length - 1];
  const nextNum = (last.num + 1).toString().padStart(3, "0");
  return `MS-${last.year}-${nextNum}`;
}

// ── Publish helpers (inlined to avoid publish.ts side effects) ──

async function publishToTwitter(newsletter: Newsletter): Promise<boolean> {
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
  return false;
}

async function publishToApi(newsletter: Newsletter): Promise<boolean> {
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
    }
    console.error(`[publish] API error: ${response.status}`);
    return false;
  } catch {
    console.log(`[publish] API not available at ${apiUrl}`);
    return false;
  }
}

// ── Commands ──

async function cmdRun(): Promise<void> {
  console.log("🍵 steward run — preflight → generate\n");

  // Step 1: Preflight
  console.log("Running preflight checks...\n");
  const results: CheckResult[] = await runPreflight();
  const icon = { pass: "✓", fail: "✗", skip: "–" } as const;
  for (const r of results) {
    console.log(`  ${icon[r.status]} ${r.name}: ${r.message}`);
  }
  console.log();

  const failures = results.filter((r) => r.status === "fail");
  if (failures.length > 0) {
    console.error(`❌ ${failures.length} preflight check(s) failed. Aborting.`);
    process.exit(1);
  }

  // Step 2: Generate
  console.log("Preflight passed. Generating newsletter...\n");
  const newsletter = await compileNewsletter({ date: new Date() });

  // Step 3: Write lean + full to output/
  ensureDir(OUTPUT_DIR);
  const lean = toLeanNewsletter(newsletter);
  const leanPath = join(OUTPUT_DIR, `${newsletter.id}.json`);
  const fullPath = join(OUTPUT_DIR, `${newsletter.id}.full.json`);
  writeFileSync(leanPath, JSON.stringify(lean, null, 2));
  writeFileSync(fullPath, JSON.stringify(newsletter, null, 2));

  console.log(`\n✅ Saved:`);
  console.log(`   ${leanPath} (lean)`);
  console.log(`   ${fullPath} (full)`);
  console.log(`\n   ID: ${newsletter.id}  |  Discoveries: ${newsletter.discoveries.length}  |  Date: ${newsletter.date}`);
  console.log(`\nReview with: pnpm steward review`);
}

async function cmdReview(): Promise<void> {
  // Read latest lean file (exclude *.full.json)
  const file = latestJson(OUTPUT_DIR, /\.full\.json$/);
  if (!file) {
    console.error("No issues found in output/. Run `pnpm steward run` first.");
    process.exit(1);
  }

  const data = JSON.parse(readFileSync(file, "utf-8"));
  const discoveries: any[] = data.discoveries || [];
  const securityNotes: string[] = data.securityNotes || [];

  console.log(`\n🍵 Morning Stew — ${data.id}: "${data.name}"`);
  console.log(`   Date: ${data.date}  |  ${discoveries.length} discoveries\n`);
  console.log("─".repeat(60));

  for (let i = 0; i < discoveries.length; i++) {
    const d = discoveries[i];
    const score = d.qualityScore?.total ?? "?";
    const installStep = d.install?.steps?.[0] ?? (Array.isArray(d.install) ? d.install[0] : "See URL");
    console.log(`\n${i + 1}. ${d.title}`);
    console.log(`   ${d.oneLiner}`);
    console.log(`   Install: ${installStep}`);
    console.log(`   Score: ${score}/5  |  ${d.source?.url ?? ""}`);
  }

  if (securityNotes.length > 0) {
    console.log(`\n${"─".repeat(60)}`);
    console.log("Security Notes:");
    for (const note of securityNotes) {
      console.log(`  ⚠ ${note}`);
    }
  }

  console.log(`\n${"─".repeat(60)}`);
  console.log(`Publish with: pnpm steward publish`);
}

async function cmdPublish(): Promise<void> {
  console.log("🍵 steward publish\n");

  // Prefer the full newsletter from output/ (*.full.json), fall back to lean
  const fullFile = latestJson(OUTPUT_DIR, /(?<!\.full)\.json$/);
  const file = fullFile ?? latestJson(OUTPUT_DIR, /\.full\.json$/);
  if (!file) {
    console.error("No issues found in output/. Run `pnpm steward run` or `pnpm steward fix` first.");
    process.exit(1);
  }

  const newsletter: Newsletter = JSON.parse(readFileSync(file, "utf-8"));
  console.log(`Publishing: ${newsletter.id} — "${newsletter.name}"\n`);

  await Promise.all([publishToTwitter(newsletter), publishToApi(newsletter)]);
  console.log("\n✅ Publishing complete");
}

async function cmdFix(dateOverride?: string): Promise<void> {
  console.log("🍵 steward fix — recovering scrapped run\n");

  const logsDir = join(DATA_DIR, "thinking-logs");
  if (!existsSync(logsDir)) {
    console.error(`No thinking-logs directory at ${logsDir}`);
    process.exit(1);
  }

  const scrappedFiles = readdirSync(logsDir)
    .filter((f) => f.startsWith("SCRAPPED-") && f.endsWith(".json"))
    .sort();

  if (!scrappedFiles.length) {
    console.error("No SCRAPPED-*.json files found in", logsDir);
    process.exit(1);
  }

  let targetFile: string;
  if (dateOverride) {
    const name = `SCRAPPED-${dateOverride}.json`;
    if (!scrappedFiles.includes(name)) {
      console.error(`No scrapped file for date: ${dateOverride}`);
      console.error("Available:", scrappedFiles.join(", "));
      process.exit(1);
    }
    targetFile = join(logsDir, name);
  } else {
    targetFile = join(logsDir, scrappedFiles[scrappedFiles.length - 1]);
  }

  console.log(`Using: ${targetFile}\n`);

  const log = JSON.parse(readFileSync(targetFile, "utf-8"));
  const included: LogEntry[] = (log.candidates || []).filter(
    (c: any) => c.decision === "included"
  );

  if (!included.length) {
    console.error("No 'included' candidates found in scrapped log.");
    process.exit(1);
  }

  console.log(`Found ${included.length} included candidate(s)`);

  // Re-enrich with LLM if available
  let verdicts: (JudgeVerdict | null)[] = included.map(() => null);
  if (isJudgeAvailable()) {
    console.log(`Re-enriching ${included.length} picks with LLM judge...`);
    const inputs: JudgeInput[] = included.map((c) => ({
      content: c.enriched?.oneLiner ? `${c.title}\n\n${c.enriched.oneLiner}` : c.title,
      source: c.source || "github",
      externalUrl: c.url,
      engagement: 50,
    }));
    try {
      verdicts = await judgeBatch(inputs, 5);
      console.log(`Got ${verdicts.filter(Boolean).length}/${included.length} verdicts`);
    } catch (err: any) {
      console.warn("LLM enrichment failed, using log data:", err.message);
    }
  }

  const discoveries: CuratedDiscovery[] = included.map((c, i) =>
    discoveryFromLogEntry(c, verdicts[i])
  );

  const nextId = nextIssueId();
  const dateStr: string = log.date || new Date().toISOString().split("T")[0];

  const newsletter: Newsletter = {
    id: nextId,
    name: `Issue ${nextId.replace("MS-", "#")}`,
    date: dateStr,
    discoveries,
    onRadar: [],
    skipped: [],
    isQuietWeek: false,
    frameworkUpdates: [],
    securityNotes: [
      `${discoveries.length} discovery(ies) recovered from scrapped run — review before installing`,
      "Always review code before running install commands",
    ],
    tokenCount: 0,
  };
  newsletter.tokenCount = Math.ceil(JSON.stringify(newsletter).length / 4);

  const lean = toLeanNewsletter(newsletter);

  // Save to DATA_DIR/issues/
  const issuesDir = join(DATA_DIR, "issues");
  ensureDir(issuesDir);
  writeFileSync(join(issuesDir, `${nextId}.json`), JSON.stringify(lean, null, 2));
  writeFileSync(join(issuesDir, `${nextId}.full.json`), JSON.stringify(newsletter, null, 2));

  // Save to output/
  ensureDir(OUTPUT_DIR);
  writeFileSync(join(OUTPUT_DIR, `${nextId}.json`), JSON.stringify(lean, null, 2));
  writeFileSync(join(OUTPUT_DIR, `${nextId}.full.json`), JSON.stringify(newsletter, null, 2));

  console.log(`\n✅ Fixed issue saved:`);
  console.log(`   ${join(issuesDir, `${nextId}.json`)} (lean)`);
  console.log(`   ${join(issuesDir, `${nextId}.full.json`)} (full)`);
  console.log(`   output/${nextId}.json`);
  console.log(`   ID: ${nextId}  |  Picks: ${discoveries.length}  |  Date: ${dateStr}`);
  console.log(`\nReview with: pnpm steward review`);
}

function cmdMss(): void {
  execSync("npm run status", { stdio: "inherit", cwd: process.cwd() });
}

function printHelp(): void {
  console.log(`\
🍵 steward — Morning Stew pipeline CLI

Usage: pnpm steward <command> [args]

Commands:
  run           Preflight → generate newsletter → save to output/
  review        Pretty-print the latest issue from output/
  publish       Publish latest from output/ to API + Twitter
  fix [date]    Recover latest (or YYYY-MM-DD) SCRAPPED run
  mss           System status dashboard

Examples:
  pnpm steward run
  pnpm steward review
  pnpm steward publish
  pnpm steward fix
  pnpm steward fix 2026-02-18
  pnpm steward mss`);
}

// ── Entry point ──

const [, , command, arg] = process.argv;

switch (command) {
  case "run":
    cmdRun().catch((e) => { console.error(e.message); process.exit(1); });
    break;
  case "review":
    cmdReview().catch((e) => { console.error(e.message); process.exit(1); });
    break;
  case "publish":
    cmdPublish().catch((e) => { console.error(e.message); process.exit(1); });
    break;
  case "fix":
    cmdFix(arg).catch((e) => { console.error(e.message); process.exit(1); });
    break;
  case "mss":
    cmdMss();
    break;
  default:
    printHelp();
    break;
}
