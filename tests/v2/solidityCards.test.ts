import { expect, it } from "bun:test";
import { decodeFunctionData, encodeFunctionData, keccak256, toHex, TransactionReceiptNotFoundError } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { EvmNftAdapter, cardsAbi, evmCard } from "../../src/v2/settlement/evm.js";
import { solidityCardsAbi, solidityMintData, validateEvmNftProtocol } from "../../src/v2/settlement/solidityCards.js";
import { validateOperation, operationId, type NftOperation, type Executor, type NftSubmission } from "../../src/v2/settlement/types.js";

it("encodes the complete v2 outcome as the Solidity WrappedItem tuple", () => {
  const operation = {
    operation_id: "10000000-0000-0000-0000-000000000001",
    beneficiary: "0x" + "12".repeat(20),
    payload: { protocol: "mint-card-v1", card: {
      item_id: 4294967295, item_type: 3, card_id: 10101, rarity: 4,
      skin_id: 5, skin_rarity: 2, quality: 10, marketable: false,
    } },
  } as NftOperation;
  validateOperation(operation);
  const decoded = decodeFunctionData({ abi: solidityCardsAbi, data: solidityMintData(operation) });
  expect(decoded.functionName).toBe("mintCards");
  expect(decoded.args).toEqual([operation.beneficiary, [{
    item: { id: 4294967295, itemType: 3, contentId: 10101, rarity: 4, skinId: 5, skinRarity: 2 },
    quality: 10, marketable: false,
  }]]);
});

it("requires a supported explicit protocol instead of guessing from a failed mint", () => {
  validateEvmNftProtocol("mint-cards-v1");
  validateEvmNftProtocol("mint-reward-v1");
  expect(() => validateEvmNftProtocol("auto" as any)).toThrow("UNSUPPORTED_NFT_PROTOCOL");
});

it("accepts existing signed mintReward submissions without new protocol metadata", async () => {
  // Fixed public test key; all client methods used here are replaced, no RPC is contacted.
  const key = ("0x" + "01".repeat(32)) as `0x${string}`;
  const account = privateKeyToAccount(key);
  const id = "10000000-0000-0000-0000-000000000001";
  const operation: NftOperation = {
    operation_id: id, chain_key: "local:evm", deployment_id: id, collection_id: id,
    contract_address: "0x" + "12".repeat(20), abi_hash: "ab".repeat(32),
    beneficiary: account.address.toLowerCase(), payload_hash: "ab".repeat(32), status: "pending",
    payload: { protocol: "mint-card-v1", card: { item_id: 1, item_type: 1, card_id: 10101,
      rarity: 1, skin_id: 0, skin_rarity: 0, quality: 7, marketable: false } },
  };
  const raw = await account.signTransaction({
    chainId: 31337, nonce: 7, to: operation.contract_address as `0x${string}`, gas: 250000n,
    maxFeePerGas: 10n, maxPriorityFeePerGas: 1n, value: 0n,
    data: encodeFunctionData({ abi: cardsAbi, functionName: "mintReward",
      args: [toHex(operationId(id), { size: 32 }), operation.beneficiary as `0x${string}`, [evmCard(operation)]] }),
  });
  const adapter = new EvmNftAdapter("http://127.0.0.1:1", key);
  const client = (adapter as any).client;
  client.getChainId = async () => 31337;
  client.getTransactionReceipt = async () => { throw new TransactionReceiptNotFoundError({ hash: keccak256(raw) }); };
  const executor: Executor = { executor_id: id, chain_key: operation.chain_key, adapter_key: "evm",
    network_id: "31337", address: account.address, signer_ref: "fixture", status: "ready", chain_status: "enabled",
    confirmation_policy: { confirmations: 1, finality: "local" } };
  await adapter.ready(executor);
  const submission: NftSubmission = { submission_id: id, executor_id: id, operation,
    nonce: "7", tx_hash: keccak256(raw), status: "prepared", confirmed_block: null,
    signed_payload: { adapter: "evm", raw } };
  expect(await adapter.observe(submission)).toEqual({ kind: "missing" });
  await expect(adapter.observe({ ...submission, operation: { ...operation, operation_id: "20000000-0000-0000-0000-000000000001" } })).rejects.toThrow("SIGNED_PAYLOAD_MISMATCH");
});
