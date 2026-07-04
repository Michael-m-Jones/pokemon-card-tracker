const repo = {
  owner: "Michael-m-Jones",
  name: "pokemon-card-tracker",
  branch: "main",
  dataPath: "data/cards.json"
};

const state = {
  data: null,
  candidate: null
};

const els = {
  lookupForm: document.querySelector("#lookup-form"),
  url: document.querySelector("#card-url"),
  collection: document.querySelector("#collection-select"),
  token: document.querySelector("#github-token"),
  saveToken: document.querySelector("#save-token"),
  status: document.querySelector("#admin-status"),
  reviewPanel: document.querySelector("#review-panel"),
  previewCard: document.querySelector("#preview-card"),
  reviewForm: document.querySelector("#review-form"),
  json: document.querySelector("#review-json"),
  refreshPreview: document.querySelector("#refresh-preview"),
  commitCard: document.querySelector("#commit-card")
};

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2
});

function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function round(value) {
  const number = finiteNumber(value);
  return number === null ? null : Math.round(number * 100) / 100;
}

function average(values) {
  const clean = values.map(finiteNumber).filter((value) => value !== null);
  if (!clean.length) return null;
  return clean.reduce((sum, value) => sum + value, 0) / clean.length;
}

function formatMoney(value) {
  const number = finiteNumber(value);
  return number === null ? "-" : money.format(number);
}

function setStatus(message, tone = "") {
  els.status.textContent = message;
  els.status.dataset.tone = tone;
}

async function loadData() {
  const response = await fetch(`data/cards.json?ts=${Date.now()}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`Could not load cards (${response.status})`);
  state.data = await response.json();
  renderCollections();
  const savedToken = localStorage.getItem("pokemonTrackerGitHubToken") || "";
  els.token.value = savedToken;
  setStatus("Ready.");
}

function renderCollections() {
  els.collection.replaceChildren(...state.data.collections.map((collection) => {
    const option = document.createElement("option");
    option.value = collection.id;
    option.textContent = collection.title;
    return option;
  }));
}

els.lookupForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const url = els.url.value.trim();
  if (!url) return;

  try {
    setStatus("Building preview...");
    els.reviewPanel.hidden = true;
    state.candidate = await buildCandidate(url);
    applyForm(state.candidate);
    renderPreview(state.candidate);
    els.reviewPanel.hidden = false;
    setStatus("Preview ready. Review the fields before adding.", "success");
  } catch (error) {
    console.error(error);
    setStatus(error.message, "error");
  }
});

els.saveToken.addEventListener("click", () => {
  localStorage.setItem("pokemonTrackerGitHubToken", els.token.value.trim());
  setStatus("Token saved in this browser.", "success");
});

els.refreshPreview.addEventListener("click", () => {
  try {
    const card = cardFromForm();
    state.candidate = card;
    renderPreview(card);
    els.json.value = JSON.stringify(card, null, 2);
    setStatus("Preview refreshed.", "success");
  } catch (error) {
    setStatus(error.message, "error");
  }
});

els.reviewForm.addEventListener("input", () => {
  try {
    const card = cardFromForm();
    els.json.value = JSON.stringify(card, null, 2);
  } catch {
    // Keep typing smooth while required fields are incomplete.
  }
});

els.commitCard.addEventListener("click", async () => {
  try {
    const token = els.token.value.trim();
    if (!token) throw new Error("Add a GitHub token before committing.");

    const card = parseReviewedCard();
    validateCard(card);
    setStatus("Committing card to GitHub...");
    await commitCard(card, els.collection.value, token);
    setStatus(`${card.name} added to ${collectionTitle(els.collection.value)}. GitHub Pages will refresh shortly.`, "success");
  } catch (error) {
    console.error(error);
    setStatus(error.message, "error");
  }
});

async function buildCandidate(inputUrl) {
  const url = normalizeUrl(inputUrl);
  if (!url.hostname.includes("pricecharting.com") && !url.hostname.includes("tcgplayer.com") && !url.hostname.includes("pokemontcg.io") && !url.hostname.includes("prices.pokemontcg.io")) {
    throw new Error("Use a PriceCharting, TCGplayer, or PokemonTCG price URL.");
  }
  const token = els.token.value.trim();
  if (!token) throw new Error("Add a GitHub token before previewing.");
  return buildViaWorkflow(url.href, token);
}

function normalizeUrl(value) {
  try {
    return new URL(value);
  } catch {
    throw new Error("That does not look like a valid URL.");
  }
}

async function buildViaWorkflow(url, token) {
  const requestId = `preview-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const response = await fetch(`https://api.github.com/repos/${repo.owner}/${repo.name}/actions/workflows/preview-card.yml/dispatches`, {
    method: "POST",
    headers: githubHeaders(token),
    body: JSON.stringify({
      ref: repo.branch,
      inputs: {
        request_id: requestId,
        url
      }
    })
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || `Could not start preview workflow (${response.status}).`);
  }

  setStatus("Preview is running in GitHub Actions...");
  const preview = await pollPreview(requestId, token);
  if (!preview.ok) throw new Error(preview.error || "Preview workflow could not build that card.");
  return uniqueCard(preview.card);
}

async function pollPreview(requestId, token) {
  const started = Date.now();
  const path = `data/previews/${requestId}.json`;
  while (Date.now() - started < 120000) {
    await delay(5000);
    const response = await fetch(`https://api.github.com/repos/${repo.owner}/${repo.name}/contents/${path}?ref=${repo.branch}&ts=${Date.now()}`, {
      headers: githubHeaders(token)
    });
    if (response.status === 404) continue;
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.message || `Could not read preview (${response.status}).`);
    }
    const file = await response.json();
    return JSON.parse(decodeBase64(file.content));
  }
  throw new Error("Preview is still running. Try Preview again in a moment.");
}

async function buildFromPriceCharting(url) {
  const pageHtml = await fetchHtml(url.href);
  const page = parsePriceChartingPage(pageHtml, url);
  const popHtml = await fetchHtml(populationUrl(url));
  const pop = parsePopulationPage(popHtml);
  const tcgCard = await findPokemonTcgCard(page);

  return mergeCard({
    pokemonTcg: tcgCard,
    priceCharting: page,
    population: pop,
    priceChartingUrl: canonicalPriceChartingUrl(url)
  });
}

async function buildFromPokemonTcgUrl(url) {
  const id = decodeURIComponent(url.pathname.split("/").filter(Boolean).pop() || "");
  if (!id) throw new Error("Could not read the PokemonTCG card id from that URL.");
  const tcgCard = await fetchPokemonTcgCard(id);
  return mergeCard({ pokemonTcg: tcgCard });
}

async function fetchHtml(url) {
  const direct = await fetch(url).catch(() => null);
  if (direct?.ok) return direct.text();

  const relay = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
  const proxied = await fetch(relay);
  if (!proxied.ok) throw new Error(`Could not fetch ${new URL(url).hostname} (${proxied.status}).`);
  return proxied.text();
}

function parsePriceChartingPage(html, url) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const title = cleanText(doc.querySelector("#product_name")?.textContent || doc.querySelector("h1")?.textContent || doc.title);
  const pathParts = url.pathname.split("/").filter(Boolean);
  const setSlug = decodeURIComponent(pathParts.at(-2) || "");
  const cardSlug = decodeURIComponent(pathParts.at(-1) || "");
  const number = parseNumberFromSlug(cardSlug) || parseNumberFromTitle(title);
  const name = title.replace(/\s+#?[A-Z0-9/-]+.*$/i, "").replace(/\s+Prices?$/i, "").trim() || title;
  const prices = parsePriceTable(doc);

  return {
    name,
    setSlug,
    cardSlug,
    setGuess: setNameFromSlug(setSlug),
    number,
    raw: prices.ungraded,
    psa10: prices.psa10,
    imageUrl: doc.querySelector("#product_details img, #product_image img")?.src || null
  };
}

function parsePriceTable(doc) {
  const table = doc.querySelector("#price_data");
  if (!table) return { ungraded: null, psa10: null };

  const headers = [...table.querySelectorAll("th")].map((node) => cleanText(node.textContent).toLowerCase());
  const rows = [...table.querySelectorAll("tr")];
  const dataRow = rows.find((row) => row.querySelector(".price, .js-price")) || rows.find((row) => row.querySelectorAll("td").length >= 2);
  const cells = dataRow ? [...dataRow.querySelectorAll("td")] : [];

  return {
    ungraded: priceByHeader(headers, cells, "ungraded"),
    psa10: priceByHeader(headers, cells, "psa 10")
  };
}

function priceByHeader(headers, cells, label) {
  const index = headers.findIndex((header) => header.includes(label));
  if (index < 0 || !cells[index]) return null;
  return parseMoney(cells[index].textContent);
}

function parsePopulationPage(html) {
  const match = html.match(/VGPC\.pop_(?:price_)?data\s*=\s*(\{[^;]+\})/);
  if (match) {
    try {
      const data = JSON.parse(match[1]);
      const psa = data.psa || [];
      const psa10 = finiteNumber(psa[9]);
      const total = psa.map(finiteNumber).filter((value) => value !== null).reduce((sum, value) => sum + value, 0);
      return {
        gemRate: psa10 !== null && total > 0 ? Math.round((psa10 / total) * 100) : null
      };
    } catch {
      // Fall back to the table parser below.
    }
  }

  const doc = new DOMParser().parseFromString(html, "text/html");
  const rows = [...doc.querySelectorAll("#population-table tr, table tr")];
  let psa10 = null;
  let total = 0;
  rows.forEach((row) => {
    const cells = [...row.querySelectorAll("td")].map((cell) => cleanText(cell.textContent));
    if (cells.length < 2) return;
    const grade = finiteNumber(cells[0]);
    const psa = finiteNumber(cells[1].replace(/,/g, ""));
    if (psa === null) return;
    total += psa;
    if (grade === 10) psa10 = psa;
  });

  return {
    gemRate: psa10 !== null && total > 0 ? Math.round((psa10 / total) * 100) : null
  };
}

async function findPokemonTcgCard(priceCharting) {
  const number = priceCharting.number;
  const name = priceCharting.name;
  const query = number
    ? `number:${escapeQueryValue(number)}`
    : `name:${escapeQueryValue(name)}`;
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

function mergeCard({ pokemonTcg, priceCharting, population, priceChartingUrl }) {
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
  if (pokemonTcg?.tcgplayer?.url) externalUrls.tcgplayer = pokemonTcg.tcgplayer.url;
  if (priceChartingUrl) externalUrls.priceCharting = priceChartingUrl;

  const sourceUpdatedAt = {};
  if (pokemonTcg?.tcgplayer?.updatedAt) sourceUpdatedAt.tcgplayer = pokemonTcg.tcgplayer.updatedAt;
  if (priceCharting) sourceUpdatedAt.priceCharting = today();

  return {
    id: uniqueId(slugify(`${name}-${set}-${number}`)),
    pokemonTcgId: pokemonTcg?.id || "",
    name,
    set,
    year: releaseYear,
    rarity: pokemonTcg?.rarity || "Unknown",
    number,
    imageUrl: pokemonTcg?.images?.large || priceCharting?.imageUrl || "",
    fallbackImageUrl: pokemonTgSmallImage(pokemonTcg),
    holo: true,
    chase: Number(avgMarket) >= 100,
    prices: {
      avgMarket,
      psa10: round(priceCharting?.psa10),
      psa10Estimated: false
    },
    sources,
    grading: {
      gemRate: finiteNumber(population?.gemRate)
    },
    sourceUpdatedAt,
    externalUrls,
    markets: {}
  };
}

function pokemonTgSmallImage(card) {
  return card?.images?.small || "";
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

function applyForm(card) {
  setInput("review-name", card.name);
  setInput("review-set", card.set);
  setInput("review-number", card.number);
  setInput("review-year", card.year);
  setInput("review-rarity", card.rarity);
  setInput("review-tcg-id", card.pokemonTcgId);
  setInput("review-avg", card.prices.avgMarket);
  setInput("review-psa", card.prices.psa10);
  setInput("review-gem", card.grading.gemRate);
  document.querySelector("#review-holo").checked = !!card.holo;
  els.json.value = JSON.stringify(card, null, 2);
}

function setInput(id, value) {
  document.querySelector(`#${id}`).value = value ?? "";
}

function cardFromForm() {
  const original = state.candidate || {};
  const form = new FormData(els.reviewForm);
  const sources = {
    ...(original.sources || {}),
    priceCharting: round(original.sources?.priceCharting),
    tcgplayer: round(original.sources?.tcgplayer),
    pokescope: round(original.sources?.pokescope)
  };
  const avgMarket = round(form.get("avgMarket"));
  const name = String(form.get("name") || "").trim();
  const set = String(form.get("set") || "").trim();
  const number = String(form.get("number") || "").trim();

  return {
    ...original,
    id: original.id || uniqueId(slugify(`${name}-${set}-${number}`)),
    pokemonTcgId: String(form.get("pokemonTcgId") || "").trim(),
    name,
    set,
    year: Number(form.get("year")),
    rarity: String(form.get("rarity") || "").trim(),
    number,
    holo: form.get("holo") === "on",
    chase: Number(avgMarket) >= 100,
    prices: {
      ...(original.prices || {}),
      avgMarket,
      psa10: round(form.get("psa10")),
      psa10Estimated: false
    },
    sources,
    grading: {
      ...(original.grading || {}),
      gemRate: finiteNumber(form.get("gemRate"))
    }
  };
}

function parseReviewedCard() {
  const text = els.json.value.trim();
  if (text) {
    try {
      return JSON.parse(text);
    } catch {
      throw new Error("The JSON review block is not valid JSON.");
    }
  }
  return cardFromForm();
}

function validateCard(card) {
  const required = ["id", "name", "set", "year", "rarity", "number", "imageUrl"];
  const missing = required.filter((field) => card[field] === undefined || card[field] === null || card[field] === "");
  if (missing.length) throw new Error(`Missing required field: ${missing.join(", ")}.`);
  if (!finiteNumber(card.prices?.avgMarket)) throw new Error("Average market price is required.");
  if (!finiteNumber(card.prices?.psa10)) throw new Error("PSA 10 price is required.");
  if (!card.grading || !Object.hasOwn(card.grading, "gemRate")) throw new Error("Gem rate must be a number or null.");
}

function renderPreview(card) {
  els.previewCard.replaceChildren();
  const body = document.createElement("div");
  body.className = "card-body";

  const imageWrap = document.createElement("div");
  imageWrap.className = `card-image${card.holo ? " holo" : ""}`;
  const image = document.createElement("img");
  image.alt = card.name;
  image.src = card.imageUrl;
  imageWrap.append(image);
  body.append(imageWrap);

  const badge = document.createElement("div");
  badge.className = "badge-row";
  badge.append(textNode("span", `${card.set} · ${card.year}`, "set-badge"));
  body.append(badge);

  body.append(textNode("h2", card.name, "card-title"));
  body.append(textNode("p", `${card.rarity} · #${card.number}`, "meta"));

  const prices = document.createElement("div");
  prices.className = "prices";
  prices.append(priceBox("Avg market", formatMoney(card.prices?.avgMarket)));
  prices.append(priceBox("PSA 10", formatMoney(card.prices?.psa10), "psa-value"));
  body.append(prices);

  const sources = document.createElement("div");
  sources.className = "sources";
  sources.textContent = `PC ${formatMoney(card.sources?.priceCharting)} · TCG ${formatMoney(card.sources?.tcgplayer)} · PS ${formatMoney(card.sources?.pokescope)}`;
  body.append(sources);

  const gem = finiteNumber(card.grading?.gemRate);
  const gemRow = document.createElement("div");
  gemRow.className = "gem";
  gemRow.append(textNode("span", "", "gem-dot"));
  gemRow.append(textNode("span", "PSA 10 gem rate", "gem-label"));
  gemRow.append(textNode("span", gem === null ? "No data · no data" : `~${gem}% · ${gemLabel(gem)}`, "gem-value"));
  body.append(gemRow);

  els.previewCard.append(body);
}

function priceBox(label, value, valueClass = "") {
  const box = document.createElement("div");
  box.className = "price-box";
  box.append(textNode("div", label, "price-key"));
  box.append(textNode("div", value, `price-value ${valueClass}`.trim()));
  return box;
}

function textNode(tag, value, className) {
  const node = document.createElement(tag);
  node.textContent = value;
  if (className) node.className = className;
  return node;
}

async function commitCard(card, collectionId, token) {
  const file = await fetchGitHubData(token);
  const data = JSON.parse(decodeBase64(file.content));
  const collection = data.collections.find((item) => item.id === collectionId);
  if (!collection) throw new Error("Selected list no longer exists.");
  if (data.collections.some((item) => (item.cards || []).some((existing) => existing.id === card.id))) {
    throw new Error(`A card with id "${card.id}" already exists.`);
  }

  collection.cards ||= [];
  collection.cards.push(card);
  collection.tag = collection.tag.replace(/\d+ cards tracked/, `${collection.cards.length} cards tracked`);
  data.lastUpdated = new Date().toISOString();

  const body = {
    message: `Add ${card.name} to ${collection.title}`,
    content: encodeBase64(`${JSON.stringify(data, null, 2)}\n`),
    sha: file.sha,
    branch: repo.branch
  };

  const response = await fetch(`https://api.github.com/repos/${repo.owner}/${repo.name}/contents/${repo.dataPath}`, {
    method: "PUT",
    headers: githubHeaders(token),
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || `GitHub commit failed (${response.status}).`);
  }
}

async function fetchGitHubData(token) {
  const response = await fetch(`https://api.github.com/repos/${repo.owner}/${repo.name}/contents/${repo.dataPath}?ref=${repo.branch}`, {
    headers: githubHeaders(token)
  });
  if (!response.ok) throw new Error(`Could not read GitHub data file (${response.status}).`);
  return response.json();
}

function githubHeaders(token) {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28"
  };
}

function uniqueId(base) {
  const existing = new Set((state.data?.collections || []).flatMap((collection) => (collection.cards || []).map((card) => card.id)));
  if (!existing.has(base)) return base;
  let index = 2;
  while (existing.has(`${base}-${index}`)) index += 1;
  return `${base}-${index}`;
}

function uniqueCard(card) {
  return {
    ...card,
    id: uniqueId(card.id)
  };
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
  const path = url.pathname.replace(/^\/game\//, "/pop/item/");
  return `${url.origin}${path}`;
}

function canonicalPriceChartingUrl(url) {
  return `${url.origin}${url.pathname}`;
}

function parseMoney(value) {
  const match = String(value || "").replace(/,/g, "").match(/\$?\s*([0-9]+(?:\.[0-9]+)?)/);
  return match ? round(match[1]) : null;
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function escapeQueryValue(value) {
  return String(value || "").replace(/"/g, '\\"');
}

function normalizeWords(value) {
  return slugify(value).split("-").filter(Boolean);
}

function overlapScore(left, right) {
  if (!left.length || !right.length) return 0;
  const rightSet = new Set(right);
  return left.filter((word) => rightSet.has(word)).length;
}

function gemLabel(value) {
  if (value <= 10) return "very tough";
  if (value <= 25) return "tough";
  if (value <= 45) return "moderate";
  return "easier";
}

function collectionTitle(id) {
  return state.data.collections.find((collection) => collection.id === id)?.title || id;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function encodeBase64(value) {
  return btoa(unescape(encodeURIComponent(value)));
}

function decodeBase64(value) {
  return decodeURIComponent(escape(atob(value.replace(/\n/g, ""))));
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

loadData().catch((error) => {
  console.error(error);
  setStatus(error.message, "error");
});
