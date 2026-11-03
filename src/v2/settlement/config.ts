import { readFile } from "node:fs/promises";
import { validateEvmNftProtocol, type EvmNftProtocol } from "./solidityCards.js";
import type { ProfileMirrorConfig } from "./profileMirror.js";

export interface SettlementConfig {
  supabaseUrl: string;
  serviceKeyEnv: string;
  executors: { executorId: string; rpcUrl: string; signerEnv: string; nftProtocol?: EvmNftProtocol; profileMirror?: ProfileMirrorConfig }[];
}

export async function readSettlementConfig(env: NodeJS.ProcessEnv = process.env): Promise<SettlementConfig> {
  const path = env.JOKERS_V2_SETTLEMENT_CONFIG;
  const json = env.JOKERS_V2_SETTLEMENT_CONFIG_JSON;
  if (Boolean(path) === Boolean(json)) throw new Error("ONE_SETTLEMENT_CONFIG_SOURCE_REQUIRED");
  let config: SettlementConfig;
  try {
    config = JSON.parse(json ?? await readFile(path!, "utf8"));
  } catch {
    throw new Error("INVALID_SETTLEMENT_CONFIG_JSON");
  }
  const envName = (name: unknown) => typeof name === "string" && /^[A-Z][A-Z0-9_]*$/.test(name);
  if (!config || typeof config.supabaseUrl !== "string" || !config.supabaseUrl ||
      !envName(config.serviceKeyEnv) || !Array.isArray(config.executors) || !config.executors.length ||
      config.executors.some(e => !e || typeof e.executorId !== "string" || !e.executorId ||
        typeof e.rpcUrl !== "string" || !e.rpcUrl || !envName(e.signerEnv))) {
    throw new Error("SETTLEMENT_CONFIGURATION_REQUIRED");
  }
  if (new Set(config.executors.map(e => e.executorId)).size !== config.executors.length)
    throw new Error("DUPLICATE_SETTLEMENT_EXECUTOR");
  // Separate, non-secret deployment switch: editing it never requires copying signer/RPC secrets.
  if (env.JOKERS_V2_PROFILE_MIRRORS_JSON !== undefined) {
    let mirrors: (ProfileMirrorConfig & { executorId: string })[];
    try { mirrors = JSON.parse(env.JOKERS_V2_PROFILE_MIRRORS_JSON); }
    catch { throw new Error("INVALID_PROFILE_MIRRORS_JSON"); }
    if (!Array.isArray(mirrors) || mirrors.some(m => !m || typeof m.executorId !== "string") ||
      new Set(mirrors.map(m => m.executorId)).size !== mirrors.length) throw new Error("INVALID_PROFILE_MIRRORS_JSON");
    for (const { executorId, ...mirror } of mirrors) {
      const executor = config.executors.find(e => e.executorId === executorId);
      if (!executor || executor.profileMirror !== undefined) throw new Error("PROFILE_MIRROR_EXECUTOR_CONFLICT");
      executor.profileMirror = mirror;
    }
  }
  for (const executor of config.executors) {
    if (executor.nftProtocol !== undefined) validateEvmNftProtocol(executor.nftProtocol);
    const mirror = executor.profileMirror;
    if (mirror !== undefined && (!mirror || (mirror.enabled !== undefined && typeof mirror.enabled !== "boolean") || !/^0x[0-9a-f]{40}$/i.test(mirror.contractAddress) ||
      !Array.isArray(mirror.runtimes) || !mirror.runtimes.length || mirror.runtimes.some(r =>
        !r || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(r.runtimeId) || !r.rpcUrl || !r.gameSystemAddress || !r.gameViewsAddress) ||
      new Set(mirror.runtimes.map(r => r.runtimeId)).size !== mirror.runtimes.length)) throw new Error("INVALID_PROFILE_MIRROR_CONFIG");
  }
  return config;
}
