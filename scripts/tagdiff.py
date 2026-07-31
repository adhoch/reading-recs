#!/usr/bin/env python3
"""
Compare an independent tagging run against this repo's tags.

  python3 scripts/tagdiff.py other.json
  python3 scripts/tagdiff.py anchored.json unanchored.json

Inter-rater agreement, per axis and per facet, against tagging-my-answers.json.

Two rater-agreement measures, because the two layers need different ones:

  axes    mean absolute difference on a 1-5 scale, plus correlation. MAD says
          how far apart the raters are; correlation says whether they rank the
          books the same way even if one runs consistently high.
  facets  Jaccard overlap on the multi-valued fields, exact match on the
          single-valued ones. A facet has no scale to drift on, so distance
          means set overlap.

Given two files, the second is treated as the unanchored condition and the
gap between them is reported. That gap is the measurement worth having: the
calibration anchors cover all seven axes and none of the facets, so anything
the anchors are propping up shows as axis agreement collapsing without them
while facet agreement stays put.
"""
import json
import sys

AXES = ["velocity", "friction", "interiority", "darkness",
        "romance_load", "prose_shine", "formula"]
MULTI = ["engine_alt", "milieu", "system", "institution", "cast", "mode"]
SINGLE = ["engine", "status"]


def load(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def norm(t):
    return "".join(c for c in str(t).lower() if c.isalnum() or c == " ").strip()


def compare(mine, other, label):
    idx = {norm(k): v for k, v in other.items()}
    pairs = [(v, idx[norm(k)]) for k, v in mine.items() if norm(k) in idx]
    if not pairs:
        print(f"  {label}: no titles matched — check the keys came back verbatim")
        return None
    print(f"\n  {label}  ({len(pairs)} of {len(mine)} books matched)")
    print(f"    {'axis':<16}{'mean abs diff':>15}{'corr':>8}{'exact':>8}")
    scores = {}
    for i, ax in enumerate(AXES):
        d = [(a["ax"][i] if "ax" in a else a[ax], b.get(ax)) for a, b in pairs]
        d = [(x, y) for x, y in d if isinstance(y, (int, float))]
        if len(d) < 5:
            continue
        mad = sum(abs(x - y) for x, y in d) / len(d)
        ex = sum(1 for x, y in d if x == y) / len(d)
        mx = sum(x for x, _ in d) / len(d)
        my = sum(y for _, y in d) / len(d)
        sx = (sum((x - mx) ** 2 for x, _ in d) / len(d)) ** .5
        sy = (sum((y - my) ** 2 for _, y in d) / len(d)) ** .5
        r = (sum((x - mx) * (y - my) for x, y in d) / len(d) / (sx * sy)) if sx and sy else float("nan")
        scores[ax] = mad
        print(f"    {ax:<16}{mad:>15.2f}{r:>8.2f}{ex:>7.0%}")
    print(f"    {'-- mean --':<16}{sum(scores.values())/len(scores):>15.2f}")
    print(f"\n    {'facet':<16}{'overlap':>15}")
    fac = {}
    for k in MULTI:
        v = []
        for a, b in pairs:
            s1, s2 = set(a.get(k) or []), set(b.get(k) or [])
            v.append(1.0 if not s1 and not s2 else len(s1 & s2) / max(1, len(s1 | s2)))
        fac[k] = sum(v) / len(v)
        print(f"    {k:<16}{fac[k]:>14.0%}")
    for k in SINGLE:
        v = sum(1 for a, b in pairs if (a.get(k) or "") == (b.get(k) or "")) / len(pairs)
        fac[k] = v
        print(f"    {k:<16}{v:>14.0%}")
    print(f"    {'-- mean --':<16}{sum(fac.values())/len(fac):>14.0%}")
    return {"axis_mad": sum(scores.values()) / len(scores),
            "facet": sum(fac.values()) / len(fac), "per_axis": scores}


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    mine = load("tagging-my-answers.json")
    a = compare(mine, load(sys.argv[1]), "anchored" if len(sys.argv) > 2 else sys.argv[1])
    if len(sys.argv) > 2:
        b = compare(mine, load(sys.argv[2]), "unanchored")
        if a and b:
            print("\n  what the anchors are worth")
            print(f"    axis disagreement   {a['axis_mad']:.2f} anchored "
                  f"-> {b['axis_mad']:.2f} unanchored   ({b['axis_mad']-a['axis_mad']:+.2f})")
            print(f"    facet agreement     {a['facet']:.0%} -> {b['facet']:.0%}   "
                  f"({b['facet']-a['facet']:+.0%})")
            print("\n    Facets carry no anchors, so their agreement should barely move.")
            print("    If it does, the two runs differ for some reason other than")
            print("    calibration and the comparison is not clean.")


if __name__ == "__main__":
    main()
