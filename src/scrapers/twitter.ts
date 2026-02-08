import type { TwitterBuzz } from "../types";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";

const SEARCH_QUERIES = [
  "openclaw",
  '"open claw"',
  "openclaw skills",
  "clawhub",
  "#openclaw",
];

// Paths for persistent state
const DATA_DIR = join(process.cwd(), ".morning-stew");
const COOKIES_PATH = join(DATA_DIR, "twitter-cookies.json");
const SEEN_TWEETS_PATH = join(DATA_DIR, "seen-tweets.json");

export interface TwitterScraperConfig {
  maxResults?: number;
  minEngagement?: number;
  headless?: boolean;
  slowMode?: boolean; // Add random delays
}

interface TweetData {
  id: string;
  author: string;
  handle: string;
  content: string;
  url: string;
  likes: number;
  retweets: number;
  timestamp: string;
}

/**
 * Scrape Twitter/X with persistent session and anti-detection measures.
 * 
 * Strategy:
 * 1. Use saved cookies to maintain logged-in session
 * 2. Realistic viewport and user agent
 * 3. Random delays between actions
 * 4. Diff against previously seen tweet IDs
 * 5. Alert on auth failures
 */
export async function scrapeTwitter(
  config: TwitterScraperConfig = {}
): Promise<TwitterBuzz[]> {
  const { maxResults = 15, minEngagement = 3, headless = true, slowMode = true } = config;

  ensureDataDir();

  console.log(`[twitter] Starting scrape (headless=${headless}, slowMode=${slowMode})`);

  let browser: Browser | null = null;
  let context: BrowserContext | null = null;

  try {
    browser = await chromium.launch({ 
      headless,
      args: [
        "--disable-blink-features=AutomationControlled",
        "--no-sandbox",
      ],
    });

    // Create context with realistic settings
    context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      locale: "en-US",
      timezoneId: "America/Los_Angeles",
    });

    // Load saved cookies if they exist
    const cookiesLoaded = await loadCookies(context);
    if (!cookiesLoaded) {
      console.log(`[twitter] No saved session. Run 'pnpm run twitter:auth' to log in.`);
      return [];
    }

    const page = await context.newPage();

    // Check if session is still valid
    const isLoggedIn = await checkLoginStatus(page);
    if (!isLoggedIn) {
      console.error(`[twitter] Session expired. Run 'pnpm run twitter:auth' to re-authenticate.`);
      await alertAuthFailure();
      return [];
    }

    console.log(`[twitter] Session valid, starting searches...`);

    const allTweets: TweetData[] = [];
    const seenIds = loadSeenTweets();

    // Search each query with delays
    for (const query of SEARCH_QUERIES) {
      if (slowMode) await randomDelay(3000, 8000);
      
      const tweets = await searchTwitter(page, query, slowMode);
      allTweets.push(...tweets);
      
      console.log(`[twitter] "${query}" → ${tweets.length} tweets`);
    }

    // Dedupe and filter new tweets
    const uniqueTweets = dedupeByUrl(allTweets);
    const newTweets = uniqueTweets.filter((t) => !seenIds.has(t.id));

    console.log(`[twitter] Found ${newTweets.length} new tweets (${uniqueTweets.length - newTweets.length} already seen)`);

    // Update seen tweets
    newTweets.forEach((t) => seenIds.add(t.id));
    saveSeenTweets(seenIds);

    // Save updated cookies
    await saveCookies(context);

    // Filter by engagement and sort
    const filtered = newTweets
      .filter((t) => t.likes + t.retweets >= minEngagement)
      .sort((a, b) => (b.likes + b.retweets) - (a.likes + a.retweets))
      .slice(0, maxResults);

    return filtered.map((t) => ({
      author: t.author,
      handle: t.handle,
      content: t.content,
      url: t.url,
      engagement: t.likes + t.retweets,
    }));

  } catch (error) {
    console.error(`[twitter] Scrape error:`, error);
    await alertScrapeFailure(error);
    return [];
  } finally {
    if (context) await context.close();
    if (browser) await browser.close();
  }
}

async function searchTwitter(page: Page, query: string, slowMode: boolean): Promise<TweetData[]> {
  const searchUrl = `https://x.com/search?q=${encodeURIComponent(query)}&src=typed_query&f=live`;

  try {
    await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 30000 });

    if (slowMode) await randomDelay(2000, 4000);

    // Wait for tweets to load
    await page.waitForSelector('article[data-testid="tweet"]', { timeout: 15000 }).catch(() => {});

    // Scroll to load more
    if (slowMode) {
      await page.mouse.wheel(0, 800);
      await randomDelay(1500, 3000);
      await page.mouse.wheel(0, 600);
      await randomDelay(1000, 2000);
    }

    // Extract tweet data - use string eval to avoid esbuild __name decorator issues
    const tweets: TweetData[] = await page.evaluate(`
      (function() {
        function parseCount(text) {
          if (!text) return 0;
          var num = text.replace(/,/g, "").trim();
          if (num.endsWith("K")) return Math.floor(parseFloat(num) * 1000);
          if (num.endsWith("M")) return Math.floor(parseFloat(num) * 1000000);
          return parseInt(num) || 0;
        }
        
        var articles = Array.from(document.querySelectorAll('article[data-testid="tweet"]'));
        return articles.slice(0, 25).map(function(article) {
          var authorEl = article.querySelector('[data-testid="User-Name"] > div:first-child span');
          var handleEl = article.querySelector('[data-testid="User-Name"] a[href^="/"]');
          var contentEl = article.querySelector('[data-testid="tweetText"]');
          var linkEl = article.querySelector('a[href*="/status/"]');
          var timeEl = article.querySelector('time');
          var likeEl = article.querySelector('[data-testid="like"] span');
          var retweetEl = article.querySelector('[data-testid="retweet"] span');
          
          var statusUrl = linkEl ? linkEl.getAttribute("href") : "";
          var tweetIdMatch = statusUrl.match(/status\\/(\\d+)/);
          var tweetId = tweetIdMatch ? tweetIdMatch[1] : "";
          
          return {
            id: tweetId,
            author: authorEl ? authorEl.textContent.trim() : "Unknown",
            handle: handleEl ? handleEl.getAttribute("href").replace("/", "@") : "@unknown",
            content: contentEl ? contentEl.textContent.trim() : "",
            url: tweetId ? "https://x.com" + statusUrl : "",
            likes: parseCount(likeEl ? likeEl.textContent : "0"),
            retweets: parseCount(retweetEl ? retweetEl.textContent : "0"),
            timestamp: timeEl ? timeEl.getAttribute("datetime") : new Date().toISOString()
          };
        });
      })()
    `);

    return tweets.filter((t) => t.id && t.content);
  } catch (error) {
    console.log(`[twitter] Search error for "${query}":`, error);
    return [];
  }
}

async function checkLoginStatus(page: Page): Promise<boolean> {
  try {
    await page.goto("https://x.com/home", { waitUntil: "domcontentloaded", timeout: 20000 });
    await randomDelay(2000, 3000);

    // Check for login indicators
    const isLoggedIn = await page.evaluate(() => {
      // If we see the compose tweet button or nav, we're logged in
      return !!(
        document.querySelector('[data-testid="SideNav_NewTweet_Button"]') ||
        document.querySelector('[data-testid="primaryColumn"]') ||
        document.querySelector('[aria-label="Home timeline"]')
      );
    });

    return isLoggedIn;
  } catch {
    return false;
  }
}

// --- Cookie Management ---

async function loadCookies(context: BrowserContext): Promise<boolean> {
  if (!existsSync(COOKIES_PATH)) {
    return false;
  }

  try {
    const cookies = JSON.parse(readFileSync(COOKIES_PATH, "utf-8"));
    await context.addCookies(cookies);
    console.log(`[twitter] Loaded ${cookies.length} cookies`);
    return true;
  } catch (error) {
    console.error(`[twitter] Failed to load cookies:`, error);
    return false;
  }
}

async function saveCookies(context: BrowserContext): Promise<void> {
  try {
    const cookies = await context.cookies();
    writeFileSync(COOKIES_PATH, JSON.stringify(cookies, null, 2));
    console.log(`[twitter] Saved ${cookies.length} cookies`);
  } catch (error) {
    console.error(`[twitter] Failed to save cookies:`, error);
  }
}

// --- Seen Tweets Tracking ---

function loadSeenTweets(): Set<string> {
  if (!existsSync(SEEN_TWEETS_PATH)) {
    return new Set();
  }

  try {
    const data = JSON.parse(readFileSync(SEEN_TWEETS_PATH, "utf-8"));
    // Keep only last 7 days of tweet IDs to prevent unbounded growth
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const recent = data.filter((entry: { id: string; seen: number }) => entry.seen > cutoff);
    return new Set(recent.map((e: { id: string }) => e.id));
  } catch {
    return new Set();
  }
}

function saveSeenTweets(ids: Set<string>): void {
  const now = Date.now();
  const data = Array.from(ids).map((id) => ({ id, seen: now }));
  writeFileSync(SEEN_TWEETS_PATH, JSON.stringify(data, null, 2));
}

// --- Utilities ---

function ensureDataDir(): void {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
}

function randomDelay(min: number, max: number): Promise<void> {
  const delay = Math.floor(Math.random() * (max - min) + min);
  return new Promise((resolve) => setTimeout(resolve, delay));
}

function dedupeByUrl(tweets: TweetData[]): TweetData[] {
  return Array.from(new Map(tweets.map((t) => [t.id, t])).values());
}

// --- Alerting ---

async function alertAuthFailure(): Promise<void> {
  console.error(`
╔════════════════════════════════════════════════════════════╗
║  🚨 TWITTER AUTH FAILURE                                    ║
║                                                              ║
║  Session expired or cookies invalid.                        ║
║  Run: pnpm run twitter:auth                                 ║
╚════════════════════════════════════════════════════════════╝
`);
  // TODO: Send to Discord/Slack webhook
}

async function alertScrapeFailure(error: unknown): Promise<void> {
  console.error(`[twitter] Scrape failure alert:`, error);
  // TODO: Send to Discord/Slack webhook
}

export { SEARCH_QUERIES };
