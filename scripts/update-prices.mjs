import { readFile, writeFile } from "node:fs/promises";

const DATA_PATH = new URL("../data/cards.json", import.meta.url);
const API_BASE = "https://api.pokemontcg.io/v2/cards";
const apiKey = process.env.POKEMONTCG_API_KEY;

const data = JSON.parse(await readFile(DATA_PATH, "utf8"));
const cards = data.collections.flatMap((collection) => collection.cards || []);
let updatedCount = 0;
let failedCount = 0;

for (const card of cards) {
  if (!card.pokemonTcgId) continue;

  try {
    const payload = await fetchCard(card.pokemonTcgId);
    const tcgPrice = marketPrice(payload.tcgplayer?.prices);

    if (tcgPrice !== null) {
      card.sources ||= {};
      card.sources.tcgplayer = round(tcgPrice);
      card.sourceUpdatedAt ||= {};
      card.sourceUpdatedAt.tcgplayer = payload.tcgplayer?.updatedAt || today();
      updatedCount += 1;
    }

    if (payload.images?.large || payload.images?.small) {
      card.imageUrl = payload.images.large || payload.images.small;
      card.fallbackImageUrl = payload.images.small || card.fallbackImageUrl;
    }

    if (payload.tcgplayer?.url) {
      card.externalUrls ||= {};
      card.externalUrls.tcgplayer = payload.tcgplayer.url;
    }

    card.prices ||= {};
    card.prices.avgMarket = round(average(Object.values(card.sources || {})));
    card.chase = Number(card.prices.avgMarket) >= 100;
  } catch (error) {
    failedCount += 1;
    console.warn(`Could not update ${card.name} (${card.pokemonTcgId}): ${error.message}`);
  }

  await delay(125);
}

data.lastUpdated = new Date().toISOString();
data.updateSummary = {
  provider: "PokemonTCG",
  updatedCards: updatedCount,
  failedCards: failedCount
};

await writeFile(DATA_PATH, `${JSON.stringify(data, null, 2)}\n`);

console.log(`Updated ${updatedCount} cards from PokemonTCG. ${failedCount} failed.`);
if (updatedCount === 0 && cards.some((card) => card.pokemonTcgId)) {
  process.exitCode = 1;
}

async function fetchCard(id) {
  const headers = apiKey ? { "X-Api-Key": apiKey } : {};
  const response = await fetch(`${API_BASE}/${encodeURIComponent(id)}`, { headers });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const json = await response.json();
  if (!json.data) {
    throw new Error("missing card data");
  }
  return json.data;
}

function marketPrice(prices = {}) {
  const preferred = ["holofoil", "normal", "reverseHolofoil", "1stEditionHolofoil", "unlimitedHolofoil"];
  for (const key of preferred) {
    const value = numeric(prices[key]?.market ?? prices[key]?.mid);
    if (value !== null) return value;
  }
  for (const price of Object.values(prices)) {
    const value = numeric(price?.market ?? price?.mid);
    if (value !== null) return value;
  }
  return null;
}

function average(values) {
  const clean = values.map(numeric).filter((value) => value !== null);
  if (!clean.length) return null;
  return clean.reduce((sum, value) => sum + value, 0) / clean.length;
}

function numeric(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function round(value) {
  const number = numeric(value);
  return number === null ? null : Math.round(number * 100) / 100;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
