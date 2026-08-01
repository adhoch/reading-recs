#!/usr/bin/env python3
"""Add unread, tagged books so sparse registers have something to recommend.

  python3 scripts/addrecs.py            report what would happen, write nothing
  python3 scripts/addrecs.py --write    apply it

promote.py is the wrong tool for this: it walks ratings.json, so it can only
file books that have been READ. Seven groups had nothing unread in them at all
-- Comic Fantasy, Doorstopper Quests and The Black Company had zero, because
they are the registers that were read through, which is exactly why they were
dense enough to split out in the first place. A group with nothing to recommend
is a hole in the map, not a finding.

Everything else is borrowed from promote.py rather than reimplemented: the same
edge weights, the same four-strongest-links rule, the same inherit-the-cluster-
from-your-strongest-neighbour so adding a book never reshuffles what is already
on screen, and the same scoring from the committed model.

These carry hand tags from one rater. tagging-schema.md records that a single
pass drifts on obscure books, so the list is deliberately confined to titles
well-known enough to tag reliably, and the tags are honest rather than
flattering -- The Once and Future King is tagged velocity 2, which the model
will duly score as a poor fit. Filling a region with books that would be liked
is not the goal; filling it with books that genuinely belong there is.
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from promote import DATA, edge_weight, load, save, score, snorm  # noqa: E402

RECS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "recs.json")
FACET_KEYS = ["mi", "sy", "in", "ca", "mo", "ea"]


def main():
    write = "--write" in sys.argv[1:]
    with open(RECS, encoding="utf-8") as f:
        specs = {k: v for k, v in json.load(f).items() if k != "_note"}
    books, graph, model = load("books"), load("graph"), load("model")
    labels = {c["id"]: c["label"] for c in graph["clusters"]}
    have = {snorm(b["t"]) for b in books}
    rated = {snorm(t) for t in (load("ratings") or {}).get("ratings", {})}

    new = []
    for title, spec in specs.items():
        if snorm(title) in have:
            print(f"  = {title[:44]:<46} already in the library")
            continue
        if snorm(title) in rated:
            print(f"  = {title[:44]:<46} already rated — that is a read, not a rec")
            continue
        rec = {"t": title, "a": spec["a"], "r": 0, "ax": spec["ax"], "en": spec["en"],
               "st": spec.get("st", "standalone"), "cpace": None}
        if spec.get("ser"):
            rec["ser"] = spec["ser"]
        for k in FACET_KEYS:
            rec[k] = spec.get(k, [])
        rec["praw"], rec["p"] = score(rec["ax"], rec["cpace"], model)
        rec["weber_risk"] = rec["ax"][5] <= 2 and rec["ax"][6] >= 4
        new.append(rec)

    if not new:
        print("\nnothing to add")
        return

    start = len(books)
    books.extend(new)
    added_edges = 0
    for i in range(start, len(books)):
        scored = sorted(((edge_weight(books[i], books[j]), j) for j in range(len(books))
                         if j != i and books[j].get("ax")), reverse=True)
        best = [(w, j) for w, j in scored if w > 0][:4]
        for w, j in best:
            graph["edges"].append([min(i, j), max(i, j), round(w, 2)])
            added_edges += 1
        home = next((j for w, j in scored if w > 0 and "cl" in books[j]), None)
        books[i]["cl"] = books[home]["cl"] if home is not None else len(graph["clusters"])

    print(f"\n  {'title':<40}{'fit':>5}  lands in")
    for rec in new:
        print(f"  {rec['t'][:38]:<40}{rec['p']:>5}  {labels.get(rec['cl'], '?')}")
    print(f"\n{len(new)} recommendations, {added_edges} edges")
    if not write:
        print("dry run — pass --write to apply")
        return
    for c in graph["clusters"]:
        c["n"] = sum(1 for b in books if b.get("cl") == c["id"])
    save("books", books, compact=True)
    save("graph", graph, compact=True)
    print("wrote books.json + graph.json — next: python3 build.py")


if __name__ == "__main__":
    main()
