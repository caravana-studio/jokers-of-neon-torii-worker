import { encodeFunctionData, parseAbi, type Hex } from "viem";
import type { NftOperation } from "./types.js";

export type EvmNftProtocol = "mint-reward-v1" | "mint-cards-v1";

export function validateEvmNftProtocol(protocol: EvmNftProtocol): void {
  if (!["mint-reward-v1", "mint-cards-v1"].includes(protocol))
    throw new Error("UNSUPPORTED_NFT_PROTOCOL");
}

export const solidityCardsAbi = parseAbi([
  "error MissingPermission(address contractAddress,address caller)",
  "struct Item { uint32 id; uint8 itemType; uint32 contentId; uint32 rarity; uint32 skinId; uint32 skinRarity; }",
  "struct WrappedItem { Item item; uint32 quality; bool marketable; }",
  "struct CardStats { uint256 tokenId; bool marketable; uint32 cardId; uint32 rarity; uint32 count; address owner; uint32 skinId; uint32 skinRarity; uint32 quality; }",
  "function mintCards(address recipient,WrappedItem[] wrappedItems)",
  "function getCardStats(uint256 tokenId) view returns (CardStats)",
  "event CardMinted(address indexed recipient,uint256 indexed tokenId,uint32 indexed cardId,uint32 rarity,uint32 count,uint32 skinId,uint32 skinRarity,uint32 quality,bool marketable)",
  "event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)",
]);

export function wrappedItem(o: NftOperation) {
  const c = o.payload.card;
  return {
    item: {
      id: c.item_id,
      itemType: c.item_type,
      contentId: c.card_id,
      rarity: c.rarity,
      skinId: c.skin_id,
      skinRarity: c.skin_rarity,
    },
    quality: c.quality,
    marketable: c.marketable,
  };
}

export function solidityMintData(o: NftOperation): Hex {
  return encodeFunctionData({
    abi: solidityCardsAbi,
    functionName: "mintCards",
    args: [o.beneficiary as Hex, [wrappedItem(o)]],
  });
}
