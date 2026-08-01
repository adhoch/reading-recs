#!/usr/bin/env python3
"""Split the two clusters that were holding several registers at once.

  python3 scripts/resplit.py            report
  python3 scripts/resplit.py --write    rewrite books.json + graph.json

Why only two. The top-level pass in clusters.py uses greedy modularity, which
has a resolution limit: it cannot see communities below a size threshold and
merges them. Measured on the subgraph induced by each cluster, using the same
weights and the same K=4 sparsification, EVERY one of the eleven splits further
(Q from 0.33 to 0.60, stable across K=3..6). Forty of the forty-five resulting
sub-communities are mixed-author, so this is real structure and not the layout
lumping series together.

Splitting all eleven would give ~40 groups, which is more than the label
vocabulary can name apart -- two Puzzle-Box SF sub-groups both come out as
"mystery-box, technological, cosmic-weird". So this splits the two with the
highest internal modularity, whose parts happen to be the cleanly nameable ones.

Colour. Nineteen groups is far past what hue can carry, so siblings keep their
parent's colour and are told apart by their own outline and their own name --
`fam` on each cluster indexes CLUSTER_COLORS. That leaves the eleven validated
hues untouched rather than inventing eight more that would fail the checks.
"""
import itertools
import json
import os
import sys
from collections import Counter

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "src", "data")

FAC = [("mi", 1.0), ("sy", 1.5), ("in", 1.25), ("ca", 1.0), ("mo", 1.0)]
KNN = 4      # clusters.py sparsifies to the 4 strongest neighbours
MIN = 4      # a group smaller than this cannot hold a label on the canvas

# Names are keyed by a member that identifies the group beyond doubt. If a
# re-run moves that book the script stops rather than mislabelling a group.
NAMES = {
    "Epic Campaigns": [
        ("The Way of Kings",     "Epic Campaigns"),
        ("The Bone Ships",       "Weird Campaigns"),
        ("The Guns of the South", "Alternate-History Military"),
        ("The Black Company",    "The Black Company"),
        ("On Basilisk Station",  "Military SF"),
    ],
    "Mythic Journeys": [
        ("American Gods",        "Hidden Doors"),
        ("Kings of the Wyld",    "Sellsword Errands"),
        ("The Dark Tower",       "Grail Quests"),
        ("Elder Race",           "Wry Odysseys"),
        ("The Color of Magic",   "Comic Fantasy"),
        ("The Sword of Shannara", "Doorstopper Quests"),
    ],
}


def wt(a, c):
    w = 2.0 if a["en"] == c["en"] else 0.0
    for k, x in FAC:
        w += x * len(set(a.get(k, [])) & set(c.get(k, [])))
    return w


def modularity(W, parts):
    m2 = W.sum()
    if m2 <= 0:
        return 0.0
    k = W.sum(axis=1)
    return sum(W[np.ix_(list(p), list(p))].sum() / m2 - (k[list(p)].sum() / m2) ** 2
               for p in parts)


def greedy_communities(W):
    """Agglomerative CNM. n is under 60, so modularity is recomputed outright on
    every candidate merge and there is no gain approximation to get wrong."""
    parts = [{i} for i in range(len(W))]
    q = modularity(W, parts)
    while len(parts) > 1:
        best, bq = None, q
        for a, b in itertools.combinations(range(len(parts)), 2):
            if W[np.ix_(list(parts[a]), list(parts[b]))].sum() <= 0:
                continue
            trial = [p for i, p in enumerate(parts) if i not in (a, b)] + [parts[a] | parts[b]]
            tq = modularity(W, trial)
            if tq > bq + 1e-12:
                best, bq = (a, b), tq
        if best is None:
            break
        a, b = best
        parts = [p for i, p in enumerate(parts) if i not in (a, b)] + [parts[a] | parts[b]]
        q = bq
    return sorted(parts, key=len, reverse=True), q


def sparsify(W, k=KNN):
    n = len(W)
    S = np.zeros_like(W)
    for i in range(n):
        for j in np.argsort(-W[i])[:k]:
            j = int(j)
            if i != j and W[i, j] > 0:
                S[i, j] = S[j, i] = W[i, j]
    return S


def self_test():
    """Two 6-cliques joined by one edge. The answer is 2 groups at Q ~ 0.47."""
    W = np.zeros((12, 12))
    for a, b in itertools.combinations(range(6), 2):
        W[a, b] = W[b, a] = 1
    for a, b in itertools.combinations(range(6, 12), 2):
        W[a, b] = W[b, a] = 1
    W[0, 6] = W[6, 0] = 1
    parts, q = greedy_communities(W)
    ok = sorted(len(p) for p in parts) == [6, 6] and q > 0.35
    print(f"detector self-test: {sorted(len(p) for p in parts)} Q={q:.3f} "
          f"-> {'PASS' if ok else 'FAIL'}")
    return ok


def split(books, cl_id, label):
    idx = [i for i, x in enumerate(books) if x.get("cl") == cl_id]
    n = len(idx)
    W = np.zeros((n, n))
    for a, c in itertools.combinations(range(n), 2):
        W[a, c] = W[c, a] = wt(books[idx[a]], books[idx[c]])
    S = sparsify(W)
    parts, q = greedy_communities(S)

    # Fold anything too small to carry a label into the sibling it is most
    # strongly tied to, so no group is created that the canvas cannot name.
    parts = sorted(parts, key=len, reverse=True)
    while len(parts) > 1 and len(parts[-1]) < MIN:
        small = parts.pop()
        best = max(range(len(parts)),
                   key=lambda j: S[np.ix_(list(small), list(parts[j]))].sum())
        titles = sorted(books[idx[i]]["t"] for i in small)
        print(f"    folded {len(small)} books into part {best}: {', '.join(titles[:4])}")
        parts[best] |= small
        parts = sorted(parts, key=len, reverse=True)

    named = []
    for p in parts:
        titles = {books[idx[i]]["t"] for i in p}
        hit = [nm for anchor, nm in NAMES[label] if anchor in titles]
        if len(hit) != 1:
            sys.exit(f"cannot name a {len(p)}-book part of {label} "
                     f"({len(hit)} anchors matched). Re-run the report and "
                     f"update NAMES before writing.")
        named.append((hit[0], [idx[i] for i in p]))
    print(f"  {label}: Q={q:.3f} -> {len(named)} groups")
    for nm, mem in named:
        eng = Counter(books[i]["en"] for i in mem).most_common(1)[0]
        auth = len({books[i].get("a") for i in mem})
        print(f"    {nm:<28}{len(mem):>3} books  {auth:>2} authors  "
              f"{eng[0]} {eng[1]}/{len(mem)}")
    return named


def main():
    write = "--write" in sys.argv[1:]
    if not self_test():
        sys.exit("detector is wrong; results would be meaningless")
    books = json.load(open(os.path.join(DATA, "books.json"), encoding="utf-8"))
    graph = json.load(open(os.path.join(DATA, "graph.json"), encoding="utf-8"))
    clusters = graph["clusters"]
    by_label = {c["label"]: c["id"] for c in clusters}

    out = []
    for c in clusters:
        out.append({**c, "fam": c["id"]})   # families keep the validated hues
    assign = {}

    for label in NAMES:
        if label not in by_label:
            sys.exit(f"no cluster named {label!r}; nothing to split")
        cid = by_label[label]
        for nm, mem in split(books, cid, label):
            if nm == label:
                new_id = cid                # the archetype keeps id and name
            else:
                new_id = len(out)
                out.append({"id": new_id, "label": nm, "n": len(mem),
                            "purity": round(100 * Counter(
                                books[i]["en"] for i in mem).most_common(1)[0][1] / len(mem)),
                            "fam": cid})
            for i in mem:
                assign[i] = new_id
        out[cid]["n"] = sum(1 for i in assign if assign[i] == cid)

    # A parent whose parts were all renamed keeps its id and no members, so the
    # empty shells are dropped and everything downstream is renumbered. Books
    # address clusters by id, so this has to remap `cl` and `fam` together.
    cl_of = {i: assign.get(i, b.get("cl")) for i, b in enumerate(books)}
    used = set(cl_of.values())
    live = [c for c in out if c["id"] in used]
    dropped = [c["label"] for c in out if c["id"] not in used]
    remap = {c["id"]: n for n, c in enumerate(live)}
    for c in live:
        c["fam"] = remap.get(c["fam"], remap[c["id"]])
        c["id"] = remap[c["id"]]

    print(f"\n{len(clusters)} groups -> {len(live)} groups, "
          f"{len(assign)} books reassigned")
    if dropped:
        print(f"  dropped empty: {', '.join(dropped)}")
    fams = {}
    for c in live:
        fams.setdefault(c["fam"], []).append(c["label"])
    for f, kids in sorted(fams.items()):
        if len(kids) > 1:
            print(f"  one colour shared by: {', '.join(kids)}")
    if not write:
        print("dry run — pass --write to apply")
        return
    for i, b in enumerate(books):
        b["cl"] = remap[cl_of[i]]
    out = live
    for c in out:
        c["n"] = sum(1 for b in books if b.get("cl") == c["id"])
    graph["clusters"] = out
    json.dump(books, open(os.path.join(DATA, "books.json"), "w", encoding="utf-8"),
              ensure_ascii=False)
    json.dump(graph, open(os.path.join(DATA, "graph.json"), "w", encoding="utf-8"),
              ensure_ascii=False, separators=(",", ":"))
    print("wrote books.json + graph.json — next: python3 build.py")


if __name__ == "__main__":
    main()
