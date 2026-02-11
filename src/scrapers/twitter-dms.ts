import type { Discovery } from "../types/discovery";
import { createDiscovery } from "../types/discovery";
import { chromium } from "playwright";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

const DATA_DIR = join(process.cwd(), ".morning-stew");
const COOKIES_PATH = join(DATA_DIR, "twitter-cookies.json");
const SEEN_DMS_PATH = join(DATA_DIR, "seen-dms.json");

/**
 * Editor account - DMs from this account are treated as editorial suggestions
 */
const EDITOR_HANDLE = "aboozle";

interface DMMessage {
  id: string;
  content: string;
  timestamp: string;
  urls: string[];
}

export interface DMScraperConfig {
  headless?: boolean;
  maxMessages?: number;
}

/**
 * Load previously seen DM IDs
 */
function loadSeenDMs(): Set<string> {
  if (!existsSync(SEEN_DMS_PATH)) return new Set();
  try {
    const data = JSON.parse(readFileSync(SEEN_DMS_PATH, "utf-8"));
    return new Set(data);
  } catch {
    return new Set();
  }
}

/**
 * Save seen DM IDs
 */
function saveSeenDMs(seen: Set<string>) {
  writeFileSync(SEEN_DMS_PATH, JSON.stringify([...seen], null, 2));
}

/**
 * Scrape DMs from the editor account (@aboozle) for editorial suggestions.
 * 
 * These are high-priority items that bypass normal curation scoring.
 * The editor can DM links/tools to include in the newsletter.
 */
export async function scrapeEditorDMs(
  config: DMScraperConfig = {}
): Promise<Discovery[]> {
  const { headless = true, maxMessages = 10 } = config;

  console.log(`[editor-dms] Checking DMs from @${EDITOR_HANDLE}...`);

  if (!existsSync(COOKIES_PATH)) {
    console.log(`[editor-dms] No cookies found. Run 'pnpm twitter:auth' first.`);
    return [];
  }

  const seenDMs = loadSeenDMs();
  const discoveries: Discovery[] = [];

  const browser = await chromium.launch({
    headless,
    args: ["--disable-blink-features=AutomationControlled"],
  });

  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
  });

  try {
    const cookies = JSON.parse(readFileSync(COOKIES_PATH, "utf-8"));
    await context.addCookies(cookies);

    const page = await context.newPage();

    // Navigate to DMs
    await page.goto("https://x.com/messages", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await page.waitForTimeout(3000);

    // Look for conversation with editor
    // Click on the conversation list to find @aboozle
    const conversations = await page.$$('[data-testid="conversation"]');
    
    let editorConvoFound = false;
    for (const convo of conversations) {
      const text = await convo.textContent();
      if (text?.toLowerCase().includes(EDITOR_HANDLE.toLowerCase())) {
        await convo.click();
        editorConvoFound = true;
        await page.waitForTimeout(2000);
        break;
      }
    }

    if (!editorConvoFound) {
      // Try searching for the conversation
      const searchBox = await page.$('[data-testid="SearchBox_Search_Input"]');
      if (searchBox) {
        await searchBox.fill(EDITOR_HANDLE);
        await page.waitForTimeout(1500);
        
        // Click on result
        const result = await page.$(`[data-testid="conversation"]:has-text("${EDITOR_HANDLE}")`);
        if (result) {
          await result.click();
          editorConvoFound = true;
          await page.waitForTimeout(2000);
        }
      }
    }

    if (!editorConvoFound) {
      console.log(`[editor-dms] No conversation with @${EDITOR_HANDLE} found`);
      await browser.close();
      return [];
    }

    // Extract messages
    const messages: DMMessage[] = await page.evaluate(() => {
      const msgElements = document.querySelectorAll('[data-testid="messageEntry"]');
      const msgs: DMMessage[] = [];

      msgElements.forEach((el, i) => {
        const textEl = el.querySelector('[data-testid="tweetText"]');
        const content = textEl?.textContent || "";
        
        // Extract URLs from the message
        const links = el.querySelectorAll('a[href]');
        const urls: string[] = [];
        links.forEach(link => {
          const href = link.getAttribute("href");
          if (href && (href.includes("github.com") || href.includes("http"))) {
            urls.push(href.startsWith("http") ? href : `https://x.com${href}`);
          }
        });

        if (content || urls.length > 0) {
          msgs.push({
            id: `dm-${i}-${Date.now()}`,
            content,
            timestamp: new Date().toISOString(),
            urls,
          });
        }
      });

      return msgs.slice(-20); // Last 20 messages
    });

    console.log(`[editor-dms] Found ${messages.length} messages`);

    // Process new messages with URLs
    for (const msg of messages.slice(0, maxMessages)) {
      // Skip if already seen
      const msgHash = `${msg.content.slice(0, 50)}-${msg.urls.join(",")}`;
      if (seenDMs.has(msgHash)) continue;

      // Only process messages with URLs (suggestions)
      if (msg.urls.length === 0) continue;

      seenDMs.add(msgHash);

      // Create discovery from editor suggestion
      const primaryUrl = msg.urls[0];
      const isGitHub = primaryUrl.includes("github.com");

      const discovery = createDiscovery({
        id: `editor-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        category: isGitHub ? "tool" : "workflow",
        title: extractTitleFromUrl(primaryUrl) || msg.content.slice(0, 50),
        oneLiner: msg.content.slice(0, 120) || `Editor pick: ${primaryUrl}`,
        what: msg.content || `Suggested by @${EDITOR_HANDLE}`,
        why: `Editorial pick from @${EDITOR_HANDLE}`,
        impact: "Hand-picked by newsletter editor",
        install: {
          steps: isGitHub 
            ? [`git clone ${primaryUrl}`, "# See repo README for setup"]
            : [`# See ${primaryUrl}`],
          timeEstimate: "5 min",
        },
        source: {
          url: primaryUrl,
          type: isGitHub ? "github" : "twitter",
          author: EDITOR_HANDLE,
          date: msg.timestamp,
        },
        signals: {
          engagement: 9999, // High priority
          trending: true,
        },
        security: "unverified",
      });

      discoveries.push(discovery);
      console.log(`[editor-dms] Added editor pick: ${discovery.title}`);
    }

    // Save cookies and seen DMs
    const newCookies = await context.cookies();
    writeFileSync(COOKIES_PATH, JSON.stringify(newCookies, null, 2));
    saveSeenDMs(seenDMs);

  } catch (error) {
    console.log(`[editor-dms] Error scraping DMs:`, error);
  } finally {
    await context.close();
    await browser.close();
  }

  console.log(`[editor-dms] Total editor picks: ${discoveries.length}`);
  return discoveries;
}

/**
 * Extract a reasonable title from a URL
 */
function extractTitleFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    
    // GitHub repo
    if (parsed.hostname === "github.com") {
      const parts = parsed.pathname.split("/").filter(Boolean);
      if (parts.length >= 2) {
        return parts[1]; // repo name
      }
    }

    // Twitter/X post
    if (parsed.hostname === "x.com" || parsed.hostname === "twitter.com") {
      return null; // Let content be the title
    }

    // Other URLs - use hostname
    return parsed.hostname.replace("www.", "");
  } catch {
    return null;
  }
}

export { EDITOR_HANDLE };
