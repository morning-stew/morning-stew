import { describe, it, expect } from "vitest";
import { centsToPriceString, NETWORKS } from "./x402";

describe("centsToPriceString", () => {
  it("converts cents to dollar string", () => {
    expect(centsToPriceString(5)).toBe("$0.05");
    expect(centsToPriceString(25)).toBe("$0.25");
    expect(centsToPriceString(100)).toBe("$1.00");
    expect(centsToPriceString(150)).toBe("$1.50");
  });
});

describe("NETWORKS", () => {
  it("has correct PayAI network identifier for Solana mainnet", () => {
    expect(NETWORKS.SOLANA_MAINNET).toBe("solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp");
  });
});
