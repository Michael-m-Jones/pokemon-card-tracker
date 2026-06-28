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
```

Serve the folder with any static file server, then open `index.html` through that server so `data/cards.json` can load.

## Optional secret

The updater can run without a key, but a PokemonTCG API key gives more generous limits. Add it as a GitHub repository secret named `POKEMONTCG_API_KEY`.
