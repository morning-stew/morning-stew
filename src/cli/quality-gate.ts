#!/usr/bin/env tsx
/**
 * Quality gate for newsletter output.
 * 
 * Reviews each discovery to ensure it meets agent-usability standards.
 * This is where "the agent as customer" mindset lives.
 */

import * as fs from "fs";
import * as path from "path";

const OUTPUT_DIR = path.join(process.cwd(), "output");

interface Discovery {
  title: string;
  url: string;
  what?: string;
  why?: string;
  impact?: string;
  install?: {
    steps: string[];
    requirements?: string[];
    timeEstimate?: string;
    considerations?: string[];
  };
  considerations?: string[];
  publisher?: {
    github?: { handle: string; followers: number };
    twitter?: { handle: string; followers: number };
    stars?: number;
  };
  publisherTrust?: string;
  stars?: number;
}

interface QualityIssue {
  severity: "error" | "warning" | "info";
  field: string;
  message: string;
}

function findLatestOutput(): string | null {
  const files = fs.readdirSync(OUTPUT_DIR)
    .filter(f => f.startsWith("MS-") && f.endsWith(".json") && !f.includes(".full"))
    .sort()
    .reverse();
  return files[0] || null;
}

function checkDiscovery(d: Discovery, index: number): QualityIssue[] {
  const issues: QualityIssue[] = [];

  // 1. Install commands - MUST be specific
  if (!d.install?.steps?.length) {
    issues.push({ severity: "error", field: "install", message: "No install steps" });
  } else {
    for (const step of d.install.steps) {
      // Check for vague commands
      if (step === "npm install" || step === "pip install" || step === "npm") {
        issues.push({ severity: "error", field: "install", message: `Vague install: "${step}" - what package?` });
      }
      // Check for incomplete commands
      if (step.includes("pip install") && !step.includes(" ")) {
        issues.push({ severity: "error", field: "install", message: `Incomplete pip install: "${step}"` });
      }
    }
  }

  // 2. "what" field - must exist and be descriptive
  if (!d.what || d.what.length < 20) {
    issues.push({ severity: "error", field: "what", message: `Too short or missing: "${d.what}"` });
  }

  // 3. "why" field - must explain value
  if (!d.why || d.why.length < 10) {
    issues.push({ severity: "warning", field: "why", message: "Missing or too short" });
  }

  // 4. URL must be valid (GitHub repo)
  if (!d.url) {
    issues.push({ severity: "error", field: "url", message: "No URL" });
  } else if (!d.url.includes("github.com")) {
    issues.push({ severity: "warning", field: "url", message: "Not a GitHub URL - harder to verify" });
  }

  // 5. Impact - what becomes possible?
  if (!d.impact) {
    issues.push({ severity: "warning", field: "impact", message: "Missing impact statement" });
  }

  // 6. Considerations - what happens after install? (NEW - agent as customer)
  const cons = d.considerations as string[] | string | undefined;
  if (!cons || (Array.isArray(cons) && cons.length === 0)) {
    issues.push({ severity: "warning", field: "considerations", message: "Missing - what happens after install?" });
  } else if (typeof cons === 'string') {
    if (cons.length < 30) {
      issues.push({ severity: "warning", field: "considerations", message: "Too short - should explain post-install steps" });
    }
  } else if (Array.isArray(cons)) {
    const c = cons.join(' ');
    if (c.length < 30) {
      issues.push({ severity: "warning", field: "considerations", message: "Too short - should explain post-install steps" });
    }
  }

  return issues;
}

function main() {
  const latestFile = findLatestOutput();
  if (!latestFile) {
    console.log("No output files found.");
    process.exit(1);
  }

  const filepath = path.join(OUTPUT_DIR, latestFile);
  const data = JSON.parse(fs.readFileSync(filepath, "utf8"));

  console.log(`\n🔍 Quality Gate: ${latestFile}\n`);
  console.log("=".repeat(60));

  let totalErrors = 0;
  let totalWarnings = 0;

  for (let i = 0; i < data.discoveries.length; i++) {
    const d = data.discoveries[i] as Discovery;
    const issues = checkDiscovery(d, i);

    console.log(`\n[${i + 1}] ${d.title}`);
    
    if (issues.length === 0) {
      console.log("  ✅ PASS - Agent-ready");
    } else {
      for (const issue of issues) {
        const prefix = issue.severity === "error" ? "❌" : "⚠️";
        console.log(`  ${prefix} ${issue.field}: ${issue.message}`);
        if (issue.severity === "error") totalErrors++;
        else totalWarnings++;
      }
    }
  }

  console.log("\n" + "=".repeat(60));
  console.log(`\n📊 Summary: ${totalErrors} errors, ${totalWarnings} warnings`);

  if (totalErrors > 0) {
    console.log("\n❌ BLOCKED - Fix errors before publishing");
    process.exit(1);
  } else if (totalWarnings > 0) {
    console.log("\n⚠️  WARNING - Review warnings or proceed");
  } else {
    console.log("\n✅ READY FOR PUBLISH");
  }
}

main();