import { describe, it, expect, beforeEach } from "vitest";
import { generateId, generateName } from "./names";

// Point DATA_DIR at a nonexistent path so getNextIssueNumber() always returns 0
beforeEach(() => {
  process.env.DATA_DIR = "/tmp/morning-stew-test-nonexistent-" + Date.now();
});

describe("generateId", () => {
  it("generates ID in format MS-#N", () => {
    const date = new Date("2026-02-07");
    const id = generateId(date);
    expect(id).toMatch(/^MS-#\d+$/);
  });

  it("generates consistent IDs for same date", () => {
    const date = new Date("2026-02-07");
    expect(generateId(date)).toBe(generateId(date));
  });
});

describe("generateName", () => {
  it("generates a non-empty name", () => {
    const date = new Date("2026-02-07");
    const name = generateName(date);
    expect(name).toBeTruthy();
    expect(name.length).toBeGreaterThan(0);
  });

  it("generates consistent names for same date", () => {
    const date = new Date("2026-02-07");
    expect(generateName(date)).toBe(generateName(date));
  });

  it("generates two-word names (adjective + noun)", () => {
    const date = new Date("2026-03-15");
    const name = generateName(date);
    expect(name.split(" ").length).toBeGreaterThanOrEqual(2);
  });
});
