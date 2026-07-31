import json, os, re, sys
from playwright.sync_api import sync_playwright

UA = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")

# reuse the IDs already resolved during the stats scrape
rows = {json.loads(l)["k"]: json.loads(l)["v"] for l in open("sg_rows.jsonl")}
ids = {k: v["id"] for k, v in rows.items() if "error" not in v and v.get("id")}

done = set()
if os.path.exists("sg_desc.jsonl"):
    done = {json.loads(l)["k"] for l in open("sg_desc.jsonl")}
todo = [(k, i) for k, i in ids.items() if k not in done]
if len(sys.argv) > 1:
    todo = todo[: int(sys.argv[1])]
print(f"fetching {len(todo)} descriptions ({len(done)} cached)", flush=True)

EXTRACT = """() => {
    const h = [...document.querySelectorAll('h4,h3,h2')]
        .find(x => /description/i.test(x.textContent));
    if (!h) return null;
    let n = h.nextElementSibling;
    while (n && !n.innerText.trim()) n = n.nextElementSibling;
    return n ? n.innerText.trim() : null;
}"""

with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_context(user_agent=UA).new_page()
    for k, bid in todo:
        rec = {"k": k, "desc": None}
        try:
            pg.goto(f"https://app.thestorygraph.com/books/{bid}",
                    wait_until="domcontentloaded", timeout=90000)
            try:
                pg.wait_for_selector("text=Description", timeout=12000)
            except Exception:
                pass
            for sel in ("text=Show More", "text=show more"):
                try:
                    loc = pg.locator(sel).first
                    if loc.is_visible():
                        loc.click()
                        pg.wait_for_timeout(500)
                except Exception:
                    pass
            d = pg.evaluate(EXTRACT)
            if d:
                d = re.sub(r"\s*\n\s*Show More\s*$", "", d).replace("\xa0", " ").strip()
                rec["desc"] = d
        except Exception as e:
            rec["err"] = str(e)[:60]
        with open("sg_desc.jsonl", "a") as f:
            f.write(json.dumps(rec) + "\n")
        pg.wait_for_timeout(300)
    b.close()

got = sum(1 for l in open("sg_desc.jsonl") if json.loads(l).get("desc"))
print(f"descriptions cached: {got}")
