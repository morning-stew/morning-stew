import type { Discovery, DiscoveryCategory } from "../types/discovery";
import { createDiscovery } from "../types/discovery";

const HN_SEARCH_API = "https://hn.algolia.com/api/v1/search";
const HN_ITEM_API = "https://hn.algolia.com/api/v1/items";

/**
 * Search queries designed to find actionable agent content.
 * Organized by what we're looking for.
 */
const SEARCH_STRATEGIES = {
  // Infrastructure: VMs, sandboxing, containers for agents
  infrastructure: [
    "ai agent sandbox",
    "llm agent docker",
    "claude sandbox",
    "agent vm",
    "e2b",
    "firecracker agent",
    "code interpreter sandbox",
    "wasm agent",
    "agent container",
  ],
  // Privacy: Local, self-hosted, private agent setups
  privacy: [
    "local llm agent",
    "self-hosted agent",
    "private ai agent",
    "ollama agent",
    "local code assistant",
    "on-device llm",
    "private coding assistant",
  ],
  // Integration: Real-world connections
  integration: [
    "home assistant llm",
    "agent automation",
    "claude api integration",
    "mcp server",
    "agent browser",
    "ai browser automation",
    "playwright ai",
    "agent api",
    "function calling",
  ],
  // Workflow: Stories of what people built
  workflow: [
    "built with claude",
    "my ai agent",
    "automated with gpt",
    "agent workflow",
    "Show HN agent",
    "multi-agent",
    "agent orchestration",
    "crew ai",
    "autogen agent",
  ],
  // Tools: Developer tools for agents
  tool: [
    "cli ai agent",
    "agent tool",
    "llm cli",
    "terminal ai",
    "aider",
    "cursor",
    "continue dev",
    "ai coding",
    "code generation tool",
    "agent sdk",
  ],
  // Skills: Agent capabilities and plugins
  skill: [
    "openclaw",
    "agent skill",
    "agent plugin",
    "mcp tool",
    "claude tool",
    "x402",
    "ai micropayment",
  ],
};

interface HNHit {
  title: string;
  url: string | null;
  author: string;
  points: number;
  num_comments: number;
  objectID: string;
  created_at: string;
  story_text?: string;
}

interface HNItem {
  id: number;
  title: string;
  url: string | null;
  author: string;
  points: number;
  children?: HNComment[];
  text?: string;
}

interface HNComment {
  id: number;
  author: string;
  text: string;
  children?: HNComment[];
}

export interface DiscoveryScraperConfig {
  maxPerCategory?: number;
  minPoints?: number;
  hoursAgo?: number;
  enrichWithComments?: boolean;
}

/**
 * Simple retry wrapper for fetch calls
 */
async function fetchWithRetry(url: string, retries = 2): Promise<Response> {
  for (let i = 0; i <= retries; i++) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
      if (response.status >= 500 && i < retries) {
        await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
        continue;
      }
      return response;
    } catch (error) {
      if (i === retries) throw error;
      await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
    }
  }
  throw new Error("fetchWithRetry exhausted");
}

/**
 * Scrape HackerNews for actionable discoveries.
 * 
 * Strategy:
 * 1. Search with category-specific queries
 * 2. For high-signal posts, fetch comments to extract install steps
 * 3. Use LLM-style heuristics to identify actionable content
 */
export async function scrapeDiscoveries(
  config: DiscoveryScraperConfig = {}
): Promise<Discovery[]> {
  const { 
    maxPerCategory = 3, 
    minPoints = 10, 
    hoursAgo = 48,
    enrichWithComments = true,
  } = config;

  const discoveries: Discovery[] = [];
  const seenUrls = new Set<string>();

  console.log(`[discoveries] Starting HN discovery scrape...`);

  for (const [category, queries] of Object.entries(SEARCH_STRATEGIES)) {
    const categoryHits: HNHit[] = [];

    for (const query of queries) {
      try {
        const timestamp = Math.floor(Date.now() / 1000) - hoursAgo * 3600;
        const url = `${HN_SEARCH_API}?query=${encodeURIComponent(query)}&tags=story&numericFilters=created_at_i>${timestamp}&hitsPerPage=10`;

        const response = await fetchWithRetry(url);
        if (!response.ok) continue;

        const data = await response.json();
        categoryHits.push(...(data.hits as HNHit[]));
      } catch (error) {
        console.log(`[discoveries] Error searching "${query}":`, error);
      }
    }

    // Dedupe and sort by points
    const unique = Array.from(
      new Map(categoryHits.map((h) => [h.objectID, h])).values()
    );

    const filtered = unique
      .filter((h) => h.points >= minPoints)
      .filter((h) => !seenUrls.has(h.url || h.objectID))
      .sort((a, b) => b.points - a.points)
      .slice(0, maxPerCategory);

    console.log(`[discoveries] ${category}: ${filtered.length} hits`);

    // Convert hits to discoveries
    for (const hit of filtered) {
      const sourceUrl = hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`;
      
      // Skip non-actionable posts (pure narrative/discussion)
      if (!isActionablePost(hit, sourceUrl)) {
        continue;
      }
      
      seenUrls.add(sourceUrl);

      // Fetch comments for high-signal posts to extract install steps
      let installSteps: string[] = [];
      let enrichedContext = "";

      if (enrichWithComments && hit.points >= 20) {
        const itemData = await fetchHNItem(hit.objectID);
        if (itemData) {
          const extracted = extractInstallSteps(itemData);
          installSteps = extracted.steps;
          enrichedContext = extracted.context;
        }
      }

      // If no install steps found, generate reasonable defaults
      if (installSteps.length === 0) {
        installSteps = generateDefaultSteps(hit, sourceUrl);
      }
      
      // Clean up install steps - decode HTML entities, remove broken ones
      installSteps = installSteps
        .map((s) => decodeHtmlEntities(s))
        .filter((s) => !s.includes("<a") && !s.includes("</a>")) // Remove HTML link fragments
        .filter((s) => s.length > 3); // Remove too-short steps
      
      // If all steps got filtered, use defaults
      if (installSteps.length === 0) {
        installSteps = generateDefaultSteps(hit, sourceUrl);
      }

      const discovery = createDiscovery({
        id: `hn-${hit.objectID}`,
        category: category as DiscoveryCategory,
        title: cleanTitle(hit.title),
        oneLiner: generateOneLiner(hit.title, category),
        what: hit.title,
        why: generateWhy(hit.title, category, hit.points),
        impact: generateImpact(category),
        install: {
          steps: installSteps,
          timeEstimate: estimateTime(installSteps),
        },
        source: {
          url: sourceUrl,
          type: "hackernews",
          author: hit.author,
          date: hit.created_at,
        },
        signals: {
          engagement: hit.points,
          comments: hit.num_comments,
          trending: hit.points > 50,
        },
      });

      discoveries.push(discovery);
    }
  }

  console.log(`[discoveries] Total: ${discoveries.length} discoveries`);
  return discoveries;
}

async function fetchHNItem(objectId: string): Promise<HNItem | null> {
  try {
    const response = await fetchWithRetry(`${HN_ITEM_API}/${objectId}`);
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

/**
 * Extract installation steps from HN comments.
 * Looks for code blocks, commands, and step-by-step instructions.
 */
function extractInstallSteps(item: HNItem): { steps: string[]; context: string } {
  const steps: string[] = [];
  const contextParts: string[] = [];

  // Check the post text first
  if (item.text) {
    const extracted = extractFromText(item.text);
    steps.push(...extracted.commands);
    if (extracted.context) contextParts.push(extracted.context);
  }

  // Check top-level comments (often have setup instructions)
  if (item.children) {
    for (const comment of item.children.slice(0, 5)) {
      if (comment.text) {
        const extracted = extractFromText(comment.text);
        steps.push(...extracted.commands);
      }
    }
  }

  return {
    steps: [...new Set(steps)].slice(0, 5), // Dedupe and limit
    context: contextParts.join(" ").slice(0, 200),
  };
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, "/")
    .replace(/&nbsp;/g, " ");
}

function extractFromText(text: string): { commands: string[]; context: string } {
  const commands: string[] = [];
  
  // Decode HTML entities first
  text = decodeHtmlEntities(text);
  
  // Match code blocks (```...```)
  const codeBlockRegex = /```[\s\S]*?```/g;
  const codeBlocks = text.match(codeBlockRegex) || [];
  
  for (const block of codeBlocks) {
    const code = block.replace(/```/g, "").trim();
    // Only include if it looks like a command
    if (isLikelyCommand(code)) {
      commands.push(code.split("\n")[0]); // First line only
    }
  }
  
  // Match inline code that looks like commands
  const inlineCodeRegex = /`([^`]+)`/g;
  let match;
  while ((match = inlineCodeRegex.exec(text)) !== null) {
    const code = match[1];
    if (isLikelyCommand(code) && code.length < 100) {
      commands.push(code);
    }
  }
  
  // Match common command patterns directly in text
  const commandPatterns = [
    /(?:^|\s)(pip install [^\s]+)/gm,
    /(?:^|\s)(npm install [^\s]+)/gm,
    /(?:^|\s)(pnpm add [^\s]+)/gm,
    /(?:^|\s)(brew install [^\s]+)/gm,
    /(?:^|\s)(cargo install [^\s]+)/gm,
    /(?:^|\s)(curl -[^\s]+ [^\s]+)/gm,
    /(?:^|\s)(git clone [^\s]+)/gm,
    /(?:^|\s)(docker run [^\s]+)/gm,
  ];
  
  for (const pattern of commandPatterns) {
    const matches = text.match(pattern) || [];
    commands.push(...matches.map((m) => m.trim()));
  }
  
  // Extract context (first sentence without HTML)
  const plainText = text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const context = plainText.split(/[.!?]/)[0] || "";
  
  return { commands, context };
}

function isLikelyCommand(text: string): boolean {
  const commandIndicators = [
    /^(npm|pnpm|yarn|pip|brew|cargo|go|docker|kubectl|curl|wget|git|apt|yum)/,
    /^(sudo|cd|mkdir|chmod|export|source)/,
    /install/i,
    /^[a-z]+ (run|start|init|create|add)/,
  ];
  
  return commandIndicators.some((pattern) => pattern.test(text.trim()));
}

/**
 * Check if a post is actionable (has something to install/try).
 * Filters out pure narrative/discussion posts.
 */
function isActionablePost(hit: HNHit, url: string): boolean {
  // GitHub links are actionable
  if (url.includes("github.com")) return true;
  
  // Show HN posts usually have something to try
  if (hit.title.includes("Show HN")) return true;
  
  // Blog posts with tutorials are usually actionable
  if (url.includes("blog") || url.includes("tutorial") || url.includes("guide")) return true;
  
  // Product launches
  if (hit.title.toLowerCase().includes("launch") || hit.title.toLowerCase().includes("introducing")) return true;
  
  // Discussion/narrative posts are NOT actionable
  const narrativePatterns = [
    /we're cooked/i,
    /ask hn/i,
    /what do you think/i,
    /opinion on/i,
    /my experience with/i,
    /why i (left|quit|stopped)/i,
  ];
  
  if (narrativePatterns.some((p) => p.test(hit.title))) return false;
  
  // If it's just a HN discussion link, not actionable
  if (url.includes("news.ycombinator.com/item")) return false;
  
  // Default: give it a chance
  return true;
}

function generateDefaultSteps(hit: HNHit, url: string): string[] {
  const steps: string[] = [];
  
  // If there's a GitHub URL, suggest cloning
  if (url.includes("github.com")) {
    const repoMatch = url.match(/github\.com\/([^\/]+\/[^\/]+)/);
    if (repoMatch) {
      // Clean repo path — remove trailing /blob, /tree, etc.
      const repoPath = repoMatch[1].replace(/\/(blob|tree|wiki|issues|pulls).*$/, "");
      const repoName = repoPath.split("/")[1];
      steps.push(`git clone https://github.com/${repoPath}.git`);
      steps.push(`cd ${repoName}`);
      steps.push("# See README for setup instructions");
    }
  } else if (steps.length === 0) {
    // Non-GitHub URL — just link to it
    steps.push(`# See ${url} for details`);
  }
  
  return steps;
}

function cleanTitle(title: string): string {
  return title
    .replace(/^Show HN:\s*/i, "")
    .replace(/^Ask HN:\s*/i, "")
    .replace(/^Tell HN:\s*/i, "")
    .trim();
}

function generateOneLiner(title: string, category: string): string {
  const cleaned = cleanTitle(title);
  const categoryContext: Record<string, string> = {
    infrastructure: "Run agents safely",
    privacy: "Keep your data local",
    integration: "Connect your agent to the real world",
    workflow: "Automate your workflows",
    tool: "Boost your agent productivity",
    security: "Secure your agent setup",
    model: "Upgrade your agent's brain",
    skill: "Add new capabilities",
  };
  
  return `${cleaned.slice(0, 80)}${cleaned.length > 80 ? "..." : ""}`;
}

function generateWhy(title: string, category: string, points: number): string {
  const popularity = points > 100 ? "highly popular" : points > 50 ? "trending" : "interesting";
  return `${popularity} on HN (${points} points) - relevant for ${category}`;
}

function generateImpact(category: string): string {
  const impacts: Record<string, string> = {
    infrastructure: "Safely execute agent code without risking your system",
    privacy: "Run agents locally without sending data to external services",
    integration: "Connect your agent to real-world systems and APIs",
    workflow: "Automate repetitive tasks with agent assistance",
    tool: "Streamline your development workflow with AI",
    security: "Protect your system from potentially harmful agent actions",
    model: "Access more capable or specialized AI models",
    skill: "Expand what your agent can do",
  };
  
  return impacts[category] || "Enhance your agent capabilities";
}

function estimateTime(steps: string[]): string {
  if (steps.length <= 1) return "1 min";
  if (steps.length <= 3) return "5 min";
  return "10+ min";
}

// Export for testing
export { SEARCH_STRATEGIES, extractInstallSteps };
