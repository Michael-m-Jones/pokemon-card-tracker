import { readFile, writeFile } from "node:fs/promises";

const DATA_PATH = new URL("../data/cards.json", import.meta.url);
const API_BASE = "https://api.pokemontcg.io/v2/cards";
const TCGDEX_BASE = "https://api.tcgdex.net/v2/en/cards";
const apiKey = process.env.POKEMONTCG_API_KEY;
const refreshPriceCharting = process.env.REFRESH_PRICECHARTING === "true";

const data = JSON.parse(await readFile(DATA_PATH, "utf8"));
const cards = data.collections.flatMap((collection) => collection.cards || []);
let pokemonTcgUpdatedCount = 0;
let tcgDexUpdatedCount = 0;
let tcgDexSkippedCount = 0;
let priceChartingUpdatedCount = 0;
let gradingUpdatedCount = 0;
let failedCount = 0;

for (const card of cards) {
  let pokemonTcgPriceUpdated = false;
  if (card.pokemonTcgId) {
    try {
      const payload = await fetchCard(card.pokemonTcgId);
      const tcgPrice = marketPrice(payload.tcgplayer?.prices);

      if (tcgPrice !== null) {
        card.sources ||= {};
        card.sources.tcgplayer = round(tcgPrice);
        card.sourceUpdatedAt ||= {};
        card.sourceUpdatedAt.tcgplayer = payload.tcgplayer?.updatedAt || today();
        pokemonTcgUpdatedCount += 1;
        pokemonTcgPriceUpdated = true;
      }

      if (payload.images?.large || payload.images?.small) {
        card.imageUrl = payload.images.large || payload.images.small;
        card.fallbackImageUrl = payload.images.small || card.fallbackImageUrl;
      }

      if (payload.tcgplayer?.url) {
        card.externalUrls ||= {};
        card.externalUrls.tcgplayer = payload.tcgplayer.url;
      }

    } catch (error) {
      failedCount += 1;
      console.warn(`Could not update ${card.name} (${card.pokemonTcgId}): ${error.message}`);
    }

    try {
      const tcgDex = await refreshTcgDexMarkets(card);
      if (!pokemonTcgPriceUpdated) {
        const tcgDexPrice = tcgDexTcgPlayerPrice(tcgDex);
        if (tcgDexPrice !== null) {
          card.sources ||= {};
          card.sources.tcgplayer = round(tcgDexPrice);
          card.sourceUpdatedAt ||= {};
          card.sourceUpdatedAt.tcgplayer = tcgDexUpdatedAt(tcgDex) || today();
          pokemonTcgUpdatedCount += 1;
        }
      }
    } catch (error) {
      failedCount += 1;
      console.warn(`Could not update TCGdex data for ${card.name}: ${error.message}`);
    }
  }

  if (refreshPriceCharting && card.externalUrls?.priceCharting) {
    try {
      await refreshPriceChartingData(card);
    } catch (error) {
      failedCount += 1;
      console.warn(`Could not update PriceCharting data for ${card.name}: ${error.message}`);
    }
  }

  recalculateCard(card);

  await delay(125);
}

data.lastUpdated = new Date().toISOString();
data.updateSummary = {
  providers: ["PokemonTCG", "TCGdex/Cardmarket", ...(refreshPriceCharting ? ["PriceCharting/PSA population"] : [])],
  updatedCards: pokemonTcgUpdatedCount + tcgDexUpdatedCount + priceChartingUpdatedCount + gradingUpdatedCount,
  pokemonTcgUpdatedCards: pokemonTcgUpdatedCount,
  cardmarketUpdatedCards: tcgDexUpdatedCount,
  cardmarketSkippedCards: tcgDexSkippedCount,
  priceChartingUpdatedCards: priceChartingUpdatedCount,
  gradingUpdatedCards: gradingUpdatedCount,
  failedCards: failedCount
};

await writeFile(DATA_PATH, `${JSON.stringify(data, null, 2)}\n`);

console.log(`Updated ${pokemonTcgUpdatedCount} PokemonTCG prices, ${tcgDexUpdatedCount} Cardmarket prices, ${priceChartingUpdatedCount} PriceCharting prices, and ${gradingUpdatedCount} grading records. Skipped ${tcgDexSkippedCount} suspect Cardmarket matches. ${failedCount} failed.`);
if (pokemonTcgUpdatedCount === 0 && cards.some((card) => card.pokemonTcgId)) {
  process.exitCode = 1;
}

async function fetchCard(id) {
  const headers = apiKey ? { "X-Api-Key": apiKey } : {};
  const params = new URLSearchParams({
    q: `id:${id}`,
    pageSize: "1"
  });
  const response = await fetch(`${API_BASE}?${params}`, { headers });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const json = await response.json();
  if (!json.data?.[0]) {
    throw new Error("missing card data");
  }
  return json.data[0];
}

async function refreshTcgDexMarkets(card) {
  const response = await fetch(`${TCGDEX_BASE}/${encodeURIComponent(card.pokemonTcgId)}`);
  if (!response.ok) return null;

  const payload = await response.json();
  const cardmarket = payload.pricing?.cardmarket;
  if (!cardmarket) return payload;

  const trend = numeric(cardmarket.trend);
  const averagePrice = numeric(cardmarket.avg);
  const low = numeric(cardmarket.low);
  const displayPrice = trend ?? averagePrice ?? low;
  if (displayPrice === null) return payload;

  const currentUsdAverage = average(Object.values(card.sources || {}));
  if (currentUsdAverage && (displayPrice < currentUsdAverage * 0.25 || displayPrice > currentUsdAverage * 2.75)) {
    if (card.markets?.cardmarket) delete card.markets.cardmarket;
    tcgDexSkippedCount += 1;
    return payload;
  }

  card.markets ||= {};
  card.markets.cardmarket = {
    unit: cardmarket.unit || "EUR",
    trend: round(trend),
    average: round(averagePrice),
    low: round(low),
    updatedAt: cardmarket.updated || today()
  };
  tcgDexUpdatedCount += 1;
  return payload;
}

function tcgDexTcgPlayerPrice(card) {
  const pricing = [card?.pricing?.tcgplayer, ...(card?.variants_detailed || []).map((variant) => variant.pricing?.tcgplayer)];
  for (const source of pricing) {
    for (const value of Object.values(source || {})) {
      const price = numeric(value?.marketPrice ?? value?.market ?? value?.midPrice);
      if (price !== null) return price;
    }
  }
  return null;
}

function tcgDexUpdatedAt(card) {
  const pricing = [card?.pricing?.tcgplayer, ...(card?.variants_detailed || []).map((variant) => variant.pricing?.tcgplayer)];
  return pricing.map((source) => source?.updated).find(Boolean) || null;
}

async function refreshPriceChartingData(card) {
  const pageUrl = new URL(card.externalUrls.priceCharting);
  const pageHtml = await fetchText(pageUrl.href);
  const raw = parseIdPrice(pageHtml, "used_price");
  const psa10 = parseIdPrice(pageHtml, "manual_only_price");

  if (raw !== null) {
    card.sources ||= {};
    card.sources.priceCharting = round(raw);
    card.sourceUpdatedAt ||= {};
    card.sourceUpdatedAt.priceCharting = today();
    priceChartingUpdatedCount += 1;
  }
  if (psa10 !== null) {
    card.prices ||= {};
    card.prices.psa10 = round(psa10);
    card.prices.psa10Estimated = false;
    gradingUpdatedCount += 1;
  }

  const populationHtml = await fetchText(populationUrl(pageUrl));
  const gemRate = parseGemRate(populationHtml);
  if (gemRate !== null) {
    card.grading ||= {};
    card.grading.gemRate = gemRate;
    gradingUpdatedCount += 1;
  }
}

async function fetchText(url) {
  const response = await fetch(url, { headers: { "User-Agent": "pokemon-card-tracker/1.0" } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

function parseIdPrice(html, id) {
  const match = html.match(new RegExp(`<td[^>]*id=["']${id}["'][^>]*>[\\s\\S]*?<span[^>]*class=["'][^"']*price[^"']*["'][^>]*>([\\s\\S]*?)<\\/span>`, "i"));
  return parseMoney(stripTags(match?.[1] || ""));
}

function parseGemRate(html) {
  const match = html.match(/VGPC\.pop_(?:price_)?data\s*=\s*(\{[^;]+\})/);
  if (!match) return null;
  const population = JSON.parse(match[1]);
  const psa = population.psa || [];
  const psa10 = numeric(psa[9]);
  const total = psa.map(numeric).filter((value) => value !== null).reduce((sum, value) => sum + value, 0);
  return psa10 !== null && total > 0 ? Math.round((psa10 / total) * 100) : null;
}

function populationUrl(url) {
  return `${url.origin}${url.pathname.replace(/^\/game\//, "/pop/item/")}`;
}

function stripTags(value) {
  return String(value || "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ");
}

function parseMoney(value) {
  const match = String(value || "").replace(/,/g, "").match(/\$?\s*([0-9]+(?:\.[0-9]+)?)/);
  return match ? numeric(match[1]) : null;
}

function recalculateCard(card) {
  card.prices ||= {};
  card.prices.avgMarket = round(average(Object.values(card.sources || {})));
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
