import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
let configured: Promise<{
  chainKey: string;
  rpc(name: string, args: Record<string, unknown>): Promise<any>;
}> | undefined;
export const hybridRewardsConfigured = () => !!(process.env.JOKERS_HYBRID_PACK_CONFIG || process.env.JOKERS_HYBRID_PACK_CONFIG_JSON);
async function service() {
  const path = process.env.JOKERS_HYBRID_PACK_CONFIG, json = process.env.JOKERS_HYBRID_PACK_CONFIG_JSON;
  if (!path && !json) return null;
  if (path && json) throw Error("ONE_HYBRID_CONFIG_SOURCE_REQUIRED");
  return configured ??= (async () => {
    const c = JSON.parse(json ?? await readFile(path!, "utf8"));
    if (!c.chain?.chainKey || c.chain.blockchain !== "starknet" || !process.env[c.serviceKeyEnv])
      throw Error("HYBRID_CONFIGURATION_REQUIRED");
    const db = createClient(c.supabaseUrl, process.env[c.serviceKeyEnv]!, {
      db: { schema: "api" }, auth: { persistSession: false, autoRefreshToken: false },
    });
    return { chainKey: c.chain.chainKey, rpc: async (name: string, args: Record<string, unknown>) => {
      const { data, error } = await db.rpc(name, args);
      if (error) throw Error(error.message);
      return data;
    } };
  })();
}
export async function issueHybridRankingReward(wallet: string, packId: number, sourceKey: string, evidence: Record<string, unknown>) {
  const s = await service();
  if (!s) return null;
  if (!/^0x[0-9a-f]{1,64}$/i.test(wallet) || BigInt(wallet) === 0n) throw Error("INVALID_WALLET");
  const address = "0x" + BigInt(wallet).toString(16).padStart(64, "0");
  if (!await s.rpc("hybrid_profile_enabled", { p_chain: s.chainKey, p_wallet: address }))
    throw Error("HYBRID_CUTOVER_REQUIRED");
  const result = await s.rpc("issue_external_pack_reward", {
    p_chain: s.chainKey, p_wallet: address, p_source_kind: "ranking", p_source_key: sourceKey,
    p_packs: [{ legacy_pack_id: packId, quantity: 1, marketable: false }], p_evidence: evidence,
  });
  return result.grant_id as string;
}
