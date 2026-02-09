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

/**
 * Fetch GitHub repo metadata for quality scoring
 */
export async function fetchRepoMetadata(repoUrl: string): Promise<RepoMetadata | null> {
  const match = repoUrl.match(/github\.com\/([^/]+)\/([^/]+)/);
  if (!match) return null;

  const [, owner, repo] = match;
  const cleanRepo = repo.replace(/\.git$/, "").split("#")[0].split("?")[0];

  try {
    const response = await fetch(`https://api.github.com/repos/${owner}/${cleanRepo}`, {
      headers: {
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "morning-stew-bot",
      },
    });

    if (!response.ok) return null;

    const data = await response.json();

    // Check last commit
    let lastCommitDaysAgo = 999;
    try {
      const commitsRes = await fetch(
        `https://api.github.com/repos/${owner}/${cleanRepo}/commits?per_page=1`,
        {
          headers: {
            Accept: "application/vnd.github.v3+json",
            "User-Agent": "morning-stew-bot",
          },
        }
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

    // Check README content
    let hasInstallDocs = false;
    try {
      const readmeRes = await fetch(
        `https://api.github.com/repos/${owner}/${cleanRepo}/readme`,
        {
          headers: {
            Accept: "application/vnd.github.v3+json",
            "User-Agent": "morning-stew-bot",
          },
        }
      );
      if (readmeRes.ok) {
        const readmeData = await readmeRes.json();
        const content = Buffer.from(readmeData.content, "base64").toString("utf-8").toLowerCase();
        hasInstallDocs = 
          content.includes("install") || 
          content.includes("npm") || 
          content.includes("pip") ||
          content.includes("cargo") ||
          content.includes("getting started") ||
          content.includes("quick start");
      }
    } catch {
      // Ignore readme fetch errors
    }

    return {
      stars: data.stargazers_count || 0,
      forks: data.forks_count || 0,
      openIssues: data.open_issues_count || 0,
      lastCommitDaysAgo,
      hasReadme: !!data.has_wiki || data.size > 0,
      hasInstallDocs,
      contributorCount: data.network_count || 1,
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
  const novelKeywords = [
    "first", "only", "new approach", "novel", "unique", "unlike",
    "alternative to", "replaces", "better than", "faster than"
  ];
  const text = `${discovery.title} ${discovery.what} ${discovery.oneLiner}`.toLowerCase();
  if (novelKeywords.some(k => text.includes(k))) {
    novelValue = 1;
    reasons.push("Claims novel approach");
  } else if (discovery.category === "skill" || discovery.category === "tool") {
    novelValue = 0.5;
    reasons.push("Tool/skill category (moderate novelty assumed)");
  }

  // 2. Evidence of Real Usage - Check engagement signals
  const engagement = discovery.signals?.engagement || 0;
  if (engagement >= 1000) {
    realUsage = 1;
    reasons.push(`Strong engagement: ${engagement}`);
  } else if (engagement >= 100) {
    realUsage = 0.7;
    reasons.push(`Good engagement: ${engagement}`);
  } else if (engagement >= 20) {
    realUsage = 0.4;
    reasons.push(`Some engagement: ${engagement}`);
  } else {
    reasons.push(`Low engagement: ${engagement}`);
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

  // 5. Genuine Utility - Check for actionable patterns
  const actionablePatterns = [
    "agent", "automate", "ai", "llm", "workflow", "sandbox", "mcp",
    "api", "cli", "tool", "framework", "sdk", "library"
  ];
  const utilityMatches = actionablePatterns.filter(p => text.includes(p));
  if (utilityMatches.length >= 3) {
    genuineUtility = 1;
    reasons.push(`High utility: ${utilityMatches.slice(0, 3).join(", ")}`);
  } else if (utilityMatches.length >= 1) {
    genuineUtility = 0.6;
    reasons.push(`Moderate utility: ${utilityMatches.join(", ")}`);
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
  if (combined.includes("mcp")) capabilities.push("MCP server");
  if (combined.includes("claude") || combined.includes("anthropic")) capabilities.push("Claude-optimized");
  if (combined.includes("skill")) capabilities.push("agent skill");
  if (combined.includes("tool")) capabilities.push("agent tooling");

  // Build value prop from detected capabilities
  if (capabilities.length >= 2) {
    return `${capabilities.slice(0, 2).join(" + ")} for your agent`;
  } else if (capabilities.length === 1) {
    return `Adds ${capabilities[0]} to your agent`;
  }

  // Fallback: Extract action verb from description
  const actionVerbs = [
    { pattern: /automat(e|es|ing)/, value: "Automates" },
    { pattern: /manag(e|es|ing)/, value: "Manages" },
    { pattern: /generat(e|es|ing)/, value: "Generates" },
    { pattern: /analyz(e|es|ing)|analysis/, value: "Analyzes" },
    { pattern: /connect(s|ing)?/, value: "Connects" },
    { pattern: /extend(s|ing)?/, value: "Extends" },
    { pattern: /simpli(fy|fies|fying)/, value: "Simplifies" },
    { pattern: /enabl(e|es|ing)/, value: "Enables" },
  ];

  for (const { pattern, value } of actionVerbs) {
    if (pattern.test(combined)) {
      // Extract what it does from the description
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

    const curated: CuratedDiscovery = {
      ...discovery,
      qualityScore,
      valueProp,
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
