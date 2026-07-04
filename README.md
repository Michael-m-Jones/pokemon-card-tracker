# Poke Card Tracker

A static, shareable Pokemon card price tracker for GitHub Pages.

Live site: https://michael-m-jones.github.io/pokemon-card-tracker/

## How it works

- `index.html`, `assets/styles.css`, and `assets/app.js` render the public site.
- `data/cards.json` is the source of truth for collections, cards, prices, PSA values, and notes.
- `.github/workflows/update-prices.yml` runs daily and refreshes TCGplayer market prices through the PokemonTCG API.
- PriceCharting, PokeScope, PSA 10 values, and gem rates stay editable in `data/cards.json` unless you add another updater.

## Local checks

Use Node 20 or newer:

```sh
node scripts/update-prices.mjs
node scripts/validate-data.mjs
node scripts/card-preview.mjs "https://www.pricecharting.com/game/pokemon-paradox-rift/groudon-199"
```

Serve the folder with any static file server, then open `index.html` through that server so `data/cards.json` can load.

## Add-card admin

Open `/admin.html` to paste a PriceCharting or PokemonTCG URL, generate a preview, edit the reviewed JSON, and commit the card to one of the lists.

The preview step runs `.github/workflows/preview-card.yml`, so the GitHub token used in the browser needs permission to run Actions and read/write repository contents. The token is stored only in local browser storage.

## Optional secret

The updater can run without a key, but a PokemonTCG API key gives more generous limits. Add it as a GitHub repository secret named `POKEMONTCG_API_KEY`.
