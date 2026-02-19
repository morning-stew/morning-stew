#!/usr/bin/env tsx
/**
 * Integration test for quality scoring.
 * GITHUB_TOKEN optional (one fixture uses a GitHub source).
 *
 * Usage: npm run quality:test
 */

import { scoreDiscovery, generateValueProp, generateTags } from "../curation/quality";
import { createDiscovery } from "../types/discovery";

const FIXTURES = [
  createDiscovery({
    id: "fixture-1",
    category: "tool",
    title: "agent-sandbox",
    oneLiner: "An open source MCP server that sandboxes code execution for Claude agents",
    what: "A Node.js MCP server wrapping E2B sandboxes so Claude can run untrusted code safely",
    why: "Eliminates the risk of running agent-generated code on the host machine",
    impact: "Secure, reproducible code execution in 3 lines of config",
    install: { steps: ["npm install @agent/sandbox", "npx @agent/sandbox start"] },
    source: { url: "https://example.com/agent-sandbox", type: "hackernews" },
    signals: { engagement: 850, comments: 60 },
  }),
  createDiscovery({
    id: "fixture-2",
    category: "integration",
    title: "github-mcp-server",
    oneLiner: "MCP server exposing GitHub API to Claude — search repos, read files, create PRs",
    what: "Wraps the GitHub REST API as an MCP tool suite",
    why: "Lets Claude agents operate on GitHub without custom plumbing",
    impact: "Full GitHub access for agents in under a minute",
    install: { steps: ["git clone https://github.com/example/github-mcp", "npm install && npm start"] },
    source: { url: "https://github.com/example/github-mcp", type: "github" },
    signals: { engagement: 320 },
  }),
];

async function main() {
  const hasToken = !!process.env.GITHUB_TOKEN;
  console.log(`Quality scoring test (GITHUB_TOKEN: ${hasToken ? "yes" : "no"})\n`);
  console.log("=".repeat(60) + "\n");

  for (const discovery of FIXTURES) {
    console.log(`Fixture: ${discovery.title}`);
    console.log(`Source type: ${discovery.source.type}`);

    const score = await scoreDiscovery(discovery);
    const valueProp = generateValueProp(discovery);
    const tags = generateTags(discovery);

    console.log(`\nScore breakdown:`);
    console.log(`  total:       ${score.total}`);
    console.log(`  novelValue:  ${score.novelValue}`);
    console.log(`  realUsage:   ${score.realUsage}`);
    console.log(`  install:     ${score.installProcess}`);
    console.log(`  docs:        ${score.documentation}`);
    console.log(`  utility:     ${score.genuineUtility}`);
    console.log(`\nReasons: ${score.reasons.join(" | ")}`);
    console.log(`\nValue prop: ${valueProp}`);
    console.log(`Tags: ${tags.join(", ")}`);
    console.log("\n" + "=".repeat(60) + "\n");
  }
}

main().catch(console.error);
