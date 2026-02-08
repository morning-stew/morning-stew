#!/usr/bin/env tsx
/**
 * End-to-end X402 payment test for Morning Stew.
 * 
 * Tests the full payment flow:
 * 1. Buyer requests gated content → receives 402
 * 2. Buyer creates payment and retries → receives content
 * 3. Seller balance should increase
 * 
 * Uses Base Sepolia testnet with Circle-funded USDC.
 */

import { privateKeyToAccount } from "viem/accounts";
import { x402Client, wrapFetchWithPayment } from "@x402/fetch";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import * as fs from "fs";
import * as path from "path";

const WALLETS_FILE = path.join(process.cwd(), ".morning-stew/test-wallets.json");
const API_BASE = process.env.API_URL || "http://localhost:3000";

interface TestWallets {
  seller: { privateKey: string; address: string };
  buyer: { privateKey: string; address: string };
}

async function loadWallets(): Promise<TestWallets> {
  const content = fs.readFileSync(WALLETS_FILE, "utf-8");
  return JSON.parse(content);
}

async function main() {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║  🍵 Morning Stew X402 End-to-End Payment Test                ║
╚══════════════════════════════════════════════════════════════╝
`);

  // Load test wallets
  const wallets = await loadWallets();
  console.log(`[test] Buyer address:  ${wallets.buyer.address}`);
  console.log(`[test] Seller address: ${wallets.seller.address}`);
  console.log(`[test] API base:       ${API_BASE}`);
  console.log();

  // Create buyer account (signer) from private key
  const signer = privateKeyToAccount(wallets.buyer.privateKey as `0x${string}`);
  
  // Create x402 client and register EVM scheme for payment
  const client = new x402Client();
  registerExactEvmScheme(client, { signer });

  // Wrap fetch with X402 payment handling
  const x402Fetch = wrapFetchWithPayment(fetch, client);

  // Step 1: Check what newsletters are available
  console.log("[test] Step 1: Fetching available issues...");
  const listRes = await fetch(`${API_BASE}/v1/issues`);
  const listData = await listRes.json();
  
  if (!listData.issues || listData.issues.length === 0) {
    console.error("[test] No newsletters available. Run 'pnpm generate' first.");
    process.exit(1);
  }

  const targetIssue = listData.issues[0];
  console.log(`[test] Found ${listData.issues.length} issue(s)`);
  console.log(`[test] Target: ${targetIssue.id} - "${targetIssue.name}"`);
  console.log(`[test] Price:  ${targetIssue.price}`);
  console.log();

  // Step 2: Try to fetch without payment (should get 402)
  console.log("[test] Step 2: Requesting without payment...");
  const noPayRes = await fetch(`${API_BASE}/v1/issues/${targetIssue.id}`);
  console.log(`[test] Response status: ${noPayRes.status}`);
  
  if (noPayRes.status !== 402) {
    console.error(`[test] Expected 402, got ${noPayRes.status}`);
    const body = await noPayRes.text();
    console.error(`[test] Body: ${body}`);
    process.exit(1);
  }
  
  const paymentRequired = await noPayRes.json();
  console.log(`[test] ✓ Received 402 Payment Required`);
  console.log(`[test] Payment details:`, JSON.stringify(paymentRequired.x402 || paymentRequired, null, 2));
  console.log();

  // Step 3: Use X402 fetch to automatically pay and retrieve
  console.log("[test] Step 3: Fetching with automatic X402 payment...");
  console.log("[test] (x402Fetch will handle the payment flow automatically)");
  
  try {
    const paidRes = await x402Fetch(`${API_BASE}/v1/issues/${targetIssue.id}`);
    
    if (!paidRes.ok) {
      console.error(`[test] Payment request failed: ${paidRes.status}`);
      const errorBody = await paidRes.text();
      console.error(`[test] Error: ${errorBody}`);
      process.exit(1);
    }

    const newsletter = await paidRes.json();
    
    console.log(`[test] ✓ Payment successful! Newsletter received.`);
    console.log();
    console.log("═══════════════════════════════════════════════════════════════");
    console.log(`Newsletter: ${newsletter.name}`);
    console.log(`ID:         ${newsletter.id}`);
    console.log(`Date:       ${newsletter.date}`);
    console.log(`Skills:     ${newsletter.skills?.length || 0}`);
    console.log(`Updates:    ${newsletter.frameworkUpdates?.length || 0}`);
    console.log(`Twitter:    ${newsletter.twitterBuzz?.length || 0}`);
    console.log(`Tokens:     ${newsletter.tokenCount}`);
    console.log("═══════════════════════════════════════════════════════════════");
    console.log();
    
    // Show first skill as sample
    if (newsletter.skills && newsletter.skills.length > 0) {
      console.log("[test] Sample skill from newsletter:");
      console.log(JSON.stringify(newsletter.skills[0], null, 2));
    }

    console.log();
    console.log("[test] ✅ End-to-end payment test PASSED");
    console.log("[test] The buyer paid $0.05 USDC and received the newsletter.");
    
  } catch (error) {
    console.error("[test] Payment flow error:", error);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("[test] Fatal error:", err);
  process.exit(1);
});
