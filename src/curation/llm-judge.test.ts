import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { isJudgeAvailable, judgeContent, judgeBatch } from "./llm-judge";
import type { JudgeInput, JudgeVerdict } from "./llm-judge";

const MOCK_VERDICT: JudgeVerdict = {
  actionable: true,
  confidence: 0.9,
  category: "tool",
  title: "Test Tool",
  oneLiner: "A test tool for agents",
  valueProp: "Adds testing capability",
  installHint: "npm install test-tool",
  scores: {
    utility: 0.9,
    downloadability: 1.0,
    specificity: 0.8,
    signal: 0.7,
    novelty: 0.9,
  },
};

const SAMPLE_INPUT: JudgeInput = {
  content: "Just released: npm install my-agent-tool",
  source: "hackernews",
  engagement: 200,
};

function makeFetchMock(verdict: JudgeVerdict | string | null, ok = true, status = 200) {
  return vi.fn().mockResolvedValue({
    ok,
    status,
    text: async () => (ok ? "" : "Rate limit exceeded"),
    json: async () => {
      if (!ok) return {};
      const content =
        typeof verdict === "string"
          ? verdict
          : JSON.stringify(verdict);
      return { choices: [{ message: { content } }] };
    },
  });
}

beforeEach(() => {
  process.env.NOUS_API_KEY = "test-key";
});

afterEach(() => {
  delete process.env.NOUS_API_KEY;
  vi.restoreAllMocks();
});

describe("isJudgeAvailable", () => {
  it("returns false when NOUS_API_KEY is not set", () => {
    delete process.env.NOUS_API_KEY;
    expect(isJudgeAvailable()).toBe(false);
  });

  it("returns true when NOUS_API_KEY is set", () => {
    process.env.NOUS_API_KEY = "some-key";
    expect(isJudgeAvailable()).toBe(true);
  });
});

describe("judgeContent", () => {
  it("returns null when no API key (no fetch called)", async () => {
    delete process.env.NOUS_API_KEY;
    const mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
    const result = await judgeContent(SAMPLE_INPUT);
    expect(result).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns parsed verdict on 200 response", async () => {
    vi.stubGlobal("fetch", makeFetchMock(MOCK_VERDICT));
    const result = await judgeContent(SAMPLE_INPUT);
    expect(result).not.toBeNull();
    expect(result!.actionable).toBe(true);
    expect(result!.title).toBe("Test Tool");
  });

  it("parses verdict wrapped in ```json code fence", async () => {
    const fenced = "```json\n" + JSON.stringify(MOCK_VERDICT) + "\n```";
    vi.stubGlobal("fetch", makeFetchMock(fenced));
    const result = await judgeContent(SAMPLE_INPUT);
    expect(result).not.toBeNull();
    expect(result!.title).toBe("Test Tool");
  });

  it("returns null on 429 response", async () => {
    vi.stubGlobal("fetch", makeFetchMock(null, false, 429));
    const result = await judgeContent(SAMPLE_INPUT);
    expect(result).toBeNull();
  });

  it("returns null on fetch exception", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network error")));
    const result = await judgeContent(SAMPLE_INPUT);
    expect(result).toBeNull();
  });

  it("returns null when choices is empty", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ choices: [] }),
    }));
    const result = await judgeContent(SAMPLE_INPUT);
    expect(result).toBeNull();
  });
});

describe("judgeBatch", () => {
  it("returns [] for empty input", async () => {
    const result = await judgeBatch([]);
    expect(result).toEqual([]);
  });

  it("returns all nulls when no API key", async () => {
    delete process.env.NOUS_API_KEY;
    const inputs: JudgeInput[] = [SAMPLE_INPUT, SAMPLE_INPUT, SAMPLE_INPUT];
    const result = await judgeBatch(inputs);
    expect(result).toHaveLength(3);
    expect(result.every((r) => r === null)).toBe(true);
  });

  it("calls judgeContent once per input and preserves order", async () => {
    // Each call returns MOCK_VERDICT with a unique title based on call order
    let callCount = 0;
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => {
      const n = callCount++;
      const verdict = { ...MOCK_VERDICT, title: `Tool ${n}` };
      return {
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: JSON.stringify(verdict) } }] }),
      };
    }));

    const inputs: JudgeInput[] = [
      { ...SAMPLE_INPUT, content: "a" },
      { ...SAMPLE_INPUT, content: "b" },
      { ...SAMPLE_INPUT, content: "c" },
    ];

    const result = await judgeBatch(inputs, 1); // concurrency=1 to ensure order
    expect(result).toHaveLength(3);
    expect(result[0]!.title).toBe("Tool 0");
    expect(result[1]!.title).toBe("Tool 1");
    expect(result[2]!.title).toBe("Tool 2");
  });
});
