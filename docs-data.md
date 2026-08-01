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

**Grouped-CV r = 0.647, residual ±0.74 stars.** That explains about 42% of the
variance in a rating. Earlier figures in this project's history — 0.713, 0.743
— were measured against tags made while the ratings were visible, and are
optimistic by roughly the amount you would expect from that.

All 95 rated books in the original 274 have since been retagged by two
independent raters each, told nothing about any rating. Their tags are what the
library now carries, offset-corrected onto the original scale so the 179 unread
books remain comparable.

| axis | tagged with ratings visible | tagged blind |
|---|---|---|
| velocity | +0.56 | +0.31 |
| prose_shine | +0.50 | +0.30 |
| formula | −0.38 | −0.31 |
| friction | −0.30 | −0.11 |
| romance_load | −0.24 | −0.06 |
| darkness | +0.17 | +0.10 |
| interiority | −0.10 | **+0.17** |

Velocity and prose_shine survive at roughly half strength: real axes, overstated.
`formula` barely moves, so it was never leaning on the answer. `interiority`
changes sign — it looked useless when tagged with ratings in view and is a
modest positive signal without them, which is worth remembering. Contamination
does not only inflate; it can also hide.

Fitted on blind tags the model is barely re-weighted — velocity +0.695 to
+0.702, prose_shine +0.365 to +0.250 — and the recommendations barely move:
17 of the top 20 unchanged, mean shift 0.07 stars. **The ranking was robust to
this all along. Only the confidence in it was not.**

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
reach. Replacing the axis with it drops the model to 0.605.

---

## What the groups are, and why there are twenty

The eleven groups `clusters.py` produced were under-resolved. Greedy modularity
has a resolution limit — it cannot see communities below a size threshold and
merges them — and measured on the subgraph induced by each group, using the same
weights and the same K=4 sparsification, **every one of the eleven splits
further**: sub-modularity 0.33 to 0.60, stable across K=3..6. Forty of the
forty-five resulting sub-communities are mixed-author, so this is real structure
rather than the layout lumping a series together.

Only the two strongest were split, by `scripts/resplit.py`:

| parent | sub-modularity | became |
|---|---|---|
| Epic Campaigns | 0.604 | Epic Campaigns, Weird Campaigns, Alternate-History Military, The Black Company, Military SF |
| Mythic Journeys | 0.462 | Hidden Doors, Sellsword Errands, Grail Quests, Wry Odysseys, Comic Fantasy, Doorstopper Quests |

Splitting all eleven would give ~40 groups, more than the label vocabulary can
name apart — two Puzzle-Box SF sub-groups both come out as "mystery-box,
technological, cosmic-weird". The two chosen are the ones whose parts are
cleanly nameable.

**Do not read a group's leak as evidence its interior is homogeneous.** Leak and
modularity score the *boundary* of a partition. Epic Campaigns had the lowest
leak of any group (0.11) and the highest internal substructure (0.60) at the
same time; those measure different things.

Colour follows the *family*, not the group: twenty is far past what hue can
carry, so the five parts of Epic Campaigns share one hue and are told apart by
their own outline and name. `fam` on each cluster indexes `CLUSTER_COLORS`.

## Why a series does not get one vote per volume

`ridge()` weights every row by `log2(1+n)/n`, where n is the size of the row's
series. A fourteen-book run counted for fourteen independent opinions when it is
closer to one opinion held fourteen times.

| | grouped r | drift if Discworld were rated out (8 → 40) |
|---|---|---|
| equal weights | 0.632 | 0.226 — `prose_shine` moves 27% |
| **log2(1+n)/n** | **0.640** | **0.024** |
| 1/sqrt(n) | 0.639 | 0.027 |
| 1/n | 0.641 | 0.006 |

Every scheme *improves* accuracy, so the pseudo-replication was hurting
predictions, not protecting them. The four are within noise of each other
(0.639–0.641), so log wins on principle: it keeps the most information
(effective sample size 210 against 182 for 1/n) and saturates the way reading
does — the second volume of a series still says something, the fortieth almost
nothing. It is the same `log2(1+n)` the shelf sort uses for `pull`.

## Rating drift, and why the old ratings were not rescaled

Ratings made in the app average 4.43 against 3.60 for the historical ones — the
old mode was 3★, the new mode is 5★. Most of that gap is **not** scale drift:

| treatment | grouped r |
|---|---|
| as-is | 0.640 |
| era as a model term | 0.650 |
| old ratings lifted onto the new scale | 0.603 |

Rescaling makes it *worse*, because the era gap is mostly explained by the books
themselves — completed series that were finished precisely because they landed.
Controlling for features, the genuine drift is **+0.17 stars**, not the +0.49 a
standalone-only comparison suggests.

## community_pace scores but never explains

Its coefficient is a large negative (−0.385) while its raw correlation with the
ratings is −0.03. It is a suppressor, not an effect: pace and the velocity tag
overlap at +0.52, so the fit uses pace to subtract the part of "fast" that is
merely quick rather than gripping. The detail panel therefore excludes it from
"held back because…" — quoted alone it claimed reading fast was a penalty, which
the data does not support.
