import { describe, it, expect, vi, afterEach } from "vitest";
import {
  detectPlaceholders,
  checkStepCompleteness,
  checkCommandSyntax,
  checkUrlLiveness,
  checkCloneUrls,
  checkPackageRegistry,
  diagnoseDiscovery,
} from "./install-checks";

afterEach(() => {
  vi.restoreAllMocks();
});

function mockFetch(status: number) {
  return vi.fn().mockResolvedValue({ ok: status >= 200 && status < 300, status });
}

// ── detectPlaceholders ───────────────────────────────────────────────────────
describe("detectPlaceholders", () => {
  it("passes with no placeholder steps", () => {
    const r = detectPlaceholders(["git clone https://example.com", "pip install foo"]);
    expect(r.status).toBe("pass");
    expect(r.message).toBe("none");
  });

  it("warns when minority of steps are placeholders", () => {
    const r = detectPlaceholders([
      "git clone https://example.com",
      "cd repo",
      "# Check README for setup instructions",
    ]);
    expect(r.status).toBe("warn");
    expect(r.message).toContain("1 of 3");
  });

  it("fails when majority of steps are placeholders", () => {
    const r = detectPlaceholders([
      "git clone https://example.com",
      "# Check README for setup",
      "# Visit https://example.com for docs",
    ]);
    expect(r.status).toBe("fail");
    expect(r.message).toContain("2 of 3");
  });

  it("fails with empty steps array", () => {
    const r = detectPlaceholders([]);
    expect(r.status).toBe("fail");
  });

  it("passes when inline comment doesn't match placeholder keywords", () => {
    const r = detectPlaceholders([
      "git clone https://example.com",
      "cp .env.example .env  # requires API_KEY",
    ]);
    expect(r.status).toBe("pass");
  });
});

// ── checkStepCompleteness ────────────────────────────────────────────────────
describe("checkStepCompleteness", () => {
  it("fails with empty steps", () => {
    expect(checkStepCompleteness([]).status).toBe("fail");
  });

  it("fails when all steps are comments", () => {
    const r = checkStepCompleteness(["# check readme", "# visit site"]);
    expect(r.status).toBe("fail");
    expect(r.message).toBe("all steps are placeholders");
  });

  it("warns with only 1 runnable command", () => {
    const r = checkStepCompleteness(["npm install my-tool"]);
    expect(r.status).toBe("warn");
    expect(r.message).toBe("only 1 runnable command");
  });

  it("passes with multiple runnable commands", () => {
    const r = checkStepCompleteness(["git clone https://x.com/r", "cd r", "npm install"]);
    expect(r.status).toBe("pass");
    expect(r.message).toBe("3 runnable commands");
  });

  it("counts only non-comment steps as runnable", () => {
    const r = checkStepCompleteness([
      "git clone https://example.com",
      "# Check README",
      "cd repo",
    ]);
    expect(r.status).toBe("pass");
    expect(r.message).toBe("2 runnable commands");
  });
});

// ── checkCommandSyntax ───────────────────────────────────────────────────────
describe("checkCommandSyntax", () => {
  it("returns null when no syntax issues", () => {
    expect(checkCommandSyntax(["git clone https://github.com/foo/bar", "cd bar"])).toBeNull();
  });

  it("fails when git clone has no URL", () => {
    const r = checkCommandSyntax(["git clone"]);
    expect(r?.status).toBe("fail");
    expect(r?.message).toContain("missing URL");
  });

  it("fails when git clone has a non-URL, non-SSH arg", () => {
    const r = checkCommandSyntax(["git clone myrepo"]);
    expect(r?.status).toBe("fail");
    expect(r?.message).toContain("suspect arg");
  });

  it("passes for git clone with https URL", () => {
    expect(checkCommandSyntax(["git clone https://github.com/foo/bar"])).toBeNull();
  });

  it("passes for git clone with SSH URL", () => {
    expect(checkCommandSyntax(["git clone git@github.com:foo/bar.git"])).toBeNull();
  });
});

// ── checkUrlLiveness ─────────────────────────────────────────────────────────
describe("checkUrlLiveness", () => {
  it("passes on HTTP 200", async () => {
    vi.stubGlobal("fetch", mockFetch(200));
    const r = await checkUrlLiveness("https://example.com");
    expect(r.status).toBe("pass");
    expect(r.message).toBe("200");
  });

  it("fails on HTTP 404", async () => {
    vi.stubGlobal("fetch", mockFetch(404));
    const r = await checkUrlLiveness("https://example.com/missing");
    expect(r.status).toBe("fail");
    expect(r.message).toBe("404 not found");
  });

  it("warns on 301 redirect", async () => {
    vi.stubGlobal("fetch", mockFetch(301));
    const r = await checkUrlLiveness("https://example.com/old");
    expect(r.status).toBe("warn");
    expect(r.message).toContain("301");
  });

  it("warns on timeout", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(
      Object.assign(new Error("timeout"), { name: "TimeoutError" })
    ));
    const r = await checkUrlLiveness("https://example.com");
    expect(r.status).toBe("warn");
    expect(r.message).toBe("timeout");
  });

  it("warns on network error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network error")));
    const r = await checkUrlLiveness("https://example.com");
    expect(r.status).toBe("warn");
    expect(r.message).toBe("unreachable");
  });
});

// ── checkCloneUrls ───────────────────────────────────────────────────────────
describe("checkCloneUrls", () => {
  it("returns null when no git clone steps", async () => {
    const r = await checkCloneUrls(["npm install foo", "cd myapp"]);
    expect(r).toBeNull();
  });

  it("passes when repo URL is reachable", async () => {
    vi.stubGlobal("fetch", mockFetch(200));
    const r = await checkCloneUrls(["git clone https://github.com/foo/bar"]);
    expect(r?.status).toBe("pass");
    expect(r?.message).toBe("repo exists");
  });

  it("fails when repo URL returns 404", async () => {
    vi.stubGlobal("fetch", mockFetch(404));
    const r = await checkCloneUrls(["git clone https://github.com/gone/repo"]);
    expect(r?.status).toBe("fail");
    expect(r?.message).toContain("unreachable");
  });

  it("ignores non-https git clone steps", async () => {
    const r = await checkCloneUrls(["git clone git@github.com:foo/bar.git"]);
    expect(r).toBeNull();
  });
});

// ── checkPackageRegistry ─────────────────────────────────────────────────────
describe("checkPackageRegistry", () => {
  it("returns null for non-package steps", async () => {
    const r = await checkPackageRegistry("git clone https://example.com");
    expect(r).toBeNull();
  });

  it("returns null for brew install", async () => {
    const r = await checkPackageRegistry("brew install myformula");
    expect(r).toBeNull();
  });

  it("passes for pip install -r without network call", async () => {
    const r = await checkPackageRegistry("pip install -r requirements.txt");
    expect(r?.status).toBe("pass");
    expect(r?.message).toContain("requirements.txt");
  });

  it("passes for pip3 install -r without network call", async () => {
    const r = await checkPackageRegistry("pip3 install -r requirements.txt");
    expect(r?.status).toBe("pass");
  });

  it("passes for npm install when package exists", async () => {
    vi.stubGlobal("fetch", mockFetch(200));
    const r = await checkPackageRegistry("npm install express");
    expect(r?.status).toBe("pass");
    expect(r?.message).toContain("express");
    expect(r?.message).toContain("npm");
  });

  it("fails for npm install when package not found", async () => {
    vi.stubGlobal("fetch", mockFetch(404));
    const r = await checkPackageRegistry("npm install nonexistent-pkg-xyz-abc");
    expect(r?.status).toBe("fail");
  });

  it("passes for npm install -g with package", async () => {
    vi.stubGlobal("fetch", mockFetch(200));
    const r = await checkPackageRegistry("npm install -g devctx");
    expect(r?.status).toBe("pass");
  });

  it("passes for pip install when package exists on PyPI", async () => {
    vi.stubGlobal("fetch", mockFetch(200));
    const r = await checkPackageRegistry("pip install requests");
    expect(r?.status).toBe("pass");
    expect(r?.message).toContain("PyPI");
  });

  it("passes for npx with package on npm", async () => {
    vi.stubGlobal("fetch", mockFetch(200));
    const r = await checkPackageRegistry("npx -y @phantom/mcp-server");
    expect(r?.status).toBe("pass");
  });

  it("fails for npx with non-existent package", async () => {
    vi.stubGlobal("fetch", mockFetch(404));
    const r = await checkPackageRegistry("npx nonexistent-xyz-tool");
    expect(r?.status).toBe("fail");
  });
});

// ── diagnoseDiscovery ────────────────────────────────────────────────────────
describe("diagnoseDiscovery", () => {
  const baseDiscovery = {
    id: "test-1",
    title: "Test Tool",
    source: { url: "https://github.com/test/tool" },
    install: {
      steps: [
        "git clone https://github.com/test/tool",
        "cd tool",
        "npm install my-dep",
      ],
    },
  };

  it("returns pass grade when all checks pass", async () => {
    vi.stubGlobal("fetch", mockFetch(200));
    const d = await diagnoseDiscovery(baseDiscovery);
    expect(d.grade).toBe("pass");
    expect(d.checks["Source URL"].status).toBe("pass");
    expect(d.checks["git clone"].status).toBe("pass");
    expect(d.checks["Steps"].status).toBe("pass");
  });

  it("returns fail grade when source URL is 404", async () => {
    vi.stubGlobal("fetch", mockFetch(404));
    const d = await diagnoseDiscovery(baseDiscovery);
    expect(d.grade).toBe("fail");
  });

  it("flags placeholder-heavy discovery as fail", async () => {
    vi.stubGlobal("fetch", mockFetch(200));
    const d = await diagnoseDiscovery({
      id: "test-2",
      title: "Placeholder Discovery",
      source: { url: "https://github.com/test/repo" },
      install: {
        steps: [
          "git clone https://github.com/test/repo",
          "# Check README for setup instructions",
          "# Visit https://github.com/test/repo for docs",
        ],
      },
    });
    expect(d.checks["Placeholders"].status).toBe("fail");
    expect(d.grade).toBe("fail");
  });

  it("warns on curl|sh piped install", async () => {
    vi.stubGlobal("fetch", mockFetch(200));
    const d = await diagnoseDiscovery({
      id: "test-3",
      title: "Curl Install Tool",
      source: { url: "https://example.com" },
      install: {
        steps: [
          "curl -fsSL https://example.com/install.sh | sh",
          "Set MY_API_KEY env var",
        ],
      },
    });
    expect(d.checks["curl | sh"]).toBeDefined();
    expect(d.checks["curl | sh"].status).toBe("warn");
    expect(d.grade).toBe("warn");
  });

  it("includes brew install check", async () => {
    vi.stubGlobal("fetch", mockFetch(200));
    const d = await diagnoseDiscovery({
      id: "test-4",
      title: "Brew Tool",
      source: { url: "https://github.com/test/brew-tool" },
      install: { steps: ["brew install test-formula", "test-formula init"] },
    });
    expect(d.checks["brew install"]).toBeDefined();
    expect(d.checks["brew install"].status).toBe("pass");
  });
});
