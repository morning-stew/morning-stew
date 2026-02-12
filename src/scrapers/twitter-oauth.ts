#!/usr/bin/env npx tsx
/**
 * One-time OAuth 2.0 PKCE authorization for X/Twitter DM access.
 *
 * Run: pnpm twitter:oauth
 *
 * This opens a browser for you to authorize the app, then stores
 * access + refresh tokens in .morning-stew/twitter-oauth.json.
 *
 * Tokens auto-refresh — you only need to run this once.
 */

import { createServer } from "http";
import { randomBytes, createHash } from "crypto";
import { existsSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";

const DATA_DIR = join(process.cwd(), ".morning-stew");
const OAUTH_PATH = join(DATA_DIR, "twitter-oauth.json");

const CLIENT_ID = process.env.X_CLIENT_ID;
const CLIENT_SECRET = process.env.X_CLIENT_SECRET;
const REDIRECT_URI = "http://localhost:3000/callback";
const SCOPES = "tweet.read users.read dm.read offline.access";

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("Error: X_CLIENT_ID and X_CLIENT_SECRET must be set in .env");
  process.exit(1);
}

// Generate PKCE values
const codeVerifier = randomBytes(32).toString("base64url");
const codeChallenge = createHash("sha256")
  .update(codeVerifier)
  .digest("base64url");
const state = randomBytes(16).toString("hex");

// Build authorization URL
const authUrl = new URL("https://x.com/i/oauth2/authorize");
authUrl.searchParams.set("response_type", "code");
authUrl.searchParams.set("client_id", CLIENT_ID);
authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
authUrl.searchParams.set("scope", SCOPES);
authUrl.searchParams.set("state", state);
authUrl.searchParams.set("code_challenge", codeChallenge);
authUrl.searchParams.set("code_challenge_method", "S256");

console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log("  Twitter/X OAuth 2.0 Authorization");
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
console.log("Open this URL in your browser:\n");
console.log(authUrl.toString());
console.log("\nWaiting for callback on http://localhost:3000/callback...\n");

// Try to open browser automatically
try {
  const { exec } = await import("child_process");
  const cmd =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "start"
        : "xdg-open";
  exec(`${cmd} "${authUrl.toString()}"`);
  console.log("(Browser opened automatically)\n");
} catch {
  console.log("(Open the URL above manually)\n");
}

// Start local server to handle callback
const server = createServer(async (req, res) => {
  const url = new URL(req.url!, `http://localhost:3000`);

  if (url.pathname !== "/callback") {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  const code = url.searchParams.get("code");
  const returnedState = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error) {
    res.writeHead(400, { "Content-Type": "text/html" });
    res.end(`<h1>Authorization failed</h1><p>${error}</p>`);
    console.error(`\nError: ${error}`);
    server.close();
    process.exit(1);
  }

  if (!code || returnedState !== state) {
    res.writeHead(400, { "Content-Type": "text/html" });
    res.end(`<h1>Invalid callback</h1><p>State mismatch or missing code.</p>`);
    console.error("\nError: State mismatch or missing authorization code");
    server.close();
    process.exit(1);
  }

  // Exchange code for tokens
  try {
    const tokenRes = await fetch("https://api.x.com/2/oauth2/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64")}`,
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: REDIRECT_URI,
        code_verifier: codeVerifier,
      }),
    });

    if (!tokenRes.ok) {
      const err = await tokenRes.text();
      throw new Error(`Token exchange failed (${tokenRes.status}): ${err}`);
    }

    const data = await tokenRes.json();

    const tokens = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Date.now() + (data.expires_in || 7200) * 1000,
      scope: data.scope,
    };

    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(OAUTH_PATH, JSON.stringify(tokens, null, 2));

    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(`
      <html>
        <body style="font-family: system-ui; padding: 40px; text-align: center;">
          <h1>✅ Authorization successful!</h1>
          <p>Tokens saved. You can close this tab.</p>
          <p style="color: #666; font-size: 14px;">
            Scopes: ${data.scope}<br>
            Expires in: ${Math.round((data.expires_in || 7200) / 60)} minutes (auto-refreshes)
          </p>
        </body>
      </html>
    `);

    console.log("\n✅ Success! Tokens saved to:", OAUTH_PATH);
    console.log(`   Scopes: ${data.scope}`);
    console.log(`   Expires in: ${Math.round((data.expires_in || 7200) / 60)} minutes`);
    console.log("   Tokens will auto-refresh — you only need to do this once.\n");
  } catch (error) {
    res.writeHead(500, { "Content-Type": "text/html" });
    res.end(`<h1>Token exchange failed</h1><pre>${error}</pre>`);
    console.error("\nToken exchange error:", error);
  }

  server.close();
  process.exit(0);
});

server.listen(3000, () => {
  // Server ready
});

// Timeout after 5 minutes
setTimeout(() => {
  console.error("\nTimeout: No callback received after 5 minutes.");
  server.close();
  process.exit(1);
}, 300_000);
