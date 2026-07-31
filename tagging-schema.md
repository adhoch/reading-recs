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
  Magic Bites              : formula 5, romance_load 5
  Murderbot: All Systems Red: velocity 5, friction 1, interiority 4

For each book below output:
{ "title", "author", "milieu": [], "engine": "", "engine_alt": [],
  "system": [], "institution": [], "cast": [], "mode": [], "status": "",
  "axes": { "velocity", "friction", "interiority", "darkness",
            "romance_load", "prose_shine", "formula" } }

Books:
<batch>
```

At ~$0.02/batch on Sonnet, the full library runs about 17 batches. Worth spot-checking
the `friction` column by hand — it's the axis a model is least able to judge from
metadata alone, and it's the one that matters most for you.
