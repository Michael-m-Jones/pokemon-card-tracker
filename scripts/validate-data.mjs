import { readFile } from "node:fs/promises";

const data = JSON.parse(await readFile(new URL("../data/cards.json", import.meta.url), "utf8"));
const errors = [];

if (!Array.isArray(data.collections) || !data.collections.length) {
  errors.push("Expected at least one collection.");
}

for (const collection of data.collections || []) {
  if (!collection.id) errors.push("Collection is missing id.");
  if (!collection.title) errors.push(`Collection ${collection.id || "(unknown)"} is missing title.`);

  for (const card of collection.cards || []) {
    const label = `${collection.id}/${card.name || "(unnamed)"}`;
    for (const field of ["id", "name", "set", "year", "rarity", "number", "imageUrl"]) {
      if (card[field] === undefined || card[field] === null || card[field] === "") {
        errors.push(`${label} is missing ${field}.`);
      }
    }
    if (!card.pokemonTcgId && !card.externalUrls?.priceCharting) {
      errors.push(`${label} is missing pokemonTcgId or an external PriceCharting URL.`);
    }
    if (!Number.isFinite(Number(card.prices?.avgMarket))) {
      errors.push(`${label} is missing avg market price.`);
    }
    if (!Number.isFinite(Number(card.prices?.psa10))) {
      errors.push(`${label} is missing PSA 10 price.`);
    }
    if (!card.grading || !Object.hasOwn(card.grading, "gemRate")) {
      errors.push(`${label} is missing PSA 10 gem rate field.`);
    } else if (card.grading.gemRate !== null && !Number.isFinite(Number(card.grading.gemRate))) {
      errors.push(`${label} has an invalid PSA 10 gem rate.`);
    }
    if (!card.sources || !Object.keys(card.sources).length) {
      errors.push(`${label} is missing source prices.`);
    }
  }
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}

const cardCount = data.collections.reduce((sum, collection) => sum + (collection.cards || []).length, 0);
console.log(`Validated ${cardCount} cards across ${data.collections.length} collections.`);
