import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import { CommerceWorker } from "./commerceWorker.js";
const path = process.env.JOKERS_V2_COMMERCE_CONFIG;
if (!path) throw new Error("JOKERS_V2_COMMERCE_CONFIG_REQUIRED");
const c = JSON.parse(await readFile(path, "utf8")) as {
  supabaseUrl: string;
  serviceKeyEnv: string;
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
const worker = new CommerceWorker(db);
let running = true;
process.on("SIGINT", () => {
  running = false;
});
process.on("SIGTERM", () => {
  running = false;
});
while (running) {
  try {
    const count = await worker.replayPending();
    if (count) console.info("V2 commerce fulfilled", { count });
  } catch {
    console.error("V2 commerce retry; provider evidence retained");
  }
  if (running) await new Promise((r) => setTimeout(r, 2000));
}
