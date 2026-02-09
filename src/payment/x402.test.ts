import { describe, it, expect } from "vitest";
import { centsToPriceString, NETWORKS, createSubscription } from "./x402";

describe("centsToPriceString", () => {
  it("converts cents to dollar string", () => {
    expect(centsToPriceString(5)).toBe("$0.05");
    expect(centsToPriceString(25)).toBe("$0.25");
    expect(centsToPriceString(100)).toBe("$1.00");
    expect(centsToPriceString(150)).toBe("$1.50");
  });
});

describe("NETWORKS", () => {
  it("has correct CAIP-2 format for Base", () => {
    expect(NETWORKS.BASE_MAINNET).toBe("eip155:8453");
    expect(NETWORKS.BASE_SEPOLIA).toBe("eip155:84532");
  });

  it("has correct format for Solana", () => {
    expect(NETWORKS.SOLANA_MAINNET).toMatch(/^solana:/);
    expect(NETWORKS.SOLANA_DEVNET).toMatch(/^solana:/);
  });
});

describe("createSubscription", () => {
  it("creates weekly subscription with expiry", () => {
    const sub = createSubscription(
      "0xAgent123",
      "weekly",
      NETWORKS.BASE_MAINNET,
      "0xabc123"
    );

    expect(sub.walletAddress).toBe("0xagent123"); // lowercase
    expect(sub.tier).toBe("weekly");
    expect(sub.chain).toBe("base");
    expect(sub.currency).toBe("USDC");
    expect(sub.expiresAt).toBeDefined();
  });

  it("creates bulk_250 subscription with issuesRemaining", () => {
    const sub = createSubscription(
      "0xAgent456",
      "bulk_250",
      NETWORKS.BASE_SEPOLIA,
      "0xdef789"
    );

    expect(sub.tier).toBe("bulk_250");
    expect(sub.issuesRemaining).toBe(250);
  });
});
