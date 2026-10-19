import { readFile } from "node:fs/promises";
import { validateEvmNftProtocol, type EvmNftProtocol } from "./solidityCards.js";

export interface SettlementConfig {
  supabaseUrl: string;
  serviceKeyEnv: string;
  executors: { executorId: string; rpcUrl: string; signerEnv: string; nftProtocol?: EvmNftProtocol }[];
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
  for (const executor of config.executors) {
    if (executor.nftProtocol !== undefined) validateEvmNftProtocol(executor.nftProtocol);
  }
  return config;
}
