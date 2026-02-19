import type { Discovery } from "../types/discovery";

/**
 * Quality Rubric for Newsletter Curation
 * 
 * Each discovery is scored 0-5 based on:
 * 1. Novel value - Does it solve a problem existing tools don't?
 * 2. Evidence of real usage - Stars, issues, forks, community discussion
 * 3. Reasonable install process - Clear, documented install path
 * 4. Documentation quality - Enough docs to get started
 * 5. Genuine utility - Would an experienced engineer find this useful?
 * 
 * Minimum score of 3/5 required for inclusion.
 */

export interface QualityScore {
  total: number;            // 0-5
  novelValue: number;       // 0-1
  realUsage: number;        // 0-1
  installProcess: number;   // 0-1
  documentation: number;    // 0-1
  genuineUtility: number;   // 0-1
  reasons: string[];        // Why this score
}

export interface CuratedDiscovery extends Discovery {
  qualityScore: QualityScore;
  valueProp: string;        // One-line answer to "why should I care?"
  skipReason?: string;      // If skipped, why
}

export interface CurationResult {
  picks: CuratedDiscovery[];           // Made the cut (score >= 3)
  onRadar: CuratedDiscovery[];         // Promising but not ready (score 2)
  skipped: CuratedDiscovery[];         // Didn't make it (score < 2)
  isQuietWeek: boolean;                // < 3 quality picks
}

/**
 * GitHub repo metadata for quality assessment
 */
export interface RepoMetadata {
  stars: number;
  forks: number;
  openIssues: number;
  lastCommitDaysAgo: number;
  hasReadme: boolean;
  hasInstallDocs: boolean;
  contributorCount: number;
  isArchived: boolean;
}

function githubHeaders(): Record<string, string> {
  const githubToken = process.env.GITHUB_TOKEN || "";
  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "morning-stew-bot",
  };
  if (githubToken) {
    headers["Authorization"] = `Bearer ${githubToken}`;
  }
  return headers;
}

/**
 * Simple retry wrapper for fetch calls
 */
async function fetchWithRetry(url: string, options: RequestInit, retries = 2): Promise<Response> {
  for (let i = 0; i <= retries; i++) {
    try {
      const response = await fetch(url, options);
      if (response.status === 403 || response.status === 429) {
        // Rate limited — wait and retry
        const waitMs = Math.pow(2, i) * 2000;
        console.log(`[quality] Rate limited on ${url}, retrying in ${waitMs}ms...`);
        await new Promise((r) => setTimeout(r, waitMs));
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
 * Fetch GitHub repo metadata for quality scoring (with auth + retries)
 */
export async function fetchRepoMetadata(repoUrl: string): Promise<RepoMetadata | null> {
  const match = repoUrl.match(/github\.com\/([^/]+)\/([^/]+)/);
  if (!match) return null;

  const [, owner, repo] = match;
  const cleanRepo = repo.replace(/\.git$/, "").split("#")[0].split("?")[0];

  try {
    const response = await fetchWithRetry(
      `https://api.github.com/repos/${owner}/${cleanRepo}`,
      { headers: githubHeaders() }
    );

    if (!response.ok) return null;

    const data = await response.json();

    // Check last commit
    let lastCommitDaysAgo = 999;
    try {
      const commitsRes = await fetchWithRetry(
        `https://api.github.com/repos/${owner}/${cleanRepo}/commits?per_page=1`,
        { headers: githubHeaders() }
      );
      if (commitsRes.ok) {
        const commits = await commitsRes.json();
        if (commits[0]?.commit?.author?.date) {
          const lastCommit = new Date(commits[0].commit.author.date);
          lastCommitDaysAgo = Math.floor((Date.now() - lastCommit.getTime()) / (1000 * 60 * 60 * 24));
        }
      }
    } catch {
      // Ignore commit fetch errors
    }

    // Check README content — look for more specific install indicators
    let hasInstallDocs = false;
    let readmeQuality = 0; // 0-3 scale
    try {
      const readmeRes = await fetchWithRetry(
        `https://api.github.com/repos/${owner}/${cleanRepo}/readme`,
        { headers: githubHeaders() }
      );
      if (readmeRes.ok) {
        const readmeData = await readmeRes.json();
        const content = Buffer.from(readmeData.content, "base64").toString("utf-8").toLowerCase();

        // Check for install section headers
        const hasInstallHeader = /#{1,3}\s*(install|setup|getting\s*started|quick\s*start)/i.test(content);
        // Check for code blocks with commands
        const hasCodeBlocks = /```(?:bash|sh|shell)?\n.*(?:npm|pip|cargo|brew|git clone|docker)/s.test(content);
        // Check for inline install commands
        const hasInlineCommands = /`(?:npm|pip|cargo|brew)\s+install\s+/i.test(content);

        hasInstallDocs = hasInstallHeader || hasCodeBlocks || hasInlineCommands;

        // README quality scoring
        if (content.length > 3000) readmeQuality++;
        if (hasInstallHeader) readmeQuality++;
        if (hasCodeBlocks || hasInlineCommands) readmeQuality++;
      }
    } catch {
      // Ignore readme fetch errors
    }

    return {
      stars: data.stargazers_count || 0,
      forks: data.forks_count || 0,
      openIssues: data.open_issues_count || 0,
      lastCommitDaysAgo,
      hasReadme: data.size > 0,
      hasInstallDocs,
      contributorCount: data.network_count || data.forks_count || 1,
      isArchived: data.archived || false,
    };
  } catch (error) {
    console.log(`[quality] Error fetching repo metadata for ${repoUrl}:`, error);
    return null;
  }
}

/**
 * Score a discovery against the quality rubric
 */
export async function scoreDiscovery(discovery: Discovery): Promise<QualityScore> {
  const reasons: string[] = [];
  let novelValue = 0;
  let realUsage = 0;
  let installProcess = 0;
  let documentation = 0;
  let genuineUtility = 0;

  // 1. Novel Value - Check if title/description suggests unique capability
  const text = `${discovery.title} ${discovery.what} ${discovery.oneLiner}`.toLowerCase();

  // Strong novelty signals
  const strongNovelKeywords = [
    "first", "only", "new approach", "novel", "unique", "unlike",
    "alternative to", "replaces", "better than", "faster than",
    "introducing", "launch", "show hn", "open source",
  ];
  // Moderate novelty signals — specific to the agent ecosystem
  const agentSpecificKeywords = [
    "mcp", "x402", "openclaw", "claude", "anthropic",
    "function calling", "tool use", "agent", "sandbox",
    "multi-agent", "orchestration", "agentic",
  ];

  const strongHits = strongNovelKeywords.filter((k) => text.includes(k));
  const agentHits = agentSpecificKeywords.filter((k) => text.includes(k));

  if (strongHits.length >= 2) {
    novelValue = 1;
    reasons.push(`Strong novelty: ${strongHits.slice(0, 2).join(", ")}`);
  } else if (strongHits.length >= 1 || agentHits.length >= 2) {
    novelValue = 0.8;
    reasons.push(`Good novelty: ${[...strongHits, ...agentHits].slice(0, 2).join(", ")}`);
  } else if (agentHits.length >= 1) {
    novelValue = 0.6;
    reasons.push(`Agent-relevant: ${agentHits[0]}`);
  } else if (discovery.category === "skill" || discovery.category === "tool") {
    novelValue = 0.4;
    reasons.push("Tool/skill category (moderate novelty assumed)");
  }

  // 2. Evidence of Real Usage - Check engagement signals (more granular)
  const engagement = discovery.signals?.engagement || 0;
  const comments = (discovery.signals as any)?.comments || 0;

  if (engagement >= 1000) {
    realUsage = 1;
    reasons.push(`Strong engagement: ${engagement} stars/points`);
  } else if (engagement >= 500) {
    realUsage = 0.85;
    reasons.push(`High engagement: ${engagement}`);
  } else if (engagement >= 100) {
    realUsage = 0.7;
    reasons.push(`Good engagement: ${engagement}`);
  } else if (engagement >= 50) {
    realUsage = 0.55;
    reasons.push(`Moderate engagement: ${engagement}`);
  } else if (engagement >= 20) {
    realUsage = 0.4;
    reasons.push(`Some engagement: ${engagement}`);
  } else if (engagement >= 5) {
    realUsage = 0.2;
    reasons.push(`Early stage: ${engagement}`);
  } else {
    reasons.push(`Very low engagement: ${engagement}`);
  }

  // Bonus for active discussion (HN comments)
  if (comments >= 50) {
    realUsage = Math.min(1, realUsage + 0.15);
    reasons.push(`Active discussion: ${comments} comments`);
  } else if (comments >= 20) {
    realUsage = Math.min(1, realUsage + 0.1);
  }

  // For GitHub repos, fetch more detailed metadata
  if (discovery.source.type === "github" && discovery.source.url.includes("github.com")) {
    const metadata = await fetchRepoMetadata(discovery.source.url);
    if (metadata) {
      // Adjust real usage based on repo signals
      if (metadata.stars >= 100) realUsage = Math.max(realUsage, 0.7);
      if (metadata.forks >= 10) realUsage = Math.min(1, realUsage + 0.2);
      if (metadata.openIssues > 5) realUsage = Math.min(1, realUsage + 0.1);
      
      // Check for activity
      if (metadata.lastCommitDaysAgo > 90) {
        realUsage = Math.max(0, realUsage - 0.3);
        reasons.push(`Stale: ${metadata.lastCommitDaysAgo} days since last commit`);
      } else if (metadata.lastCommitDaysAgo < 7) {
        realUsage = Math.min(1, realUsage + 0.1);
        reasons.push("Recently active");
      }

      if (metadata.isArchived) {
        realUsage = 0;
        reasons.push("ARCHIVED - not maintained");
      }

      // Documentation quality
      if (metadata.hasInstallDocs) {
        documentation = 1;
        reasons.push("Has install docs");
      } else if (metadata.hasReadme) {
        documentation = 0.5;
        reasons.push("Has README but unclear install");
      } else {
        reasons.push("Missing documentation");
      }
    }
  }

  // 3. Install Process - Check if install steps are clear
  const steps = discovery.install?.steps || [];
  if (steps.length > 0 && steps.some(s => 
    s.includes("npm") || s.includes("pip") || s.includes("cargo") || 
    s.includes("git clone") || s.includes("brew") || s.includes("apt")
  )) {
    installProcess = 1;
    reasons.push("Clear install commands");
  } else if (steps.length > 0 && !steps[0].includes("# See")) {
    installProcess = 0.5;
    reasons.push("Has install steps but unclear");
  } else {
    reasons.push("No clear install path");
  }

  // 4. Documentation - Already partially handled above for GitHub
  // For non-GitHub, check if description/oneLiner is substantial
  if (documentation === 0) {
    if (discovery.oneLiner.length > 50 && discovery.what.length > 100) {
      documentation = 0.7;
      reasons.push("Decent description");
    } else if (discovery.oneLiner.length > 20) {
      documentation = 0.3;
      reasons.push("Minimal description");
    }
  }

  // 5. Genuine Utility - Check for actionable patterns (weighted by specificity)
  const highValuePatterns = [
    "mcp", "x402", "openclaw", "agent framework", "sandbox",
    "function calling", "tool use", "code interpreter",
    "multi-agent", "orchestration", "agent skill",
  ];
  const mediumValuePatterns = [
    "agent", "automate", "llm", "workflow", "cli tool",
    "api", "sdk", "framework", "library", "browser automation",
    "web scraping", "file system", "database", "knowledge graph",
    "memory", "persistent", "embedding", "vector", "retrieval",
    "rag", "search", "index", "pipeline", "plugin",
    "open source", "self-host",
  ];
  const lowValuePatterns = [
    "ai", "machine learning", "tool", "utility", "helper",
    "data", "analysis", "monitor", "dashboard",
  ];

  const highHits = highValuePatterns.filter((p) => text.includes(p));
  const medHits = mediumValuePatterns.filter((p) => text.includes(p));
  const lowHits = lowValuePatterns.filter((p) => text.includes(p));

  const utilityScore = highHits.length * 0.35 + medHits.length * 0.15 + lowHits.length * 0.05;
  genuineUtility = Math.min(1, utilityScore);

  const allHits = [...highHits, ...medHits, ...lowHits].filter(Boolean);
  if (genuineUtility >= 0.8) {
    reasons.push(`High utility: ${allHits.slice(0, 3).join(", ")}`);
  } else if (genuineUtility >= 0.4) {
    reasons.push(`Good utility: ${allHits.slice(0, 3).join(", ")}`);
  } else if (allHits.length > 0) {
    reasons.push(`Some utility: ${allHits.slice(0, 2).join(", ")}`);
  } else {
    reasons.push("Unclear utility for agents");
  }

  const total = novelValue + realUsage + installProcess + documentation + genuineUtility;

  return {
    total: Math.round(total * 10) / 10,
    novelValue,
    realUsage,
    installProcess,
    documentation,
    genuineUtility,
    reasons,
  };
}

/**
 * Generate a compelling value proposition for a discovery.
 * 
 * Must answer: "Why should I (an agent) care about this?"
 * Should be SPECIFIC to the tool, not generic category-based.
 */
export function generateValueProp(discovery: Discovery): string {
  const title = discovery.title;
  const what = discovery.what.toLowerCase();
  const desc = discovery.oneLiner.toLowerCase();
  const combined = `${what} ${desc}`;

  // Extract specific capabilities from description
  const capabilities: string[] = [];

  // Detect specific integrations
  if (combined.includes("twitter") || combined.includes("x.com")) capabilities.push("Twitter/X integration");
  if (combined.includes("github")) capabilities.push("GitHub integration");
  if (combined.includes("slack")) capabilities.push("Slack integration");
  if (combined.includes("discord")) capabilities.push("Discord integration");
  if (combined.includes("notion")) capabilities.push("Notion integration");
  if (combined.includes("postgres") || combined.includes("sql")) capabilities.push("database access");
  if (combined.includes("browser") || combined.includes("puppeteer") || combined.includes("playwright")) capabilities.push("web browsing");
  if (combined.includes("file") || combined.includes("filesystem")) capabilities.push("file system access");
  
  // Detect specific functions
  if (combined.includes("research")) capabilities.push("automated research");
  if (combined.includes("scrape") || combined.includes("crawl")) capabilities.push("web scraping");
  if (combined.includes("memory") || combined.includes("persist")) capabilities.push("persistent memory");
  if (combined.includes("sandbox") || combined.includes("isolat")) capabilities.push("safe code execution");
  if (combined.includes("pipeline") || combined.includes("workflow")) capabilities.push("multi-step workflows");
  if (combined.includes("team") || combined.includes("collaborat")) capabilities.push("multi-agent coordination");
  if (combined.includes("monitor") || combined.includes("observ")) capabilities.push("execution monitoring");
  if (combined.includes("test")) capabilities.push("automated testing");
  if (combined.includes("deploy")) capabilities.push("deployment automation");

  // Detect agent-specific value
  if (combined.includes("mcp")) capabilities.push("MCP server support");
  if (combined.includes("claude") || combined.includes("anthropic")) capabilities.push("Claude integration");
  if (combined.includes("openclaw") || combined.includes("open claw")) capabilities.push("OpenClaw ecosystem");
  if (combined.includes("skill")) capabilities.push("agent skill");
  if (combined.includes("tool")) capabilities.push("agent tooling");
  if (combined.includes("x402") || combined.includes("micropayment")) capabilities.push("x402 payments");
  if (combined.includes("solana") || combined.includes("blockchain")) capabilities.push("on-chain capability");

  // Build value prop from detected capabilities
  if (capabilities.length >= 2) {
    return `${capabilities.slice(0, 2).join(" + ")} for your agent`;
  } else if (capabilities.length === 1) {
    return `Adds ${capabilities[0]} to your agent`;
  }

  // Fallback: Extract action verb from description
  // Only use if the verb doesn't already appear in the oneLiner (avoids circular phrasing)
  const actionVerbs = [
    { pattern: /automat(e|es|ing)/, value: "Automates", keyword: "automat" },
    { pattern: /manag(e|es|ing)/, value: "Manages", keyword: "manag" },
    { pattern: /generat(e|es|ing)/, value: "Generates", keyword: "generat" },
    { pattern: /analyz(e|es|ing)|analysis/, value: "Analyzes", keyword: "analy" },
    { pattern: /connect(s|ing)?/, value: "Connects", keyword: "connect" },
    { pattern: /extend(s|ing)?/, value: "Extends", keyword: "extend" },
    { pattern: /simpli(fy|fies|fying)/, value: "Simplifies", keyword: "simpli" },
    { pattern: /enabl(e|es|ing)/, value: "Enables", keyword: "enabl" },
    { pattern: /orchestrat(e|es|ing)/, value: "Orchestrates", keyword: "orchestrat" },
    { pattern: /stream(s|ing)?/, value: "Streamlines", keyword: "stream" },
  ];

  for (const { pattern, value, keyword } of actionVerbs) {
    if (pattern.test(combined)) {
      const oneLinerLower = discovery.oneLiner.toLowerCase();
      // Skip if the verb already appears in the oneLiner (would create circular phrasing)
      if (oneLinerLower.includes(keyword)) continue;

      const whatItDoes = discovery.oneLiner.slice(0, 60).replace(/^[^-]*-\s*/, "");
      if (whatItDoes.length > 10) {
        return `${value} ${whatItDoes}`;
      }
    }
  }

  // Last resort: Use the oneLiner if it's descriptive enough
  if (discovery.oneLiner.length > 20 && discovery.oneLiner !== title) {
    // Clean up the oneLiner
    const cleaned = discovery.oneLiner
      .replace(/^A\s+/i, "")
      .replace(/^An\s+/i, "")
      .replace(/^The\s+/i, "");
    return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  }

  return `${discovery.category} capability for agents`;
}

/**
 * Generate agent-readable format for a discovery.
 * This is what gets sent to paying agents.
 */
export interface AgentDiscovery {
  title: string;
  what: string;         // One-liner: what is this?
  utility: string;      // One-liner: how is it specifically useful?
  install: string[];    // Copy-paste install commands
  signals: {            // Trust/quality signals
    stars?: number;
    engagement?: number;
    lastUpdated?: string;
    source: string;
    qualityScore: number;
  };
  url: string;
}

export function toAgentFormat(discovery: CuratedDiscovery): AgentDiscovery {
  return {
    title: discovery.title,
    what: discovery.oneLiner.slice(0, 120),
    utility: discovery.valueProp,
    install: discovery.install.steps.filter(s => 
      !s.startsWith("#") || s.includes("npm") || s.includes("pip") || s.includes("git")
    ).slice(0, 5),
    signals: {
      stars: discovery.signals?.engagement,
      engagement: discovery.signals?.engagement,
      source: discovery.source.type,
      qualityScore: discovery.qualityScore.total,
    },
    url: discovery.source.url,
  };
}

/**
 * Auto-generate tags from discovery content.
 * Tags are machine-filterable labels (e.g., ["openclaw", "solana", "multi-agent"]).
 */
export function generateTags(discovery: Discovery): string[] {
  const text = `${discovery.title} ${discovery.oneLiner} ${discovery.what}`.toLowerCase();
  const tags: string[] = [];

  const tagMap: Record<string, string[]> = {
    "openclaw":     ["openclaw", "open claw", "open-claw"],
    "mcp":          ["mcp", "model context protocol"],
    "solana":       ["solana", "sol ", "spl token"],
    "multi-agent":  ["multi-agent", "multi agent", "orchestration", "swarm"],
    "claude":       ["claude", "anthropic"],
    "sandbox":      ["sandbox", "isolat", "containeriz"],
    "cli":          ["cli tool", "command line", "terminal"],
    "browser":      ["browser", "puppeteer", "playwright", "selenium"],
    "database":     ["postgres", "sqlite", "database", " sql ", "mysql"],
    "workflow":     ["workflow", "pipeline", "automation"],
    "x402":         ["x402", "micropayment"],
    "skill":        ["skill", "agent skill"],
    "rag":          ["rag", "retrieval", "vector", "embedding"],
    "self-host":    ["self-host", "local model", "ollama", "local-first"],
    "github":       ["github"],
    "memory":       ["memory", "persistent", "long-term memory"],
    "api":          ["api", "sdk", "rest api", "graphql"],
    "devtools":     ["devtool", "developer tool", "debugging", "profil"],
    "llm":          ["llm", "language model", "fine-tun"],
    "docker":       ["docker", "container", "kubernetes", "k8s"],
  };

  for (const [tag, patterns] of Object.entries(tagMap)) {
    if (patterns.some((p) => text.includes(p))) {
      tags.push(tag);
    }
  }

  // Always include the category as a tag
  if (!tags.includes(discovery.category)) {
    tags.push(discovery.category);
  }

  return tags.slice(0, 6); // Cap at 6 tags
}

/**
 * Curate discoveries through the quality rubric
 */
export async function curateDiscoveries(
  discoveries: Discovery[],
  options: { minScore?: number; maxPicks?: number } = {}
): Promise<CurationResult> {
  const { minScore = 3, maxPicks = 10 } = options;

  console.log(`[curation] Evaluating ${discoveries.length} discoveries...`);

  const scored: CuratedDiscovery[] = [];

  for (const discovery of discoveries) {
    const qualityScore = await scoreDiscovery(discovery);
    const valueProp = generateValueProp(discovery);
    const tags = generateTags(discovery);

    const curated: CuratedDiscovery = {
      ...discovery,
      qualityScore,
      valueProp,
      tags,
    };

    // Add skip reason if below threshold
    if (qualityScore.total < 2) {
      if (qualityScore.realUsage < 0.3) {
        curated.skipReason = "Low engagement/adoption";
      } else if (qualityScore.documentation < 0.3) {
        curated.skipReason = "Insufficient documentation";
      } else if (qualityScore.installProcess < 0.3) {
        curated.skipReason = "Unclear install process";
      } else {
        curated.skipReason = "Did not meet quality threshold";
      }
    } else if (qualityScore.total < minScore) {
      curated.skipReason = "Promising but needs more traction";
    }

    scored.push(curated);

    // Rate limit for GitHub API calls
    if (discovery.source.type === "github") {
      await new Promise(r => setTimeout(r, 200));
    }
  }

  // Sort by quality score
  scored.sort((a, b) => b.qualityScore.total - a.qualityScore.total);

  // Categorize results
  const picks = scored.filter(d => d.qualityScore.total >= minScore).slice(0, maxPicks);
  const onRadar = scored.filter(d => d.qualityScore.total >= 2 && d.qualityScore.total < minScore).slice(0, 5);
  const skipped = scored.filter(d => d.qualityScore.total < 2).slice(0, 5);

  const isQuietWeek = picks.length < 3;

  console.log(`[curation] Results: ${picks.length} picks, ${onRadar.length} on radar, ${skipped.length} skipped`);
  if (isQuietWeek) {
    console.log(`[curation] Quiet week - only ${picks.length} quality discoveries`);
  }

  return { picks, onRadar, skipped, isQuietWeek };
}

/**
 * Check if a tool is a duplicate of something that already exists
 */
export function isDuplicate(
  discovery: Discovery, 
  existingTools: string[]
): { isDupe: boolean; similar?: string } {
  const name = discovery.title.toLowerCase();
  const desc = discovery.what.toLowerCase();

  // Common tool categories that have many duplicates
  const crowdedCategories = [
    { pattern: /chat.*(gpt|ai|bot)|ai.*chat/, similar: "ChatGPT wrapper" },
    { pattern: /code.*assist|copilot|autocomplete/, similar: "GitHub Copilot" },
    { pattern: /prompt.*manage|prompt.*template/, similar: "existing prompt managers" },
    { pattern: /vector.*store|embedding.*db/, similar: "existing vector DBs" },
    { pattern: /rag|retrieval.*augment/, similar: "existing RAG frameworks" },
  ];

  for (const { pattern, similar } of crowdedCategories) {
    if (pattern.test(name) || pattern.test(desc)) {
      // Check if it claims differentiation
      const diffPatterns = ["first", "only", "unique", "unlike", "faster", "better"];
      if (!diffPatterns.some(p => desc.includes(p))) {
        return { isDupe: true, similar };
      }
    }
  }

  return { isDupe: false };
}
