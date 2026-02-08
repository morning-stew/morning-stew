import type { Discovery } from "../types/discovery";
import { createDiscovery } from "../types/discovery";
import { chromium, type BrowserContext, type Page } from "playwright";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

const DATA_DIR = join(process.cwd(), ".morning-stew");
const COOKIES_PATH = join(DATA_DIR, "twitter-cookies.json");

/**
 * Priority accounts to scrape - curated for agent/OpenClaw content
 */
const PRIORITY_ACCOUNTS = [
  "openclaw",
  "ClawNewsIO", 
  "zacxbt",
  "yq_acc",
  "rish_neynar",
  "unusual_whales",
  "AlliumLabs",
  "KimiProduct",
  "0xEricBrown",
  "solana_devs",
  "steipete",
  "CoinbaseDev",
  "anthropic",
  "OpenRouterAI",
  "MurrLincoln",
  "LangChainAI",
];

/**
 * Keywords that indicate a tweet is relevant for the newsletter
 */
const RELEVANCE_KEYWORDS = [
  // Core
  "openclaw", "clawhub", "x402", "skill.md", "mcp",
  // Agent terms
  "agent", "autonomous", "agentic", "workflow",
  // Crypto/onchain
  "onchain", "usdc", "base", "solana", "wallet",
  // Tools
  "claude", "gpt", "llm", "api", "sdk",
  // Actions
  "launch", "release", "ship", "announce", "introducing",
  // Opportunities
  "bounty", "prize", "quest", "hackathon", "grant",
];

/**
 * Keywords that indicate irrelevant content
 */
const NEGATIVE_KEYWORDS = [
  "price", "pump", "moon", "nft drop", "giveaway", "dm me",
  "follow for", "retweet to win",
];

interface RawTweet {
  handle: string;
  content: string;
  likes: number;
  retweets: number;
  replies: number;
  url: string;
  time: string;
}

interface ScoredTweet extends RawTweet {
  relevanceScore: number;
  matchedKeywords: string[];
}

export interface TwitterFeedConfig {
  maxPerAccount?: number;
  hoursAgo?: number;
  minRelevanceScore?: number;
  headless?: boolean;
}

/**
 * Scrape curated Twitter feed from priority accounts.
 * 
 * Strategy:
 * 1. Fetch recent tweets from each priority account
 * 2. Score each tweet for relevance using keywords + engagement
 * 3. Return top discoveries sorted by score
 */
export async function scrapeTwitterFeed(
  config: TwitterFeedConfig = {}
): Promise<Discovery[]> {
  const { 
    maxPerAccount = 5, 
    hoursAgo = 72,
    minRelevanceScore = 30,
    headless = true,
  } = config;

  console.log(`[twitter-feed] Starting curated feed scrape...`);

  if (!existsSync(COOKIES_PATH)) {
    console.log(`[twitter-feed] No cookies found. Run 'pnpm twitter:auth' first.`);
    return [];
  }

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
    const allTweets: ScoredTweet[] = [];
    const cutoffTime = Date.now() - hoursAgo * 60 * 60 * 1000;

    for (const account of PRIORITY_ACCOUNTS) {
      try {
        const tweets = await scrapeAccountTweets(page, account, maxPerAccount);
        
        // Filter by time and score
        const scored = tweets
          .filter(t => new Date(t.time).getTime() > cutoffTime)
          .map(t => scoretweet(t));
        
        const relevant = scored.filter(t => t.relevanceScore >= minRelevanceScore);
        allTweets.push(...relevant);
        
        console.log(`[twitter-feed] @${account}: ${tweets.length} tweets, ${relevant.length} relevant`);
        
        // Rate limit
        await randomDelay(2000, 4000);
      } catch (error) {
        console.log(`[twitter-feed] Error scraping @${account}:`, error);
      }
    }

    // Save cookies
    const newCookies = await context.cookies();
    writeFileSync(COOKIES_PATH, JSON.stringify(newCookies, null, 2));

    // Sort by relevance and convert to discoveries
    const sorted = allTweets
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .slice(0, 20);

    console.log(`[twitter-feed] Total: ${sorted.length} relevant tweets`);

    return sorted.map(tweetToDiscovery);

  } finally {
    await context.close();
    await browser.close();
  }
}

async function scrapeAccountTweets(
  page: Page, 
  handle: string, 
  max: number
): Promise<RawTweet[]> {
  await page.goto(`https://x.com/${handle}`, { 
    waitUntil: "domcontentloaded", 
    timeout: 20000 
  });
  await randomDelay(2000, 3000);

  // Scroll to load more
  await page.mouse.wheel(0, 600);
  await randomDelay(1000, 2000);

  const tweets: RawTweet[] = await page.evaluate(`
    (function() {
      function parseCount(text) {
        if (!text) return 0;
        var num = text.replace(/,/g, '').trim();
        if (num.endsWith('K')) return Math.floor(parseFloat(num) * 1000);
        if (num.endsWith('M')) return Math.floor(parseFloat(num) * 1000000);
        return parseInt(num) || 0;
      }
      
      var articles = Array.from(document.querySelectorAll('article[data-testid="tweet"]'));
      return articles.slice(0, ${max}).map(function(article) {
        var handleEl = article.querySelector('[data-testid="User-Name"] a[href^="/"]');
        var contentEl = article.querySelector('[data-testid="tweetText"]');
        var likeEl = article.querySelector('[data-testid="like"] span');
        var retweetEl = article.querySelector('[data-testid="retweet"] span');
        var replyEl = article.querySelector('[data-testid="reply"] span');
        var linkEl = article.querySelector('a[href*="/status/"]');
        var timeEl = article.querySelector('time');
        
        return {
          handle: handleEl ? handleEl.getAttribute('href').replace('/', '@') : '@unknown',
          content: contentEl ? contentEl.textContent : '',
          likes: parseCount(likeEl ? likeEl.textContent : '0'),
          retweets: parseCount(retweetEl ? retweetEl.textContent : '0'),
          replies: parseCount(replyEl ? replyEl.textContent : '0'),
          url: linkEl ? 'https://x.com' + linkEl.getAttribute('href') : '',
          time: timeEl ? timeEl.getAttribute('datetime') : new Date().toISOString()
        };
      });
    })()
  `);

  return tweets.filter(t => t.content && t.url);
}

function scoretweet(tweet: RawTweet): ScoredTweet {
  const content = tweet.content.toLowerCase();
  let score = 0;
  const matchedKeywords: string[] = [];

  // Keyword matching (+10 per keyword, max 50)
  for (const keyword of RELEVANCE_KEYWORDS) {
    if (content.includes(keyword.toLowerCase())) {
      score += 10;
      matchedKeywords.push(keyword);
      if (matchedKeywords.length >= 5) break;
    }
  }

  // Negative keywords (-30 per match)
  for (const neg of NEGATIVE_KEYWORDS) {
    if (content.includes(neg.toLowerCase())) {
      score -= 30;
    }
  }

  // Engagement bonus (log scale)
  const engagement = tweet.likes + tweet.retweets * 2 + tweet.replies;
  if (engagement > 100) score += 10;
  if (engagement > 500) score += 10;
  if (engagement > 1000) score += 10;
  if (engagement > 5000) score += 10;

  // Priority account bonus
  const handle = tweet.handle.replace("@", "").toLowerCase();
  if (["openclaw", "clawnewsio", "steipete"].includes(handle)) {
    score += 20;
  }

  // Contains link bonus (actionable)
  if (content.includes("http") || content.includes(".com") || content.includes(".ai")) {
    score += 5;
  }

  return {
    ...tweet,
    relevanceScore: Math.max(0, score),
    matchedKeywords,
  };
}

function tweetToDiscovery(tweet: ScoredTweet): Discovery {
  // Determine category from keywords
  let category: Discovery["category"] = "workflow";
  const content = tweet.content.toLowerCase();
  
  if (content.includes("release") || content.includes("launch") || content.includes("v2")) {
    category = "tool";
  } else if (content.includes("bounty") || content.includes("prize") || content.includes("quest")) {
    category = "workflow"; // opportunity
  } else if (content.includes("mcp") || content.includes("api") || content.includes("sdk")) {
    category = "integration";
  } else if (content.includes("security") || content.includes("sandbox")) {
    category = "security";
  }

  // Extract any URLs from content
  const urlMatch = tweet.content.match(/https?:\/\/[^\s]+/);
  const externalUrl = urlMatch ? urlMatch[0] : tweet.url;

  return createDiscovery({
    id: `tw-${tweet.url.split("/status/")[1] || Date.now()}`,
    category,
    title: tweet.content.slice(0, 80) + (tweet.content.length > 80 ? "..." : ""),
    oneLiner: tweet.content.slice(0, 120),
    what: tweet.content,
    why: `${tweet.matchedKeywords.join(", ")} (${tweet.likes} likes)`,
    impact: `Shared by ${tweet.handle}`,
    install: {
      steps: externalUrl !== tweet.url 
        ? [`# See ${externalUrl}`] 
        : [`# See ${tweet.url}`],
      timeEstimate: "2 min",
    },
    source: {
      url: tweet.url,
      type: "twitter",
      author: tweet.handle.replace("@", ""),
      date: tweet.time,
    },
    signals: {
      engagement: tweet.likes + tweet.retweets,
      trending: tweet.likes > 1000,
    },
  });
}

function randomDelay(min: number, max: number): Promise<void> {
  const delay = Math.floor(Math.random() * (max - min) + min);
  return new Promise(resolve => setTimeout(resolve, delay));
}

export { PRIORITY_ACCOUNTS, RELEVANCE_KEYWORDS };
