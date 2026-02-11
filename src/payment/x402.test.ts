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
  it("has correct PayAI network identifiers for Solana", () => {
    expect(NETWORKS.SOLANA_MAINNET).toBe("solana");
    expect(NETWORKS.SOLANA_DEVNET).toBe("solana-devnet");
  });
});

describe("createSubscription", () => {
  it("creates weekly subscription with expiry", () => {
    const sub = createSubscription(
      "Agent123PublicKey",
      "weekly",
      NETWORKS.SOLANA_MAINNET,
      "txhash123abc"
    );

    expect(sub.walletAddress).toBe("agent123publickey"); // lowercase
    expect(sub.tier).toBe("weekly");
    expect(sub.chain).toBe("solana");
    expect(sub.currency).toBe("USDC");
    expect(sub.expiresAt).toBeDefined();
  });

  it("creates bulk_250 subscription with issuesRemaining", () => {
    const sub = createSubscription(
      "Agent456PublicKey",
      "bulk_250",
      NETWORKS.SOLANA_DEVNET,
      "txhash789def"
    );

    expect(sub.tier).toBe("bulk_250");
    expect(sub.chain).toBe("solana");
    expect(sub.issuesRemaining).toBe(250);
  });
});
