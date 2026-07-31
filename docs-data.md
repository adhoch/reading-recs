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

**1b. A real file on disk (Chrome/Edge).** *Link a ratings.json* opens a file
picker and keeps the handle; every rating then writes straight to that file.
Point it at `src/data/ratings.json` in your checkout and rating a book updates
the repo directly — commit when you like. *Open existing* loads and links a file
in one step. Safari and Firefox lack the File System Access API and fall back to
the download/import layer.

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

## When you rate something that isn't in the library yet

The series shelves list every volume a bibliography knows about, most of which
have no `books.json` record. Rating one of those used to leave the rating
stranded: `build.py` joins on title, found nothing, and dropped it silently —
twelve Laundry Files ratings while the author line still read *2 books, 4.0★*.

`python3 scripts/promote.py` closes that gap. It reports by default and needs
`--write` to act, and it is safe to run twice.

```
python3 scripts/promote.py            what would happen
python3 scripts/promote.py --write    apply, then python3 build.py
```

There are two destinations, because they cost different amounts:

| | what it takes | what you get |
|---|---|---|
| **aggregates** | nothing beyond the rating | counts as read; folds into the author and series means; shows in the series shelf |
| **library** | the seven axes and the facets, by hand, in `scripts/newbooks.json` | all of the above, plus a dot in the graph, edges to its relatives, and a row the model could train on |

Authors are inferred from an already-tagged volume of the same series. When no
sibling is tagged the book is reported rather than guessed at — supply an `a`
in `newbooks.json` and re-run.

Two things a promoted book deliberately does **not** get. `cpace`, `moods`,
`nrev` and `blurb` are scraped community data, not judgement, so they stay empty
until `sgscrape.py` fills them. `kingsim` is omitted outright: the formula that
produced the values already in `books.json` is not in this repo and does not
reproduce from the description above, and a fabricated number would be worse
than an absent one.

Cluster membership is inherited from the book's strongest neighbour rather than
recomputed, so adding a book never reshuffles the colours of everything already
on screen. The cost is that a new book can land in a cluster whose *label* fits
it poorly — *Feed* sits in Corporate Space Opera, having arrived via
`technological` + `guild-corp`. Re-running `clusters.py` would relabel properly,
at the price of moving every existing book.

`meta_baseline.json` is a snapshot of the author and series aggregates as they
came from the Goodreads export. That export is not in this repo, so without the
snapshot a rebuild would quietly lower every count to what `books.json` alone
can see. It is written once, then read on every run.

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
| `meta.json` | `fixmeta.py`, then `promote.py` | `fixmeta.py` merges the Goodreads export; `promote.py` folds in every rating made since |
| ratings with no record | `promote.py` | see above; needs hand tags in `scripts/newbooks.json` for full library membership |
| `model.json` | `fit.py` | Ridge, leave-one-series-out; committed r = 0.713 |

## What the model is actually worth

The committed `model.json` reports r = 0.713 and the current library
cross-validates at 0.743. **Both are optimistic. The honest figure is about
0.67**, explaining roughly 45% of the variance in a rating rather than 55%.

The original 274 books were tagged in conversation, with the ratings visible.
Forty of them were retagged blind by two independent raters who were told
nothing about any rating, on a set spanning the full 2-to-5 range so no
restriction confound applies:

| axis | tagged with ratings visible | tagged blind |
|---|---|---|
| velocity | +0.71 | +0.35 |
| prose_shine | +0.37 | +0.29 |
| formula | −0.32 | −0.25 |
| friction | −0.40 | −0.19 |
| interiority | −0.10 | **+0.26** |

Velocity survives — it is a real axis, not an artifact — but roughly a third of
its apparent strength came from the tagger knowing the answer. Swapping those
forty books for their blind tags moves the whole model from 0.743 to 0.668.

`interiority` moves the other way. It looked useless when tagged with ratings
in view and is a modest positive signal when tagged blind, so contamination
does not only inflate; it can also hide.

### Why velocity is not replaced by something measured

Community data reconstructs a blind tagger's velocity well — r = 0.71,
MAD 0.32 — which looks like grounds for computing the axis instead of guessing
it. It is not. On books held out of that reconstruction entirely:

```
original hand velocity (contaminated)   +0.70
blind hand velocity, two raters         +0.33
computed from community data            +0.03
```

The computed value predicts the tag and not the rating. Whatever velocity
carries about what you like lives in the part community pace and moods cannot
reach. Replacing the axis with it drops the model to 0.605; adding it alongside
is worth +0.004.


Note that `fixmeta.py`, `rebuild_series.py` and `allseries.py` read inputs that
are not in this repo (`library_backup.csv`, `series_wd.json`, `isfdb_cache.json`)
and cannot currently be run. Their outputs are committed; `promote.py` was
written to work from what is actually here.
