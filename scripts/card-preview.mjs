const inputUrl = process.argv[2];

if (!inputUrl) {
  fail("Missing card URL.");
}

try {
  const card = await buildPreview(new URL(inputUrl));
  console.log(JSON.stringify({ ok: true, card, generatedAt: new Date().toISOString() }, null, 2));
} catch (error) {
  console.log(JSON.stringify({ ok: false, error: error.message, generatedAt: new Date().toISOString() }, null, 2));
  process.exitCode = 1;
}

async function buildPreview(url) {
  if (url.hostname.includes("pricecharting.com")) {
    const priceCharting = await priceChartingPreview(url);
    const pokemonTcg = await findPokemonTcgCard(priceCharting).catch(() => null);
    return mergeCard({ pokemonTcg, priceCharting, priceChartingUrl: canonicalPriceChartingUrl(url) });
  }

  if (url.hostname.includes("pokemontcg.io") || url.hostname.includes("prices.pokemontcg.io")) {
    const id = decodeURIComponent(url.pathname.split("/").filter(Boolean).pop() || "");
    if (!id) throw new Error("Could not read a PokemonTCG card id from the URL.");
    const pokemonTcg = await fetchPokemonTcgCard(id);
    return mergeCard({ pokemonTcg });
  }

  throw new Error("Use a PriceCharting URL or PokemonTCG price URL.");
}

async function priceChartingPreview(url) {
  const html = await fetchText(url.href);
  const popHtml = await fetchText(populationUrl(url));
  const pathParts = url.pathname.split("/").filter(Boolean);
  const setSlug = decodeURIComponent(pathParts.at(-2) || "");
  const cardSlug = decodeURIComponent(pathParts.at(-1) || "");
  const title = cleanText(stripTags(matchOne(html, /<h1[^>]*id=["']product_name["'][^>]*>([\s\S]*?)<\/h1>/i) || matchOne(html, /<title[^>]*>([\s\S]*?)<\/title>/i)));
  const name = title.replace(/\s+#?[A-Z0-9/-]+.*$/i, "").replace(/\s+Prices?$/i, "").trim() || title;
  const number = parseNumberFromSlug(cardSlug) || parseNumberFromTitle(title);

  return {
    name,
    setSlug,
    cardSlug,
    setGuess: setNameFromSlug(setSlug),
    number,
    raw: parseIdPrice(html, "used_price"),
    psa10: parseIdPrice(html, "manual_only_price"),
    gemRate: parseGemRate(popHtml),
    imageUrl: parseImageUrl(html)
  };
}

async function findPokemonTcgCard(priceCharting) {
  const query = priceCharting.number
    ? `number:${escapeQueryValue(priceCharting.number)}`
    : `name:${escapeQueryValue(priceCharting.name)}`;
  const cards = await searchPokemonTcg(query);
  if (!cards.length) return null;
  return cards
    .map((card) => ({ card, score: scorePokemonTcgMatch(card, priceCharting) }))
    .sort((a, b) => b.score - a.score)[0].card;
}

async function searchPokemonTcg(query) {
  const params = new URLSearchParams({
    q: query,
    select: "id,name,set,number,rarity,images,tcgplayer,supertype",
    pageSize: "250"
  });
  const response = await fetch(`https://api.pokemontcg.io/v2/cards?${params}`);
  if (!response.ok) throw new Error(`PokemonTCG search failed (${response.status}).`);
  const json = await response.json();
  return json.data || [];
}

async function fetchPokemonTcgCard(id) {
  const params = new URLSearchParams({
    select: "id,name,set,number,rarity,images,tcgplayer,supertype"
  });
  const response = await fetch(`https://api.pokemontcg.io/v2/cards/${encodeURIComponent(id)}?${params}`);
  if (!response.ok) throw new Error(`PokemonTCG card lookup failed (${response.status}).`);
  const json = await response.json();
  return json.data;
}

function mergeCard({ pokemonTcg, priceCharting, priceChartingUrl }) {
  const sources = {
    priceCharting: round(priceCharting?.raw),
    tcgplayer: round(marketPrice(pokemonTcg?.tcgplayer?.prices)),
    pokescope: null
  };
  const avgMarket = round(average(Object.values(sources)));
  const releaseYear = pokemonTcg?.set?.releaseDate ? Number(pokemonTcg.set.releaseDate.slice(0, 4)) : new Date().getFullYear();
  const name = pokemonTcg?.name || priceCharting?.name || "";
  const set = pokemonTcg?.set?.name || priceCharting?.setGuess || "";
  const number = pokemonTcg?.number || priceCharting?.number || "";
  const externalUrls = {};
  const sourceUpdatedAt = {};

  if (pokemonTcg?.tcgplayer?.url) externalUrls.tcgplayer = pokemonTcg.tcgplayer.url;
  if (priceChartingUrl) externalUrls.priceCharting = priceChartingUrl;
  if (pokemonTcg?.tcgplayer?.updatedAt) sourceUpdatedAt.tcgplayer = pokemonTcg.tcgplayer.updatedAt;
  if (priceCharting) sourceUpdatedAt.priceCharting = today();

  return {
    id: slugify(`${name}-${set}-${number}`),
    pokemonTcgId: pokemonTcg?.id || "",
    name,
    set,
    year: releaseYear,
    rarity: pokemonTcg?.rarity || "Unknown",
    number,
    imageUrl: pokemonTcg?.images?.large || priceCharting?.imageUrl || "",
    fallbackImageUrl: pokemonTcg?.images?.small || "",
    holo: true,
    chase: Number(avgMarket) >= 100,
    prices: {
      avgMarket,
      psa10: round(priceCharting?.psa10),
      psa10Estimated: false
    },
    sources,
    grading: {
      gemRate: finiteNumber(priceCharting?.gemRate)
    },
    sourceUpdatedAt,
    externalUrls,
    markets: {}
  };
}

function parseIdPrice(html, id) {
  const match = html.match(new RegExp(`<td[^>]*id=["']${id}["'][^>]*>[\\s\\S]*?<span[^>]*class=["'][^"']*price[^"']*["'][^>]*>([\\s\\S]*?)<\\/span>`, "i"));
  return parseMoney(stripTags(match?.[1] || ""));
}

function parseGemRate(html) {
  const match = html.match(/VGPC\.pop_(?:price_)?data\s*=\s*(\{[^;]+\})/);
  if (match) {
    const data = JSON.parse(match[1]);
    const psa = data.psa || [];
    const psa10 = finiteNumber(psa[9]);
    const total = psa.map(finiteNumber).filter((value) => value !== null).reduce((sum, value) => sum + value, 0);
    return psa10 !== null && total > 0 ? Math.round((psa10 / total) * 100) : null;
  }
  return null;
}

function parseImageUrl(html) {
  const match = html.match(/<img[^>]+src=['"]([^'"]+)['"][^>]+alt=['"][^'"]*Pokemon[^'"]*['"]/i);
  return match ? decodeHtml(match[1]) : "";
}

function marketPrice(prices = {}) {
  const preferred = ["holofoil", "normal", "reverseHolofoil", "1stEditionHolofoil", "unlimitedHolofoil"];
  for (const key of preferred) {
    const value = finiteNumber(prices[key]?.market ?? prices[key]?.mid);
    if (value !== null) return value;
  }
  for (const price of Object.values(prices || {})) {
    const value = finiteNumber(price?.market ?? price?.mid);
    if (value !== null) return value;
  }
  return null;
}

function scorePokemonTcgMatch(card, priceCharting) {
  let score = 0;
  const setWords = normalizeWords(priceCharting.setGuess);
  const cardSetWords = normalizeWords(card.set?.name || "");
  const nameWords = normalizeWords(priceCharting.name);
  const cardNameWords = normalizeWords(card.name || "");
  if (String(card.number).toLowerCase() === String(priceCharting.number).toLowerCase()) score += 25;
  score += overlapScore(nameWords, cardNameWords) * 4;
  score += overlapScore(setWords, cardSetWords) * 3;
  if ((card.supertype || "").toLowerCase() === "pokemon") score += 2;
  return score;
}

async function fetchText(url) {
  const response = await fetch(url, { headers: { "User-Agent": "pokemon-card-tracker/1.0" } });
  if (!response.ok) throw new Error(`Could not fetch ${new URL(url).hostname} (${response.status}).`);
  return response.text();
}

function average(values) {
  const clean = values.map(finiteNumber).filter((value) => value !== null);
  if (!clean.length) return null;
  return clean.reduce((sum, value) => sum + value, 0) / clean.length;
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function round(value) {
  const number = finiteNumber(value);
  return number === null ? null : Math.round(number * 100) / 100;
}

function parseMoney(value) {
  const match = String(value || "").replace(/,/g, "").match(/\$?\s*([0-9]+(?:\.[0-9]+)?)/);
  return match ? round(match[1]) : null;
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function parseNumberFromSlug(slug) {
  const parts = slug.split("-");
  const last = parts.at(-1) || "";
  return /^[a-z]*\d+[a-z]*$/i.test(last) ? last.toUpperCase() : "";
}

function parseNumberFromTitle(title) {
  const match = title.match(/#\s*([A-Z0-9/-]+)/i);
  return match ? match[1] : "";
}

function setNameFromSlug(slug) {
  return slug
    .replace(/^pokemon-/, "")
    .replace(/%26/gi, "&")
    .split("-")
    .map((word) => (word === "&" ? "&" : word.charAt(0).toUpperCase() + word.slice(1)))
    .join(" ");
}

function populationUrl(url) {
  return `${url.origin}${url.pathname.replace(/^\/game\//, "/pop/item/")}`;
}

function canonicalPriceChartingUrl(url) {
  return `${url.origin}${url.pathname}`;
}

function normalizeWords(value) {
  return slugify(value).split("-").filter(Boolean);
}

function overlapScore(left, right) {
  if (!left.length || !right.length) return 0;
  const rightSet = new Set(right);
  return left.filter((word) => rightSet.has(word)).length;
}

function cleanText(value) {
  return decodeHtml(String(value || "").replace(/\s+/g, " ").trim());
}

function stripTags(value) {
  return String(value || "").replace(/<[^>]+>/g, " ");
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#43;/g, "+")
    .trim();
}

function matchOne(value, pattern) {
  const match = value.match(pattern);
  return match ? match[1] : "";
}

function escapeQueryValue(value) {
  return String(value || "").replace(/"/g, '\\"');
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function fail(message) {
  console.log(JSON.stringify({ ok: false, error: message, generatedAt: new Date().toISOString() }, null, 2));
  process.exit(1);
}
