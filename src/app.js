const ENGINES=["investigation","heist","campaign-war","mystery-box","ascent-of-power","institutional-politics","survival","quest"];
const AXES=[
  {k:0,n:"velocity",dir:"min",note:"how hard the plot pulls"},
  {k:1,n:"friction",dir:"max",note:"cost of getting in"},
  {k:2,n:"interiority",dir:"max",note:"time spent inside heads"},
  {k:3,n:"darkness",dir:"min",note:"cozy to bleak"},
  {k:4,n:"romance_load",dir:"max",note:"how central romance is"},
  {k:5,n:"prose_shine",dir:"min",note:"serviceable to luminous"},
  {k:6,n:"formula",dir:"max",note:"how much the series repeats"}
];
const FIT={0:4,1:3,2:4,3:1,4:2,5:3,6:3};
const MODEL=window.__DATA__.model;
/* Predicted fit is banded, not ranked: residual sd is 0.65, so gaps
   smaller than that are noise and must not be drawn as if they were real. */
const BANDS=[[4.6,"strong"],[4.2,"good"],[0,"moderate"]];
const band=p=>BANDS.findIndex(b=>p>=b[0]);
const tier=n=>2-band(n.p);
const FACETS=[["mi",1.0],["sy",1.5],["in",1.25],["ca",1.0],["mo",1.0]];
const DATA=window.__DATA__.books;

/* ---------- graph ---------- */
const nodes=DATA.map((b,i)=>({...b,id:i}));
const links=[];
{
  const raw=[];
  for(let i=0;i<nodes.length;i++)for(let j=i+1;j<nodes.length;j++){
    const A=nodes[i],B=nodes[j];let w=0;const sh=[];
    const ea=[A.en,...(A.ea||[])],eb=[B.en,...(B.ea||[])];
    ea.forEach(v=>{if(eb.includes(v)){w+=2;sh.push(v)}});
    FACETS.forEach(([k,wt])=>(A[k]||[]).forEach(v=>{if((B[k]||[]).includes(v)){w+=wt;sh.push(v)}}));
    if(A.st===B.st)w+=.5;
    if(w>0)raw.push({s:i,t:j,w,sh});
  }
  raw.sort((a,b)=>b.w-a.w);
  const deg=new Array(nodes.length).fill(0);
  raw.forEach(e=>{
    if(e.w>=6||deg[e.s]<4||deg[e.t]<4){
      links.push({source:nodes[e.s],target:nodes[e.t],w:e.w,shared:[...new Set(e.sh)]});
      deg[e.s]++;deg[e.t]++;
    }
  });
}

/* ---------- state ---------- */
const limits={};AXES.forEach(a=>limits[a.k]=a.dir==="min"?1:5);
let showRead=true,showRec=true,offEngines=new Set();
let hover=null,selected=null;
const REDUCED=matchMedia('(prefers-reduced-motion:reduce)').matches;
let flat=false,spin=true,spotlight=true;
/* Three ways in, because one is never enough for 274 books:
   graph = how books relate · field = why the model scores them · list = pick one */
let view="mood";
let yaw=.6,pitch=-.32,yawT=.6,pitchT=-.32,zoom=1;
const FOCAL=880,DIST=880;
const reduceMotion=matchMedia("(prefers-reduced-motion: reduce)").matches;
if(reduceMotion)spin=false;

/* every tag a book carries, across facets + engine + thresholded SG moods */
const MOOD_CUT=40;                              // a book "is" a mood if >=40% of readers said so
function tagsOf(b){
  const t=new Set([b.en,...(b.ea||[]),b.st]);
  ["mi","sy","in","ca","mo"].forEach(k=>(b[k]||[]).forEach(v=>t.add(v)));
  if(b.moods)for(const[m,pct]of Object.entries(b.moods))if(pct>=MOOD_CUT)t.add("mood:"+m);
  return t;
}
let activeTags=new Set();                        // AND filter: book must carry all selected

function passes(b){
  if(b.r>0&&!showRead)return false;
  if(b.r===0&&!showRec)return false;
  if(offEngines.has(b.en))return false;
  if(!AXES.every(a=>a.dir==="min"?b.ax[a.k]>=limits[a.k]:b.ax[a.k]<=limits[a.k]))return false;
  if(activeTags.size){
    const T=b._tags||(b._tags=tagsOf(b));
    for(const t of activeTags)if(!T.has(t))return false;
  }
  return true;
}

/* ---------- canvas ---------- */
const cv=document.getElementById("cv"),ctx=cv.getContext("2d");
let W=0,H=0;const DPR=Math.min(devicePixelRatio||1,2);
const css=n=>getComputedStyle(document.documentElement).getPropertyValue("--"+n).trim();
const COLOR={};ENGINES.forEach(e=>COLOR[e]=css(e));
const V=css("vellum"),DIMC=css("dim"),FAINT=css("faint"),FIELD=css("field");
const RGB={};[...ENGINES,"vellum","dim","faint","field"].forEach(k=>{
  const h=(COLOR[k]||css(k)).replace("#","");
  RGB[k]=[parseInt(h.slice(0,2),16),parseInt(h.slice(2,4),16),parseInt(h.slice(4,6),16)];
});
const FIELD_RGB=RGB.field;
/* fog toward the background colour, then alpha — atmospheric depth */
function shade(key,a,fog){
  const c=RGB[key]||RGB.dim;
  const m=t=>Math.round(c[t]+(FIELD_RGB[t]-c[t])*fog);
  return `rgba(${m(0)},${m(1)},${m(2)},${a})`;
}
/* One size scale across the whole graph: dot area reads as "how good".
   Read books use the actual rating. Unread use the BAND midpoint, not the raw
   prediction — sizing by raw p would draw 4.87 vs 4.79 as a visible difference
   when the residual is +/-0.65. */
const BANDMID=[4.8,4.4,4.0];
const ratingOf=n=>n.r>0?n.r:BANDMID[band(n.p)];
const SIZE=v=>3.2+(v-1)*2.1;                 // 1 star -> 3.2px, 5 star -> 11.6px
const radius=n=>SIZE(ratingOf(n));

let userZoomed=false;
function drawFieldAxes(){
  // Project a grid point through the same transform the nodes use, so the
  // gridlines stay locked to the books sitting on them.
  const cy=Math.cos(yaw),sy=Math.sin(yaw),cp=Math.cos(pitch),sp=Math.sin(pitch);
  const P=(gx,gy)=>{
    const x1=gx*cy, z1=gx*sy;
    const y2=gy*cp-z1*sp, z2=gy*sp+z1*cp;
    const k=FOCAL/Math.max(120,z2+DIST);
    return [W/2+x1*k*zoom, H/2+y2*k*zoom];
  };
  const S=115, R=2*S+40;
  ctx.save();
  ctx.lineWidth=1;
  for(let v=1;v<=5;v++){
    const g=(v-3)*S;
    ctx.strokeStyle=shade("rule",v===3?.85:.4,0);
    let a=P(g,-R),b=P(g,R);
    ctx.beginPath();ctx.moveTo(a[0],a[1]);ctx.lineTo(b[0],b[1]);ctx.stroke();
    a=P(-R,g);b=P(R,g);
    ctx.beginPath();ctx.moveTo(a[0],a[1]);ctx.lineTo(b[0],b[1]);ctx.stroke();
  }
  ctx.font="9px 'IBM Plex Mono',ui-monospace,monospace";
  ctx.fillStyle=shade("faint",.95,0);
  ctx.textAlign="center";ctx.textBaseline="top";
  const bl=P(0,R+34); ctx.fillText("READERS' PACE   →   FASTER",bl[0],bl[1]);
  ctx.textAlign="right";ctx.textBaseline="middle";
  const lf=P(-R-16,0); ctx.fillText("PULLS YOU HARDER  ↑",lf[0],lf[1]);
  // name the corner the model says is his
  ctx.font="italic 12.5px Spectral,Georgia,serif";
  ctx.textAlign="left";ctx.textBaseline="middle";
  ctx.fillStyle=shade("heist",.55,0);
  const q=P(-R+14,-R+30); ctx.fillText("immersive slow burns — your corner",q[0],q[1]);
  ctx.fillStyle=shade("faint",.45,0);
  const q2=P(S*0.6,R-16); ctx.fillText("fast, but you rate these lower",q2[0],q2[1]);
  ctx.restore();
}
function fieldTarget(n){
  // x is continuous (community pace), but "pull" is a 1-5 integer, so 136 books
  // would stack on one line. Spread each row by predicted fit — a real signal,
  // not jitter — so vertical position within a band still means something.
  const pace=n.cpace!=null?n.cpace:n.ax[0];
  const pull=n.ax[0];
  const fit=n.praw??n.p??3.5;
  const spread=Math.max(-1,Math.min(1,(fit-4)/1.2))*46;
  return {x:(pace-3)*118, y:-(pull-3)*118 - spread, z:0};
}
function fitView(){
  if(userZoomed)return;
  // Fit across a full yaw sweep at the CURRENT pitch. Drift only spins yaw, so
  // this is invariant under the automatic motion and never jitters — while
  // being far tighter than a whole-sphere worst case, which assumed a solid
  // shell and wasted ~40% of the frame. Tilting hard by hand can still push a
  // node near the edge; that is a deliberate trade for a readable default view.
  let worst=1;
  const cb=Math.cos(pitch), sb=Math.sin(pitch);
  for(let i=0;i<16;i++){
    const a=i*Math.PI/8, ca=Math.cos(a), sa=Math.sin(a);
    for(const n of nodes){
      const x=n.x*ca-n.z*sa, z0=n.x*sa+n.z*ca;
      const y=n.y*cb-z0*sb, z=n.y*sb+z0*cb;
      const k=FOCAL/Math.max(40,DIST-z);
      const e=Math.max(Math.abs(x*k),Math.abs(y*k))+radius(n)*k+4;
      if(e>worst)worst=e;
    }
  }
  const pad=W<600?14:22;
  zoom=Math.max(.16,Math.min(2.2,(Math.min(W,H)/2-pad)/worst));
}
function resize(){
  const r=cv.parentElement.getBoundingClientRect();
  W=Math.max(320,r.width);H=Math.max(360,r.height);
  cv.width=W*DPR;cv.height=H*DPR;
  ctx.setTransform(DPR,0,0,DPR,0,0);
  fitView();reheat(.3);
}

/* ---------- 3D force simulation ---------- */
const CHARGE=-190,VDECAY=.6,ADECAY=.0228;
let alpha=1,running=false;
nodes.forEach((n,i)=>{                       // spherical Fibonacci seed
  const t=i/nodes.length, ph=Math.acos(1-2*t), th=i*2.399963229728653, r=190;
  n.x=r*Math.sin(ph)*Math.cos(th); n.y=r*Math.sin(ph)*Math.sin(th); n.z=r*Math.cos(ph);
  n.vx=n.vy=n.vz=0;
});

function step(){
  if(view==="field"){        // pinned layout: springs and repulsion would fight
    for(const n of nodes){   // the pins, so the graph forces are skipped entirely
      const t=fieldTarget(n);
      n.vx=(n.vx+(t.x-n.x)*.16)*.62;
      n.vy=(n.vy+(t.y-n.y)*.16)*.62;
      n.vz=(n.vz+(0-n.z)*.16)*.62;
      n.x+=n.vx;n.y+=n.vy;n.z+=n.vz;
    }
    return;
  }
  alpha+=(0-alpha)*ADECAY;
  for(const l of links){
    const dx=l.target.x-l.source.x,dy=l.target.y-l.source.y,dz=l.target.z-l.source.z;
    const d=Math.sqrt(dx*dx+dy*dy+dz*dz)||1;
    const rest=118-l.w*4.5,k=Math.min(.55,l.w/16),f=(d-rest)/d*alpha*k*.5;
    l.source.vx+=dx*f;l.source.vy+=dy*f;l.source.vz+=dz*f;
    l.target.vx-=dx*f;l.target.vy-=dy*f;l.target.vz-=dz*f;
  }
  for(let i=0;i<nodes.length;i++){
    const a=nodes[i];
    for(let j=i+1;j<nodes.length;j++){
      const b=nodes[j];
      let dx=b.x-a.x,dy=b.y-a.y,dz=b.z-a.z,d2=dx*dx+dy*dy+dz*dz;
      if(d2<36){d2=36;dx=dx||.6;dy=dy||.6;dz=dz||.6;}
      const w=CHARGE*alpha/d2;
      a.vx+=dx*w;a.vy+=dy*w;a.vz+=dz*w;
      b.vx-=dx*w;b.vy-=dy*w;b.vz-=dz*w;
    }
  }
  for(const n of nodes){                     // gravity toward origin
    n.vx+=-n.x*.055*alpha; n.vy+=-n.y*.055*alpha;
    n.vz+=flat? -n.z*.34 : -n.z*.055*alpha;  // flat mode collapses depth
    n.vx*=VDECAY;n.vy*=VDECAY;n.vz*=VDECAY;
    const vmax=140, v2=n.vx*n.vx+n.vy*n.vy+n.vz*n.vz;  // clamp runaway velocity
    if(v2>vmax*vmax){const s=vmax/Math.sqrt(v2);n.vx*=s;n.vy*=s;n.vz*=s;}
    n.x+=n.vx;n.y+=n.vy;n.z+=n.vz;
  }
  // kill center-of-mass drift: at high node counts the summed repulsion can
  // outrun origin gravity and translate the whole cloud toward infinity.
  let cx=0,cy=0,cz=0;
  for(const n of nodes){cx+=n.x;cy+=n.y;cz+=n.z;}
  cx/=nodes.length;cy/=nodes.length;cz/=nodes.length;
  if(cx||cy||cz)for(const n of nodes){n.x-=cx;n.y-=cy;n.z-=cz;}
  for(let p=0;p<2;p++){                      // collision relaxation in 3D
    for(let i=0;i<nodes.length;i++){
      const a=nodes[i],ra=radius(a)+12;
      for(let j=i+1;j<nodes.length;j++){
        const b=nodes[j],min=ra+radius(b)+12;
        let dx=b.x-a.x,dy=b.y-a.y,dz=b.z-a.z;
        let d=Math.sqrt(dx*dx+dy*dy+dz*dz);
        if(d===0){dx=.8;dy=.8;dz=.8;d=1.4;}
        if(d<min){
          const push=(min-d)/d*.5;
          a.x-=dx*push;a.y-=dy*push;a.z-=dz*push;
          b.x+=dx*push;b.y+=dy*push;b.z+=dz*push;
        }
      }
    }
  }
}

/* ---------- projection ---------- */
function project(){
  const cy=Math.cos(yaw),sy=Math.sin(yaw),cp=Math.cos(pitch),sp=Math.sin(pitch);
  let near=1e9,far=-1e9;
  for(const n of nodes){
    const x1=n.x*cy-n.z*sy, z1=n.x*sy+n.z*cy;
    const y2=n.y*cp-z1*sp,  z2=n.y*sp+z1*cp;
    const zc=z2+DIST, k=FOCAL/Math.max(120,zc);
    n.PX=W/2+x1*k*zoom; n.PY=H/2+y2*k*zoom; n.PK=k*zoom; n.PZ=zc;
    if(zc<near)near=zc; if(zc>far)far=zc;
  }
  const span=Math.max(1,far-near);
  for(const n of nodes) n.fog=flat?0:Math.min(.82,Math.max(0,(n.PZ-near)/span)*.82);
}

/* ---------- render ---------- */
function draw(){
  project();
  ctx.clearRect(0,0,W,H);
  const focus=hover??selected;
  const near=new Set();
  if(focus!==null)for(const l of links){
    if(l.source.id===focus)near.add(l.target.id);
    if(l.target.id===focus)near.add(l.source.id);
  }

  if(view==="field")drawFieldAxes();

  const items=[];
  // edges say nothing in the field — position carries the meaning there — and
  // they were ~69% of frame cost, so the pinned view drops them entirely
  if(view!=="field")for(const l of links) items.push({d:(l.source.PZ+l.target.PZ)/2,l});
  for(const n of nodes) items.push({d:n.PZ,n});
  items.sort((a,b)=>b.d-a.d);               // painter's algorithm, far to near

  // On a phone, 20+ neighbour titles collide into an unreadable mat. Name only
  // the nearest few (camera-facing = most legible); the lit nodes and the count
  // chip still convey the full set.
  const placed=[],labelQueue=[];    // labels resolved after nodes, nearest-first
  const labelCap=W<620?6:99;
  let namable=null;
  if(focus!==null&&labelCap<99){
    namable=new Set(
      [...near].map(id=>nodes[id]).filter(passes)
        .sort((a,b)=>a.PZ-b.PZ).slice(0,labelCap).map(n=>n.id));
  }

  for(const it of items){
    if(it.l){
      const l=it.l, on=focus!==null&&(l.source.id===focus||l.target.id===focus);
      const live=passes(l.source)&&passes(l.target);
      const fog=(l.source.fog+l.target.fog)/2;
      if(focus!==null&&!on){
        ctx.strokeStyle=shade("faint",live?.07:.03,fog);ctx.lineWidth=.6;
      }else if(on){
        ctx.strokeStyle=shade(nodes[focus].en,.62,fog*.4);
        ctx.lineWidth=Math.min(2.4,.5+l.w/6);
      }else{
        ctx.strokeStyle=shade("faint",live?.26:.05,fog);
        ctx.lineWidth=Math.min(1.5,.35+l.w/12);
      }
      ctx.beginPath();ctx.moveTo(l.source.PX,l.source.PY);ctx.lineTo(l.target.PX,l.target.PY);ctx.stroke();
    }else{
      const n=it.n,live=passes(n),isF=n.id===focus,adj=near.has(n.id),rec=n.r===0;
      let a=live?1:.14;
      if(spotlight&&!rec)a*=.42;               // read books drop back to context
      if(focus!==null&&!isF&&!adj)a*=.13;      // unrelated recede hard, so the
      if(focus!==null&&adj)a=Math.min(1,a*1.5);// related cluster reads as a group
      const rr=Math.max(2.2,radius(n)*n.PK);
      if(rec){
        const t=tier(n);
        for(let h=t;h>=1;h--){                 // halo rings: one per band, never continuous
          ctx.beginPath();ctx.arc(n.PX,n.PY,rr+h*4.5*n.PK,0,6.2832);
          ctx.strokeStyle=shade(n.en,a*(.3-h*.06),n.fog*.5);
          ctx.lineWidth=Math.max(.8,1.4*n.PK);ctx.stroke();
        }
        ctx.beginPath();ctx.arc(n.PX,n.PY,rr,0,6.2832);
        ctx.fillStyle=shade(n.en,a*.3,n.fog);ctx.fill();
        ctx.strokeStyle=shade(n.en,a,n.fog*.5);
        ctx.lineWidth=Math.max(1.4,2.6*n.PK);ctx.stroke();
      }else{
        ctx.beginPath();ctx.arc(n.PX,n.PY,rr,0,6.2832);
        ctx.fillStyle=shade(n.en,a,n.fog);ctx.fill();
      }
      if(isF||n.id===selected){
        ctx.beginPath();ctx.arc(n.PX,n.PY,rr+5,0,6.2832);
        ctx.strokeStyle=shade("vellum",.75,0);ctx.lineWidth=1;ctx.stroke();
      }
      // labels: focus, its neighbours, and near-camera 5-star anchors
      // Label density has to scale with the frame: on a phone, labelling all
      // 179 recommendations turns the centre into a smear. Near-camera, top-band
      // books earn a name; the rest are reachable by tapping.
      const small=W<620;
      const anchor=live&&(small
        ? (rec&&tier(n)>=2&&n.fog<.3) || (n.r===5&&n.fog<.16&&!spotlight)
        : (rec||(n.r===5&&n.fog<.34&&!spotlight)));
      // when something is focused, ONLY the focus and its neighbours get named —
      // anchor labels would otherwise compete with the answer to "what relates"
      const show=focus!==null
        ? (isF||n.id===selected||(adj&&(!namable||namable.has(n.id))))
        : (anchor||n.id===selected);
      if(show){
        const fs=Math.max(9.5,11.5*Math.min(1.15,n.PK));
        const nm=n.t.length>32?n.t.slice(0,30)+"…":n.t;
        labelQueue.push({n,isF,adj,rec,fs,
          txt:rec?nm+"  "+n.p.toFixed(1):nm,
          y:n.PY+rr+5+(rec?tier(n)*4*n.PK:0)});
      }
    }
  }

  // Labels resolve after all nodes are painted, claimed nearest-camera first so
  // the most legible title wins contested space. A title that overprints another
  // is worse than no title, so losers are simply dropped.
  labelQueue.sort((a,b)=>(b.isF?1:0)-(a.isF?1:0)||a.n.PZ-b.n.PZ);
  ctx.textAlign="center";ctx.textBaseline="top";
  for(const L of labelQueue){
    ctx.font=(L.isF||L.adj?"600 ":"")+L.fs+"px Spectral,Georgia,serif";
    const lw=ctx.measureText(L.txt).width, lh=13, lx=L.n.PX-lw/2;
    const hits=y=>{
      for(const p of placed)if(lx<p[2]&&p[0]<lx+lw&&y<p[3]&&p[1]<y+lh)return true;
      return false;
    };
    // a crowded cluster can still show most of its titles if they're allowed to
    // step aside slightly; only give up when no nearby slot is free
    let y=L.y;
    if(!L.isF&&hits(y)){
      const alt=[L.y+14,L.y-15,L.y+28,L.y-29];
      y=alt.find(c=>!hits(c));
      if(y===undefined)continue;
    }
    placed.push([lx,y,lx+lw,y+lh]);
    const la=L.isF?1:(L.adj?.95:.92);
    ctx.fillStyle=shade(L.isF?"vellum":(L.adj?"vellum":"dim"),la,L.isF||L.adj?0:L.n.fog*.7);
    ctx.fillText(L.txt,L.n.PX,y);
  }

  // On focus: the question is "which books relate to this one", so neighbour
  // titles win. Shared tags collapse into one summary chip instead of one
  // opaque label per edge (which used to bury the titles underneath).
  if(focus!==null){
    const f=nodes[focus];
    const tally=new Map();
    let n=0;
    for(const l of links){
      if(l.source.id!==focus&&l.target.id!==focus)continue;
      const o=l.source.id===focus?l.target:l.source;
      if(!passes(o))continue;
      n++;
      for(const s of l.shared)tally.set(s,(tally.get(s)||0)+1);
    }
    const narrow=W<620;
    // On a phone the full tag breakdown runs wider than the screen, so drop to
    // the two strongest shared tags and let the count carry the rest.
    const top=[...tally.entries()].sort((a,b)=>b[1]-a[1]).slice(0,narrow?2:3);
    if(n){
      const fs=narrow?9:9.5;
      ctx.font=fs+"px 'IBM Plex Mono',ui-monospace,monospace";
      let txt=`${n} related · `+top.map(([t,c])=>`${t} ${c}`).join("  ");
      const maxw=W-24;
      while(ctx.measureText(txt).width>maxw&&top.length>1){   // shed tags until it fits
        top.pop(); txt=`${n} related · `+top.map(([t,c])=>`${t} ${c}`).join("  ");
      }
      if(ctx.measureText(txt).width>maxw)txt=`${n} related`;
      const w=ctx.measureText(txt).width;
      // keep the chip fully on-canvas even when the focused node sits at an edge
      const bx=Math.min(W-w/2-10,Math.max(w/2+10,f.PX));
      const by=Math.max(14,f.PY-Math.max(2.2,radius(f)*f.PK)-19);
      ctx.textAlign="center";ctx.textBaseline="middle";
      ctx.fillStyle=shade("field",.92,0);
      ctx.fillRect(bx-w/2-7,by-8,w+14,16);
      ctx.strokeStyle=shade(f.en,.5,0);ctx.lineWidth=1;
      ctx.strokeRect(bx-w/2-7,by-8,w+14,16);
      ctx.fillStyle=shade(f.en,.95,0);
      ctx.fillText(txt,bx,by);
    }
  }
}

/* ---------- loop ---------- */
/* Ambient rotation is atmosphere, not information — someone who asks the OS for
   less motion should get a still graph they drive themselves (REDUCED, above). */
let dragging=false;
function loop(){
  let settling=false;
  if(view==="field"){                    // pinned layout ignores the cooling schedule
    let moved=0;
    for(const n of nodes){const t=fieldTarget(n);
      moved+=Math.abs(n.x-t.x)+Math.abs(n.y-t.y)+Math.abs(n.z);}
    settling=moved/nodes.length>0.6;
    if(settling){step();fitView();}
  }
  const simming=(view!=="field"&&alpha>.004)||settling;
  if(simming&&view!=="field"){step();fitView();}             // re-frame while the cloud is still expanding
  if(spin&&!REDUCED&&!dragging&&hover===null)yawT+=.0016;
  yaw+=(yawT-yaw)*.12; pitch+=(pitchT-pitch)*.12;
  if(flat){yawT=0;pitchT=0;}
  const moving=simming||spin&&!dragging&&hover===null||
    Math.abs(yawT-yaw)>1e-4||Math.abs(pitchT-pitch)>1e-4;
  draw();
  if(moving)requestAnimationFrame(loop);
  else running=false;
}
function reheat(a){alpha=Math.max(alpha,a||0);kick()}
function kick(){if(!running){running=true;requestAnimationFrame(loop)}}

/* ---------- interaction ---------- */
function pick(mx,my){
  let best=null,bz=1e9;
  for(const n of nodes){
    const rr=Math.max(3,radius(n)*n.PK)+8;
    if(Math.hypot(n.PX-mx,n.PY-my)<rr&&n.PZ<bz){bz=n.PZ;best=n.id}
  }
  return best;                                 // nearest to camera wins
}
let px=0,py=0,moved=0,pid=null;
const pts=new Map();let pinch0=0,zoom0=1;

cv.addEventListener("pointerdown",e=>{
  cv.setPointerCapture(e.pointerId);
  pts.set(e.pointerId,{x:e.clientX,y:e.clientY});
  if(pts.size===2){
    const[a,b]=[...pts.values()];
    pinch0=Math.hypot(a.x-b.x,a.y-b.y);zoom0=zoom;
  }else{dragging=true;px=e.clientX;py=e.clientY;moved=0;pid=e.pointerId;}
});
cv.addEventListener("pointermove",e=>{
  if(pts.has(e.pointerId))pts.set(e.pointerId,{x:e.clientX,y:e.clientY});
  if(pts.size===2){
    const[a,b]=[...pts.values()];
    const d=Math.hypot(a.x-b.x,a.y-b.y);
    if(pinch0>0){userZoomed=true;zoom=Math.max(.16,Math.min(3,zoom0*d/pinch0));kick()}
    return;
  }
  if(dragging&&e.pointerId===pid){
    const dx=e.clientX-px,dy=e.clientY-py;
    moved+=Math.abs(dx)+Math.abs(dy);
    if(!flat){
      yawT+=dx*.0065;
      pitchT=Math.max(-1.45,Math.min(1.45,pitchT+dy*.0065));
    }
    px=e.clientX;py=e.clientY;kick();return;
  }
  const r=cv.getBoundingClientRect();
  const h=pick(e.clientX-r.left,e.clientY-r.top);
  if(h!==hover){
    hover=h;cv.style.cursor=h!==null?"pointer":(flat?"default":"grab");
    if(h!==null)document.getElementById("hint").style.opacity=0;
    kick();
  }
});
function endPointer(e){
  pts.delete(e.pointerId);
  if(pts.size<2)pinch0=0;
  if(dragging&&e.pointerId===pid){
    dragging=false;
    if(moved<5){
      const r=cv.getBoundingClientRect();
      selected=pick(e.clientX-r.left,e.clientY-r.top);
      renderDetail();
      if(selected!==null)revealDetail();
    }
    kick();
  }
}
cv.addEventListener("pointerup",endPointer);
cv.addEventListener("pointercancel",endPointer);
cv.addEventListener("pointerleave",()=>{if(!dragging&&hover!==null){hover=null;kick()}});
cv.addEventListener("wheel",e=>{
  e.preventDefault();
  userZoomed=true;zoom=Math.max(.16,Math.min(3,zoom*(e.deltaY>0?.92:1.087)));kick();
},{passive:false});

/* ---------- detail panel ---------- */
const AXMEAN=AXES.map(a=>{
  const rd=nodes.filter(n=>n.r>0);
  return rd.reduce((s,n)=>s+n.ax[a.k],0)/rd.length;
});
function renderRanked(){
  const el=document.getElementById("detail");
  const recs=nodes.filter(n=>n.r===0&&passes(n)).sort((a,b)=>(b.praw??b.p)-(a.praw??a.p));
  let h='<div class="eyebrow">Predicted fit · '+recs.length+' unread</div>';
  if(!recs.length) h+='<p class="empty">No unread books match these filters.</p>'+
    '<button id="empty-clear" type="button" style="margin-top:10px">Clear all filters</button>';
  let last=-1;
  recs.forEach(n=>{
    const bd=band(n.p);
    if(bd!==last){
      last=bd;
      h+='<div class="bandhead"><span>'+BANDS[bd][1]+' fit</span><span>'+
         (bd===0?'4.6+':bd===1?'4.2–4.6':'below 4.2')+'</span></div>';
    }
    h+='<div class="rank" data-id="'+n.id+'"><span class="rank-s">'+n.p.toFixed(1)+'</span>'+
       '<span class="rank-t">'+n.t+'<i>'+n.a+'</i></span>'+
       '<span class="rank-bar"><div style="width:'+Math.round((n.p-3.5)/1.5*100)+'%;background:'+COLOR[n.en]+'"></div></span></div>';
  });
  h+='<p class="caveat">Scored from the seven register axes only — the facets turned out to carry '+
     'no predictive signal, so they build the graph but not the score. Model agrees with past ratings '+
     'at r='+MODEL.r+', residual ±'+MODEL.sd+'. Gaps smaller than that are noise, which is why these '+
     'sit in bands rather than a strict ranking.</p>';
  el.innerHTML=h;
  el.querySelectorAll(".rank").forEach(d=>d.onclick=()=>{
    selected=+d.dataset.id;renderDetail();revealDetail();kick();});
  const ec=el.querySelector("#empty-clear");
  if(ec)ec.onclick=()=>clearAllFilters();
}
function predBlock(b){
  const ups=AXES.map(a=>({n:a.n,c:MODEL.coef[a.k]*(b.ax[a.k]-AXMEAN[a.k])}))
    .filter(o=>Math.abs(o.c)>=.08).sort((x,y)=>Math.abs(y.c)-Math.abs(x.c)).slice(0,3);
  return `<div class="pred">
    <div class="pred-l">Predicted fit${b.r>0?" (model, ignoring your actual rating)":""}</div>
    <div class="pred-n">${b.p.toFixed(1)} <small>± ${MODEL.sd}</small></div>
    ${b.weber_risk?`<div style="font-size:10.5px;color:var(--campaign-war);margin-top:6px">⚠ plain prose + formulaic — the Weber profile you bounce on</div>`:""}
    ${b.r===0&&b.kingsim>=0.6?`<div style="font-size:10.5px;color:var(--heist);margin-top:6px">↑ King-adjacent — lifted for your guarded-ceiling King ratings</div>`:""}
    <div style="margin-top:8px">${ups.map(o=>
      `<div class="contrib"><span>${o.n}</span><b style="color:${o.c>0?"var(--quest)":"var(--campaign-war)"}">${o.c>0?"+":""}${o.c.toFixed(2)}</b></div>`).join("")}</div>
  </div>`;
}
/* Ratings you enter here can't reach the fitted model — that refit happens
   offline — so they're held for the session and exported as JSON to paste back. */
/* ---------- rating persistence ----------
   Three layers, deliberately independent:
     1. localStorage  — automatic, no setup, per-browser
     2. file          — export/import JSON, portable and account-free
     3. GitHub gist   — optional cross-device sync with a token you supply
   Layer 1 covers the common case; 2 and 3 exist because a browser profile is
   not a backup. Nothing is sent anywhere unless you configure layer 3. */
const LS_KEY="reading-network:ratings", LS_TOK="reading-network:gist";
let myRatings={};
let storageOK=(()=>{try{localStorage.setItem("__t","1");localStorage.removeItem("__t");return true}
  catch(e){return false}})();

function loadRatings(){
  if(!storageOK)return;
  try{
    const raw=localStorage.getItem(LS_KEY);
    if(raw)myRatings=JSON.parse(raw)||{};
  }catch(e){myRatings={}}
}
function saveRatings(){
  if(!storageOK)return false;
  try{localStorage.setItem(LS_KEY,JSON.stringify(myRatings));return true}
  catch(e){return false}
}
/* Ratings are stored by title and re-applied to the baked-in data at load, so a
   rebuilt data file keeps your ratings as long as titles are unchanged. */
function applyRatings(){
  let n=0;
  for(const b of nodes){
    if(Object.prototype.hasOwnProperty.call(myRatings,b.t)){
      const v=myRatings[b.t];
      if(v===null||v===undefined){ if(b._origR!==undefined)b.r=b._origR; }
      else { if(b._origR===undefined)b._origR=b.r; b.r=v; n++; }
    }
  }
  return n;
}
function setRating(b,v){
  if(b._origR===undefined)b._origR=b.r;
  if(v===0){ delete myRatings[b.t]; b.r=b._origR||0; }
  else { myRatings[b.t]=v; b.r=v; }
  saveRatings();
  if(gistToken()&&gistId())scheduleGistPush();
}
function ratingsCount(){return Object.keys(myRatings).length}

/* ---- layer 2: file ---- */
function downloadRatings(){
  const blob=new Blob([JSON.stringify(myRatings,null,1)],{type:"application/json"});
  const a=document.createElement("a");
  a.href=URL.createObjectURL(blob);
  a.download="reading-ratings-"+new Date().toISOString().slice(0,10)+".json";
  a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),2000);
}
function importRatingsFile(file){
  const fr=new FileReader();
  fr.onload=()=>{
    try{
      const inc=JSON.parse(fr.result);
      if(typeof inc!=="object"||Array.isArray(inc))throw new Error("not an object");
      let added=0;
      for(const [k,v] of Object.entries(inc)){
        if(typeof v==="number"&&v>=1&&v<=5){myRatings[k]=v;added++;}
      }
      saveRatings(); applyRatings(); update(); renderDetail(); kick();
      syncNote(`Imported ${added} rating${added===1?"":"s"}.`);
    }catch(e){ syncNote("That file isn't a ratings export.",true); }
  };
  fr.readAsText(file);
}

/* ---- layer 3: GitHub gist ---- */
const gistToken=()=>{try{return localStorage.getItem(LS_TOK+":token")||""}catch(e){return ""}};
const gistId   =()=>{try{return localStorage.getItem(LS_TOK+":id")||""}catch(e){return ""}};
function setGist(token,id){
  try{
    if(token!==null)localStorage.setItem(LS_TOK+":token",token);
    if(id!==null)localStorage.setItem(LS_TOK+":id",id);
  }catch(e){}
}
let gistTimer=null;
function scheduleGistPush(){clearTimeout(gistTimer);gistTimer=setTimeout(gistPush,1500);}
async function gistApi(path,opts){
  const r=await fetch("https://api.github.com"+path,{
    ...opts,
    headers:{"Accept":"application/vnd.github+json",
             "Authorization":"Bearer "+gistToken(),
             "Content-Type":"application/json",...(opts&&opts.headers||{})}});
  if(!r.ok)throw new Error("GitHub "+r.status+(r.status===401?" — token rejected":""));
  return r.json();
}
async function gistPush(){
  if(!gistToken())return syncNote("Add a GitHub token first.",true);
  const body={description:"reading-network ratings",
    files:{"ratings.json":{content:JSON.stringify(myRatings,null,1)}}};
  try{
    let id=gistId();
    const out = id ? await gistApi("/gists/"+id,{method:"PATCH",body:JSON.stringify(body)})
                   : await gistApi("/gists",{method:"POST",body:JSON.stringify({...body,public:false})});
    setGist(null,out.id);
    syncNote(`Synced ${ratingsCount()} ratings to gist ${out.id.slice(0,7)}.`);
    renderSync();
  }catch(e){ syncNote(String(e.message),true); }
}
async function gistPull(){
  if(!gistToken()||!gistId())return syncNote("Need a token and a gist id.",true);
  try{
    const g=await gistApi("/gists/"+gistId());
    const f=g.files&&g.files["ratings.json"];
    if(!f)throw new Error("no ratings.json in that gist");
    const inc=JSON.parse(f.content);
    myRatings={...myRatings,...inc};
    saveRatings(); applyRatings(); update(); renderDetail(); kick();
    syncNote(`Pulled ${Object.keys(inc).length} ratings.`);
  }catch(e){ syncNote(String(e.message),true); }
}
function syncNote(msg,bad){
  const el=document.getElementById("sync-note");
  if(el){el.textContent=msg; el.className="sync-note"+(bad?" bad":"");}
}

/* ---------- detail-panel evidence ---------- */
/* A predicted number is a claim; the books it's extrapolating from are the
   evidence. Showing the nearest already-rated books lets you audit the guess. */
function nearestRated(b,k=3){
  const F=z=>z.ax.concat([z.cpace!=null?z.cpace:z.ax[0]]);
  const all=nodes.map(F), mu=[],sd=[];
  for(let i=0;i<8;i++){
    const col=all.map(v=>v[i]);
    const m=col.reduce((x,y)=>x+y,0)/col.length;
    mu[i]=m; sd[i]=Math.sqrt(col.reduce((x,y)=>x+(y-m)**2,0)/col.length)||1;
  }
  const zb=F(b).map((v,i)=>(v-mu[i])/sd[i]);
  return nodes.filter(z=>z.r>0&&z.id!==b.id)
    .map(z=>({z,d:Math.hypot(...F(z).map((v,i)=>(v-mu[i])/sd[i]-zb[i]))}))
    .sort((x,y)=>x.d-y.d).slice(0,k);
}
/* How much to trust the tags on this book. Measured earlier: my tagging is
   reproducible for well-known books and drifts badly on obscure ones. */
function tagConfidence(b){
  const n=b.nrev||0;
  if(n>=20000)return ["High","tagged from a book I know well"];
  if(n>=3000) return ["Medium","reasonably well-known; tags likely close"];
  if(n>=400)  return ["Low","obscure — my tags for books like this drift"];
  return ["Very low","almost no community data; treat the score as a guess"];
}
const MOOD_SHOW=45;
const META=window.__DATA__.meta;
const NEXTSER=window.__DATA__.next_in_series;
const snorm=x=>String(x).toLowerCase().replace(/^(the|a)\s+/,"").replace(/[^a-z0-9 ]/g,"").trim();

const AXMU=(()=>{const a=nodes=>0;return null;})();
function featOf(b){return b.ax.concat([b.cpace!=null?b.cpace:b.ax[0]]);}
let _mu=null,_sd=null;
function featStats(){
  if(_mu)return;
  const all=nodes.map(featOf); _mu=[];_sd=[];
  for(let i=0;i<8;i++){
    const c=all.map(v=>v[i]), m=c.reduce((x,y)=>x+y,0)/c.length;
    _mu[i]=m; _sd[i]=Math.sqrt(c.reduce((x,y)=>x+(y-m)**2,0)/c.length)||1;
  }
}
/* Books like this one that you haven't read — the "if you liked this" idiom the
   panel was missing. Distinct from nearestRated, which is evidence, not a rec. */
function similarUnread(b,k=3){
  featStats();
  const z=featOf(b).map((v,i)=>(v-_mu[i])/_sd[i]);
  return nodes.filter(x=>x.r===0&&x.id!==b.id)
    .map(x=>({x,d:Math.hypot(...featOf(x).map((v,i)=>(v-_mu[i])/_sd[i]-z[i]))}))
    .sort((a,c)=>a.d-c.d).slice(0,k);
}
/* Turn the heaviest axis contributions into a sentence. Measured: the top axis
   carries ~40% of the explanation, so naming one or two is defensible. */
/* Each phrase must read as a complete predicate after "because it …", so they
   are verb phrases, not adjectives. */
const AXWORD={
  velocity:["barely pulls you along","pulls you hard"],
  friction:["is easy to fall into","makes you work to get in"],
  interiority:["stays outside its characters","lives inside its characters"],
  darkness:["keeps a light tone","goes bleak"],
  romance_load:["keeps romance out of it","leans on romance"],
  prose_shine:["has workmanlike prose","is beautifully written"],
  formula:["avoids formula","runs to formula"],
  community_pace:["reads slow for most people","reads fast for most people"]
};
function explainScore(b){
  featStats();
  const f=featOf(b), keys=Object.keys(AXWORD);
  const c=f.map((v,i)=>({i,v,contrib:MODEL.coef[i]*(v-_mu[i])}));
  const up=c.filter(x=>x.contrib>0).sort((a,z)=>z.contrib-a.contrib);
  const dn=c.filter(x=>x.contrib<0).sort((a,z)=>a.contrib-z.contrib);
  const phrase=x=>{const w=AXWORD[keys[x.i]];return x.v>=_mu[x.i]?w[1]:w[0];};
  let out="";
  if(up.length&&up[0].contrib>0.05){
    out+=`Scores well because it <b>${phrase(up[0])}</b>`;
    if(up[1]&&up[1].contrib>0.05)out+=` and <b>${phrase(up[1])}</b>`;
    out+=".";
  }
  if(dn.length&&dn[0].contrib<-0.08){
    out+=`${out?" ":""}Held back because it <b>${phrase(dn[0])}</b>.`;
  }
  return out||"Sits near the middle of your library on every axis — no strong signal either way.";
}
/* Author and series stats come from all 433 rated books — the Goodreads export
   merged with every rating logged since — not just the 95 tagged ones. */
function authorRecord(b){
  const m=META.authors[b.a]; if(!m)return null;
  const n=m.n-(b.r>0?1:0); if(n<1)return null;
  return {n,mean:m.mean,titles:nodes.filter(x=>x.r>0&&x.a===b.a&&x.id!==b.id).slice(0,3).map(x=>x.t)};
}
/* Sequels to books you rated highly — sourced from Wikidata, since the Goodreads
   export only knows the volumes you already own. */
function nextInSeries(b){
  if(!b.ser)return null;
  const e=NEXTSER[snorm(b.ser)];
  if(!e||!e.next.length)return null;
  return e;
}
function seriesRecord(b){
  if(!b.ser)return null;
  const m=META.series[snorm(b.ser)];
  const vol=b.vol||null, readVols=m?m.vols:[];
  return {name:(m&&m.name)?m.name:b.ser, vol, n:m?m.n:0, mean:m?m.mean:null,
          haveFirst:readVols.includes(1), readVols};
}


function renderDetail(){
  const el=document.getElementById("detail");
  if(selected===null){ renderRanked(); return; }
  const b=nodes[selected];
  const chips=(arr,hot)=>(arr||[]).map(v=>`<span class="chip${hot?" hot":""}">${v}</span>`).join("");
  const bars=AXES.map(a=>{
    const v=b.ax[a.k],bad=a.dir==="min"?v<FIT[a.k]:v>FIT[a.k];
    return `<div class="bar"><div class="bar-head"><span>${a.n}</span><span>${v}/5</span></div>
      <div class="bar-track"><div class="bar-fill${bad?" bad":""}" style="width:${v*20}%"></div></div></div>`;
  }).join("");
  const flags=[];
  if(b.ax[3]>=4&&b.ax[0]<=2)flags.push(["Grimdark haze","Bleak with no drive underneath it — the shape that produced <i>Between Two Fires</i> and <i>The Vagrant</i>."]);
  if(b.ax[1]>=4&&b.ax[0]<=3)flags.push(["Cold door","On-target on facets, but a long way in. This is how <i>Blackwing</i> and <i>The Justice of Kings</i> got away."]);
  if(b.ax[6]>=4)flags.push(["Series machine","Installments repeat rather than escalate."]);
  if(b.ax[4]>=4)flags.push(["Romance-forward","Romance is doing the structural work."]);
  el.innerHTML=`
    <div class="eyebrow">${b.r===0?"Recommended":"Read"}</div>
    <div class="d-title">${b.t}</div>
    <div class="d-author"><button class="xlink" data-nav="author" data-k="${b.a.replace(/"/g,"&quot;")}">${b.a}</button></div>
    <div class="d-rating" style="border-color:${COLOR[b.en]};color:${COLOR[b.en]}">
      ${b.r===0?"not yet read":b.r+" of 5"}</div>
    ${b.blurb?`<div class="blurb-wrap"><div class="blurb ${b._open?"open":""}" id="blurb">${b.blurb}</div>${
      b.blurb.length>360?`<button class="blurb-more" id="blurb-more">${b._open?"less":"more"}</button>`:""}</div>`:""}
    ${predBlock(b)}
    <div class="facet"><div class="facet-label">Engine</div><div class="chips">${chips([b.en],true)}${chips(b.ea)}</div></div>
    <div class="facet"><div class="facet-label">Milieu</div><div class="chips">${chips(b.mi)}</div></div>
    <div class="facet"><div class="facet-label">System</div><div class="chips">${chips(b.sy)}</div></div>
    <div class="facet"><div class="facet-label">Institution</div><div class="chips">${chips(b.in)}</div></div>
    <div class="facet"><div class="facet-label">Cast</div><div class="chips">${chips(b.ca)}</div></div>
    <div class="facet"><div class="facet-label">Mode · Status</div><div class="chips">${chips(b.mo)}${chips([b.st])}</div></div>
    <div class="divider"></div><div class="eyebrow">Register</div>${bars}
    ${b.cpace?`<div class="facet" style="margin-top:14px">
      <div class="facet-label">StoryGraph readers${b.nrev?" · "+b.nrev.toLocaleString()+" reviews":""}</div>
      <div style="font-size:11.5px;color:var(--dim);line-height:1.6">
        community pace ${b.cpace.toFixed(1)}/5 vs my velocity ${b.ax[0]}/5${
        Math.abs(b.cpace-b.ax[0])>=1.5?` <span style="color:var(--heist)">— you read this faster than its pace suggests</span>`:""}</div></div>`:""}
    ${flags.map(f=>`<div class="flag"><b>${f[0]}</b>${f[1]}</div>`).join("")}

    <div class="why">${explainScore(b)}</div>

    ${b.r>0?(()=>{const exp=Math.max(1,Math.min(5,MODEL.intercept+
        featOf(b).reduce((s,v,i)=>s+MODEL.coef[i]*v,0)));
      const d=b.r-exp, big=Math.abs(d)>MODEL.sd;
      return `<div class="vs${big?" vs-big":""}">
        <div class="vs-row"><span>You rated</span><b>${b.r}</b></div>
        <div class="vs-row"><span>Model expected</span><b>${exp.toFixed(2)}</b></div>
        <div class="vs-note">${big
          ? (d>0?"You liked this a lot more than its profile predicts — one of the model's blind spots."
                :"You liked this notably less than its profile predicts; the axes are missing something here.")
          : "Within the model's normal error (±"+MODEL.sd+"), so the axes describe this one well."}</div>
      </div>`;})():""}

    ${(()=>{const sr=seriesRecord(b);if(!sr)return "";
      const entry=sr.vol&&sr.vol>1&&!sr.haveFirst;
      return `<div class="series${entry?" series-warn":""}">
        <div class="series-h"><button class="xlink strong" data-nav="series" data-k="${snorm(sr.name)}">${sr.name}</button>${sr.vol?`<span class="vol">Book ${sr.vol%1?sr.vol:sr.vol|0}</span>`:""}</div>
        ${sr.n?`<div class="series-r">You've rated ${sr.n} volume${sr.n===1?"":"s"}, averaging <b>${sr.mean}★</b></div>`:""}
        ${entry?`<div class="series-warn-note">Not the entry point — you haven't read book 1.</div>`
               :(sr.vol===1?`<div class="series-r dim">Starts the series.</div>`:"")}
        ${(()=>{const nx=nextInSeries(b);if(!nx)return "";
          return `<div class="nextvol"><div class="nextvol-h">Unread in this series <em>${nx.src}</em></div>
            ${nx.next.slice(0,4).map(v=>`<div class="nv">${v.ord?`<i>#${v.ord}</i>`:"<i>–</i>"}
              <span>${v.t}</span>${v.yr?`<em>${v.yr}</em>`:""}</div>`).join("")}
            ${nx.next.length>4?`<div class="nv more">+${nx.next.length-4} more</div>`:""}</div>`;})()}
      </div>`;})()}

    ${(()=>{const ar=authorRecord(b);if(!ar)return "";
      return `<div class="track"><button class="xlink strong" data-nav="author" data-k="${b.a.replace(/"/g,"&quot;")}">${b.a}</button> — you've rated ${ar.n} 
        ${ar.n===1?"book":"books"}, averaging <b>${ar.mean.toFixed(1)}★</b>
        <span>${ar.titles.join(" · ")}</span></div>`;})()}

    ${(()=>{const sim=similarUnread(b);if(!sim.length)return "";
      return `<div class="divider"></div>
      <div class="eyebrow">If you like this, try</div>
      <div class="near-note">Unread books closest to it on the same seven axes.</div>
      ${sim.map(({x})=>`<div class="near" data-id="${x.id}">
          <span class="near-t">${x.t}</span>
          <span class="near-r">${x.p.toFixed(2)}</span></div>`).join("")}`;})()}

    ${(()=>{const near=nearestRated(b);if(!near.length)return "";
      return `<div class="divider"></div>
      <div class="eyebrow">Nearest books you've rated</div>
      <div class="near-note">The closest things in your library by the same seven axes${b.r===0?" — this is what the prediction is extrapolating from":""}.</div>
      ${near.map(({z,d})=>`<div class="near" data-id="${z.id}">
          <span class="near-t">${z.t}</span>
          <span class="near-r">${z.r}★</span>
        </div>`).join("")}`;})()}

    ${(()=>{const m=b.moods||{};
      const top=Object.entries(m).filter(([,v])=>v>=MOOD_SHOW).sort((a,c)=>c[1]-a[1]).slice(0,5);
      if(!top.length)return "";
      return `<div class="facet" style="margin-top:16px">
        <div class="facet-label">What readers felt</div>
        <div class="chips">${top.map(([k,v])=>
          `<span class="chip mood-chip">${k}<i>${v}%</i></span>`).join("")}</div></div>`;})()}

    ${b.r===0?(()=>{const [lvl,why]=tagConfidence(b);
      return `<div class="conf conf-${lvl.split(" ")[0].toLowerCase()}">
        <b>Confidence in this score: ${lvl}</b><span>${why}</span></div>`;})():""}

    <div class="divider"></div>
    <div class="eyebrow">${b.r>0?"Your rating":"Read it? Rate it"}</div>
    <div class="rate" id="rate">${[1,2,3,4,5].map(v=>
      `<button class="rb${b.r>=v?" on":""}" data-v="${v}" aria-label="${v} stars">${v}</button>`).join("")}
      ${b.r>0?`<button class="rb clear" data-v="0">clear</button>`:""}</div>
    <div class="rate-note" id="rate-note">${storageOK
      ? "Saved in this browser. Back up or sync from the Filter panel."
      : "This browser blocks local storage — use Export in the Filter panel."}</div>`;
  const bm=document.getElementById("blurb-more");
  if(bm)bm.onclick=()=>{b._open=!b._open;renderDetail();};
  el.querySelectorAll("[data-nav]").forEach(d=>d.onclick=e=>{
    e.stopPropagation();
    gotoShelf(d.dataset.nav, d.dataset.nav==="author"?d.dataset.k:snorm(d.dataset.k));
  });
  el.querySelectorAll(".near").forEach(d=>d.onclick=()=>{
    selected=+d.dataset.id;renderDetail();kick();});
  el.querySelectorAll(".rb").forEach(btn=>btn.onclick=()=>{
    const v=+btn.dataset.v;
    setRating(b, v===0?0:(b.r===v?0:v));
    renderDetail();update();kick();
  });
}

/* ---------- controls ---------- */
const axesEl=document.getElementById("axes");
AXES.forEach(a=>{
  const d=document.createElement("div");d.className="axis";
  d.innerHTML=`<div class="axis-head"><span class="axis-name">${a.n}</span>
    <span class="axis-val">${a.dir==="min"?"at least":"at most"} <b id="v${a.k}">${limits[a.k]}</b></span></div>
    <input type="range" min="1" max="5" step="1" value="${limits[a.k]}" id="s${a.k}" aria-label="${a.n}">
    <div class="axis-note">${a.note}</div>`;
  axesEl.appendChild(d);
  d.querySelector("input").addEventListener("input",e=>{
    limits[a.k]=+e.target.value;
    document.getElementById("v"+a.k).textContent=e.target.value;
    syncPresets();update();
  });
});
function setLimits(o){
  AXES.forEach(a=>{limits[a.k]=o[a.k];
    document.getElementById("s"+a.k).value=o[a.k];
    document.getElementById("v"+a.k).textContent=o[a.k];});
  update();
}
function syncPresets(){
  document.getElementById("preset-fit").classList.toggle("on",AXES.every(a=>limits[a.k]===FIT[a.k]));
  document.getElementById("preset-clear").classList.toggle("on",AXES.every(a=>limits[a.k]===(a.dir==="min"?1:5)));
}
document.getElementById("preset-fit").onclick=()=>{setLimits(FIT);syncPresets()};
document.getElementById("preset-clear").onclick=()=>{
  const o={};AXES.forEach(a=>o[a.k]=a.dir==="min"?1:5);setLimits(o);syncPresets();};
document.getElementById("t-read").onclick=e=>{showRead=!showRead;e.target.classList.toggle("on",showRead);update()};
document.getElementById("t-rec").onclick=e=>{showRec=!showRec;e.target.classList.toggle("on",showRec);update()};
document.getElementById("m-depth").onclick=()=>setMode(false);
document.getElementById("m-flat").onclick=()=>setMode(true);
document.getElementById("m-spin").onclick=e=>{spin=!spin;e.target.classList.toggle("on",spin);kick()};
document.getElementById("m-spot").onclick=e=>{spotlight=!spotlight;e.target.classList.toggle("on",spotlight);kick()};
function setMode(f){
  if(flat&&!f)                                // z is exactly 0 and the forces are symmetric,
    nodes.forEach(n=>{n.z=(Math.random()-.5)*120;n.vz=0});   // so depth needs re-seeding
  flat=f;
  document.getElementById("m-depth").classList.toggle("on",!f);
  document.getElementById("m-flat").classList.toggle("on",f);
  document.getElementById("m-spin").style.opacity=f?.4:1;
  document.getElementById("m-spin").disabled=f;
  cv.style.cursor=f?"default":"grab";
  userZoomed=false;reheat(.5);
}
{
  const sk=document.getElementById("sizekey");
  sk.innerHTML=[2,3,4,5].map(v=>
    `<div class="sk"><i style="width:${(SIZE(v)*2).toFixed(0)}px;height:${(SIZE(v)*2).toFixed(0)}px"></i><span>${v}</span></div>`).join("");
  sk.insertAdjacentHTML("afterend",
    '<p class="sizenote">Unread books are sized by predicted fit, rounded to their band.</p>');
}
const legEl=document.getElementById("legend");
ENGINES.forEach(en=>{
  const d=document.createElement("div");d.className="leg";d.dataset.en=en;
  d.innerHTML=`<span class="dot" style="background:${COLOR[en]}"></span>${en}`;
  d.onclick=()=>{offEngines.has(en)?offEngines.delete(en):offEngines.add(en);
    d.classList.toggle("off",offEngines.has(en));update()};
  legEl.appendChild(d);
});
/* ---------- tag filter ---------- */
const TAG_GROUPS=[
  ["Engine","en"],["Institution","in"],["System","sy"],
  ["Milieu","mi"],["Cast","ca"],["Mode","mo"],["Reader mood","mood"]
];
function buildTagIndex(){
  const idx={};                                 // group -> Map(tag -> count over all nodes)
  TAG_GROUPS.forEach(([,k])=>idx[k]=new Map());
  nodes.forEach(n=>{
    const bump=(k,v)=>{const m=idx[k];m.set(v,(m.get(v)||0)+1);};
    [n.en,...(n.ea||[])].forEach(v=>bump("en",v));
    ["in","sy","mi","ca","mo"].forEach(k=>(n[k]||[]).forEach(v=>bump(k,v)));
    if(n.moods)for(const[m,pct]of Object.entries(n.moods))if(pct>=MOOD_CUT)bump("mood",m);
  });
  return idx;
}
const TAG_IDX=buildTagIndex();
const tagFilterEl=document.getElementById("tagfilter");

function tagKey(group,val){return group==="mood"?"mood:"+val:val;}

function renderTagFilter(){
  const q=(document.getElementById("tag-search").value||"").toLowerCase().trim();
  // which tags are still reachable given the *other* active filters
  const reach=new Map();
  nodes.forEach(n=>{if(passes(n))(n._tags||(n._tags=tagsOf(n))).forEach(t=>reach.set(t,(reach.get(t)||0)+1));});
  let html="";
  TAG_GROUPS.forEach(([label,k])=>{
    const entries=[...TAG_IDX[k].entries()]
      .filter(([v])=>!q||v.toLowerCase().includes(q))
      .sort((a,b)=>b[1]-a[1]);
    if(!entries.length)return;
    const chips=entries.map(([v,total])=>{
      const key=tagKey(k,v);
      const on=activeTags.has(key);
      const live=reach.get(key)||0;
      const dead=!on&&live===0;
      const cls=["tchip",k==="mood"?"mood":"",on?"on":"",dead?"dead":""].filter(Boolean).join(" ");
      const shown=on?total:live;               // when selected, show the tag's own size
      return `<span class="${cls}" data-key="${key}">${v}<span class="c">${shown}</span></span>`;
    }).join("");
    html+=`<div class="tag-group"><div class="tag-glabel">${label}</div><div class="tag-chips">${chips}</div></div>`;
  });
  tagFilterEl.innerHTML=html;
  tagFilterEl.querySelectorAll(".tchip:not(.dead)").forEach(c=>c.onclick=()=>{
    const key=c.dataset.key;
    activeTags.has(key)?activeTags.delete(key):activeTags.add(key);
    update();
  });
  // header shows active count + clear
  const head=document.getElementById("tag-head");
  head.className="eyebrow tag-head";
  head.innerHTML=`<span>Filter by tag${activeTags.size?" · "+activeTags.size:""}</span>`+
    (activeTags.size?`<button class="tag-clear" id="tag-clear">clear</button>`:"");
  const cl=document.getElementById("tag-clear");
  if(cl)cl.onclick=()=>{activeTags.clear();update();};
}
document.getElementById("tag-search").addEventListener("input",renderTagFilter);

/* ---------- find a book ---------- */
/* 274 nodes is past the point where you can spot a title by eye, so the graph
   needs a way in by name. Selecting a result frames and opens it. */
const findEl=document.getElementById("find"),findRes=document.getElementById("find-results");
let findHits=[],findCur=-1;
const fnorm=s=>s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9 ]/g,"");
/* People search for the series, not the first volume's title — "murderbot"
   should find All Systems Red. */
const ALIAS={"All Systems Red":"murderbot wells","The Warrior's Apprentice":"vorkosigan miles bujold",
  "Gardens of the Moon":"malazan book of the fallen erikson","Deadhouse Gates":"malazan",
  "The Atrocity Archives":"laundry files","The Fuller Memorandum":"laundry files",
  "Dead Lies Dreaming":"laundry files","Storm Front":"dresden files",
  "A Deadly Education":"scholomance","The Last Graduate":"scholomance",
  "The Gunslinger":"dark tower","The Way of Kings":"stormlight archive",
  "A Game of Thrones":"song of ice and fire asoiaf","Gideon the Ninth":"locked tomb",
  "Harrow the Ninth":"locked tomb","The Lies of Locke Lamora":"gentlemen bastards",
  "Ancillary Justice":"imperial radch","The Will of the Many":"hierarchy",
  "1632":"ring of fire assiti shards","Island in the Sea of Time":"isot nantucket",
  "The Screaming Staircase":"lockwood and co","City of Blades":"divine cities",
  "The Blade Itself":"first law abercrombie","A Little Hatred":"age of madness first law",
  "The Traitor Baru Cormorant":"masquerade","Dogs of War":"dogs of war tchaikovsky",
  "Children of Time":"children of time","Night Watch":"discworld","Small Gods":"discworld",
  "Three Parts Dead":"craft sequence","The Goblin Emperor":"goblin emperor addison"};
function syncControls(){          // push filter state back into the controls
  AXES.forEach(a=>{
    const sl=document.getElementById("s"+a.k), vl=document.getElementById("v"+a.k);
    if(sl)sl.value=limits[a.k];
    if(vl)vl.textContent=limits[a.k];
  });
  const tr=document.getElementById("t-read"),tc=document.getElementById("t-rec");
  if(tr)tr.classList.toggle("on",showRead);
  if(tc)tc.classList.toggle("on",showRec);
  document.querySelectorAll("#legend .leg").forEach(el=>
    el.classList.toggle("off",offEngines.has(el.dataset.en)));
  if(typeof syncPresets==="function")syncPresets();
}

function runFind(){
  const q=fnorm(findEl.value.trim());
  findRes.innerHTML="";findHits=[];findCur=-1;
  if(q.length<2)return;
  const scored=[];
  for(const n of nodes){
    const t=fnorm(n.t),a=fnorm(n.a),al=fnorm(ALIAS[n.t]||"");
    let sc=-1;
    if(t.startsWith(q))sc=0; else if(t.includes(q))sc=1;
    else if(al.includes(q))sc=2;
    else if(a.startsWith(q))sc=3; else if(a.includes(q))sc=4;
    if(sc>=0)scored.push([sc,n]);
  }
  scored.sort((x,y)=>x[0]-y[0]||x[1].t.localeCompare(y[1].t));
  findHits=scored.slice(0,8).map(x=>x[1]);
  if(!findHits.length){findRes.innerHTML='<div class="fr-none">No book by that name.</div>';return;}
  findRes.innerHTML=findHits.map((n,i)=>
    `<div class="fr" role="option" data-i="${i}" aria-selected="false">
       <span class="fr-t">${n.t}</span>
       <span class="fr-s">${n.r>0?n.r+"★":"fit "+n.p.toFixed(1)}</span></div>`).join("");
  findRes.querySelectorAll(".fr").forEach(el=>
    el.onclick=()=>pickFind(+el.dataset.i));
}
function markFind(){
  findRes.querySelectorAll(".fr").forEach((el,i)=>
    el.setAttribute("aria-selected",i===findCur?"true":"false"));
  if(findCur>=0)findRes.children[findCur]?.scrollIntoView({block:"nearest"});
}
function pickFind(i){
  const n=findHits[i];if(!n)return;
  // a found book that's filtered out would vanish on selection, so clear the way
  if(!passes(n)){activeTags.clear();AXES.forEach(a=>limits[a.k]=a.dir==="min"?1:5);
    showRead=showRec=true;offEngines.clear();syncControls();update();}
  selected=n.id;renderDetail();
  yawT=Math.atan2(n.x,n.z||.001)*-1;pitchT=Math.max(-1.1,Math.min(1.1,Math.asin((n.y||0)/(Math.hypot(n.x,n.y,n.z)||1))*-1));
  findEl.value="";runFind();findEl.blur();
  if(innerWidth<=1000&&openSheet!=="detail")setSheet("detail");
  kick();
}
findEl.addEventListener("input",runFind);
findEl.addEventListener("keydown",e=>{
  if(e.key==="ArrowDown"){e.preventDefault();findCur=Math.min(findHits.length-1,findCur+1);markFind();}
  else if(e.key==="ArrowUp"){e.preventDefault();findCur=Math.max(0,findCur-1);markFind();}
  else if(e.key==="Enter"){e.preventDefault();pickFind(findCur<0?0:findCur);}
  else if(e.key==="Escape"){findEl.value="";runFind();findEl.blur();}
});
document.addEventListener("click",e=>{
  if(!e.target.closest(".finder")){findRes.innerHTML="";findHits=[];}
});

/* ---------- keyboard ---------- */
addEventListener("keydown",e=>{
  const typing=/^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName);
  if(e.key==="Escape"&&!typing&&selected!==null){selected=null;renderDetail();renderRanked();kick();}
  if(e.key==="/"&&!typing){e.preventDefault();findEl.focus();}
});

/* ---------- empty state ---------- */
const voidEl=document.getElementById("void");
document.getElementById("void-clear").onclick=()=>clearAllFilters();

/* ---------- views ---------- */
/* One representation can't answer every question: the graph shows how books
   relate, the field shows why the model scores them, the list lets you just
   pick one. */
const listEl=document.getElementById("listview"), lvRows=document.getElementById("lv-rows");
let lvSort="p", lvDesc=true;
function renderList(){
  const rows=nodes.filter(n=>n.r===0&&passes(n));
  const key=n=>lvSort==="p"?(n.praw??n.p):lvSort==="ax0"?n.ax[0]:
              lvSort==="cpace"?(n.cpace??0):(n.nrev??0);
  rows.sort((a,b)=>lvDesc?key(b)-key(a):key(a)-key(b));
  if(!rows.length){lvRows.innerHTML='<div class="fr-none" style="padding:24px">No unread books match these filters.</div>';return;}
  lvRows.innerHTML=rows.map(n=>{
    const pace=n.cpace!=null?n.cpace.toFixed(1):"—";
    const known=n.nrev?(n.nrev>=1000?Math.round(n.nrev/1000)+"k":n.nrev):"—";
    const w=Math.max(0,Math.min(1,((n.praw??n.p)-3)/2))*100;
    return `<div class="lv-row" data-id="${n.id}">
      <div><span class="lv-t">${n.t}<span class="lv-a">${n.a}</span></span>
        <div class="lv-bar"><i style="width:${w.toFixed(0)}%;background:${COLOR[n.en]}"></i></div></div>
      <div class="lv-n hi">${n.p.toFixed(2)}</div>
      <div class="lv-n">${n.ax[0]}</div>
      <div class="lv-n">${pace}</div>
      <div class="lv-n">${known}</div></div>`;}).join("");
  lvRows.querySelectorAll(".lv-row").forEach(el=>el.onclick=()=>{
    selected=+el.dataset.id; renderDetail();
    if(innerWidth<=1000)setSheet("detail"); else setView("graph");
    kick();
  });
}
document.querySelectorAll(".lv-sort").forEach(b=>b.onclick=()=>{
  const k=b.dataset.k;
  if(lvSort===k)lvDesc=!lvDesc; else {lvSort=k;lvDesc=true;}
  document.querySelectorAll(".lv-sort").forEach(x=>x.classList.toggle("on",x.dataset.k===lvSort));
  renderList();
});
/* ---------- tonight ---------- */
/* The actual job: "what do I read next, given how I feel right now." Criteria
   score rather than filter, so a demanding combination degrades to the closest
   matches instead of an empty screen. */
const MOODS=[
 ["Pace",[
  ["grabs",  "Something that grabs me", b=>b.ax[0]>=5||(b.cpace||3)>=3.6],
  ["burn",   "A slow burn to sink into", b=>(b.cpace||3)<=2.6&&b.ax[0]>=4],
 ]],
 ["Tone",[
  ["dark",   "Dark and heavy",   b=>mo(b,"dark")>=80],
  ["tense",  "Tense",            b=>mo(b,"tense")>=60],
  ["funny",  "Light or funny",   b=>mo(b,"funny")>=45||b.ax[3]<=3],
  ["feels",  "An emotional hit", b=>mo(b,"emotional")>=45],
  ["puzzle", "Puzzle-box mystery",b=>mo(b,"mysterious")>=70],
 ]],
 ["Effort",[
  ["easy",   "No work required",  b=>b.ax[1]<=1],
  ["hard",   "Something demanding",b=>b.ax[1]>=4||mo(b,"challenging")>=40],
  ["prose",  "Beautifully written",b=>b.ax[5]>=5],
 ]],
 ["Commitment",[
  ["standalone","One and done",   b=>b.st==="standalone"],
  ["series",    "Start a series", b=>b.vol===1&&(b.st==="complete-series"||b.st==="ongoing")],
 ]],
 ["Familiarity",[
  ["trusted","An author I trust", b=>nodes.some(x=>x.a===b.a&&x.r>=4)],
  ["new",    "Someone new",       b=>!nodes.some(x=>x.a===b.a&&x.r>0)],
 ]]
];
const mo=(b,k)=>(b.moods||{})[k]||0;
const MOODMAP={}; MOODS.forEach(([,l])=>l.forEach(([k,lab,f])=>MOODMAP[k]={lab,f}));
let moodPicks=new Set();
const moodView=document.getElementById("moodview");

function renderMoodPicks(){
  document.getElementById("mood-picks").innerHTML=MOODS.map(([g,list])=>
    `<div class="mgroup"><div class="mglabel">${g}</div><div class="mchips">${
      list.map(([k,lab])=>`<span class="mchip${moodPicks.has(k)?" on":""}" data-k="${k}">${lab}</span>`).join("")
    }</div></div>`).join("");
  document.getElementById("mood-picks").querySelectorAll(".mchip").forEach(c=>c.onclick=()=>{
    const k=c.dataset.k;
    moodPicks.has(k)?moodPicks.delete(k):moodPicks.add(k);
    renderMoodPicks(); renderMood();
  });
}
function renderMood(){
  const picks=[...moodPicks];
  const pool=nodes.filter(n=>n.r===0&&passes(n));
  const scored=pool.map(b=>{
    const hit=picks.filter(k=>MOODMAP[k].f(b));
    const fit=(b.praw??b.p);
    // matching the mood dominates; fit breaks ties within the same match count
    return {b,hit,score:hit.length*10+(fit-3)};
  }).sort((x,y)=>y.score-x.score);
  const best=scored.slice(0,8);
  const el=document.getElementById("mood-results");
  const cnt=document.getElementById("mood-count");
  if(!best.length){el.innerHTML='<div class="mood-none">Nothing matches the filters currently set in the other views.</div>';cnt.textContent="";return;}
  const full=scored.filter(x=>x.hit.length===picks.length).length;
  cnt.textContent = picks.length
    ? `${full} of ${pool.length} match everything you picked`
    : `${pool.length} unread books, best fits first`;
  el.innerHTML=best.map(({b,hit})=>{
    const missed=picks.filter(k=>!hit.includes(k));
    return `<div class="mcard" data-id="${b.id}">
      <div class="mcard-h"><div class="mcard-t">${b.t}<span>${b.a}${b.ser?` · ${b.ser}${b.vol?" #"+(b.vol%1?b.vol:b.vol|0):""}`:""}</span></div>
        <div class="mcard-p">${b.p.toFixed(2)}</div></div>
      <div class="mcard-why">${explainScore(b)}</div>
      ${picks.length?`<div class="mcard-tags">${
        hit.map(k=>`<span class="mtag">${MOODMAP[k].lab}</span>`).join("")+
        missed.map(k=>`<span class="mtag miss">not ${MOODMAP[k].lab.toLowerCase()}</span>`).join("")
      }</div>`:""}</div>`;}).join("");
  el.querySelectorAll(".mcard").forEach(d=>d.onclick=()=>{
    selected=+d.dataset.id; renderDetail();
    if(innerWidth<=1000)setSheet("detail"); else setView("graph");
    kick();
  });
}
/* Two-way navigation: a book names its author and series, and both are ways in
   to everything else by that author or in that series. */
function gotoShelf(mode,key){
  // on a phone the detail sheet covers the stage, so navigating away must close it
  if(innerWidth<=1000&&openSheet)setSheet(openSheet);
  shelfMode=mode;
  document.getElementById("sh-auth").classList.toggle("on",mode==="author");
  document.getElementById("sh-ser").classList.toggle("on",mode==="series");
  shelfOpen.clear(); shelfOpen.add(key);
  setView("shelf");
  requestAnimationFrame(()=>{
    const el=[...document.querySelectorAll(".shelf")].find(x=>x.dataset.k===key);
    if(el){
      el.scrollIntoView({block:"center",behavior:"smooth"});
      el.classList.add("flash");
      setTimeout(()=>el.classList.remove("flash"),1400);
    }else{
      // nothing grouped under that key — say so rather than land on a blank list
      const h=document.getElementById("shelf-hint");
      if(h)h.textContent="Nothing else grouped under that name yet.";
    }
  });
}
document.getElementById("mood-clear").onclick=()=>{moodPicks.clear();renderMoodPicks();renderMood();};

/* ---------- sync panel ---------- */
function renderSync(){
  const el=document.getElementById("syncbox");
  if(!el)return;
  const tok=gistToken(), id=gistId();
  el.innerHTML=`
    <div class="sync-stat">${ratingsCount()} rating${ratingsCount()===1?"":"s"} saved${
      storageOK?" in this browser":" (browser storage unavailable)"}</div>
    <div class="btnrow">
      <button id="sy-save">Download backup</button>
      <button id="sy-load">Import file</button>
    </div>
    <input type="file" id="sy-file" accept="application/json,.json" hidden>
    <details class="sync-adv"${tok?" open":""}>
      <summary>Sync across devices (GitHub gist)</summary>
      <p class="sync-help">A token with only the <b>gist</b> scope, from
        github.com/settings/tokens. It is kept in this browser and sent only to
        api.github.com. The gist is private.</p>
      <input id="sy-tok" type="password" placeholder="ghp_… token" value="${tok?"••••••••":""}">
      <input id="sy-id" type="text" placeholder="gist id (blank = create one)" value="${id}">
      <div class="btnrow">
        <button id="sy-push">Push</button>
        <button id="sy-pull">Pull</button>
        <button id="sy-forget">Forget token</button>
      </div>
    </details>
    <div class="sync-note" id="sync-note"></div>`;
  const $=x=>document.getElementById(x);
  $("sy-save").onclick=downloadRatings;
  $("sy-load").onclick=()=>$("sy-file").click();
  $("sy-file").onchange=e=>{ if(e.target.files[0])importRatingsFile(e.target.files[0]); };
  $("sy-tok").onchange=e=>{ if(e.target.value&&!/^•+$/.test(e.target.value))setGist(e.target.value.trim(),null); };
  $("sy-id").onchange=e=>setGist(null,e.target.value.trim());
  $("sy-push").onclick=gistPush;
  $("sy-pull").onclick=gistPull;
  $("sy-forget").onclick=()=>{setGist("","");renderSync();syncNote("Token cleared.");};
}

/* ---------- shelves ---------- */
/* Grouped browsing: the question "what else by someone I trust" and "which
   series am I mid-way through" are asked repeatedly; the graph answers neither. */
const shelfRows=document.getElementById("shelf-rows"), shelfView=document.getElementById("shelfview");
let shelfMode="author", shelfOpen=new Set();
function buildShelves(){
  const g=new Map();
  if(shelfMode==="author"){
    for(const n of nodes){
      if(!g.has(n.a))g.set(n.a,{key:n.a,name:n.a,read:[],unread:[],extra:[]});
      (n.r>0?g.get(n.a).read:g.get(n.a).unread).push(n);
    }
    for(const v of g.values()){
      const m=META.authors[v.key];
      v.n=m?m.n:v.read.length; v.mean=m?m.mean:null;
    }
  }else{
    for(const n of nodes){
      if(!n.ser)continue;
      const k=snorm(n.ser);
      if(!g.has(k))g.set(k,{key:k,name:n.ser,read:[],unread:[],extra:[]});
      (n.r>0?g.get(k).read:g.get(k).unread).push(n);
    }
    for(const [k,e] of Object.entries(NEXTSER)){
      if(!g.has(k))g.set(k,{key:k,name:e.name,read:[],unread:[],extra:[]});
      g.get(k).extra=e.next; g.get(k).src=e.src;
    }
    for(const v of g.values()){
      const m=META.series[v.key];
      v.n=m?m.n:v.read.length; v.mean=m?m.mean:null;
    }
  }
  return [...g.values()].filter(v=>v.n>=1||v.unread.length||v.extra.length);
}
function renderShelves(){
  let rows=buildShelves();
  // most useful first: things you rate highly that still have something unread
  rows.sort((a,b)=>{
    const ua=a.unread.length+a.extra.length, ub=b.unread.length+b.extra.length;
    if((ua>0)!==(ub>0))return ub-ua;
    return (b.mean||0)-(a.mean||0) || b.n-a.n || a.name.localeCompare(b.name);
  });
  document.getElementById("shelf-hint").textContent =
    `${rows.length} ${shelfMode==="author"?"authors":"series"} · ${rows.filter(r=>r.unread.length+r.extra.length).length} with something unread`;
  shelfRows.innerHTML=rows.map(v=>{
    const open=shelfOpen.has(v.key), un=v.unread.length+v.extra.length;
    const body=[
      ...v.read.sort((a,b)=>(a.vol||99)-(b.vol||99)).map(n=>
        `<div class="sb" data-id="${n.id}"><span class="sb-v">${n.vol?"#"+(n.vol%1?n.vol:n.vol|0):""}</span>
          <span class="sb-t">${n.t}</span><span class="sb-r">${n.r}★</span></div>`),
      ...v.unread.sort((a,b)=>(b.praw??b.p)-(a.praw??a.p)).map(n=>
        `<div class="sb unread" data-id="${n.id}"><span class="sb-v">${n.vol?"#"+(n.vol%1?n.vol:n.vol|0):""}</span>
          <span class="sb-t">${n.t}</span><span class="sb-r">${n.p.toFixed(2)}</span></div>`),
      ...v.extra.map(x=>
        `<div class="sb unread ext"><span class="sb-v">${x.ord?"#"+x.ord:""}</span>
          <span class="sb-t">${x.t}</span><span class="sb-r">${x.yr||""}</span></div>`)
    ].join("");
    // cross-link: from an author shelf jump to their series, and vice versa
    const cross=shelfMode==="author"
      ? [...new Set([...v.read,...v.unread].filter(n=>n.ser).map(n=>n.ser))].slice(0,3)
      : [...new Set([...v.read,...v.unread].map(n=>n.a))].slice(0,2);
    return `<div class="shelf${open?" open":""}" data-k="${v.key}">
      <div class="shelf-h"><span class="shelf-n">${v.name}${v.src?`<small>${v.src}</small>`:""}</span>
        ${v.mean?`<span class="shelf-m">${v.mean}★ · ${v.n}</span>`:`<span class="shelf-u">unrated</span>`}
        <span class="shelf-u">${un?un+" unread":"complete"}</span></div>
      <div class="shelf-body">${body}${cross.length?`<div class="xrow">${
        shelfMode==="author"?"Series:":"By:"} ${cross.map(c=>
        `<button class="xlink" data-jump="${shelfMode==="author"?"series":"author"}" data-k="${
          (shelfMode==="author"?snorm(c):c).replace(/"/g,"&quot;")}">${c}</button>`).join(" · ")}</div>`:""}
      </div></div>`;}).join("");
  shelfRows.querySelectorAll(".shelf-h").forEach(h=>h.onclick=()=>{
    const k=h.parentElement.dataset.k;
    shelfOpen.has(k)?shelfOpen.delete(k):shelfOpen.add(k);
    h.parentElement.classList.toggle("open");
  });
  shelfRows.querySelectorAll("[data-jump]").forEach(d=>d.onclick=e=>{
    e.stopPropagation(); gotoShelf(d.dataset.jump,d.dataset.k);
  });
  shelfRows.querySelectorAll(".sb[data-id]").forEach(d=>d.onclick=e=>{
    e.stopPropagation();
    selected=+d.dataset.id; renderDetail();
    if(innerWidth<=1000)setSheet("detail"); else setView("graph");
    kick();
  });
}
document.getElementById("sh-auth").onclick=()=>{shelfMode="author";
  document.getElementById("sh-auth").classList.add("on");
  document.getElementById("sh-ser").classList.remove("on");shelfOpen.clear();renderShelves();};
document.getElementById("sh-ser").onclick=()=>{shelfMode="series";
  document.getElementById("sh-ser").classList.add("on");
  document.getElementById("sh-auth").classList.remove("on");shelfOpen.clear();renderShelves();};

function setView(v){
  view=v;
  for(const [id,name] of [["v-mood","mood"],["v-graph","graph"],["v-shelf","shelf"],["v-list","list"]]){
    const b=document.getElementById(id);
    b.classList.toggle("on",v===name);
    b.setAttribute("aria-selected",String(v===name));
  }
  listEl.hidden = v!=="list";
  shelfView.hidden = v!=="shelf";
  moodView.hidden = v!=="mood";
  if(v==="mood")renderMood();
  if(v==="shelf")renderShelves();
  document.getElementById("hint").style.display = v==="graph"?"":"none";
  if(v==="list")renderList();
  if(v==="graph"){userZoomed=false;reheat(.85);}
  update();
}
document.getElementById("v-mood").onclick=()=>setView("mood");
document.getElementById("v-graph").onclick=()=>setView("graph");
document.getElementById("v-shelf").onclick=()=>setView("shelf");
document.getElementById("v-list").onclick=()=>setView("list");

/* ---------- mobile sheets ---------- */
const mq=matchMedia("(max-width:1000px)");
const railEl=document.querySelector(".rail"), detailEl=document.getElementById("detail"),
      scrim=document.getElementById("scrim"), tabbar=document.getElementById("tabbar");
const TABS={controls:[document.getElementById("tab-controls"),railEl],
            detail:[document.getElementById("tab-detail"),detailEl]};
let openSheet=null;
function setSheet(name){
  openSheet = openSheet===name ? null : name;
  for(const k in TABS){
    const [btn,el]=TABS[k];
    el.classList.toggle("open",openSheet===k);
    btn.classList.toggle("on",openSheet===k);
    btn.setAttribute("aria-expanded",String(openSheet===k));
  }
  document.getElementById("tab-graph").classList.toggle("on",openSheet===null);
  scrim.classList.toggle("on",openSheet!==null);
  if(openSheet)TABS[openSheet][1].scrollTop=0;
}
TABS.controls[0].onclick=()=>setSheet("controls");
TABS.detail[0].onclick=()=>setSheet("detail");
document.getElementById("tab-graph").onclick=()=>{if(openSheet)setSheet(openSheet);};
scrim.onclick=()=>{if(openSheet)setSheet(openSheet);};
addEventListener("keydown",e=>{if(e.key==="Escape"&&openSheet)setSheet(openSheet);});
/* swipe a sheet down to dismiss */
for(const k in TABS){
  const el=TABS[k][1]; let y0=null;
  el.addEventListener("touchstart",e=>{y0=el.scrollTop<=0?e.touches[0].clientY:null},{passive:true});
  el.addEventListener("touchmove",e=>{
    if(y0===null)return;
    const dy=e.touches[0].clientY-y0;
    if(dy>0)el.style.transform=`translateY(${dy}px)`;
  },{passive:true});
  el.addEventListener("touchend",e=>{
    if(y0===null)return;
    const dy=(e.changedTouches[0].clientY-y0);
    el.style.transform="";
    if(dy>90)setSheet(k);
    y0=null;
  });
}
/* selecting a book on a phone should surface it, not leave it off-screen */
function revealDetail(){ if(mq.matches&&openSheet!=="detail")setSheet("detail"); }
mq.addEventListener("change",()=>{ if(!mq.matches&&openSheet)setSheet(openSheet); resize(); });

function clearAllFilters(){
  activeTags.clear();AXES.forEach(a=>limits[a.k]=a.dir==="min"?1:5);
  showRead=showRec=true;offEngines.clear();
  const q=document.getElementById("tag-search"); if(q)q.value="";
  syncControls();update();
}
function update(){
  const live=nodes.filter(passes);
  const v=document.getElementById("void");
  if(v)v.hidden=live.length>0||view==="list";
  if(view==="list"&&typeof renderList==="function")renderList();
  const tn=document.getElementById("topbar-n");
  if(tn)tn.textContent=nodes.filter(passes).length+" / "+nodes.length;
  document.getElementById("readout").innerHTML=
    `<b>${live.length}</b> of ${nodes.length} in range &nbsp;·&nbsp; <b>${live.filter(n=>n.r===0).length}</b> unread`;
  if(selected===null)renderRanked();
  renderTagFilter();
  kick();
}
window.addEventListener("resize",resize);
cv.style.cursor="grab";
loadRatings();applyRatings();
resize();update();renderRanked();reheat(1);renderSync();
renderMoodPicks();setView("mood");
