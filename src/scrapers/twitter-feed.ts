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
 * Keywords that indicate a tweet is relevant for the newsletter.
 * 
 * EDITORIAL FOCUS:
 * 1. Claude/OpenClaw skills with install instructions
 * 2. Money-making opportunities for agents (bounties, APIs, services)
 * 3. Actionable tools an agent can immediately use
 */
const RELEVANCE_KEYWORDS = [
  // HIGH PRIORITY: Skills & installation
  "skill", "clawhub", "openclaw", "install", "npm install", "pip install",
  "git clone", "npx", "setup", "tutorial", "guide", "how to",
  
  // HIGH PRIORITY: Money-making / services
  "x402", "micropayment", "pay per", "earn", "revenue", "monetize",
  "api", "endpoint", "service", "bounty", "prize", "quest", "hackathon",
  
  // Agent infrastructure
  "mcp", "skill.md", "agent", "autonomous", "claude",
  
  // Onchain (agents that transact)
  "onchain", "usdc", "base", "solana", "wallet", "transaction",
  
  // Actionable announcements
  "launch", "release", "ship", "announcing", "introducing", "now live",
];

/**
 * Keywords that indicate irrelevant content
 */
const NEGATIVE_KEYWORDS = [
  // Spam/speculation
  "price", "pump", "moon", "nft drop", "giveaway", "dm me",
  "follow for", "retweet to win", "airdrop",
  // Generic news (not actionable)
  "breaking:", "just in:", "report:", "sources say",
  // Entertainment
  "game", "movie", "tv show", "sports",
];

interface RawTweet {
  handle: string;
  content: string;
  likes: number;
  retweets: number;
  replies: number;
  url: string;
  time: string;
  // Source credibility signals
  followerCount?: number;
  isVerified?: boolean;
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

/**
 * Score a tweet for inclusion in the newsletter.
 * 
 * QUALITY-FIRST SCORING:
 * - Keyword matching is just the FIRST filter
 * - Must also show evidence of real traction or genuine novelty
 * - Source credibility matters
 * - Engagement ratio (relative to account size) matters more than raw numbers
 */
function scoretweet(tweet: RawTweet): ScoredTweet {
  const content = tweet.content.toLowerCase();
  let score = 0;
  const matchedKeywords: string[] = [];

  // HIGH-VALUE keywords (+15 per match) - actionable/install-ready
  const highValueKeywords = [
    "npm install", "pip install", "git clone", "npx", "cargo install",
    "skill.md", "clawhub", "openclaw", "x402", "mcp server"
  ];
  for (const keyword of highValueKeywords) {
    if (content.includes(keyword)) {
      score += 15;
      matchedKeywords.push(keyword);
    }
  }

  // MEDIUM-VALUE keywords (+8 per match) - relevant topics
  const mediumValueKeywords = [
    "agent", "claude", "mcp", "bounty", "hackathon", "launch", "release",
    "api", "sdk", "framework", "tool"
  ];
  for (const keyword of mediumValueKeywords) {
    if (content.includes(keyword) && matchedKeywords.length < 5) {
      score += 8;
      matchedKeywords.push(keyword);
    }
  }

  // LOW-VALUE keywords (+3) - general AI/dev terms (easy to match, less signal)
  const lowValueKeywords = ["ai", "llm", "automate", "workflow"];
  for (const keyword of lowValueKeywords) {
    if (content.includes(keyword) && matchedKeywords.length < 5) {
      score += 3;
      matchedKeywords.push(keyword);
    }
  }

  // NEGATIVE keywords (-40 per match) - spam/noise signals
  for (const neg of NEGATIVE_KEYWORDS) {
    if (content.includes(neg.toLowerCase())) {
      score -= 40;
    }
  }

  // Additional negative patterns
  const extraNegative = [
    "gm", "wagmi", "wen", "ser", "fren", // crypto spam
    "thread 🧵", "a thread", "1/", // threads are usually fluff
    "hot take", "unpopular opinion", // opinion pieces
    "hiring", "we're looking for", // job posts
  ];
  for (const neg of extraNegative) {
    if (content.includes(neg)) {
      score -= 20;
    }
  }

  // ENGAGEMENT SCORING - prefer high engagement relative to account baseline
  const engagement = tweet.likes + tweet.retweets * 2 + tweet.replies;
  const handle = tweet.handle.replace("@", "").toLowerCase();
  
  // Priority accounts get baseline credibility
  const priorityTier1 = ["openclaw", "clawnewsio", "anthropic", "coinbasedev"];
  const priorityTier2 = ["steipete", "langchainai", "openrouterai", "solana_devs"];
  
  if (priorityTier1.includes(handle)) {
    score += 25; // High credibility source
  } else if (priorityTier2.includes(handle)) {
    score += 15; // Known developer/researcher
  }

  // Engagement thresholds (higher bar for quality)
  if (engagement > 50) score += 5;
  if (engagement > 200) score += 10;
  if (engagement > 500) score += 10;
  if (engagement > 1000) score += 15;
  if (engagement > 5000) score += 20;

  // ACTIONABILITY BONUS - contains link to repo/docs
  if (content.includes("github.com")) {
    score += 15; // Direct repo link
  } else if (content.includes("http") || content.includes(".com") || content.includes(".ai")) {
    score += 5; // Some link
  }

  // Contains install command = highly actionable
  if (content.includes("```") || content.includes("npm i") || content.includes("pip install")) {
    score += 20;
  }

  // RECENCY CHECK - penalize if linking to old content
  // (Can't fully detect here, but the curation layer will check repo dates)

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
