/**
 * LLM-based curation judge.
 *
 * Uses Nous Research's Hermes model (OpenAI-compatible API) to evaluate
 * whether a piece of content is actionable for an AI agent developer.
 *
 * The keyword filter is the cheap first pass (kills spam).
 * This is the smart second pass — it reads the content and decides:
 *   "Can a developer install, integrate, or build with this RIGHT NOW?"
 *
 * If the answer is no, it doesn't matter how interesting the content is.
 */

function getNousConfig() {
  return {
    apiKey: process.env.NOUS_API_KEY || "",
    apiUrl: process.env.NOUS_API_URL || "https://inference-api.nousresearch.com/v1",
    model: process.env.NOUS_MODEL || "Hermes-4.3-36B",
  };
}

export interface JudgeInput {
  content: string;         // The tweet text, HN title, or repo description
  source: string;          // "twitter", "hackernews", "github"
  author?: string;         // Who posted it
  externalUrl?: string;    // Link in the content, if any
  engagement?: number;     // Likes, stars, points
}

export interface JudgeVerdict {
  actionable: boolean;          // Passes ALL 5 criteria?
  confidence: number;           // 0-1 how confident
  category: string;             // tool, integration, infrastructure, etc.
  title: string;                // Clean, concise title
  oneLiner: string;             // What is this in one sentence
  valueProp: string;            // Why should a developer care
  installHint: string;          // How to get started (if actionable)
  skipReason?: string;          // Which criterion failed and why
  scores: {
    utility: number;            // 0-1
    downloadability: number;    // 0-1
    specificity: number;        // 0-1
    signal: number;             // 0-1
    novelty: number;            // 0-1
  };
}

const SYSTEM_PROMPT = `You are a ruthless curation judge for "Morning Stew", a daily newsletter for AI agent developers.

Score each item against EXACTLY 5 criteria. ALL must pass for inclusion.

═══ THE 5 CRITERIA ═══

1. UTILITY (right now)
   Can a developer USE this to build, improve, or deploy an AI agent TODAY?
   - Must be functional software, not a concept or announcement
   - No waitlists, no "coming soon", no "beta signup"
   - No meme projects, novelty toys, or joke repos
   - Must solve a real problem for someone building AI agents
   Score 0 if: waitlist, announcement-only, meme/joke, not agent-related
   Score 1 if: working tool that solves a real agent dev problem right now

2. DOWNLOADABILITY
   Can you actually install or run it with a concrete command?
   - Must have a real install path: npm install, pip install, git clone, docker pull
   - README must have setup instructions that actually work
   - Not just a landing page or docs site with no code
   Score 0 if: no repo, no package, install instructions missing or broken
   Score 1 if: clear install command, real repo with code

3. SPECIFICITY
   Is this ONE specific tool/skill, NOT an aggregation?
   - REJECT: "awesome-X" lists, curated collections, roundups, "top N" posts
   - REJECT: directories, catalogs, or indexes of other tools
   - If it's a list of things, the list itself is NOT the discovery — the individual items are
   - Must be a single, focused tool/library/skill with a clear purpose
   Score 0 if: aggregation, curated list, directory, "awesome" repo, roundup
   Score 1 if: single focused tool with one clear purpose

4. SIGNAL
   Is there evidence real developers care about this?
   - GitHub stars, HN upvotes, tweet likes, forks
   - Comments/discussion indicating real usage (not just hype)
   - Low signal is OK if the tool is genuinely useful and new
   Score 0 if: zero engagement, no evidence anyone has used it
   Score 0.5 if: some engagement but unclear if real usage
   Score 1 if: clear evidence of real developer interest or usage

5. NOVELTY
   Is this fresh content, not something that's been around for weeks?
   - Repo created or significantly updated in last 48 hours
   - HN/Twitter post from last 48 hours
   - Not a well-known established tool being re-shared
   Score 0 if: old content being recycled, established tool everyone knows
   Score 1 if: new release, new repo, or significant update in last 48h

═══ SCORING ═══

An item passes ONLY if ALL scores are >= 0.5.
If ANY criterion scores below 0.5, set actionable=false and explain which one failed in skipReason.

═══ RESPONSE FORMAT ═══

Respond with ONLY a JSON object (no markdown, no code fences):
{
  "actionable": true/false,
  "confidence": 0.0-1.0,
  "scores": { "utility": 0.0-1.0, "downloadability": 0.0-1.0, "specificity": 0.0-1.0, "signal": 0.0-1.0, "novelty": 0.0-1.0 },
  "category": "tool|integration|infrastructure|workflow|security|privacy|model|skill",
  "title": "Clean concise title (max 60 chars)",
  "oneLiner": "What this is in one sentence — be specific about what it DOES",
  "valueProp": "One sentence: what becomes possible for an agent developer after installing this",
  "installHint": "The exact install command (e.g. 'npm install x' or 'git clone url')",
  "skipReason": "If rejected: which criterion failed and why (one sentence)"
}`;

/**
 * Judge a single piece of content.
 */
export async function judgeContent(input: JudgeInput): Promise<JudgeVerdict | null> {
  const { apiKey, apiUrl, model } = getNousConfig();
  if (!apiKey) {
    console.log("[llm-judge] No NOUS_API_KEY set, skipping LLM judge");
    return null;
  }

  const userMessage = buildUserMessage(input);

  try {
    const response = await fetch(`${apiUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userMessage },
        ],
        max_tokens: 500,
        temperature: 0.1, // Low temp for consistent judgments
      }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      console.log(`[llm-judge] API error ${response.status}: ${errText.slice(0, 200)}`);
      return null;
    }

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content?.trim();

    if (!text) return null;

    // Parse JSON — handle potential markdown wrapping
    const jsonStr = text.replace(/^```json?\s*/i, "").replace(/```\s*$/, "").trim();
    const verdict = JSON.parse(jsonStr) as JudgeVerdict;

    return verdict;
  } catch (error) {
    console.log(`[llm-judge] Error judging content:`, error);
    return null;
  }
}

/**
 * Judge a batch of content items.
 * Runs them in parallel with a concurrency limit to stay within rate limits.
 */
export async function judgeBatch(
  inputs: JudgeInput[],
  concurrency = 5
): Promise<(JudgeVerdict | null)[]> {
  if (!getNousConfig().apiKey) {
    console.log("[llm-judge] No NOUS_API_KEY set, skipping LLM judge");
    return inputs.map(() => null);
  }

  console.log(`[llm-judge] Judging ${inputs.length} items (concurrency=${concurrency})...`);

  const results: (JudgeVerdict | null)[] = new Array(inputs.length).fill(null);
  let idx = 0;

  async function worker() {
    while (idx < inputs.length) {
      const i = idx++;
      results[i] = await judgeContent(inputs[i]);
      // Small delay to respect rate limits (100 req/min = ~600ms between)
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  // Launch workers
  const workers = Array.from({ length: Math.min(concurrency, inputs.length) }, () => worker());
  await Promise.all(workers);

  const actionable = results.filter((r) => r?.actionable).length;
  const skipped = results.filter((r) => r && !r.actionable).length;
  const failed = results.filter((r) => r === null).length;

  console.log(`[llm-judge] Results: ${actionable} actionable, ${skipped} skipped, ${failed} failed`);

  return results;
}

function buildUserMessage(input: JudgeInput): string {
  let msg = `Source: ${input.source}`;
  if (input.author) msg += ` | Author: ${input.author}`;
  if (input.engagement) msg += ` | Engagement: ${input.engagement}`;
  if (input.externalUrl) msg += ` | Link: ${input.externalUrl}`;
  msg += `\n\nContent:\n${input.content}`;
  return msg;
}

/**
 * Check if the LLM judge is available (API key configured).
 */
export function isJudgeAvailable(): boolean {
  return !!process.env.NOUS_API_KEY;
}
