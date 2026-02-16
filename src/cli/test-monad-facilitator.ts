#!/usr/bin/env tsx
/**
 * Test molandak facilitator directly: /verify then /settle
 * Following the Monad x402 docs exactly.
 */
import { privateKeyToAccount } from "viem/accounts";
import { keccak256, toHex } from "viem";

const FACILITATOR_URL = "https://x402-facilitator.molandak.org";
const PRIVATE_KEY = process.env.MONAD_PRIVATE_KEY as `0x${string}`;
const PAY_TO = "0x450915b568bE49e0E1C367c241799cAC39756c19";

const NETWORK = "eip155:143"; // mainnet
const USDC_ADDRESS = "0x754704Bc059F8C67012fEd69BC8A327a5aafb603";
const CHAIN_ID = 143;

if (!PRIVATE_KEY) {
  console.error("Set MONAD_PRIVATE_KEY=0x...");
  process.exit(1);
}

async function main() {
  const account = privateKeyToAccount(PRIVATE_KEY);
  console.log(`Wallet: ${account.address}`);

  const now = Math.floor(Date.now() / 1000);
  const nonce = keccak256(toHex(Math.random().toString()));

  const authorization = {
    from: account.address,
    to: PAY_TO,
    value: "100000", // 0.10 USDC (6 decimals)
    validAfter: (now - 60).toString(),
    validBefore: (now + 900).toString(),
    nonce,
  };

  const domain = {
    name: "USDC",
    version: "2",
    chainId: BigInt(CHAIN_ID),
    verifyingContract: USDC_ADDRESS as `0x${string}`,
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

  const message = {
    from: authorization.from as `0x${string}`,
    to: authorization.to as `0x${string}`,
    value: BigInt(authorization.value),
    validAfter: BigInt(authorization.validAfter),
    validBefore: BigInt(authorization.validBefore),
    nonce: authorization.nonce as `0x${string}`,
  };

  console.log("\nSigning EIP-712 TransferWithAuthorization...");
  const signature = await account.signTypedData({
    domain,
    types,
    primaryType: "TransferWithAuthorization",
    message,
  });
  console.log(`Signature: ${signature.slice(0, 20)}...`);

  const requestBody = {
    x402Version: 2,
    payload: { authorization, signature },
    resource: {
      url: "https://morning-stew-production.up.railway.app/v1/issues/monad/MS-#1",
      description: "Morning Stew newsletter issue",
      mimeType: "application/json",
    },
    accepted: {
      scheme: "exact",
      network: NETWORK,
      amount: authorization.value,
      asset: USDC_ADDRESS,
      payTo: PAY_TO,
      maxTimeoutSeconds: 300,
      extra: { name: "USDC", version: "2" },
    },
  };

  // Step 1: Verify
  console.log("\n--- POST /verify ---");
  const verifyRes = await fetch(`${FACILITATOR_URL}/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestBody),
  });
  const verifyData = await verifyRes.json();
  console.log(`Status: ${verifyRes.status}`);
  console.log(JSON.stringify(verifyData, null, 2));

  if (!verifyData.isValid) {
    console.error("Verify failed, stopping.");
    process.exit(1);
  }

  // Step 2: Settle
  console.log("\n--- POST /settle ---");
  const settleRes = await fetch(`${FACILITATOR_URL}/settle`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestBody),
  });
  const settleData = await settleRes.json();
  console.log(`Status: ${settleRes.status}`);
  console.log(JSON.stringify(settleData, null, 2));

  if (settleData.success && settleData.transaction) {
    console.log(`\n✅ TX HASH: ${settleData.transaction}`);
  } else {
    console.log(`\n❌ Settlement failed: ${settleData.errorReason || "unknown"}`);
  }
}

main().catch((err) => {
  console.error("Error:", err.message || err);
  process.exit(1);
});
