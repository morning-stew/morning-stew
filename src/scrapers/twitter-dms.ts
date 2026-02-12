/**
 * Editor DM Reader — X API v2 with OAuth 2.0 + auto-refresh
 *
 * Reads DMs sent to the bot account from the editor (@aboozle).
 * These are high-priority editorial picks that bypass normal curation.
 *
 * Auth: OAuth 2.0 PKCE — run `pnpm twitter:oauth` ONCE to authorize.
 * After that, tokens auto-refresh forever. Fully automatic in cron.
 */

import type { Discovery } from "../types/discovery";
import { createDiscovery } from "../types/discovery";
import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync } from "fs";
import { join } from "path";
import { getValidAccessToken } from "./twitter-auth";
import { fetchTweetContent } from "./twitter-api";

const DATA_DIR = join(process.cwd(), ".morning-stew");
const SEEN_DMS_PATH = join(DATA_DIR, "seen-dms.json");

const BASE = "https://api.x.com/2";

/**
 * Editor account — DMs from this handle are treated as editorial suggestions
 */
const EDITOR_HANDLE = "aboozle";

// ── Seen DMs ──

function loadSeenDMs(): Set<string> {
  if (!existsSync(SEEN_DMS_PATH)) return new Set();
  try {
    return new Set(JSON.parse(readFileSync(SEEN_DMS_PATH, "utf-8")));
  } catch {
    return new Set();
  }
}

function saveSeenDMs(seen: Set<string>) {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  const arr = [...seen].slice(-500);
  writeFileSync(SEEN_DMS_PATH, JSON.stringify(arr, null, 2));
}

// ── Main Scraper ──

export interface DMScraperConfig {
  maxMessages?: number;
}

/**
 * Read editor tips from multiple sources:
 * 1. Local tips file (.morning-stew/editor-tips.txt) — always checked
 * 2. X API DMs from @aboozle — checked if OAuth tokens are available
 */
export async function scrapeEditorDMs(
  config: DMScraperConfig = {}
): Promise<Discovery[]> {
  const { maxMessages = 20 } = config;
  const discoveries: Discovery[] = [];

  // ── Source 1: Local tips file (free, instant) ──
  const tipsFromFile = await readTipsFile();
  discoveries.push(...tipsFromFile);

  // ── Source 2: X API DMs (if OAuth tokens available) ──
  const tipsFromDMs = await readDMTips(maxMessages);
  discoveries.push(...tipsFromDMs);

  console.log(`[editor] Total editor picks: ${discoveries.length} (${tipsFromFile.length} file, ${tipsFromDMs.length} DMs)`);
  return discoveries;
}

/**
 * Read tips from .morning-stew/editor-tips.txt
 * Format: one URL per line, optionally followed by " | note"
 * Processed lines are moved to editor-tips-done.txt
 *
 * For tweet URLs: fetches the tweet via API, checks replies for links,
 * and follows those links to build a proper title, description, and install steps.
 */
const TIPS_PATH = join(DATA_DIR, "editor-tips.txt");
const TIPS_DONE_PATH = join(DATA_DIR, "editor-tips-done.txt");

async function readTipsFile(): Promise<Discovery[]> {
  if (!existsSync(TIPS_PATH)) return [];

  const content = readFileSync(TIPS_PATH, "utf-8").trim();
  if (!content) return [];

  const lines = content.split("\n").filter((l) => l.trim());
  console.log(`[editor] ${lines.length} tips in file`);

  const discoveries: Discovery[] = [];

  for (const line of lines) {
    const [urlPart, notePart] = line.split(" | ");
    const url = urlPart.trim();
    if (!url.startsWith("http")) continue;

    const note = notePart?.trim() || "";
    const isGitHub = url.includes("github.com");
    const isTweet = url.includes("x.com/") || url.includes("twitter.com/");

    let title = extractTitleFromUrl(url) || note.slice(0, 50) || url;
    let oneLiner = note || `Editor pick: ${url}`;
    let what = note || `Suggested by editor`;
    let sourceUrl = url;
    let sourceType: string = isGitHub ? "github" : "twitter";
    let installSteps = isGitHub
      ? [`git clone ${url}`, "See repo README for setup"]
      : [`See ${url}`];
    let category: Discovery["category"] = isGitHub ? "tool" : "workflow";

    // ── Tweet URLs: fetch the actual tweet content ──
    if (isTweet) {
      console.log(`[editor] Fetching tweet content for: ${url}`);
      try {
        const tweetData = await fetchTweetContent(url);

        if (tweetData.tweetText) {
          // Use tweet text as the description
          const shortText = tweetData.tweetText.slice(0, 120);
          title = `@${tweetData.author}: ${shortText}${tweetData.tweetText.length > 120 ? "..." : ""}`;
          oneLiner = note || tweetData.tweetText.slice(0, 200);
          what = tweetData.tweetText;

          // If the tweet links to a repo/project, use that as the source
          if (tweetData.urls.length > 0) {
            const bestUrl = tweetData.urls[0];
            sourceUrl = bestUrl;
            const isLinkedGitHub = bestUrl.includes("github.com");
            sourceType = isLinkedGitHub ? "github" : "web";
            category = isLinkedGitHub ? "tool" : "workflow";

            if (isLinkedGitHub) {
              installSteps = [`git clone ${bestUrl}`, "See repo README for setup"];
            } else {
              installSteps = [`See ${bestUrl}`];
            }

            console.log(`[editor] Tweet links to: ${bestUrl}`);
          }

          // Include linked content for LLM enrichment later
          if (tweetData.linkedContent) {
            what = `${tweetData.tweetText}\n\n--- Linked content ---\n${tweetData.linkedContent.slice(0, 500)}`;
          }
        }
      } catch (err: any) {
        console.log(`[editor] Tweet fetch failed: ${err.message} — using URL as-is`);
      }
    }

    const discovery = createDiscovery({
      id: `editor-file-${Buffer.from(url).toString("base64url").slice(0, 20)}`,
      category,
      title,
      oneLiner,
      what,
      why: `Editorial pick from @${EDITOR_HANDLE}`,
      impact: "Hand-picked by newsletter editor",
      install: {
        steps: installSteps,
        timeEstimate: "5 min",
      },
      source: {
        url: sourceUrl,
        type: sourceType,
        author: EDITOR_HANDLE,
      },
      signals: {
        engagement: 9999,
        trending: true,
      },
      security: "unverified",
    });

    discoveries.push(discovery);
    console.log(`[editor] Added: ${discovery.title.slice(0, 80)}`);
  }

  // Move processed tips to done file
  if (discoveries.length > 0) {
    appendFileSync(TIPS_DONE_PATH, content + "\n");
    writeFileSync(TIPS_PATH, "");
  }

  return discoveries;
}

/**
 * Read tips from X API DMs (OAuth 2.0)
 */
async function readDMTips(maxMessages: number): Promise<Discovery[]> {
  const accessToken = await getValidAccessToken();
  if (!accessToken) return [];

  console.log(`[editor-dms] Checking DMs from @${EDITOR_HANDLE}...`);
  const seenDMs = loadSeenDMs();
  const discoveries: Discovery[] = [];

  try {
    const userRes = await fetch(`${BASE}/users/by/username/${EDITOR_HANDLE}?user.fields=id`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!userRes.ok) return [];

    const userData = await userRes.json();
    const editorUserId = userData.data?.id;
    if (!editorUserId) return [];

    const dmRes = await fetch(
      `${BASE}/dm_conversations/with/${editorUserId}/dm_events?dm_event.fields=id,text,event_type,created_at,sender_id&max_results=100`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!dmRes.ok) return [];

    const dmData = await dmRes.json();
    const events = dmData.data || [];

    const editorMessages = events
      .filter((e: any) => e.event_type === "MessageCreate" && e.sender_id === editorUserId && e.text)
      .slice(0, maxMessages);

    console.log(`[editor-dms] ${editorMessages.length} messages from @${EDITOR_HANDLE}`);

    for (const msg of editorMessages) {
      if (seenDMs.has(msg.id)) continue;
      seenDMs.add(msg.id);

      const urlRegex = /https?:\/\/[^\s]+/g;
      const urls = msg.text.match(urlRegex) || [];
      if (urls.length === 0) continue;

      const primaryUrl = urls[0];
      const isGitHub = primaryUrl.includes("github.com");
      const description = msg.text.replace(urlRegex, "").trim();

      discoveries.push(createDiscovery({
        id: `editor-dm-${msg.id}`,
        category: isGitHub ? "tool" : "workflow",
        title: extractTitleFromUrl(primaryUrl) || description.slice(0, 50) || primaryUrl,
        oneLiner: description || `Editor pick: ${primaryUrl}`,
        what: description || `Suggested by @${EDITOR_HANDLE}`,
        why: `Editorial pick from @${EDITOR_HANDLE}`,
        impact: "Hand-picked by newsletter editor",
        install: {
          steps: isGitHub ? [`git clone ${primaryUrl}`, "See repo README for setup"] : [`See ${primaryUrl}`],
          timeEstimate: "5 min",
        },
        source: { url: primaryUrl, type: isGitHub ? "github" : "twitter", author: EDITOR_HANDLE, date: msg.created_at },
        signals: { engagement: 9999, trending: true },
        security: "unverified",
      }));
    }

    saveSeenDMs(seenDMs);
  } catch (error: any) {
    console.log(`[editor-dms] DM error: ${error.message}`);
  }

  return discoveries;
}

function extractTitleFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === "github.com") {
      const parts = parsed.pathname.split("/").filter(Boolean);
      if (parts.length >= 2) return parts[1];
    }
    if (parsed.hostname === "x.com" || parsed.hostname === "twitter.com") return null;
    return parsed.hostname.replace("www.", "");
  } catch {
    return null;
  }
}

export { EDITOR_HANDLE };
