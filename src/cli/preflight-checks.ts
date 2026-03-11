/**
 * Preflight check logic — exportable for testing.
 *
 * Each check function returns a structured result instead of logging directly.
 * The CLI entry point (preflight.ts) handles formatting and exit codes.
 */

import { loadTokens } from "../scrapers/twitter-auth";

export type CheckStatus = "pass" | "fail" | "skip";

export interface CheckResult {
  name: string;
  status: CheckStatus;
  message: string;
}

export async function checkGitHub(): Promise<CheckResult> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) return { name: "GITHUB_TOKEN", status: "skip", message: "not set" };

  try {
    const res = await fetch("https://api.github.com/user", {
      headers: { Authorization: `Bearer ${token}`, "User-Agent": "morning-stew/preflight" },
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const data = await res.json();
      return { name: "GITHUB_TOKEN", status: "pass", message: `authenticated as ${data.login}` };
    }
    const errText = await res.text().catch(() => "");
    return { name: "GITHUB_TOKEN", status: "fail", message: `${res.status} ${errText.slice(0, 80)}` };
  } catch (e: any) {
    return { name: "GITHUB_TOKEN", status: "fail", message: e.message };
  }
}

export async function checkNous(): Promise<CheckResult> {
  // Hermes Agent now handles curation - NOUS_API_KEY not needed
  return { name: "NOUS_API_KEY", status: "skip", message: "Handled by Hermes Agent" };
}

export async function checkTwitterBearer(): Promise<CheckResult> {
  const token = process.env.X_BEARER_TOKEN;
  if (!token) return { name: "X_BEARER_TOKEN", status: "fail", message: "required for Twitter search" };

  try {
    const res = await fetch(
      "https://api.x.com/2/tweets/search/recent?query=test&max_results=10",
      {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(5000),
      },
    );
    if (res.ok) {
      return { name: "X_BEARER_TOKEN", status: "pass", message: "search API OK" };
    }
    if (res.status === 429) {
      return { name: "X_BEARER_TOKEN", status: "pass", message: "valid (rate limited, try later)" };
    }
    const errText = await res.text().catch(() => "");
    return { name: "X_BEARER_TOKEN", status: "fail", message: `${res.status} ${errText.slice(0, 80)}` };
  } catch (e: any) {
    return { name: "X_BEARER_TOKEN", status: "fail", message: e.message };
  }
}

export function checkTwitterOAuth(): CheckResult {
  const tokens = loadTokens();
  if (!tokens) {
    return { name: "Twitter OAuth", status: "fail", message: "no tokens found. Run: pnpm twitter:oauth" };
  }

  const expiresIn = tokens.expires_at - Date.now();
  if (expiresIn > 300_000) {
    const mins = Math.floor(expiresIn / 60_000);
    return { name: "Twitter OAuth", status: "pass", message: `token valid (expires in ${mins}m)` };
  }
  if (expiresIn > 0) {
    return { name: "Twitter OAuth", status: "pass", message: `token expiring soon (${Math.floor(expiresIn / 1000)}s left, will auto-refresh)` };
  }

  const clientId = process.env.X_CLIENT_ID;
  const clientSecret = process.env.X_CLIENT_SECRET;
  if (clientId && clientSecret) {
    return { name: "Twitter OAuth", status: "pass", message: "token expired (will auto-refresh on next use)" };
  }
  return { name: "Twitter OAuth", status: "fail", message: "token expired and X_CLIENT_ID/X_CLIENT_SECRET not set for refresh" };
}

export async function checkBrave(): Promise<CheckResult> {
  const key = process.env.BRAVE_API_KEY;
  if (!key) return { name: "BRAVE_API_KEY", status: "skip", message: "not set" };

  try {
    const res = await fetch(
      "https://api.search.brave.com/res/v1/web/search?q=test&count=1",
      {
        headers: {
          Accept: "application/json",
          "Accept-Encoding": "gzip",
          "X-Subscription-Token": key,
        },
        signal: AbortSignal.timeout(5000),
      },
    );
    if (res.ok) {
      return { name: "BRAVE_API_KEY", status: "pass", message: "search API OK" };
    }
    const errText = await res.text().catch(() => "");
    return { name: "BRAVE_API_KEY", status: "fail", message: `${res.status} ${errText.slice(0, 80)}` };
  } catch (e: any) {
    return { name: "BRAVE_API_KEY", status: "fail", message: e.message };
  }
}

// Deep enrichment now handled by Hermes Agent (human-in-loop) via browser tools
// Skip the automated check - user does enrichment manually
export async function checkDeepEnrich(): Promise<CheckResult> {
  return { name: "Deep Enrich", status: "skip", message: "Handled by Hermes Agent via browser" };
}

/**
 * Run all preflight checks. Returns structured results.
 */
export async function runPreflight(): Promise<CheckResult[]> {
  const [github, nous, twitter, brave, deepEnrich] = await Promise.all([
    checkGitHub(),
    checkNous(),
    checkTwitterBearer(),
    checkBrave(),
    checkDeepEnrich(),
  ]);
  const oauth = checkTwitterOAuth();
  return [github, nous, twitter, oauth, brave, deepEnrich];
}
