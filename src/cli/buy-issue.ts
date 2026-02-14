#!/usr/bin/env tsx
/**
 * Buy and read a Morning Stew issue using x402 payment.
 * Uses the local Solana keypair (~/.config/solana/id.json).
 *
 * Usage: pnpm tsx src/cli/buy-issue.ts [issue-id]
 */

import { Keypair, VersionedTransaction } from "@solana/web3.js";
import { readFileSync } from "fs";
import { join } from "path";
import { createX402Client } from "x402-solana/client";

const API_BASE = process.env.API_URL || "https://morning-stew-production.up.railway.app";
const KEYPAIR_PATH = join(process.env.HOME!, ".config/solana/id.json");

async function main() {
  // Load keypair
  const secret = JSON.parse(readFileSync(KEYPAIR_PATH, "utf-8"));
  const keypair = Keypair.fromSecretKey(Uint8Array.from(secret));
  console.log(`Wallet: ${keypair.publicKey.toBase58()}`);

  // Determine issue ID
  let issueId = process.argv[2];
  if (!issueId) {
    const latest = await fetch(`${API_BASE}/v1/latest`).then(r => r.json());
    issueId = latest.id;
    console.log(`Latest issue: ${issueId} (${latest.name})`);
  }

  // Create x402 client with keypair-based wallet adapter
  const wallet = {
    publicKey: keypair.publicKey,
    signTransaction: async (tx: VersionedTransaction) => {
      tx.sign([keypair]);
      return tx;
    },
  };

  const client = createX402Client({
    wallet,
    network: "solana",
    rpcUrl: "https://api.mainnet-beta.solana.com",
    verbose: true,
  });

  console.log(`\nBuying ${issueId} for $0.10 USDC...\n`);

  const res = await client.fetch(`${API_BASE}/v1/issues/${issueId}`);

  if (!res.ok) {
    const err = await res.text();
    console.error(`Failed (${res.status}): ${err}`);
    process.exit(1);
  }

  const issue = await res.json();
  console.log(`\n✅ Got issue: ${issue.name}\n`);
  console.log(`Discoveries (${issue.discoveries?.length || 0}):`);
  for (const d of issue.discoveries || []) {
    console.log(`  • ${d.title} — ${d.oneLiner}`);
    if (d.install) console.log(`    Install: ${typeof d.install === "string" ? d.install : d.install.join(" && ")}`);
  }
}

main().catch((err) => {
  console.error("Error:", err.message || err);
  process.exit(1);
});
