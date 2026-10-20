import { createClient } from "@supabase/supabase-js";
import { EvmNftAdapter } from "./evm.js";
import { StarknetNftAdapter } from "./starknet.js";
import { NftSettlementWorker } from "./worker.js";
import type { Executor } from "./types.js";
import { readSettlementConfig } from "./config.js";
const config = await readSettlementConfig();
const env = (name: string) => {
  if (!/^[A-Z][A-Z0-9_]*$/.test(name) || !process.env[name])
    throw new Error("SETTLEMENT_SECRET_REQUIRED");
  return process.env[name]!;
};
if (
  !config.supabaseUrl ||
  !Array.isArray(config.executors) ||
  !config.executors.length
)
  throw new Error("SETTLEMENT_CONFIGURATION_REQUIRED");
const db = createClient(config.supabaseUrl, env(config.serviceKeyEnv), {
  db: { schema: "api" },
  auth: { persistSession: false, autoRefreshToken: false },
});
const release = await db
  .from("schema_version")
  .select("release_key,protocol_version");
if (
  release.error ||
  !release.data.some(
    (r) => r.release_key === "fast-nft-settlement-v2" && r.protocol_version === 2,
  )
)
  throw new Error("V2_SCHEMA_VERSION_REQUIRED");
const workers: { id: string; worker: NftSettlementWorker }[] = [];
for (const c of config.executors) {
  const { data, error } = await db.rpc("nft_executor", {
    p_executor_id: c.executorId,
  });
  if (error || !data) throw new Error("NFT_EXECUTOR_REQUIRED");
  const e = data as Executor,
    key = env(c.signerEnv);
  if (!/^0x[0-9a-fA-F]{1,64}$/.test(key))
    throw new Error("INVALID_SETTLEMENT_SIGNER");
  if (e.signer_ref !== c.signerEnv)
    throw new Error("SETTLEMENT_SIGNER_REFERENCE_MISMATCH");
  const adapter =
    e.adapter_key === "evm"
      ? new EvmNftAdapter(c.rpcUrl, key as `0x${string}`, c.nftProtocol)
      : e.adapter_key === "starknet"
        ? new StarknetNftAdapter(c.rpcUrl, e.address, key)
        : null;
  if (!adapter) throw new Error("UNSUPPORTED_SETTLEMENT_ADAPTER");
  const worker = new NftSettlementWorker(db, c.executorId, adapter);
  await worker.ready();
  workers.push({ id: c.executorId, worker });
}
let running = true;
process.on("SIGINT", () => {
  running = false;
});
process.on("SIGTERM", () => {
  running = false;
});
console.info("V2 NFT settlement ready", {
  executors: workers.map((w) => w.id),
});
async function sends() {
 while (running) {
  // Executors have independent nonce lanes; a slow chain cannot stall another.
  for (let offset = 0; offset < workers.length; offset += 4)
   await Promise.all(workers.slice(offset, offset + 4).map(async ({ id, worker }) => {
    try {
      const result = await worker.pollOnce();
      if (result.prepared || result.confirmed || result.errors)
        console.info("V2 NFT settlement", { executorId: id, ...result });
    } catch {
      console.error("V2 NFT settlement paused; stored transactions preserved", {
        executorId: id,
      });
    }
  }));
  if (running) await new Promise((resolve) => setTimeout(resolve, 2000));
 }
}
async function finality() {
 while (running) {
  for (let offset = 0; offset < workers.length; offset += 4)
   await Promise.all(workers.slice(offset, offset + 4).map(async ({ worker }) => {
    try { await worker.reconcileFinality(); } catch { console.error("V2 NFT finality retry"); }
   }));
  if (running) await new Promise(resolve => setTimeout(resolve, 30000));
 }
}
await Promise.all([sends(), finality()]);
