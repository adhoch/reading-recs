#!/usr/bin/env python3
"""
Rebuild the series bibliographies with only the novels in them.

  python3 scripts/series_clean.py            report, write nothing
  python3 scripts/series_clean.py --write    rewrite src/data/all_series.json
  python3 scripts/series_clean.py --only "black company"   one series, for checking

The shipped lists were assembled without asking either source what kind of thing
each entry was, and it shows:

  American Gods   26 Starz episodes, 3 seasons and a series finale, because
                  Wikidata's P179 ("part of the series") is not type-filtered and
                  the TV show shares the name.
  Black Company   four omnibus editions listed beside the novels they contain,
                  plus nine short stories.
  Dark Tower      an excerpt, a preview, a picture book, and the four novellas
                  that were later assembled into The Gunslinger.

Both sources can answer the question; neither was asked.

  ISFDB  annotates each series entry: [SF] short fiction, [C] collection,
         [A] anthology, [O/10N] omnibus of ten novels. Unmarked is a novel.
  Wikidata  types every item with P31, so episodes, seasons, short stories,
         comics and collections can all be excluded by class.
"""
import json
import os
import re
import sys
import time

import requests

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "src", "data")
H = {"User-Agent": "reading-taxonomy/1.0 (personal reading project)"}
PAUSE = 1.2

# ISFDB bracket codes that mean "not a novel". The letter before any slash is the
# record type: O/10N is an omnibus of ten novels, SF is short fiction.
ISFDB_DROP = re.compile(r"^(SF|C|A|O|G|NF|ES|POE|SER|COV|INT|REV)\b")

# Neither source distinguishes a book from a repackaging of one, so excerpts,
# annotated reissues and anniversary editions arrive looking like novels.
JUNK = re.compile(
    r"\bexcerpt\b|\bpreview\b|\bannotated\b|anniversary edition|\bomnibus\b|"
    r"\bboxed set\b|\bcollection\b|\bcompanion\b|\bthe art of\b|\bcolou?ring\b|"
    r"\bgraphic novel\b|\bepisode\b|\bseason \d|\(part \d+ of \d+\)|\bsampler\b|"
    # ISFDB files the endpaper maps as their own series entries, which is how
    # Wheel of Time came back with twelve of them.
    r"\(maps?\)|\bmap\b|"
    # UK split paperbacks: A Storm of Swords is one novel published as two
    # halves under four different title forms.
    r":\s*part\s|\bpart (one|two|three)\b|\bvolume (one|two|three)\b",
    re.I)

# Wikidata classes. An item carries several P31s, so a single disqualifying class
# is enough to drop it and a single qualifying class is enough to keep it.
WD_KEEP = {
    "Q8261": "novel", "Q7725634": "literary work", "Q47461344": "written work",
    "Q571": "book", "Q149537": "novella", "Q17518870": "novel series entry",
}
WD_DROP = {
    "Q21191270": "television series episode", "Q3464665": "television series season",
    "Q5398426": "television series", "Q11424": "film", "Q49084": "short story",
    "Q1279564": "short story collection", "Q105420": "anthology",
    "Q1004": "comics", "Q725377": "graphic novel", "Q1760610": "comic book",
    "Q838795": "comic strip", "Q13593966": "literary series", "Q277759": "book series",
    "Q7889": "video game", "Q2143665": "series finale", "Q1983062": "episode",
}


def load(name):
    with open(os.path.join(DATA, f"{name}.json"), encoding="utf-8") as f:
        return json.load(f)


def snorm(s):
    return re.sub(r"[^a-z0-9 ]", "", re.sub(r"^(the|a)\s+", "", str(s).lower())).strip()


def isfdb_series_id(name):
    """ISFDB's series search returns nothing for "The Chronicles of the Black
    Company" and the right answer for "Chronicles of the Black Company", so the
    leading article is tried both ways. The first hit is not reliably the match
    either — searching Mistborn returns Cosmere first — so an exact name match
    wins when there is one."""
    variants = [name, re.sub(r"^(The|A)\s+", "", name)]
    for arg in dict.fromkeys(variants):
        try:
            r = requests.get("https://www.isfdb.org/cgi-bin/se.cgi",
                             params={"arg": arg, "type": "Series"}, headers=H, timeout=30)
        except Exception:
            continue
        time.sleep(PAUSE)
        if not r.ok:
            continue
        hits = [(i, n) for i, n in
                re.findall(r'pe\.cgi\?(\d+)"[^>]*>([^<]{2,70})</a>', r.text) if i != "0"]
        if not hits:
            continue
        for i, n in hits:
            if snorm(n) == snorm(name):
                return i
        return hits[0][0]
    return None


def isfdb_volumes(sid):
    """Every title on the series page, including the nested sub-series blocks,
    keeping only entries with no disqualifying type marker."""
    t = requests.get(f"https://www.isfdb.org/cgi-bin/pe.cgi?{sid}", headers=H, timeout=30).text
    # Entries are <li>-delimited; splitting on that keeps each title with the
    # bracket code and the "Translation:" marker that belong to it.
    kept, dropped = [], []
    for block in re.split(r"<li>", t):
        # "also appeared as" nests both translations and English variant titles.
        # Skipping only the first left Discworld holding The Colour of Magic and
        # The Color of Magic as separate volumes.
        if "title.cgi" not in block or re.search(r"Translation:|Variant Title:", block):
            continue
        m = re.search(r'<a class\s*=\s*"italic"\s+href="[^"]*title\.cgi\?\d+"[^>]*>'
                      r'([^<]+)</a>\s*\(<b>(\d{4})</b>\)', block)
        if not m:
            continue
        title, yr = m.group(1).strip(), m.group(2)
        ordm = re.match(r"\s*([\d.]+)\s*\n?\s*<a class", block)
        code = re.search(r"\(<b>\d{4}</b>\)\s*<b>\[([^\]]+)\]</b>", block)
        kind = code.group(1) if code else "NOVEL"
        rec = {"ord": ordm.group(1) if ordm else None, "t": title, "yr": yr}
        # A numbered entry is a volume whatever its internal form. ISFDB types
        # The Gunslinger as [C], a collection of the five novellas it was built
        # from — true, and it is still book one. In Dark Tower only the eight
        # real books carry a number, so the ordinal is the trustworthy signal.
        if JUNK.search(title):
            dropped.append((rec, "repackaging"))
        elif code and ISFDB_DROP.match(kind):
            # A number rescues a fix-up — The Gunslinger is [C] because it was
            # assembled from five novellas, and is still book one. It must not
            # rescue short fiction: ISFDB numbers the Dresden Files shorts too,
            # which put "A Restoration of Faith" on the shelf as a volume.
            if rec["ord"] and kind.startswith("C"):
                kept.append((rec, kind))
            else:
                dropped.append((rec, kind))
        else:
            kept.append((rec, kind))
    return kept, dropped


def wikidata_volumes(name):
    q = """SELECT ?l ?ord ?pub (GROUP_CONCAT(DISTINCT STRAFTER(STR(?type),
             "http://www.wikidata.org/entity/"); separator=",") AS ?types) WHERE {
        ?s rdfs:label "%s"@en . ?i wdt:P179 ?s . ?i wdt:P31 ?type .
        OPTIONAL{?i p:P179 ?st. ?st pq:P1545 ?ord}
        OPTIONAL{?i wdt:P577 ?pub}
        ?i rdfs:label ?l FILTER(lang(?l)="en")
      } GROUP BY ?l ?ord ?pub LIMIT 120""" % name.replace('"', '\\"')
    r = requests.get("https://query.wikidata.org/sparql",
                     params={"query": q, "format": "json"}, headers=H, timeout=45)
    if not r.ok:
        return None, None
    kept, dropped = [], []
    for b in r.json()["results"]["bindings"]:
        types = set(b["types"]["value"].split(","))
        rec = {"ord": b.get("ord", {}).get("value"),
               "t": b["l"]["value"], "yr": b.get("pub", {}).get("value", "")[:4]}
        bad = types & set(WD_DROP)
        if bad or not (types & set(WD_KEEP)):
            dropped.append((rec, ", ".join(WD_DROP.get(x, x) for x in (bad or types)) or "untyped"))
        else:
            kept.append((rec, "novel"))
    return kept, dropped


def vouched(vols, known_in_series):
    """Does this bibliography contain a book the library already files under this
    series? ISFDB's search falls back to its first hit when nothing matches the
    name exactly, which fetched Lukyanenko's Watch for Discworld's Night Watch,
    and a magazine called Tales of the Talisman for The Talisman. Containment
    rather than equality, so "Mistborn" still vouches for "Mistborn: The Final
    Empire"."""
    if not known_in_series:
        return True
    got = [snorm(v["t"]) for v in vols]
    return any(k == g or k in g or g in k for k in known_in_series for g in got)


def prefer_numbered(recs):
    """When a series numbers its own entries, the numbers are the whole answer.

    Discworld returns 57 numbered novels and 37 unnumbered extras: the US
    variant "The Color of Magic", illustrated editions, comic adaptations, stage
    plays, The Wit and Wisdom of Discworld. None of them carry a type code that
    marks them out, and all of them vanish on this one rule.

    The cost is real and worth naming: an unnumbered late novel goes too — Black
    Company loses Port of Shadows. Trading one novel for thirty-seven pieces of
    merchandise is the right side of that."""
    numbered = [r for r in recs if r["ord"]]
    if len(numbered) >= 5 and len(numbered) >= 0.4 * len(recs):
        return numbered, [r for r in recs if not r["ord"]]
    return recs, []


def known_titles():
    """Everything the library already calls a book, by normalised form."""
    known = {}
    for b in load("books"):
        known.setdefault(snorm(b["t"]), b["t"])
    try:
        for t in (load("ratings").get("ratings") or {}):
            known.setdefault(snorm(t), t)
    except Exception:
        pass
    return known


def reconcile_titles(vols, known, series):
    """Ratings join on title, so changing a volume's title silently detaches the
    rating from it. ISFDB calls the Mistborn books "The Final Empire" where
    Wikidata — and therefore seven of these ratings — says "Mistborn: The Final
    Empire". Same book, and the library's spelling is the one that has to win.
    Matched by stripping a "Series: " prefix from either side."""
    # snorm strips punctuation, so the split has to happen on the raw title —
    # by the time "Mistborn: The Final Empire" is normalised there is no colon
    # left to find.
    # Only when the prefix IS this series. Matching on the tail alone paired
    # Mistborn's "Secret History" with Mary Gentle's "Ash: A Secret History".
    by_tail = {}
    for orig in known.values():
        if ":" not in orig:
            continue
        head, tail = orig.split(":", 1)
        if snorm(head) == snorm(series):
            by_tail.setdefault(snorm(tail.strip()), orig)
    out = []
    for v in vols:
        k = snorm(v["t"])
        hit = known.get(k) or by_tail.get(k)
        if not hit and ":" in v["t"]:
            hit = known.get(snorm(v["t"].split(":", 1)[1].strip()))
        out.append({**v, "t": hit} if hit and hit != v["t"] else v)
    return out


def dedupe_reissues(vols):
    """An entry whose title extends a title already in the series is a repackaging
    of it: "A Storm of Swords: Steel and Snow" under "A Storm of Swords",
    "Artificial Condition: The Murderbot Diaries" under "Artificial Condition".
    Earliest publication wins, so the novel outlives its own reissues."""
    kept, shed = [], []
    have = set()
    for v in vols:
        base = snorm(v["t"].split(":")[0])
        if snorm(v["t"]) in have:
            shed.append((v, "duplicate"))
        elif ":" in v["t"] and base in have:
            shed.append((v, "reissue of " + v["t"].split(":")[0]))
        else:
            have.add(snorm(v["t"]))
            kept.append(v)
    return kept, shed


def order(vols):
    """Ordinals are reliable inside a flat series and meaningless across the
    nested sub-series ISFDB uses for Black Company, where every sub-series
    restarts at 1. Year is the tie-break and, when ordinals are absent or
    collide, the ordering — which for these series is also the reading order."""
    nums = [v["ord"] for v in vols if v["ord"]]
    usable = len(nums) == len(set(nums)) and len(nums) >= max(1, len(vols) // 2)
    def key(v):
        o = float(v["ord"]) if (usable and v["ord"]) else float("inf")
        return (o, v["yr"] or "9999")
    out = sorted(vols, key=key)
    if not usable:
        # Black Company's numbers restart inside every sub-book, so the shelf
        # would read #1 #2 #3 #1 #2 #3. Publication order is the real reading
        # order here; a wrong number is worse than none.
        for v in out:
            v["ord"] = None
    return out


def discover(allser, limit):
    """Series the library knows about but has no bibliography for.

    A shelf built from a single book carrying a `ser` field can only ever show
    that one book, which is why 1632 displayed nothing but 1633 and Discworld
    claimed to be complete on the strength of Small Gods. Ordered by how many
    volumes are actually rated, so the fetch budget goes where it is felt."""
    meta, books = load("meta"), load("books")
    want = {}
    for b in books:
        if b.get("ser"):
            want.setdefault(snorm(b["ser"]), b["ser"])
    for k, v in meta["series"].items():
        want.setdefault(k, v["name"])
    missing = [(k, v) for k, v in want.items() if k not in allser
               and meta["series"].get(k, {}).get("n", 0) >= 1]
    missing.sort(key=lambda kv: -meta["series"].get(kv[0], {}).get("n", 0))
    return missing[:limit]


def main():
    args = sys.argv[1:]
    write = "--write" in args
    only = None
    if "--only" in args:
        only = args[args.index("--only") + 1].lower()

    allser = load("all_series")
    known = known_titles()
    out, report = {}, []

    if "--discover" in args:
        i = args.index("--discover") + 1
        limit = int(args[i]) if i < len(args) and args[i].isdigit() else 200
        found = discover(allser, limit)
        series_titles = {}
        for b in load("books"):
            if b.get("ser"):
                series_titles.setdefault(snorm(b["ser"]), set()).add(snorm(b["t"]))
        print(f"{len(found)} series with ratings and no bibliography; fetching\n")
        added = 0
        for key, name in found:
            try:
                sid = isfdb_series_id(name)
                kept, dropped = isfdb_volumes(sid) if sid else ([], [])
                src = "ISFDB"
                if not kept:
                    kept, dropped = wikidata_volumes(name)
                    src = "Wikidata" if kept else None
                time.sleep(PAUSE)
            except Exception as exc:
                print(f"  ! {name[:34]:<36} {str(exc)[:44]}")
                continue
            if not kept:
                print(f"  - {name[:34]:<36} no match")
                continue
            recs, _un = prefer_numbered([r for r, _ in kept])
            vols, _ = dedupe_reissues(reconcile_titles(order(recs), known, name))
            allser[key] = {"name": name, "src": src, "vols": vols,
                           "mean": (load("meta")["series"].get(key) or {}).get("mean"),
                           "rated": (load("meta")["series"].get(key) or {}).get("n", 0)}
            added += 1
            print(f"  + {name[:34]:<36} {len(vols):>3} vols  [{src}] "
                  f"{', '.join(x['t'][:20] for x in vols[:3])}")
        print(f"\n{added} bibliographies added, {len(allser)} series total")
        if write:
            with open(os.path.join(DATA, "all_series.json"), "w", encoding="utf-8") as f:
                json.dump(allser, f, ensure_ascii=False, separators=(",", ":"))
            print("wrote src/data/all_series.json — next: python3 build.py")
        else:
            print("\ndry run — pass --write to apply")
        return

    for key, entry in allser.items():
        if only and only not in key and only not in entry["name"].lower():
            out[key] = entry
            continue
        name = entry["name"]
        kept = dropped = None
        src = None
        # ISFDB first for everything, whatever the list was originally built
        # from: it states the record type outright, where Wikidata types a Black
        # Company short story as "literary work" — true, and useless here.
        try:
            sid = isfdb_series_id(name)
            if sid:
                kept, dropped = isfdb_volumes(sid)
                src = "ISFDB"
                time.sleep(PAUSE)
        except Exception as exc:
            print(f"  ! {name} (ISFDB): {str(exc)[:60]}")
        if not kept:
            try:
                kept, dropped = wikidata_volumes(name)
                src = "Wikidata" if kept else None
                time.sleep(PAUSE)
            except Exception as exc:
                print(f"  ! {name} (Wikidata): {str(exc)[:60]}")

        if not kept:
            # Never trade a populated list for an empty one; a lookup that fails
            # or a series that is genuinely all short fiction keeps what it had.
            out[key] = entry
            report.append((name, entry.get("src"), len(entry["vols"]), len(entry["vols"]), []))
            continue

        recs, unnumbered = prefer_numbered([r for r, _ in kept])
        vols, shed = dedupe_reissues(reconcile_titles(order(recs), known, name))
        shed += [(r, "unnumbered extra") for r in unnumbered]
        out[key] = {**entry, "vols": vols, "src": src}
        dropped = (dropped or []) + shed
        report.append((name, src, len(entry["vols"]), len(vols),
                       [(r["t"], k) for r, k in (dropped or [])]))

    print(f"{'series':<34}{'src':<12}{'was':>5}{'now':>5}  dropped")
    total_dropped = 0
    for name, src, was, now, drops in sorted(report, key=lambda x: x[2] - x[3], reverse=True):
        total_dropped += len(drops)
        note = ", ".join(f"{t[:26]} [{k}]" for t, k in drops[:3])
        if len(drops) > 3:
            note += f", +{len(drops)-3} more"
        print(f"  {name[:32]:<32}{str(src):<12}{was:>5}{now:>5}  {note}")
    print(f"\n{total_dropped} entries dropped across {len(report)} series")

    if not write:
        print("\ndry run — pass --write to apply")
        return
    with open(os.path.join(DATA, "all_series.json"), "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    print("wrote src/data/all_series.json — next: python3 build.py")


if __name__ == "__main__":
    main()
