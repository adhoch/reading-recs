#!/usr/bin/env python3
"""
Build the queue of things only you can answer.

  python3 scripts/needsinput.py            report
  python3 scripts/needsinput.py --write    write src/data/needs_input.json

Three kinds of gap, in descending order of how sure we are you can close it.

  read      StoryGraph has the book on the `read` shelf with no star. It is not
            a guess that you read these; the export says so.
  gap       An unrated volume with rated volumes on BOTH sides of it. Rating 1,
            2, 4 and 5 of a series and skipping 3 is far more likely to be an
            unlogged read than a deliberate omission.
  blocked   A rating that cannot be promoted into the library because no author
            can be inferred -- not in either export, no tagged sibling in its
            series. Only you know who wrote it.

Deliberately excluded: the 391 volumes sitting after the last one you rated in
a series. That set is dominated by books you simply have not read -- four
unrated A Song of Ice and Fire volumes are not an oversight -- and a queue that
cannot be finished is a queue nobody opens.

The exports are gitignored, so this cannot run in CI. It writes a committed
JSON file that build.py bakes into the page like any other data.
"""
import csv
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "src", "data")

snorm = lambda x: re.sub(r"[^a-z0-9 ]", "", re.sub(r"^(the|a)\s+", "", str(x).lower())).strip()
tnorm = lambda x: snorm(re.sub(r"\s*\(.*?\)", "", str(x)))
stem = lambda x: re.sub(r"s$", "", tnorm(x))
aname = lambda a: re.sub(r"\s+", " ", str(a)).strip()


def load(name):
    with open(os.path.join(DATA, f"{name}.json"), encoding="utf-8") as f:
        return json.load(f)


def storygraph_unrated(rated):
    """Books StoryGraph has on the read shelf with no star."""
    out = []
    for fn in os.listdir(ROOT):
        if not (fn.startswith("storygraph") and fn.endswith(".csv")):
            continue
        with open(os.path.join(ROOT, fn), encoding="utf-8", newline="") as f:
            for row in csv.DictReader(f):
                if (row.get("Read Status") or "").strip() != "read":
                    continue
                if (row.get("Star Rating") or "").strip():
                    continue
                if stem(row["Title"]) in rated:
                    continue
                out.append({"t": row["Title"].strip(),
                            "a": aname(row.get("Authors") or ""), "why": "read"})
    seen, ded = set(), []
    for x in out:
        if stem(x["t"]) in seen:
            continue
        seen.add(stem(x["t"]))
        ded.append(x)
    return ded


def series_gaps(all_series, rated):
    """Unrated volumes with rated volumes on both sides."""
    out = []
    for entry in all_series.values():
        vols = entry.get("vols") or []
        flags = [stem(v["t"]) in rated for v in vols]
        if not any(flags):
            continue
        lo, hi = flags.index(True), len(flags) - 1 - flags[::-1].index(True)
        for i in range(lo, hi):
            if not flags[i]:
                out.append({"t": vols[i]["t"], "a": "", "ser": entry["name"],
                            "ord": vols[i].get("ord"), "why": "gap"})
    return out


def blocked(books, ratings):
    """Ratings that cannot become library records for want of an author."""
    have = {stem(b["t"]) for b in books}
    known = set()
    for fn in ("library_backup.csv", *[f for f in os.listdir(ROOT)
                                       if f.startswith("storygraph") and f.endswith(".csv")]):
        p = os.path.join(ROOT, fn)
        if not os.path.exists(p):
            continue
        with open(p, encoding="utf-8", newline="") as f:
            known |= {stem(r["Title"]) for r in csv.DictReader(f)}
    tagged_series = {snorm(b["ser"]) for b in books if b.get("ser")}
    out = []
    for title in ratings:
        if stem(title) in have or stem(title) in known:
            continue
        out.append({"t": title, "a": "", "why": "blocked"})
    return out


def main():
    write = "--write" in sys.argv[1:]
    books, allser = load("books"), load("all_series")
    ratings = (load("ratings") or {}).get("ratings") or {}
    rated = {stem(t) for t in ratings} | {stem(b["t"]) for b in books if b["r"]}

    q = {"read": storygraph_unrated(rated),
         "gap": series_gaps(allser, rated),
         "blocked": blocked(books, ratings)}
    for k, v in q.items():
        print(f"  {k:<9}{len(v):>4}")
    print(f"  {'total':<9}{sum(len(v) for v in q.values()):>4}")
    if not write:
        print("\ndry run — pass --write to apply")
        return
    with open(os.path.join(DATA, "needs_input.json"), "w", encoding="utf-8") as f:
        json.dump(q, f, ensure_ascii=False, separators=(",", ":"))
    print("wrote src/data/needs_input.json — next: python3 build.py")


if __name__ == "__main__":
    main()
