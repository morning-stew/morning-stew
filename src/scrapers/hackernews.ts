import type { TwitterBuzz } from "../types"; // Reusing type for now

const HN_SEARCH_API = "https://hn.algolia.com/api/v1/search";

export interface HNScraperConfig {
  maxResults?: number;
  minPoints?: number;
  hoursAgo?: number;
}

interface HNHit {
  title: string;
  url: string | null;
  author: string;
  points: number;
  num_comments: number;
  objectID: string;
  created_at: string;
}

interface HNSearchResponse {
  hits: HNHit[];
}

/**
 * Scrape Hacker News for OpenClaw/AI agent related posts.
 * Uses the official Algolia search API (no rate limits for reasonable use).
 */
export async function scrapeHackerNews(
  config: HNScraperConfig = {}
): Promise<TwitterBuzz[]> { // Reusing TwitterBuzz type for simplicity
  const { maxResults = 10, minPoints = 5, hoursAgo = 24 } = config;

  const keywords = ["openclaw", "ai agent", "llm agent", "claude", "gpt agent"];
  const allResults: HNHit[] = [];

  console.log(`[hackernews] Searching for AI agent related posts...`);

  for (const keyword of keywords) {
    try {
      const timestamp = Math.floor(Date.now() / 1000) - hoursAgo * 3600;
      const url = `${HN_SEARCH_API}?query=${encodeURIComponent(keyword)}&tags=story&numericFilters=created_at_i>${timestamp}&hitsPerPage=20`;

      const response = await fetch(url);
      if (!response.ok) continue;

      const data = (await response.json()) as HNSearchResponse;
      allResults.push(...data.hits);
    } catch (error) {
      console.log(`[hackernews] Error searching "${keyword}":`, error);
    }
  }

  // Dedupe by objectID
  const unique = Array.from(
    new Map(allResults.map((h) => [h.objectID, h])).values()
  );

  // Filter and sort by points
  const filtered = unique
    .filter((h) => h.points >= minPoints)
    .sort((a, b) => b.points - a.points)
    .slice(0, maxResults);

  console.log(`[hackernews] Found ${filtered.length} relevant posts`);

  return filtered.map((h) => ({
    author: h.author,
    handle: `@${h.author}`,
    content: h.title,
    url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
    engagement: h.points + h.num_comments,
  }));
}
