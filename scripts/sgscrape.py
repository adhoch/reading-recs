import json, os, re, sys, unicodedata, urllib.parse
from concurrent.futures import ThreadPoolExecutor
from playwright.sync_api import sync_playwright

UA = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")
CACHE = "sg_cache.json"
cache = json.load(open(CACHE)) if os.path.exists(CACHE) else {}


def norm(s):
    s = unicodedata.normalize("NFKD", str(s)).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9 ]", "", re.sub(r"\s*\(.*?\)", "", s)).strip()


def surname(a):
    a = re.sub(r"\s*&.*$", "", str(a))
    return norm(a).split()[-1] if norm(a).split() else ""


def find_id(pg, title, author):
    """Search StoryGraph and return the UUID whose title+author best matches."""
    # Percent-encoded, not just space-substituted: "The City & the City" put a
    # bare ampersand in the query string, which ended search_term early and
    # returned no match for a book StoryGraph has.
    q = urllib.parse.quote_plus(f"{title} {author}".strip())
    pg.goto(f"https://app.thestorygraph.com/browse?search_term={q}",
            wait_until="domcontentloaded", timeout=90000)
    try:   # real results are UUID hrefs; /books/new is the "add book" link
        pg.wait_for_function(
            "() => [...document.querySelectorAll('a[href*=\"/books/\"]')]"
            ".some(a => /\\/books\\/[0-9a-f-]{36}/.test(a.getAttribute('href')||''))",
            timeout=20000)
    except Exception:
        pass
    pg.wait_for_timeout(600)
    # the title/author text lives a few levels up; walk outward until we have real text
    cards = pg.evaluate("""() => [...document.querySelectorAll('a[href*="/books/"]')]
        .map(a => {
            let n = a, txt = '';
            for (let i = 0; i < 5 && n; i++) {
                n = n.parentElement;
                if (n && n.innerText && n.innerText.trim().length > 12) { txt = n.innerText; break; }
            }
            return {href: a.getAttribute('href'), txt: txt.slice(0, 300)};
        }).filter(c => c.txt)""")
    tn, sn = norm(title), surname(author)
    scored = []
    seen = set()
    for c in cards:
        m = re.search(r"/books/([0-9a-f-]{36})", c["href"] or "")
        if not m or m.group(1) in seen:
            continue
        seen.add(m.group(1))
        t = norm(c["txt"])
        sc = 0
        if tn and tn in t:
            sc += 2
        if sn and sn in t:
            sc += 1
        if sc >= 2:
            scored.append((sc, m.group(1)))
    scored.sort(key=lambda x: -x[0])
    return [i for _, i in scored[:2]]


def pct(block, label):
    m = re.search(rf"(\d+)%\s+\d+% of readers chose {label}", block, re.I)
    return int(m.group(1)) if m else None


def stats(pg, bid):
    url = f"https://app.thestorygraph.com/books/{bid}/community_reviews"
    t = ""
    for attempt in range(2):
        pg.goto(url, wait_until="domcontentloaded", timeout=90000)
        for _ in range(12):
            pg.wait_for_timeout(1000)
            t = pg.inner_text("body")
            if "of readers chose" in t or "based on" in t:
                break
        if "of readers chose" in t:
            break
        pg.wait_for_timeout(1500)   # brief cool-down, then one reload
    out = {"id": bid}
    m = re.search(r"([\d.]+)\s*\n\s*based on ([\d,]+) review", t)
    if m:
        out["avg"] = float(m.group(1))
        out["nrev"] = int(m.group(2).replace(",", ""))
    moods = dict(re.findall(r"([a-z]+):\s*(\d+)%", t))
    out["moods"] = {k: int(v) for k, v in moods.items()}
    for k in ("fast", "medium", "slow"):
        out["pace_" + k] = pct(t, k)
    for k, lab in (("plot", "Plot"), ("mix", "A mix"), ("char", "Character")):
        out["drive_" + k] = pct(t, lab)
    m = re.search(r"Strong character development\?(.*?)(?:Loveable|$)", t, re.S)
    if m:
        out["strongdev_yes"] = pct(m.group(1), "Yes")
    m = re.search(r"Flaws of characters a main focus\?(.*?)$", t, re.S)
    if m:
        out["flaws_yes"] = pct(m.group(1), "Yes")
    return out


def worker(chunk):
    got = {}
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_context(user_agent=UA).new_page()
        for title, author in chunk:
            key = f"{title}|{author}"
            try:
                cands = find_id(pg, title, author)
                best = stats(pg, cands[0]) if cands else {"error": "no match"}
                # a low review count means we landed on a minor edition;
                # title-only search usually surfaces the canonical one
                if (best.get("nrev") or 0) < 400:
                    alt = find_id(pg, title, "")
                    if alt:
                        st = stats(pg, alt[0])
                        if (st.get("nrev") or 0) > (best.get("nrev") or 0):
                            best = st
                got[key] = best
                with open("sg_rows.jsonl", "a") as f:      # crash-safe incremental write
                    f.write(json.dumps({"k": key, "v": best}) + "\n")
                pg.wait_for_timeout(400)
            except Exception as e:
                got[key] = {"error": str(e)[:70]}
                with open("sg_rows.jsonl", "a") as f:
                    f.write(json.dumps({"k": key, "v": got[key]}) + "\n")
        b.close()
    return got


if __name__ == "__main__":
    books = json.load(open(sys.argv[1]))
    done = set()
    if os.path.exists("sg_rows.jsonl"):
        done = {json.loads(l)["k"] for l in open("sg_rows.jsonl")}
    todo = [(b["t"], b["a"]) for b in books if f"{b['t']}|{b['a']}" not in done]
    if len(sys.argv) > 2:
        todo = todo[: int(sys.argv[2])]
    print(f"fetching {len(todo)} ({len(cache)} cached)", flush=True)
    W = 2
    chunks = [todo[i::W] for i in range(W)]
    with ThreadPoolExecutor(W) as ex:
        for r in ex.map(worker, chunks):
            cache.update(r)
    json.dump(cache, open(CACHE, "w"))
    ok = sum(1 for v in cache.values() if "error" not in v)
    print(f"cache: {len(cache)} entries, {ok} with data")
