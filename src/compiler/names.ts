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
  const dataDir = process.env.DATA_DIR || join(process.cwd(), ".morning-stew");
  const issuesDir = join(dataDir, "issues");
  
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
 * Generate newsletter name: "Issue #N (Feb 22, 2026)"
 */
export function generateName(date: Date): string {
  const issueNumber = getNextIssueNumber();
  const dateStr = date.toLocaleDateString("en-US", { 
    month: "short", 
    day: "numeric", 
    year: "numeric" 
  });
  return `Issue #${issueNumber} (${dateStr})`;
}
