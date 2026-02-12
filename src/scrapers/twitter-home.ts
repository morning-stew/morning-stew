import type { Discovery } from "../types/discovery";
import { createDiscovery } from "../types/discovery";
import { chromium, type BrowserContext, type Page } from "playwright";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { judgeBatch, isJudgeAvailable, type JudgeInput, type JudgeVerdict } from "../curation/llm-judge";

const DATA_DIR = join(process.cwd(), ".morning-stew");
const COOKIES_PATH = join(DATA_DIR, "twitter-cookies.json");
const SEEN_HOME_PATH = join(DATA_DIR, "seen-home-tweets.json");
const FOLLOWED_PATH = join(DATA_DIR, "followed-accounts.json");

/**
 * @goodstewdaily Home Timeline Scraper
 *
 * This is the PRIMARY content source for Morning Stew.
 *
 * Strategy:
 * 1. Log in with saved cookies
 * 2. Scrape "For You" tab (algorithmic discovery — finds new accounts/content)
 * 3. Scrape "Following" tab (chronological from followed accounts)
 * 4. Score and LLM-judge all tweets
 * 5. AUTO-FOLLOW: If a good tweet came from "For You" and we're not
 *    following that account, follow them → feed improves over time
 * 6. Optionally scrape bookmarks/likes as curated signal
 */

export interface HomeTimelineConfig {
  maxTweets?: number;
  scrollCount?: number;
  minRelevanceScore?: number;
  headless?: boolean;
  includeBookmarks?: boolean;
  includeLikes?: boolean;
}

interface RawTweet {
  id: string;
  handle: string;
  displayName: string;
  content: string;
  likes: number;
  retweets: number;
  replies: number;
  url: string;
  time: string;
  externalUrls: string[];
  hasMedia: boolean;
  isRetweet: boolean;
  isReply: boolean;
}

interface ScoredTweet extends RawTweet {
  relevanceScore: number;
  matchedKeywords: string[];
  source: "home" | "bookmarks" | "likes";
  feedTab: "for_you" | "following" | "bookmarks" | "likes";
}

// ─── Keyword scoring weights ───────────────────────────────────────

const HIGH_VALUE_KEYWORDS = [
  // Install-ready content
  "npm install", "pip install", "pip3 install", "git clone", "npx",
  "cargo install", "brew install", "docker run", "pnpm add",
  // Core ecosystem
  "skill.md", "clawhub", "openclaw", "open claw", "x402",
  "mcp server", "mcp tool",
  // Direct action
  "just shipped", "just launched", "now live", "try it",
];

const MEDIUM_VALUE_KEYWORDS = [
  // Agent/AI
  "agent", "claude", "anthropic", "mcp", "llm", "gpt",
  "autonomous", "agentic", "multi-agent",
  // Dev tooling
  "api", "sdk", "framework", "cli", "tool", "library",
  "open source", "oss",
  // Opportunities
  "bounty", "hackathon", "prize", "grant",
  // Announcements
  "launch", "release", "ship", "announcing", "introducing",
  "v2", "v3", "update",
  // Payments
  "usdc", "solana", "onchain", "wallet", "payment",
];

const LOW_VALUE_KEYWORDS = [
  "ai", "automation", "workflow", "coding", "developer",
  "tech", "startup", "build",
];

const NEGATIVE_KEYWORDS = [
  // Spam/speculation
  "price prediction", "pump", "moon", "nft drop", "giveaway",
  "dm me", "follow for", "retweet to win", "airdrop claim",
  "100x", "gem alert",
  // Generic/noise
  "gm", "wagmi", "wen", "ser", "fren",
  "hot take", "unpopular opinion",
  // Recruitment
  "hiring", "we're looking for", "job opening", "apply now",
  // Threads (usually fluff, not actionable)
  "thread 🧵", "a thread", "1/",
  // NEWS — not actionable, developer can't do anything with this
  "just in:", "breaking:", "report:", "sources say",
  "launches its own", "has registered", "have registered",
  "market cap", "trading volume", "tvl", "total value locked",
  "ecosystem growth", "adoption", "milestone",
  "what's your favorite", "which is your", "what do you think",
  // Opinion/commentary (not actionable)
  "it's .* season", "the future of", "the state of",
  "here are the projects", "top projects",
];

// ─── Main scraper ──────────────────────────────────────────────────

export async function scrapeHomeTimeline(
  config: HomeTimelineConfig = {}
): Promise<Discovery[]> {
  const {
    maxTweets = 40,
    scrollCount = 4,
    minRelevanceScore = 20,
    headless = true,
    includeBookmarks = false,
    includeLikes = false,
  } = config;

  console.log(`[home-timeline] Scraping @goodstewdaily feed (headless=${headless})...`);

  if (!existsSync(COOKIES_PATH)) {
    console.log(`[home-timeline] No cookies found. Run 'npx tsx src/cli/twitter-auth.ts' first.`);
    return [];
  }

  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }

  const browser = await chromium.launch({
    headless,
    args: ["--disable-blink-features=AutomationControlled", "--no-sandbox"],
  });

  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    locale: "en-US",
    timezoneId: "America/Los_Angeles",
  });

  try {
    // Load cookies
    const cookies = JSON.parse(readFileSync(COOKIES_PATH, "utf-8"));
    await context.addCookies(cookies);

    const page = await context.newPage();

    // Verify login
    const loggedIn = await checkLogin(page);
    if (!loggedIn) {
      console.log(`[home-timeline] Session expired. Re-run twitter:auth as @goodstewdaily.`);
      return [];
    }

    console.log(`[home-timeline] Logged in. Scraping both tabs...`);

    // ── Scrape "For You" tab (algorithmic discovery) ──
    const forYouTweets = await scrapeFeedTab(page, "for_you", maxTweets, scrollCount);
    console.log(`[home-timeline] For You: ${forYouTweets.length} tweets`);

    // ── Scrape "Following" tab (chronological from followed accounts) ──
    await randomDelay(1500, 2500);
    const followingTweets = await scrapeFeedTab(page, "following", maxTweets, scrollCount);
    console.log(`[home-timeline] Following: ${followingTweets.length} tweets`);

    let allTweets = [...forYouTweets, ...followingTweets];

    // ── Optionally scrape bookmarks ──
    if (includeBookmarks) {
      await randomDelay(2000, 3000);
      const bookmarkTweets = await scrapeFeedTab(page, "bookmarks", 20, 2);
      console.log(`[home-timeline] Bookmarks: ${bookmarkTweets.length} tweets`);
      allTweets.push(...bookmarkTweets.map((t) => ({ ...t, relevanceScore: t.relevanceScore + 25 })));
    }

    // ── Optionally scrape likes ──
    if (includeLikes) {
      await randomDelay(2000, 3000);
      const likeTweets = await scrapeFeedTab(page, "likes", 20, 2);
      console.log(`[home-timeline] Likes: ${likeTweets.length} tweets`);
      allTweets.push(...likeTweets.map((t) => ({ ...t, relevanceScore: t.relevanceScore + 15 })));
    }

    // Save cookies (refreshes session)
    const newCookies = await context.cookies();
    writeFileSync(COOKIES_PATH, JSON.stringify(newCookies, null, 2));

    // Dedupe against previously seen tweets
    const seenIds = loadSeenTweets();
    const newTweets = allTweets.filter((t) => !seenIds.has(t.id));

    // Save seen tweets
    newTweets.forEach((t) => seenIds.add(t.id));
    saveSeenTweets(seenIds);

    console.log(
      `[home-timeline] ${newTweets.length} new tweets (${allTweets.length - newTweets.length} already seen)`
    );

    // ── FIRST PASS: Cheap spam filter ──
    // When LLM judge is available, we just need to kill obvious spam.
    // Let the LLM decide what's actionable — that's the whole point.
    const llmAvailable = isJudgeAvailable();

    const candidates = newTweets
      .filter((t) => {
        if (llmAvailable) {
          // Loose filter: just kill obvious spam (negative score means it hit spam keywords)
          // Also skip very short tweets and replies
          return t.relevanceScore >= 0 && t.content.length >= 20 && !t.isReply;
        }
        // Strict filter: keyword-based actionability when no LLM
        return t.relevanceScore >= minRelevanceScore;
      })
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .slice(0, 30); // Cap at 30 for LLM judging (cost control)

    console.log(`[home-timeline] ${candidates.length} tweets passed ${llmAvailable ? "spam" : "keyword"} filter`);

    // ── SECOND PASS: LLM judge ──
    // Ask the LLM: "Can a developer actually use this right now?"
    if (llmAvailable && candidates.length > 0) {
      console.log(`[home-timeline] Running LLM judge on ${candidates.length} candidates...`);

      const judgeInputs: JudgeInput[] = candidates.map((t) => ({
        content: t.content,
        source: "twitter",
        author: t.handle,
        externalUrl: t.externalUrls[0] || undefined,
        engagement: t.likes + t.retweets,
      }));

      const verdicts = await judgeBatch(judgeInputs, 5);

      // Convert LLM-judged tweets to discoveries
      const judgedDiscoveries: Discovery[] = [];

      for (let i = 0; i < candidates.length; i++) {
        const tweet = candidates[i];
        const verdict = verdicts[i];

        if (verdict && verdict.actionable && verdict.confidence >= 0.5) {
          judgedDiscoveries.push(verdictToDiscovery(tweet, verdict));
        } else if (verdict && !verdict.actionable) {
          console.log(`[home-timeline] SKIP: "${tweet.content.slice(0, 50)}..." → ${verdict.skipReason || "not actionable"}`);
        }
      }

      console.log(`[home-timeline] LLM judge: ${judgedDiscoveries.length}/${candidates.length} passed`);

      // ── AUTO-FOLLOW: Follow authors of good "For You" tweets ──
      const forYouPassed = candidates.filter((t, i) => {
        const v = verdicts[i];
        return t.feedTab === "for_you" && v && v.actionable && v.confidence >= 0.5;
      });

      if (forYouPassed.length > 0) {
        await autoFollowGoodAccounts(page, forYouPassed);
      }

      return judgedDiscoveries;
    }

    // Fallback: no LLM available, use keyword scoring only
    console.log(`[home-timeline] No LLM judge available, using keyword scoring only`);
    return candidates.map(tweetToDiscovery);
  } finally {
    await context.close();
    await browser.close();
  }
}

// ─── Feed tab scraping ─────────────────────────────────────────────

type FeedTab = "for_you" | "following" | "bookmarks" | "likes";

async function scrapeFeedTab(
  page: Page,
  tab: FeedTab,
  maxTweets: number,
  scrollCount: number,
): Promise<ScoredTweet[]> {
  // Navigate to the right page/tab
  if (tab === "bookmarks") {
    await page.goto("https://x.com/i/bookmarks", { waitUntil: "domcontentloaded", timeout: 25000 });
  } else if (tab === "likes") {
    await page.goto("https://x.com/goodstewdaily/likes", { waitUntil: "domcontentloaded", timeout: 25000 });
  } else {
    // For "for_you" and "following", we navigate to home then click the right tab
    await page.goto("https://x.com/home", { waitUntil: "domcontentloaded", timeout: 25000 });
    await randomDelay(2000, 3000);

    // Click the correct tab
    try {
      if (tab === "following") {
        // Click the "Following" tab
        const followingTab = page.locator('a[role="tab"][href="/home"], [role="tab"]').filter({ hasText: "Following" });
        if (await followingTab.count() > 0) {
          await followingTab.first().click();
          await randomDelay(1500, 2500);
        } else {
          // Fallback: try by tab text content
          const tabs = page.locator('[role="tab"]');
          const count = await tabs.count();
          for (let i = 0; i < count; i++) {
            const text = await tabs.nth(i).textContent();
            if (text?.toLowerCase().includes("following")) {
              await tabs.nth(i).click();
              await randomDelay(1500, 2500);
              break;
            }
          }
        }
      }
      // "for_you" is the default tab, no click needed
    } catch (err) {
      console.log(`[home-timeline] Could not switch to ${tab} tab, using default`);
    }
  }

  await randomDelay(1500, 2500);

  // Wait for tweets to load
  await page.waitForSelector('article[data-testid="tweet"]', { timeout: 15000 }).catch(() => {});

  const allTweets: ScoredTweet[] = [];
  const seenIds = new Set<string>();

  const source: "home" | "bookmarks" | "likes" = (tab === "bookmarks") ? "bookmarks" : (tab === "likes") ? "likes" : "home";

  for (let i = 0; i < scrollCount; i++) {
    const tweets = await extractTweets(page);

    for (const tweet of tweets) {
      if (!seenIds.has(tweet.id) && tweet.id && tweet.content) {
        seenIds.add(tweet.id);
        allTweets.push({ ...scoreTweet(tweet), source, feedTab: tab });
      }
    }

    if (allTweets.length >= maxTweets) break;

    // Scroll down
    await page.mouse.wheel(0, 800 + Math.random() * 400);
    await randomDelay(1500, 3000);
  }

  return allTweets.slice(0, maxTweets);
}

async function extractTweets(page: Page): Promise<RawTweet[]> {
  return await page.evaluate(`
    (function() {
      function parseCount(text) {
        if (!text) return 0;
        var num = text.replace(/,/g, '').trim();
        if (num.endsWith('K')) return Math.floor(parseFloat(num) * 1000);
        if (num.endsWith('M')) return Math.floor(parseFloat(num) * 1000000);
        return parseInt(num) || 0;
      }

      var articles = Array.from(document.querySelectorAll('article[data-testid="tweet"]'));
      return articles.map(function(article) {
        var handleEl = article.querySelector('[data-testid="User-Name"] a[href^="/"]');
        var nameEl = article.querySelector('[data-testid="User-Name"] > div:first-child span');
        var contentEl = article.querySelector('[data-testid="tweetText"]');
        var likeEl = article.querySelector('[data-testid="like"] span');
        var retweetEl = article.querySelector('[data-testid="retweet"] span');
        var replyEl = article.querySelector('[data-testid="reply"] span');
        var linkEl = article.querySelector('a[href*="/status/"]');
        var timeEl = article.querySelector('time');

        var statusHref = linkEl ? linkEl.getAttribute('href') : '';
        var idMatch = statusHref.match(/status\\/(\\d+)/);
        var tweetId = idMatch ? idMatch[1] : '';

        // Extract external URLs from tweet content
        var links = Array.from(article.querySelectorAll('[data-testid="tweetText"] a[href]'));
        var externalUrls = links
          .map(function(a) { return a.getAttribute('href'); })
          .filter(function(h) { return h && !h.startsWith('/') && !h.includes('x.com') && !h.includes('twitter.com'); });

        // Detect retweet
        var socialContext = article.querySelector('[data-testid="socialContext"]');
        var isRetweet = socialContext ? socialContext.textContent.includes('reposted') : false;

        // Detect reply
        var isReply = !!article.querySelector('[data-testid="Tweet-User-Avatar"] + div [href*="/status/"]');

        return {
          id: tweetId,
          handle: handleEl ? handleEl.getAttribute('href').replace('/', '') : 'unknown',
          displayName: nameEl ? nameEl.textContent.trim() : 'Unknown',
          content: contentEl ? contentEl.textContent.trim() : '',
          likes: parseCount(likeEl ? likeEl.textContent : '0'),
          retweets: parseCount(retweetEl ? retweetEl.textContent : '0'),
          replies: parseCount(replyEl ? replyEl.textContent : '0'),
          url: tweetId ? 'https://x.com' + statusHref : '',
          time: timeEl ? timeEl.getAttribute('datetime') : new Date().toISOString(),
          externalUrls: externalUrls,
          hasMedia: !!article.querySelector('[data-testid="tweetPhoto"], video'),
          isRetweet: isRetweet,
          isReply: isReply
        };
      });
    })()
  `);
}

// ─── Scoring ───────────────────────────────────────────────────────

/**
 * Score a tweet for inclusion.
 *
 * RUTHLESS ACTIONABILITY FILTER:
 * The question is NOT "is this interesting?" — it's
 * "can a developer install, integrate, or build with this RIGHT NOW?"
 *
 * A tweet about "ecosystem growth" or "agents registering on X chain"
 * is news. A tweet with a GitHub link and install commands is a tool.
 * We want tools.
 */
function scoreTweet(tweet: RawTweet): ScoredTweet {
  const content = tweet.content.toLowerCase();
  let score = 0;
  const matched: string[] = [];

  // ── ACTIONABILITY GATE ──
  // Must have at least ONE of these to score above zero:
  // 1. External URL (link to a tool, repo, docs)
  // 2. Install command in text
  // 3. High-value keyword (install-ready content)
  const hasExternalUrl = tweet.externalUrls.length > 0;
  const hasGitHubUrl = tweet.externalUrls.some((u) => u.includes("github.com"));
  const hasInstallCmd = /npm install|pip install|pip3 install|git clone|npx |cargo install|brew install|pnpm add|docker run/i.test(content);
  const hasCodeBlock = content.includes("```") || /`[a-z]+ install\s/i.test(content);

  const isActionable = hasExternalUrl || hasInstallCmd || hasCodeBlock;

  if (!isActionable) {
    // No link, no install command, no code = not actionable = score 0
    return { ...tweet, relevanceScore: 0, matchedKeywords: [], source: "home", feedTab: "for_you" as FeedTab };
  }

  // ── Keyword scoring (only matters if actionable) ──

  // High-value keywords (+15 each) — install-ready, ecosystem-specific
  for (const kw of HIGH_VALUE_KEYWORDS) {
    if (content.includes(kw)) {
      score += 15;
      matched.push(kw);
    }
  }

  // Medium-value keywords (+6 each, cap at 5)
  for (const kw of MEDIUM_VALUE_KEYWORDS) {
    if (content.includes(kw) && matched.length < 8) {
      score += 6;
      matched.push(kw);
    }
  }

  // Low-value keywords (+2 each) — very generic, barely moves the needle
  for (const kw of LOW_VALUE_KEYWORDS) {
    if (content.includes(kw) && matched.length < 10) {
      score += 2;
      matched.push(kw);
    }
  }

  // Negative keywords (-50 each) — hard penalty
  for (const neg of NEGATIVE_KEYWORDS) {
    if (content.includes(neg.toLowerCase())) {
      score -= 50;
    }
  }

  // ── Actionability bonuses (the big differentiators) ──

  if (hasGitHubUrl) {
    score += 30; // GitHub repo = highest actionability signal
  } else if (hasExternalUrl) {
    score += 10; // Some link to a tool/product
  }

  if (hasInstallCmd) {
    score += 25; // Literal install command in tweet
  }

  if (hasCodeBlock) {
    score += 15; // Code block = shows how to use it
  }

  // ── Engagement scoring (reduced weight — engagement ≠ actionability) ──
  const engagement = tweet.likes + tweet.retweets * 2 + tweet.replies;
  if (engagement > 1000) score += 8;
  else if (engagement > 200) score += 4;
  else if (engagement > 50) score += 2;

  // ── Penalties ──
  if (tweet.isRetweet) score -= 5;
  if (tweet.isReply) score -= 10;
  if (tweet.content.length < 30) score -= 20; // Too short to be useful

  // ── News/commentary penalty ──
  // If it reads like news but has a link, still penalize — the link should be to a tool, not an article
  const newsPatterns = [
    "just in", "breaking", "report", "sources say",
    "has launched", "announces", "raises $", "funding round",
    "what's your", "which is", "what do you think",
    "here are the", "top projects", "top agents",
  ];
  const newsHits = newsPatterns.filter((p) => content.includes(p));
  if (newsHits.length > 0) {
    score -= 25 * newsHits.length;
  }

  return {
    ...tweet,
    relevanceScore: Math.max(0, score),
    matchedKeywords: matched,
    source: "home",
    feedTab: "for_you" as FeedTab,
  };
}

// ─── Convert to Discovery ──────────────────────────────────────────

function tweetToDiscovery(tweet: ScoredTweet): Discovery {
  let category: Discovery["category"] = "workflow";
  const content = tweet.content.toLowerCase();

  if (content.includes("mcp") || content.includes("api") || content.includes("sdk") || content.includes("integration")) {
    category = "integration";
  } else if (content.includes("security") || content.includes("sandbox") || content.includes("permission")) {
    category = "security";
  } else if (content.includes("release") || content.includes("launch") || content.includes("ship") || content.includes("tool")) {
    category = "tool";
  } else if (content.includes("skill") || content.includes("openclaw") || content.includes("clawhub") || content.includes("plugin")) {
    category = "skill";
  } else if (content.includes("local") || content.includes("self-host") || content.includes("private") || content.includes("ollama")) {
    category = "privacy";
  } else if (content.includes("model") || content.includes("llm") || content.includes("fine-tune")) {
    category = "model";
  } else if (content.includes("docker") || content.includes("container") || content.includes("vm")) {
    category = "infrastructure";
  }

  // Prefer external URL over tweet URL for source
  const primaryUrl = tweet.externalUrls.find((u) => u.includes("github.com"))
    || tweet.externalUrls[0]
    || tweet.url;

  // Build install steps from external URLs
  const installSteps: string[] = [];
  const githubUrl = tweet.externalUrls.find((u) => u.includes("github.com"));
  if (githubUrl) {
    const repoMatch = githubUrl.match(/github\.com\/([^/]+\/[^/]+)/);
    if (repoMatch) {
      const repoPath = repoMatch[1].replace(/\/(blob|tree|wiki|issues|pulls).*$/, "");
      installSteps.push(`git clone https://github.com/${repoPath}.git`);
      installSteps.push(`cd ${repoPath.split("/")[1]}`);
      installSteps.push("# See README for setup");
    }
  }
  if (installSteps.length === 0) {
    installSteps.push(`# See ${primaryUrl}`);
  }

  // Truncate content for title
  const title = tweet.content.slice(0, 80) + (tweet.content.length > 80 ? "..." : "");

  const sourceLabel = tweet.source === "bookmarks" ? " (bookmarked)" : tweet.source === "likes" ? " (liked)" : "";

  return createDiscovery({
    id: `tw-home-${tweet.id}`,
    category,
    title,
    oneLiner: tweet.content.slice(0, 120),
    what: tweet.content,
    why: `@${tweet.handle}${sourceLabel} — ${tweet.matchedKeywords.slice(0, 3).join(", ")} (${tweet.likes} likes)`,
    impact: `Shared by @${tweet.handle}`,
    install: {
      steps: installSteps,
      timeEstimate: githubUrl ? "5 min" : "2 min",
    },
    source: {
      url: tweet.url,
      type: "twitter",
      author: tweet.handle,
      date: tweet.time,
    },
    signals: {
      engagement: tweet.likes + tweet.retweets,
      trending: tweet.likes > 500,
    },
  });
}

// ─── LLM verdict → Discovery ───────────────────────────────────────

function verdictToDiscovery(tweet: ScoredTweet, verdict: JudgeVerdict): Discovery {
  const primaryUrl = tweet.externalUrls.find((u) => u.includes("github.com"))
    || tweet.externalUrls[0]
    || tweet.url;

  // Use the LLM's install hint, or build from external URLs
  const installSteps: string[] = [];
  if (verdict.installHint && !verdict.installHint.startsWith("N/A") && verdict.installHint.length > 3) {
    // Split multi-command hints
    const hints = verdict.installHint.split(/[;\n]/).map((s) => s.trim()).filter(Boolean);
    installSteps.push(...hints);
  }
  if (installSteps.length === 0) {
    const githubUrl = tweet.externalUrls.find((u) => u.includes("github.com"));
    if (githubUrl) {
      const repoMatch = githubUrl.match(/github\.com\/([^/]+\/[^/]+)/);
      if (repoMatch) {
        const repoPath = repoMatch[1].replace(/\/(blob|tree|wiki|issues|pulls).*$/, "");
        installSteps.push(`git clone https://github.com/${repoPath}.git`);
        installSteps.push(`cd ${repoPath.split("/")[1]}`);
        installSteps.push("# See README for setup");
      }
    } else {
      installSteps.push(`# See ${primaryUrl}`);
    }
  }

  const validCategories = ["tool", "integration", "infrastructure", "workflow", "security", "privacy", "model", "skill"];
  const category = validCategories.includes(verdict.category) ? verdict.category as Discovery["category"] : "tool";

  const sourceLabel = tweet.source === "bookmarks" ? " (bookmarked)" : tweet.source === "likes" ? " (liked)" : "";

  return createDiscovery({
    id: `tw-home-${tweet.id}`,
    category,
    title: verdict.title || tweet.content.slice(0, 60),
    oneLiner: verdict.oneLiner || tweet.content.slice(0, 120),
    what: verdict.oneLiner || tweet.content,
    why: `@${tweet.handle}${sourceLabel} — ${verdict.valueProp || tweet.matchedKeywords.slice(0, 3).join(", ")} (${tweet.likes} likes)`,
    impact: verdict.valueProp || `Shared by @${tweet.handle}`,
    install: {
      steps: installSteps,
      timeEstimate: "5 min",
    },
    source: {
      url: tweet.url,
      type: "twitter",
      author: tweet.handle,
      date: tweet.time,
    },
    signals: {
      engagement: tweet.likes + tweet.retweets,
      trending: tweet.likes > 500,
    },
  });
}

// ─── Auto-follow good accounts from For You ───────────────────────

async function autoFollowGoodAccounts(page: Page, goodTweets: ScoredTweet[]): Promise<void> {
  const followedAccounts = loadFollowedAccounts();

  // Collect unique handles we haven't followed yet
  const toFollow = new Set<string>();
  for (const tweet of goodTweets) {
    const handle = tweet.handle.replace("@", "").toLowerCase();
    if (handle && handle !== "unknown" && handle !== "goodstewdaily" && !followedAccounts.has(handle)) {
      toFollow.add(handle);
    }
  }

  if (toFollow.size === 0) {
    console.log(`[home-timeline] Auto-follow: all good accounts already followed`);
    return;
  }

  console.log(`[home-timeline] Auto-follow: following ${toFollow.size} new accounts...`);

  for (const handle of toFollow) {
    try {
      await page.goto(`https://x.com/${handle}`, { waitUntil: "domcontentloaded", timeout: 15000 });
      await randomDelay(1500, 2500);

      // Look for the Follow button (not "Following" — that means already followed)
      const followButton = page.locator('[data-testid$="-follow"]').filter({ hasText: /^Follow$/ });

      if (await followButton.count() > 0) {
        await followButton.first().click();
        await randomDelay(1000, 2000);
        followedAccounts.add(handle);
        console.log(`[home-timeline] ✓ Followed @${handle}`);
      } else {
        // Already following or button not found
        followedAccounts.add(handle); // Mark as followed anyway to avoid retrying
        console.log(`[home-timeline] Already following @${handle}`);
      }

      await randomDelay(2000, 4000); // Rate limit between follows
    } catch (error) {
      console.log(`[home-timeline] Could not follow @${handle}:`, error);
    }
  }

  saveFollowedAccounts(followedAccounts);
}

function loadFollowedAccounts(): Set<string> {
  if (!existsSync(FOLLOWED_PATH)) return new Set();

  try {
    const data = JSON.parse(readFileSync(FOLLOWED_PATH, "utf-8"));
    return new Set(data.map((a: string) => a.toLowerCase()));
  } catch {
    return new Set();
  }
}

function saveFollowedAccounts(accounts: Set<string>): void {
  writeFileSync(FOLLOWED_PATH, JSON.stringify([...accounts], null, 2));
}

// ─── Login check ───────────────────────────────────────────────────

async function checkLogin(page: Page): Promise<boolean> {
  try {
    await page.goto("https://x.com/home", { waitUntil: "domcontentloaded", timeout: 20000 });
    await randomDelay(2000, 3000);

    return await page.evaluate(() => {
      return !!(
        document.querySelector('[data-testid="SideNav_NewTweet_Button"]') ||
        document.querySelector('[data-testid="primaryColumn"]') ||
        document.querySelector('[aria-label="Home timeline"]')
      );
    });
  } catch {
    return false;
  }
}

// ─── Seen tweets persistence ───────────────────────────────────────

function loadSeenTweets(): Set<string> {
  if (!existsSync(SEEN_HOME_PATH)) return new Set();

  try {
    const data = JSON.parse(readFileSync(SEEN_HOME_PATH, "utf-8"));
    // Keep only last 7 days
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const recent = data.filter((e: { id: string; seen: number }) => e.seen > cutoff);
    return new Set(recent.map((e: { id: string }) => e.id));
  } catch {
    return new Set();
  }
}

function saveSeenTweets(ids: Set<string>): void {
  const now = Date.now();
  const data = Array.from(ids).map((id) => ({ id, seen: now }));
  writeFileSync(SEEN_HOME_PATH, JSON.stringify(data, null, 2));
}

// ─── Utilities ─────────────────────────────────────────────────────

function randomDelay(min: number, max: number): Promise<void> {
  const delay = Math.floor(Math.random() * (max - min) + min);
  return new Promise((resolve) => setTimeout(resolve, delay));
}
