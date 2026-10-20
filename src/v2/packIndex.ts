import { createClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";
import { PackOpeningWorker } from "./packOpeningWorker.js";
import { readWorkerConfig } from "./config.js";

const path = process.env.JOKERS_V2_PACK_CONFIG;
const json = process.env.JOKERS_V2_PACK_CONFIG_JSON;
if (path && json) throw Error("ONE_PACK_CONFIG_SOURCE_REQUIRED");
const config = path || json ? JSON.parse(json ?? await readFile(path!, "utf8")) : await readWorkerConfig();
const key = config.serviceKey ?? process.env[config.serviceKeyEnv];
if (!config.supabaseUrl || !key) throw Error("PACK_CONFIGURATION_REQUIRED");
const db = createClient(config.supabaseUrl, key, {
  db: { schema: "api" }, auth: { persistSession: false, autoRefreshToken: false },
});
const ready = await db.rpc("assert_processing_contract", { p_kind: "pack-opening", p_version: "processing-v1" });
if (ready.error) throw Error("V2_SCHEMA_VERSION_REQUIRED");
const worker = new PackOpeningWorker(db);
let running = true;
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { running = false; });
console.info("V2 pack recovery ready");
while (running) {
  try {
    const count = await worker.replayPending();
    if (count) console.info("V2 pack openings recovered", { count });
  } catch { console.error("V2 pack recovery retry; seeds and outcomes retained"); }
  if (running) await new Promise(resolve => setTimeout(resolve, 2000));
}
