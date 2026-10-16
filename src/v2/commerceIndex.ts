import { ProviderPaymentObserver } from './commerce/observer.js';
import { PaymentAdapters } from './commerce/providers.js';
import { EvmTransferAdapter, paymentRpc } from './commerce/evm.js';
import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import { CommerceWorker } from "./commerceWorker.js";
const path = process.env.JOKERS_V2_COMMERCE_CONFIG;
const json = process.env.JOKERS_V2_COMMERCE_CONFIG_JSON;
if (path && json) throw Error("ONE_COMMERCE_CONFIG_SOURCE_REQUIRED");
if (!path && !json) throw new Error("JOKERS_V2_COMMERCE_CONFIG_REQUIRED");
const c = JSON.parse(json ?? await readFile(path!, "utf8")) as {
  supabaseUrl: string;
  serviceKeyEnv: string;
  providers?: { providerKey: string; rpcUrl: string }[];
};
if (
  !c.supabaseUrl ||
  !/^[A-Z][A-Z0-9_]+$/.test(c.serviceKeyEnv) ||
  !process.env[c.serviceKeyEnv]
)
  throw new Error("COMMERCE_CONFIGURATION_REQUIRED");
const db = createClient(c.supabaseUrl, process.env[c.serviceKeyEnv]!, {
  db: { schema: "api" },
  auth: { persistSession: false, autoRefreshToken: false },
});
const release = await db
  .from("schema_version")
  .select("release_key,protocol_version");
if (
  release.error ||
  !release.data.some(
    (r) => r.release_key === "starknet-commerce-v2" && r.protocol_version === 2,
  )
)
  throw new Error("V2_SCHEMA_VERSION_REQUIRED");
if (c.providers?.length && !release.data.some(r => r.release_key === 'payment-recovery-v2' && r.protocol_version === 2)) throw Error('V2_SCHEMA_VERSION_REQUIRED');
const registry = new Map<string, PaymentAdapters>();
for (const p of c.providers ?? []) {
  if (registry.has(p.providerKey)) throw Error('DUPLICATE_PAYMENT_PROVIDER');
  registry.set(p.providerKey,new PaymentAdapters().register(new EvmTransferAdapter(paymentRpc(p.rpcUrl))));
}
const rpc = async <T>(name: string,args:Record<string,unknown>):Promise<T> => { const r=await db.rpc(name,args); if(r.error) throw Error(r.error.message); return r.data as T; };
const observer = new ProviderPaymentObserver(rpc,registry);
if (registry.size) await observer.ready();
const worker = new CommerceWorker(db, registry.size > 0);
console.info('V2 commerce worker ready', { providers: [...registry.keys()] });
let running = true;
process.on("SIGINT", () => {
  running = false;
});
process.on("SIGTERM", () => {
  running = false;
});
while (running) {
  try {
    const errors = await observer.pollOnce();
    for (const error of errors) console.error('V2 payment observation retry',error);
  } catch { console.error('V2 payment observation unavailable; cursor retained'); }
  try {
    const count = await worker.replayPending();
    if (count) console.info("V2 commerce fulfilled", { count });
  } catch {
    console.error("V2 commerce retry; provider evidence retained");
  }
  if (running) await new Promise((r) => setTimeout(r, 2000));
}
