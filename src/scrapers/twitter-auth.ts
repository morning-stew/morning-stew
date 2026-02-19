/**
 * Shared OAuth token management for X/Twitter API.
 *
 * Supports two auth methods (checked in order):
 * 1. OAuth 1.0a — static keys from .env, never expire, simpler for bot accounts
 * 2. OAuth 2.0 PKCE — browser-based auth, tokens auto-refresh
 *
 * OAuth 1.0a is preferred when X_API_KEY + X_API_SECRET + X_ACCESS_TOKEN + X_ACCESS_SECRET are set.
 * Falls back to OAuth 2.0 PKCE (run `pnpm twitter:oauth` to bootstrap).
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { createHmac, randomBytes } from "crypto";

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
  // Prefer OAuth 1.0a if configured (returns a sentinel — actual auth is per-request)
  if (isOAuth1Available()) return "oauth1";

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

// ── OAuth 1.0a support ──

function isOAuth1Available(): boolean {
  const accessSecret = process.env.X_ACCESS_SECRET || process.env.X_ACCESS_TOKEN_SECRET;
  return !!(
    process.env.X_API_KEY &&
    process.env.X_API_SECRET &&
    process.env.X_ACCESS_TOKEN &&
    accessSecret
  );
}

/**
 * Build an OAuth 1.0a Authorization header for a request.
 */
export function buildOAuth1Header(method: string, url: string, params: Record<string, string> = {}): string {
  const apiKey = process.env.X_API_KEY!;
  const apiSecret = process.env.X_API_SECRET!;
  const accessToken = process.env.X_ACCESS_TOKEN!;
  const accessSecret = process.env.X_ACCESS_SECRET || process.env.X_ACCESS_TOKEN_SECRET!;

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = randomBytes(16).toString("hex");

  const oauthParams: Record<string, string> = {
    oauth_consumer_key: apiKey,
    oauth_nonce: nonce,
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: timestamp,
    oauth_token: accessToken,
    oauth_version: "1.0",
  };

  // Combine oauth params + query params for signature base
  const parsedUrl = new URL(url);
  const allParams: Record<string, string> = { ...oauthParams, ...params };
  parsedUrl.searchParams.forEach((v, k) => { allParams[k] = v; });

  // Sort and encode
  const paramString = Object.keys(allParams)
    .sort()
    .map((k) => `${encodeRFC3986(k)}=${encodeRFC3986(allParams[k])}`)
    .join("&");

  const baseUrl = `${parsedUrl.origin}${parsedUrl.pathname}`;
  const signatureBase = `${method.toUpperCase()}&${encodeRFC3986(baseUrl)}&${encodeRFC3986(paramString)}`;
  const signingKey = `${encodeRFC3986(apiSecret)}&${encodeRFC3986(accessSecret)}`;

  const signature = createHmac("sha1", signingKey).update(signatureBase).digest("base64");

  oauthParams["oauth_signature"] = signature;

  const header = Object.keys(oauthParams)
    .sort()
    .map((k) => `${encodeRFC3986(k)}="${encodeRFC3986(oauthParams[k])}"`)
    .join(", ");

  return `OAuth ${header}`;
}

function encodeRFC3986(str: string): string {
  return encodeURIComponent(str).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/**
 * Make an authenticated fetch using the best available auth method.
 * Uses OAuth 1.0a if configured, otherwise OAuth 2.0 Bearer token.
 */
export async function authedFetch(url: string, options: RequestInit = {}): Promise<Response> {
  if (isOAuth1Available()) {
    const method = options.method || "GET";
    const authHeader = buildOAuth1Header(method, url);
    return fetch(url, {
      ...options,
      headers: { ...options.headers as Record<string, string>, Authorization: authHeader },
    });
  }

  // Fallback to OAuth 2.0
  const token = await getValidAccessToken();
  if (!token || token === "oauth1") throw new Error("No valid auth token available");
  return fetch(url, {
    ...options,
    headers: { ...options.headers as Record<string, string>, Authorization: `Bearer ${token}` },
  });
}
