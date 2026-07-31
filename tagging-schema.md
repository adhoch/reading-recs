# Reading Taxonomy — Schema v1

A two-layer tagging system for a personal SFF library, designed so that a network
visualization surfaces *why* books connect and *where* the bounce risk lives.

The key design decision: **genre tags don't predict your bounces, register does.**
"Dark fantasy with an occult institution" describes both *The Library at Mount Char*
(5★) and *The Justice of Kings* (3★). So the schema splits into:

- **Layer 1 — Facets.** Categorical, multi-valued. These build the graph edges.
- **Layer 2 — Axes.** Ordinal 1–5. These predict fit, and drive filtering.

---

## Layer 1: Facets (categorical, multi-valued)

Facets answer *what kind of book is this*. Two books sharing facets get an edge.
Each facet has an edge weight — how much a shared value counts toward connection.

### `milieu` — where it takes place (weight 1.0)

| value | meaning |
|---|---|
| `secondary-world` | invented world, no Earth connection |
| `contemporary-earth` | roughly now, our world |
| `historical-earth` | our world, pre-1950 |
| `alt-history` | our world, diverged |
| `portal` | someone crosses in or out |
| `near-future` | recognizable extrapolation |
| `far-future` | post-recognizable |
| `post-apocalyptic` | after the collapse |
| `unplaceable` | deliberately unlocated or dream-logic |
| `time-displaced` | characters cross time and know it (v1.1) |

`time-displaced` is distinct from `alt-history`: the latter is a world that diverged,
the former is people who arrived. *1632* is both; *How Few Remain* is only the second.

**Known gap, deliberately left open.** The rebuild-civilisation books (*1632*,
*Island in the Sea of Time*, *Dies the Fire*) run on an engine the vocabulary doesn't
have — *founding*, where the pleasure is watching an institution get built from
nothing, as opposed to `institutional-politics`, where it already exists and factions
fight inside it. It isn't added yet because only four tagged books would use it, and a
ninth engine value costs a ninth categorical colour, which degrades the whole legend.
Revisit once the full library is tagged and the count justifies the slot.

### `engine` — what actually drives the plot (weight 2.0, primary drives node color)

The single most important facet. Each book gets one **primary** engine (`engine`)
and optional secondaries (`engine_alt`).

| value | meaning |
|---|---|
| `investigation` | a question is being chased down |
| `heist` | a plan is being executed against opposition |
| `campaign-war` | armies, fronts, attrition, logistics |
| `mystery-box` | the world itself is the puzzle |
| `ascent-of-power` | someone is becoming something |
| `institutional-politics` | factions maneuvering inside a structure |
| `survival` | staying alive against pressure |
| `quest` | go there, get that, come back changed |

### `system` — how the strange operates (weight 1.5)

| value | meaning |
|---|---|
| `hidden-world-occult` | magic exists and is being concealed |
| `hard-magic` | rules stated, consequences enforced |
| `cosmic-weird` | rules exist but exceed comprehension |
| `mythic` | gods, archetypes, story-as-force |
| `technological` | it's engineering, however exotic |
| `mundane` | no supernatural mechanism |

### `institution` — the structure the plot runs through (weight 1.25)

Your strongest single positive signal. Tag all that apply.

| value | meaning |
|---|---|
| `bureaucracy` | forms, departments, procedure |
| `academy` | training, ranking, curriculum |
| `criminal-org` | crews, families, thieves' guilds |
| `military` | chain of command |
| `guild-corp` | trade body, contractor, company |
| `church` | doctrine and clergy |
| `none` | no institution matters |

### `cast` — protagonist shape (weight 1.0)

`solo-competent` · `damaged-loner` · `ensemble-crew` · `villain-protagonist` ·
`naive-initiate` · `dual-strand` · `multi-pov-sprawl`

### `mode` — the register it's played in (weight 1.0)

`horror` · `noir` · `comedy` · `satire` · `adventure` · `tragedy` · `procedural`

### `status` — completion state (weight 0.5)

`standalone` · `complete-series` · `ongoing` · `stalled`

---

## Layer 2: Axes (ordinal 1–5)

Axes do not create edges. They filter the graph and explain fit.
Every axis is oriented so that **the number means the amount of the named thing**.

| axis | 1 | 5 | why it's here |
|---|---|---|---|
| `velocity` | drifting, atmospheric | compulsive pull | Your #1 predictor. *The Vagrant*, *Between Two Fires*, *Annihilation* all failed here. |
| `friction` | in from page one | long cold entry | Distinct from velocity. *The Gone World*, *Blackwing*, *Justice of Kings* were on-target books you couldn't get into. |
| `interiority` | all event | mostly inside heads | *Let the Right One In* was "too literary/interior" — not slow, just internal. |
| `darkness` | cozy | bleak | You want high. This is not a negative axis. |
| `romance_load` | absent | it's the engine | Explicit avoid. |
| `prose_shine` | serviceable/clunky | luminous | *The Traitor God* failed low; *Starless Sea* proves high alone isn't enough. |
| `formula` | each entry reinvents | machine repeats | Seanan McGuire, *Repairman Jack*, *Sixteen Ways*/Saevus Corax. Standalones are always 1. |

### The derived signals

Two interactions matter more than any single axis, and the viz computes both:

**Grimdark haze** = `darkness ≥ 4` AND `velocity ≤ 2`.
This is the difference between *The Black Company* (loved) and *Between Two Fires*
(too vibey). Darkness isn't the problem; darkness without drive is.

**Cold door** = `friction ≥ 4` AND `velocity ≤ 3`.
Books you *should* like on facets but abandon in the first 80 pages.
Note that `friction ≥ 4` alone is survivable — Malazan and *Gideon the Ninth*
both sit there and both landed, because velocity carried you through.

### Your fit window, from the data

```
velocity     ≥ 4        strongest single requirement
friction     ≤ 3        unless velocity = 5, then ≤ 5
interiority  ≤ 4
darkness     2–5        no constraint; you tolerate the whole range
romance_load ≤ 2
prose_shine  ≥ 3
formula      ≤ 3
```

---

## Graph construction

**Nodes** = books. Size by rating (recommendations get a neutral size and a ring
instead of a fill). Color by primary `engine`.

**Edges** = weighted shared-facet count:

```
w(a,b) = Σ over facets F:  weight(F) × |F(a) ∩ F(b)|
```

Keep the top 4 edges per node plus any edge with `w ≥ 6`. Without pruning, ~90 books
produce ~2,000 edges and the graph becomes a hairball.

**Layout** = force-directed on edge weight. Clusters emerge from facets, not from axes —
which is what makes the axes useful as an independent overlay rather than a
restatement of position.

---

## Extending to the full 425-book library

Tag in batches of 25 with this prompt. Keeping the anchor examples in every batch is
what holds the axis scale stable across runs — without them, `velocity` drifts about
a point per batch.

```
You are applying a fixed reading taxonomy. Return JSON only, no prose.

[paste Layer 1 + Layer 2 tables above]

Calibration anchors — match these scales exactly:
  The Library at Mount Char : velocity 5, friction 2, interiority 2, prose_shine 5
  Malazan: Gardens of the Moon: velocity 4, friction 5, interiority 3, prose_shine 5
  Annihilation             : velocity 2, friction 4, interiority 5, prose_shine 5
  A Psalm for the Wild-Built: velocity 1, friction 1, interiority 5, darkness 1
  Magic Bites              : formula 5, romance_load 5, prose_shine 2
  Murderbot: All Systems Red: velocity 5, friction 1, interiority 4
  Foundation               : velocity 3, prose_shine 3, darkness 3
  The Sword of Shannara    : velocity 4, prose_shine 2, formula 5

For each book below output:
{ "title", "author", "milieu": [], "engine": "", "engine_alt": [],
  "system": [], "institution": [], "cast": [], "mode": [], "status": "",
  "axes": { "velocity", "friction", "interiority", "darkness",
            "romance_load", "prose_shine", "formula" } }

Books:
<batch>
```

At ~$0.02/batch on Sonnet, the full library runs about 17 batches.

### Measured: offsets dominate, and anchors do not fix them

84 books were tagged four times: by A (this repo's tagger), by B and C
independently with this document and its anchors, and by C again with the
anchor block removed and nothing else changed.

Fitted on the library, swapping each rater in for those 84 books:

```
rater             raw     offset-corrected
A (baseline)     0.690         0.690
B anchored       0.472         0.700
C anchored       0.638         0.706
C unanchored     0.638         0.700
```

Three things follow, and the second was a surprise.

**Every rater is equivalent once the offset is removed.** 0.690 to 0.706 is
noise. No tagger here is better than another; they are differently calibrated.

**The anchors buy almost nothing.** Same model, same books, anchors the only
variable: mean absolute difference between C-anchored and C-unanchored is 0.20,
against 0.39-0.45 between different raters. Both produce grouped-CV r of exactly
0.638 raw. An earlier version of this file claimed velocity drifts about a point
per batch without anchors and added two more to fix it. The controlled run does
not support that. The anchors were retained because the unanchored run emitted
two values outside the vocabulary (`mode: mystery`, `hidden-world-occult` filed
under milieu) where the anchored runs emitted at most one — they appear to help
compliance, not calibration.

**Mixing uncorrected scales is the only thing that actually costs anything.**
B raw scores 0.472 against 0.690, because 139 books in the training set are on
A's scale and 84 are on B's. That is a bigger loss than any other choice
documented in this project.

Where the raters sit, mean across the 84:

| | velocity | friction | interiority | prose_shine |
|---|---|---|---|---|
| A | 3.17 | 2.11 | 2.90 | 3.29 |
| B | 4.13 | 2.00 | 2.88 | 3.85 |
| C | 3.76 | 2.39 | 3.26 | 3.33 |

A is the low outlier on velocity, not B the high one: two independent raters
both put it 0.6 to 1.0 above A. And A's own batch sits about 0.4 to 0.8 away
from the original 274 on several axes when compared like-for-like on 3-star
books, so this is not a property of outside taggers. Everyone has their own
ruler, including whoever tagged first.

The operational rule: a batch from any source, including a later run by the
same model, is not mergeable as-is. Overlap ~20 already-tagged books, take the
mean difference per axis, subtract it. Do that and the source stops mattering.

Worth spot-checking the `friction` column by hand — it's the axis a model is
least able to judge from metadata alone, and it's the one that matters most for
you. (Note that friction turned out to be one of the *stable* axes across the
two taggers: 0.90 correlation, 73% exact. The unstable one was velocity.)
