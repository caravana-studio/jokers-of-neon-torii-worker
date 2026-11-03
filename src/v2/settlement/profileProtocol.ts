import { encodeFunctionData, parseAbi, type Hex } from "viem";

export const profileAbi = parseAbi([
  "struct GameData { uint32 id; address owner; uint32 playerScore; uint32[] specials; uint32 cash; uint32 round; bool isTournament; uint32 level; string playerName; }",
  "struct RoundData { uint32 gameId; uint32 roundId; address playerAddress; uint32 currentScore; uint32 targetScore; uint32[] rages; }",
  "struct PlayerStats { address player; uint32 gamesPlayed; uint32 gamesWon; uint32 highCardPlayed; uint32 pairPlayed; uint32 twoPairPlayed; uint32 threeOfAKindPlayed; uint32 fourOfAKindPlayed; uint32 fiveOfAKindPlayed; uint32 fullHousePlayed; uint32 flushPlayed; uint32 straightPlayed; uint32 straightFlushPlayed; uint32 royalFlushPlayed; uint32 lootBoxesPurchased; uint32 cardsPurchased; uint32 specialsPurchased; uint32 specialsSold; uint32 powerUpsPurchased; uint32 levelUpsPurchased; uint32 modifiersPurchased; uint32 rerollsPurchased; uint32 burnPurchased; }",
  "function owner() view returns (address)",
  "function setGameData(GameData gameData)",
  "function getGameData(uint32 gameId) view returns (GameData)",
  "function setRoundData(RoundData roundData)",
  "function addPlayerStats(PlayerStats playerStats)",
  "function syncProgression(address player, uint8 tier, uint32 totalRuns, uint32 maxLevel, uint32 maxRound)",
  "event GameDataSet(uint32 indexed gameId, address indexed player, uint32 score, uint32 round)",
  "event RoundDataSet(uint32 indexed gameId, uint32 indexed roundId, address indexed player, uint32 currentScore)",
  "event PlayerStatsAdded(address indexed player, uint32 gamesPlayed, uint32 gamesWon)",
  "event ProgressionSynced(address indexed player, uint8 tier, uint32 totalRuns, uint32 maxLevel, uint32 maxRound)",
  "error GameNotFound(uint32 gameId)",
]);

export interface ProfilePayload {
  protocol: "profile-v1";
  method: "setGameData" | "setRoundData" | "addPlayerStats" | "syncProgression";
  args: unknown[];
}
export function uint32(value: unknown): number {
  if ((typeof value !== "string" && typeof value !== "number") ||
      (typeof value === "number" && !Number.isSafeInteger(value)) ||
      !/^(?:0x[0-9a-f]+|[0-9]+)$/i.test(String(value)) || BigInt(value) > 0xffffffffn)
    throw new Error("PROFILE_UINT32_OVERFLOW");
  return Number(BigInt(value));
}
export function profileCalldata(payload: ProfilePayload, beneficiary: string): Hex {
  if (payload.protocol !== "profile-v1" || !Array.isArray(payload.args)) throw new Error("INVALID_PROFILE_PAYLOAD");
  const a = payload.args;
  const address = (v: unknown) => {
    if (typeof v !== "string" || !/^0x[0-9a-f]{40}$/i.test(v) || v.toLowerCase() !== beneficiary.toLowerCase())
      throw new Error("PROFILE_BENEFICIARY_MISMATCH");
    return v as Hex;
  };
  const array = (v: unknown) => {
    if (!Array.isArray(v) || v.length > 1000) throw new Error("INVALID_PROFILE_ARRAY");
    return v.map(uint32);
  };
  switch (payload.method) {
    case "setGameData": {
      if (a.length !== 9 || typeof a[6] !== "boolean" || typeof a[8] !== "string" || !uint32(a[0])) throw new Error("INVALID_PROFILE_GAME");
      return encodeFunctionData({ abi: profileAbi, functionName: "setGameData", args: [{
        id: uint32(a[0]), owner: address(a[1]), playerScore: uint32(a[2]), specials: array(a[3]), cash: uint32(a[4]),
        round: uint32(a[5]), isTournament: a[6], level: uint32(a[7]), playerName: a[8],
      }] });
    }
    case "setRoundData": {
      if (a.length !== 6 || !uint32(a[0])) throw new Error("INVALID_PROFILE_ROUND");
      return encodeFunctionData({ abi: profileAbi, functionName: "setRoundData", args: [{
        gameId: uint32(a[0]), roundId: uint32(a[1]), playerAddress: address(a[2]), currentScore: uint32(a[3]), targetScore: uint32(a[4]), rages: array(a[5]),
      }] });
    }
    case "addPlayerStats": {
      if (a.length !== 23) throw new Error("INVALID_PROFILE_STATS");
      const names = ["gamesPlayed", "gamesWon", "highCardPlayed", "pairPlayed", "twoPairPlayed", "threeOfAKindPlayed", "fourOfAKindPlayed", "fiveOfAKindPlayed", "fullHousePlayed", "flushPlayed", "straightPlayed", "straightFlushPlayed", "royalFlushPlayed", "lootBoxesPurchased", "cardsPurchased", "specialsPurchased", "specialsSold", "powerUpsPurchased", "levelUpsPurchased", "modifiersPurchased", "rerollsPurchased", "burnPurchased"] as const;
      const stats = Object.fromEntries(names.map((name, i) => [name, uint32(a[i + 1])])) as Record<typeof names[number], number>;
      return encodeFunctionData({ abi: profileAbi, functionName: "addPlayerStats", args: [{ player: address(a[0]), ...stats }] });
    }
    case "syncProgression": {
      if (a.length !== 5 || uint32(a[1]) > 255) throw new Error("INVALID_PROFILE_PROGRESSION");
      return encodeFunctionData({ abi: profileAbi, functionName: "syncProgression", args: [address(a[0]), uint32(a[1]), uint32(a[2]), uint32(a[3]), uint32(a[4])] });
    }
    default: throw new Error("UNSUPPORTED_PROFILE_METHOD");
  }
}

export interface ProfileGameSource {
  game_id: string; runtime_id: string; player_account: string; beneficiary: string; player_name: string;
  score: string; level: number; round: number; is_tournament: boolean;
}
/** Validate all identity/result fields against the durable journal before freezing the runtime snapshot. */
export function profileSnapshot(source: ProfileGameSource, game: string[], specials: string[], stats: string[]) {
  const id = uint32(source.game_id);
  if (game.length < 24 || BigInt(game[0]) !== BigInt(id) || BigInt(game[3]) !== BigInt(source.player_account) ||
      BigInt(game[5]) !== BigInt(source.score) || uint32(game[6]) !== source.level || uint32(game[8]) !== source.round ||
      !["0", "1"].includes(BigInt(game[17]).toString()) || (BigInt(game[17]) === 1n) !== source.is_tournament ||
      BigInt(game[18]) !== BigInt(id) || game.length !== 24 + uint32(game[23]) || stats.length !== 23 ||
      uint32(stats[1]) !== 0 || uint32(stats[2]) !== 0)
    throw new Error("PROFILE_RUNTIME_SNAPSHOT_MISMATCH");
  const count = uint32(specials[0]);
  const stride = count === 0 ? 7 : (specials.length - 1) / count;
  if ((stride !== 6 && stride !== 7) || specials.length !== 1 + count * stride || count !== uint32(game[12]))
    throw new Error("PROFILE_SPECIALS_MISMATCH");
  const effects = Array.from({ length: count }, (_, i) => {
    if (BigInt(specials[1 + i * stride]) !== BigInt(id) || uint32(specials[2 + i * stride]) !== i)
      throw new Error("PROFILE_SPECIALS_MISMATCH");
    return uint32(specials[3 + i * stride]);
  });
  return {
    game: [id, source.beneficiary, uint32(source.score), effects, uint32(game[14]), source.round, source.is_tournament, source.level, source.player_name],
    round: [id, source.round, source.beneficiary, uint32(game[19]), uint32(game[20]), game.slice(24).map(uint32)],
    stats: [source.beneficiary, ...stats.slice(1).map(uint32)],
  };
}
