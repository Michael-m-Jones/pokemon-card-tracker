import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";

const run = promisify(execFile);
const DATA_PATH = new URL("../data/cards.json", import.meta.url);
const eventPath = process.env.ISSUE_EVENT_PATH;

try {
  if (!eventPath) throw new Error("Missing GitHub issue event.");
  const event = JSON.parse(await readFile(eventPath, "utf8"));
  const collectionId = collectionFor(issueField(event.issue?.body, "List"));
  const url = issueField(event.issue?.body, "Card URL");
  if (!collectionId) throw new Error("Choose Michael, Samantha, or Grails.");
  if (!/^https:\/\//i.test(url || "")) throw new Error("The card URL is missing or invalid.");

  const { stdout } = await run(process.execPath, ["scripts/card-preview.mjs", url], { maxBuffer: 1024 * 1024 });
  const preview = JSON.parse(stdout);
  if (!preview.ok) throw new Error(preview.error || "The card lookup failed.");
  const card = preview.card;
  validateCard(card);

  const data = JSON.parse(await readFile(DATA_PATH, "utf8"));
  const collection = data.collections.find((item) => item.id === collectionId);
  if (!collection) throw new Error("The selected list no longer exists.");
  if (data.collections.some((item) => (item.cards || []).some((existing) => existing.id === card.id))) {
    throw new Error(`${card.name} is already in the tracker.`);
  }

  collection.cards.push(card);
  collection.tag = collectionTag(collection);
  data.lastUpdated = new Date().toISOString();
  await writeFile(DATA_PATH, `${JSON.stringify(data, null, 2)}\n`);
  console.log(JSON.stringify({ ok: true, message: `${card.name} was added to ${collection.title}.` }));
} catch (error) {
  console.log(JSON.stringify({ ok: false, message: error.message }));
}

function issueField(body, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = String(body || "").match(new RegExp(`### ${escaped}\\s*\\n\\n([\\s\\S]*?)(?=\\n### |$)`, "i"));
  return match?.[1]?.trim() || "";
}

function collectionFor(value) {
  return { Michael: "michael", Samantha: "samantha", Grails: "grails" }[value] || "";
}

function validateCard(card) {
  const required = ["id", "name", "set", "year", "rarity", "number", "imageUrl"];
  const missing = required.filter((field) => card[field] === undefined || card[field] === null || card[field] === "");
  if (missing.length) throw new Error(`Could not verify ${missing.join(", ")}. Try a more specific PriceCharting URL.`);
  if (!Number.isFinite(Number(card.prices?.avgMarket))) throw new Error("Could not find a market price for this card.");
  if (!Number.isFinite(Number(card.prices?.psa10))) throw new Error("Could not find a PSA 10 price for this card.");
}

function collectionTag(collection) {
  const count = (collection.cards || []).length;
  if (collection.id === "grails") return `${count} PSA 10 grails tracked`;
  if (collection.id === "samantha") return `A cozy couples collecting page · ${count} cards tracked`;
  if (collection.id === "michael") return `The main collection · ${count} cards tracked`;
  return `${count} cards tracked`;
}
