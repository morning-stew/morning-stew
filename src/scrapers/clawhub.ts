import type { Skill } from "../types";
import { chromium, type Browser } from "playwright";

const CLAWHUB_URL = "https://clawhub.ai/skills";

export interface ClawHubScraperConfig {
  limit?: number;
  headless?: boolean;
}

/**
 * Scrape ClawHub for skills using headless browser.
 * 
 * Skills are displayed as cards with concatenated text like:
 * "Project Scaffolder/project-scaffolderScaffold new projects from templates...⤓ 0⤒ 0★ 01 v"
 */
export async function scrapeClawHub(
  config: ClawHubScraperConfig = {}
): Promise<Skill[]> {
  const { limit = 20, headless = true } = config;

  console.log(`[clawhub] Scraping skills from ${CLAWHUB_URL}`);

  let browser: Browser | null = null;

  try {
    browser = await chromium.launch({ headless });
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto(CLAWHUB_URL, { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForTimeout(3000);

    // Extract skills from links
    const skills = await page.$$eval('a[href]', (links) => {
      const skillPattern = /^\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+$/;
      
      return links
        .filter((link) => {
          const href = link.getAttribute("href") || "";
          // Match pattern like /username/skillname (but not nav links)
          return skillPattern.test(href) && 
                 !href.includes("focus=") &&
                 href !== "/skills" &&
                 href !== "/upload" &&
                 href !== "/import";
        })
        .map((link) => {
          const href = link.getAttribute("href") || "";
          const text = link.textContent || "";
          
          // Parse concatenated text: "Display Name/slugDescription text⤓ X⤒ Y★ Z N v"
          // The pattern is: DisplayName/slug then description then metrics
          
          // Find the slug by looking for the / that separates display name from slug
          const slashMatch = text.match(/^([^/]+)\/([a-z0-9-]+)/i);
          const displayName = slashMatch ? slashMatch[1].trim() : "Unknown";
          const slug = slashMatch ? slashMatch[2] : "";
          
          // Everything after the slug until the metrics is the description
          const afterSlug = slashMatch ? text.slice(slashMatch[0].length) : text;
          
          // Find where metrics start (⤓ or ★)
          const metricsStart = afterSlug.search(/⤓|★/);
          const description = metricsStart > 0 
            ? afterSlug.slice(0, metricsStart).trim()
            : afterSlug.slice(0, 100).trim();
          
          // Parse metrics
          const downloadMatch = text.match(/⤓\s*(\d+)/);
          const starsMatch = text.match(/★\s*(\d+)/);
          const downloads = downloadMatch ? parseInt(downloadMatch[1]) : 0;
          const stars = starsMatch ? parseInt(starsMatch[1]) : 0;

          // Extract author from URL: /author/skillname
          const urlParts = href.split("/").filter(Boolean);
          const author = urlParts[0] || "unknown";

          return {
            name: displayName,
            slug,
            description,
            author,
            url: `https://clawhub.ai${href}`,
            stars,
            downloads,
          };
        });
    });

    // Filter valid skills
    const validSkills = skills
      .filter((s) => 
        s.name && 
        s.name !== "Unknown" &&
        s.name.length > 1 &&
        s.description.length > 5
      )
      .slice(0, limit);

    console.log(`[clawhub] Found ${validSkills.length} skills`);

    return validSkills.map((s) => ({
      name: s.name,
      description: s.description,
      author: s.author,
      url: s.url,
      stars: s.stars,
      added: new Date().toISOString().split("T")[0],
      securityStatus: "pending" as const,
    }));
  } catch (error) {
    console.error(`[clawhub] Scrape error:`, error);
    return [];
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

/**
 * Get skill details by URL.
 */
export async function getSkillDetails(skillUrl: string): Promise<Skill | null> {
  console.log(`[clawhub] Fetching details for: ${skillUrl}`);
  return null;
}
