import json, re, pandas as pd
from collections import Counter
wd=json.load(open('series_wd.json')); isf=json.load(open('isfdb_cache.json'))
META=json.load(open('src/data/meta.json')); B=json.load(open('src/data/books.json'))
df=pd.read_csv('library_backup.csv')
norm=lambda t:re.sub(r'\s+',' ',re.sub(r'[^a-z0-9 ]','',re.sub(r'\s*\(.*?\)','',str(t).lower()))).strip()
rated={norm(t):float(r) for t,r in zip(df['Title'],df['My Rating']) if r>0}
for b in B:
    if b['r']>0: rated[norm(b['t'])]=b['r']

JUNK=re.compile(r'\bseason \d|\bepisode\b|^Q\d+$|\bthe art of\b|\bcolou?ring\b|\bcompanion\b|\bmap\b|'
                r'\(part \d+ of \d+\)|\bomnibus\b|\bboxed set\b|\bcollection\b',re.I)
def clean(vols):
    """ISFDB lists magazine serialisations and omnibus editions alongside the
    novels. Those are what create apparent ordinal collisions, so they're
    stripped before the collision test rather than causing the series to be
    thrown away wholesale."""
    v=[x for x in vols if x.get("t") and not JUNK.search(x["t"])]
    seen=set(); ded=[]
    for x in v:                                   # an unnumbered duplicate of a
        k=norm(x["t"])                            # numbered entry is an edition
        if k in seen: continue
        seen.add(k); ded.append(x)
    # A repeated ordinal usually means a sub-series shares the page (Laundry
    # Files carries The New Management, also numbered from 1). Keep the first
    # run numbered and demote later duplicates to unnumbered, rather than
    # throwing the whole series away.
    seenord=set()
    for x in ded:
        o=x.get("ord")
        if not o: continue
        if o in seenord: x["sub"]=True; x["ord"]=None
        else: seenord.add(o)
    return ded if 2<=len(ded)<=30 else None

FF={"rivers of london":[("1","Rivers of London","2011"),("2","Moon Over Soho","2011"),("3","Whispers Under Ground","2012"),
 ("4","Broken Homes","2013"),("5","Foxglove Summer","2014"),("5.4","What Abigail Did That Summer","2021"),
 ("5.5","The Furthest Station","2017"),("6","The Hanging Tree","2015"),("7","Lies Sleeping","2018"),
 ("7.5","The October Man","2019"),("8","False Value","2020"),("9","Amongst Our Weapons","2022"),
 ("9.4","The Masquerades of Spring","2024"),("9.5","Winter's Gifts","2023"),("10","Stone and Sky","2025")],
 "books of babel":[("1","Senlin Ascends","2013"),("2","Arm of the Sphinx","2015"),("3","The Hod King","2019"),("4","The Fall of Babel","2021")]}

out={}
for k in set(list(wd)+list(isf)+list(FF)):
    best=None;src=None
    if k in FF:
        best=[{"ord":o,"t":t,"yr":y} for o,t,y in FF[k]]; src="FantasticFiction"
    else:
        for cand,name in ((isf.get(k),"ISFDB"),(wd.get(k),"Wikidata")):
            if not cand: continue
            v=clean(cand["vols"])
            if v and (not best or len(v)>len(best)): best,src=v,name
    if not best: continue
    m=META["series"].get(k)
    key=lambda z: float(z["ord"]) if z.get("ord") and str(z["ord"]).replace('.','',1).isdigit() else 999
    vols=[{"ord":x.get("ord"),"t":x["t"],"yr":x.get("yr"),"r":rated.get(norm(x["t"]))}
          for x in sorted(best,key=key)]
    out[k]={"name":(m or {}).get("name") or k.title(),"mean":(m or {}).get("mean"),
            "rated":(m or {}).get("n",0),"src":src,"vols":vols}
json.dump(out,open('src/data/all_series.json','w'),separators=(",",":"))
tot=sum(len(v["vols"]) for v in out.values())
print(f"{len(out)} series, {tot} volumes, {sum(1 for v in out.values() for x in v['vols'] if x['r'])} rated")
l=out.get('laundry files')
if l:
    print(f"\nLaundry Files [{l['src']}] {len(l['vols'])} volumes:")
    for x in l['vols']: print(f"   #{str(x['ord'] or '-'):<5} {x['t'][:44]:<46} {x['r'] or ''}")
