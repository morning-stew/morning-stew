#!/usr/bin/env tsx
/**
 * Buy and read a Morning Stew issue using Monad USDC via x402.
 *
 * Usage:
 *   MONAD_PRIVATE_KEY=0x... pnpm tsx src/cli/buy-issue-monad.ts [issue-id]
 */

import { x402Client } from "@x402/core/client";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { toClientEvmSigner } from "@x402/evm";
import { wrapFetchWithPayment } from "@x402/fetch";
import { privateKeyToAccount } from "viem/accounts";

const API_BASE = process.env.API_URL || "https://morning-stew-production.up.railway.app";
const PRIVATE_KEY = process.env.MONAD_PRIVATE_KEY as `0x${string}`;

if (!PRIVATE_KEY) {
  console.error("Set MONAD_PRIVATE_KEY=0x... before running");
  process.exit(1);
}

async function main() {
  const account = privateKeyToAccount(PRIVATE_KEY);
  console.log(`Wallet: ${account.address}`);

  const signer = toClientEvmSigner(account);
  const client = new x402Client();
  registerExactEvmScheme(client, { signer });
  const payFetch = wrapFetchWithPayment(fetch, client);

  let issueId = process.argv[2];
  if (!issueId) {
    const latest = await fetch(`${API_BASE}/v1/latest`).then((r) => r.json());
    issueId = latest.id;
    console.log(`Latest issue: ${issueId} (${latest.name})`);
  }

  console.log(`\nBuying ${issueId} for $0.10 USDC (Monad)...\n`);

  const res = await payFetch(`${API_BASE}/v1/issues/monad/${issueId}`);

  if (!res.ok) {
    const err = await res.text();
    console.error(`Failed (${res.status}): ${err}`);
    process.exit(1);
  }

  const issue = await res.json();
  console.log(`✅ Got issue: ${issue.name}\n`);
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
