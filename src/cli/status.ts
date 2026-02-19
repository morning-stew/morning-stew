#!/usr/bin/env tsx
/**
 * Morning Stew Status (MSS)
 * Usage: npm run status
 * Shell alias: mss (add to ~/.zshrc: `mss() { (cd ~/GitRepos/morning-stew && npm run status) }`)
 */

import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { Connection, PublicKey } from "@solana/web3.js";
import { createPublicClient, http, parseAbiItem } from "viem";

// ── Load .env ──────────────────────────────────────────────────────────────────
const envPath = join(process.cwd(), ".env");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}

// ── Config ─────────────────────────────────────────────────────────────────────
const DATA_DIR = process.env.DATA_DIR ?? join(process.cwd(), ".morning-stew");
const ISSUES_DIR = join(DATA_DIR, "issues");
const RECEIVER_ADDRESS = process.env.RECEIVER_ADDRESS ?? "";
const FACILITATOR_URL = process.env.FACILITATOR_URL ?? "https://facilitator.payai.network";
const MONAD_RECEIVER = process.env.MONAD_RECEIVER_ADDRESS ?? "";
const MONAD_FACILITATOR_URL = process.env.MONAD_FACILITATOR_URL ?? "https://x402-facilitator.molandak.org";
const MONAD_RPC_URL = process.env.MONAD_RPC_URL ?? "https://rpc.monad.xyz";
const DISABLE_CRON = process.env.DISABLE_CRON === "true";
const CRON_SCHEDULE = process.env.CRON_SCHEDULE ?? "0 13 * * *";
const PORT = process.env.PORT ?? "3000";
const PROD_URL = "https://morning-stew-production.up.railway.app";

const USDC_MINT_MAINNET = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const MONAD_USDC = "0x754704Bc059F8C67012fEd69BC8A327a5aafb603" as const;
const PRICE_PER_ISSUE = 0.10;

// ── ANSI ───────────────────────────────────────────────────────────────────────
const R = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const GRAY = "\x1b[90m";
const BLUE = "\x1b[34m";

const ok = (s: string) => `${GREEN}✓${R} ${s}`;
const no = (s: string) => `${RED}✗${R} ${s}`;
const warn = (s: string) => `${YELLOW}⚠${R} ${s}`;
const dim = (s: string) => `${DIM}${s}${R}`;
const bold = (s: string) => `${BOLD}${s}${R}`;
const lbl = (s: string) => `  ${CYAN}${s.padEnd(16)}${R}`;

function section(title: string) {
  console.log(`\n${BOLD}${BLUE}${title}${R}`);
  console.log(`${GRAY}${"─".repeat(46)}${R}`);
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function todayPT(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
}

function nextCronRun(schedule: string): string {
  const parts = schedule.split(" ");
  if (parts.length !== 5) return schedule;
  const [minute, hour] = [parseInt(parts[0]), parseInt(parts[1])];
  if (isNaN(minute) || isNaN(hour)) return schedule;
  const now = new Date();
  const target = new Date();
  target.setUTCHours(hour, minute, 0, 0);
  if (target <= now) target.setUTCDate(target.getUTCDate() + 1);
  const diff = target.getTime() - now.getTime();
  const h = Math.floor(diff / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  return `in ${h}h ${m}m`;
}

function dirSizeKb(dir: string): number {
  if (!existsSync(dir)) return 0;
  return readdirSync(dir).reduce((sum, f) => {
    try { return sum + statSync(join(dir, f)).size; } catch { return sum; }
  }, 0) / 1024;
}

function shortAddr(addr: string, len = 4): string {
  return `${addr.slice(0, 6)}…${addr.slice(-len)}`;
}

// ── Issue inventory ────────────────────────────────────────────────────────────
interface IssueInfo { id: string; date: string; name: string; }

function loadIssues(): IssueInfo[] {
  if (!existsSync(ISSUES_DIR)) return [];
  return readdirSync(ISSUES_DIR)
    .filter(f => f.endsWith(".json") && !f.endsWith(".full.json"))
    .flatMap(f => {
      try {
        return [JSON.parse(readFileSync(join(ISSUES_DIR, f), "utf-8")) as IssueInfo];
      } catch { return []; }
    });
}

// ── Solana ─────────────────────────────────────────────────────────────────────
interface SolStats { usdcBalance: number | null; payments24h: number | null; }

async function getSolanaStats(): Promise<SolStats> {
  if (!RECEIVER_ADDRESS) return { usdcBalance: null, payments24h: null };
  try {
    const rpc = "https://api.mainnet-beta.solana.com";
    const conn = new Connection(rpc, "confirmed");
    const mint = new PublicKey(USDC_MINT_MAINNET);
    const owner = new PublicKey(RECEIVER_ADDRESS);

    const tokenAccts = await conn.getTokenAccountsByOwner(owner, { mint });
    let usdcBalance = 0;
    let payments24h = 0;

    if (tokenAccts.value.length > 0) {
      const tokenAccount = tokenAccts.value[0].pubkey;
      const bal = await conn.getTokenAccountBalance(tokenAccount);
      usdcBalance = parseFloat(bal.value.uiAmountString ?? "0");

      const since = Math.floor(Date.now() / 1000) - 86400;
      const sigs = await conn.getSignaturesForAddress(tokenAccount, { limit: 100 });
      payments24h = sigs.filter(s => !s.err && s.blockTime && s.blockTime >= since).length;
    }

    return { usdcBalance, payments24h };
  } catch {
    return { usdcBalance: null, payments24h: null };
  }
}

// ── Monad ──────────────────────────────────────────────────────────────────────
interface MonadStats { usdcBalance: number | null; monBalance: number | null; payments24h: number | null; }

async function getMonadStats(): Promise<MonadStats> {
  if (!MONAD_RECEIVER) return { usdcBalance: null, monBalance: null, payments24h: null };
  try {
    const client = createPublicClient({
      chain: {
        id: 143,
        name: "Monad",
        nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
        rpcUrls: { default: { http: [MONAD_RPC_URL] } },
      } as any,
      transport: http(MONAD_RPC_URL, { timeout: 10_000 }),
    });

    const erc20Abi = [parseAbiItem("function balanceOf(address) view returns (uint256)")];
    const receiver = MONAD_RECEIVER as `0x${string}`;

    const [monRaw, usdcRaw] = await Promise.all([
      client.getBalance({ address: receiver }),
      client.readContract({ address: MONAD_USDC, abi: erc20Abi, functionName: "balanceOf", args: [receiver] }),
    ]);

    const monBalance = Number(monRaw) / 1e18;
    const usdcBalance = Number(usdcRaw as bigint) / 1e6;

    // Count incoming USDC transfers in last 24h (~86400 blocks at ~1s/block on Monad)
    let payments24h = 0;
    try {
      const latestBlock = await client.getBlockNumber();
      const fromBlock = latestBlock > 86400n ? latestBlock - 86400n : 0n;
      const logs = await client.getLogs({
        address: MONAD_USDC,
        event: parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)"),
        args: { to: receiver },
        fromBlock,
        toBlock: "latest",
      });
      payments24h = logs.length;
    } catch { /* RPC may not support getLogs, skip */ }

    return { usdcBalance, monBalance, payments24h };
  } catch {
    return { usdcBalance: null, monBalance: null, payments24h: null };
  }
}

// ── Server ping ────────────────────────────────────────────────────────────────
async function ping(url: string): Promise<{ ok: boolean; ms: number }> {
  const t = Date.now();
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    return { ok: res.ok, ms: Date.now() - t };
  } catch {
    return { ok: false, ms: Date.now() - t };
  }
}

// ── Main ───────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n${BOLD}${CYAN}╔═════════════════════════════════════════╗${R}`);
  console.log(`${BOLD}${CYAN}║      Morning Stew Status  (MSS)         ║${R}`);
  console.log(`${BOLD}${CYAN}╚═════════════════════════════════════════╝${R}`);
  console.log(`${DIM}  ${new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles" })} PT${R}`);

  // ── Issues ───────────────────────────────────────────────────────────────────
  section("📰  Issue Inventory");
  const issues = loadIssues().sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  const latest = issues[0] ?? null;
  const hasToday = issues.some(i => i.date === todayPT());

  console.log(`${lbl("Total")}${bold(String(issues.length))} issues`);
  if (latest) {
    console.log(`${lbl("Latest")}${bold(latest.id)}  ${dim(latest.date)}  ${dim(`"${latest.name}"`)}`);
  } else {
    console.log(`${lbl("Latest")}${dim("none")}`);
  }
  console.log(`${lbl("Today")}${hasToday ? ok("ready") : warn("not yet generated")}`);

  // Kick off chain fetches in parallel while we print other stuff
  const [solStats, monadStats, localPing, prodPing, freeIssueRes] = await Promise.all([
    getSolanaStats(),
    getMonadStats(),
    ping(`http://localhost:${PORT}/`),
    ping(`${PROD_URL}/`),
    fetch(`${PROD_URL}/v1/issues/free`, { signal: AbortSignal.timeout(5000) })
      .then(r => r.ok)
      .catch(() => false),
  ]);

  console.log(`${lbl("Free issue")}${freeIssueRes ? ok("available") : no("not found")}`);

  // ── Wallet Balances ──────────────────────────────────────────────────────────
  section("💰  Wallet Balances");

  console.log(`  Solana ${GREEN}mainnet${R}`);
  console.log(`${lbl("  Address")}${RECEIVER_ADDRESS ? dim(shortAddr(RECEIVER_ADDRESS)) : no("not set")}`);
  console.log(`${lbl("  USDC")}${solStats.usdcBalance !== null ? bold(`$${solStats.usdcBalance.toFixed(2)}`) : dim("n/a")}`);

  console.log(`  Monad ${GREEN}mainnet${R}`);
  console.log(`${lbl("  Address")}${MONAD_RECEIVER ? dim(shortAddr(MONAD_RECEIVER)) : no("not set")}`);
  console.log(`${lbl("  USDC")}${monadStats.usdcBalance !== null ? bold(`$${monadStats.usdcBalance.toFixed(2)}`) : dim("n/a")}`);
  console.log(`${lbl("  MON")}${monadStats.monBalance !== null ? bold(monadStats.monBalance.toFixed(4)) : dim("n/a")}`);

  // ── Payments last 24h ────────────────────────────────────────────────────────
  section("📊  Last 24h Payments");
  const sol24 = solStats.payments24h;
  const mon24 = monadStats.payments24h;
  const total24 = (sol24 ?? 0) + (mon24 ?? 0);
  const totalRev = total24 * PRICE_PER_ISSUE;

  const fmtPay = (n: number | null) =>
    n !== null
      ? `${bold(String(n))} payment${n !== 1 ? "s" : ""}  ${dim(`($${(n * PRICE_PER_ISSUE).toFixed(2)})`)}`
      : dim("n/a");

  console.log(`${lbl("Solana")}${fmtPay(sol24)}`);
  console.log(`${lbl("Monad")}${fmtPay(mon24)}`);
  console.log(`${lbl("Total")}${bold(String(total24))} payment${total24 !== 1 ? "s" : ""}  ${dim(`($${totalRev.toFixed(2)})`)}`);

  // ── Credentials ──────────────────────────────────────────────────────────────
  section("🔑  Credentials");
  const creds: [string, string | undefined, boolean][] = [
    ["X_BEARER_TOKEN",    process.env.X_BEARER_TOKEN,    true],
    ["NOUS_API_KEY",      process.env.NOUS_API_KEY,      true],
    ["INTERNAL_SECRET",   process.env.INTERNAL_SECRET,   true],
    ["TELEGRAM_BOT_TOKEN",process.env.TELEGRAM_BOT_TOKEN,false],
    ["GITHUB_TOKEN",      process.env.GITHUB_TOKEN,      false],
    ["BRAVE_API_KEY",     process.env.BRAVE_API_KEY,     false],
  ];
  for (const [name, val, required] of creds) {
    console.log(`  ${val ? ok(name) : required ? no(name) : dim(`○ ${name}`)}`);
  }

  // ── Config / Storage ─────────────────────────────────────────────────────────
  section("⚙️   Config & Storage");
  const thinkingDir = join(DATA_DIR, "thinking-logs");
  const thinkCount = existsSync(thinkingDir) ? readdirSync(thinkingDir).length : 0;
  const storageKb = dirSizeKb(DATA_DIR);

  console.log(`${lbl("DATA_DIR")}${dim(DATA_DIR)}`);
  console.log(`${lbl("Storage")}${issues.length} issues, ${thinkCount} thinking logs  ${dim(`(${storageKb.toFixed(0)} KB)`)}`);

  const cronLine = DISABLE_CRON
    ? no("disabled")
    : `${ok("enabled")}  ${dim(CRON_SCHEDULE)}  ${dim(`(next: ${nextCronRun(CRON_SCHEDULE)})`)}`;
  console.log(`${lbl("Cron")}${cronLine}`);
  console.log(`${lbl("Solana")}mainnet  ${dim(FACILITATOR_URL)}`);
  console.log(`${lbl("Monad")}mainnet  ${dim(MONAD_FACILITATOR_URL)}`);

  // ── Server ───────────────────────────────────────────────────────────────────
  section("🖥️   Server");

  const fmtPing = (label: string, r: { ok: boolean; ms: number }) =>
    r.ok
      ? ok(`${label}  ${dim(`(${r.ms}ms)`)}`)
      : no(`${label}  ${dim("(unreachable)")}`);

  console.log(`  ${fmtPing(`local  :${PORT}`, localPing)}`);
  console.log(`  ${fmtPing(PROD_URL.replace("https://", ""), prodPing)}`);

  console.log();
}

main().catch(e => {
  console.error(`${RED}MSS error:${R}`, e?.message ?? e);
  process.exit(1);
});
