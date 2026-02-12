/**
 * X/Twitter API Scraper — Home Timeline + Keyword Search
 *
 * PRIMARY: Home timeline (Following feed) — you curate who to follow,
 *   the algorithm surfaces relevant OpenClaw/agent content.
 *   Requires OAuth 2.0 (run `pnpm twitter:oauth` once).
 *
 * BACKUP: Keyword search — targeted queries if timeline doesn't fill enough slots.
 *   Uses bearer token (no OAuth needed).
 *
 * URL ENRICHMENT: Both sources follow links in tweets (GitHub repos, blog posts)
 *   to give the LLM judge full context, not just tweet text.
 *
 * Cost: ~$0.005 per tweet read.
 *
 * Adapted from https://github.com/rohunvora/x-research-skill
 */

import type { Discovery } from "../types/discovery";
import { createDiscovery } from "../types/discovery";
import {
  judgeBatch,
  isJudgeAvailable,
  type JudgeInput,
  type JudgeVerdict,
} from "../curation/llm-judge";
import { getValidAccessToken } from "./twitter-auth";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";

const BASE = "https://api.x.com/2";
const RATE_DELAY_MS = 400; // stay under 100 req/min limit
const COST_PER_TWEET = 0.005; // ~$0.005 per tweet read

const DATA_DIR = join(process.cwd(), ".morning-stew");
const CACHE_DIR = join(DATA_DIR, "x-cache");
const SEEN_TWEETS_PATH = join(DATA_DIR, "seen-api-tweets.json");

// ── Spend Tracking ──
// Shared budget across timeline + keyword search within one generation run.
// Reset at the start of each newsletter compilation via resetTwitterBudget().

let twitterSpend = 0;
let twitterBudgetCap = 0.75; // default $0.75

/**
 * Reset the spend tracker. Call at the start of each newsletter generation.
 */
export function resetTwitterBudget(capDollars = 0.75) {
  twitterSpend = 0;
  twitterBudgetCap = capDollars;
  console.log(`[x-budget] Twitter API budget: $${capDollars.toFixed(2)}`);
}

/**
 * Record spend and check if we're within budget.
 * Returns true if the spend was recorded (within budget).
 * Returns false if adding this spend would exceed the cap.
 */
function recordSpend(amount: number): boolean {
  if (twitterSpend + amount > twitterBudgetCap) {
    return false;
  }
  twitterSpend += amount;
  return true;
}

function getRemainingBudget(): number {
  return Math.max(0, twitterBudgetCap - twitterSpend);
}

function getSpendSummary(): string {
  return `$${twitterSpend.toFixed(2)}/$${twitterBudgetCap.toFixed(2)}`;
}

// ── Auth ──

function getBearerToken(): string {
  const token = process.env.X_BEARER_TOKEN;
  if (!token) throw new Error("X_BEARER_TOKEN not set");
  return token;
}

// ── Types ──

interface Tweet {
  id: string;
  text: string;
  author_id: string;
  username: string;
  name: string;
  created_at: string;
  conversation_id: string;
  metrics: {
    likes: number;
    retweets: number;
    replies: number;
    quotes: number;
    impressions: number;
    bookmarks: number;
  };
  urls: string[];
  mentions: string[];
  hashtags: string[];
  tweet_url: string;
}

interface RawResponse {
  data?: any[];
  includes?: { users?: any[] };
  meta?: { next_token?: string; result_count?: number };
  errors?: any[];
  title?: string;
  detail?: string;
  status?: number;
}

// ── Search Queries (BACKUP — only used when timeline doesn't fill slots) ──

const SEARCH_QUERIES = [
  // Core agent tooling (broad net)
  `"AI agent" (tool OR SDK OR framework OR library) -is:retweet -is:reply`,

  // MCP ecosystem
  `(MCP OR "model context protocol") (server OR tool OR plugin) -is:retweet -is:reply`,

  // OpenClaw / ClewHub
  `("OpenClaw" OR "open claw" OR "clawhub" OR "claw hub") -is:retweet`,

  // x402 payments
  `("x402" OR "HTTP 402" OR "pay per request") (agent OR API OR protocol) -is:retweet -is:reply`,

  // Claude tools & skills
  `"Claude" (agent OR skill OR tool) (launch OR ship OR release OR new OR built) -is:retweet -is:reply`,

  // Agent frameworks (LangChain, CrewAI, etc.)
  `("LangChain" OR "LangGraph" OR "CrewAI" OR "AutoGen") (new OR launch OR release OR update) -is:retweet -is:reply`,

  // Agent infrastructure (sandboxing, containers)
  `(agent OR LLM) (sandbox OR "e2b" OR container OR docker) (tool OR run OR new) -is:retweet -is:reply`,

  // Actionable installs (tweets with actual commands)
  `(npx OR "npm install" OR "pip install" OR "cargo install") (agent OR AI OR LLM OR MCP) -is:retweet -is:reply`,

  // Coding agents / assistants
  `("AI coding" OR "code agent" OR "coding assistant" OR "code generation") (new OR launch OR ship) -is:retweet -is:reply`,

  // Blockchain + agent tooling
  `("Solana" OR "Base") (agent OR bot) (SDK OR tool OR deploy) -is:retweet -is:reply`,

  // Multi-agent / orchestration
  `("multi-agent" OR "autonomous agent" OR "agent orchestration") (framework OR system OR tool) -is:retweet -is:reply`,

  // Browser / web agents
  `("browser agent" OR "web agent" OR "playwright" OR "puppeteer") (AI OR agent OR automation) -is:retweet -is:reply`,

  // Knowledge / memory for agents
  `("vector database" OR "RAG" OR "knowledge graph") (agent OR tool) (new OR launch) -is:retweet -is:reply`,

  // Self-hosted / local agent tools
  `("self-hosted" OR "local LLM" OR "ollama") (agent OR tool) -is:retweet -is:reply`,

  // OpenAI ecosystem
  `"OpenAI" (agent OR "function calling" OR "tool use") (new OR update OR launch) -is:retweet -is:reply`,
];

// ── API Helpers ──

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function parseTweets(raw: RawResponse): Tweet[] {
  if (!raw.data) return [];
  const users: Record<string, any> = {};
  for (const u of raw.includes?.users || []) {
    users[u.id] = u;
  }

  return raw.data.map((t: any) => {
    const u = users[t.author_id] || {};
    const m = t.public_metrics || {};
    return {
      id: t.id,
      text: t.text,
      author_id: t.author_id,
      username: u.username || "?",
      name: u.name || "?",
      created_at: t.created_at,
      conversation_id: t.conversation_id,
      metrics: {
        likes: m.like_count || 0,
        retweets: m.retweet_count || 0,
        replies: m.reply_count || 0,
        quotes: m.quote_count || 0,
        impressions: m.impression_count || 0,
        bookmarks: m.bookmark_count || 0,
      },
      urls: (t.entities?.urls || [])
        .map((u: any) => u.expanded_url)
        .filter(Boolean),
      mentions: (t.entities?.mentions || [])
        .map((m: any) => m.username)
        .filter(Boolean),
      hashtags: (t.entities?.hashtags || [])
        .map((h: any) => h.tag)
        .filter(Boolean),
      tweet_url: `https://x.com/${u.username || "?"}/status/${t.id}`,
    };
  });
}

const FIELDS =
  "tweet.fields=created_at,public_metrics,author_id,conversation_id,entities&expansions=author_id&user.fields=username,name,public_metrics";

async function apiGet(url: string, bearerToken?: string): Promise<RawResponse> {
  const token = bearerToken || getBearerToken();
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (res.status === 429) {
    const reset = res.headers.get("x-rate-limit-reset");
    const waitSec = reset
      ? Math.max(parseInt(reset) - Math.floor(Date.now() / 1000), 1)
      : 60;
    console.log(`[x-api] Rate limited. Waiting ${waitSec}s...`);
    await sleep(waitSec * 1000);
    const retry = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!retry.ok) {
      throw new Error(`X API rate limit retry failed: ${retry.status}`);
    }
    return retry.json();
  }

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`X API ${res.status}: ${body.slice(0, 200)}`);
  }

  return res.json();
}

async function searchTweets(
  query: string,
  maxResults = 20,
  since?: string
): Promise<Tweet[]> {
  const encoded = encodeURIComponent(query);
  let timeFilter = "";
  if (since) {
    timeFilter = `&start_time=${since}`;
  }

  const url = `${BASE}/tweets/search/recent?query=${encoded}&max_results=${maxResults}&${FIELDS}&sort_order=relevancy${timeFilter}`;
  const raw = await apiGet(url);
  return parseTweets(raw);
}

// ══════════════════════════════════════════════════════
// URL ENRICHMENT — follow links in tweets for full context
// ══════════════════════════════════════════════════════

const BRAVE_API_KEY = process.env.BRAVE_API_KEY || "";

/**
 * Fetch the content behind a URL so the LLM judge has real context,
 * not just tweet text.
 *
 * Strategy (in order):
 * 1. Tweet URL → fetch tweet via API, get text + embedded links + check replies, follow links
 * 2. GitHub repo → fetch README via API (clean markdown)
 * 3. Direct page fetch → extract text from HTML
 * 4. Brave Search fallback → if direct fetch fails or returns nothing
 */
async function fetchUrlContent(url: string, timeoutMs = 8000): Promise<string> {
  try {
    const parsed = new URL(url);

    // Tweet URL → fetch the tweet + its links + replies
    if (parsed.hostname === "x.com" || parsed.hostname === "twitter.com") {
      const tweetContent = await fetchTweetContent(url);
      if (tweetContent.fullContent) return tweetContent.fullContent;
      return "";
    }

    // GitHub repo → fetch README via API (much cleaner than HTML scraping)
    if (parsed.hostname === "github.com") {
      const readme = await fetchGitHubReadme(parsed.pathname, timeoutMs);
      if (readme) return readme;
    }

    // Direct page fetch
    const pageText = await fetchPageText(url, timeoutMs);
    if (pageText && pageText.length > 100) return pageText;

    // Brave Search fallback — if direct fetch got nothing useful
    if (BRAVE_API_KEY) {
      const braveResult = await braveSearch(url, timeoutMs);
      if (braveResult) return braveResult;
    }

    return pageText; // Return whatever we got, even if short
  } catch {
    return "";
  }
}

// ── Tweet Content Fetching ──

export interface TweetContentResult {
  tweetText: string;           // The tweet's text
  author: string;              // @username
  urls: string[];              // All URLs from tweet + replies
  linkedContent: string;       // Fetched content from the first non-twitter URL
  fullContent: string;         // Combined: tweet text + linked content (for LLM judge)
}

/**
 * Fetch a tweet by URL, extract its content, check replies for links,
 * and follow the best URL to get full context.
 *
 * Used for:
 * - Editor tips that are tweet URLs
 * - URL enrichment when a tweet links to another tweet
 */
export async function fetchTweetContent(tweetUrl: string): Promise<TweetContentResult> {
  const empty: TweetContentResult = { tweetText: "", author: "", urls: [], linkedContent: "", fullContent: "" };

  try {
    // Extract tweet ID from URL
    const match = tweetUrl.match(/status\/(\d+)/);
    if (!match) return empty;
    const tweetId = match[1];

    // Fetch the tweet via API (try bearer token first, fall back to OAuth)
    let token: string;
    try {
      token = getBearerToken();
    } catch {
      const oauthToken = await getValidAccessToken();
      if (!oauthToken) return empty;
      token = oauthToken;
    }

    // Get the main tweet
    const tweetUrl2 = `${BASE}/tweets/${tweetId}?${FIELDS}`;
    const raw = await apiGet(tweetUrl2, token);
    const tweets = parseTweets(raw);
    if (tweets.length === 0) return empty;

    const tweet = tweets[0];
    let allUrls = [...tweet.urls];

    // Check conversation replies for additional links (especially from same author)
    try {
      const convUrl = `${BASE}/tweets/search/recent?query=conversation_id:${tweet.conversation_id}&max_results=20&${FIELDS}`;
      const convRaw = await apiGet(convUrl, token);
      const replies = parseTweets(convRaw);

      // Prioritize replies from the same author (self-replies often have the link)
      const authorReplies = replies.filter((r) => r.author_id === tweet.author_id && r.id !== tweet.id);
      const otherReplies = replies.filter((r) => r.author_id !== tweet.author_id);

      for (const reply of [...authorReplies, ...otherReplies]) {
        allUrls.push(...reply.urls);
      }

      if (authorReplies.length > 0) {
        console.log(`[tweet-fetch] Found ${authorReplies.length} self-replies with ${authorReplies.flatMap(r => r.urls).length} URLs`);
      }
    } catch {
      // Replies fetch failed — that's fine, use what we have
    }

    // Dedupe URLs, filter out twitter/x.com links
    const externalUrls = [...new Set(allUrls)].filter((u) => {
      try {
        const h = new URL(u).hostname;
        return h !== "x.com" && h !== "twitter.com";
      } catch { return false; }
    });

    // Follow the best URL for content
    let linkedContent = "";
    for (const url of externalUrls.slice(0, 3)) {
      const content = await fetchUrlContentNonTweet(url);
      if (content && content.length > 100) {
        linkedContent = content;
        break;
      }
    }

    // If no URL content, try Brave Search on the tweet text
    if (!linkedContent && BRAVE_API_KEY) {
      linkedContent = await braveSearchForTweet(tweet.text);
    }

    // Build combined content
    let fullContent = `Tweet by @${tweet.username}:\n${tweet.text}`;
    if (externalUrls.length > 0) {
      fullContent += `\n\nLinked URLs: ${externalUrls.join(", ")}`;
    }
    if (linkedContent) {
      fullContent += `\n\n--- Linked page content ---\n${linkedContent}`;
    }

    return {
      tweetText: tweet.text,
      author: tweet.username,
      urls: externalUrls,
      linkedContent,
      fullContent,
    };
  } catch (err: any) {
    console.log(`[tweet-fetch] Error: ${err.message}`);
    return empty;
  }
}

/**
 * Same as fetchUrlContent but explicitly skips tweet URLs to avoid recursion.
 */
async function fetchUrlContentNonTweet(url: string, timeoutMs = 8000): Promise<string> {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === "x.com" || parsed.hostname === "twitter.com") return "";

    if (parsed.hostname === "github.com") {
      const readme = await fetchGitHubReadme(parsed.pathname, timeoutMs);
      if (readme) return readme;
    }

    const pageText = await fetchPageText(url, timeoutMs);
    if (pageText && pageText.length > 100) return pageText;

    if (BRAVE_API_KEY) {
      return await braveSearch(url, timeoutMs);
    }

    return pageText;
  } catch {
    return "";
  }
}

/**
 * Use Brave Search to find context about a tool/project mentioned in a tweet.
 * Called when:
 * - A tweet has no URL but mentions something interesting
 * - A URL fetch fails (paywall, JS-rendered, etc.)
 */
async function braveSearch(query: string, timeoutMs = 8000): Promise<string> {
  if (!BRAVE_API_KEY) return "";

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    const encoded = encodeURIComponent(query);
    const res = await fetch(
      `https://api.search.brave.com/res/v1/web/search?q=${encoded}&count=3`,
      {
        headers: {
          Accept: "application/json",
          "Accept-Encoding": "gzip",
          "X-Subscription-Token": BRAVE_API_KEY,
        },
        signal: controller.signal,
      }
    );
    clearTimeout(timeout);

    if (!res.ok) return "";

    const data = await res.json();
    const results = data.web?.results || [];

    if (results.length === 0) return "";

    // Combine top results into a summary
    const summary = results
      .slice(0, 3)
      .map((r: any) => {
        const title = r.title || "";
        const description = r.description || "";
        const url = r.url || "";
        return `[${title}](${url}): ${description}`;
      })
      .join("\n\n");

    return summary.slice(0, 2000);
  } catch {
    return "";
  }
}

/**
 * Search Brave for a tweet's topic when the tweet has no URL.
 * Extracts key terms from the tweet and searches for them.
 */
async function braveSearchForTweet(tweetText: string): Promise<string> {
  if (!BRAVE_API_KEY) return "";

  // Extract likely project/tool names — capitalized words, quoted terms, @mentions
  const quoted = tweetText.match(/"([^"]+)"/g)?.map(s => s.replace(/"/g, "")) || [];
  const capitalized = tweetText.match(/\b[A-Z][a-zA-Z]{2,}\b/g) || [];
  const searchTerms = [...quoted, ...capitalized].slice(0, 3);

  if (searchTerms.length === 0) return "";

  const query = searchTerms.join(" ") + " github OR npm OR docs";
  return braveSearch(query);
}

async function fetchGitHubReadme(pathname: string, timeoutMs: number): Promise<string> {
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length < 2) return "";

  const owner = parts[0];
  const repo = parts[1];

  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3.raw",
    "User-Agent": "morning-stew/1.0",
  };

  const ghToken = process.env.GITHUB_TOKEN;
  if (ghToken) {
    headers.Authorization = `Bearer ${ghToken}`;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/readme`,
      { headers, signal: controller.signal }
    );
    clearTimeout(timeout);

    if (!res.ok) return "";

    const text = await res.text();
    return text.slice(0, 3000);
  } catch {
    return "";
  }
}

async function fetchPageText(url: string, timeoutMs: number): Promise<string> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    const res = await fetch(url, {
      headers: { "User-Agent": "morning-stew/1.0" },
      signal: controller.signal,
      redirect: "follow",
    });
    clearTimeout(timeout);

    if (!res.ok) return "";

    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("text/html") && !contentType.includes("text/plain")) {
      return "";
    }

    const html = await res.text();

    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/\s+/g, " ")
      .trim();

    return text.slice(0, 2000);
  } catch {
    return "";
  }
}

/**
 * Enrich an array of tweets by fetching content from their URLs
 * or searching Brave when there's no URL.
 * Returns a map of tweet ID → enriched content string.
 * Runs in parallel with a concurrency limit.
 */
async function enrichTweetUrls(
  tweets: Tweet[],
  concurrency = 5
): Promise<Map<string, string>> {
  const enrichments = new Map<string, string>();

  const tweetsWithUrls = tweets.filter((t) => t.urls.length > 0);
  const tweetsNoUrls = BRAVE_API_KEY
    ? tweets.filter((t) => t.urls.length === 0 && t.text.length > 30)
    : [];

  const total = tweetsWithUrls.length + tweetsNoUrls.length;
  if (total === 0) return enrichments;

  console.log(`[enrich] Enriching ${tweetsWithUrls.length} tweets with URLs, ${tweetsNoUrls.length} via Brave Search...`);

  // Enrich tweets with URLs (fetch the linked content)
  let idx = 0;
  async function urlWorker() {
    while (idx < tweetsWithUrls.length) {
      const i = idx++;
      const tweet = tweetsWithUrls[i];
      const content = await fetchUrlContent(tweet.urls[0]);
      if (content) {
        enrichments.set(tweet.id, content);
      }
    }
  }

  const urlWorkers = Array.from(
    { length: Math.min(concurrency, tweetsWithUrls.length) },
    () => urlWorker()
  );
  await Promise.all(urlWorkers);

  // Enrich tweets without URLs via Brave Search
  let braveIdx = 0;
  async function braveWorker() {
    while (braveIdx < tweetsNoUrls.length) {
      const i = braveIdx++;
      const tweet = tweetsNoUrls[i];
      const content = await braveSearchForTweet(tweet.text);
      if (content) {
        enrichments.set(tweet.id, content);
      }
    }
  }

  if (tweetsNoUrls.length > 0) {
    const braveWorkers = Array.from(
      { length: Math.min(3, tweetsNoUrls.length) }, // Lower concurrency for Brave (rate limits)
      () => braveWorker()
    );
    await Promise.all(braveWorkers);
  }

  console.log(`[enrich] Enriched ${enrichments.size}/${total} tweets with external content`);
  return enrichments;
}

// ── Cache ──

function getCacheKey(query: string): string {
  return query.replace(/[^a-zA-Z0-9]/g, "_").slice(0, 60);
}

function getCachedTweets(query: string, ttlMs = 900_000): Tweet[] | null {
  if (!existsSync(CACHE_DIR)) return null;
  const path = join(CACHE_DIR, `${getCacheKey(query)}.json`);
  if (!existsSync(path)) return null;

  try {
    const data = JSON.parse(readFileSync(path, "utf-8"));
    if (Date.now() - data.timestamp < ttlMs) {
      return data.tweets;
    }
  } catch {}
  return null;
}

function cacheTweets(query: string, tweets: Tweet[]) {
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
  const path = join(CACHE_DIR, `${getCacheKey(query)}.json`);
  writeFileSync(path, JSON.stringify({ timestamp: Date.now(), tweets }, null, 2));
}

// ── Seen Tweets ──

function loadSeenTweets(): Set<string> {
  if (!existsSync(SEEN_TWEETS_PATH)) return new Set();
  try {
    return new Set(JSON.parse(readFileSync(SEEN_TWEETS_PATH, "utf-8")));
  } catch {
    return new Set();
  }
}

function saveSeenTweets(seen: Set<string>) {
  const arr = [...seen].slice(-2000);
  writeFileSync(SEEN_TWEETS_PATH, JSON.stringify(arr, null, 2));
}

// ══════════════════════════════════════════════════════
// TWITTER SCRAPER — alternates Following feed + keyword search
// ══════════════════════════════════════════════════════

export interface TwitterScrapeConfig {
  targetDiscoveries?: number;  // Keep going until we hit this many (default: 6)
  batchSize?: number;          // Tweets per batch — alternates source every batch (default: 15)
  maxBatches?: number;         // Hard cap on total batches (default: 10)
  sinceHours?: number;         // Only tweets from last N hours (default: 48)
}

/**
 * Unified Twitter scraper that alternates between two sources every ~15 tweets:
 *
 *   Batch 1: 15 tweets from Following feed
 *   Batch 2: 15 tweets from keyword search ("For You" approximation)
 *   Batch 3: 15 tweets from Following feed
 *   Batch 4: 15 tweets from keyword search
 *   ... until target met, budget hit, or sources exhausted
 *
 * Each batch is immediately enriched (URLs fetched) and LLM-judged.
 * The judge is never forced — if it rejects everything, we just keep alternating.
 *
 * Respects the shared $0.75 Twitter API budget cap.
 * Requires OAuth 2.0 for Following feed (falls back to search-only if unavailable).
 */
export async function scrapeTwitterFeed(
  config: TwitterScrapeConfig = {}
): Promise<Discovery[]> {
  const {
    targetDiscoveries = 6,
    batchSize = 15,
    maxBatches = 10,
    sinceHours = 48,
  } = config;

  const since = new Date(Date.now() - sinceHours * 3600_000).toISOString();
  const seenTweets = loadSeenTweets();
  let allDiscoveries: Discovery[] = [];
  let totalTweetsSeen = 0;

  // ── Timeline state ──
  const accessToken = await getValidAccessToken();
  let userId: string | null = null;
  let timelinePaginationToken: string | undefined;
  let timelineExhausted = false;

  if (accessToken) {
    try {
      const meRes = await apiGet(`${BASE}/users/me`, accessToken);
      userId = (meRes as any).data?.id || null;
      if (userId) {
        console.log(`[twitter] OAuth OK — will alternate Following feed + keyword search`);
      }
    } catch (err: any) {
      console.log(`[twitter] Could not get user ID: ${err.message} — keyword search only`);
    }
  } else {
    console.log("[twitter] No OAuth 2.0 tokens — keyword search only. Run: pnpm twitter:oauth");
  }

  // ── Keyword search state ──
  let searchQueryIdx = 0;
  let searchExhausted = false;

  console.log(`[twitter] Target: ${targetDiscoveries} discoveries | Budget: ${getSpendSummary()} | Alternating every ${batchSize} tweets`);

  // ── Adaptive alternating loop ──
  let batch = 0;
  while (batch < maxBatches && allDiscoveries.length < targetDiscoveries) {
    // Budget check
    const batchCostEstimate = batchSize * COST_PER_TWEET;
    if (getRemainingBudget() < batchCostEstimate * 0.5) {
      console.log(`[twitter] Budget nearly exhausted (${getSpendSummary()}) — stopping`);
      break;
    }

    batch++;
    const source = (batch % 2 === 1) ? "following" : "search";
    let batchTweets: Tweet[] = [];

    // ── Fetch from current source ──
    if (source === "following" && userId && !timelineExhausted) {
      // Following feed
      let url = `${BASE}/users/${userId}/timelines/reverse_chronological?max_results=${batchSize}&${FIELDS}&start_time=${since}`;
      if (timelinePaginationToken) {
        url += `&pagination_token=${timelinePaginationToken}`;
      }

      try {
        const raw = await apiGet(url, accessToken!);
        batchTweets = parseTweets(raw);
        timelinePaginationToken = raw.meta?.next_token;

        if (!timelinePaginationToken || batchTweets.length === 0) {
          timelineExhausted = true;
        }
      } catch (err: any) {
        console.log(`[twitter] Following feed error: ${err.message}`);
        timelineExhausted = true;
      }
    } else if (source === "search" && !searchExhausted) {
      // Keyword search
      if (searchQueryIdx >= SEARCH_QUERIES.length) {
        searchExhausted = true;
      } else {
        const query = SEARCH_QUERIES[searchQueryIdx++];
        try {
          const cached = getCachedTweets(query);
          if (cached) {
            batchTweets = cached;
          } else {
            batchTweets = await searchTweets(query, batchSize, since);
            cacheTweets(query, batchTweets);
          }
        } catch (err: any) {
          console.log(`[twitter] Search error: ${err.message}`);
        }
      }
    } else {
      // Current source exhausted — try the other one
      if (source === "following" && !searchExhausted) {
        // Swap to search
        if (searchQueryIdx < SEARCH_QUERIES.length) {
          const query = SEARCH_QUERIES[searchQueryIdx++];
          try {
            const cached = getCachedTweets(query);
            if (cached) {
              batchTweets = cached;
            } else {
              batchTweets = await searchTweets(query, batchSize, since);
              cacheTweets(query, batchTweets);
            }
          } catch (err: any) {
            console.log(`[twitter] Search fallback error: ${err.message}`);
          }
        } else {
          searchExhausted = true;
        }
      } else if (source === "search" && userId && !timelineExhausted) {
        // Swap to following
        let url = `${BASE}/users/${userId}/timelines/reverse_chronological?max_results=${batchSize}&${FIELDS}&start_time=${since}`;
        if (timelinePaginationToken) {
          url += `&pagination_token=${timelinePaginationToken}`;
        }
        try {
          const raw = await apiGet(url, accessToken!);
          batchTweets = parseTweets(raw);
          timelinePaginationToken = raw.meta?.next_token;
          if (!timelinePaginationToken || batchTweets.length === 0) {
            timelineExhausted = true;
          }
        } catch (err: any) {
          console.log(`[twitter] Following fallback error: ${err.message}`);
          timelineExhausted = true;
        }
      }

      // Both exhausted
      if (timelineExhausted && searchExhausted) {
        console.log("[twitter] Both sources exhausted — stopping");
        break;
      }
    }

    // Filter seen tweets and record spend
    const newTweets = batchTweets.filter((t) => !seenTweets.has(t.id));
    for (const t of batchTweets) seenTweets.add(t.id);

    const batchCost = batchTweets.length * COST_PER_TWEET;
    totalTweetsSeen += batchTweets.length;
    recordSpend(batchCost);

    const sourceLabel = source === "following" ? "Following" : "Search";
    console.log(`[twitter] Batch ${batch} (${sourceLabel}): ${batchTweets.length} tweets, ${newTweets.length} new | ${getSpendSummary()} | discoveries: ${allDiscoveries.length}`);

    if (newTweets.length > 0) {
      // Enrich URLs
      const enrichments = await enrichTweetUrls(newTweets);

      // LLM judge this batch
      const batchDiscoveries = await judgeTweets(newTweets, enrichments, `${sourceLabel.toLowerCase()}-b${batch}`);
      allDiscoveries.push(...batchDiscoveries);

      console.log(`[twitter] Batch ${batch} yielded ${batchDiscoveries.length} discoveries → total: ${allDiscoveries.length}/${targetDiscoveries}`);
    }

    if (allDiscoveries.length >= targetDiscoveries) {
      console.log(`[twitter] Target reached!`);
      break;
    }

    await sleep(RATE_DELAY_MS);
  }

  saveSeenTweets(seenTweets);
  console.log(`[twitter] Done: ${allDiscoveries.length} discoveries from ${totalTweetsSeen} tweets across ${batch} batches (${getSpendSummary()})`);
  return allDiscoveries;
}

// ── Legacy exports for backward compat (compile.ts uses these names) ──

export interface HomeTimelineConfig {
  targetDiscoveries?: number;
  tweetsPerPage?: number;
  maxPages?: number;
  sinceHours?: number;
}

export async function scrapeHomeTimeline(config: HomeTimelineConfig = {}): Promise<Discovery[]> {
  return scrapeTwitterFeed({
    targetDiscoveries: config.targetDiscoveries,
    batchSize: config.tweetsPerPage || 15,
    maxBatches: config.maxPages || 10,
    sinceHours: config.sinceHours,
  });
}

export interface XApiSearchConfig {
  maxResultsPerQuery?: number;
  sinceHours?: number;
  cacheTtlMs?: number;
  queries?: string[];
}

export async function scrapeXApiSearch(config: XApiSearchConfig = {}): Promise<Discovery[]> {
  // Pure keyword search (no timeline), for when compile.ts calls this as backup
  const queries = config.queries || SEARCH_QUERIES;
  const sinceHours = config.sinceHours || 48;
  const maxResultsPerQuery = config.maxResultsPerQuery || 20;
  const since = new Date(Date.now() - sinceHours * 3600_000).toISOString();
  const seenTweets = loadSeenTweets();

  const remaining = getRemainingBudget();
  if (remaining < 0.02) {
    console.log(`[x-search] No budget remaining (${getSpendSummary()}) — skipping`);
    return [];
  }

  console.log(`[x-search] Keyword search: ${queries.length} queries (budget: $${remaining.toFixed(2)})`);

  let allTweets: Tweet[] = [];

  for (const query of queries) {
    if (getRemainingBudget() < 0.02) {
      console.log(`[x-search] Budget cap reached (${getSpendSummary()}) — stopping`);
      break;
    }

    try {
      const cached = getCachedTweets(query, config.cacheTtlMs);
      if (cached) {
        allTweets.push(...cached);
        continue;
      }

      const tweets = await searchTweets(query, maxResultsPerQuery, since);
      cacheTweets(query, tweets);
      recordSpend(tweets.length * COST_PER_TWEET);

      const newTweets = tweets.filter((t) => !seenTweets.has(t.id));
      for (const t of tweets) seenTweets.add(t.id);
      allTweets.push(...newTweets);

      console.log(`[x-search] "${query.slice(0, 40)}...": ${tweets.length} results, ${newTweets.length} new | ${getSpendSummary()}`);
      await sleep(RATE_DELAY_MS);
    } catch (error: any) {
      console.log(`[x-search] Error: ${error.message}`);
    }
  }

  saveSeenTweets(seenTweets);
  const deduped = dedupeByTweetId(allTweets);
  console.log(`[x-search] Total: ${deduped.length} unique tweets (${getSpendSummary()})`);

  if (deduped.length === 0) return [];

  const enrichments = await enrichTweetUrls(deduped);
  return judgeTweets(deduped, enrichments, "x-search");
}

// ══════════════════════════════════════════════════════
// SHARED: LLM judging with URL-enriched context
// ══════════════════════════════════════════════════════

async function judgeTweets(
  tweets: Tweet[],
  enrichments: Map<string, string>,
  tag: string
): Promise<Discovery[]> {
  if (!isJudgeAvailable() || tweets.length === 0) {
    // No LLM — use keyword scoring as fallback
    console.log(`[${tag}] No LLM judge — using keyword scoring`);
    const discoveries = tweets
      .filter(hasActionableSignals)
      .map(tweetToDiscovery);
    console.log(`[${tag}] Keyword filter: ${discoveries.length} passed`);
    return discoveries;
  }

  console.log(`[${tag}] Running LLM judge on ${tweets.length} tweets (${enrichments.size} enriched with URL content)...`);

  const inputs: JudgeInput[] = tweets.map((t) => {
    // Build content: tweet text + enriched URL content
    let content = t.text;
    const enriched = enrichments.get(t.id);
    if (enriched) {
      content += `\n\n--- Linked page content (${t.urls[0]}) ---\n${enriched}`;
    }

    return {
      content,
      source: "twitter",
      author: t.username,
      externalUrl: t.urls[0] || t.tweet_url,
      engagement: t.metrics.likes + t.metrics.retweets * 2,
    };
  });

  const verdicts = await judgeBatch(inputs, 5);

  const discoveries: Discovery[] = [];
  let skippedCount = 0;

  for (let i = 0; i < tweets.length; i++) {
    const tweet = tweets[i];
    const verdict = verdicts[i];

    if (verdict && verdict.actionable && verdict.confidence >= 0.5) {
      const s = verdict.scores;
      const allPass = s && s.utility >= 0.5 && s.downloadability >= 0.5 && s.specificity >= 0.5 && s.signal >= 0.5 && s.novelty >= 0.5;
      if (allPass || !s) {
        discoveries.push(verdictToDiscovery(tweet, verdict));
      } else {
        skippedCount++;
        const failed = Object.entries(s).filter(([, v]) => v < 0.5).map(([k]) => k).join(", ");
        console.log(`[${tag}] SKIP (score): "${tweet.text.slice(0, 50)}..." → failed: ${failed}`);
      }
    } else if (verdict && !verdict.actionable) {
      skippedCount++;
      console.log(
        `[${tag}] SKIP: "${tweet.text.slice(0, 50)}..." → ${verdict.skipReason || "Not actionable"}`
      );
    } else {
      // LLM failed — fall back to keyword check
      if (hasActionableSignals(tweet)) {
        discoveries.push(tweetToDiscovery(tweet));
      }
    }
  }

  console.log(`[${tag}] LLM judge: ${discoveries.length} passed, ${skippedCount} skipped`);
  return discoveries;
}

// ── Conversion Helpers ──

function verdictToDiscovery(tweet: Tweet, verdict: JudgeVerdict): Discovery {
  const primaryUrl = tweet.urls[0] || tweet.tweet_url;

  return createDiscovery({
    id: `x-api-${tweet.id}`,
    category: (verdict.category as Discovery["category"]) || "tool",
    title: verdict.title || tweet.text.slice(0, 60),
    oneLiner: verdict.oneLiner || tweet.text.slice(0, 120),
    what: verdict.oneLiner || tweet.text,
    why: `@${tweet.username} — ${verdict.valueProp || tweet.text.slice(0, 100)} (${tweet.metrics.likes} likes)`,
    impact: verdict.valueProp || `Shared by @${tweet.username}`,
    install: {
      steps: verdict.installHint
        ? [verdict.installHint]
        : primaryUrl !== tweet.tweet_url
          ? [`See ${primaryUrl}`]
          : [`See ${tweet.tweet_url}`],
      timeEstimate: "5 min",
    },
    source: {
      url: primaryUrl !== tweet.tweet_url ? primaryUrl : tweet.tweet_url,
      type: "twitter",
      author: tweet.username,
      date: tweet.created_at,
    },
    signals: {
      engagement: tweet.metrics.likes + tweet.metrics.retweets,
      comments: tweet.metrics.replies,
      trending: tweet.metrics.likes > 500,
    },
    security: "unverified",
  });
}

function tweetToDiscovery(tweet: Tweet): Discovery {
  const primaryUrl = tweet.urls[0] || tweet.tweet_url;
  const content = tweet.text.toLowerCase();

  let category: Discovery["category"] = "workflow";
  if (content.includes("mcp") || content.includes("api") || content.includes("sdk"))
    category = "integration";
  else if (content.includes("sandbox") || content.includes("docker") || content.includes("e2b"))
    category = "infrastructure";
  else if (content.includes("release") || content.includes("launch") || content.includes("tool"))
    category = "tool";
  else if (content.includes("openclaw") || content.includes("skill"))
    category = "skill";

  return createDiscovery({
    id: `x-api-${tweet.id}`,
    category,
    title: tweet.text.slice(0, 80) + (tweet.text.length > 80 ? "..." : ""),
    oneLiner: tweet.text.slice(0, 120),
    what: tweet.text,
    why: `@${tweet.username} (${tweet.metrics.likes} likes)`,
    impact: `Shared by @${tweet.username}`,
    install: {
      steps: primaryUrl !== tweet.tweet_url
        ? [`See ${primaryUrl}`]
        : [`See ${tweet.tweet_url}`],
      timeEstimate: "5 min",
    },
    source: {
      url: primaryUrl !== tweet.tweet_url ? primaryUrl : tweet.tweet_url,
      type: "twitter",
      author: tweet.username,
      date: tweet.created_at,
    },
    signals: {
      engagement: tweet.metrics.likes + tweet.metrics.retweets,
      comments: tweet.metrics.replies,
      trending: tweet.metrics.likes > 500,
    },
    security: "unverified",
  });
}

// ── Filtering ──

function hasActionableSignals(tweet: Tweet): boolean {
  const text = tweet.text.toLowerCase();

  if (tweet.metrics.likes < 3) return false;

  const hasExternalUrl = tweet.urls.length > 0;
  const hasInstallCmd =
    text.includes("npm install") ||
    text.includes("pip install") ||
    text.includes("npx ") ||
    text.includes("cargo install") ||
    text.includes("git clone");
  const hasCodeBlock = text.includes("```");

  if (!hasExternalUrl && !hasInstallCmd && !hasCodeBlock) return false;

  const actionableKeywords = [
    "agent", "mcp", "tool", "sdk", "api", "framework",
    "install", "deploy", "launch", "release", "ship",
    "openclaw", "x402", "claude", "langchain", "openai",
    "sandbox", "docker", "e2b", "browser", "automation",
  ];

  return actionableKeywords.some((kw) => text.includes(kw));
}

function dedupeByTweetId(tweets: Tweet[]): Tweet[] {
  const seen = new Set<string>();
  return tweets.filter((t) => {
    if (seen.has(t.id)) return false;
    seen.add(t.id);
    return true;
  });
}

export { SEARCH_QUERIES };
