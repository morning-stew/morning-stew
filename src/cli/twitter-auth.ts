#!/usr/bin/env tsx

import { chromium } from "playwright";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";

const DATA_DIR = join(process.cwd(), ".morning-stew");
const COOKIES_PATH = join(DATA_DIR, "twitter-cookies.json");

/**
 * Interactive Twitter authentication.
 * 
 * Opens a visible browser for you to log in manually.
 * Once logged in, saves cookies for headless scraping.
 * 
 * Usage: pnpm run twitter:auth
 */
async function main() {
  console.log(`
🐦 Twitter/X Authentication Setup
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

This will open a browser window. Please:
1. Log into your Twitter/X account
2. Complete any 2FA or captcha challenges
3. Once you see your home feed, press Enter in this terminal

Cookies will be saved to: ${COOKIES_PATH}
`);

  // Ensure data dir exists
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }

  const browser = await chromium.launch({
    headless: false, // Visible browser for manual login
    args: ["--disable-blink-features=AutomationControlled"],
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  });

  const page = await context.newPage();

  // Go to Twitter login
  await page.goto("https://x.com/login", { waitUntil: "domcontentloaded" });

  console.log("Browser opened. Log in and then press Enter here when done...");

  // Wait for user input
  await waitForEnter();

  // Verify login succeeded
  const currentUrl = page.url();
  const isLoggedIn = currentUrl.includes("/home") || 
    await page.evaluate(() => {
      return !!(
        document.querySelector('[data-testid="SideNav_NewTweet_Button"]') ||
        document.querySelector('[data-testid="primaryColumn"]')
      );
    });

  if (!isLoggedIn) {
    console.log("\n⚠️  Doesn't look like you're logged in yet.");
    console.log("Navigate to your home feed and press Enter again...");
    await waitForEnter();
  }

  // Save cookies
  const cookies = await context.cookies();
  writeFileSync(COOKIES_PATH, JSON.stringify(cookies, null, 2));

  console.log(`
✅ Success! Saved ${cookies.length} cookies.

You can now run: pnpm run generate

The scraper will use these cookies for headless browsing.
If you get logged out, just run this auth script again.
`);

  await browser.close();
}

function waitForEnter(): Promise<void> {
  return new Promise((resolve) => {
    process.stdin.once("data", () => {
      resolve();
    });
  });
}

main().catch((error) => {
  console.error("Auth failed:", error);
  process.exit(1);
});
