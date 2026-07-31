import requests, json, time, re, os, sys
H={"User-Agent":"reading-taxonomy/1.0 (personal reading project)"}
META=json.load(open('meta.json')); B=json.load(open('books.json'))
norm=lambda t:re.sub(r'[^a-z0-9 ]','',re.sub(r'\s*\(.*?\)','',str(t).lower())).strip()
CACHE='series_wd.json'
cache=json.load(open(CACHE)) if os.path.exists(CACHE) else {}

def sparql(q):
    r=requests.get("https://query.wikidata.org/sparql",params={"query":q,"format":"json"},
                   headers=H,timeout=45)
    return r.json()["results"]["bindings"] if r.ok else None

def series_volumes(name):
    """Fuzzy-match the series entity, then pull its ordered volumes."""
    try:
        s=requests.get("https://www.wikidata.org/w/api.php",params={
            "action":"wbsearchentities","search":name,"language":"en",
            "format":"json","limit":5},headers=H,timeout=25).json().get("search",[])
    except Exception: return None
    for c in s:
        q='''SELECT ?l ?ord ?pub WHERE { ?i wdt:P179 wd:%s .
             OPTIONAL{?i p:P179 ?st. ?st pq:P1545 ?ord}
             OPTIONAL{?i wdt:P577 ?pub}
             ?i rdfs:label ?l FILTER(lang(?l)="en") } LIMIT 60'''%c["id"]
        try: b=sparql(q)
        except Exception: b=None
        time.sleep(.7)
        if b and len(b)>=2:
            seen={}
            for x in b:
                lab=x["l"]["value"]
                o=x.get("ord",{}).get("value")
                pub=x.get("pub",{}).get("value","")[:4]
                if lab not in seen or (o and not seen[lab][0]):
                    seen[lab]=(o,pub)
            return {"entity":c["label"],"vols":[{"t":k,"ord":v[0],"yr":v[1]} for k,v in seen.items()]}
    return None

# series worth chasing: you've rated at least one volume, and liked it
cand=[(k,v) for k,v in META["series"].items() if v["n"]>=1 and v["mean"]>=4.0]
cand.sort(key=lambda kv:(-kv[1]["mean"],-kv[1]["n"]))
todo=[k for k,_ in cand if k not in cache]
LIM=int(sys.argv[1]) if len(sys.argv)>1 else 12
print(f"{len(cand)} series you rated >=4.0 | fetching {min(LIM,len(todo))} (cached {len(cache)})")
for k in todo[:LIM]:
    cache[k]=series_volumes(META["series"][k]["name"])
    json.dump(cache,open(CACHE,'w'))
    time.sleep(1.0)
got=sum(1 for v in cache.values() if v)
print(f"cache: {len(cache)} series, {got} resolved")
