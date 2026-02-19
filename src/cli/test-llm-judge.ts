#!/usr/bin/env tsx
/**
 * Integration test for the LLM judge.
 * Requires NOUS_API_KEY.
 *
 * Usage: npm run judge:test
 */

import { judgeContent, isJudgeAvailable } from "../curation/llm-judge";
import type { JudgeInput } from "../curation/llm-judge";

const FIXTURES: Array<{ label: string; input: JudgeInput }> = [
  {
    label: "Clear pass — real npm package with stars",
    input: {
      content: "Released: @langchain/core v0.3.0 — complete rewrite of the tool-use primitives. npm install @langchain/core. 2,400 stars on GitHub, used by 15k projects.",
      source: "hackernews",
      engagement: 450,
      externalUrl: "https://github.com/langchain-ai/langchainjs",
    },
  },
  {
    label: "Clear fail — awesome-list (specificity)",
    input: {
      content: "Awesome MCP Servers — a curated list of 150+ Model Context Protocol servers across 20 categories. Updated weekly.",
      source: "github",
      engagement: 3200,
      externalUrl: "https://github.com/example/awesome-mcp",
    },
  },
  {
    label: "Clear fail — waitlist announcement",
    input: {
      content: "We're building an AI agent platform that can run 100 agents in parallel. Sign up for early access at our waitlist. Launching Q3 2026.",
      source: "twitter",
      engagement: 80,
    },
  },
  {
    label: "Borderline — MCP server with install hint",
    input: {
      content: "Built an MCP server that gives Claude access to your local filesystem with safe sandboxing. npx @example/fs-mcp. Early stage, 45 stars.",
      source: "twitter",
      engagement: 45,
      externalUrl: "https://github.com/example/fs-mcp",
    },
  },
];

async function main() {
  if (!isJudgeAvailable()) {
    console.error("NOUS_API_KEY not set — cannot run LLM judge test.");
    process.exit(1);
  }

  console.log("Testing LLM judge with controlled fixtures\n");
  console.log("=".repeat(60) + "\n");

  for (const { label, input } of FIXTURES) {
    console.log(`Fixture: ${label}`);
    const verdict = await judgeContent(input);

    if (!verdict) {
      console.log("  Result: null (API error or no key)\n");
      continue;
    }

    console.log(`  Actionable: ${verdict.actionable}`);
    console.log(`  Confidence: ${verdict.confidence}`);
    if (verdict.scores) {
      const s = verdict.scores;
      console.log(`  Scores: utility=${s.utility} | download=${s.downloadability} | specific=${s.specificity} | signal=${s.signal} | novelty=${s.novelty}`);
    }
    if (!verdict.actionable && verdict.skipReason) {
      console.log(`  Skip reason: ${verdict.skipReason}`);
    }
    if (verdict.actionable) {
      console.log(`  Title: ${verdict.title}`);
      console.log(`  Install: ${verdict.installHint}`);
    }
    console.log("");
  }
}

main().catch(console.error);
