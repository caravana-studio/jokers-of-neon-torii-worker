import { test, expect } from "bun:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readSettlementConfig } from "../../src/v2/settlement/config.js";

const config = { supabaseUrl: "http://127.0.0.1:54321", serviceKeyEnv: "SERVICE_KEY", executors: [
  { executorId: "fixture", rpcUrl: "http://127.0.0.1:8545", signerEnv: "NFT_SIGNER", nftProtocol: "mint-cards-v1" },
] };
test("settlement accepts JSON or the existing file configuration without ambiguous sources or leaked parse errors", async () => {
  const directory = await mkdtemp(join(tmpdir(), "nft-config-"));
  const file = join(directory, "settlement.json");
  try {
    await writeFile(file, JSON.stringify(config));
    expect(await readSettlementConfig({ JOKERS_V2_SETTLEMENT_CONFIG: file })).toEqual(config);
    expect(await readSettlementConfig({ JOKERS_V2_SETTLEMENT_CONFIG_JSON: JSON.stringify(config) })).toEqual(config);
    await expect(readSettlementConfig({})).rejects.toThrow("ONE_SETTLEMENT_CONFIG_SOURCE_REQUIRED");
    await expect(readSettlementConfig({ JOKERS_V2_SETTLEMENT_CONFIG: file, JOKERS_V2_SETTLEMENT_CONFIG_JSON: "{}" })).rejects.toThrow("ONE_SETTLEMENT_CONFIG_SOURCE_REQUIRED");
    await expect(readSettlementConfig({ JOKERS_V2_SETTLEMENT_CONFIG_JSON: "private-invalid-json" })).rejects.toThrow("INVALID_SETTLEMENT_CONFIG_JSON");
    await expect(readSettlementConfig({ JOKERS_V2_SETTLEMENT_CONFIG_JSON: "null" })).rejects.toThrow("SETTLEMENT_CONFIGURATION_REQUIRED");
    await expect(readSettlementConfig({ JOKERS_V2_SETTLEMENT_CONFIG_JSON: JSON.stringify({ ...config, executors: [...config.executors, ...config.executors] }) })).rejects.toThrow("DUPLICATE_SETTLEMENT_EXECUTOR");
    await expect(readSettlementConfig({ JOKERS_V2_SETTLEMENT_CONFIG_JSON: JSON.stringify({ ...config, executors: [{ ...config.executors[0], nftProtocol: "auto" }] }) })).rejects.toThrow("UNSUPPORTED_NFT_PROTOCOL");
  } finally { await rm(directory, { recursive: true, force: true }); }
});
