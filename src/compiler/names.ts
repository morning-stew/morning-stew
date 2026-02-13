/**
 * Generate newsletter IDs and names.
 * Simple numbered format: Issue #0, #1, #2...
 */

import { existsSync, readdirSync } from "fs";
import { join } from "path";

/**
 * Get the next issue number by counting existing issues.
 */
function getNextIssueNumber(): number {
  const issuesDir = join(process.cwd(), ".morning-stew", "issues");
  
  if (!existsSync(issuesDir)) return 0;
  
  try {
    const files = readdirSync(issuesDir).filter(f => f.endsWith(".json") && !f.includes(".full."));
    return files.length;
  } catch {
    return 0;
  }
}

/**
 * Generate newsletter ID in format MS-#N (e.g., MS-#0, MS-#1)
 */
export function generateId(_date: Date): string {
  const issueNumber = getNextIssueNumber();
  return `MS-#${issueNumber}`;
}

/**
 * Generate newsletter name: "Issue #N"
 */
export function generateName(_date: Date): string {
  const issueNumber = getNextIssueNumber();
  return `Issue #${issueNumber}`;
}
