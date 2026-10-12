# Data sources — what's been tried, what earned its place

Every figure below was measured on the library as it stood in July 2026: 274
books, 95 of them rated, and a model tagged with the ratings in view. The
library has since grown to 618 books and the honest model figure is lower
(see `docs-data.md`, "What the model is actually worth"). The *relative*
verdicts stand; the absolute numbers are of their moment.

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
trying it — marketing text scored 0.153 against a 0.713 baseline. Review text
has since been tested from Goodreads instead, and failed; see October 2026 below.

Licence note: the UCSD data is released "for academic use only… please do not
redistribute them or use for commercial purposes." A personal recommender is
non-commercial but not academic. Judgement call; nothing derived from it is
currently shipped.

## Tested October 2026: reader reviews, and Jev

Measured on the 618-book library with `fit.py`'s grouped CV (a whole series
held out), not the LOO of the tables above. Baseline is the library as it
stands: **grouped r 0.621** over 290 training rows, 0.424 on the 95
blind-tagged rated books alone. Each candidate replaced the seven axes of those
95 books, offset-corrected per axis against the blind ensemble as
`tagging-schema.md` prescribes. The LLM rater used the unanchored prompt,
because the anchored one names six of the 95.

**Where review text can come from.**

| Source | Result |
|---|---|
| Goodreads book page | 30 reviews per book, no login. All 95 blind-set books found; median 27 reviews of 40+ words, minimum 20; star rating readable on 2,743 of 2,850. Search pages answer a headless browser with an AWS WAF challenge and book pages do not, so the searches ran in a real browser. Kept locally as `gr_reviews.jsonl`, gitignored |
| Hardcover GraphQL | `user_books.review_raw` exists, but the volume is 0.2–0.5% of StoryGraph's: 41 reviews for *Horns* against 15,438, one for a mid-series McLean. Resets the connection under fast requests |
| StoryGraph review pages | `/book_reviews/{id}` sits behind a Cloudflare challenge that never cleared. The stats page the scraper reads is unaffected. Not pursued |
| Amazon | The Creators API returns count and star rating only. Logged-in review pages show 10 and ignore paging, though `filterByStar` gives 10 per star. Mid-series volumes carry one-line reviews. Scraping is against the conditions of use and runs through your account. Not pursued |
| Amazon Reviews 2023 (McAuley) | Has the text, ends September 2023; Books is 20.1 GB plus 14.7 GB of metadata, and the card states no licence. Not downloaded |
| Google Books | No review resource at all; still 429 without a key |

**What reviews do to the axes.** Ten reviews per book, chosen across star
levels, given to two taggers:

| tags on the 95 | grouped r, library | grouped r, 95 only | velocity weight |
|---|---|---|---|
| blind ensemble (current) | **0.621** | **0.424** | +0.41 |
| LLM rater, no reviews | 0.598 | 0.305 | +0.32 |
| same rater, with reviews | 0.554 | 0.088 | +0.17 |
| Jev, from reviews | 0.534 | 0.102 | +0.01 |
| Jev, from blurb | 0.575 | 0.135 | |
| ensemble + rater without reviews, as a third | 0.624 | 0.417 | |
| ensemble + rater with reviews, as a third | 0.619 | 0.376 | |

Reviews made both taggers worse, by the route `docs-data.md` already documents
for community pace. With reviews in view the rater's velocity moved toward what
strangers report (agreement with the ensemble r 0.81 → 0.64) and its weight in
the model halved. Reviews describe the average reader's experience; the part of
velocity that predicts your rating is not in it. Jev (TypeSafe, `jev-1.13.0`)
reproduced the tags only moderately — r 0.48–0.70 per axis, offset-corrected
MAD 0.63 against 0.39–0.45 between raters — and its velocity carried nothing.

One run per arm. The rater's tags with and without reviews differ by MAD 0.24,
which is the same-model rerun floor (0.22), so part of the 95-only drop may be
sampling. The direction held on every measure and for both taggers.

**Jev for facets.** Jev given the blurb, against rater A on the 84 books in
`tagging-my-answers.json`, scored as `tagdiff.py` scores B and C:

| | B | C | Jev |
|---|---|---|---|
| mean of the eight facets | 65% | 70% | 57% |
| milieu | 85% | 89% | 89% |
| engine | 77% | 79% | 61% |
| institution | 56% | 61% | 40% |
| engine_alt | 45% | 44% | 9% |

Good on setting, poor on what drives the plot, which is the facet with the most
weight. Asked as independent yes/no questions, the near-single-valued facets
over-fire (2.4 milieus per book where A tags one) and the mean falls to 46%;
milieu, system and cast have to be single-choice questions.

## Not yet tried

| Source | Why it might work | Cost |
|---|---|---|
| **Hardcover** GraphQL | moods + tags + `users_count`; `users_count` is a cleaner "how well-known" proxy than review count, and that predicts where my tagging is unreliable. Its review text is too thin to use (above) | free token, must run from your machine |
| **StoryGraph content warnings** | a real "not tonight" filter; existing scraper reaches the page already | ~10 s/book |
| Page count | the most common mood constraint; export has it for 82/274, none of the recommendations | one lookup per rec |

## The lesson worth keeping

Three separate sources looked strong on a naive test and collapsed under proper
cross-validation: series (70% → −0.001), author (55% → +0.004), blurb text
(+0.023 → −0.560). Every one failed the same way — the thing being predicted had
leaked into its own predictor. **Always refit the candidate inside the fold.**
