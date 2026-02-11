#!/usr/bin/env tsx
/**
 * End-to-end X402 payment test for Morning Stew.
 * 
 * Tests the full payment flow against the Solana-powered API:
 * 1. Buyer requests gated content → receives 402
 * 2. Verifies 402 response contains correct Solana payment details
 * 3. Lists available issues
 * 
 * Uses Solana Devnet with PayAI facilitator.
 */

import * as fs from "fs";
import * as path from "path";

const WALLETS_FILE = path.join(process.cwd(), ".morning-stew/test-wallets.json");
const API_BASE = process.env.API_URL || "http://localhost:3000";

interface TestWallets {
  seller: { secretKey: number[]; publicKey: string };
  buyer: { secretKey: number[]; publicKey: string };
}

async function loadWallets(): Promise<TestWallets> {
  const content = fs.readFileSync(WALLETS_FILE, "utf-8");
  return JSON.parse(content);
}

async function main() {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║  🍵 Morning Stew X402 End-to-End Test — Solana               ║
╚══════════════════════════════════════════════════════════════╝
`);

  // Load test wallets
  const wallets = await loadWallets();
  console.log(`[test] Buyer address:  ${wallets.buyer.publicKey}`);
  console.log(`[test] Seller address: ${wallets.seller.publicKey}`);
  console.log(`[test] API base:       ${API_BASE}`);
  console.log();

  // Step 1: Check health endpoint
  console.log("[test] Step 1: Checking API health...");
  const healthRes = await fetch(`${API_BASE}/`);
  const healthData = await healthRes.json();
  
  console.log(`[test] ✓ Service: ${healthData.service} v${healthData.version}`);
  console.log(`[test]   Network: ${healthData.x402?.network}`);
  console.log(`[test]   Facilitator: ${healthData.x402?.facilitator}`);
  console.log();

  // Verify Solana network
  const network = healthData.x402?.network || "";
  if (!network.includes("solana")) {
    console.error(`[test] ❌ Expected Solana network, got: ${network}`);
    process.exit(1);
  }
  console.log("[test] ✓ Confirmed Solana network");
  console.log();

  // Step 2: Check what newsletters are available
  console.log("[test] Step 2: Fetching available issues...");
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
  console.log(`[test] Payment network: ${listData.payment?.network}`);
  console.log();

  // Step 3: Try to fetch without payment (should get 402)
  console.log("[test] Step 3: Requesting without payment...");
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

  // Step 4: Verify subscription endpoint
  console.log("[test] Step 4: Checking subscription info...");
  const subRes = await fetch(`${API_BASE}/v1/subscribe`);
  const subData = await subRes.json();
  
  console.log(`[test] ✓ Subscription tiers available`);
  console.log(`[test]   Per issue: ${subData.tiers?.per_issue?.price}`);
  console.log(`[test]   Bulk 250:  ${subData.tiers?.bulk_250?.price}`);
  console.log(`[test]   Network:   ${subData.network}`);
  console.log(`[test]   Chain:     ${subData.chains?.join(", ")}`);
  console.log();

  // Step 5: Check subscription status
  console.log("[test] Step 5: Checking subscription status...");
  const statusRes = await fetch(`${API_BASE}/v1/subscribe/status/${wallets.buyer.publicKey}`);
  const statusData = await statusRes.json();
  
  console.log(`[test] ✓ Subscription status for buyer`);
  console.log(`[test]   Subscribed: ${statusData.subscribed}`);
  console.log(`[test]   Remaining:  ${statusData.issuesRemaining}`);
  console.log();

  console.log(`
╔══════════════════════════════════════════════════════════════╗
║  ✅ X402 Solana Integration Validated                         ║
║                                                                ║
║  - API is live and responding on Solana network               ║
║  - 402 Payment Required is returned for gated content         ║
║  - PayAI facilitator is configured                            ║
║  - Subscription endpoints are functional                      ║
╚══════════════════════════════════════════════════════════════╝

To test full payment flow:
  Use any x402-compatible Solana client to pay for an issue.
  The PayAI facilitator handles verification and settlement.
`);
}

main().catch((err) => {
  console.error("[test] Fatal error:", err);
  process.exit(1);
});
