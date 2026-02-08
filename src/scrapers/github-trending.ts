import type { Discovery, DiscoveryCategory } from "../types/discovery";
import { createDiscovery } from "../types/discovery";
import { chromium, type Browser } from "playwright";

/**
 * GitHub topics to scrape for agent-related projects.
 */
const AGENT_TOPICS = [
  "ai-agents",
  "llm-agents", 
  "autonomous-agents",
  "langchain",
  "autogpt",
  "ai-assistant",
  "code-assistant",
];

/**
 * Search queries for GitHub
 */
const SEARCH_QUERIES = [
  "mcp server",
  "claude agent",
  "llm sandbox",
  "ai agent framework",
  "code interpreter",
];

interface GitHubRepo {
  name: string;
  fullName: string;
  description: string;
  url: string;
  stars: number;
  language: string;
  topics: string[];
  readme?: string;
}

export interface GitHubTrendingConfig {
  maxResults?: number;
  minStars?: number;
  sinceDays?: number;
}

/**
 * Scrape GitHub for trending agent-related repositories.
 * 
 * Strategy:
 * 1. Search for repos with agent-related queries
 * 2. Filter by recent activity and star count
 * 3. Extract README for installation instructions
 */
export async function scrapeGitHubTrending(
  config: GitHubTrendingConfig = {}
): Promise<Discovery[]> {
  const { maxResults = 10, minStars = 50, sinceDays = 7 } = config;

  console.log(`[github-trending] Searching for agent repos...`);

  const discoveries: Discovery[] = [];
  const seenRepos = new Set<string>();

  // Use GitHub Search API
  const sinceDate = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000)
    .toISOString()
    .split("T")[0];

  for (const query of SEARCH_QUERIES) {
    try {
      const searchUrl = `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}+created:>${sinceDate}&sort=stars&order=desc&per_page=10`;

      const response = await fetch(searchUrl, {
        headers: {
          Accept: "application/vnd.github.v3+json",
          "User-Agent": "morning-stew-bot",
        },
      });

      if (!response.ok) {
        console.log(`[github-trending] API error for "${query}": ${response.status}`);
        continue;
      }

      const data = await response.json();
      const repos = data.items || [];

      for (const repo of repos) {
        if (seenRepos.has(repo.full_name)) continue;
        if (repo.stargazers_count < minStars) continue;
        
        seenRepos.add(repo.full_name);

        // Determine category based on topics and description
        const category = categorizeRepo(repo);

        // Extract install steps from common patterns
        const installSteps = generateInstallSteps(repo);

        const discovery = createDiscovery({
          id: `gh-${repo.id}`,
          category,
          title: repo.name,
          oneLiner: repo.description?.slice(0, 100) || repo.name,
          what: repo.description || `${repo.name} - ${repo.language} project`,
          why: `${repo.stargazers_count} stars, actively maintained`,
          impact: generateImpactFromTopics(repo.topics || [], category),
          install: {
            steps: installSteps,
            requirements: detectRequirements(repo),
            timeEstimate: "5 min",
          },
          source: {
            url: repo.html_url,
            type: "github",
            author: repo.owner?.login,
            date: repo.created_at,
          },
          signals: {
            engagement: repo.stargazers_count,
            trending: repo.stargazers_count > 500,
          },
        });

        discoveries.push(discovery);
      }

      // Rate limit protection
      await new Promise((r) => setTimeout(r, 1000));
    } catch (error) {
      console.log(`[github-trending] Error searching "${query}":`, error);
    }
  }

  // Sort by stars and limit
  const sorted = discoveries
    .sort((a, b) => (b.signals?.engagement || 0) - (a.signals?.engagement || 0))
    .slice(0, maxResults);

  console.log(`[github-trending] Found ${sorted.length} repos`);
  return sorted;
}

function categorizeRepo(repo: any): DiscoveryCategory {
  const text = `${repo.name} ${repo.description || ""} ${(repo.topics || []).join(" ")}`.toLowerCase();

  if (text.includes("sandbox") || text.includes("container") || text.includes("vm") || text.includes("isolated")) {
    return "infrastructure";
  }
  if (text.includes("local") || text.includes("private") || text.includes("self-host") || text.includes("ollama")) {
    return "privacy";
  }
  if (text.includes("mcp") || text.includes("integration") || text.includes("api") || text.includes("browser")) {
    return "integration";
  }
  if (text.includes("cli") || text.includes("tool") || text.includes("utility")) {
    return "tool";
  }
  if (text.includes("security") || text.includes("safe") || text.includes("permission")) {
    return "security";
  }
  if (text.includes("model") || text.includes("fine-tune") || text.includes("llm")) {
    return "model";
  }
  if (text.includes("agent") || text.includes("workflow") || text.includes("automation")) {
    return "workflow";
  }
  
  return "tool";
}

function generateInstallSteps(repo: any): string[] {
  const steps: string[] = [];
  const lang = (repo.language || "").toLowerCase();
  const name = repo.name;
  const fullName = repo.full_name;

  // Clone step is always first
  steps.push(`git clone https://github.com/${fullName}.git`);
  steps.push(`cd ${name}`);

  // Language-specific install
  if (lang === "python") {
    steps.push("pip install -r requirements.txt  # or: pip install -e .");
  } else if (lang === "javascript" || lang === "typescript") {
    steps.push("npm install  # or: pnpm install");
  } else if (lang === "rust") {
    steps.push("cargo build --release");
  } else if (lang === "go") {
    steps.push("go build");
  }

  // Check for common patterns in description
  const desc = (repo.description || "").toLowerCase();
  if (desc.includes("docker")) {
    steps.push("# Docker: docker-compose up");
  }

  return steps;
}

function detectRequirements(repo: any): string[] {
  const reqs: string[] = [];
  const lang = (repo.language || "").toLowerCase();

  if (lang === "python") reqs.push("Python 3.8+");
  if (lang === "javascript" || lang === "typescript") reqs.push("Node.js 18+");
  if (lang === "rust") reqs.push("Rust/Cargo");
  if (lang === "go") reqs.push("Go 1.20+");

  const desc = (repo.description || "").toLowerCase();
  if (desc.includes("docker")) reqs.push("Docker");
  if (desc.includes("gpu") || desc.includes("cuda")) reqs.push("NVIDIA GPU");

  return reqs;
}

function generateImpactFromTopics(topics: string[], category: DiscoveryCategory): string {
  const topicStr = topics.slice(0, 3).join(", ");
  
  const categoryImpacts: Record<DiscoveryCategory, string> = {
    infrastructure: "Run agents in isolated environments safely",
    privacy: "Keep your data and conversations private",
    integration: "Connect your agent to external systems",
    workflow: "Automate complex multi-step tasks",
    tool: "Enhance your development workflow",
    security: "Protect against malicious agent actions",
    model: "Access specialized AI capabilities",
    skill: "Add new capabilities to your agent",
  };

  return categoryImpacts[category] + (topicStr ? ` (${topicStr})` : "");
}
