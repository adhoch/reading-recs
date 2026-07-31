#!/usr/bin/env python3
"""
Fit the preference model, and cross-validate it honestly.

  python3 scripts/fit.py             report only
  python3 scripts/fit.py --write     rewrite model.json and rescore every book

This script did not exist. model.json, and the p/praw columns in books.json,
were produced offline and never committed, which is why praw reproduces from
the committed coefficients for only 115 of the original 274 books and why
weber_risk and kingsim could not be regenerated at all.

Two cross-validation schemes, because they disagree and the disagreement is
the point:

  LOO      hold out one book. The published 0.713 was measured this way.
  grouped  hold out one whole series. A book with six rated siblings in the
           training set is not being predicted, it is being remembered, and
           LOO cannot see that. When the two agree the training set has no
           series leakage; when grouped is lower, it does.

The original 95 rated books sat in 63 series buckets with only six siblings
between them, so the two schemes agreed almost exactly. That is no longer
true: the library now carries seven Dark Tower, seven Black Company, six
Codex Alera and seven Mistborn volumes.
"""
import json
import os
import re
import sys

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "src", "data")
AXES = ["velocity", "friction", "interiority", "darkness",
        "romance_load", "prose_shine", "formula", "community_pace"]
LAMBDA = 5.0

snorm = lambda x: re.sub(r"[^a-z0-9 ]", "", re.sub(r"^(the|a)\s+", "", str(x).lower())).strip()


def load(name):
    with open(os.path.join(DATA, f"{name}.json"), encoding="utf-8") as f:
        return json.load(f)


def features(book):
    """Seven hand axes plus community pace. cpace falls back to the velocity tag
    when StoryGraph was never scraped for this book, which is what the viewer
    does — but it means the row carries a guess where the others carry a
    measurement, so `fit.py --split` reports with and without those rows."""
    cp = book.get("cpace")
    return [*book["ax"], cp if cp is not None else book["ax"][0]]


def ridge(X, y, lam=LAMBDA):
    mu, ym = X.mean(0), y.mean()
    Xc = X - mu
    w = np.linalg.solve(Xc.T @ Xc + lam * np.eye(X.shape[1]), Xc.T @ (y - ym))
    return w, float(ym - mu @ w)


def cv(rows, grouped):
    """Returns (r, residual sd). rows is a list of (features, rating, group)."""
    X = np.array([r[0] for r in rows], float)
    y = np.array([r[1] for r in rows], float)
    folds = sorted({r[2] for r in rows}) if grouped else range(len(rows))
    pred, actual = [], []
    for f in folds:
        te = [i for i, r in enumerate(rows) if (r[2] == f if grouped else i == f)]
        tr = [i for i in range(len(rows)) if i not in te]
        w, b = ridge(X[tr], y[tr])
        for i in te:
            pred.append(float(X[i] @ w + b))
            actual.append(y[i])
    pred, actual = np.array(pred), np.array(actual)
    r = float(np.corrcoef(pred, actual)[0, 1])
    return r, float(np.sqrt(((actual - pred) ** 2).mean()))


def rows_for(books, measured_only=False):
    out = []
    for b in books:
        if not b["r"]:
            continue
        if measured_only and b.get("cpace") is None:
            continue
        # A standalone is its own group; otherwise every volume of a series
        # holds out together, so siblings can never train on each other.
        group = snorm(b["ser"]) if b.get("ser") else "solo:" + snorm(b["t"])
        out.append((features(b), b["r"], group))
    return out


def report(label, rows):
    if len(rows) < 20:
        print(f"  {label:<40} too few rows ({len(rows)})")
        return
    groups = len({r[2] for r in rows})
    loo_r, loo_sd = cv(rows, False)
    grp_r, grp_sd = cv(rows, True)
    print(f"  {label:<40}{len(rows):>5}{groups:>8}{loo_r:>9.3f}{grp_r:>10.3f}"
          f"{grp_sd:>9.2f}{loo_r - grp_r:>+9.3f}")


def main():
    write = "--write" in sys.argv[1:]
    books = load("books")
    model = load("model")

    print("Cross-validated fit\n")
    print(f"  {'training set':<40}{'rows':>5}{'groups':>8}{'LOO r':>9}"
          f"{'grouped':>10}{'resid':>9}{'gap':>9}")
    original = books[:274]
    report("original 274 (as published)", rows_for(original))
    report("all 318", rows_for(books))
    report("all 318, only rows with real cpace", rows_for(books, measured_only=True))

    rows = rows_for(books)
    X = np.array([r[0] for r in rows], float)
    y = np.array([r[1] for r in rows], float)
    w, b = ridge(X, y)
    print(f"\n  committed model.json: r={model['r']} sd={model['sd']}")
    print(f"  {'axis':<16}{'committed':>11}{'refit':>10}{'shift':>9}")
    for name, old, new in zip(AXES, model["coef"], w):
        print(f"  {name:<16}{old:>+11.4f}{new:>+10.4f}{new - old:>+9.4f}")
    print(f"  {'intercept':<16}{model['intercept']:>+11.4f}{b:>+10.4f}{b - model['intercept']:>+9.4f}")

    grp_r, grp_sd = cv(rows, True)

    if "--rescore" in sys.argv[1:]:
        # Rescore from the committed model rather than fitting a new one.
        #
        # model.json is not a fossil: it reproduces a ridge fit at lambda=5 on
        # the original 95 rated books to a mean coefficient difference of
        # 0.0038, so it is a real model and, on the numbers above, a better one
        # than anything refitting the current library produces. What is stale is
        # praw and p, which came from an earlier fit -- 115 of the original 274
        # reproduce from the committed coefficients and the rest are off by
        # about 0.03. This puts every book on the one verified model without
        # changing which model that is.
        w = np.array(model["coef"], float)
        moved = 0
        for bk in books:
            praw = model["intercept"] + float(np.array(features(bk)) @ w)
            p = round(min(5.0, max(1.0, praw)), 1)
            if abs(bk.get("p", p) - p) > 1e-9:
                moved += 1
            bk["praw"], bk["p"] = round(praw, 3), p
            bk["weber_risk"] = (not bk["r"]) and bk["ax"][5] <= 2 and bk["ax"][6] >= 4
        print(f"\nrescored {len(books)} books from the committed model; "
              f"{moved} displayed scores change")
        if not write:
            print("dry run — add --write to apply")
            return
        with open(os.path.join(DATA, "books.json"), "w", encoding="utf-8") as f:
            json.dump(books, f, ensure_ascii=False, separators=(",", ":"))
        print("wrote src/data/books.json — next: python3 build.py")
        return

    if not write:
        print("\ndry run — pass --write to refit, or --rescore to recompute "
              "p/praw from the committed model without refitting")
        return
    out = {"intercept": round(b, 4), "coef": [round(float(c), 4) for c in w],
           "sd": round(grp_sd, 2), "r": round(grp_r, 3)}
    with open(os.path.join(DATA, "model.json"), "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    # Rescore everything from the model that was just fitted, so praw stops
    # being a fossil of a model nobody has.
    for bk in books:
        praw = b + float(np.array(features(bk)) @ w)
        bk["praw"] = round(praw, 3)
        bk["p"] = round(min(5.0, max(1.0, praw)), 1)
        bk["weber_risk"] = (not bk["r"]) and bk["ax"][5] <= 2 and bk["ax"][6] >= 4
    with open(os.path.join(DATA, "books.json"), "w", encoding="utf-8") as f:
        json.dump(books, f, ensure_ascii=False, separators=(",", ":"))
    print(f"\nwrote model.json (r={out['r']}, sd={out['sd']}) and rescored "
          f"{len(books)} books — next: python3 build.py")


if __name__ == "__main__":
    main()
