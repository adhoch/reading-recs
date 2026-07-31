import json, re, pandas as pd, numpy as np
from collections import defaultdict
B=json.load(open('books.json')); df=pd.read_csv('library_backup.csv')
norm=lambda t:re.sub(r'[^a-z0-9 ]','',re.sub(r'\s*\(.*?\)','',str(t).lower())).strip()
snorm=lambda s:re.sub(r'^(the|a)\s+','',re.sub(r'[^a-z0-9 ]','',str(s).lower())).strip()

SER={}
for t in df['Title']:
    m=re.search(r'\(([^)]+?),?\s*#([\d.]+)\)',str(t))
    if m: SER[norm(t)]=[m.group(1).strip(), float(m.group(2))]

# Ratings live in two places: the export, and everything logged in conversation
# since. Merge them, with the conversation value winning.
rat={}
for t,a,r in zip(df['Title'],df['Author'],df['My Rating']):
    if r>0: rat[norm(t)]=(a,float(r))
for b in B:
    if b['r']>0: rat[norm(b['t'])]=(b['a'],float(b['r']))

A=defaultdict(list); S=defaultdict(list); Svol=defaultdict(list); canon={}
def serof(n, book=None):
    if n in SER: return SER[n][0], SER[n][1]
    if book and book.get('ser'): return book['ser'], book.get('vol')
    return None,None
byname={norm(b['t']):b for b in B}
for n,(a,r) in rat.items():
    A[a].append(r)
    sname,vol=serof(n, byname.get(n))
    if sname:
        k=snorm(sname); canon.setdefault(k,sname)
        S[k].append(r)
        if vol: Svol[k].append(vol)

authors={a:{"n":len(v),"mean":round(float(np.mean(v)),2)} for a,v in A.items()}
series={k:{"name":canon[k],"n":len(v),"mean":round(float(np.mean(v)),2),
           "vols":sorted(set(Svol[k]))} for k,v in S.items()}
json.dump({"authors":authors,"series":series},open('meta.json','w'),separators=(",",":"))

# align my curated rec series names to the library's, via the normalised key
fixed=0
for b in B:
    if b.get('ser'):
        k=snorm(b['ser'])
        if k in canon and canon[k]!=b['ser']:
            b['ser']=canon[k]; fixed+=1
json.dump(B,open('books.json','w'),ensure_ascii=False)
print(f"merged ratings: {len(rat)} books | {len(authors)} authors | {len(series)} series")
print(f"realigned {fixed} series names to match your library")
bu=authors.get('Christopher Buehlman'); print("Buehlman now:",bu)
fl=[v for k,v in series.items() if 'first law' in k]
print("First Law series entry:",fl)
