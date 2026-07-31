import requests, re, time, json
H={'User-Agent':'reading-taxonomy/1.0 (personal reading project)'}

def find_series(name):
    r=requests.get("https://www.isfdb.org/cgi-bin/se.cgi",
        params={"arg":name,"type":"Series"},headers=H,timeout=30)
    if not r.ok: return None
    hits=re.findall(r'pe\.cgi\?(\d+)"[^>]*>([^<]{2,70})</a>', r.text)
    hits=[(i,n) for i,n in hits if i!="0"]
    return hits[0] if hits else None

def volumes(sid):
    t=requests.get(f"https://www.isfdb.org/cgi-bin/pe.cgi?{sid}",headers=H,timeout=30).text
    # top-level entries: "<li>N <a class="italic" href=title.cgi?..>Title</a> (<b>year</b>)"
    rows=re.findall(r'<li>\s*(\d+)?\s*\n?\s*<a class\s*=\s*"italic" href="[^"]*title\.cgi\?\d+"[^>]*>([^<]+)</a>\s*\(<b>(\d{4})</b>\)', t)
    out=[]
    for num,title,yr in rows:
        if re.search(r'\bVariant\b',title): continue
        out.append({"ord":num or None,"t":title.strip(),"yr":yr})
    # drop variants/translations that repeat a title already seen
    seen=set(); ded=[]
    for x in out:
        k=x["t"].lower()
        if k in seen: continue
        seen.add(k); ded.append(x)
    return ded

tests=["Rivers of London","Gentleman Bastard","The Books of Babel","The Locked Tomb",
       "The Divine Cities","Children of Time"]
res={}
for t in tests:
    f=find_series(t); time.sleep(1.2)
    if not f: print(f"  {t:<22} miss"); continue
    v=volumes(f[0]); time.sleep(1.2)
    res[t]=v
    print(f"  {t:<22} [{f[1][:26]}] {len(v)} vols: "+", ".join(f"{x['ord'] or '-'}·{x['t'][:20]}" for x in v[:4]))
json.dump(res,open('isfdb_probe.json','w'),indent=0)
