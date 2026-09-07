# reading-network

A personal book recommendation viewer built over a Goodreads export: a rated
library, a fitted preference model, and four ways to ask "what do I read next."

**[Live site](https://adhoch.github.io/reading-recs/)**

## Build

```bash
python3 build.py              # -> dist/reading-network.html
python3 build.py --offline    # + a version with fonts inlined, zero external requests
```

Open `src/index.html` directly to develop; no server needed.

## Layout

```
src/index.html     markup shell
src/style.css      styling
src/app.js         behaviour
src/data/          books.json, ratings.json, model.json, meta.json, graph.json, all_series.json
scripts/           promote.py, fit.py, the scrapers, and the source-evaluation harness
build.py           assembles src/ into dist/
docs-data.md       where every field comes from, how ratings are stored, and every
                   measurement behind the model
SOURCES.md         every data source tried, with measured results
tagging-schema.md  what the seven register axes mean
context/           local-only (gitignored) working notes; CONTEXT.md is the handoff
```

After rating things in the app: `scripts/promote.py --write`, then
`scripts/fit.py --write`, then `build.py`. `docs-data.md` explains each step.

## A note before making this public

`src/data/books.json` contains your complete reading history and ratings, and
the model is a fairly precise description of your taste. That is more personal
than it looks. If you'd rather not publish it, either keep the repo private and
serve the built file from somewhere authenticated, or put Cloudflare Access in
front of GitHub Pages.

## Licence

Code: MIT. Data: yours — the ratings are personal, and the scraped community
fields belong to their sources.
