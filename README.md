# reading-network

A personal book recommendation viewer built over a Goodreads export: a rated
library, a fitted preference model, and four ways to ask "what do I read next."

**[Live site](https://USERNAME.github.io/reading-network/)** — replace with your Pages URL.

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
src/data/          books.json, model.json, meta.json, next_in_series.json
scripts/           scrapers and the source-evaluation harness
build.py           assembles src/ into dist/
docs-data.md       where every field comes from, and how ratings are stored
SOURCES.md         every data source tried, with measured results
tagging-schema.md  what the seven register axes mean
```

## A note before making this public

`src/data/books.json` contains your complete reading history and ratings, and
the model is a fairly precise description of your taste. That is more personal
than it looks. If you'd rather not publish it, either keep the repo private and
serve the built file from somewhere authenticated, or put Cloudflare Access in
front of GitHub Pages.

## Licence

Code: MIT. Data: yours — the ratings are personal, and the scraped community
fields belong to their sources.
