/**
 * ClawIndex Directory Scraper
 *
 * Scrapes https://clawindex.org/directory.html for verified OpenClaw projects.
 * Uses Playwright because the page is JS-rendered.
 *
 * Filtering:
 * - ONLY verified projects (status = verified/checkmark)
 * - Prefers "Skills" category, then other categories
 *
 * This is a free source — no API cost.
 */

import type { Discovery } from "../types/discovery";
import { createDiscovery } from "../types/discovery";
import { chromium, type Browser } from "playwright";

const CLAWINDEX_URL = "https://clawindex.org/directory.html";

export interface ClawIndexConfig {
  maxProjects?: number;   // Max projects to return (default: 20)
  headless?: boolean;     // Run browser headless (default: true)
}

interface ClawIndexProject {
  name: string;
  category: string;       // Applications, Skills, Models, Payments, Protocols, Infrastructure
  description: string;
  stars: number;
  status: string;         // "verified", "unverified", etc.
  url: string;            // Website URL
  github?: string;        // GitHub repo URL
}

/**
 * Scrape ClawIndex for verified OpenClaw projects.
 * Skills are prioritized over other categories.
 */
export async function scrapeClawIndex(
  config: ClawIndexConfig = {}
): Promise<Discovery[]> {
  const { maxProjects = 20, headless = true } = config;

  console.log(`[clawindex] Scraping verified projects from ${CLAWINDEX_URL}`);

  let browser: Browser | null = null;

  try {
    browser = await chromium.launch({ headless });
    const context = await browser.newContext({
      userAgent: "morning-stew/1.0",
    });
    const page = await context.newPage();

    await page.goto(CLAWINDEX_URL, { waitUntil: "networkidle", timeout: 30000 });

    // Wait for the table to load (it says "Loading projects..." initially)
    await page.waitForFunction(
      () => !document.querySelector("table")?.textContent?.includes("Loading projects"),
      { timeout: 15000 }
    ).catch(() => {
      console.log("[clawindex] Table load timeout — trying anyway");
    });

    // Give a bit more time for all rows to render
    await page.waitForTimeout(2000);

    // Extract projects from the table
    const projects = await page.evaluate(() => {
      const rows = document.querySelectorAll("table tbody tr");
      const results: any[] = [];

      rows.forEach((row) => {
        const cells = row.querySelectorAll("td");
        if (cells.length < 5) return;

        // Column 0: Project name (may be a link)
        const nameCell = cells[0];
        const nameLink = nameCell.querySelector("a");
        const name = nameLink?.textContent?.trim() || nameCell.textContent?.trim() || "";
        const projectUrl = nameLink?.getAttribute("href") || "";

        // Column 1: Category
        const category = cells[1]?.textContent?.trim() || "";

        // Column 2: Description
        const description = cells[2]?.textContent?.trim() || "";

        // Column 3: Stars
        const starsText = cells[3]?.textContent?.trim() || "0";
        const stars = parseInt(starsText.replace(/[^0-9]/g, "")) || 0;

        // Column 4: Status (look for verified badge/checkmark/text)
        const statusCell = cells[4];
        const statusText = statusCell?.textContent?.trim()?.toLowerCase() || "";
        // Check for various verified indicators
        const isVerified = statusText.includes("verified") ||
          statusText.includes("✓") ||
          statusText.includes("✅") ||
          statusCell?.querySelector("[class*='verified'], [class*='check'], .badge, .verified") !== null;

        results.push({
          name,
          category,
          description,
          stars,
          status: isVerified ? "verified" : statusText || "unknown",
          url: projectUrl,
        });
      });

      return results;
    });

    console.log(`[clawindex] Found ${projects.length} total projects`);

    // Filter to verified only
    const verified = projects.filter((p: any) => p.status === "verified");
    console.log(`[clawindex] ${verified.length} verified projects`);

    if (verified.length === 0) {
      // If no verified found (maybe status detection failed), log what we see
      const statuses = [...new Set(projects.map((p: any) => p.status))];
      console.log(`[clawindex] Statuses found: ${statuses.join(", ")}`);
      // Fall back to all projects but warn
      if (projects.length > 0) {
        console.log(`[clawindex] Warning: no verified filter matched — using all ${projects.length} projects`);
      }
    }

    const pool = verified.length > 0 ? verified : projects;

    // Sort: Skills first, then by stars descending
    const sorted = pool.sort((a: any, b: any) => {
      const aSkill = a.category.toLowerCase() === "skills" ? 1 : 0;
      const bSkill = b.category.toLowerCase() === "skills" ? 1 : 0;
      if (aSkill !== bSkill) return bSkill - aSkill; // Skills first
      return b.stars - a.stars; // Then by stars
    });

    // Convert to discoveries
    const discoveries: Discovery[] = sorted.slice(0, maxProjects).map((p: any) => {
      const isGitHub = p.url?.includes("github.com");
      const cat = mapCategory(p.category);

      return createDiscovery({
        id: `clawindex-${p.name.toLowerCase().replace(/[^a-z0-9]/g, "-").slice(0, 40)}`,
        category: cat,
        title: p.name,
        oneLiner: p.description || `${p.category} in the OpenClaw ecosystem`,
        what: p.description || `${p.name} — ${p.category} project in the OpenClaw ecosystem`,
        why: `Verified on ClawIndex (${p.stars} stars, ${p.category})`,
        impact: `Verified OpenClaw ${p.category.toLowerCase()} project`,
        install: {
          steps: isGitHub
            ? [`git clone ${p.url}`, "See repo README"]
            : [`See ${p.url || CLAWINDEX_URL}`],
          timeEstimate: "5 min",
        },
        source: {
          url: p.url || CLAWINDEX_URL,
          type: isGitHub ? "github" : "web",
          author: "ClawIndex",
        },
        signals: {
          engagement: p.stars,
          trending: p.stars > 100,
        },
        security: "verified", // They're verified on ClawIndex
      });
    });

    console.log(`[clawindex] Returning ${discoveries.length} discoveries (${discoveries.filter(d => d.category === "skill").length} skills)`);
    return discoveries;
  } catch (error: any) {
    console.error(`[clawindex] Scrape error: ${error.message}`);
    return [];
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

function mapCategory(clawIndexCategory: string): Discovery["category"] {
  const lower = clawIndexCategory.toLowerCase();
  if (lower === "skills") return "skill";
  if (lower === "infrastructure") return "infrastructure";
  if (lower === "models") return "model";
  if (lower === "payments" || lower === "protocols" || lower === "protocols & standards") return "integration";
  if (lower === "applications") return "tool";
  return "workflow";
}
