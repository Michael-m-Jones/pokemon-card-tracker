const state = {
  data: null,
  activeCollectionId: null,
  sortKey: "raw",
  summaryHidden: false,
  busyCardId: null,
  promoOnly: false,
  livePricesLoading: false,
  livePricesCheckedAt: null,
  livePricesUpdated: 0
};

const repo = {
  owner: "Michael-m-Jones",
  name: "pokemon-card-tracker",
  branch: "main",
  dataPath: "data/cards.json"
};

const ACTIVE_COLLECTION_KEY = "pokemonTrackerActiveCollection";
const LIVE_PRICE_CACHE_KEY = "pokemonTrackerLivePrices";
const POKEMON_TCG_API = "https://api.pokemontcg.io/v2/cards";
const TCGDEX_CARD_API = "https://api.tcgdex.net/v2/en/cards";

const sortOptions = [
  ["raw", "Price high-low"],
  ["rawAsc", "Price low-high"],
  ["psa", "PSA 10"],
  ["gem", "Gem rate"],
  ["upside", "Grade upside"],
  ["year", "Newest"],
  ["name", "A-Z"]
];

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2
});

const integerMoney = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0
});

const euroMoney = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0
});

const samanthaAssets = {
  flame: "assets/samantha/tail-flame.png",
  totodile: "assets/samantha/totodile-head.png",
  lapras: "assets/samantha/lapras-cutout.png",
  numel: "assets/samantha/numel-cutout.png",
  river: "assets/samantha/dratini-river.png",
  dragonair: "assets/pokemon/dragonair.png"
};

const els = {
  title: document.querySelector("#collection-title"),
  tag: document.querySelector("#collection-tag"),
  tabs: document.querySelector("#tabs"),
  themePanel: document.querySelector("#theme-panel"),
  stats: document.querySelector("#stats"),
  sorts: document.querySelector("#sorts"),
  cards: document.querySelector("#cards"),
  notes: document.querySelector("#notes"),
  updatedAt: document.querySelector("#updated-at"),
  refresh: document.querySelector("#refresh-data"),
  summaryToggle: document.querySelector("#summary-toggle"),
  emptyTemplate: document.querySelector("#empty-template")
};

function collections() {
  return state.data?.collections || [];
}

async function loadData() {
  els.updatedAt.textContent = "Loading latest data...";
  const response = await fetch(`data/cards.json?ts=${Date.now()}`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Could not load card data (${response.status})`);
  }
  state.data = await response.json();
  state.activeCollectionId = resolveActiveCollectionId();
  render();
  refreshActiveCollectionPrices().catch((error) => {
    console.warn("Could not refresh live prices", error);
    renderUpdatedAt();
  });
}

function activeCollection() {
  return collections().find((collection) => collection.id === state.activeCollectionId) || collections()[0];
}

function resolveActiveCollectionId() {
  const ids = new Set(collections().map((collection) => collection.id));
  const hashId = decodeURIComponent(window.location.hash.replace(/^#/, ""));
  const storedId = localStorage.getItem(ACTIVE_COLLECTION_KEY);
  if (ids.has(state.activeCollectionId)) return state.activeCollectionId;
  if (ids.has(hashId)) return hashId;
  if (ids.has(storedId)) return storedId;
  return collections()[0]?.id;
}

function setActiveCollection(id, updateUrl = true) {
  state.activeCollectionId = id;
  localStorage.setItem(ACTIVE_COLLECTION_KEY, id);
  if (updateUrl) {
    history.replaceState(null, "", `#${encodeURIComponent(id)}`);
  }
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function formatMoney(value, rounded = false) {
  const number = finiteNumber(value);
  if (number === null) return "-";
  return rounded ? integerMoney.format(number) : money.format(number);
}

function formatEuro(value) {
  const number = finiteNumber(value);
  return number === null ? "-" : euroMoney.format(number);
}

function formatSourceMoney(value) {
  const number = finiteNumber(value);
  return number === null ? "-" : formatMoney(number, Math.abs(number) >= 1);
}

function formatSummaryMoney(value) {
  const number = finiteNumber(value);
  return number === null ? "-" : formatMoney(number, Math.abs(number) >= 1);
}

function sourceAverage(sources) {
  const values = Object.values(sources || {}).map(finiteNumber).filter((value) => value !== null);
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function avgMarket(card) {
  return finiteNumber(card.prices?.avgMarket) ?? sourceAverage(card.sources) ?? 0;
}

function psa10(card) {
  return finiteNumber(card.prices?.psa10);
}

function gradeUpside(card) {
  const raw = avgMarket(card);
  const psa = psa10(card);
  return raw > 0 && psa !== null ? psa / raw : -1;
}

function isPromoCard(card) {
  const set = `${card.set || ""} ${card.rarity || ""}`;
  const number = String(card.number || "").trim();
  const tcgId = String(card.pokemonTcgId || "").trim();
  return /promo|black star/i.test(set)
    || /^(smp|swshp|xyp|bwp|svp)-/i.test(tcgId)
    || /^(SM|SWSH|XY|BW)\d+$/i.test(number)
    || /^SVP\s*\d+$/i.test(number);
}

function gemInfo(rate) {
  const value = finiteNumber(rate);
  if (value === null) {
    return { label: "no data", color: "#8d98a7", value: "No data" };
  }
  if (value <= 10) return { label: "very tough", color: "#d23b3b", value: `~${value}%` };
  if (value <= 25) return { label: "tough", color: "#e96f25", value: `~${value}%` };
  if (value <= 45) return { label: "moderate", color: "#d89500", value: `~${value}%` };
  return { label: "easier", color: "#1f9d57", value: `~${value}%` };
}

function sortedCards(cards) {
  const copy = [...cards];
  copy.sort((a, b) => {
    if (state.sortKey === "name") return a.name.localeCompare(b.name);
    if (state.sortKey === "year") return (b.year || 0) - (a.year || 0);
    if (state.sortKey === "psa") return (psa10(b) ?? -1) - (psa10(a) ?? -1);
    if (state.sortKey === "gem") return (finiteNumber(b.grading?.gemRate) ?? -1) - (finiteNumber(a.grading?.gemRate) ?? -1);
    if (state.sortKey === "upside") return gradeUpside(b) - gradeUpside(a);
    if (state.sortKey === "rawAsc") return avgMarket(a) - avgMarket(b);
    return avgMarket(b) - avgMarket(a);
  });
  return copy;
}

function visibleCards(collection) {
  const cards = collection.cards || [];
  return state.promoOnly ? cards.filter(isPromoCard) : cards;
}

function availableSortOptions(collection) {
  const cards = collection.cards || [];
  const hasPsa = cards.some((card) => psa10(card) !== null);
  const hasGemRate = cards.some((card) => finiteNumber(card.grading?.gemRate) !== null);
  return sortOptions.filter(([key]) => {
    if (key === "psa" || key === "upside") return hasPsa;
    if (key === "gem") return hasGemRate;
    return true;
  });
}

function ensureSortAvailable(collection) {
  const hasActiveSort = availableSortOptions(collection).some(([key]) => key === state.sortKey);
  if (!hasActiveSort) state.sortKey = "raw";
}

function setText(node, value) {
  node.textContent = value;
  return node;
}

function render() {
  const collection = activeCollection();
  if (!collection) return;
  if (state.promoOnly && !(collection.cards || []).some(isPromoCard)) state.promoOnly = false;
  ensureSortAvailable(collection);
  document.body.classList.toggle("hide-summary", state.summaryHidden);
  document.body.classList.toggle("theme-empty", !!collection.theme && !(collection.cards || []).length);
  document.body.dataset.activeCollection = collection.id;
  els.title.textContent = collection.title;
  els.tag.textContent = collection.tag;
  renderTabs();
  renderTheme(collection);
  renderSorts(collection);
  renderStats(collection);
  renderCards(collection);
  renderNotes();
  renderUpdatedAt();
  els.summaryToggle.textContent = state.summaryHidden ? "Show totals" : "Hide totals";
}

function renderTabs() {
  els.tabs.replaceChildren(...collections().map((collection, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `tab${collection.id === state.activeCollectionId ? " active" : ""}`;
    const tabColor = collection.id === "grails" ? "#d89500" : index === 1 ? "#e96f25" : "#e83a3a";
    button.style.setProperty("--tab-color", tabColor);
    button.textContent = collection.title;
    button.addEventListener("click", () => {
      setActiveCollection(collection.id);
      render();
      refreshActiveCollectionPrices().catch((error) => {
        console.warn("Could not refresh live prices", error);
        renderUpdatedAt();
      });
    });
    return button;
  }));
}

function renderSorts(collection) {
  const controls = [];
  const hasPromos = (collection.cards || []).some(isPromoCard);

  if (hasPromos) {
    controls.push(filterButton("all", "All", !state.promoOnly, () => {
      state.promoOnly = false;
      render();
    }));
    controls.push(filterButton("promos", "Promos", state.promoOnly, () => {
      state.promoOnly = true;
      render();
    }));
  }

  controls.push(...availableSortOptions(collection).map(([key, label]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `sort-button${key === state.sortKey ? " active" : ""}`;
    button.textContent = label;
    button.addEventListener("click", () => {
      state.sortKey = key;
      render();
    });
    return button;
  }));

  els.sorts.replaceChildren(...controls);
}

function filterButton(key, label, active, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.dataset.filter = key;
  button.className = `sort-button filter-button${active ? " active" : ""}`;
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}

function renderStats(collection) {
  const cards = collection.cards || [];
  const promoCount = cards.filter(isPromoCard).length;
  const totalRaw = cards.reduce((sum, card) => sum + avgMarket(card), 0);
  const psaValues = cards.map(psa10).filter((value) => value !== null);
  const totalPsa = psaValues.reduce((sum, value) => sum + value, 0);
  const bestUpside = cards.reduce((best, card) => (gradeUpside(card) > gradeUpside(best || {}) ? card : best), null);
  const stats = [
    ["Cards", String(cards.length)],
    ["Total avg market", formatSummaryMoney(totalRaw)]
  ];
  if (psaValues.length) {
    stats.push(["Total PSA 10", formatSummaryMoney(totalPsa)]);
    if (promoCount) stats.push(["Promos", String(promoCount)]);
    if (bestUpside && gradeUpside(bestUpside) >= 0) {
      stats.push(["Top upside", `${bestUpside.name} ${gradeUpside(bestUpside).toFixed(1)}x`]);
    }
  }
  els.stats.replaceChildren(...stats.map(([label, value]) => {
    const stat = document.createElement("div");
    stat.className = "stat";
    stat.append(setText(document.createElement("p"), label));
    stat.firstChild.className = "stat-label";
    stat.append(setText(document.createElement("p"), value));
    stat.lastChild.className = "stat-value";
    return stat;
  }));
}

function renderCards(collection) {
  const cards = visibleCards(collection);
  if (!cards.length) {
    const node = els.emptyTemplate.content.cloneNode(true);
    const stateCopy = collection.emptyState || {};
    const emptyState = node.querySelector(".empty-state");
    node.querySelector("h2").textContent = state.promoOnly ? "No promos here yet" : stateCopy.title || collection.title;
    node.querySelector("p").textContent = state.promoOnly ? "Switch back to All to see every card in this list." : stateCopy.message || "No cards here yet.";
    if (collection.theme) {
      emptyState.classList.add("sam-empty");
      emptyState.prepend(renderSamEmptyArt());
    }
    els.cards.replaceChildren(node);
    return;
  }
  els.cards.replaceChildren(...sortedCards(cards).map(renderCard));
}

function renderCard(card) {
  const gem = gemInfo(card.grading?.gemRate);
  const hasPsa = psa10(card) !== null;
  const article = document.createElement("article");
  article.className = `card${card.collected ? " collected" : ""}`;

  const body = document.createElement("div");
  body.className = "card-body";

  body.append(renderCardActions(card));

  const imageWrap = document.createElement("div");
  imageWrap.className = `card-image${card.holo ? " holo" : ""}`;
  if (card.imageUrl) {
    const image = document.createElement("img");
    image.loading = "lazy";
    image.alt = card.name;
    image.src = card.imageUrl;
    image.addEventListener("error", () => {
      if (card.fallbackImageUrl && image.src !== card.fallbackImageUrl) {
        image.src = card.fallbackImageUrl;
      } else {
        image.remove();
        imageWrap.append(setText(document.createElement("div"), "Image unavailable"));
        imageWrap.lastChild.className = "image-missing";
      }
    });
    imageWrap.append(image);
  } else {
    imageWrap.append(setText(document.createElement("div"), "Image unavailable"));
    imageWrap.lastChild.className = "image-missing";
  }
  body.append(imageWrap);

  const badges = document.createElement("div");
  badges.className = "badge-row";
  const setBadge = setText(document.createElement("span"), `${card.set} · ${card.year}`);
  setBadge.className = "set-badge";
  badges.append(setBadge);
  if (isPromoCard(card)) {
    const promoBadge = setText(document.createElement("span"), "Promo");
    promoBadge.className = "promo-badge";
    badges.append(promoBadge);
  }
  if (card.collected) {
    const collectedBadge = setText(document.createElement("span"), "Collected");
    collectedBadge.className = "collected-badge";
    badges.append(collectedBadge);
  }
  body.append(badges);

  if (card.nickname) {
    body.append(setText(document.createElement("p"), card.nickname));
    body.lastChild.className = "nickname";
  }

  body.append(setText(document.createElement("h2"), card.name));
  body.lastChild.className = "card-title";
  body.append(setText(document.createElement("p"), `${card.rarity} · #${card.number}`));
  body.lastChild.className = "meta";

  const prices = document.createElement("div");
  prices.className = `prices${hasPsa ? "" : " single-price"}`;
  prices.append(priceBox("Avg market", formatMoney(avgMarket(card))));
  if (hasPsa) {
    prices.append(priceBox("PSA 10", formatMoney(psa10(card)), "psa-value", card.prices?.psa10Estimated));
  }
  body.append(prices);

  body.append(renderSources(card));
  body.append(renderMarkets(card));
  body.append(renderGem(gem));
  article.append(body);
  return article;
}

function renderCardActions(card) {
  const wrap = document.createElement("div");
  wrap.className = "card-actions";

  const select = document.createElement("select");
  select.className = "card-action-select";
  select.setAttribute("aria-label", `Actions for ${card.name}`);
  select.disabled = state.busyCardId === card.id;
  select.append(actionOption("", state.busyCardId === card.id ? "Saving..." : "Options"));

  const current = activeCollection();
  collections().forEach((collection) => {
    if (collection.id === current?.id) return;
    select.append(actionOption(`move:${collection.id}`, `Move to ${shortCollectionName(collection)}`));
  });
  select.append(actionOption("toggle-collected", card.collected ? "Mark uncollected" : "Mark collected"));
  select.append(actionOption("delete", "Delete"));

  select.addEventListener("change", async () => {
    const value = select.value;
    select.value = "";
    if (!value) return;
    await handleCardAction(card, value);
  });

  wrap.append(select);
  return wrap;
}

function actionOption(value, label) {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = label;
  return option;
}

async function handleCardAction(card, action) {
  const collection = activeCollection();
  if (!collection) return;

  const token = localStorage.getItem("pokemonTrackerGitHubToken") || "";
  if (!token) {
    window.alert("Save your GitHub token on the Add Card admin page first.");
    return;
  }

  if (action === "delete" && !window.confirm(`Delete ${card.name} from ${collection.title}?`)) return;
  const moveTarget = action.startsWith("move:") ? action.split(":")[1] : "";
  if (moveTarget && !window.confirm(`Move ${card.name} to ${collectionTitle(moveTarget)}?`)) return;

  try {
    state.busyCardId = card.id;
    render();
    els.updatedAt.textContent = "Saving card change...";

    const updatedData = await updateRemoteCards(token, (data) => {
      const source = data.collections.find((item) => item.id === collection.id);
      if (!source) throw new Error("Current list no longer exists.");
      const sourceCards = source.cards || [];
      const cardIndex = sourceCards.findIndex((item) => item.id === card.id);
      if (cardIndex < 0) throw new Error("That card was not found in the latest data.");

      if (action === "delete") {
        sourceCards.splice(cardIndex, 1);
      } else if (moveTarget) {
        const target = data.collections.find((item) => item.id === moveTarget);
        if (!target) throw new Error("Target list no longer exists.");
        const [movedCard] = sourceCards.splice(cardIndex, 1);
        target.cards ||= [];
        target.cards.push(movedCard);
      } else if (action === "toggle-collected") {
        sourceCards[cardIndex].collected = !sourceCards[cardIndex].collected;
      }

      updateCollectionTags(data);
      data.lastUpdated = new Date().toISOString();
    }, commitMessageForAction(card, action, moveTarget));

    state.data = updatedData;
    if (moveTarget) setActiveCollection(moveTarget);
    state.busyCardId = null;
    render();
    els.updatedAt.textContent = "Card change saved.";
  } catch (error) {
    window.alert(error.message);
    els.updatedAt.textContent = error.message;
  } finally {
    if (state.busyCardId !== null) {
      state.busyCardId = null;
      render();
    }
  }
}

async function updateRemoteCards(token, mutate, message) {
  const file = await fetchGitHubData(token);
  const data = JSON.parse(decodeBase64(file.content));
  mutate(data);

  const response = await fetch(`https://api.github.com/repos/${repo.owner}/${repo.name}/contents/${repo.dataPath}`, {
    method: "PUT",
    headers: githubHeaders(token),
    body: JSON.stringify({
      message,
      content: encodeBase64(`${JSON.stringify(data, null, 2)}\n`),
      sha: file.sha,
      branch: repo.branch
    })
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || `GitHub commit failed (${response.status}).`);
  }

  return data;
}

async function fetchGitHubData(token) {
  const response = await fetch(`https://api.github.com/repos/${repo.owner}/${repo.name}/contents/${repo.dataPath}?ref=${repo.branch}&ts=${Date.now()}`, {
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

function commitMessageForAction(card, action, moveTarget) {
  if (action === "delete") return `Delete ${card.name}`;
  if (moveTarget) return `Move ${card.name} to ${collectionTitle(moveTarget)}`;
  return `${card.collected ? "Unmark" : "Mark"} ${card.name} collected`;
}

function updateCollectionTags(data) {
  (data.collections || []).forEach((collection) => {
    collection.tag = collectionTag(collection);
  });
}

function collectionTag(collection) {
  const count = (collection.cards || []).length;
  if (collection.id === "grails") return `${count} PSA 10 grails tracked`;
  if (collection.id === "samantha") return `A cozy couples collecting page · ${count} cards tracked`;
  if (collection.id === "michael") return `The main collection · ${count} cards tracked`;
  return `${count} cards tracked`;
}

function collectionTitle(id) {
  return collections().find((collection) => collection.id === id)?.title || id;
}

function shortCollectionName(collection) {
  if (collection.id === "michael") return "Michael";
  if (collection.id === "samantha") return "Samantha";
  if (collection.id === "grails") return "Grails";
  return collection.title;
}

function priceBox(label, value, valueClass = "", estimated = false) {
  const box = document.createElement("div");
  box.className = "price-box";
  box.append(setText(document.createElement("div"), label));
  box.firstChild.className = "price-key";
  const amount = setText(document.createElement("div"), value);
  amount.className = `price-value ${valueClass}`.trim();
  if (estimated) {
    const est = setText(document.createElement("span"), "~est");
    est.className = "estimated";
    amount.append(" ", est);
  }
  box.append(amount);
  return box;
}

function renderSources(card) {
  const labels = [
    ["priceCharting", "PC"],
    ["tcgplayer", "TCG"],
    ["pokescope", "PS"]
  ];
  const row = document.createElement("div");
  row.className = "sources";
  labels.forEach(([key, label], index) => {
    if (index) row.append(setText(document.createElement("span"), "·"));
    const value = finiteNumber(card.sources?.[key]);
    const span = setText(document.createElement("span"), value === null ? `${label} -` : `${label} ${formatSourceMoney(value)}`);
    if (value === null) span.className = "source-missing";
    row.append(span);
  });
  return row;
}

function renderMarkets(card) {
  const market = card.markets?.cardmarket;
  if (!market) return document.createDocumentFragment();

  const row = document.createElement("div");
  row.className = "market-row";
  row.append(setText(document.createElement("span"), "Cardmarket"));
  row.firstChild.className = "market-key";
  row.append(setText(document.createElement("span"), `${formatEuro(market.trend ?? market.average)} trend`));
  row.lastChild.className = "market-value";
  return row;
}

function renderTheme(collection) {
  els.themePanel.replaceChildren();

  if (!collection.theme) {
    els.themePanel.hidden = true;
    return;
  }

  const scene = document.createElement("div");
  scene.className = "sam-scene";

  const intro = document.createElement("div");
  intro.className = "theme-copy";
  intro.append(setText(document.createElement("p"), "Sam's cozy catch path"));
  intro.firstChild.className = "theme-kicker";
  intro.append(setText(document.createElement("h2"), "A riverside hunt with sparks tucked into the corners."));

  const river = createThemeImage(samanthaAssets.river, "sam-river", "");
  const dragonair = createThemeImage(samanthaAssets.dragonair, "sam-dragonair", "");
  const totodile = createThemeImage(samanthaAssets.totodile, "sam-float sam-float-totodile", "");
  const lapras = createThemeImage(samanthaAssets.lapras, "sam-float sam-float-lapras", "");
  const numel = createThemeImage(samanthaAssets.numel, "sam-float sam-float-numel", "");
  const flameOne = createThemeImage(samanthaAssets.flame, "sam-flame sam-flame-one", "");
  const flameTwo = createThemeImage(samanthaAssets.flame, "sam-flame sam-flame-two", "");

  scene.append(river, dragonair, intro, flameOne, flameTwo, totodile, lapras, numel);
  els.themePanel.append(scene);
  els.themePanel.hidden = false;
}

function createThemeImage(src, className, alt) {
  const image = document.createElement("img");
  image.src = src;
  image.alt = alt;
  image.className = className;
  image.loading = "eager";
  image.fetchPriority = "high";
  return image;
}

function renderSamEmptyArt() {
  const art = document.createElement("div");
  art.className = "sam-empty-art";
  art.setAttribute("aria-hidden", "true");
  art.append(
    createThemeImage(samanthaAssets.flame, "sam-empty-flame sam-empty-flame-a", ""),
    createThemeImage(samanthaAssets.flame, "sam-empty-flame sam-empty-flame-b", ""),
    createThemeImage(samanthaAssets.totodile, "sam-empty-totodile", ""),
    createThemeImage(samanthaAssets.lapras, "sam-empty-lapras", ""),
    createThemeImage(samanthaAssets.numel, "sam-empty-numel", "")
  );
  return art;
}

function renderGem(gem) {
  const row = document.createElement("div");
  row.className = "gem";
  row.append(document.createElement("span"));
  row.firstChild.className = "gem-dot";
  row.append(setText(document.createElement("span"), "PSA 10 gem rate"));
  row.children[1].className = "gem-label";
  row.append(setText(document.createElement("span"), `${gem.value} · ${gem.label}`));
  row.lastChild.className = "gem-value";
  return row;
}

function renderNotes() {
  els.notes.replaceChildren(...(state.data.notes || []).map((note) => {
    const item = document.createElement("li");
    item.textContent = note;
    return item;
  }));
}

function renderUpdatedAt() {
  const updated = state.data.lastUpdated ? new Date(state.data.lastUpdated) : null;
  const saved = updated && !Number.isNaN(updated.getTime())
    ? `Saved ${updated.toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}`
    : "Saved date unavailable";
  if (state.livePricesLoading) {
    els.updatedAt.textContent = `${saved} · Checking live TCGplayer prices...`;
    return;
  }
  if (state.livePricesCheckedAt) {
    const checked = state.livePricesCheckedAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    els.updatedAt.textContent = `Live TCGplayer prices checked ${checked} (${state.livePricesUpdated} updated) · ${saved}`;
    return;
  }
  els.updatedAt.textContent = saved;
}

els.refresh.addEventListener("click", () => {
  loadData().catch(showError);
});

async function refreshActiveCollectionPrices() {
  if (!state.data || state.livePricesLoading) return;
  const collection = activeCollection();
  const cards = (collection?.cards || []).filter((card) => card.pokemonTcgId);
  if (!cards.length) return;

  state.livePricesLoading = true;
  renderUpdatedAt();

  const cache = readLivePriceCache();
  applyLivePrices(cards, cache);
  const uniqueIds = [...new Set(cards.map((card) => card.pokemonTcgId))];
  const settled = await mapWithConcurrency(uniqueIds, 6, fetchLivePrice);
  let updated = 0;

  settled.forEach((result) => {
    if (result.status !== "fulfilled" || result.value.market === null) return;
    const { id, market, updatedAt } = result.value;
    cache[id] = { market, updatedAt, fetchedAt: new Date().toISOString() };
    cards.filter((card) => card.pokemonTcgId === id).forEach((card) => {
      applyLivePrice(card, cache[id]);
      updated += 1;
    });
  });

  writeLivePriceCache(cache);
  state.livePricesLoading = false;
  state.livePricesCheckedAt = new Date();
  state.livePricesUpdated = updated;
  render();
}

async function fetchLivePrice(id) {
  const params = new URLSearchParams({
    q: `id:${id}`,
    select: "id,tcgplayer",
    pageSize: "1"
  });
  try {
    const response = await fetch(`${POKEMON_TCG_API}?${params}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(8000)
    });
    if (response.ok) {
      const payload = await response.json();
      const card = payload.data?.[0];
      const market = marketPrice(card?.tcgplayer?.prices);
      if (market !== null) {
        return { id, market, updatedAt: card?.tcgplayer?.updatedAt || new Date().toISOString().slice(0, 10) };
      }
    }
  } catch {
    // TCGdex carries the same TCGplayer market feed and is a dependable fallback.
  }

  const fallback = await fetch(`${TCGDEX_CARD_API}/${encodeURIComponent(id)}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(8000)
  });
  if (!fallback.ok) throw new Error(`Live price lookup failed (${fallback.status})`);
  const card = await fallback.json();
  return {
    id,
    market: tcgDexTcgPlayerPrice(card),
    updatedAt: tcgDexUpdatedAt(card) || new Date().toISOString().slice(0, 10)
  };
}

function applyLivePrices(cards, cache) {
  cards.forEach((card) => {
    const cached = cache[card.pokemonTcgId];
    if (cached && finiteNumber(cached.market) !== null) applyLivePrice(card, cached);
  });
}

function applyLivePrice(card, price) {
  card.sources ||= {};
  card.sources.tcgplayer = roundPrice(price.market);
  card.sourceUpdatedAt ||= {};
  card.sourceUpdatedAt.tcgplayer = price.updatedAt;
  card.prices ||= {};
  card.prices.avgMarket = roundPrice(sourceAverage(card.sources));
}

function marketPrice(prices = {}) {
  const preferred = ["holofoil", "normal", "reverseHolofoil", "1stEditionHolofoil", "unlimitedHolofoil"];
  for (const key of preferred) {
    const price = finiteNumber(prices[key]?.market ?? prices[key]?.mid);
    if (price !== null) return price;
  }
  for (const price of Object.values(prices || {})) {
    const value = finiteNumber(price?.market ?? price?.mid);
    if (value !== null) return value;
  }
  return null;
}

function tcgDexTcgPlayerPrice(card) {
  const pricing = [card?.pricing?.tcgplayer, ...(card?.variants_detailed || []).map((variant) => variant.pricing?.tcgplayer)];
  for (const source of pricing) {
    for (const value of Object.values(source || {})) {
      const market = finiteNumber(value?.marketPrice ?? value?.market ?? value?.midPrice);
      if (market !== null) return market;
    }
  }
  return null;
}

function tcgDexUpdatedAt(card) {
  const pricing = [card?.pricing?.tcgplayer, ...(card?.variants_detailed || []).map((variant) => variant.pricing?.tcgplayer)];
  return pricing.map((source) => source?.updated).find(Boolean) || null;
}

function roundPrice(value) {
  const number = finiteNumber(value);
  return number === null ? null : Math.round(number * 100) / 100;
}

function readLivePriceCache() {
  try {
    return JSON.parse(localStorage.getItem(LIVE_PRICE_CACHE_KEY) || "{}") || {};
  } catch {
    return {};
  }
}

function writeLivePriceCache(cache) {
  try {
    localStorage.setItem(LIVE_PRICE_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // The live update remains useful even if browser storage is unavailable.
  }
}

async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      try {
        results[index] = { status: "fulfilled", value: await worker(items[index]) };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  });
  await Promise.all(runners);
  return results;
}

els.summaryToggle.addEventListener("click", () => {
  state.summaryHidden = !state.summaryHidden;
  render();
});

window.addEventListener("hashchange", () => {
  const hashId = decodeURIComponent(window.location.hash.replace(/^#/, ""));
  if (collections().some((collection) => collection.id === hashId)) {
    setActiveCollection(hashId, false);
    render();
  }
});

function showError(error) {
  els.updatedAt.textContent = error.message;
  els.cards.replaceChildren();
}

function encodeBase64(value) {
  return btoa(unescape(encodeURIComponent(value)));
}

function decodeBase64(value) {
  return decodeURIComponent(escape(atob(value.replace(/\n/g, ""))));
}

loadData().catch(showError);
