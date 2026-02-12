/**
 * Shared OAuth 2.0 token management for X/Twitter API.
 *
 * Used by both the home timeline scraper and DM reader.
 * Tokens are stored in .morning-stew/twitter-oauth.json and auto-refresh.
 *
 * Run `pnpm twitter:oauth` once to bootstrap tokens.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";

const DATA_DIR = join(process.cwd(), ".morning-stew");
const OAUTH_PATH = join(DATA_DIR, "twitter-oauth.json");

export interface OAuthTokens {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  scope: string;
}

export function loadTokens(): OAuthTokens | null {
  if (!existsSync(OAUTH_PATH)) return null;
  try {
    const data = JSON.parse(readFileSync(OAUTH_PATH, "utf-8"));
    if (!data.access_token) return null;
    return data;
  } catch {
    return null;
  }
}

export function saveTokens(tokens: OAuthTokens) {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(OAUTH_PATH, JSON.stringify(tokens, null, 2));
}

export async function refreshAccessToken(tokens: OAuthTokens): Promise<OAuthTokens | null> {
  const clientId = process.env.X_CLIENT_ID;
  const clientSecret = process.env.X_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  try {
    const res = await fetch("https://api.x.com/2/oauth2/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: tokens.refresh_token,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.log(`[twitter-auth] Token refresh failed (${res.status}): ${err.slice(0, 200)}`);
      return null;
    }

    const data = await res.json();
    const refreshed: OAuthTokens = {
      access_token: data.access_token,
      refresh_token: data.refresh_token || tokens.refresh_token,
      expires_at: Date.now() + (data.expires_in || 7200) * 1000,
      scope: data.scope || tokens.scope,
    };

    saveTokens(refreshed);
    return refreshed;
  } catch (error) {
    console.log("[twitter-auth] Token refresh error:", error);
    return null;
  }
}

/**
 * Get a valid OAuth 2.0 access token, auto-refreshing if needed.
 * Returns null if tokens aren't set up (run `pnpm twitter:oauth` first).
 */
export async function getValidAccessToken(): Promise<string | null> {
  let tokens = loadTokens();
  if (!tokens) return null;

  // Refresh if expiring within 5 minutes
  if (Date.now() > tokens.expires_at - 300_000) {
    console.log("[twitter-auth] Refreshing access token...");
    tokens = await refreshAccessToken(tokens);
    if (!tokens) return null;
    console.log("[twitter-auth] Token refreshed.");
  }

  return tokens.access_token;
}
