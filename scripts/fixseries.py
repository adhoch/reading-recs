import json, re, pandas as pd
from collections import defaultdict, Counter
import numpy as np

def parse_series(title):
    """Goodreads packs several forms into the parenthetical:
         (Laundry Files, #10; The New Management)   compound — take the first
         (The Divine Cities, #2)                    simple
         (Hench, #1)
       Returns (series, volume) or (None, None)."""
    m=re.search(r'\(([^)]*)\)\s*$', str(title))
    if not m: return None,None
    inner=m.group(1)
    first=inner.split(';')[0].strip()          # drop alternate series after ';'
    mm=re.match(r'^(.*?),?\s*#([\d.]+)\s*$', first)
    if mm: return mm.group(1).strip(), float(mm.group(2))
    mm=re.search(r'#([\d.]+)', first)
    if mm: return re.sub(r',?\s*#[\d.]+.*$','',first).strip(), float(mm.group(1))
    return None,None

def snorm(s):
    s=re.sub(r'[^a-z0-9 ]','',str(s).lower())
    s=re.sub(r'^(the|a)\s+','',s).strip()
    s=re.sub(r'\s+(series|sequence|trilogy|saga|cycle|novels?|universe|chronicles)$','',s).strip()
    return s

df=pd.read_csv('library_backup.csv')
B=json.load(open('src/data/books.json'))
norm=lambda t:re.sub(r'\s+',' ',re.sub(r'[^a-z0-9 ]','',re.sub(r'\s*\(.*?\)','',str(t).lower()))).strip()

# --- rebuild series assignment for every library book ---
SER={}
for t in df['Title']:
    s,v=parse_series(t)
    if s: SER[norm(t)]=(s,v)
print(f"library titles with a parsed series: {len(SER)}")
bad=[t for t in df['Title'] if ';' in str(t) and '(' in str(t)]
print(f"compound parentheticals repaired: {len(bad)}")
for t in bad[:4]:
    s,v=parse_series(t); print(f"   {str(t)[:52]:<54} -> {s!r} #{v}")

# canonical display name per normalised key: prefer the most common spelling
names=defaultdict(Counter)
for s,v in SER.values(): names[snorm(s)][s]+=1
for b in B:
    if b.get('ser'): names[snorm(b['ser'])][b['ser']]+=1
canon={k:c.most_common(1)[0][0] for k,c in names.items()}

# --- reassign books.json ---
fixed=0
for b in B:
    n=norm(b['t'])
    if n in SER:
        s,v=SER[n]
        if b.get('ser')!=canon[snorm(s)] or b.get('vol')!=v: fixed+=1
        b['ser']=canon[snorm(s)]; b['vol']=v
    elif b.get('ser'):
        b['ser']=canon.get(snorm(b['ser']),b['ser'])
json.dump(B,open('src/data/books.json','w'),ensure_ascii=False)
print(f"\nbooks reassigned: {fixed}")

# --- rebuild meta.json series/author aggregates on the fixed keys ---
rat={}
for t,a,r in zip(df['Title'],df['Author'],df['My Rating']):
    if r>0: rat[norm(t)]=(a,float(r))
for b in B:
    if b['r']>0: rat[norm(b['t'])]=(b['a'],float(b['r']))
A=defaultdict(list); S=defaultdict(list); Svol=defaultdict(list)
byname={norm(b['t']):b for b in B}
for n,(a,r) in rat.items():
    A[a].append(r)
    s,v=SER.get(n,(None,None))
    if not s:
        bb=byname.get(n)
        if bb and bb.get('ser'): s,v=bb['ser'],bb.get('vol')
    if s:
        k=snorm(s); S[k].append(r)
        if v: Svol[k].append(v)
META={"authors":{a:{"n":len(v),"mean":round(float(np.mean(v)),2)} for a,v in A.items()},
      "series":{k:{"name":canon.get(k,k.title()),"n":len(v),
                   "mean":round(float(np.mean(v)),2),"vols":sorted(set(Svol[k]))} for k,v in S.items()}}
json.dump(META,open('src/data/meta.json','w'),separators=(",",":"))
print(f"meta: {len(META['authors'])} authors, {len(META['series'])} series")
l={k:v for k,v in META['series'].items() if 'laundry' in k}
print("laundry key now:",l)
json.dump(canon,open('series_canon.json','w'))
