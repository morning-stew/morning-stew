import type { FrameworkUpdate } from "../types";

const OPENCLAW_REPO = "openclaw/openclaw";
const GITHUB_API = "https://api.github.com";

export interface GitHubScraperConfig {
  since?: Date;
  includePreReleases?: boolean;
}

/**
 * Watch OpenClaw GitHub for releases and significant updates.
 */
export async function scrapeGitHubReleases(
  config: GitHubScraperConfig = {}
): Promise<FrameworkUpdate[]> {
  const { since = new Date(Date.now() - 24 * 60 * 60 * 1000), includePreReleases = false } = config;

  console.log(`[github] Checking releases since: ${since.toISOString()}`);

  try {
    const response = await fetch(
      `${GITHUB_API}/repos/${OPENCLAW_REPO}/releases?per_page=10`,
      {
        headers: {
          Accept: "application/vnd.github.v3+json",
          // TODO: Add auth token for higher rate limits
        },
      }
    );

    if (!response.ok) {
      console.error(`[github] API error: ${response.status}`);
      return [];
    }

    const releases = await response.json() as Array<{
      name: string;
      html_url: string;
      body: string;
      prerelease: boolean;
      published_at: string;
    }>;

    return releases
      .filter((r) => {
        const publishedAt = new Date(r.published_at);
        const isRecent = publishedAt >= since;
        const includeIt = includePreReleases || !r.prerelease;
        return isRecent && includeIt;
      })
      .map((r) => ({
        type: "release" as const,
        title: r.name,
        url: r.html_url,
        summary: r.body?.slice(0, 200) || "No description",
        breaking: r.body?.toLowerCase().includes("breaking") || false,
      }));
  } catch (error) {
    console.error(`[github] Fetch error:`, error);
    return [];
  }
}
