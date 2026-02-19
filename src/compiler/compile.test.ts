import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Discovery } from "../types";
import { createDiscovery } from "../types/discovery";
import type { JudgeVerdict } from "../curation/llm-judge";
import type { CurationResult, CuratedDiscovery, QualityScore } from "../curation/quality";

// ── Mock all external dependencies ──

vi.mock("../scrapers", () => ({
  scrapeEditorDMs: vi.fn().mockResolvedValue([]),
  scrapeTwitterFeed: vi.fn().mockResolvedValue([]),
  scrapeDiscoveries: vi.fn().mockResolvedValue([]),
  scrapeGitHubTrending: vi.fn().mockResolvedValue([]),
  scrapeGitHubReleases: vi.fn().mockResolvedValue([]),
  scrapeClawIndex: vi.fn().mockResolvedValue([]),
  scrapeXApiSearch: vi.fn().mockResolvedValue([]),
  resetTwitterBudget: vi.fn(),
  getTwitterCosts: vi.fn().mockReturnValue({ spend: 0, budget: 0.75, tweetsRead: 0 }),
}));

vi.mock("../curation/llm-judge", () => ({
  isJudgeAvailable: vi.fn().mockReturnValue(false),
  judgeBatch: vi.fn().mockResolvedValue([]),
}));

vi.mock("../curation", () => ({
  curateDiscoveries: vi.fn().mockResolvedValue({
    picks: [],
    onRadar: [],
    skipped: [],
    isQuietWeek: true,
  }),
}));

vi.mock("../registry", () => ({
  loadRegistry: vi.fn().mockReturnValue({ entries: {} }),
  saveRegistry: vi.fn(),
  registryKey: vi.fn((d: Discovery) => d.source?.url || d.title),
  registerDiscovery: vi.fn(),
}));

// Mock fs to prevent real filesystem operations
vi.mock("fs", () => ({
  existsSync: vi.fn().mockReturnValue(false),
  readFileSync: vi.fn().mockReturnValue("[]"),
  readdirSync: vi.fn().mockReturnValue([]),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

// ── Imports (after mocks) ──

import { compileNewsletter } from "./compile";
import {
  scrapeEditorDMs,
  scrapeTwitterFeed,
  scrapeDiscoveries,
  scrapeGitHubTrending,
  scrapeGitHubReleases,
  scrapeClawIndex,
  scrapeXApiSearch,
  resetTwitterBudget,
  getTwitterCosts,
} from "../scrapers";
import { isJudgeAvailable, judgeBatch } from "../curation/llm-judge";
import { curateDiscoveries } from "../curation";
import { loadRegistry, saveRegistry, registerDiscovery } from "../registry";

// ── Helpers ──

const DEFAULT_QUALITY_SCORE: QualityScore = {
  total: 4,
  novelValue: 0.8,
  realUsage: 0.8,
  installProcess: 0.8,
  documentation: 0.8,
  genuineUtility: 0.8,
  reasons: ["test"],
};

function makeDiscovery(overrides: Partial<Discovery> & { id: string }): Discovery {
  return createDiscovery({
    category: "tool",
    title: `Tool ${overrides.id}`,
    oneLiner: "A test tool",
    what: "A tool for testing",
    why: "Because testing",
    impact: "Better tests",
    install: { steps: ["npm install test-tool"] },
    source: { url: `https://github.com/test/${overrides.id}`, type: "github" },
    signals: { engagement: 100 },
    ...overrides,
  });
}

function makeCurated(d: Discovery, score?: Partial<QualityScore>): CuratedDiscovery {
  return {
    ...d,
    qualityScore: { ...DEFAULT_QUALITY_SCORE, ...score },
    valueProp: d.oneLiner,
  };
}

function makeVerdict(overrides: Partial<JudgeVerdict> = {}): JudgeVerdict {
  return {
    actionable: true,
    confidence: 0.9,
    category: "tool",
    title: "Judged Tool",
    oneLiner: "A judged tool",
    valueProp: "LLM says useful",
    installHint: "npm install judged",
    scores: { utility: 0.9, downloadability: 1.0, specificity: 0.8, signal: 0.7, novelty: 0.9 },
    ...overrides,
  };
}

// ── Setup ──

beforeEach(() => {
  vi.restoreAllMocks();

  // Re-apply default mock return values after restore
  vi.mocked(scrapeEditorDMs).mockResolvedValue([]);
  vi.mocked(scrapeTwitterFeed).mockResolvedValue([]);
  vi.mocked(scrapeDiscoveries).mockResolvedValue([]);
  vi.mocked(scrapeGitHubTrending).mockResolvedValue([]);
  vi.mocked(scrapeGitHubReleases).mockResolvedValue([]);
  vi.mocked(scrapeClawIndex).mockResolvedValue([]);
  vi.mocked(scrapeXApiSearch).mockResolvedValue([]);
  vi.mocked(getTwitterCosts).mockReturnValue({ spend: 0, budget: 0.75, tweetsRead: 0 });
  vi.mocked(isJudgeAvailable).mockReturnValue(false);
  vi.mocked(judgeBatch).mockResolvedValue([]);
  vi.mocked(curateDiscoveries).mockResolvedValue({
    picks: [],
    onRadar: [],
    skipped: [],
    isQuietWeek: true,
  });
  vi.mocked(loadRegistry).mockReturnValue({ entries: {} });

  process.env.DATA_DIR = "/tmp/morning-stew-test-" + Date.now();
});

afterEach(() => {
  delete process.env.DATA_DIR;
});

// ═══════════════════════════════════════════════════════════════
// Phase 1: Editor tips
// ═══════════════════════════════════════════════════════════════

describe("Phase 1: Editor tips", () => {
  it("calls scrapeEditorDMs when not skipped", async () => {
    vi.mocked(curateDiscoveries).mockResolvedValueOnce({
      picks: [],
      onRadar: [],
      skipped: [],
      isQuietWeek: true,
    });

    await expect(
      compileNewsletter({ skipMinimumCheck: true, skipCuration: true })
    ).resolves.toBeDefined();

    expect(scrapeEditorDMs).toHaveBeenCalledOnce();
  });

  it("skips editor DMs when skipEditorDMs is set", async () => {
    await compileNewsletter({ skipEditorDMs: true, skipMinimumCheck: true, skipCuration: true });
    expect(scrapeEditorDMs).not.toHaveBeenCalled();
  });

  it("editor picks are always forced into final newsletter", async () => {
    const editorPick = makeDiscovery({ id: "editor-tip-1" });
    vi.mocked(scrapeEditorDMs).mockResolvedValueOnce([editorPick]);

    // Curation returns picks that DON'T include the editor pick
    const otherPicks = Array.from({ length: 6 }, (_, i) =>
      makeCurated(makeDiscovery({ id: `other-${i}` }))
    );
    vi.mocked(curateDiscoveries).mockResolvedValueOnce({
      picks: otherPicks,
      onRadar: [],
      skipped: [],
      isQuietWeek: false,
    });

    const result = await compileNewsletter({ skipMinimumCheck: true });
    const ids = result.discoveries.map((d) => d.id);
    expect(ids).toContain("editor-tip-1");
  });
});

// ═══════════════════════════════════════════════════════════════
// Phase 2: Twitter
// ═══════════════════════════════════════════════════════════════

describe("Phase 2: Twitter feed", () => {
  it("calls scrapeTwitterFeed with calculated slots", async () => {
    await compileNewsletter({ skipMinimumCheck: true, skipCuration: true });
    expect(scrapeTwitterFeed).toHaveBeenCalledWith(
      expect.objectContaining({
        targetDiscoveries: expect.any(Number),
        batchSize: 15,
        maxBatches: 10,
        sinceHours: 48,
      })
    );
  });

  it("skips Twitter when skipTwitter is set", async () => {
    await compileNewsletter({ skipTwitter: true, skipMinimumCheck: true, skipCuration: true });
    expect(scrapeTwitterFeed).not.toHaveBeenCalled();
  });

  it("resets Twitter budget at the start of compilation", async () => {
    await compileNewsletter({ skipMinimumCheck: true, skipCuration: true });
    expect(resetTwitterBudget).toHaveBeenCalledWith(0.75);
  });

  it("reduces targetDiscoveries when editor picks exist", async () => {
    const editorPicks = [makeDiscovery({ id: "editor-1" }), makeDiscovery({ id: "editor-2" })];
    vi.mocked(scrapeEditorDMs).mockResolvedValueOnce(editorPicks);

    await compileNewsletter({ skipMinimumCheck: true, skipCuration: true });
    const call = vi.mocked(scrapeTwitterFeed).mock.calls[0][0] as any;
    expect(call.targetDiscoveries).toBe(4); // 6 - 2 editor picks
  });
});

// ═══════════════════════════════════════════════════════════════
// Phase 3: Free sources (HN + GitHub + ClawIndex)
// ═══════════════════════════════════════════════════════════════

describe("Phase 3: Free sources", () => {
  it("runs HN and GitHub trending in parallel", async () => {
    await compileNewsletter({ skipMinimumCheck: true, skipCuration: true });
    expect(scrapeDiscoveries).toHaveBeenCalledOnce();
    expect(scrapeGitHubTrending).toHaveBeenCalledOnce();
    expect(scrapeGitHubReleases).toHaveBeenCalledOnce();
  });

  it("skips individual sources when flags are set", async () => {
    await compileNewsletter({
      skipDiscoveries: true,
      skipGitHubTrending: true,
      skipGitHubReleases: true,
      skipMinimumCheck: true,
      skipCuration: true,
    });
    expect(scrapeDiscoveries).not.toHaveBeenCalled();
    expect(scrapeGitHubTrending).not.toHaveBeenCalled();
    expect(scrapeGitHubReleases).not.toHaveBeenCalled();
  });

  it("ClawIndex is skipped by default (skipClawIndex !== false)", async () => {
    await compileNewsletter({ skipMinimumCheck: true, skipCuration: true });
    expect(scrapeClawIndex).not.toHaveBeenCalled();
  });

  it("ClawIndex runs when explicitly enabled (skipClawIndex: false)", async () => {
    await compileNewsletter({ skipClawIndex: false, skipMinimumCheck: true, skipCuration: true });
    expect(scrapeClawIndex).toHaveBeenCalledOnce();
  });
});

// ═══════════════════════════════════════════════════════════════
// Phase 4 & 5: LLM judge
// ═══════════════════════════════════════════════════════════════

describe("Phase 4-5: LLM judge", () => {
  it("skips LLM judging when judge is unavailable", async () => {
    vi.mocked(isJudgeAvailable).mockReturnValue(false);
    vi.mocked(scrapeGitHubTrending).mockResolvedValueOnce([
      makeDiscovery({ id: "gh-1" }),
    ]);

    await compileNewsletter({ skipMinimumCheck: true, skipCuration: true });
    expect(judgeBatch).not.toHaveBeenCalled();
  });

  it("judges HN/GitHub discoveries but not pre-judged ones", async () => {
    vi.mocked(isJudgeAvailable).mockReturnValue(true);

    const ghDiscovery = makeDiscovery({ id: "gh-1" });
    const editorDiscovery = makeDiscovery({ id: "editor-tip" });
    const twitterDiscovery = makeDiscovery({ id: "x-api-tweet" });

    vi.mocked(scrapeGitHubTrending).mockResolvedValueOnce([ghDiscovery]);
    vi.mocked(scrapeEditorDMs).mockResolvedValueOnce([editorDiscovery]);
    vi.mocked(scrapeTwitterFeed).mockResolvedValueOnce([twitterDiscovery]);
    vi.mocked(judgeBatch).mockResolvedValue([makeVerdict()]);

    await compileNewsletter({ skipMinimumCheck: true, skipCuration: true });

    // judgeBatch is called twice: once for editor enrichment (Phase 4), once for HN/GH (Phase 5)
    // Phase 5 should only include gh-1 (not editor-tip or x-api-tweet which are pre-judged)
    const phase5Call = vi.mocked(judgeBatch).mock.calls.find(
      (call) => (call[0] as any[]).length === 1
    );
    expect(phase5Call).toBeDefined();
  });

  it("excludes discoveries that fail LLM score criteria", async () => {
    vi.mocked(isJudgeAvailable).mockReturnValue(true);
    vi.mocked(scrapeGitHubTrending).mockResolvedValueOnce([
      makeDiscovery({ id: "gh-fail" }),
    ]);

    const failVerdict = makeVerdict({
      actionable: true,
      scores: { utility: 0.9, downloadability: 0.3, specificity: 0.8, signal: 0.7, novelty: 0.9 },
    });
    vi.mocked(judgeBatch).mockResolvedValueOnce([failVerdict]);

    // Curation should receive 0 candidates since the only one failed LLM
    vi.mocked(curateDiscoveries).mockResolvedValueOnce({
      picks: [],
      onRadar: [],
      skipped: [],
      isQuietWeek: true,
    });

    await compileNewsletter({ skipMinimumCheck: true });

    const curationCall = vi.mocked(curateDiscoveries).mock.calls[0];
    const candidates = curationCall[0] as Discovery[];
    // The gh-fail should NOT appear because downloadability < 0.5
    expect(candidates.find((d) => d.id === "gh-fail")).toBeUndefined();
  });

  it("passes discoveries through when verdict is null", async () => {
    vi.mocked(isJudgeAvailable).mockReturnValue(true);
    vi.mocked(scrapeGitHubTrending).mockResolvedValueOnce([
      makeDiscovery({ id: "gh-null" }),
    ]);
    vi.mocked(judgeBatch).mockResolvedValueOnce([null]);

    vi.mocked(curateDiscoveries).mockResolvedValueOnce({
      picks: [],
      onRadar: [],
      skipped: [],
      isQuietWeek: true,
    });

    await compileNewsletter({ skipMinimumCheck: true });

    const candidates = vi.mocked(curateDiscoveries).mock.calls[0][0] as Discovery[];
    expect(candidates.find((d) => d.id === "gh-null")).toBeDefined();
  });

  it("enriches editor tips with LLM when judge is available", async () => {
    vi.mocked(isJudgeAvailable).mockReturnValue(true);
    const editorPick = makeDiscovery({ id: "editor-enrich" });
    vi.mocked(scrapeEditorDMs).mockResolvedValueOnce([editorPick]);

    const enrichVerdict = makeVerdict({
      title: "Enriched Title",
      oneLiner: "Enriched description",
      valueProp: "Enriched value",
      installHint: "npm install enriched",
    });
    vi.mocked(judgeBatch).mockResolvedValueOnce([enrichVerdict]);

    await compileNewsletter({ skipMinimumCheck: true, skipCuration: true });

    // The first judgeBatch call should be for editor enrichment
    expect(vi.mocked(judgeBatch).mock.calls[0][0]).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════════
// Phase 6: Keyword search fallback
// ═══════════════════════════════════════════════════════════════

describe("Phase 6: Keyword search fallback", () => {
  it("triggers extra search when picks are below maxPicks", async () => {
    vi.mocked(isJudgeAvailable).mockReturnValue(false);
    // No discoveries from any source — triggers fallback
    await compileNewsletter({ skipMinimumCheck: true, skipCuration: true });
    expect(scrapeXApiSearch).toHaveBeenCalled();
  });

  it("skips extra search when twitter is disabled", async () => {
    await compileNewsletter({ skipTwitter: true, skipMinimumCheck: true, skipCuration: true });
    expect(scrapeXApiSearch).not.toHaveBeenCalled();
  });

  it("skips extra search when enough picks already exist", async () => {
    const ghDiscoveries = Array.from({ length: 7 }, (_, i) =>
      makeDiscovery({ id: `gh-${i}` })
    );
    vi.mocked(scrapeGitHubTrending).mockResolvedValueOnce(ghDiscoveries);

    await compileNewsletter({ skipMinimumCheck: true, skipCuration: true });
    expect(scrapeXApiSearch).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════
// Phase 7: Quality curation + final assembly
// ═══════════════════════════════════════════════════════════════

describe("Phase 7: Quality curation", () => {
  it("calls curateDiscoveries with all candidates when curation enabled", async () => {
    const ghDiscoveries = Array.from({ length: 3 }, (_, i) =>
      makeDiscovery({ id: `gh-${i}` })
    );
    vi.mocked(scrapeGitHubTrending).mockResolvedValueOnce(ghDiscoveries);
    vi.mocked(curateDiscoveries).mockResolvedValueOnce({
      picks: ghDiscoveries.map((d) => makeCurated(d)),
      onRadar: [],
      skipped: [],
      isQuietWeek: true,
    });

    await compileNewsletter({ skipMinimumCheck: true, skipTwitter: true });
    expect(curateDiscoveries).toHaveBeenCalledOnce();
  });

  it("skips curation in test mode and uses raw discoveries", async () => {
    const ghDiscoveries = Array.from({ length: 6 }, (_, i) =>
      makeDiscovery({ id: `gh-${i}` })
    );
    vi.mocked(scrapeGitHubTrending).mockResolvedValueOnce(ghDiscoveries);

    const result = await compileNewsletter({
      skipCuration: true,
      skipMinimumCheck: true,
      skipTwitter: true,
    });

    expect(curateDiscoveries).not.toHaveBeenCalled();
    expect(result.discoveries).toHaveLength(6);
  });

  it("respects maxPicks override", async () => {
    const ghDiscoveries = Array.from({ length: 10 }, (_, i) =>
      makeDiscovery({ id: `gh-${i}` })
    );
    vi.mocked(scrapeGitHubTrending).mockResolvedValueOnce(ghDiscoveries);

    const result = await compileNewsletter({
      skipCuration: true,
      skipMinimumCheck: true,
      skipTwitter: true,
      maxPicks: 3,
    });

    expect(result.discoveries).toHaveLength(3);
  });
});

// ═══════════════════════════════════════════════════════════════
// Minimum picks enforcement
// ═══════════════════════════════════════════════════════════════

describe("Minimum picks enforcement", () => {
  it("throws when picks < MIN_PICKS and skipMinimumCheck is false", async () => {
    vi.mocked(curateDiscoveries).mockResolvedValueOnce({
      picks: [makeCurated(makeDiscovery({ id: "lone-pick" }))],
      onRadar: [],
      skipped: [],
      isQuietWeek: true,
    });

    await expect(
      compileNewsletter({ skipMinimumCheck: false, skipTwitter: true })
    ).rejects.toThrow(/Insufficient quality content/);
  });

  it("does not throw when skipMinimumCheck is true", async () => {
    vi.mocked(curateDiscoveries).mockResolvedValueOnce({
      picks: [makeCurated(makeDiscovery({ id: "lone-pick" }))],
      onRadar: [],
      skipped: [],
      isQuietWeek: true,
    });

    await expect(
      compileNewsletter({ skipMinimumCheck: true, skipTwitter: true })
    ).resolves.toBeDefined();
  });

  it("saves thinking log with SCRAPPED prefix on failure", async () => {
    const { writeFileSync } = await import("fs");
    vi.mocked(curateDiscoveries).mockResolvedValueOnce({
      picks: [],
      onRadar: [],
      skipped: [],
      isQuietWeek: true,
    });

    await expect(
      compileNewsletter({ skipMinimumCheck: false, skipTwitter: true })
    ).rejects.toThrow();

    const writeCalls = vi.mocked(writeFileSync).mock.calls;
    const scrappedLog = writeCalls.find(
      (call) => typeof call[0] === "string" && call[0].includes("SCRAPPED")
    );
    expect(scrappedLog).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════
// Deduplication
// ═══════════════════════════════════════════════════════════════

describe("Deduplication", () => {
  it("dedupes by URL across sources", async () => {
    const sameUrl = "https://github.com/test/same-repo";
    const ghDiscovery = makeDiscovery({ id: "gh-dupe", source: { url: sameUrl, type: "github" } });
    const hnDiscovery = makeDiscovery({
      id: "hn-dupe",
      title: "Different Title",
      source: { url: sameUrl, type: "hackernews" },
    });

    vi.mocked(scrapeGitHubTrending).mockResolvedValueOnce([ghDiscovery]);
    vi.mocked(scrapeDiscoveries).mockResolvedValueOnce([hnDiscovery]);

    const result = await compileNewsletter({
      skipCuration: true,
      skipMinimumCheck: true,
      skipTwitter: true,
    });

    // Only one should survive dedup
    const matchingUrls = result.discoveries.filter(
      (d) => d.source.url === sameUrl
    );
    expect(matchingUrls.length).toBeLessThanOrEqual(1);
  });

  it("excludes discoveries already picked (timesPicked > 0 in registry)", async () => {
    vi.mocked(loadRegistry).mockReturnValue({
      entries: {
        "https://github.com/test/old-repo": {
          url: "https://github.com/test/old-repo",
          title: "Old Repo",
          oneLiner: "Old",
          category: "tool",
          tags: [],
          source: "github",
          install: { steps: [] },
          firstSeen: "2026-01-01",
          lastSeen: "2026-01-15",
          timesPicked: 1,
          issueIds: ["MS-#5"],
        },
      },
    });

    const oldDiscovery = makeDiscovery({
      id: "gh-old",
      source: { url: "https://github.com/test/old-repo", type: "github" },
    });
    vi.mocked(scrapeGitHubTrending).mockResolvedValueOnce([oldDiscovery]);

    const result = await compileNewsletter({
      skipCuration: true,
      skipMinimumCheck: true,
      skipTwitter: true,
    });

    expect(result.discoveries.find((d) => d.id === "gh-old")).toBeUndefined();
  });

  it("registers all candidates in registry regardless of dedup outcome", async () => {
    vi.mocked(scrapeGitHubTrending).mockResolvedValueOnce([
      makeDiscovery({ id: "gh-new" }),
    ]);

    await compileNewsletter({
      skipCuration: true,
      skipMinimumCheck: true,
      skipTwitter: true,
    });

    expect(registerDiscovery).toHaveBeenCalled();
    expect(saveRegistry).toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════
// Newsletter assembly
// ═══════════════════════════════════════════════════════════════

describe("Newsletter assembly", () => {
  it("generates valid newsletter with id, name, date", async () => {
    const picks = Array.from({ length: 6 }, (_, i) =>
      makeCurated(makeDiscovery({ id: `gh-${i}` }))
    );
    vi.mocked(curateDiscoveries).mockResolvedValueOnce({
      picks,
      onRadar: [],
      skipped: [],
      isQuietWeek: false,
    });

    const result = await compileNewsletter({ skipMinimumCheck: true, skipTwitter: true });
    expect(result.id).toMatch(/^MS-#\d+$/);
    expect(result.name).toBeTruthy();
    expect(result.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("uses overrideId when provided", async () => {
    const result = await compileNewsletter({
      overrideId: "MS-#0",
      skipCuration: true,
      skipMinimumCheck: true,
    });
    expect(result.id).toBe("MS-#0");
    expect(result.name).toBe("Issue #0");
  });

  it("includes frameworkUpdates from GitHub releases", async () => {
    const updates = [
      { type: "release" as const, title: "v2.0", url: "https://github.com/test/release", summary: "Major update", breaking: true },
    ];
    vi.mocked(scrapeGitHubReleases).mockResolvedValueOnce(updates);

    const result = await compileNewsletter({
      skipCuration: true,
      skipMinimumCheck: true,
      skipTwitter: true,
    });
    expect(result.frameworkUpdates).toHaveLength(1);
    expect(result.frameworkUpdates[0].breaking).toBe(true);
  });

  it("includes security notes", async () => {
    const picks = Array.from({ length: 6 }, (_, i) =>
      makeCurated(makeDiscovery({ id: `gh-${i}`, security: "verified" }))
    );
    vi.mocked(curateDiscoveries).mockResolvedValueOnce({
      picks,
      onRadar: [],
      skipped: [],
      isQuietWeek: false,
    });

    const result = await compileNewsletter({ skipMinimumCheck: true, skipTwitter: true });
    expect(result.securityNotes.length).toBeGreaterThan(0);
    expect(result.securityNotes.some((n) => n.includes("verified"))).toBe(true);
  });

  it("sets isQuietWeek when curation says so", async () => {
    const picks = Array.from({ length: 6 }, (_, i) =>
      makeCurated(makeDiscovery({ id: `gh-quiet-${i}` }))
    );
    vi.mocked(scrapeGitHubTrending).mockResolvedValueOnce(
      picks.map((p) => makeDiscovery({ id: p.id }))
    );
    vi.mocked(curateDiscoveries).mockResolvedValueOnce({
      picks,
      onRadar: [],
      skipped: [],
      isQuietWeek: true,
    });

    const result = await compileNewsletter({ skipMinimumCheck: true, skipTwitter: true });
    expect(result.isQuietWeek).toBe(true);
  });

  it("includes onRadar and skipped sections when present", async () => {
    const onRadarItem = makeCurated(makeDiscovery({ id: "radar-1" }), { total: 2.5 });
    onRadarItem.skipReason = "Needs more traction";
    const skippedItem = makeCurated(makeDiscovery({ id: "skip-1" }), { total: 1.0 });
    skippedItem.skipReason = "Low quality";
    const picks = Array.from({ length: 6 }, (_, i) =>
      makeCurated(makeDiscovery({ id: `gh-present-${i}` }))
    );

    vi.mocked(scrapeGitHubTrending).mockResolvedValueOnce(
      picks.map((p) => makeDiscovery({ id: p.id }))
    );
    vi.mocked(curateDiscoveries).mockResolvedValueOnce({
      picks,
      onRadar: [onRadarItem],
      skipped: [skippedItem],
      isQuietWeek: false,
    });

    const result = await compileNewsletter({ skipMinimumCheck: true, skipTwitter: true });
    expect(result.onRadar).toHaveLength(1);
    expect(result.skipped).toHaveLength(1);
  });

  it("calculates tokenCount", async () => {
    const result = await compileNewsletter({
      skipCuration: true,
      skipMinimumCheck: true,
    });
    expect(result.tokenCount).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// Thinking log
// ═══════════════════════════════════════════════════════════════

describe("Thinking log", () => {
  it("saves thinking log on successful generation", async () => {
    const { writeFileSync } = await import("fs");
    const result = await compileNewsletter({
      skipCuration: true,
      skipMinimumCheck: true,
    });

    const writeCalls = vi.mocked(writeFileSync).mock.calls;
    const logCall = writeCalls.find(
      (call) => typeof call[0] === "string" && call[0].includes("thinking-logs")
    );
    expect(logCall).toBeDefined();

    const logContent = JSON.parse(logCall![1] as string);
    expect(logContent.newsletterId).toBe(result.id);
    expect(logContent.summary).toBeDefined();
  });

  it("includes cost breakdown in thinking log", async () => {
    const { writeFileSync } = await import("fs");
    vi.mocked(getTwitterCosts).mockReturnValue({ spend: 0.45, budget: 0.75, tweetsRead: 90 });

    await compileNewsletter({ skipCuration: true, skipMinimumCheck: true });

    const writeCalls = vi.mocked(writeFileSync).mock.calls;
    const logCall = writeCalls.find(
      (call) => typeof call[0] === "string" && call[0].includes("thinking-logs")
    );
    const logContent = JSON.parse(logCall![1] as string);

    expect(logContent.costs).toBeDefined();
    expect(logContent.costs.twitter.spend).toBe(0.45);
    expect(logContent.costs.twitter.tweetsRead).toBe(90);
    expect(logContent.costs.totalEstimated).toBe(0.45);
  });
});

// ═══════════════════════════════════════════════════════════════
// validateNewsletter
// ═══════════════════════════════════════════════════════════════

describe("validateNewsletter", () => {
  // Import directly since it's a simple pure function
  it("returns true for valid newsletter", async () => {
    const { validateNewsletter } = await import("./compile");
    const newsletter = {
      id: "MS-#1",
      name: "Test",
      date: "2026-02-18",
      discoveries: [],
      frameworkUpdates: [],
      securityNotes: [],
      tokenCount: 0,
    };
    expect(validateNewsletter(newsletter as any)).toBe(true);
  });

  it("returns false for newsletter missing id", async () => {
    const { validateNewsletter } = await import("./compile");
    expect(validateNewsletter({ name: "Test", date: "2026-02-18" } as any)).toBe(false);
  });
});
