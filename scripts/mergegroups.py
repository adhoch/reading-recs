#!/usr/bin/env python3
"""Merge two groups that turned out to be one.

  python3 scripts/mergegroups.py            report
  python3 scripts/mergegroups.py --write    apply

resplit.py cut Mythic Journeys into six. One of those cuts was wrong: Hidden
Doors and Grail Quests are the same register, and the tell is not the
modularity (a mere +0.004) but that **the Dark Tower ends up in both** — The
Gunslinger in one, the other six volumes in the other. A series straddling two
categories is a defect whatever the score says.

Two other pairs looked nested by facet affinity and were left alone, because
merging them makes the partition measurably worse:

  Sellsword Errands + Doorstopper Quests   Q -0.0008
  Weird Campaigns + The Black Company      Q -0.0008
  Hidden Doors + Grail Quests              Q +0.0038   <- this one

Affinity and modularity disagreed on the first two; modularity is the measure
the clustering optimises, so it wins.

Ids are renumbered afterwards and `fam` is remapped with them, since books
address clusters by id.
"""
import json
import os
import sys
from collections import Counter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "src", "data")

# (absorbed, survivor). The survivor keeps its name.
MERGES = [("Grail Quests", "Hidden Doors")]


def main():
    write = "--write" in sys.argv[1:]
    with open(os.path.join(DATA, "books.json"), encoding="utf-8") as f:
        books = json.load(f)
    with open(os.path.join(DATA, "graph.json"), encoding="utf-8") as f:
        graph = json.load(f)
    clusters = graph["clusters"]
    by_label = {c["label"]: c["id"] for c in clusters}

    moved = 0
    for absorbed, survivor in MERGES:
        if absorbed not in by_label or survivor not in by_label:
            sys.exit(f"no group named {absorbed!r} or {survivor!r}")
        a, s = by_label[absorbed], by_label[survivor]
        n = sum(1 for b in books if b.get("cl") == a)
        for b in books:
            if b.get("cl") == a:
                b["cl"] = s
        moved += n
        print(f"  {absorbed} ({n} books) -> {survivor}")

    live = [c for c in clusters if any(b.get("cl") == c["id"] for b in books)]
    remap = {c["id"]: i for i, c in enumerate(live)}
    for c in live:
        c["fam"] = remap.get(c["fam"], remap[c["id"]])
        c["id"] = remap[c["id"]]
    for b in books:
        b["cl"] = remap[b["cl"]]
    for c in live:
        c["n"] = sum(1 for b in books if b.get("cl") == c["id"])
        mem = [b for b in books if b.get("cl") == c["id"]]
        if mem:
            top = Counter(b["en"] for b in mem).most_common(1)[0]
            c["purity"] = round(100 * top[1] / len(mem))

    print(f"\n{len(clusters)} groups -> {len(live)}, {moved} books reassigned")
    if not write:
        print("dry run — pass --write to apply")
        return
    graph["clusters"] = live
    with open(os.path.join(DATA, "books.json"), "w", encoding="utf-8") as f:
        json.dump(books, f, ensure_ascii=False, separators=(",", ":"))
    with open(os.path.join(DATA, "graph.json"), "w", encoding="utf-8") as f:
        json.dump(graph, f, ensure_ascii=False, separators=(",", ":"))
    print("wrote books.json + graph.json — next: python3 build.py")


if __name__ == "__main__":
    main()
