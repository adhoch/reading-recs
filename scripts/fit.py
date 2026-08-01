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
from collections import Counter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "src", "data")
AXES = ["velocity", "friction", "interiority", "darkness",
        "romance_load", "prose_shine", "formula", "community_pace"]
LAMBDA = 5.0

snorm = lambda x: re.sub(r"[^a-z0-9 ]", "", re.sub(r"^(the|a)\s+", "", str(x).lower())).strip()


def load(name):
    with open(os.path.join(DATA, f"{name}.json"), encoding="utf-8") as f:
        return json.load(f)


def merge_ratings(books):
    """Fold src/data/ratings.json into the records, exactly as build.py does.

    The fit read books.json straight, while the page reads books.json merged
    with ratings.json, so every rating made in the browser was visible in the
    viewer and invisible to the model that scores it. The two must see the same
    library or the reported accuracy is for a training set that does not exist.
    Titles are the join key, as in build.py."""
    rat = (load("ratings") or {}).get("ratings") or {}
    idx = {b["t"]: b for b in books}
    n = 0
    for title, value in rat.items():
        b = idx.get(title)
        if b and isinstance(value, (int, float)) and 1 <= value <= 5 and not b["r"]:
            b["r"] = value
            n += 1
    if n:
        print(f"  merged {n} rating(s) from ratings.json that books.json lacked")
    return books


def features(book):
    """Seven hand axes plus community pace. cpace falls back to the velocity tag
    when StoryGraph was never scraped for this book, which is what the viewer
    does — but it means the row carries a guess where the others carry a
    measurement, so `fit.py --split` reports with and without those rows."""
    cp = book.get("cpace")
    return [*book["ax"], cp if cp is not None else book["ax"][0]]


def group_weights(rows):
    """How much one row is allowed to say.

    Every volume of a series used to vote once, so a fourteen-book run counted
    for fourteen independent opinions when it is closer to one opinion held
    fourteen times. Rating out Discworld would have moved prose_shine by 27%.

    A series gets log2(1+n) votes shared among its n volumes, so the second book
    still adds real information and the fortieth adds almost none -- fourteen
    volumes count for 3.9 standalones, forty for 5.4. Full balancing (1/n)
    scored the same but threw away the fact that a long run was read at all;
    this is the same log2(1+n) the shelf sort already uses for `pull`."""
    counts = Counter(r[2] for r in rows)
    return np.array([np.log2(1 + counts[r[2]]) / counts[r[2]] for r in rows])


def ridge(X, y, lam=LAMBDA, w=None):
    if w is None:
        w = np.ones(len(y))
    w = np.asarray(w, float)
    p = w / w.sum()
    mu, ym = (X * p[:, None]).sum(0), float((y * p).sum())
    Xc = X - mu
    A = Xc * w[:, None]
    b = np.linalg.solve(A.T @ Xc + lam * np.eye(X.shape[1]), A.T @ (y - ym))
    return b, float(ym - mu @ b)


def cv(rows, grouped):
    """Returns (r, residual sd). rows is a list of (features, rating, group)."""
    X = np.array([r[0] for r in rows], float)
    y = np.array([r[1] for r in rows], float)
    folds = sorted({r[2] for r in rows}) if grouped else range(len(rows))
    pred, actual = [], []
    for f in folds:
        te = [i for i, r in enumerate(rows) if (r[2] == f if grouped else i == f)]
        tr = [i for i in range(len(rows)) if i not in te]
        # Fit weighted; score the held-out group unweighted. The test set is
        # the world, and the world does not care how training was weighted.
        w, b = ridge(X[tr], y[tr], w=group_weights([rows[i] for i in tr]))
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
    books = merge_ratings(load("books"))
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
    w, b = ridge(X, y, w=group_weights(rows))
    print(f"\n  committed model.json: r={model['r']} sd={model['sd']}")
    print(f"  {'axis':<16}{'committed':>11}{'refit':>10}{'shift':>9}")
    for name, old, new in zip(AXES, model["coef"], w):
        print(f"  {name:<16}{old:>+11.4f}{new:>+10.4f}{new - old:>+9.4f}")
    print(f"  {'intercept':<16}{model['intercept']:>+11.4f}{b:>+10.4f}{b - model['intercept']:>+9.4f}")

    grp_r, grp_sd = cv(rows, True)

    if "--rescore" in sys.argv[1:]:
        # Rescore from the committed model rather than fitting a new one.
        #
        # Kept for reproducing an older published state, NOT because the old
        # model was better. That claim compared model.json's stored r=0.713
        # against refits measured on a different set, which is the same
        # range-restriction trap this file exists to avoid. Scored on one set:
        # the old coefficients reach r=0.649 on the current 223 rows even with
        # 95 of them in-sample, while a log-weighted refit reaches 0.653 held
        # out. The refit is better. This path is now only for putting every book
        # on one named historical model without
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
