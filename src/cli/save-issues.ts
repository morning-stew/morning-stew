#!/usr/bin/env tsx
import { createKeyPairSignerFromBytes } from "@solana/kit";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { x402Client, wrapFetchWithPayment } from "@x402/fetch";
import { registerExactSvmScheme } from "@x402/svm/exact/client";

const API_BASE = "https://morning-stew-production.up.railway.app";
const SAVE_DIR = join(process.cwd(), ".morning-stew");

async function main() {
  if (!existsSync(SAVE_DIR)) mkdirSync(SAVE_DIR, { recursive: true });

  const secret = JSON.parse(readFileSync(join(process.env.HOME!, ".config/solana/id.json"), "utf-8"));
  const signer = await createKeyPairSignerFromBytes(Uint8Array.from(secret));

  const client = new x402Client();
  registerExactSvmScheme(client, { signer });
  const payFetch = wrapFetchWithPayment(fetch, client);

  for (const id of ["MS-#0", "MS-#1"]) {
    console.log(`Buying ${id}...`);
    const res = await payFetch(`${API_BASE}/v1/issues/${id}`);
    if (!res.ok) {
      console.error(`Failed ${id}: ${res.status} ${await res.text()}`);
      continue;
    }
    const data = await res.json();
    const savePath = join(SAVE_DIR, `saved-${id.replace("#", "")}.json`);
    writeFileSync(savePath, JSON.stringify(data, null, 2));
    console.log(`✅ Saved ${id} -> ${savePath}`);
  }
}

main().catch(console.error);
