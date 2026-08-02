#!/usr/bin/env python3
"""Fold hand-looked-up bibliographies into all_series.json.

  python3 scripts/addseries.py            report
  python3 scripts/addseries.py --write    apply

allseries.py cannot do this job any more: it reads series_wd.json and
isfdb_cache.json, offline scrape caches that were never committed. So the
series the library holds books from but has no bibliography for get filled from
scripts/series_web.json instead, and are tagged src="web" so a later ISFDB pass
can tell them apart.

Only fills gaps. A series that already has an entry keeps it, because the
scraped bibliographies carry ordinals and edition detail this file does not.
"""
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "src", "data")
WEB = os.path.join(os.path.dirname(os.path.abspath(__file__)), "series_web.json")

snorm = lambda x: re.sub(r"[^a-z0-9 ]", "", re.sub(r"^(the|a|an)\s+", "", str(x).lower())).strip()


def main():
    write = "--write" in sys.argv[1:]
    with open(os.path.join(DATA, "all_series.json"), encoding="utf-8") as f:
        allser = json.load(f)
    with open(os.path.join(DATA, "books.json"), encoding="utf-8") as f:
        books = json.load(f)
    with open(WEB, encoding="utf-8") as f:
        web = {k: v for k, v in json.load(f).items() if k != "_note"}

    have_keys = set(allser)
    have_names = {snorm(e["name"]) for e in allser.values()}
    added, skipped = [], []
    for key, spec in web.items():
        if key in have_keys or snorm(spec["name"]) in have_names:
            skipped.append(spec["name"])
            continue
        held = [b for b in books if b.get("ser") and snorm(b["ser"]) == key]
        rated = [b for b in held if b["r"]]
        entry = {"name": spec["name"], "src": spec.get("src", "web"),
                 "rated": len(rated),
                 "mean": round(sum(b["r"] for b in rated) / len(rated), 2) if rated else None,
                 "vols": [{"t": t, "ord": i + 1} for i, t in enumerate(spec["vols"])]}
        allser[key] = entry
        added.append((spec["name"], len(spec["vols"]), len(held)))

    print(f"{len(allser) - len(added)} existing series, {len(added)} added\n")
    for name, n, held in sorted(added, key=lambda r: -r[2]):
        print(f"  {name:<30}{n:>3} volumes   you hold {held}")
    if skipped:
        print(f"\n  already present, left alone: {', '.join(skipped)}")

    # what is still missing, so the gap stays visible
    keys, names = set(allser), {snorm(e["name"]) for e in allser.values()}
    gap = {snorm(b["ser"]) for b in books
           if b.get("ser") and snorm(b["ser"]) not in keys and snorm(b["ser"]) not in names}
    print(f"\n{len(gap)} series still without a bibliography")
    if not write:
        print("dry run — pass --write to apply")
        return
    with open(os.path.join(DATA, "all_series.json"), "w", encoding="utf-8") as f:
        json.dump(allser, f, ensure_ascii=False, separators=(",", ":"))
    print("wrote src/data/all_series.json — next: python3 build.py")


if __name__ == "__main__":
    main()
