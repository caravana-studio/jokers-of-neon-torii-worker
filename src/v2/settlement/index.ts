import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import { EvmNftAdapter } from "./evm.js";
import { StarknetNftAdapter } from "./starknet.js";
import { NftSettlementWorker } from "./worker.js";
import type { Executor } from "./types.js";
const path = process.env.JOKERS_V2_SETTLEMENT_CONFIG;
if (!path) throw new Error("JOKERS_V2_SETTLEMENT_CONFIG_REQUIRED");
const config = JSON.parse(await readFile(path, "utf8")) as {
  supabaseUrl: string;
  serviceKeyEnv: string;
  executors: { executorId: string; rpcUrl: string; signerEnv: string }[];
};
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
    (r) => r.release_key === "nft-settlement-v2" && r.protocol_version === 2,
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
      ? new EvmNftAdapter(c.rpcUrl, key as `0x${string}`)
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
while (running) {
  for (const { id, worker } of workers) {
    try {
      const result = await worker.pollOnce();
      if (result.prepared || result.confirmed || result.errors)
        console.info("V2 NFT settlement", { executorId: id, ...result });
    } catch {
      console.error("V2 NFT settlement paused; stored transactions preserved", {
        executorId: id,
      });
    }
  }
  if (running) await new Promise((resolve) => setTimeout(resolve, 2000));
}
