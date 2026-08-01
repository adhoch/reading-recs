#!/usr/bin/env python3
"""
Promote ratings made in the app into the library.

A rating recorded against a title that has no books.json record is invisible:
build.py joins on title, finds nothing, and drops it. This turns those orphans
into real library records.

  python3 scripts/promote.py           report what would happen, write nothing
  python3 scripts/promote.py --write   apply it

Two tiers, because they cost different amounts:

  untagged  title + author + rating + series position. Counts as read, shows in
            the shelves, feeds the author and series aggregates. Needs nothing
            from a human beyond the rating itself, so it happens automatically.

  tagged    the above plus the seven register axes and the facet taxonomy, which
            only a person can assign. Earns a place in the graph and in the
            model's training set. Supply them in scripts/newbooks.json.

Authors are inferred from an already-tagged sibling in the same series. Anything
that can't be resolved that way is reported rather than guessed at.
"""
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "src", "data")
TAGFILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "newbooks.json")

# Same normalisation the app uses to join a rating to a book: ISFDB and Goodreads
# disagree on a handful of titles ("The Atrocity Archive" / "...Archives").
snorm = lambda x: re.sub(r"[^a-z0-9 ]", "", re.sub(r"^(the|a|an)\s+", "", str(x).lower())).strip()
tstem = lambda x: re.sub(r"s$", "", snorm(x))

FACET_KEYS = ["mi", "sy", "in", "ca", "mo", "ea"]

# The Goodreads export writes "Jim  Butcher" with two spaces, which split him
# into two authors in the aggregates: one with a single book and one with twenty.
aname = lambda a: re.sub(r"\s+", " ", str(a)).strip()


def load(name):
    with open(os.path.join(DATA, f"{name}.json"), encoding="utf-8") as f:
        return json.load(f)


def save(name, obj, compact=False):
    path = os.path.join(DATA, f"{name}.json")
    with open(path, "w", encoding="utf-8") as f:
        if compact:
            json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))
        else:
            json.dump(obj, f, ensure_ascii=False, indent=1)


def title_index(books):
    """Exact-normalised first, singular/plural only when unambiguous."""
    exact, stem = {}, {}
    for b in books:
        exact[snorm(b["t"])] = b
        s = tstem(b["t"])
        stem[s] = None if s in stem else b
    return exact, stem


def find_book(title, idx):
    exact, stem = idx
    return exact.get(snorm(title)) or stem.get(tstem(title))


def locate_in_series(title, all_series, next_series):
    """Which series does this title belong to, and at what volume."""
    for key, entry in all_series.items():
        for vol in entry.get("vols", []):
            if snorm(vol.get("t", "")) == snorm(title):
                return key, entry.get("name", key), vol.get("ord")
    for key, entry in next_series.items():
        for vol in entry.get("next", []):
            if snorm(vol.get("t", "")) == snorm(title):
                return key, entry.get("name", key), vol.get("ord")
    return None, None, None


def author_for_series(series_key, books, series_name=None):
    """The author of an already-tagged volume of the same series.

    all_series.json keys four series short -- "corax" where books.json says
    "Corax Trilogy" -- so an exact key match misses a sibling that is sitting
    right there. The display name is the thing both sources agree on, which is
    the same reconciliation buildShelves does in the viewer."""
    for b in books:
        if b.get("ser") and snorm(b["ser"]) == series_key:
            return b["a"]
    if series_name:
        for b in books:
            if b.get("ser") and snorm(b["ser"]) == snorm(series_name):
                return b["a"]
    return None


EXPORT = os.path.join(ROOT, "library_backup.csv")


SGEXPORT = [f for f in os.listdir(ROOT) if f.startswith("storygraph") and f.endswith(".csv")]


def export_authors():
    """Every export that has been dropped in. Gitignored: it is personal data.

    This read Goodreads only, while export_ratings() below reads Goodreads AND
    StoryGraph — so a book logged only on StoryGraph had a rating that promoted
    and an author that did not, and 24 of 33 titles reported as needing a human
    had their author sitting in a file this function never opened. StoryGraph
    calls the column "Authors"; Goodreads calls it "Author"."""
    import csv
    out = {}
    for name, col in [("library_backup.csv", "Author"),
                      *[(f, "Authors") for f in SGEXPORT]]:
        path = os.path.join(ROOT, name)
        if not os.path.exists(path):
            continue
        try:
            with open(path, encoding="utf-8", newline="") as f:
                for row in csv.DictReader(f):
                    a = (row.get(col) or "").strip()
                    if a:
                        out.setdefault(snorm(re.sub(r"\s*\(.*?\)", "", row["Title"])), a)
        except Exception as exc:
            print(f"  ! couldn't read {name}: {str(exc)[:60]}")
    return out


def export_ratings():
    """Ratings that live only in an export, never in the app.

    Most of the library was rated on Goodreads or StoryGraph years before this
    project existed. Those books are real ratings with no books.json record, and
    tagging one is pointless if promote.py cannot then see its rating."""
    import csv
    out = {}
    for name, tcol, acol, rcol in (
            ("library_backup.csv", "Title", "Author", "My Rating"),
            *[(f, "Title", "Authors", "Star Rating") for f in SGEXPORT]):
        path = os.path.join(ROOT, name)
        if not os.path.exists(path):
            continue
        with open(path, encoding="utf-8", newline="") as f:
            for row in csv.DictReader(f):
                try:
                    r = float(row.get(rcol) or 0)
                except ValueError:
                    continue
                if not (1 <= r <= 5):
                    continue
                key = snorm(re.sub(r"\s*\(.*?\)", "", row[tcol]))
                out.setdefault(key, (row[tcol].strip(), aname(row.get(acol) or ""), r))
    return out


def status_for_series(series_key, books, series_name=None):
    for b in books:
        if b.get("ser") and snorm(b["ser"]) == series_key:
            return b.get("st")
    if series_name:
        for b in books:
            if b.get("ser") and snorm(b["ser"]) == snorm(series_name):
                return b.get("st")
    return None


def features(ax, cpace):
    return [*ax, cpace if cpace is not None else ax[0]]


def score(ax, cpace, model):
    """The Ridge output, recomputed from model.json rather than inherited.

    Note: the p/praw already in books.json predate the current model.json and
    do not reproduce from it (see the note in the commit that added this).
    New records are scored from the committed model so they are at least
    reproducible; the existing 274 are deliberately left alone."""
    praw = model["intercept"] + sum(c * v for c, v in zip(model["coef"], features(ax, cpace)))
    return round(praw, 3), round(min(5.0, max(1.0, praw)), 1)


def edge_weight(a, b):
    """The facet-overlap weight the graph is built from, matching clusters.py."""
    w = 2.0 if a["en"] == b["en"] else 0.0
    for key, wt in (("mi", 1.0), ("sy", 1.5), ("in", 1.25), ("ca", 1.0), ("mo", 1.0)):
        w += wt * len(set(a.get(key) or []) & set(b.get(key) or []))
    return w


BASELINE = os.path.join(DATA, "meta_baseline.json")


def effective_rating(book, ratings):
    """build.py merges ratings.json over books.json at build time, so a book can
    already be rated without books.json saying so. The aggregates have to see the
    same value the app will, or an author reads n:12 for fourteen rated books."""
    v = ratings.get(book["t"])
    return v if isinstance(v, (int, float)) and 1 <= v <= 5 else book["r"]


def rebuild_meta(books, untagged, meta, ratings):
    """Author and series aggregates over every rating the library knows about.

    These drive the "you've rated N, averaging X" lines, which went stale the
    moment a rating landed on a title with no record — twelve Laundry Files
    ratings and Stross still read n:2.

    meta.json derives from the Goodreads export, which covers 433 rated books
    against 274 tagged ones, and that export is not in the repo. So the export's
    numbers are snapshotted once as a baseline and every run recomputes
    baseline + tagged + untagged from scratch. Recomputing rather than
    incrementing is what makes this safe to run twice."""
    if not os.path.exists(BASELINE):
        with open(BASELINE, "w", encoding="utf-8") as f:
            json.dump(meta, f, ensure_ascii=False, indent=1)
        print(f"  snapshotted export-derived aggregates -> {os.path.basename(BASELINE)}")
    with open(BASELINE, encoding="utf-8") as f:
        base = json.load(f)

    authors, series = {}, {}

    def add(author, rating, ser=None, vol=None):
        a = authors.setdefault(aname(author), {"n": 0, "sum": 0.0})
        a["n"] += 1
        a["sum"] += rating
        if ser:
            s = series.setdefault(snorm(ser), {"name": ser, "n": 0, "sum": 0.0, "vols": []})
            s["n"] += 1
            s["sum"] += rating
            if vol:
                s["vols"].append(vol)

    for b in books:
        r = effective_rating(b, ratings)
        if r:
            add(b["a"], r, b.get("ser"), b.get("vol"))
    for title, rec in untagged:
        add(rec["a"], rec["r"], rec.get("ser"), rec.get("vol"))

    out = {"authors": {}, "series": dict(base.get("series", {}))}
    for k, v in base.get("authors", {}).items():
        prev = out["authors"].get(aname(k))
        if prev and prev["n"] >= v["n"]:
            continue
        out["authors"][aname(k)] = v
    for name, agg in authors.items():
        prev = out["authors"].get(name, {})
        # The export may know books this library has never tagged, so its count
        # is a floor: only the surplus is folded in, and never subtracted.
        extra = max(0, prev.get("n", 0) - sum(1 for b in books if aname(b["a"]) == name
                                              and effective_rating(b, ratings)))
        n = agg["n"] + extra
        total = agg["sum"] + prev.get("mean", 0) * extra
        out["authors"][name] = {"n": n, "mean": round(total / n, 2)}
    for key, agg in series.items():
        prev = out["series"].get(key, {})
        vols = sorted(set(agg["vols"]) | set(prev.get("vols") or []))
        out["series"][key] = {"name": agg["name"], "n": max(agg["n"], prev.get("n", 0)),
                              "mean": round(agg["sum"] / agg["n"], 2), "vols": vols}
    return out


def main():
    write = "--write" in sys.argv[1:]
    books = load("books")
    ratings = (load("ratings") or {}).get("ratings") or {}
    all_series, next_series = load("all_series"), load("next_in_series")
    model, graph, meta = load("model"), load("graph"), load("meta")

    hand = {}
    if os.path.exists(TAGFILE):
        with open(TAGFILE, encoding="utf-8") as f:
            hand = json.load(f)

    idx = title_index(books)
    from_export = export_authors()
    orphans = {t: v for t, v in ratings.items() if not find_book(t, idx)}
    # Hand-tagged books whose rating exists only in an export get pulled in too,
    # so a tagging pass over the back catalogue does not need every rating
    # re-entered through the app first.
    if "--from-export" in sys.argv[1:]:
        exp = export_ratings()
        for title in hand:
            if title.startswith("_") or find_book(title, idx) or title in orphans:
                continue
            hit = exp.get(snorm(re.sub(r"\s*\(.*?\)", "", title)))
            if hit:
                orphans[title] = hit[2]
                hand[title].setdefault("a", hit[1])

    # A rating can name a book the library already has under a different title:
    # books.json calls Mistborn's first volume "Mistborn", ISFDB and the rating
    # both call it "Mistborn: The Final Empire". Same series, same volume, so
    # promoting it would shelve the book twice. Matched on position rather than
    # on spelling, and the library's title wins so the rating actually lands.
    aliases = {}
    for title in list(orphans):
        key, _name, ordinal = locate_in_series(title, all_series, next_series)
        if not key:
            continue
        if not (ordinal and re.fullmatch(r"[\d.]+", str(ordinal))):
            # ISFDB numbers Mistborn's two eras from 1 each, so the collision
            # detector strips the ordinals and position in the list is all
            # that is left to match on.
            vols = (all_series.get(key) or {}).get("vols") or []
            hit = [i for i, v in enumerate(vols) if snorm(v.get("t", "")) == snorm(title)]
            if not hit:
                continue
            ordinal = hit[0] + 1
        for b in books:
            if (b.get("ser") and snorm(b["ser"]) == key
                    and b.get("vol") is not None and float(b["vol"]) == float(ordinal)):
                aliases[title] = b["t"]
                break
    if aliases:
        print("same book under two titles — folding the rating onto the existing record:")
        for a, b in aliases.items():
            print(f"   {a!r} -> {b!r}")
        if write:
            raw = load("ratings")
            for a, b in aliases.items():
                raw["ratings"][b] = raw["ratings"].pop(a)
            save("ratings", raw)
            ratings = raw["ratings"]
        for a in aliases:
            orphans.pop(a, None)
        print()
    print(f"{len(orphans)} rating(s) with no library record\n")
    tagged, untagged, blocked = [], [], []

    for title, rating in orphans.items():
        spec = hand.get(title, {})
        key, name, ordinal = locate_in_series(title, all_series, next_series)
        author = (spec.get("a")
                  or (author_for_series(key, books, name) if key else None)
                  or from_export.get(snorm(title)))
        if not author:
            blocked.append((title, "no author — not in the export and no tagged sibling "
                                   "in its series; add an \"a\" to newbooks.json"))
            continue

        rec = {"t": title, "a": author, "r": rating}
        if name:
            rec["ser"] = name
            if ordinal and re.fullmatch(r"[\d.]+", str(ordinal)):
                rec["vol"] = float(ordinal)

        if "ax" in spec:
            rec["ax"] = spec["ax"]
            rec["en"] = spec["en"]
            for k in FACET_KEYS:
                rec[k] = spec.get(k, [])
            rec["st"] = spec.get("st") or status_for_series(key, books, name) or "standalone"
            rec["cpace"] = spec.get("cpace")
            if spec.get("nrev") is not None:
                rec["nrev"] = spec["nrev"]
            rec["praw"], rec["p"] = score(rec["ax"], rec["cpace"], model)
            # Scoped to recommendations, as in books.json: the flag warns about a
            # book you haven't read. On Basilisk Station and Midst Toil and
            # Tribulation match the profile and are deliberately unflagged —
            # they're read, rated 2, and are the evidence behind the rule.
            rec["weber_risk"] = (not rec["r"]) and rec["ax"][5] <= 2 and rec["ax"][6] >= 4
            # kingsim is deliberately absent: the formula that produced the
            # values in books.json isn't in the repo and doesn't reproduce from
            # the documented description. It is only ever read for unread books,
            # and everything promoted here has been read, so a fabricated number
            # would be worse than no number.
            tagged.append(rec)
        else:
            # No axes means no graph position and no model row, so the record
            # would only be a hazard in books.json. The rating still counts:
            # it lands in the author and series aggregates, which is the layer
            # that describes the whole rated library rather than the tagged
            # subset of it.
            untagged.append((title, rec))

    for rec in tagged:
        vol = f" #{rec['vol']:g}" if rec.get("vol") else ""
        print(f"  + {rec['r']}*  {rec['t'][:42]:<42} {rec['a'][:20]:<20} "
              f"{(rec.get('ser') or '')[:18]:<18}{vol:<5} [graph + stats]")
    for title, rec in untagged:
        print(f"  + {rec['r']}*  {title[:42]:<42} {rec['a'][:20]:<20} "
              f"{(rec.get('ser') or '')[:18]:<18}{'':<5} [stats only — add tags to promote further]")
    for title, why in blocked:
        print(f"  ! {title[:42]:<42} {why}")

    print(f"\n{len(tagged)} into the graph, {len(untagged)} into the aggregates only, "
          f"{len(blocked)} blocked")

    if not write:
        print("\ndry run — pass --write to apply")
        return
    # The aggregates are rebuilt even with nothing to promote: rating a book
    # that already has a record changes them too.

    start = len(books)
    books.extend(tagged)

    # Tagged additions earn graph edges: their four strongest facet-overlap
    # links, the same rule clusters.py uses. Cluster membership is inherited
    # from the strongest neighbour rather than recomputed, so adding a book
    # never reshuffles the colours of the 274 already on screen.
    added_edges = 0
    for i in range(start, len(books)):
        scored = sorted(((edge_weight(books[i], books[j]), j) for j in range(len(books))
                         if j != i and books[j].get("ax")), reverse=True)
        best = [(w, j) for w, j in scored if w > 0][:4]
        for w, j in best:
            graph["edges"].append([min(i, j), max(i, j), round(w, 2)])
            added_edges += 1
        # Cluster membership comes from the strongest neighbour that already has
        # one — a book added in this same run may not have been assigned yet.
        home = next((j for w, j in scored if w > 0 and "cl" in books[j]), None)
        books[i]["cl"] = books[home]["cl"] if home is not None else len(graph["clusters"])
        for cluster in graph["clusters"]:
            if cluster["id"] == books[i]["cl"]:
                cluster["n"] += 1

    meta = rebuild_meta(books, untagged, meta, ratings)
    save("books", books, compact=True)
    save("graph", graph, compact=True)
    save("meta", meta)
    print(f"\nwrote {len(tagged)} book record(s), {added_edges} graph edge(s), "
          f"{len(tagged)+len(untagged)} rating(s) into the aggregates")
    print("next: python3 build.py")


if __name__ == "__main__":
    main()
