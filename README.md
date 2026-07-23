# Poke Card Tracker

A static, shareable Pokemon card price tracker for GitHub Pages.

Live site: https://michael-m-jones.github.io/pokemon-card-tracker/

## How it works

- `index.html`, `assets/styles.css`, and `assets/app.js` render the public site.
- `data/cards.json` is the source of truth for collections, cards, prices, PSA values, and notes.
- `.github/workflows/update-prices.yml` runs every six hours and refreshes TCGplayer market prices through the PokemonTCG API. The public site also checks the active list's TCGplayer prices when it opens, without storing a credential in the browser.
- A daily PriceCharting/PSA population workflow refreshes raw prices, PSA 10 values, and gem rates where a PriceCharting source is available. PokeScope values stay editable in `data/cards.json`.

## Local checks

Use Node 20 or newer:

```sh
node scripts/update-prices.mjs
node scripts/validate-data.mjs
node scripts/card-preview.mjs "https://www.pricecharting.com/game/pokemon-paradox-rift/groudon-199"
```

Serve the folder with any static file server, then open `index.html` through that server so `data/cards.json` can load.

## Add-card admin

Open `/admin.html` to paste a PriceCharting, TCGplayer, or PokemonTCG URL. `Send request` opens a GitHub issue form and the workflow adds the verified card without a personal access token. Repository owner accounts are always allowed; add additional GitHub usernames as a comma-separated `CARD_INTAKE_USERS` repository variable for shared use.

The in-page preview and direct commit route remains available as an advanced option. It needs a GitHub token with Actions and repository contents permission, and the token is stored only in local browser storage.

## Optional secret

The updater can run without a key, but a PokemonTCG API key gives more generous limits. Add it as a GitHub repository secret named `POKEMONTCG_API_KEY`.
