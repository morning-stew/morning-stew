#!/usr/bin/env tsx
/**
 * Buy and read a Morning Stew issue using Monad USDC.
 * Signs EIP-3009 TransferWithAuthorization, sends to server which settles via facilitator.
 *
 * Usage:
 *   MONAD_PRIVATE_KEY=0x... pnpm tsx src/cli/buy-issue-monad.ts [issue-id]
 */

import { privateKeyToAccount } from "viem/accounts";
import { keccak256, toHex } from "viem";

const API_BASE = process.env.API_URL || "https://morning-stew-production.up.railway.app";
const PRIVATE_KEY = process.env.MONAD_PRIVATE_KEY as `0x${string}`;

if (!PRIVATE_KEY) {
  console.error("Set MONAD_PRIVATE_KEY=0x... before running");
  process.exit(1);
}

async function main() {
  const account = privateKeyToAccount(PRIVATE_KEY);
  console.log(`Wallet: ${account.address}`);

  let issueId = process.argv[2];
  if (!issueId) {
    const latest = await fetch(`${API_BASE}/v1/latest`).then((r) => r.json());
    issueId = latest.id;
    console.log(`Latest issue: ${issueId} (${latest.name})`);
  }

  // Step 1: Get payment requirements
  console.log(`\nFetching payment requirements for ${issueId}...`);
  const reqRes = await fetch(`${API_BASE}/v1/issues/monad/${issueId}`);
  if (reqRes.status !== 402) {
    console.log(`Unexpected status ${reqRes.status}:`, await reqRes.text());
    process.exit(1);
  }
  const requirements = await reqRes.json();
  const accept = requirements.accepts[0];
  console.log(`  payTo: ${accept.payTo}`);
  console.log(`  price: ${accept.price}`);
  console.log(`  asset: ${accept.asset}`);

  // Step 2: Sign EIP-3009 authorization
  const now = Math.floor(Date.now() / 1000);
  const nonce = keccak256(toHex(Math.random().toString()));
  const value = "100000"; // $0.10 USDC (6 decimals)

  const authorization = {
    from: account.address,
    to: accept.payTo,
    value,
    validAfter: (now - 60).toString(),
    validBefore: (now + 900).toString(),
    nonce,
  };

  const domain = {
    name: "USDC",
    version: "2",
    chainId: BigInt(143),
    verifyingContract: accept.asset as `0x${string}`,
  };

  const types = {
    TransferWithAuthorization: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" },
      { name: "validBefore", type: "uint256" },
      { name: "nonce", type: "bytes32" },
    ],
  };

  console.log(`\nSigning EIP-3009 authorization for $0.10 USDC...`);
  const signature = await account.signTypedData({
    domain,
    types,
    primaryType: "TransferWithAuthorization",
    message: {
      from: authorization.from as `0x${string}`,
      to: authorization.to as `0x${string}`,
      value: BigInt(authorization.value),
      validAfter: BigInt(authorization.validAfter),
      validBefore: BigInt(authorization.validBefore),
      nonce: authorization.nonce as `0x${string}`,
    },
  });

  // Step 3: Send payment
  const payload = {
    x402Version: 2,
    scheme: "exact",
    network: "eip155:143",
    payload: { authorization, signature },
  };

  const paymentHeader = Buffer.from(JSON.stringify(payload)).toString("base64");
  console.log(`Sending payment...`);

  const res = await fetch(`${API_BASE}/v1/issues/monad/${issueId}`, {
    headers: { "PAYMENT-SIGNATURE": paymentHeader },
  });

  // Log response headers
  const txHash = res.headers.get("x-payment-transaction");
  if (txHash) console.log(`\nTX Hash: ${txHash}`);

  if (!res.ok) {
    const err = await res.text();
    console.error(`Failed (${res.status}): ${err}`);
    process.exit(1);
  }

  const issue = await res.json();
  console.log(`\n✅ Got issue: ${issue.name}`);
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
