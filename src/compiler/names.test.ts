import { describe, it, expect } from "vitest";
import { generateId, generateName } from "./names";

describe("generateId", () => {
  it("generates ID in format MS-YYYY-DDD", () => {
    const date = new Date("2026-02-07");
    const id = generateId(date);
    expect(id).toMatch(/^MS-2026-\d{3}$/);
  });

  it("generates consistent IDs for same date", () => {
    const date = new Date("2026-02-07");
    expect(generateId(date)).toBe(generateId(date));
  });

  it("generates different IDs for different dates", () => {
    const date1 = new Date("2026-02-07");
    const date2 = new Date("2026-02-08");
    expect(generateId(date1)).not.toBe(generateId(date2));
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

  it("uses special names for holidays", () => {
    const newYear = new Date("2026-01-01");
    expect(generateName(newYear)).toBe("Fresh Molt");
  });

  it("generates two-word names (adjective + noun)", () => {
    const date = new Date("2026-03-15");
    const name = generateName(date);
    expect(name.split(" ").length).toBeGreaterThanOrEqual(2);
  });
});
