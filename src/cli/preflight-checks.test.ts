import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  checkGitHub,
  checkNous,
  checkTwitterBearer,
  checkTwitterOAuth,
  checkBrave,
  checkDeepEnrich,
  runPreflight,
} from "./preflight-checks";

// Mock twitter-auth to avoid filesystem reads
vi.mock("../scrapers/twitter-auth", () => ({
  loadTokens: vi.fn().mockReturnValue(null),
}));

import { loadTokens } from "../scrapers/twitter-auth";

// ── Helpers ──

function mockFetchOk(json: any) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => json,
    text: async () => JSON.stringify(json),
  });
}

function mockFetchFail(status: number, body = "error") {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    json: async () => ({}),
    text: async () => body,
  });
}

function mockFetchThrow(message: string) {
  return vi.fn().mockRejectedValue(new Error(message));
}

// ── Setup ──

const savedEnv: Record<string, string | undefined> = {};
const envKeys = [
  "GITHUB_TOKEN", "NOUS_API_KEY", "NOUS_API_URL", "NOUS_MODEL",
  "X_BEARER_TOKEN", "BRAVE_API_KEY", "X_CLIENT_ID", "X_CLIENT_SECRET",
];

beforeEach(() => {
  vi.restoreAllMocks();
  vi.mocked(loadTokens).mockReturnValue(null);
  for (const key of envKeys) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of envKeys) {
    if (savedEnv[key] !== undefined) process.env[key] = savedEnv[key];
    else delete process.env[key];
  }
});

// ═══════════════════════════════════════════════════════════════
// checkGitHub
// ═══════════════════════════════════════════════════════════════

describe("checkGitHub", () => {
  it("skips when GITHUB_TOKEN is not set", async () => {
    const result = await checkGitHub();
    expect(result.status).toBe("skip");
    expect(result.name).toBe("GITHUB_TOKEN");
  });

  it("passes with valid token", async () => {
    process.env.GITHUB_TOKEN = "ghp_test123";
    vi.stubGlobal("fetch", mockFetchOk({ login: "testuser" }));

    const result = await checkGitHub();
    expect(result.status).toBe("pass");
    expect(result.message).toContain("testuser");
  });

  it("fails on 401 response", async () => {
    process.env.GITHUB_TOKEN = "ghp_bad";
    vi.stubGlobal("fetch", mockFetchFail(401, "Bad credentials"));

    const result = await checkGitHub();
    expect(result.status).toBe("fail");
    expect(result.message).toContain("401");
  });

  it("fails on network error", async () => {
    process.env.GITHUB_TOKEN = "ghp_test";
    vi.stubGlobal("fetch", mockFetchThrow("ECONNREFUSED"));

    const result = await checkGitHub();
    expect(result.status).toBe("fail");
    expect(result.message).toContain("ECONNREFUSED");
  });
});

// ═══════════════════════════════════════════════════════════════
// checkNous
// ═══════════════════════════════════════════════════════════════

describe("checkNous", () => {
  it("fails when NOUS_API_KEY is not set (required)", async () => {
    const result = await checkNous();
    expect(result.status).toBe("fail");
    expect(result.message).toContain("required");
  });

  it("passes when model is found in API response", async () => {
    process.env.NOUS_API_KEY = "nous-test-key";
    vi.stubGlobal("fetch", mockFetchOk({
      data: [{ id: "Hermes-4.3-36B" }, { id: "other-model" }],
    }));

    const result = await checkNous();
    expect(result.status).toBe("pass");
    expect(result.message).toContain("Hermes-4.3-36B");
    expect(result.message).toContain("available");
  });

  it("passes with warning when model is not listed", async () => {
    process.env.NOUS_API_KEY = "nous-test-key";
    vi.stubGlobal("fetch", mockFetchOk({
      data: [{ id: "some-other-model" }],
    }));

    const result = await checkNous();
    expect(result.status).toBe("pass");
    expect(result.message).toContain("not listed");
  });

  it("uses custom NOUS_MODEL when set", async () => {
    process.env.NOUS_API_KEY = "nous-test-key";
    process.env.NOUS_MODEL = "CustomModel-7B";
    vi.stubGlobal("fetch", mockFetchOk({
      data: [{ id: "CustomModel-7B" }],
    }));

    const result = await checkNous();
    expect(result.status).toBe("pass");
    expect(result.message).toContain("CustomModel-7B");
  });

  it("fails on API error", async () => {
    process.env.NOUS_API_KEY = "nous-bad-key";
    vi.stubGlobal("fetch", mockFetchFail(403, "Forbidden"));

    const result = await checkNous();
    expect(result.status).toBe("fail");
    expect(result.message).toContain("403");
  });

  it("fails on network error", async () => {
    process.env.NOUS_API_KEY = "nous-test-key";
    vi.stubGlobal("fetch", mockFetchThrow("timeout"));

    const result = await checkNous();
    expect(result.status).toBe("fail");
    expect(result.message).toContain("timeout");
  });
});

// ═══════════════════════════════════════════════════════════════
// checkTwitterBearer
// ═══════════════════════════════════════════════════════════════

describe("checkTwitterBearer", () => {
  it("fails when X_BEARER_TOKEN is not set (required)", async () => {
    const result = await checkTwitterBearer();
    expect(result.status).toBe("fail");
    expect(result.message).toContain("required");
  });

  it("passes on 200 OK", async () => {
    process.env.X_BEARER_TOKEN = "bearer-test";
    vi.stubGlobal("fetch", mockFetchOk({ data: [] }));

    const result = await checkTwitterBearer();
    expect(result.status).toBe("pass");
    expect(result.message).toContain("search API OK");
  });

  it("passes on 429 (rate limited but token valid)", async () => {
    process.env.X_BEARER_TOKEN = "bearer-test";
    vi.stubGlobal("fetch", mockFetchFail(429, "Too Many Requests"));

    const result = await checkTwitterBearer();
    expect(result.status).toBe("pass");
    expect(result.message).toContain("rate limited");
  });

  it("fails on 401", async () => {
    process.env.X_BEARER_TOKEN = "bearer-bad";
    vi.stubGlobal("fetch", mockFetchFail(401, "Unauthorized"));

    const result = await checkTwitterBearer();
    expect(result.status).toBe("fail");
    expect(result.message).toContain("401");
  });

  it("fails on network error", async () => {
    process.env.X_BEARER_TOKEN = "bearer-test";
    vi.stubGlobal("fetch", mockFetchThrow("ENOTFOUND"));

    const result = await checkTwitterBearer();
    expect(result.status).toBe("fail");
    expect(result.message).toContain("ENOTFOUND");
  });
});

// ═══════════════════════════════════════════════════════════════
// checkTwitterOAuth
// ═══════════════════════════════════════════════════════════════

describe("checkTwitterOAuth", () => {
  it("fails when no tokens found", () => {
    vi.mocked(loadTokens).mockReturnValue(null);

    const result = checkTwitterOAuth();
    expect(result.status).toBe("fail");
    expect(result.message).toContain("no tokens found");
  });

  it("passes when token is valid (>5 min remaining)", () => {
    vi.mocked(loadTokens).mockReturnValue({
      access_token: "at",
      refresh_token: "rt",
      expires_at: Date.now() + 600_000, // 10 min
      scope: "tweet.read",
    });

    const result = checkTwitterOAuth();
    expect(result.status).toBe("pass");
    expect(result.message).toContain("token valid");
  });

  it("passes when token is expiring soon (<5 min but >0)", () => {
    vi.mocked(loadTokens).mockReturnValue({
      access_token: "at",
      refresh_token: "rt",
      expires_at: Date.now() + 120_000, // 2 min
      scope: "tweet.read",
    });

    const result = checkTwitterOAuth();
    expect(result.status).toBe("pass");
    expect(result.message).toContain("expiring soon");
  });

  it("passes when expired but refresh credentials are set", () => {
    process.env.X_CLIENT_ID = "client-id";
    process.env.X_CLIENT_SECRET = "client-secret";
    vi.mocked(loadTokens).mockReturnValue({
      access_token: "at",
      refresh_token: "rt",
      expires_at: Date.now() - 60_000, // expired 1 min ago
      scope: "tweet.read",
    });

    const result = checkTwitterOAuth();
    expect(result.status).toBe("pass");
    expect(result.message).toContain("auto-refresh");
  });

  it("fails when expired and no refresh credentials", () => {
    vi.mocked(loadTokens).mockReturnValue({
      access_token: "at",
      refresh_token: "rt",
      expires_at: Date.now() - 60_000,
      scope: "tweet.read",
    });

    const result = checkTwitterOAuth();
    expect(result.status).toBe("fail");
    expect(result.message).toContain("X_CLIENT_ID");
  });
});

// ═══════════════════════════════════════════════════════════════
// checkBrave
// ═══════════════════════════════════════════════════════════════

describe("checkBrave", () => {
  it("skips when BRAVE_API_KEY is not set", async () => {
    const result = await checkBrave();
    expect(result.status).toBe("skip");
  });

  it("passes on 200 OK", async () => {
    process.env.BRAVE_API_KEY = "brave-key";
    vi.stubGlobal("fetch", mockFetchOk({ web: { results: [] } }));

    const result = await checkBrave();
    expect(result.status).toBe("pass");
    expect(result.message).toContain("search API OK");
  });

  it("fails on error response", async () => {
    process.env.BRAVE_API_KEY = "brave-bad";
    vi.stubGlobal("fetch", mockFetchFail(403, "Invalid key"));

    const result = await checkBrave();
    expect(result.status).toBe("fail");
    expect(result.message).toContain("403");
  });
});

// ═══════════════════════════════════════════════════════════════
// checkDeepEnrich
// ═══════════════════════════════════════════════════════════════

// Mock twitter-api to avoid real HTTP + Hermes calls
vi.mock("../scrapers/twitter-api", () => ({
  deepEnrichUrl: vi.fn(),
  fetchTweetContent: vi.fn(),
  parseTweets: vi.fn().mockReturnValue([]),
}));

import { deepEnrichUrl } from "../scrapers/twitter-api";

describe("checkDeepEnrich", () => {
  it("skips when NOUS_API_KEY is not set", async () => {
    const result = await checkDeepEnrich();
    expect(result.status).toBe("skip");
    expect(result.name).toBe("Deep Enrich");
  });

  it("passes when brief has content and install commands", async () => {
    process.env.NOUS_API_KEY = "nous-test-key";
    vi.mocked(deepEnrichUrl).mockResolvedValue(
      "PydanticAI is a framework for building AI agents.\n\nInstall/Setup:\npip install pydantic-ai\n\nDocs: https://ai.pydantic.dev"
    );

    const result = await checkDeepEnrich();
    expect(result.status).toBe("pass");
    expect(result.message).toContain("has install");
  });

  it("fails when brief is too short", async () => {
    process.env.NOUS_API_KEY = "nous-test-key";
    vi.mocked(deepEnrichUrl).mockResolvedValue("short");

    const result = await checkDeepEnrich();
    expect(result.status).toBe("fail");
    expect(result.message).toContain("too short");
  });

  it("fails when brief has no install commands", async () => {
    process.env.NOUS_API_KEY = "nous-test-key";
    vi.mocked(deepEnrichUrl).mockResolvedValue(
      "This is a long description of some tool that does interesting things but lacks any install instructions whatsoever."
    );

    const result = await checkDeepEnrich();
    expect(result.status).toBe("fail");
    expect(result.message).toContain("missing install");
  });

  it("fails on error", async () => {
    process.env.NOUS_API_KEY = "nous-test-key";
    vi.mocked(deepEnrichUrl).mockRejectedValue(new Error("network failure"));

    const result = await checkDeepEnrich();
    expect(result.status).toBe("fail");
    expect(result.message).toContain("network failure");
  });
});

// ═══════════════════════════════════════════════════════════════
// runPreflight (orchestrator)
// ═══════════════════════════════════════════════════════════════

describe("runPreflight", () => {
  it("returns results for all 6 checks", async () => {
    // All keys missing — should get mix of fail/skip
    vi.stubGlobal("fetch", mockFetchOk({}));

    const results = await runPreflight();
    expect(results).toHaveLength(6);

    const names = results.map((r) => r.name);
    expect(names).toContain("GITHUB_TOKEN");
    expect(names).toContain("NOUS_API_KEY");
    expect(names).toContain("X_BEARER_TOKEN");
    expect(names).toContain("Twitter OAuth");
    expect(names).toContain("BRAVE_API_KEY");
    expect(names).toContain("Deep Enrich");
  });

  it("reports correct statuses with no env vars set", async () => {
    vi.stubGlobal("fetch", mockFetchOk({}));

    const results = await runPreflight();
    const byName = Object.fromEntries(results.map((r) => [r.name, r.status]));

    expect(byName["GITHUB_TOKEN"]).toBe("skip");     // optional
    expect(byName["NOUS_API_KEY"]).toBe("fail");      // required
    expect(byName["X_BEARER_TOKEN"]).toBe("fail");    // required
    expect(byName["Twitter OAuth"]).toBe("fail");     // no tokens
    expect(byName["BRAVE_API_KEY"]).toBe("skip");     // optional
    expect(byName["Deep Enrich"]).toBe("skip");       // needs NOUS_API_KEY
  });

  it("all pass when keys are valid", async () => {
    process.env.GITHUB_TOKEN = "ghp_valid";
    process.env.NOUS_API_KEY = "nous-valid";
    process.env.X_BEARER_TOKEN = "bearer-valid";
    process.env.BRAVE_API_KEY = "brave-valid";

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ login: "bot", data: [{ id: "Hermes-4.3-36B" }] }),
      text: async () => "",
    }));

    vi.mocked(loadTokens).mockReturnValue({
      access_token: "at",
      refresh_token: "rt",
      expires_at: Date.now() + 600_000,
      scope: "tweet.read",
    });

    vi.mocked(deepEnrichUrl).mockResolvedValue(
      "PydanticAI is a framework for building AI agents.\n\nInstall/Setup:\npip install pydantic-ai"
    );

    const results = await runPreflight();
    const allPass = results.every((r) => r.status === "pass");
    expect(allPass).toBe(true);
  });
});
