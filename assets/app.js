const state = {
  data: null,
  activeCollectionId: null,
  sortKey: "raw",
  summaryHidden: false
};

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
  if (!state.data) return [];
  const baseCollections = state.data.collections || [];
  const grailCards = baseCollections
    .flatMap((collection) => (collection.cards || []).map((card) => ({ ...card, homeCollection: collection.title })))
    .filter((card) => card.chase || avgMarket(card) >= 100);

  return [
    ...baseCollections,
    {
      id: "grails",
      title: "Grail Watchlist",
      tag: `${grailCards.length} high-value cards tracked`,
      cards: grailCards,
      generated: true
    }
  ];
}

async function loadData() {
  els.updatedAt.textContent = "Loading latest data...";
  const response = await fetch(`data/cards.json?ts=${Date.now()}`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Could not load card data (${response.status})`);
  }
  state.data = await response.json();
  state.activeCollectionId ||= collections()[0]?.id;
  render();
}

function activeCollection() {
  return collections().find((collection) => collection.id === state.activeCollectionId) || collections()[0];
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

function setText(node, value) {
  node.textContent = value;
  return node;
}

function render() {
  const collection = activeCollection();
  if (!collection) return;
  document.body.classList.toggle("hide-summary", state.summaryHidden);
  document.body.classList.toggle("theme-empty", !!collection.theme && !(collection.cards || []).length);
  document.body.dataset.activeCollection = collection.id;
  els.title.textContent = collection.title;
  els.tag.textContent = collection.tag;
  renderTabs();
  renderTheme(collection);
  renderSorts();
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
      state.activeCollectionId = collection.id;
      render();
    });
    return button;
  }));
}

function renderSorts() {
  els.sorts.replaceChildren(...sortOptions.map(([key, label]) => {
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
}

function renderStats(collection) {
  const cards = collection.cards || [];
  const totalRaw = cards.reduce((sum, card) => sum + avgMarket(card), 0);
  const psaValues = cards.map(psa10).filter((value) => value !== null);
  const totalPsa = psaValues.reduce((sum, value) => sum + value, 0);
  const bestUpside = cards.reduce((best, card) => (gradeUpside(card) > gradeUpside(best || {}) ? card : best), null);
  const stats = [
    ["Cards", String(cards.length)],
    ["Total avg market", formatSummaryMoney(totalRaw)],
    ["Total PSA 10", psaValues.length ? formatSummaryMoney(totalPsa) : "-"],
    ["Top upside", bestUpside ? `${bestUpside.name} ${gradeUpside(bestUpside).toFixed(1)}x` : "-"]
  ];
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
  const cards = collection.cards || [];
  if (!cards.length) {
    const node = els.emptyTemplate.content.cloneNode(true);
    const stateCopy = collection.emptyState || {};
    const emptyState = node.querySelector(".empty-state");
    node.querySelector("h2").textContent = stateCopy.title || collection.title;
    node.querySelector("p").textContent = stateCopy.message || "No cards here yet.";
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
  const article = document.createElement("article");
  article.className = "card";
  article.style.setProperty("--accent", gem.color);

  const body = document.createElement("div");
  body.className = "card-body";

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
  if (avgMarket(card) >= 100 || card.chase) {
    const chase = setText(document.createElement("span"), "Chase");
    chase.className = "chase-badge";
    badges.append(chase);
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
  prices.className = "prices";
  prices.append(priceBox("Avg market", formatMoney(avgMarket(card))));
  prices.append(priceBox("PSA 10", formatMoney(psa10(card)), "psa-value", card.prices?.psa10Estimated));
  body.append(prices);

  body.append(renderSources(card));
  body.append(renderMarkets(card));
  body.append(renderGem(gem));
  article.append(body);
  return article;
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
  els.updatedAt.textContent = updated && !Number.isNaN(updated.getTime())
    ? `Updated ${updated.toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}`
    : "Updated date unavailable";
}

els.refresh.addEventListener("click", () => {
  loadData().catch(showError);
});

els.summaryToggle.addEventListener("click", () => {
  state.summaryHidden = !state.summaryHidden;
  render();
});

function showError(error) {
  els.updatedAt.textContent = error.message;
  els.cards.replaceChildren();
}

loadData().catch(showError);
