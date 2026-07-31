import json, itertools, numpy as np, networkx as nx
from collections import Counter
from networkx.algorithms.community import greedy_modularity_communities, modularity
B=json.load(open('src/data/books.json'))
FAC=[("mi",1.0),("sy",1.5),("in",1.25),("ca",1.0),("mo",1.0)]
def wt(a,c):
    w=2.0 if a['en']==c['en'] else 0
    for k,x in FAC: w+=x*len(set(a.get(k,[]))&set(c.get(k,[])))
    return w
n=len(B); W=np.zeros((n,n))
for i,j in itertools.combinations(range(n),2): W[i,j]=W[j,i]=wt(B[i],B[j])

K=4
G=nx.Graph(); G.add_nodes_from(range(n))
edges={}
for i in range(n):
    for j in np.argsort(-W[i])[:K]:
        j=int(j)
        if W[i,j]<=0 or i==j: continue
        a,b=min(i,j),max(i,j)
        edges[(a,b)]=float(W[a,b]); G.add_edge(a,b,weight=float(W[a,b]))
comms=sorted(greedy_modularity_communities(G,weight="weight"),key=len,reverse=True)
q=modularity(G,comms,weight="weight")
print(f"k={K}: {len(edges)} edges (was 17,456 possible), {len(comms)} clusters, modularity {q:.3f}")

def label(c):
    eng=Counter(B[i]['en'] for i in c); sy=Counter(x for i in c for x in B[i].get('sy',[]))
    ins=Counter(x for i in c for x in B[i].get('in',[]) if x!='none')
    mo=Counter(x for i in c for x in B[i].get('mo',[]))
    e,en=eng.most_common(1)[0]
    parts=[e.replace('-',' ')]
    if sy and sy.most_common(1)[0][1]/len(c)>=.4: parts.append(sy.most_common(1)[0][0].replace('-',' '))
    elif ins and ins.most_common(1)[0][1]/len(c)>=.4: parts.append(ins.most_common(1)[0][0].replace('-',' '))
    elif mo and mo.most_common(1)[0][1]/len(c)>=.5: parts.append(mo.most_common(1)[0][0])
    return " · ".join(parts), round(100*en/len(c))

meta=[]
for ci,c in enumerate(comms):
    lab,pur=label(c)
    for i in c: B[i]['cl']=ci
    meta.append({"id":ci,"label":lab,"n":len(c),"purity":pur})
    print(f"  {ci}: {lab:<42} {len(c):>3} books ({pur}% pure)")
for b in B: b.setdefault('cl',len(comms))
json.dump(B,open('src/data/books.json','w'),ensure_ascii=False)
json.dump({"k":K,"modularity":round(q,3),"clusters":meta,
           "edges":[[a,b,round(w,2)] for (a,b),w in edges.items()]},
          open('src/data/graph.json','w'),separators=(",",":"))
print(f"\nsaved graph.json: {len(edges)} edges, {len(meta)} clusters")
