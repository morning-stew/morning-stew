import type { Discovery, DiscoveryCategory } from "../types/discovery";
import { createDiscovery } from "../types/discovery";

/**
 * Search queries for GitHub — expanded for better coverage
 */
const SEARCH_QUERIES = [
  // Core agent infrastructure
  "mcp server",
  "claude agent",
  "ai agent framework",
  "llm sandbox",
  "code interpreter",
  // Agentic tooling
  "agent tool",
  "ai coding assistant",
  "llm tool use",
  "function calling",
  // Multi-agent / orchestration
  "multi agent",
  "agent orchestration",
  "crew ai",
  // Specific ecosystems
  "openai agents",
  "anthropic claude",
  "langchain agent",
  "autogen",
  // Infrastructure
  "e2b sandbox",
  "docker ai agent",
  "wasm agent",
  // Skills / plugins
  "openclaw",
  "agent skill",
  "agent plugin",
];

interface GitHubRepo {
  name: string;
  fullName: string;
  description: string;
  url: string;
  stars: number;
  forks: number;
  language: string;
  topics: string[];
  readme?: string;
  lastPush?: string;
}

export interface GitHubTrendingConfig {
  maxResults?: number;
  minStars?: number;
  sinceDays?: number;
}

const GITHUB_TOKEN = process.env.GITHUB_TOKEN || "";

function githubHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "morning-stew-bot",
  };
  if (GITHUB_TOKEN) {
    headers["Authorization"] = `Bearer ${GITHUB_TOKEN}`;
  }
  return headers;
}

/**
 * Scrape GitHub for trending agent-related repositories.
 * 
 * Strategy:
 * 1. Search for repos with agent-related queries (authenticated for higher rate limits)
 * 2. Filter by recent activity and star count
 * 3. Fetch README for real installation instructions
 * 4. Score and rank results
 */
export async function scrapeGitHubTrending(
  config: GitHubTrendingConfig = {}
): Promise<Discovery[]> {
  const { maxResults = 15, minStars = 30, sinceDays = 7 } = config;

  console.log(`[github-trending] Searching for agent repos (auth: ${!!GITHUB_TOKEN})...`);

  const discoveries: Discovery[] = [];
  const seenRepos = new Set<string>();

  const sinceDate = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000)
    .toISOString()
    .split("T")[0];

  for (const query of SEARCH_QUERIES) {
    try {
      const searchUrl = `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}+created:>${sinceDate}&sort=stars&order=desc&per_page=10`;

      const response = await fetch(searchUrl, { headers: githubHeaders() });

      if (response.status === 403 || response.status === 429) {
        const resetHeader = response.headers.get("x-ratelimit-reset");
        const resetIn = resetHeader ? Math.max(0, Number(resetHeader) - Math.floor(Date.now() / 1000)) : 60;
        console.log(`[github-trending] Rate limited. Resets in ${resetIn}s. Waiting...`);
        await new Promise((r) => setTimeout(r, Math.min(resetIn * 1000, 30000)));
        continue;
      }

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

        // Fetch README for real install instructions
        const readmeInstall = await fetchReadmeInstallSteps(repo.full_name);

        const category = categorizeRepo(repo);

        // Use real install steps from README, fallback to heuristic
        const installSteps = readmeInstall.steps.length > 0
          ? readmeInstall.steps
          : generateFallbackInstallSteps(repo);

        const requirements = readmeInstall.requirements.length > 0
          ? readmeInstall.requirements
          : detectRequirements(repo);

        const discovery = createDiscovery({
          id: `gh-${repo.id}`,
          category,
          title: repo.name,
          oneLiner: repo.description?.slice(0, 120) || repo.name,
          what: repo.description || `${repo.name} - ${repo.language} project`,
          why: buildWhyStatement(repo),
          impact: generateImpactFromTopics(repo.topics || [], category),
          install: {
            steps: installSteps,
            requirements,
            timeEstimate: estimateInstallTime(installSteps),
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

      // Rate limit protection — shorter with auth
      await new Promise((r) => setTimeout(r, GITHUB_TOKEN ? 300 : 1500));
    } catch (error) {
      console.log(`[github-trending] Error searching "${query}":`, error);
    }
  }

  // Sort by stars and limit
  const sorted = discoveries
    .sort((a, b) => (b.signals?.engagement || 0) - (a.signals?.engagement || 0))
    .slice(0, maxResults);

  console.log(`[github-trending] Found ${sorted.length} repos from ${SEARCH_QUERIES.length} queries`);
  return sorted;
}

/**
 * Fetch and parse README for real install instructions.
 * This is the key improvement — instead of guessing install steps from language,
 * we actually read the README and extract real commands.
 */
async function fetchReadmeInstallSteps(
  fullName: string
): Promise<{ steps: string[]; requirements: string[] }> {
  const empty = { steps: [], requirements: [] };

  try {
    const response = await fetch(
      `https://api.github.com/repos/${fullName}/readme`,
      { headers: githubHeaders() }
    );

    if (!response.ok) return empty;

    const data = await response.json();
    const content = Buffer.from(data.content, "base64").toString("utf-8");

    return parseReadmeForInstall(content, fullName);
  } catch {
    return empty;
  }
}

/**
 * Parse a README for install/setup instructions.
 * Looks for install sections, code blocks within them, and command patterns.
 */
function parseReadmeForInstall(
  readme: string,
  fullName: string
): { steps: string[]; requirements: string[] } {
  const steps: string[] = [];
  const requirements: string[] = [];

  // Find install/setup/quickstart sections
  const installSectionRegex = /(?:^|\n)#{1,3}\s*(?:install(?:ation)?|setup|getting\s*started|quick\s*start|usage)\b[^\n]*/gi;
  const sections = [...readme.matchAll(installSectionRegex)];

  let installSection = "";

  if (sections.length > 0) {
    // Get content between this header and the next header of same or higher level
    const firstMatch = sections[0];
    const startIndex = firstMatch.index! + firstMatch[0].length;
    const headerLevel = (firstMatch[0].match(/^#{1,3}/)?.[0] || "##").length;

    // Find next header of same or higher level
    const nextHeaderRegex = new RegExp(`\n#{1,${headerLevel}}\\s+`, "g");
    nextHeaderRegex.lastIndex = startIndex;
    const nextHeader = nextHeaderRegex.exec(readme);

    installSection = readme.slice(startIndex, nextHeader ? nextHeader.index : startIndex + 3000);
  } else {
    // No install section found — scan the entire README (first 4000 chars)
    installSection = readme.slice(0, 4000);
  }

  // Extract code blocks from install section
  const codeBlockRegex = /```(?:bash|sh|shell|zsh|console|terminal|powershell)?\n([\s\S]*?)```/g;
  let match;

  while ((match = codeBlockRegex.exec(installSection)) !== null) {
    const block = match[1].trim();
    const lines = block.split("\n");

    for (const line of lines) {
      const cleaned = line.replace(/^\$\s*/, "").replace(/^>\s*/, "").trim();
      if (cleaned && isInstallCommand(cleaned) && cleaned.length < 200) {
        steps.push(cleaned);
      }
    }
  }

  // Also look for inline commands in the install section
  const inlineCommandRegex = /`([^`]{5,120})`/g;
  while ((match = inlineCommandRegex.exec(installSection)) !== null) {
    const cmd = match[1].trim();
    if (isInstallCommand(cmd) && !steps.includes(cmd)) {
      steps.push(cmd);
    }
  }

  // If we found zero steps in the install section, look for common patterns anywhere
  if (steps.length === 0) {
    const commonPatterns = [
      /(?:npm|pnpm|yarn)\s+(?:install|add|i)\s+\S+/g,
      /pip3?\s+install\s+\S+/g,
      /cargo\s+install\s+\S+/g,
      /brew\s+install\s+\S+/g,
      /go\s+install\s+\S+/g,
      /docker\s+(?:run|pull|compose)\s+\S+/g,
    ];

    for (const pattern of commonPatterns) {
      const matches = readme.match(pattern);
      if (matches) {
        for (const m of matches.slice(0, 2)) {
          if (!steps.includes(m)) steps.push(m);
        }
      }
    }
  }

  // If still no steps, add clone as fallback
  if (steps.length === 0) {
    steps.push(`git clone https://github.com/${fullName}.git`);
    steps.push(`cd ${fullName.split("/")[1]}`);
    steps.push("# Check README for setup instructions");
  }

  // Extract requirements
  const reqPatterns = [
    { pattern: /(?:python|py)\s*(?:>=?\s*)?(\d[\d.]+)/i, req: (m: RegExpMatchArray) => `Python ${m[1]}+` },
    { pattern: /(?:node(?:\.?js)?)\s*(?:>=?\s*)?(\d[\d.]+)/i, req: (m: RegExpMatchArray) => `Node.js ${m[1]}+` },
    { pattern: /(?:rust|cargo)\s*(?:>=?\s*)?(\d[\d.]+)?/i, req: () => "Rust/Cargo" },
    { pattern: /(?:go(?:lang)?)\s*(?:>=?\s*)?(\d[\d.]+)/i, req: (m: RegExpMatchArray) => `Go ${m[1] || "1.20"}+` },
    { pattern: /docker/i, req: () => "Docker" },
    { pattern: /(?:gpu|cuda|nvidia)/i, req: () => "NVIDIA GPU (optional)" },
  ];

  for (const { pattern, req } of reqPatterns) {
    const m = installSection.match(pattern);
    if (m) {
      const r = req(m);
      if (!requirements.includes(r)) requirements.push(r);
    }
  }

  // Post-process: split any multiline steps, clean up broken entries
  const cleanedSteps = steps
    .flatMap((s) => s.split("\n")) // Split any embedded newlines
    .map((s) => s.replace(/^\$\s*/, "").replace(/^>\s*/, "").trim())
    .filter((s) => s.length > 2 && s.length < 200)
    .filter((s) => !s.startsWith("#") || isInstallCommand(s)) // Keep comments only if they look like commands
    .filter((s) => !s.match(/^```/)) // Remove stray code fence markers
    .filter((s) => !s.match(/^\s*\n/)) // Remove blank-ish lines

  // Dedupe and limit
  return {
    steps: [...new Set(cleanedSteps)].slice(0, 6),
    requirements: [...new Set(requirements)],
  };
}

function isInstallCommand(text: string): boolean {
  const installIndicators = [
    /^(?:npm|pnpm|yarn|bun)\s+(?:install|add|i|create|init)/,
    /^pip3?\s+install/,
    /^(?:cargo|go)\s+(?:install|build|get)/,
    /^(?:brew|apt|apt-get|yum|dnf|pacman)\s+install/,
    /^git\s+clone/,
    /^(?:docker|docker-compose|podman)\s+(?:run|pull|compose|build)/,
    /^curl\s+-[fsSLo]/,
    /^wget\s+/,
    /^(?:cd|mkdir)\s+/,
    /^npx\s+/,
    /^python3?\s+(?:-m|setup\.py)/,
    /^(?:make|cmake)\b/,
    /^(?:sudo\s+)?(?:apt|apt-get|brew|yum)\s/,
    /^(?:export|source|\.\/)/,
  ];

  return installIndicators.some((pattern) => pattern.test(text.trim()));
}

function categorizeRepo(repo: any): DiscoveryCategory {
  const text = `${repo.name} ${repo.description || ""} ${(repo.topics || []).join(" ")}`.toLowerCase();

  if (text.includes("sandbox") || text.includes("container") || text.includes("vm") || text.includes("isolated") || text.includes("e2b")) {
    return "infrastructure";
  }
  if (text.includes("local") || text.includes("private") || text.includes("self-host") || text.includes("ollama")) {
    return "privacy";
  }
  if (text.includes("mcp") || text.includes("integration") || text.includes("browser") || text.includes("connector")) {
    return "integration";
  }
  if (text.includes("security") || text.includes("safe") || text.includes("permission") || text.includes("guard")) {
    return "security";
  }
  if (text.includes("model") || text.includes("fine-tune") || text.includes("llm") || text.includes("gguf")) {
    return "model";
  }
  if (text.includes("agent") || text.includes("workflow") || text.includes("automation") || text.includes("orchestrat")) {
    return "workflow";
  }
  if (text.includes("skill") || text.includes("plugin") || text.includes("openclaw")) {
    return "skill";
  }
  if (text.includes("cli") || text.includes("tool") || text.includes("utility") || text.includes("sdk")) {
    return "tool";
  }

  return "tool";
}

function generateFallbackInstallSteps(repo: any): string[] {
  const steps: string[] = [];
  const lang = (repo.language || "").toLowerCase();
  const name = repo.name;
  const fullName = repo.full_name;

  steps.push(`git clone https://github.com/${fullName}.git`);
  steps.push(`cd ${name}`);

  if (lang === "python") {
    steps.push("pip3 install -r requirements.txt  # or: pip3 install -e .");
  } else if (lang === "javascript" || lang === "typescript") {
    steps.push("npm install  # or: pnpm install");
  } else if (lang === "rust") {
    steps.push("cargo build --release");
  } else if (lang === "go") {
    steps.push("go build ./...");
  }

  const desc = (repo.description || "").toLowerCase();
  if (desc.includes("docker")) {
    steps.push("docker compose up  # if Docker preferred");
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

function buildWhyStatement(repo: any): string {
  const parts: string[] = [];

  const stars = repo.stargazers_count;
  if (stars >= 1000) parts.push(`${(stars / 1000).toFixed(1)}k stars`);
  else parts.push(`${stars} stars`);

  if (repo.forks_count >= 50) parts.push(`${repo.forks_count} forks`);

  const daysSinceUpdate = Math.floor(
    (Date.now() - new Date(repo.pushed_at).getTime()) / (1000 * 60 * 60 * 24)
  );
  if (daysSinceUpdate <= 1) parts.push("updated today");
  else if (daysSinceUpdate <= 7) parts.push(`updated ${daysSinceUpdate}d ago`);

  if (repo.language) parts.push(repo.language);

  return parts.join(", ");
}

function estimateInstallTime(steps: string[]): string {
  const hasDocker = steps.some((s) => s.includes("docker"));
  const hasCompile = steps.some((s) => s.includes("cargo build") || s.includes("make") || s.includes("go build"));

  if (hasDocker) return "5-10 min";
  if (hasCompile) return "5 min";
  if (steps.length <= 2) return "1 min";
  if (steps.length <= 4) return "3 min";
  return "5 min";
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
