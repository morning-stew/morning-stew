#!/usr/bin/env tsx
/**
 * Buy and read a Morning Stew issue using x402 payment.
 * Uses the local Solana keypair (~/.config/solana/id.json).
 *
 * Usage: pnpm tsx src/cli/buy-issue.ts [issue-id]
 */

import { createKeyPairSignerFromBytes } from "@solana/kit";
import { readFileSync } from "fs";
import { join } from "path";
import { x402Client, wrapFetchWithPayment } from "@x402/fetch";
import { registerExactSvmScheme } from "@x402/svm/exact/client";

const API_BASE = process.env.API_URL || "https://morning-stew-production.up.railway.app";
const KEYPAIR_PATH = join(process.env.HOME!, ".config/solana/id.json");

async function main() {
  const secret = JSON.parse(readFileSync(KEYPAIR_PATH, "utf-8"));
  const signer = await createKeyPairSignerFromBytes(Uint8Array.from(secret));
  console.log(`Wallet: ${signer.address}`);

  let issueId = process.argv[2];
  if (!issueId) {
    const latest = await fetch(`${API_BASE}/v1/latest`).then(r => r.json());
    issueId = latest.id;
    console.log(`Latest issue: ${issueId} (${latest.name})`);
  }

  const client = new x402Client();
  registerExactSvmScheme(client, { signer });
  const payFetch = wrapFetchWithPayment(fetch, client);

  console.log(`\nBuying ${issueId} for $0.10 USDC...\n`);

  const res = await payFetch(`${API_BASE}/v1/issues/${issueId}`);

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
