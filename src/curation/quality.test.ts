import { describe, it, expect, vi, afterEach } from "vitest";
import { scoreDiscovery, generateValueProp, generateTags } from "./quality";
import { createDiscovery } from "../types/discovery";
import type { Discovery } from "../types/discovery";

afterEach(() => {
  vi.restoreAllMocks();
});

function makeDiscovery(overrides: Partial<Discovery> = {}): Discovery {
  return createDiscovery({
    id: "test-1",
    category: "tool",
    title: "Test Tool",
    oneLiner: "A test tool",
    what: "A tool for testing",
    why: "Because testing",
    impact: "Better tests",
    install: { steps: [] },
    source: { url: "https://example.com", type: "web" },
    signals: { engagement: 0 },
    ...overrides,
  });
}

describe("scoreDiscovery (non-github, no fetch)", () => {
  it("installProcess === 1 when steps include npm install", async () => {
    const d = makeDiscovery({ install: { steps: ["npm install my-tool"] } });
    const score = await scoreDiscovery(d);
    expect(score.installProcess).toBe(1);
  });

  it("installProcess === 0 when steps are empty", async () => {
    const d = makeDiscovery({ install: { steps: [] } });
    const score = await scoreDiscovery(d);
    expect(score.installProcess).toBe(0);
  });

  it("realUsage === 1 when engagement >= 1000", async () => {
    const d = makeDiscovery({ signals: { engagement: 1000 } });
    const score = await scoreDiscovery(d);
    expect(score.realUsage).toBe(1);
  });

  it("realUsage === 0 when engagement === 0", async () => {
    const d = makeDiscovery({ signals: { engagement: 0 } });
    const score = await scoreDiscovery(d);
    expect(score.realUsage).toBe(0);
  });

  it("novelValue >= 0.8 when oneLiner contains 'novel'", async () => {
    const d = makeDiscovery({ oneLiner: "A novel open source tool for agents" });
    const score = await scoreDiscovery(d);
    expect(score.novelValue).toBeGreaterThanOrEqual(0.8);
  });

  it("genuineUtility >= 0.35 when oneLiner contains 'mcp'", async () => {
    const d = makeDiscovery({ oneLiner: "An MCP server for agent tool use" });
    const score = await scoreDiscovery(d);
    expect(score.genuineUtility).toBeGreaterThanOrEqual(0.35);
  });

  it("score.total equals sum of the 5 dimensions", async () => {
    const d = makeDiscovery({
      oneLiner: "An MCP server",
      install: { steps: ["npm install mcp-tool"] },
      signals: { engagement: 500 },
    });
    const score = await scoreDiscovery(d);
    const expectedTotal =
      score.novelValue +
      score.realUsage +
      score.installProcess +
      score.documentation +
      score.genuineUtility;
    expect(score.total).toBeCloseTo(expectedTotal, 1);
  });

  it("archived github repo sets realUsage === 0", async () => {
    const mockFetch = vi.fn()
      // First call: repo metadata
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          stargazers_count: 500,
          forks_count: 50,
          open_issues_count: 10,
          size: 100,
          archived: true,
          network_count: 10,
        }),
      })
      // Second call: commits
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ([{ commit: { author: { date: new Date().toISOString() } } }]),
      })
      // Third call: readme
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          content: Buffer.from("## Installation\n```bash\nnpm install foo\n```").toString("base64"),
        }),
      });
    vi.stubGlobal("fetch", mockFetch);

    const d = makeDiscovery({
      source: { url: "https://github.com/foo/bar", type: "github" },
      signals: { engagement: 500 },
    });
    const score = await scoreDiscovery(d);
    expect(score.realUsage).toBe(0);
  });
});

describe("generateValueProp", () => {
  it("contains 'MCP' when oneLiner includes 'mcp'", () => {
    const d = makeDiscovery({ oneLiner: "An MCP server for agents" });
    const vp = generateValueProp(d);
    expect(vp.toLowerCase()).toContain("mcp");
  });

  it("returns non-empty fallback for plain discovery", () => {
    const d = makeDiscovery({ oneLiner: "A simple utility", title: "Simple Util" });
    const vp = generateValueProp(d);
    expect(vp.length).toBeGreaterThan(0);
  });
});

describe("generateTags", () => {
  it("includes 'mcp' tag when oneLiner contains 'mcp'", () => {
    const d = makeDiscovery({ oneLiner: "An MCP server for agents" });
    const tags = generateTags(d);
    expect(tags).toContain("mcp");
  });

  it("always includes the category as a tag", () => {
    const d = makeDiscovery({ category: "infrastructure" });
    const tags = generateTags(d);
    expect(tags).toContain("infrastructure");
  });

  it("tag list is capped at 6", () => {
    const d = makeDiscovery({
      title: "MCP GitHub Slack Discord Postgres Docker",
      oneLiner: "mcp github slack discord postgres docker kubernetes",
      what: "browser workflow x402 rag self-host memory api",
    });
    const tags = generateTags(d);
    expect(tags.length).toBeLessThanOrEqual(6);
  });
});
