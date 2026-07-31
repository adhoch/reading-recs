import json, re, pandas as pd
from collections import Counter
wd=json.load(open('series_wd.json')); isf=json.load(open('isfdb_cache.json'))
META=json.load(open('meta.json')); B=json.load(open('books.json'))
df=pd.read_csv('library_backup.csv')
norm=lambda t:re.sub(r'\s+',' ',re.sub(r'[^a-z0-9 ]','',re.sub(r'\s*\(.*?\)','',str(t).lower()))).strip()
rated={norm(t):float(r) for t,r in zip(df['Title'],df['My Rating']) if r>0}
for b in B:
    if b['r']>0: rated[norm(b['t'])]=b['r']
tagged={norm(b['t']):b for b in B}

JUNK=re.compile(r'\bseason \d|\bepisode\b|^Q\d+$|\bthe art of\b|\bcolou?ring\b|\bcompanion\b|\bmap\b',re.I)
def clean(vols):
    v=[x for x in vols if x.get("t") and not JUNK.search(x["t"])]
    o=[x["ord"] for x in v if x.get("ord")]
    if o and Counter(o).most_common(1)[0][1]>1: return None
    if len(v)>22: return None
    return v

# FantasticFiction hand-transcriptions take precedence
FF=json.load(open('next_in_series.json'))
out={}
for k in set(list(wd)+list(isf)):
    best=None;src=None
    for cand,name in ((isf.get(k),"ISFDB"),(wd.get(k),"Wikidata")):
        if not cand: continue
        v=clean(cand["vols"])
        if v and (not best or len(v)>len(best)): best,src=v,name
    if not best: continue
    m=META["series"].get(k)
    vols=[]
    for x in sorted(best,key=lambda z:float(z["ord"]) if z.get("ord") and str(z["ord"]).replace('.','',1).isdigit() else 99):
        n=norm(x["t"])
        vols.append({"ord":x.get("ord"),"t":x["t"],"yr":x.get("yr"),
                     "r":rated.get(n),                       # your rating, if any
                     "id":tagged[n]["t"] if n in tagged else None})
    out[k]={"name":(m or {}).get("name") or k.title(),
            "mean":(m or {}).get("mean"),"rated":(m or {}).get("n",0),
            "src":src,"vols":vols}
# keep the hand-checked FF orderings
for k,v in FF.items():
    if v.get("src")=="FantasticFiction" and k in out:
        have={norm(x["t"]) for x in out[k]["vols"]}
        for x in v["next"]:
            if norm(x["t"]) not in have:
                out[k]["vols"].append({"ord":x.get("ord"),"t":x["t"],"yr":x.get("yr"),"r":None,"id":None})
        out[k]["src"]="FantasticFiction"
        out[k]["vols"].sort(key=lambda z:float(z["ord"]) if z.get("ord") and str(z["ord"]).replace('.','',1).isdigit() else 99)

json.dump(out,open('src/data/all_series.json','w'),separators=(",",":"))
tot=sum(len(v["vols"]) for v in out.values())
haveR=sum(1 for v in out.values() for x in v["vols"] if x["r"])
print(f"{len(out)} series, {tot} volumes total")
print(f"  volumes you've rated: {haveR}")
print(f"  volumes with no rating on record: {tot-haveR}")
print("\nseries you rate highly, showing the full run:")
for k,v in sorted(out.items(),key=lambda kv:-(kv[1]['mean'] or 0))[:6]:
    marks="".join("*" if x["r"] else "." for x in v["vols"])
    print(f"  {v['name'][:30]:<32} {v['mean']}★  [{marks}]  {len(v['vols'])} vols")
print("\n  * = rated   . = no rating on record")
