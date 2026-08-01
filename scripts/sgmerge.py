#!/usr/bin/env python3
"""
Fold scraped StoryGraph rows into books.json.

  python3 scripts/sgmerge.py            report only
  python3 scripts/sgmerge.py --write    apply

sgscrape.py writes sg_rows.jsonl and stops there; turning those rows into the
`cpace`, `moods`, `nrev` and `blurb` columns was part of the offline work that
was never committed. This is that step.

`cpace` is a 1-5 reading-pace figure derived from the community's slow/medium/
fast split, not something StoryGraph publishes directly. The weighting is
recovered from books already carrying it: The Shining reads 12/63/24
fast/medium/slow and stores cpace 2.74, which is the 1-3-5 weighted mean to
within community drift. Verified against every book that already has the
column before anything is written.

Only missing values are filled. A book that already carries a scraped figure
keeps it, so re-running never silently rewrites measured data with a fresh
sample from a moved community.
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "src", "data")
ROWS = os.path.join(ROOT, "sg_rows.jsonl")
DESC = os.path.join(ROOT, "sg_desc.jsonl")
HAND = os.path.join(os.path.dirname(os.path.abspath(__file__)), "blurbs.json")

WEIGHT = {"slow": 1.0, "medium": 3.0, "fast": 5.0}


def cpace_from(row):
    parts = {k: row.get("pace_" + k) for k in WEIGHT}
    if any(v is None for v in parts.values()):
        return None
    total = sum(parts.values())
    if total <= 0:
        return None
    return round(sum(WEIGHT[k] * v for k, v in parts.items()) / total, 2)


def variants(title, author):
    """The library's title is not always the one StoryGraph indexes.

    Reconciling the Mistborn volumes to the library's spelling gave them a
    "Mistborn: " prefix that StoryGraph does not use, and a joint credit like
    "David Drake & Eric Flint" matches nothing as a single string. Both are
    recoverable without hand-maintaining a list of exceptions."""
    titles = [title]
    if ":" in title:
        titles.append(title.split(":", 1)[1].strip())
    authors = [author]
    if "&" in author:
        authors.append(author.split("&")[0].strip())
    return [(t, a) for t in titles for a in authors]


def lookup(rows, title, author):
    for t, a in variants(title, author):
        hit = rows.get(f"{t}|{a}")
        if hit:
            return hit
    return None


def main():
    write = "--write" in sys.argv[1:]
    with open(os.path.join(DATA, "books.json"), encoding="utf-8") as f:
        books = json.load(f)
    if not os.path.exists(ROWS):
        sys.exit("no sg_rows.jsonl — run scripts/sgscrape.py first")
    rows = {}
    with open(ROWS, encoding="utf-8") as f:
        for line in f:
            d = json.loads(line)
            if "error" not in d["v"]:
                rows[d["k"]] = d["v"]

    # Calibrate before trusting: recompute cpace for books that already have one
    # and compare. If the weighting were wrong this is where it shows.
    diffs = []
    for b in books:
        r = lookup(rows, b["t"], b["a"])
        if r and b.get("cpace") is not None:
            c = cpace_from(r)
            if c is not None:
                diffs.append(abs(c - b["cpace"]))
    if diffs:
        worst = max(diffs)
        print(f"calibration: {len(diffs)} books already had cpace; recomputed "
              f"median diff {sorted(diffs)[len(diffs)//2]:.2f}, worst {worst:.2f}")
        if worst > 0.35:
            sys.exit("calibration failed — the pace weighting does not reproduce "
                     "the committed column; not writing")

    # Descriptions come from a second pass (sgdesc.py) keyed the same way, and
    # were the step that never ran: 146 of 415 books had no summary at all.
    descs = {}
    if os.path.exists(DESC):
        with open(DESC, encoding="utf-8") as f:
            for line in f:
                d = json.loads(line)
                if (d.get("desc") or "").strip():
                    descs[d["k"]] = " ".join(d["desc"].split())

    # Books StoryGraph's search will not resolve get a hand-written summary,
    # keyed by title. Applied only where nothing else supplied one, so a later
    # successful scrape is still preferred over the hand copy for anything else.
    hand = {}
    if os.path.exists(HAND):
        with open(HAND, encoding="utf-8") as f:
            hand = {k: v for k, v in json.load(f).items() if k != "_note"}

    filled = {"cpace": 0, "moods": 0, "nrev": 0, "sgdark": 0, "blurb": 0, "hand": 0}
    missing = []
    for b in books:
        if (b.get("blurb") or "").strip():
            continue
        hit = lookup(descs, b["t"], b["a"])
        if hit:
            b["blurb"] = hit
            filled["blurb"] += 1
        elif hand.get(b["t"]):
            b["blurb"] = hand[b["t"]]
            filled["hand"] += 1
    for b in books:
        r = lookup(rows, b["t"], b["a"])
        if not r:
            if b.get("cpace") is None:
                missing.append(b["t"])
            continue
        if b.get("cpace") is None:
            c = cpace_from(r)
            if c is not None:
                b["cpace"] = c
                filled["cpace"] += 1
        if not b.get("moods") and r.get("moods"):
            b["moods"] = r["moods"]
            filled["moods"] += 1
        if b.get("nrev") is None and r.get("nrev") is not None:
            b["nrev"] = r["nrev"]
            filled["nrev"] += 1
        if b.get("sgdark") is None and (r.get("moods") or {}).get("dark") is not None:
            b["sgdark"] = r["moods"]["dark"]
            filled["sgdark"] += 1

    print("filled: " + ", ".join(f"{k} {v}" for k, v in filled.items()))
    still = sum(1 for b in books if b.get("cpace") is None)
    print(f"{still} books still without cpace")
    if missing:
        print("  no StoryGraph match for: " + ", ".join(m[:28] for m in missing[:8])
              + (f", +{len(missing)-8} more" if len(missing) > 8 else ""))
    if not write:
        print("\ndry run — pass --write to apply")
        return
    with open(os.path.join(DATA, "books.json"), "w", encoding="utf-8") as f:
        json.dump(books, f, ensure_ascii=False, separators=(",", ":"))
    print("wrote src/data/books.json — next: python3 build.py")


if __name__ == "__main__":
    main()
