#!/usr/bin/env python3
"""
Assemble src/ into a deployable single-file page.

  python3 build.py            -> dist/reading-network.html   (Google Fonts, ~500 KB)
  python3 build.py --offline  -> also dist/reading-network-offline.html (fonts inlined, no
                                 third-party requests at all)
  python3 build.py --dev      -> writes src/data.js so src/index.html opens straight from
                                 file:// without a server (JSON via fetch would be
                                 blocked by CORS on file://, hence the shim)

Layout
  src/index.html   markup shell
  src/style.css    all styling
  src/app.js       all behaviour
  src/data/*.json  books, model, meta, next_in_series
"""
import base64
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(ROOT, "src")
DIST = os.path.join(ROOT, "dist")
DATA_FILES = ["books", "model", "meta", "next_in_series", "all_series", "ratings", "graph",
              "needs_input"]

GOOGLE_FONTS = (
    '<link rel="preconnect" href="https://fonts.googleapis.com">\n'
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n'
    '<link href="https://fonts.googleapis.com/css2?family=Bodoni+Moda:opsz,wght@6..96,400;'
    '6..96,600&family=Spectral:wght@300;400;600&family=IBM+Plex+Mono:wght@400;500'
    '&display=swap" rel="stylesheet">'
)


def read(*parts):
    with open(os.path.join(*parts), encoding="utf-8") as f:
        return f.read()


def load_data():
    out = {}
    for name in DATA_FILES:
        path = os.path.join(SRC, "data", f"{name}.json")
        if not os.path.exists(path):
            if name in ("ratings", "all_series", "graph", "needs_input"):  # optional
                out[name] = {"ratings": {}, "log": []} if name == "ratings" else {}
                continue
            sys.exit(f"missing data file: {path}")
        with open(path, encoding="utf-8") as f:
            out[name] = json.load(f)
    merge_ratings(out)
    return out


def merge_ratings(data):
    """Ratings committed to src/data/ratings.json are folded into the book
    records at build time, so a rating made in the browser becomes permanent the
    moment it is exported and committed. Titles are the join key."""
    rat = (data.get("ratings") or {}).get("ratings") or {}
    if not rat:
        return
    idx = {b["t"]: b for b in data["books"]}
    n = 0
    for title, value in rat.items():
        b = idx.get(title)
        if b and isinstance(value, (int, float)) and 1 <= value <= 5:
            b["r"] = value
            n += 1
    print(f"  merged {n} committed rating(s) from src/data/ratings.json")


def write_dev_shim(data):
    """src/index.html loads data.js rather than fetching JSON, so the split
    version still opens from a plain file:// path with no server."""
    js = "window.__DATA__=" + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";\n"
    with open(os.path.join(SRC, "data.js"), "w", encoding="utf-8") as f:
        f.write(js)
    return len(js)


def inline_fonts():
    """Fetch the Latin subsets and base64 them, so the page makes zero
    third-party requests. Requires network; skipped cleanly if unavailable."""
    try:
        import requests
    except ImportError:
        return None
    ua = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124 Safari/537.36"}
    url = re.search(r'href="(https://fonts\.googleapis\.com/css2[^"]+)"', GOOGLE_FONTS).group(1)
    try:
        css = requests.get(url, headers=ua, timeout=30).text
        blocks = re.split(r"(?=/\*\s*[a-z-]+\s*\*/)", css)
        css = "".join(
            b for b in blocks
            if re.match(r"/\*\s*latin(-ext)?\s*\*/", b.strip()) or "@font-face" not in b
        )
        for u in set(re.findall(r"url\((https://fonts\.gstatic\.com/[^)]+\.woff2)\)", css)):
            blob = requests.get(u, headers=ua, timeout=30).content
            css = css.replace(u, "data:font/woff2;base64," + base64.b64encode(blob).decode())
        return css
    except Exception as exc:                       # offline build is optional, never fatal
        print(f"  ! font inlining skipped: {str(exc)[:60]}")
        return None


def bundle(data, fonts_css=None):
    html = read(SRC, "index.html")
    css = read(SRC, "style.css")
    js = read(SRC, "app.js")

    head_fonts = f"<style>\n{fonts_css}\n</style>" if fonts_css else GOOGLE_FONTS
    html = html.replace("<!--FONTS-->", head_fonts)
    html = html.replace('<link rel="stylesheet" href="style.css">', f"<style>\n{css}\n</style>")
    payload = "window.__DATA__=" + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";"
    html = html.replace(
        '<script src="data.js"></script>\n<script src="app.js"></script>',
        f"<script>{payload}</script>\n<script>\n{js}\n</script>",
    )
    return html


def main():
    args = set(sys.argv[1:])
    os.makedirs(DIST, exist_ok=True)
    data = load_data()
    counts = {k: (len(v) if isinstance(v, (list, dict)) else 1) for k, v in data.items()}
    print(f"data: {counts}")

    size = write_dev_shim(data)
    print(f"  src/data.js                      {size/1024:.0f} KB   (dev shim, file:// friendly)")

    out = os.path.join(DIST, "reading-network.html")
    with open(out, "w", encoding="utf-8") as f:
        f.write(bundle(data))
    print(f"  dist/reading-network.html        {os.path.getsize(out)/1024:.0f} KB")

    if "--offline" in args:
        fonts = inline_fonts()
        if fonts:
            out2 = os.path.join(DIST, "reading-network-offline.html")
            with open(out2, "w", encoding="utf-8") as f:
                f.write(bundle(data, fonts))
            print(f"  dist/reading-network-offline.html {os.path.getsize(out2)/1024:.0f} KB  (no external requests)")


if __name__ == "__main__":
    main()
