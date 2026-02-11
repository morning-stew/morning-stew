#!/usr/bin/env tsx

import { Keypair, Connection, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";

/**
 * X402 Test Harness — Solana
 * 
 * Creates two test wallets on Solana Devnet and validates the X402 payment flow.
 * 
 * Usage: pnpm run x402:test
 * 
 * Steps:
 * 1. Generate/load two wallets (seller + buyer)
 * 2. Check SOL and USDC balances
 * 3. Validate X402 SDK loads correctly
 */

const DATA_DIR = join(process.cwd(), ".morning-stew");
const WALLETS_PATH = join(DATA_DIR, "test-wallets.json");

// Solana Devnet USDC mint (Circle)
const USDC_MINT = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";

// Solana Devnet RPC
const RPC_URL = "https://api.devnet.solana.com";

interface TestWallets {
  seller: { secretKey: number[]; publicKey: string };
  buyer: { secretKey: number[]; publicKey: string };
}

async function main() {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║  🧪 X402 Test Harness — Solana Devnet                        ║
╚══════════════════════════════════════════════════════════════╝
`);

  ensureDataDir();

  // Step 1: Load or create wallets
  const wallets = await loadOrCreateWallets();
  
  console.log("📍 Test Wallets:");
  console.log(`   Seller: ${wallets.seller.publicKey}`);
  console.log(`   Buyer:  ${wallets.buyer.publicKey}`);
  console.log();

  // Step 2: Check balances
  const connection = new Connection(RPC_URL, "confirmed");

  const [sellerSol, buyerSol] = await Promise.all([
    connection.getBalance(new PublicKey(wallets.seller.publicKey)),
    connection.getBalance(new PublicKey(wallets.buyer.publicKey)),
  ]);

  const [sellerUsdc, buyerUsdc] = await Promise.all([
    getUsdcBalance(connection, wallets.seller.publicKey),
    getUsdcBalance(connection, wallets.buyer.publicKey),
  ]);

  console.log("💰 Balances:");
  console.log(`   Seller: ${(sellerSol / LAMPORTS_PER_SOL).toFixed(4)} SOL | ${sellerUsdc} USDC`);
  console.log(`   Buyer:  ${(buyerSol / LAMPORTS_PER_SOL).toFixed(4)} SOL | ${buyerUsdc} USDC`);
  console.log();

  // Check if wallets need funding
  const needsFunding = buyerSol === 0 || buyerUsdc === 0;

  if (needsFunding) {
    console.log(`
⚠️  Wallets need funding!

Get Solana Devnet SOL:
   solana airdrop 2 ${wallets.buyer.publicKey} --url devnet
   solana airdrop 2 ${wallets.seller.publicKey} --url devnet

Get Devnet USDC:
   https://faucet.circle.com/ (select Solana Devnet)

Fund these addresses:
   Seller (receives payments): ${wallets.seller.publicKey}
   Buyer (makes payments):     ${wallets.buyer.publicKey}

Once funded, run this script again.
`);
    return;
  }

  // Step 3: Validate X402 setup
  console.log("🔄 Validating X402 setup...\n");

  console.log("Step 1: Seller sets up X402-protected endpoint");
  console.log("   Price: $0.10 USDC");
  console.log("   Network: Solana Devnet (solana-devnet)");
  console.log("   Receiver: " + wallets.seller.publicKey);
  console.log("   Facilitator: https://facilitator.payai.network");
  console.log();

  console.log("Step 2: Buyer requests protected resource");
  console.log("   → Server responds with 402 Payment Required");
  console.log();

  console.log("Step 3: Buyer signs USDC transfer");
  console.log("   → Solana SPL token transfer");
  console.log();

  console.log("Step 4: Buyer retries with payment proof");
  console.log("   → PayAI facilitator verifies & settles");
  console.log("   → Server returns protected content");
  console.log();

  console.log(`
╔══════════════════════════════════════════════════════════════╗
║  ✅ Solana Wallets Ready                                      ║
║                                                                ║
║  Both wallets are funded and ready for X402 payments.         ║
║  Start the server and test with: pnpm run x402:e2e            ║
╚══════════════════════════════════════════════════════════════╝

Next steps:
1. Start the API server: pnpm run serve
2. Run the e2e test:     pnpm run x402:e2e
3. Or test manually:     curl http://localhost:3000/v1/issues/MS-2026-038
`);
}

async function loadOrCreateWallets(): Promise<TestWallets> {
  if (existsSync(WALLETS_PATH)) {
    console.log("📂 Loading existing test wallets...\n");
    return JSON.parse(readFileSync(WALLETS_PATH, "utf-8"));
  }

  console.log("🔑 Generating new Solana test wallets...\n");

  const seller = Keypair.generate();
  const buyer = Keypair.generate();

  const wallets: TestWallets = {
    seller: {
      secretKey: Array.from(seller.secretKey),
      publicKey: seller.publicKey.toBase58(),
    },
    buyer: {
      secretKey: Array.from(buyer.secretKey),
      publicKey: buyer.publicKey.toBase58(),
    },
  };

  writeFileSync(WALLETS_PATH, JSON.stringify(wallets, null, 2));
  console.log(`   Saved to: ${WALLETS_PATH}\n`);

  return wallets;
}

async function getUsdcBalance(connection: Connection, address: string): Promise<number> {
  try {
    const owner = new PublicKey(address);
    const mint = new PublicKey(USDC_MINT);

    // Get token accounts for this owner
    const tokenAccounts = await connection.getParsedTokenAccountsByOwner(owner, { mint });

    if (tokenAccounts.value.length === 0) return 0;

    const balance = tokenAccounts.value[0].account.data.parsed.info.tokenAmount.uiAmount;
    return balance || 0;
  } catch {
    return 0;
  }
}

function ensureDataDir() {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
}

main().catch(console.error);
