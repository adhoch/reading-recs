# Reading network — source layout

```
src/
  index.html          markup shell
  style.css           all styling
  app.js              all behaviour
  data.js             generated dev shim (do not edit)
  data/
    books.json        one record per book — the thing you'll edit most
    model.json        fitted Ridge coefficients
    meta.json         author + series aggregates from your full library
    next_in_series.json  unread volumes, from Wikidata / ISFDB / FantasticFiction
build.py              assembles src/ into dist/
```

Open `src/index.html` directly to develop — it loads `data.js`, so no server is
needed. Run `python3 build.py` after changing any JSON to regenerate that shim.

```
python3 build.py             dist/reading-network.html          (~543 KB)
python3 build.py --offline   + dist/reading-network-offline.html (~974 KB, zero
                             third-party requests, works with no network at all)
```

## Where a rating goes

Three independent layers, in the **Your ratings** block of the Filter panel.

**1. This browser (automatic).** Ratings write to `localStorage` under
`reading-network:ratings` as `{"Bird Box": 5}` and are re-applied to the baked-in
data on load. Survives reloads and browser restarts. Keyed by title, so
regenerating `books.json` keeps your ratings as long as titles don't change.
Un-rating restores the original value rather than zeroing it. If a browser
blocks storage the UI says so and falls back to the file layer.

**2. A file (portable).** *Download backup* writes
`reading-ratings-YYYY-MM-DD.json`; *Import file* merges one back. Account-free,
and the thing to use before clearing browser data — a browser profile is not a
backup. Malformed files are rejected without touching what you have.

**3. GitHub gist (optional, cross-device).** Paste a token with **only** the
`gist` scope from github.com/settings/tokens. Push creates a *private* gist and
remembers its id; Pull merges it back; later ratings auto-push after 1.5 s.
The token lives in this browser and is sent only to `api.github.com`. *Forget
token* clears it. Errors surface verbatim — a bad token reads
`GitHub 401 — token rejected`.

Google Drive was considered and rejected: it needs an OAuth client, a consent
screen and a redirect URI, which is a lot of setup for a single JSON blob. A
gist is one token and one paste.

**None of this refits the model.** The model is fitted offline in Python (Ridge
+ leave-one-out CV); the page can only record ratings. To fold them in, export
and either hand them back for a refit or merge into `data/books.json` and
rebuild.

## Where the tags come from

Per book, roughly twenty fields with four different provenances. This matters,
because most of them are not measurements.

| Field | Source | Trust |
|---|---|---|
| `r` | your Goodreads export, or told to me directly | **yours** |
| `ax[0..6]` — velocity, friction, interiority, darkness, romance_load, prose_shine, formula | **my judgement**, assigned from reading about the book | ⚠ **guess** |
| `mi en ea sy in ca mo st` — the facet taxonomy | **my judgement** | ⚠ **guess** |
| `cpace` | StoryGraph community fast/medium/slow %, scraped (256/274) | measured |
| `moods` | StoryGraph community mood %, scraped (271/274) | measured |
| `nrev` | StoryGraph review count, scraped (271/274) | measured |
| `blurb` | StoryGraph publisher description, scraped (269/274) | measured |
| `ser` / `vol` | Goodreads title parsing; recommendations from my own knowledge | mixed |
| `p` / `praw` | Ridge model output from `ax` + `cpace`, plus the King lift | computed |
| `kingsim` | standardised distance to the centroid of your 5★ King books | computed |
| `weber_risk` | `prose_shine <= 2 && formula >= 4` | computed |

**15 of ~20 fields are my judgement or derived from it. Only 4 are independent
measurements.** I have never read any of these books.

Two measured facts about how unreliable the guesses are:

- Re-tagging the same books later, I reproduced myself exactly on well-known
  titles and drifted by ~2.5 points per book on obscure ones (p = 0.003). That's
  why the detail panel shows a confidence line keyed to `nrev`.
- Against community data, `darkness` agrees at r = 0.74 and `friction` at 0.73,
  but `velocity` only at 0.50 — I systematically over-rate pace. This is why
  community pace is carried as its own feature rather than replacing my tag.

To retag a book, edit `ax` in `data/books.json` and rebuild. To change what a
tag means, edit `tagging-schema.md`.

## Regenerating the data

| File | Script | Notes |
|---|---|---|
| `books.json` moods/pace/blurbs | `sgscrape.py`, `sgdesc.py` | StoryGraph via Playwright; ~10 s per book, single worker |
| `next_in_series.json` | `nextvol.py` (Wikidata), `isfdb.py` (ISFDB) | ISFDB is better for SFF; FantasticFiction is manual only |
| `meta.json` | `fixmeta.py` | merges the Goodreads export with ratings given in chat |
| `model.json` | refit in Python | Ridge + LOO; r = 0.713, residual ±0.63 |
