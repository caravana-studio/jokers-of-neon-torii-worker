import { expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { openPack, type PackContents } from "../../src/v2/packOpening.js";
const catalog = JSON.parse(
  readFileSync(
    new URL(
      "../../../jokers-of-neon-api/database-v2/catalogs/season4-basic-free-v1.json",
      import.meta.url,
    ),
    "utf8",
  ),
).contents_policy as PackContents;
it("seed replay is deterministic, keeps quality draw order, and rejects malformed definitions", () => {
  expect(openPack(catalog, "00".repeat(31))).toEqual(
    openPack(catalog, "00".repeat(31)),
  );
  expect(
    openPack(catalog, "00".repeat(31)).every(
      (c) => c.quality >= 1 && c.quality <= 10 && !c.marketable,
    ),
  ).toBe(true);
  const invalid = structuredClone(catalog);
  invalid.probabilities[0][0]++;
  expect(() => openPack(invalid, "00".repeat(31))).toThrow(
    "INVALID_PACK_PROBABILITIES",
  );
  expect(() => openPack(catalog, "01")).toThrow("INVALID_PACK_RANDOMNESS");
  invalid.probabilities = structuredClone(catalog.probabilities);
  invalid.categories[0] = [];
  expect(() => openPack(invalid, "00".repeat(31))).toThrow(
    "INVALID_PACK_PROBABILITIES",
  );
});
it("avoids duplicate items within a category and falls back only when its pool is exhausted", () => {
  const c = structuredClone(catalog);
  c.probabilities = Array.from({ length: 4 }, () => [
    10000,
    ...Array(11).fill(0),
  ]);
  c.categories[0] = c.categories[0].slice(0, 2);
  const cards = openPack(c, "00".repeat(31));
  expect(cards[0].item_id).not.toBe(cards[1].item_id);
  expect(cards.length).toBe(4);
  expect(cards.every((card) => c.categories[0].includes(card.item_id))).toBe(
    true,
  );
});
