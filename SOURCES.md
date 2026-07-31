# Data sources — what's been tried, what earned its place

Run `python3 source_eval.py` to regenerate. Three questions per source:

- **Coverage** — fraction of the 274 books it reaches
- **Agreement** — correlation with my hand-assigned tag on the axis it claims to
  inform. High agreement *validates* my tag; low agreement means one of us is wrong.
- **Lift** — change in leave-one-out r for predicting **your ratings** when the
  signal is added. This is the only number that decides adoption.

Baseline: 7 hand axes + community pace, **LOO r = 0.713, residual ±0.63**.

## Adopted

| Source | Informs | Coverage | Agreement | Lift |
|---|---|---|---|---|
| StoryGraph pace | velocity | 93% | +0.48 | **+0.029** |

Only one signal has ever beaten the baseline. It works *because* agreement with
my tag is mediocre (+0.48): it measures literal speed while my "velocity" measures
compulsiveness, and the model wants both — their fitted weights have opposite signs.

## Kept as context (no lift, but shown in the UI)

| Source | Informs | Coverage | Agreement | Why keep |
|---|---|---|---|---|
| SG %dark | darkness | 96% | **+0.72** | best validation of any hand tag |
| SG %challenging | friction | 97% | **+0.65** | corrected the Vita Nostra mistag |
| SG %tense | darkness | 97% | +0.57 | powers the Tonight moods |
| SG %emotional | interiority | 96% | +0.39 | distinguishes harrowing from dense |
| SG %funny | darkness | 88% | −0.27 | inverse of dark, as expected |
| SG %adventurous | velocity | 99% | +0.21 | 148/163 books — too common to filter on |

These don't improve prediction because my hand tags already capture what they
measure. They earn their place by **validating** the tags and by driving the
mood picker.

## Rejected after measurement

| Source | Result |
|---|---|
| Publisher blurb text (TF-IDF) | nested LOO **0.153** vs 0.713. A naive test showed +0.023 — that was leakage from fitting the text model across all folds. |
| Author mean rating | +0.004, inside noise, with leak-free LOO |
| Series mean rating | −0.001. Naive estimate said series explained 70% of variance; only 13/95 books have a sibling volume once you exclude the book itself |
| SG review count | −0.007 as a feature. Still used as a *confidence* indicator, which is a different job |
| SG %mysterious, %reflective | −0.008, −0.006 |
| Open Library subjects | topical, not tonal — "Fiction, horror" is the whole payload |
| Google Books | HTTP 429 without a key |
| LibraryThing tags | 403; the free Common Knowledge API covers series and characters, not texture |
| Wikidata genre | mixes film and book genres for the same title |

## Tested this round

**LibraryThing — closed, definitively.** 403 to plain HTTP, 403 plus an
unresolvable JS security challenge to a real browser (waited 60 s), and
`robots.txt` disallows automated access. Three independent refusals; the tag
folksonomy is not reachable and I have not tried to route around it.

**UCSD Book Graph (Goodreads 2017) — downloaded and measured, rejected.**
279 MB Fantasy & Paranormal file, 258,585 records, pulled in 6 seconds.

| Test | Result |
|---|---|
| Title matches against your 274 tagged books | 125 (misses are post-2017 titles and non-fantasy horror) |
| Rated books with a match | 55/95 |
| Share of shelf weight that is experiential rather than topical | **2.6%** |
| + 120 shelf features, LOO lift | **−0.571** |
| + Goodreads average rating, LOO lift | −0.001 |

The shelf vocabulary is 2,411 tags, but the mass is `fantasy, fiction, sci-fi,
urban-fantasy, science-fiction, horror` — genre labels and organisational
shelves, not mood. Only 2.6% of shelf weight describes the *experience* of
reading. It is Open Library subjects again at 250,000× the scale, and it fails
the same way. Goodreads' average rating is inert, which is expected: it measures
what everyone thinks, and the model exists to predict what *you* think.

Retained as a possible future source: the 1.26 GB **review-text** file for the
same subset. Review prose describes experience where shelves describe category,
and it is the one untested signal in this dataset. Note the blurb result before
trying it — marketing text scored 0.153 against a 0.713 baseline.

Licence note: the UCSD data is released "for academic use only… please do not
redistribute them or use for commercial purposes." A personal recommender is
non-commercial but not academic. Judgement call; nothing derived from it is
currently shipped.

## Not yet tried

| Source | Why it might work | Cost |
|---|---|---|
| **Hardcover** GraphQL | moods + tags + `users_count`; `users_count` is a cleaner "how well-known" proxy than review count, and that predicts where my tagging is unreliable | free token, must run from your machine |
| **StoryGraph content warnings** | a real "not tonight" filter; existing scraper reaches the page already | ~10 s/book |
| **Review text** (not blurbs) | blurbs are marketing and failed badly; reader reviews describe *experience*, which is what the axes measure | needs a review corpus |
| Page count | the most common mood constraint; export has it for 82/274, none of the recommendations | one lookup per rec |

## The lesson worth keeping

Three separate sources looked strong on a naive test and collapsed under proper
cross-validation: series (70% → −0.001), author (55% → +0.004), blurb text
(+0.023 → −0.560). Every one failed the same way — the thing being predicted had
leaked into its own predictor. **Always refit the candidate inside the fold.**
