/** Exact port of Core PackTrait + Random/get_entropy. Seed is server-issued and persisted before this reducer. */
export interface PackItem {
  item_id: number;
  item_type: number;
  card_id: number;
  rarity: number;
  skin_id: number;
  skin_rarity: number;
}
export interface PackContents {
  processor: "core-pack-lcg-v1";
  marketable: boolean;
  legacy_pack_id: number;
  season_id: number;
  probabilities: number[][];
  categories: number[][];
  items: PackItem[];
}
export interface OpenedCard extends PackItem {
  quality: number;
  marketable: boolean;
}
const uint = (v: unknown): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && v <= 0xffffffff;
export function openPack(c: PackContents, seedHex: string): OpenedCard[] {
  if (
    !c ||
    c.processor !== "core-pack-lcg-v1" ||
    typeof c.marketable !== "boolean" ||
    !uint(c.legacy_pack_id) ||
    !uint(c.season_id) ||
    !Array.isArray(c.items) ||
    !c.items.length ||
    c.items.length > 10000 ||
    !Array.isArray(c.categories) ||
    c.categories.length !== 12 ||
    !Array.isArray(c.probabilities) ||
    !c.probabilities.length ||
    c.probabilities.length > 100
  )
    throw new Error("INVALID_PACK_CATALOG");
  const ids = new Map<number, PackItem>();
  for (const item of c.items) {
    if (
      !item ||
      Object.keys(item).sort().join(",") !==
        "card_id,item_id,item_type,rarity,skin_id,skin_rarity" ||
      !Object.values(item).every(uint) ||
      item.item_type > 3 ||
      item.rarity > 4 ||
      item.skin_rarity > 4 ||
      ids.has(item.item_id)
    )
      throw new Error("INVALID_PACK_ITEM");
    ids.set(item.item_id, item);
  }
  for (const group of c.categories)
    if (
      !Array.isArray(group) ||
      new Set(group).size !== group.length ||
      !group.every((id) => ids.has(id))
    )
      throw new Error("INVALID_PACK_CATEGORY");
  for (const row of c.probabilities)
    if (
      !Array.isArray(row) ||
      row.length !== 12 ||
      !row.every(uint) ||
      row.reduce((a, b) => a + b, 0) !== 10000 ||
      row.some((v, i) => v > 0 && !c.categories[i].length)
    )
      throw new Error("INVALID_PACK_PROBABILITIES");
  if (!/^[a-f0-9]{62}$/i.test(seedHex))
    throw new Error("INVALID_PACK_RANDOMNESS");
  let state = (BigInt("0x" + seedHex) % ((1n << 128n) - 1n)) % (1n << 48n);
  const next = (range: number) => {
    const value = Number(state % BigInt(range));
    state = (25214903917n * state + 11n) % (1n << 48n);
    return value;
  };
  const result: PackItem[] = [];
  for (const row of c.probabilities) {
    const draw = next(10000);
    let sum = 0,
      index = 0;
    for (; index < row.length; index++) {
      sum += row[index];
      if (draw < sum) break;
    }
    const group = c.categories[index],
      available = group.filter(
        (id) => !result.some((item) => item.item_id === id),
      );
    const pool = available.length ? available : group;
    result.push(ids.get(pool[next(pool.length)])!);
  }
  return result.map((item) => ({
    ...item,
    quality: next(10) + 1,
    marketable: c.marketable,
  }));
}
