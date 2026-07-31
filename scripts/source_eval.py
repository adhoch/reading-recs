#!/usr/bin/env python3
"""
Score a candidate data source against every register axis.

Three questions per (source, axis) pair:
  COVERAGE   what fraction of books does it reach?
  AGREEMENT  does it correlate with my hand tag? (validates or contradicts me)
  LIFT       does adding it improve leave-one-out prediction of YOUR ratings?

LIFT is the one that decides adoption. It is computed with the candidate
refitted inside each fold — the mistake that made publisher blurbs look useful
(+0.02) when a nested test showed they were catastrophic (-0.56).
"""
import json, numpy as np
from sklearn.linear_model import RidgeCV
from sklearn.model_selection import LeaveOneOut, cross_val_predict
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from scipy.stats import pearsonr

B = json.load(open('books.json'))
READ = [b for b in B if b['r'] > 0]
AXN = ["velocity","friction","interiority","darkness","romance_load","prose_shine","formula"]
mo = lambda b,k: (b.get('moods') or {}).get(k)

# candidate signals: name -> (extractor, "which axis it claims to inform")
CANDIDATES = {
 "SG pace":            (lambda b: b.get('cpace'),            "velocity"),
 "SG %dark":           (lambda b: mo(b,'dark'),              "darkness"),
 "SG %challenging":    (lambda b: mo(b,'challenging'),       "friction"),
 "SG %emotional":      (lambda b: mo(b,'emotional'),         "interiority"),
 "SG %reflective":     (lambda b: mo(b,'reflective'),        "interiority"),
 "SG %tense":          (lambda b: mo(b,'tense'),             "darkness"),
 "SG %funny":          (lambda b: mo(b,'funny'),             "darkness"),
 "SG %adventurous":    (lambda b: mo(b,'adventurous'),       "velocity"),
 "SG %mysterious":     (lambda b: mo(b,'mysterious'),        "velocity"),
 "SG review count":    (lambda b: np.log1p(b['nrev']) if b.get('nrev') else None, "(reliability)"),
 "SG avg rating":      (lambda b: None,                      "(not scraped)"),
}

def feats(b): return b['ax'] + [b['cpace'] if b.get('cpace') is not None else b['ax'][0]]
BASE = np.array([feats(b) for b in READ], float)
Y = np.array([b['r'] for b in READ], float)
mk = lambda: make_pipeline(StandardScaler(), RidgeCV(alphas=np.logspace(-1,3,40)))
base_pred = cross_val_predict(mk(), BASE, Y, cv=LeaveOneOut())
BASE_R = pearsonr(base_pred, Y)[0]

print(f"baseline (7 axes + community pace): LOO r = {BASE_R:.3f}\n")
print(f"{'source':<20}{'informs':<14}{'cover':>7}{'agree':>8}{'lift':>8}  verdict")
print("-"*72)
rows=[]
for name,(fn,axis) in CANDIDATES.items():
    vals=[fn(b) for b in B]
    cov=sum(1 for v in vals if v is not None)/len(B)
    if cov==0:
        print(f"{name:<20}{axis:<14}{'—':>7}{'—':>8}{'—':>8}  no data"); continue
    rv=[fn(b) for b in READ]
    ok=[i for i,v in enumerate(rv) if v is not None]
    if len(ok)<25:
        print(f"{name:<20}{axis:<14}{cov:>6.0%}{'—':>8}{'—':>8}  too sparse"); continue
    x=np.array([rv[i] for i in ok],float)
    # agreement with my own tag on the axis it claims to inform
    agree=""
    if axis in AXN:
        mine=np.array([READ[i]['ax'][AXN.index(axis)] for i in ok],float)
        agree=f"{pearsonr(x,mine)[0]:+.2f}"
    # lift: add as an extra feature, impute the gaps with the column mean
    col=np.array([fn(b) if fn(b) is not None else np.nan for b in READ],float)
    col=np.where(np.isnan(col), np.nanmean(col), col)
    aug=np.column_stack([BASE,col])
    p=cross_val_predict(mk(), aug, Y, cv=LeaveOneOut())
    lift=pearsonr(p,Y)[0]-BASE_R
    verdict = "ADOPT" if lift>=0.010 else ("keep as context" if lift>-0.005 else "reject")
    rows.append((name,axis,cov,agree,lift,verdict))
    print(f"{name:<20}{axis:<14}{cov:>6.0%}{agree:>8}{lift:>+8.3f}  {verdict}")

print("\nrejected after testing (kept here so they aren't re-tried):")
for n,why in [("publisher blurb text","nested LOO r=0.153 vs 0.713 — text is noise for this"),
              ("author mean rating","+0.004, inside noise (leak-free LOO)"),
              ("series mean rating","-0.001; only 13/95 books have a sibling volume"),
              ("Open Library subjects","topical not tonal; 'Fiction, horror' is all it gives"),
              ("Google Books categories","HTTP 429 without a key"),
              ("LibraryThing tags","403; free API covers series/characters, not texture"),
              ("Wikidata genre","returns film genres mixed with book; too noisy")]:
    print(f"  {n:<24} {why}")
json.dump([{ "source":n,"axis":a,"coverage":round(c,3),"agreement":g,"lift":round(l,4),"verdict":v}
           for n,a,c,g,l,v in rows], open('source_scorecard.json','w'), indent=1)
