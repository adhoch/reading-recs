const GRAPH=(window.__DATA__&&window.__DATA__.graph)||null;
const CLUSTERS=(GRAPH&&GRAPH.clusters)||[];
/* Hues spaced widely enough that neighbouring clusters never read as the same
   family. Eleven groups is close to the limit for categorical colour. */
/* Eleven groups is more than colour alone can carry, so colour here is the
   second encoding -- each group is also named on the canvas and sits in its own
   region. What the palette must guarantee is that *neighbouring* groups never
   blur together, and in ring order neighbouring index means neighbouring on
   screen. Re-stepped against #17131C to pass all six checks on the adjacent
   pairlist (worst CVD 9.0, normal 19.7); the hand-picked set it replaces failed
   at CVD 5.3 with eight of eleven reading as grey. */
const CLUSTER_COLORS=["#977bc1","#8a7411","#cd5d80","#4c5cbd","#9c4a33","#099194",
  "#ce7c01","#007152","#9a4792","#029ce8","#79a15c"];
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
  if(GRAPH&&GRAPH.edges){
    /* Precomputed k-nearest-neighbour edges: each book keeps only its four
       strongest links. Drawing all 17,456 shared-tag pairs gave a graph with
       modularity 0.18 — statistically a single blob. Keeping the top four per
       book gives 0.72 and eleven legible clusters. */
    const idx=new Map(raw.map(e=>[e.s+":"+e.t,e]));
    for(const [x,y] of GRAPH.edges.map(e=>[e[0],e[1]])){
      const e=idx.get(x+":"+y)||idx.get(y+":"+x);
      links.push({source:nodes[x],target:nodes[y],
        w:e?e.w:2,shared:e?[...new Set(e.sh)]:[],
        same:nodes[x].cl===nodes[y].cl});
    }
  } else {
    const deg=new Array(nodes.length).fill(0);
    raw.forEach(e=>{
      if(e.w>=6||deg[e.s]<4||deg[e.t]<4){
        links.push({source:nodes[e.s],target:nodes[e.t],w:e.w,shared:[...new Set(e.sh)]});
        deg[e.s]++;deg[e.t]++;
      }
    });
  }
}


/* ---------- state ---------- */
const limits={};AXES.forEach(a=>limits[a.k]=a.dir==="min"?1:5);
let showRead=true,showRec=true,offEngines=new Set();
let hover=null,selected=null;
const REDUCED=matchMedia('(prefers-reduced-motion:reduce)').matches;
/* Autorotation is off unless you turn it on — it competes with reading labels,
   and the preference sticks. */
let flat=false,spotlight=true,cluster=true;
let spin=(()=>{try{return localStorage.getItem("reading-network:spin")==="1"}catch(e){return false}})();
const offClusters=new Set();
/* Three ways in, because one is never enough for 274 books:
   graph = how books relate · field = why the model scores them · list = pick one */
let view="mood";
let yaw=.6,pitch=-.32,yawT=.6,pitchT=-.32,zoom=1;
const FOCAL=880;
/* The camera sits at DIST in front of the origin. Fixed at 880 it was *inside*
   the cloud once the library passed ~300 books: nodes swung behind the camera
   plane, hit the projection clamp, and magnified 7x, which pinned the zoom at
   its floor and left the graph a small blob in an empty frame. It now backs off
   to keep the whole cloud in front of it. */
let DIST=880;
let panX=0,panY=0;    // fitView centres the frame on the graph, not on the origin
function setCamera(){
  let r=0;
  for(const n of nodes){const d=Math.hypot(n.x,n.y,n.z); if(d>r)r=d;}
  DIST=Math.max(880, r*1.6);
}
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
  if(cluster&&offClusters.has(b.cl))return false;
  if(!AXES.every(a=>a.dir==="min"?b.ax[a.k]>=limits[a.k]:b.ax[a.k]<=limits[a.k]))return false;
  if(activeTags.size){
    const T=b._tags||(b._tags=tagsOf(b));
    for(const t of activeTags)if(!T.has(t))return false;
  }
  return true;
}

/* ---------- cluster clouds ---------- */
/* A soft translucent hull behind each group. Convex hull of the member points,
   expanded outward from the centroid and drawn with a quadratic-curve pass so
   the outline reads as a cloud rather than a polygon. */
let CLOUDS_DONE=false;
function hull(pts){
  if(pts.length<3)return pts;
  const p=pts.slice().sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
  const cross=(o,a,b)=>(a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0]);
  const lo=[],up=[];
  for(const q of p){while(lo.length>=2&&cross(lo[lo.length-2],lo[lo.length-1],q)<=0)lo.pop();lo.push(q);}
  for(let i=p.length-1;i>=0;i--){const q=p[i];
    while(up.length>=2&&cross(up[up.length-2],up[up.length-1],q)<=0)up.pop();up.push(q);}
  lo.pop();up.pop();
  return lo.concat(up);
}
function drawClouds(){
  if(!cluster||!CLUSTERS.length)return;
  for(let ci=0;ci<CLUSTERS.length;ci++){
    const mem=nodes.filter(n=>n.cl===ci&&passes(n));
    if(mem.length<3)continue;
    const all=mem.map(n=>[n.PX,n.PY]);
    /* Hull the core, not every member. A convex hull is stretched by its
       furthest point, so one sub-series flung out by the layout dragged a
       group's cloud across a third of the frame and made a tight group look
       like it sprawled -- Epic Campaigns reads as the broadest cloud on screen
       while being the tightest group in the data (11% of its edge weight leaves
       it, 95% one engine). Outliers still draw as their own coloured dots; the
       cloud just stops claiming ground the group does not hold.

       Centre and cutoff are both medians because a mean and a standard
       deviation are moved by the very points being tested for. */
    const med=a=>{const q=a.slice().sort((x,y)=>x-y),m=q.length>>1;
      return q.length%2?q[m]:(q[m-1]+q[m])/2;};
    const cx=med(all.map(q=>q[0])), cy=med(all.map(q=>q[1]));
    const dist=all.map(q=>Math.hypot(q[0]-cx,q[1]-cy));
    const cut=Math.max(1,med(dist))*2.2;
    let pts=all.filter((q,i)=>dist[i]<=cut);
    // never trim away so much that the cloud stops covering the group
    if(pts.length<Math.max(3,all.length*0.75)){
      const ord=all.map((q,i)=>[dist[i],q]).sort((a,b)=>a[0]-b[0]);
      pts=ord.slice(0,Math.max(3,Math.ceil(all.length*0.75))).map(x=>x[1]);
    }
    const h=hull(pts);
    if(h.length<3)continue;
    const pad=mem.length>20?34:26;
    const ex=h.map(([x,y])=>{
      const dx=x-cx,dy=y-cy,d=Math.hypot(dx,dy)||1;
      return [x+dx/d*pad, y+dy/d*pad];
    });
    ctx.beginPath();
    for(let i=0;i<ex.length;i++){
      const a=ex[i],b=ex[(i+1)%ex.length];
      const mx=(a[0]+b[0])/2,my=(a[1]+b[1])/2;
      if(i===0)ctx.moveTo(mx,my); else ctx.quadraticCurveTo(a[0],a[1],mx,my);
    }
    ctx.closePath();
    ctx.fillStyle=shadeHex(CLUSTER_COLORS[famOf(ci)%CLUSTER_COLORS.length],flat?.10:.065,0);
    ctx.fill();
    ctx.strokeStyle=shadeHex(CLUSTER_COLORS[famOf(ci)%CLUSTER_COLORS.length],flat?.22:.13,0);
    ctx.lineWidth=1;ctx.stroke();
  }
}

/* ---------- canvas ---------- */
const cv=document.getElementById("cv"),ctx=cv.getContext("2d");
let W=0,H=0;const DPR=Math.min(devicePixelRatio||1,2);
const css=n=>getComputedStyle(document.documentElement).getPropertyValue("--"+n).trim();
const COLOR={};ENGINES.forEach(e=>COLOR[e]=css(e));
const V=css("vellum"),DIMC=css("dim"),FAINT=css("faint"),FIELD=css("field");
const RGB={};[...ENGINES,"vellum","dim","faint","field","accent","rule"].forEach(k=>{
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
let colorBy="cluster";
/* Twenty groups is far past what hue can carry, so a group wears its FAMILY's
   colour -- the five parts of Epic Campaigns share one hue and are told apart
   by their own outline and their own name. That keeps the eleven validated
   hues rather than inventing nine more that would fail the checks. */
const famOf=ci=>(CLUSTERS[ci]&&CLUSTERS[ci].fam!=null)?CLUSTERS[ci].fam:ci;
const nodeHex=n=>(colorBy==="cluster"&&n.cl!=null&&CLUSTER_COLORS[famOf(n.cl)%CLUSTER_COLORS.length])
  ?CLUSTER_COLORS[famOf(n.cl)%CLUSTER_COLORS.length]:(COLOR[n.en]||"#888");
function shadeHex(hex,a,fog){
  const h=(hex||"#888").replace("#","");
  const c=[parseInt(h.slice(0,2),16),parseInt(h.slice(2,4),16),parseInt(h.slice(4,6),16)];
  const f=Math.max(0,Math.min(1,fog||0));
  const m=t=>Math.round(c[t]+(FIELD_RGB[t]-c[t])*f);
  return `rgba(${m(0)},${m(1)},${m(2)},${a})`;
}

let userZoomed=false;
function drawFieldAxes(){
  // Project a grid point through the same transform the nodes use, so the
  // gridlines stay locked to the books sitting on them.
  const cy=Math.cos(yaw),sy=Math.sin(yaw),cp=Math.cos(pitch),sp=Math.sin(pitch);
  const P=(gx,gy)=>{
    const x1=gx*cy, z1=gx*sy;
    const y2=gy*cp-z1*sp, z2=gy*sp+z1*cp;
    const k=FOCAL/Math.max(120,z2+DIST);
    return [W/2+panX+x1*k*zoom, H/2+panY+y2*k*zoom];  // same pan as project(), or the grid slides off its own books
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
  ctx.fillStyle=shade("accent",.55,0);
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
  setCamera();
  if(userZoomed)return;
  /* Fit the box the graph actually occupies, not the square it might occupy.
     Two things were throwing away most of the frame: the scale came from
     Math.min(W,H), so a 1356x975 canvas was fitted as if it were 975 wide and
     surrendered 380px; and the extent was measured as max|x|, which centres a
     lopsided cloud off-centre and pads the empty side to match the full one.
     Measuring a real bounding box and panning to its middle fixes both.

     Drift decides which box. Spinning, the frame must hold every yaw or the
     graph would swim in and out of its own edges, so the envelope is swept.
     Still, the box is the one on screen -- fitView only runs while the cloud is
     settling, never during a drag, so a hand-turned view keeps its framing and
     is simply allowed to overhang, which is what turning something means. */
  const sweep=spin&&!REDUCED;
  let minX=1e9,maxX=-1e9,minY=1e9,maxY=-1e9;
  const cb=Math.cos(pitch), sb=Math.sin(pitch);
  const steps=sweep?16:1;
  for(let i=0;i<steps;i++){
    const a=sweep?i*Math.PI/8:yaw, ca=Math.cos(a), sa=Math.sin(a);
    for(const n of nodes){
      const x=n.x*ca-n.z*sa, z0=n.x*sa+n.z*ca;
      const y=n.y*cb-z0*sb, z=n.y*sb+z0*cb;
      // Must match project() exactly or the frame is fitted to a projection
      // that never happens. This read DIST-z clamped at 40 while project()
      // uses z+DIST clamped at 120 — the wrong sign and a clamp allowing 22x
      // magnification against a real maximum of 7.3x, so the graph was fitted
      // to an imaginary worst case roughly three times too large and sat as a
      // small blob in an empty canvas.
      const k=FOCAL/Math.max(120,z+DIST), r=radius(n)*k+4;
      if(x*k-r<minX)minX=x*k-r; if(x*k+r>maxX)maxX=x*k+r;
      if(y*k-r<minY)minY=y*k-r; if(y*k+r>maxY)maxY=y*k+r;
    }
  }
  /* The view tabs and the in-range readout float ON the canvas, so the drawable
     rectangle is not the canvas. While the fit was loose enough to leave a wide
     margin this never showed; once it stopped wasting the margin, titles slid
     under the tab row. Ask the DOM for the bands rather than hard-coding them —
     the tab row wraps to two lines on a narrow window. */
  const pad=W<600?14:22;
  const cvTop=cv.getBoundingClientRect().top;
  const band=(sel,fallback)=>{const el=document.querySelector(sel);
    if(!el)return fallback;const r=el.getBoundingClientRect();
    return r.height?Math.max(fallback,r.bottom-cvTop+8):fallback;};
  const insetTop=Math.min(H*0.28,band(".views",pad));
  const insetBottom=Math.min(H*0.2,(()=>{const el=document.getElementById("readout");
    if(!el)return pad;const r=el.getBoundingClientRect();
    return r.height?Math.max(pad,cvTop+H-r.top+8):pad;})());
  const boxW=Math.max(80,W-pad*2), boxH=Math.max(80,H-insetTop-insetBottom);
  zoom=Math.max(.16,Math.min(2.2,Math.min(boxW/Math.max(1,maxX-minX),
                                          boxH/Math.max(1,maxY-minY))));
  // land the graph's middle on the middle of the drawable box, not the canvas
  panX=(W/2)-W/2-(minX+maxX)/2*zoom;
  panY=(insetTop+H-insetBottom)/2-H/2-(minY+maxY)/2*zoom;
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

/* Anchor each cluster on a ring and pull its members toward it. Springs alone
   leave groups interleaved no matter how much repulsion you add — separation
   has to be imposed by the layout, as in a community map. */
let CLUSTER_ANCHORS=[];
(function(){
  const k=Math.max(1,CLUSTERS.length);
  /* A fixed 460 ring put the eleven anchors ~263 apart while the clusters
     themselves grew to ~330 across, so they could not help overlapping and the
     grouping the layout exists to show was invisible. Spacing has to scale with
     how much cloud each cluster occupies, which grows with the library:
     measured separation ratio 1.28 -> 1.66 and nearest-neighbour purity
     0.81 -> 0.88 across the change. */
  const R=Math.max(460, 21*Math.sqrt(DATA.length*k));
  for(let i=0;i<k;i++){
    const a=(i/k)*Math.PI*2;
    CLUSTER_ANCHORS.push({x:Math.cos(a)*R, y:Math.sin(a)*R*0.70, z:((i%3)-1)*R*0.33});
  }
})();

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
  if(cluster){
    for(const n of nodes){
      const a=CLUSTER_ANCHORS[n.cl];
      if(!a)continue;
      n.vx+=(a.x-n.x)*.024*alpha; n.vy+=(a.y-n.y)*.024*alpha;
      if(!flat)n.vz+=(a.z-n.z)*.024*alpha;
    }
  }
  const grav=cluster?.020:.055;
  for(const n of nodes){                     // gravity toward origin
    n.vx+=-n.x*grav*alpha; n.vy+=-n.y*grav*alpha;
    n.vz+=flat? -n.z*.34 : -n.z*grav*alpha;  // flat mode collapses depth
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
    n.PX=W/2+panX+x1*k*zoom; n.PY=H/2+panY+y2*k*zoom; n.PK=k*zoom; n.PZ=zc;
    if(zc<near)near=zc; if(zc>far)far=zc;
  }
  const span=Math.max(1,far-near);
  for(const n of nodes) n.fog=flat?0:Math.min(.82,Math.max(0,(n.PZ-near)/span)*.82);
}

/* ---------- render ---------- */
function draw(){
  project();
  ctx.clearRect(0,0,W,H);
  drawClouds();                 // behind everything, so edges and dots sit on top
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
  /* How many titles the frame can carry: roughly one per 9000 square pixels,
     which on a 1350x975 stage is about 18 and on a phone about 5. Chosen by
     rank (predicted fit for the unread), so the labels that survive are the
     ones worth reading rather than the ones that happened to win a collision. */
  const labelRank=new Set();
  if(focus===null){
    const budget=Math.max(4,Math.min(26,Math.round(W*H/9000)));
    nodes.filter(n=>n.r===0&&passes(n))
      .sort((a,b)=>(b.praw??b.p)-(a.praw??a.p))
      .slice(0,budget).forEach(n=>labelRank.add(n.id));
  }
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
          ctx.strokeStyle=shadeHex(nodeHex(n),a*(.3-h*.06),n.fog*.5);
          ctx.lineWidth=Math.max(.8,1.4*n.PK);ctx.stroke();
        }
        ctx.beginPath();ctx.arc(n.PX,n.PY,rr,0,6.2832);
        ctx.fillStyle=shadeHex(nodeHex(n),a*.3,n.fog);ctx.fill();
        ctx.strokeStyle=shadeHex(nodeHex(n),a,n.fog*.5);
        ctx.lineWidth=Math.max(1.4,2.6*n.PK);ctx.stroke();
      }else{
        ctx.beginPath();ctx.arc(n.PX,n.PY,rr,0,6.2832);
        ctx.fillStyle=shadeHex(nodeHex(n),a,n.fog);ctx.fill();
      }
      if(isF||n.id===selected){
        ctx.beginPath();ctx.arc(n.PX,n.PY,rr+5,0,6.2832);
        ctx.strokeStyle=shade("vellum",.75,0);ctx.lineWidth=1;ctx.stroke();
      }
      // labels: focus, its neighbours, and near-camera top-rated anchors
      // Label density has to scale with the frame: on a phone, labelling all
      // 179 recommendations turns the centre into a smear. Near-camera, top-band
      // books earn a name; the rest are reachable by tapping.
      const small=W<620;
      /* A budget, not a rule. Labelling every recommendation meant 175 titles
         competing for one screen: the collision resolver then dropped most of
         them, so what survived was whichever happened to be nearest the camera
         rather than whichever was worth reading. Rank first, draw the top of
         the ranking, and let hover and search reach the rest. */
      const anchor=live&&(small
        ? (rec&&labelRank.has(n.id)) || (n.r>=4.5&&n.fog<.16&&!spotlight)
        : (rec&&labelRank.has(n.id)) || (n.r>=4.5&&n.fog<.34&&!spotlight));
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

  // Cluster names, drawn at each group's centroid before book titles claim space
  CLOUDS_DONE=false;
  if(cluster&&focus===null&&CLUSTERS.length){
    ctx.textAlign="center";ctx.textBaseline="middle";
    for(let ci=0;ci<CLUSTERS.length;ci++){
      const mem=nodes.filter(n=>n.cl===ci&&passes(n));
      if(mem.length<4)continue;
      let x=0,y=0,k=0;
      for(const n of mem){x+=n.PX;y+=n.PY;k+=n.PK;}
      x/=mem.length;y/=mem.length;k/=mem.length;
      const lab=(CLUSTERS[ci].label||"").toUpperCase();
      ctx.font="600 "+Math.max(9,10.5*Math.min(1.2,k))+"px 'IBM Plex Mono',ui-monospace,monospace";
      const w=ctx.measureText(lab).width;
      /* Group names used to be painted at the centroid regardless of what was
         already there, so four of them stacked on one another in the middle of
         the frame. They now take a slot from the same reservation list the book
         titles use, stepping up or down before giving up. */
      let cy=y-46*k;
      const bx=x-w/2-8, bw=w+16;
      const clash=t=>placed.some(p=>bx<p[2]&&p[0]<bx+bw&&t-9<p[3]&&p[1]<t+24);
      if(clash(cy)){
        // Every group keeps its name. If no free slot exists the label is drawn
        // anyway, overlapping: a group nobody can name is worse than two names
        // that touch, and this is the only place a group is identified.
        const alt=[cy-26,cy+26,cy-52,cy+52,cy-78,cy+78];
        cy=alt.find(c=>!clash(c))??cy;
      }
      placed.push([bx,cy-9,bx+bw,cy+24]);
      ctx.fillStyle=shade("field",.82,0);
      ctx.fillRect(bx,cy-9,bw,18);
      ctx.fillStyle=shadeHex(CLUSTER_COLORS[famOf(ci)%CLUSTER_COLORS.length],.95,0);
      ctx.fillText(lab,x,cy);
      ctx.font="9px 'IBM Plex Mono',ui-monospace,monospace";
      // the count is a caption, not a series value — it wears the muted ink
      // token. In the group's own colour at .45 it fell below reading contrast.
      ctx.fillStyle=shade("faint",.85,0);
      ctx.fillText(mem.length+" books",x,cy+15);
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
      ctx.strokeStyle=shadeHex(nodeHex(f),.5,0);ctx.lineWidth=1;
      ctx.strokeRect(bx-w/2-7,by-8,w+14,16);
      ctx.fillStyle=shadeHex(nodeHex(f),.95,0);
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
  /* Zoom toward the pointer, not the middle of the canvas. The projection is
     PX = W/2 + panX + X*zoom, so holding the point under the cursor still means
     panX += dx*(1-f), with dx the cursor's offset from the graph origin and f
     the zoom ratio. Without it, zooming in on anything off-centre meant zooming
     and then going to look for it. */
  const before=zoom;
  userZoomed=true;zoom=Math.max(.16,Math.min(3,zoom*(e.deltaY>0?.92:1.087)));
  const f=zoom/before, r=cv.getBoundingClientRect();
  panX+=(e.clientX-r.left-W/2-panX)*(1-f);
  panY+=(e.clientY-r.top-H/2-panY)*(1-f);
  kick();
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
       '<span class="rank-bar"><div style="width:'+Math.round((n.p-3.5)/1.5*100)+'%;background:'+nodeHex(n)+'"></div></span></div>';
  });
  /* The committed r is measured against tags made with the ratings in view, so
     it flatters itself. Forty books retagged blind put the honest figure near
     0.67 — see docs-data.md. Quoting the optimistic number on the page would be
     the same error the tagging made. */
  h+='<p class="caveat">Scored from the seven register axes only — the facets turned out to carry '+
     'no predictive signal, so they build the graph but not the score. Against books retagged by '+
     'raters who never saw a rating, the model agrees at r=0.65, residual ±0.74 — the committed '+
     'r='+MODEL.r+' was measured against tags made with the ratings visible. '+
     'Gaps smaller than the residual are noise, which is why these sit in bands rather than a '+
     'strict ranking.</p>';
  el.innerHTML=h;
  el.querySelectorAll(".rank").forEach(d=>d.onclick=()=>{
    selected=+d.dataset.id;renderDetail();revealDetail();kick();});
  const ec=el.querySelector("#empty-clear");
  if(ec)ec.onclick=()=>clearAllFilters();
}
/* How far this book's series sits from the global rating scale, if the model
   knows. Keyed the same way fit.py keys it. */
function serOffset(b){
  const t=(MODEL.ser_offset)||{};
  const k=b.ser?snorm(b.ser):"solo:"+snorm(b.t);
  return t[k]||0;
}
function predBlock(b){
  const ups=AXES.map(a=>({n:a.n,c:MODEL.coef[a.k]*(b.ax[a.k]-AXMEAN[a.k])}))
    .filter(o=>Math.abs(o.c)>=.08).sort((x,y)=>Math.abs(y.c)-Math.abs(x.c)).slice(0,3);
  return `<div class="pred">
    <div class="pred-l">Predicted fit${b.r>0?" (model, ignoring your actual rating)":""}</div>
    <div class="pred-n">${b.p.toFixed(1)} <small>± ${MODEL.sd}</small></div>
    ${b.weber_risk?`<div style="font-size:10.5px;color:var(--campaign-war);margin-top:6px">⚠ plain prose + formulaic — the Weber profile you bounce on</div>`:""}
    ${b.r===0&&b.kingsim>=0.6?`<div style="font-size:10.5px;color:var(--accent);margin-top:6px">↑ King-adjacent — lifted for your guarded-ceiling King ratings</div>`:""}
    ${(()=>{const o=serOffset(b);if(!o)return "";
      /* The score above already includes this. Say so, because a book whose
         siblings you rated is not being judged on the same scale as a
         standalone — a rating inside a long series is given relative to the
         rest of the series, and the model now reads it that way. */
      return `<div style="font-size:10.5px;color:${o>0?"var(--quest)":"var(--campaign-war)"};margin-top:6px">
        ${o>0?"↑":"↓"} ${o>0?"+":""}${o.toFixed(1)} because you rate ${b.ser?"<i>"+b.ser+"</i>":"this series"} ${
          o>0?"above":"below"} your average</div>`;})()}
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
const LS_KEY="reading-network:ratings", LS_LOG="reading-network:log", LS_TOK="reading-network:gist";
let myRatings={}, ratingLog=[];
/* Ratings committed to src/data/ratings.json arrive baked into the data, so the
   app starts from whatever git already knows. */
const COMMITTED=(window.__DATA__&&window.__DATA__.ratings&&window.__DATA__.ratings.ratings)||{};
let storageOK=(()=>{try{localStorage.setItem("__t","1");localStorage.removeItem("__t");return true}
  catch(e){return false}})();

function loadRatings(){
  if(!storageOK)return;
  try{
    const raw=localStorage.getItem(LS_KEY);
    if(raw)myRatings=JSON.parse(raw)||{};
    const lg=localStorage.getItem(LS_LOG);
    if(lg)ratingLog=JSON.parse(lg)||[];
  }catch(e){myRatings={};ratingLog=[]}
}
function saveRatings(){
  if(!storageOK)return false;
  try{
    localStorage.setItem(LS_KEY,JSON.stringify(myRatings));
    localStorage.setItem(LS_LOG,JSON.stringify(ratingLog.slice(-500)));
    return true;
  }catch(e){return false}
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
/* Title is the join key for every rating, but the bibliographies and the library
   disagree on a handful of titles — ISFDB lists "The Atrocity Archive" where
   Goodreads has "The Atrocity Archives". Rating from a series list then files a
   second, orphaned record for a book already in the library. Titles are matched
   normalised, and a singular/plural match is only accepted when exactly one book
   could be meant. */
const tnorm=t=>String(t).toLowerCase().replace(/^(the|a|an)\s+/,"")
  .replace(/[^a-z0-9 ]/g,"").replace(/\s+/g," ").trim();
const TITLE_IDX=(()=>{
  const exact=new Map(), stem=new Map();
  for(const n of nodes){
    exact.set(tnorm(n.t),n);
    const s=tnorm(n.t).replace(/s$/,"");
    stem.set(s, stem.has(s) ? null : n);        // null marks an ambiguous stem
  }
  return {exact,stem};
})();
function nodeForTitle(t){
  return TITLE_IDX.exact.get(tnorm(t)) || TITLE_IDX.stem.get(tnorm(t).replace(/s$/,"")) || null;
}
/* The library's spelling wins, so a rating always lands on one key. */
const canonicalTitle=t=>{const n=nodeForTitle(t);return n?n.t:t;};

/* Rate anything with a title, whether or not it exists as a node. Series lists
   contain volumes that were never in Goodreads, and those still need a record. */
/* Half stars. Five glyphs, ten levels: a click in the left half of a star means
   x.5 and the right half means x.0, so nothing about the layout or the size of
   a touch target changes. Worth doing because the five-point scale had run out
   of room at the top -- 51% of the ratings made in the app were 5s, which is a
   ceiling, not an opinion. */
const RSTEP=0.5;
const starClass=(cur,v)=>cur>=v?" on":cur>=v-RSTEP?" half":"";
function starValue(btn,ev){
  const v=+btn.dataset.v, r=btn.getBoundingClientRect();
  // keyboard activation reports clientX 0; treat that as the whole star
  if(!ev||!ev.clientX)return v;
  return ev.clientX-r.left < r.width/2 ? v-RSTEP : v;
}
const rateLabel=v=>v?(v%1?v.toFixed(1):String(v))+"★":"";

function setRatingByTitle(title,v,note){
  title=canonicalTitle(title);
  const was=myRatings[title]??null;
  if(v===0)delete myRatings[title]; else myRatings[title]=v;
  const n=nodeForTitle(title);
  if(n){ if(n._origR===undefined)n._origR=n.r; n.r = v===0 ? (n._origR||0) : v; }
  ratingLog.push({t:title,from:was,to:v||null,at:new Date().toISOString(),...(note?{note}:{})});
  saveRatings(); scheduleFileWrite();
  if(gistToken()&&gistId())scheduleGistPush();
}
/* named distinctly from ratingOf(node), which is the sizing helper */
function myRatingFor(title){
  title=canonicalTitle(title);
  if(Object.prototype.hasOwnProperty.call(myRatings,title))return myRatings[title];
  const n=nodeForTitle(title);
  return n&&n.r>0?n.r:null;
}
function setRating(b,v){
  if(b._origR===undefined)b._origR=b.r;
  const was = myRatings[b.t] ?? (b._origR||null);
  if(v===0){ delete myRatings[b.t]; b.r=b._origR||0; }
  else { myRatings[b.t]=v; b.r=v; }
  // every change leaves a dated entry, so there is an audit trail rather than
  // just a final state — useful when reconciling against git later
  ratingLog.push({t:b.t,from:was,to:v||null,at:new Date().toISOString()});
  saveRatings();
  scheduleFileWrite();
  if(gistToken()&&gistId())scheduleGistPush();
}
function ratingsCount(){return Object.keys(myRatings).length}

/* ---- layer 2a: a real file on disk ----
   The File System Access API hands back a persistent handle, so after picking
   ratings.json once, every later rating writes straight to that file — point it
   at src/data/ratings.json in your checkout and the repo updates as you rate.
   Chrome/Edge only; Safari and Firefox fall back to download/import below. */
const CAN_FS = typeof window.showSaveFilePicker === "function";
let fileHandle=null, fsTimer=null;
async function pickRatingsFile(mode){
  try{
    if(mode==="open"){
      [fileHandle]=await window.showOpenFilePicker({
        types:[{description:"Ratings JSON",accept:{"application/json":[".json"]}}]});
      const txt=await (await fileHandle.getFile()).text();
      let inc=JSON.parse(txt||"{}");
      if(inc.log&&Array.isArray(inc.log))ratingLog=inc.log.concat(ratingLog).slice(-500);
      if(inc.ratings)inc=inc.ratings;
      let n=0;
      for(const [k,v] of Object.entries(inc))
        if(typeof v==="number"&&v>=1&&v<=5){myRatings[k]=v;n++;}
      saveRatings();applyRatings();update();renderDetail();kick();
      syncNote(`Linked ${fileHandle.name} — ${n} rating${n===1?"":"s"} loaded. Changes now write straight to it.`);
    }else{
      fileHandle=await window.showSaveFilePicker({suggestedName:"ratings.json",
        types:[{description:"Ratings JSON",accept:{"application/json":[".json"]}}]});
      await writeRatingsFile();
      syncNote(`Writing to ${fileHandle.name}. Changes save automatically.`);
    }
    renderSync();
  }catch(e){ if(e&&e.name!=="AbortError")syncNote(String(e.message),true); }
}
async function writeRatingsFile(){
  if(!fileHandle)return;
  try{
    const w=await fileHandle.createWritable();
    await w.write(JSON.stringify(ratingsFile(),null,1));
    await w.close();
    const el=document.getElementById("fs-stamp");
    if(el)el.textContent="saved "+new Date().toLocaleTimeString();
  }catch(e){ syncNote("Couldn't write the file: "+e.message,true); }
}
function scheduleFileWrite(){ if(!fileHandle)return;
  clearTimeout(fsTimer); fsTimer=setTimeout(writeRatingsFile,600); }

/* ---- layer 2b: download / import ---- */
function ratingsFile(){
  return {_note:"Ratings recorded in the app. Committed to git as the durable record. build.py merges these over books.json.",
          updated:new Date().toISOString(),
          ratings:{...COMMITTED,...myRatings},
          log:ratingLog.slice(-500)};
}
function downloadRatings(){
  // same shape as src/data/ratings.json, so this file can be dropped straight in
  const blob=new Blob([JSON.stringify(ratingsFile(),null,1)],{type:"application/json"});
  const a=document.createElement("a");
  a.href=URL.createObjectURL(blob);
  a.download="ratings.json";
  a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),2000);
}
function importRatingsFile(file){
  const fr=new FileReader();
  fr.onload=()=>{
    try{
      let inc=JSON.parse(fr.result);
      if(typeof inc!=="object"||Array.isArray(inc))throw new Error("not an object");
      if(inc.ratings&&typeof inc.ratings==="object"){          // full file form
        if(Array.isArray(inc.log))ratingLog=inc.log.concat(ratingLog).slice(-500);
        inc=inc.ratings;
      }
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
    files:{"ratings.json":{content:JSON.stringify(ratingsFile(),null,1)}}};
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
    let inc=JSON.parse(f.content);
    if(inc.ratings)inc=inc.ratings;
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
const ALLSER=window.__DATA__.all_series;
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
function similarUnread(b,k=8){
  featStats();
  const z=featOf(b).map((v,i)=>(v-_mu[i])/_sd[i]);
  const all=nodes.filter(x=>x.r===0&&x.id!==b.id)
    .map(x=>({x,d:Math.hypot(...featOf(x).map((v,i)=>(v-_mu[i])/_sd[i]-z[i]))}))
    .sort((a,c)=>a.d-c.d);
  /* "How close" as a percentile, not the raw distance. The distance lives in
     z-scored eight-axis space, so its units mean nothing to a reader — 0.9 is
     only meaningful against the spread of everything else. The percentile says
     the one thing worth knowing: how much of the shelf this one beats. */
  return all.slice(0,k).map((e,i)=>({...e,pct:Math.max(1,Math.round(100*(i+1)/all.length))}));
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
  /* community_pace is never quoted as a reason. Its coefficient is a large
     negative (-0.385) while its raw correlation with the ratings is -0.03 — it
     is a suppressor, not an effect. Because pace and the velocity tag overlap
     (+0.52), the fit uses pace to subtract the part of "fast" that is merely
     quick rather than gripping, so the number only means anything sitting
     beside velocity. Rendered on its own it told you that reading fast held a
     book back, which the data does not say. It still scores; it just cannot
     narrate. */
  const c2=c.filter(x=>keys[x.i]!=="community_pace");
  const up=c2.filter(x=>x.contrib>0).sort((a,z)=>z.contrib-a.contrib);
  const dn=c2.filter(x=>x.contrib<0).sort((a,z)=>a.contrib-z.contrib);
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
  /* Chips drive the same activeTags filter the sidebar does, so a tag you can
     see on a book is a tag you can pull the library down to. They were inert
     spans, which meant reading "hidden-world-occult" here and then hunting for
     it in the tag list to act on it. A selected one shows as on. */
  const chips=(arr,hot)=>(arr||[]).map(v=>
    `<button class="chip${hot?" hot":""}${activeTags.has(tagKey("",v))?" on":""}" data-tag="${
      String(v).replace(/"/g,"&quot;")}" title="Filter the library to ${v}">${v}</button>`).join("");
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
    <div class="d-rating" style="border-color:${nodeHex(b)};color:${nodeHex(b)}">
      ${b.r===0?"not yet read":b.r+" of 5"}</div>
    ${b.blurb?`<div class="blurb-wrap"><div class="blurb ${b._open?"open":""}" id="blurb">${b.blurb}</div>${
      b.blurb.length>360?`<button class="blurb-more" id="blurb-more">${b._open?"less":"more"}</button>`:""}</div>`:""}
    ${predBlock(b)}
    ${(()=>{const c=CLUSTERS[b.cl];if(!c)return "";
      // which of the twenty groups this book sits in — the graph shows it by
      // position and colour, but the detail panel never named it
      const solo=offClusters.size===CLUSTERS.length-1&&!offClusters.has(b.cl);
      return `<div class="facet"><div class="facet-label">Group</div><div class="chips">
        <button class="chip grp${solo?" on":""}" data-cl="${b.cl}"
          title="${solo?"Showing only this group — click to show all":"Show only this group"}"
          style="border-color:${CLUSTER_COLORS[famOf(b.cl)%CLUSTER_COLORS.length]}"
          >${c.label} <em>${c.n}</em></button></div></div>`;})()}
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
        Math.abs(b.cpace-b.ax[0])>=1.5?` <span style="color:var(--accent)">— you read this faster than its pace suggests</span>`:""}</div></div>`:""}
    ${flags.map(f=>`<div class="flag"><b>${f[0]}</b>${f[1]}</div>`).join("")}

    <div class="why">${explainScore(b)}</div>

    ${b.r>0?(()=>{const exp=Math.max(1,Math.min(5,MODEL.intercept+
        featOf(b).reduce((s,v,i)=>s+MODEL.coef[i]*v,0)));
      const d=b.r-exp, big=Math.abs(d)>MODEL.sd;
      return `<div class="vs${big?" vs-big":""}">
        <div class="vs-row"><span>You rated</span><b>${b.r}</b></div>
        <div class="vs-row"><span>Model expected</span><b>${exp.toFixed(1)}</b></div>
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
      <div class="near-note">Unread books closest to it on the same seven axes — &ldquo;top N%&rdquo; is where each ranks among all ${nodes.filter(x=>x.r===0).length} unread books.</div>
      ${sim.map(({x,pct})=>`<div class="near" data-id="${x.id}">
          <span class="near-t">${x.t}</span>
          <span class="near-k">top ${pct}%</span>
          <span class="near-r">${x.p.toFixed(1)}</span></div>`).join("")}`;})()}

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
    <div class="eyebrow">${b.r>0?"Your rating — "+rateLabel(b.r):"Read it? Rate it"}</div>
    <div class="rate" id="rate">${[1,2,3,4,5].map(v=>
      `<button class="rb${starClass(b.r,v)}" data-v="${v}" aria-label="${v} stars">${v}</button>`).join("")}
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
  el.querySelectorAll(".chip[data-tag]").forEach(d=>d.onclick=e=>{
    e.stopPropagation();
    const key=tagKey("",d.dataset.tag);
    activeTags.has(key)?activeTags.delete(key):activeTags.add(key);
    renderDetail();update();
  });
  el.querySelectorAll(".chip.grp").forEach(d=>d.onclick=e=>{
    e.stopPropagation();
    // solo this group: everything else off, or clear if it is already solo'd
    const ci=+d.dataset.cl;
    const solo=offClusters.size===CLUSTERS.length-1&&!offClusters.has(ci);
    offClusters.clear();
    if(!solo)CLUSTERS.forEach(c=>{if(c.id!==ci)offClusters.add(c.id);});
    update();          // update -> syncControls repaints both legends
    renderDetail();    // so the chip shows whether it is currently soloing
  });
  el.querySelectorAll(".rb").forEach(btn=>btn.onclick=()=>{
    const v=+btn.dataset.v;
    setRating(b, v===0?0:(b.r===v?0:v));
    renderDetail();update();kick();
  });
}

/* ---------- cluster legend ---------- */
(function(){
  const el=document.getElementById("clegend");
  if(!el||!CLUSTERS.length)return;
  el.innerHTML=CLUSTERS.map(c=>
    `<div class="leg" data-cl="${c.id}"><i style="background:${CLUSTER_COLORS[famOf(c.id)%CLUSTER_COLORS.length]}"></i>${
      c.label} <b>${c.n}</b></div>`).join("");
  el.querySelectorAll(".leg").forEach(d=>d.onclick=()=>{
    const ci=+d.dataset.cl;
    // clicking a group focuses it: everything else drops back
    const on=d.classList.toggle("off");
    offClusters[on?"add":"delete"](ci);
    update();
  });
  const set=(c)=>{cluster=c;
    colorBy=c?"cluster":"engine";
    document.getElementById("c-on").classList.toggle("on",c);
    document.getElementById("c-off").classList.toggle("on",!c);
    el.style.display=c?"":"none";
    reheat(.9);update();};
  document.getElementById("c-on").onclick=()=>set(true);
  document.getElementById("c-off").onclick=()=>set(false);
})();

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
// It says "No filter", so it removes the filters — all of them, not just the
// register sliders it happens to sit next to. Reaching for the button labelled
// no-filter and still seeing a filtered library is the whole complaint.
document.getElementById("preset-clear").onclick=clearAllFilters;
document.getElementById("t-read").onclick=e=>{showRead=!showRead;e.target.classList.toggle("on",showRead);update()};
document.getElementById("t-rec").onclick=e=>{showRec=!showRec;e.target.classList.toggle("on",showRec);update()};
document.getElementById("m-depth").onclick=()=>setMode(false);
document.getElementById("m-flat").onclick=()=>setMode(true);
document.getElementById("m-spin").onclick=e=>{
  spin=!spin; e.target.classList.toggle("on",spin);
  try{localStorage.setItem("reading-network:spin",spin?"1":"0")}catch(err){}
  kick();
};
// reflect the stored preference on load
document.getElementById("m-spin").classList.toggle("on",spin);
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
/* Both legends repainted from the filter state, on every update.
   syncControls() ran only from clear-all and one toggle, so a group hidden by
   any other route — the detail panel's Group chip, most of all — left its
   legend entry looking lit. Clicking an entry that looks lit is how you end up
   hiding the last group still on screen and seeing nothing. */
function syncLegends(){
  document.querySelectorAll("#legend .leg").forEach(el=>
    el.classList.toggle("off",offEngines.has(el.dataset.en)));
  document.querySelectorAll("#clegend .leg").forEach(el=>
    el.classList.toggle("off",offClusters.has(+el.dataset.cl)));
}
function syncControls(){          // push filter state back into the controls
  AXES.forEach(a=>{
    const sl=document.getElementById("s"+a.k), vl=document.getElementById("v"+a.k);
    if(sl)sl.value=limits[a.k];
    if(vl)vl.textContent=limits[a.k];
  });
  const tr=document.getElementById("t-read"),tc=document.getElementById("t-rec");
  if(tr)tr.classList.toggle("on",showRead);
  if(tc)tc.classList.toggle("on",showRec);
  syncLegends();
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
const needsView=document.getElementById("needsview");
let lvSort="p", lvDesc=true;
function renderList(){
  const rows=nodes.filter(n=>n.r===0&&passes(n));
  const key=n=>lvSort==="p"?(n.praw??n.p):lvSort==="ax0"?n.ax[0]:
              lvSort==="cpace"?(n.cpace??0):(n.nrev??0);
  rows.sort((a,b)=>lvDesc?key(b)-key(a):key(a)-key(b));
  if(!rows.length){lvRows.innerHTML='<div class="fr-none" style="padding:24px">No unread books match these filters.</div>';return;}
  /* Banded, like the ranked panel, and for the same reason: residual sd is 0.63,
     so a table that ranks 4.99 above 4.93 to two decimals is claiming a precision
     the model does not have. Bands only mean anything while the sort is by fit,
     descending — sorting by pace and keeping fit headers would be nonsense. */
  const banded=lvSort==="p"&&lvDesc;
  let last=-1;
  lvRows.innerHTML=rows.map(n=>{
    const pace=n.cpace!=null?n.cpace.toFixed(1):"—";
    const known=n.nrev?(n.nrev>=1000?Math.round(n.nrev/1000)+"k":n.nrev):"—";
    const w=Math.max(0,Math.min(1,((n.praw??n.p)-3)/2))*100;
    let head="";
    if(banded){
      const bd=band(n.p);
      if(bd!==last){
        last=bd;
        head=`<div class="lv-band"><span>${BANDS[bd][1]} fit</span><span>${
          bd===0?"4.6+":bd===1?"4.2–4.6":"below 4.2"}</span></div>`;
      }
    }
    return `${head}<div class="lv-row" data-id="${n.id}">
      <div class="lv-t">${n.t}<span class="lv-a">${n.a}</span></div>
      <div class="lv-n hi">${n.p.toFixed(1)}
        <i class="lv-bar" style="width:${w.toFixed(0)}%;background:${nodeHex(n)}"></i></div>
      <div class="lv-n">${n.ax[0]}</div>
      <div class="lv-n">${pace}</div>
      <div class="lv-n">${known}</div></div>`;}).join("");
  lvRows.querySelectorAll(".lv-row").forEach(el=>el.onclick=()=>{
    selected=+el.dataset.id; renderDetail();
    if(innerWidth<=1000)setSheet("detail"); else setView("graph");
    kick();
  });
}
/* Clicking a header toggled direction with nothing on screen to say which way it
   had gone, so the caret is the only affordance for a state the table already had. */
const LV_LABEL=new Map([...document.querySelectorAll(".lv-sort")].map(b=>[b.dataset.k,b.textContent]));
function syncSortHeads(){
  document.querySelectorAll(".lv-sort").forEach(x=>{
    const on=x.dataset.k===lvSort;
    x.classList.toggle("on",on);
    x.textContent=LV_LABEL.get(x.dataset.k)+(on?(lvDesc?" ↓":" ↑"):"");
    x.setAttribute("aria-sort",on?(lvDesc?"descending":"ascending"):"none");
  });
}
document.querySelectorAll(".lv-sort").forEach(b=>b.onclick=()=>{
  const k=b.dataset.k;
  if(lvSort===k)lvDesc=!lvDesc; else {lvSort=k;lvDesc=true;}
  syncSortHeads();
  renderList();
});
syncSortHeads();
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
        <div class="mcard-p">${b.p.toFixed(1)}</div></div>
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
    ${CAN_FS?`<div class="fsbox">
      <div class="btnrow">
        <button id="fs-link">${fileHandle?"Change file":"Link a ratings.json"}</button>
        <button id="fs-open">Open existing</button>
      </div>
      <div class="sync-help">${fileHandle
        ? `Writing to <b>${fileHandle.name}</b> on every change. <span id="fs-stamp"></span>`
        : "Pick a file once and every rating writes straight to it — point it at <b>src/data/ratings.json</b> in your checkout."}</div>
    </div>`:`<div class="sync-help">This browser can't write files directly; use the backup below. (Chrome and Edge can.)</div>`}
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
  if(CAN_FS){
    $("fs-link").onclick=()=>pickRatingsFile("save");
    $("fs-open").onclick=()=>pickRatingsFile("open");
  }
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
let shelfMode="author", shelfOpen=new Set(), shelfQuery="", shelfStatus="all";
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
    /* The three sources don't agree on series keys: all_series.json keys four of
       them short — "corax", "mars", "traitor son", "demon" — where books.json
       and next_in_series.json use the full name. Keyed naively that splits one
       series into two shelves, one holding the books and one the bibliography,
       and Corax Trilogy appeared twice. The display name is the thing all three
       do agree on, so it reconciles them. */
    const resolve=(k,name)=>{
      if(g.has(k))return k;
      for(const [gk,gv] of g)if(snorm(gv.name)===snorm(name))return gk;
      return k;
    };
    for(const [k0,e] of Object.entries(NEXTSER)){
      const k=resolve(k0,e.name);
      if(!g.has(k))g.set(k,{key:k,name:e.name,read:[],unread:[],extra:[]});
      g.get(k).extra=e.next; g.get(k).src=e.src;
    }
    // full bibliographies: every volume, rated or not, so gaps are visible
    for(const [k0,e] of Object.entries(ALLSER)){
      const k=resolve(k0,e.name);
      if(!g.has(k))g.set(k,{key:k,name:e.name,read:[],unread:[],extra:[]});
      const v=g.get(k); v.full=e.vols; v.src=e.src;
    }
    for(const v of g.values()){
      const m=META.series[v.key];
      v.n=m?m.n:v.read.length; v.mean=m?m.mean:null;
    }
  }
  return [...g.values()].filter(v=>v.n>=1||v.unread.length||v.extra.length);
}
/* Counted once per shelf so the filter, the header and the body can never
   disagree. When a full bibliography exists it is the authority on what is
   unread: v.unread only knows about volumes that made it into the library, which
   is why Laundry Files read "complete" with three volumes still unrated. */
function shelfStats(v){
  const seen=new Set();
  const vols=(v.full||[]).filter(x=>{
    const k=canonicalTitle(x.t);
    return seen.has(k) ? false : (seen.add(k), true);
  });
  const unread = v.full ? vols.filter(x=>!myRatingFor(x.t)).length
                        : v.unread.length+v.extra.length;
  const read = v.full ? vols.length-unread : (v.n||v.read.length);
  /* Whether anything outside the library knows how long this series is. 87 of
     144 series shelves are a single book with no bibliography at all — those
     were labelled "complete", which is a claim about the world rather than a
     fact about the shelf. Discworld says complete on the strength of owning
     Small Gods. */
  const known = !!(v.full || v.extra.length);
  return {vols,unread,read,known};
}
function renderShelves(){
  let rows=buildShelves();
  rows.forEach(v=>v._s=shelfStats(v));
  const total=rows.length;
  /* 183 authors in one flat column is a wall. Two narrowing tools, because they
     answer different questions: the text box for "where is X", the status
     buttons for "what have I actually got going". */
  const q=shelfQuery.trim().toLowerCase();
  rows=rows.filter(v=>{
    if(q&&!v.name.toLowerCase().includes(q))return false;
    if(shelfStatus==="started")return v._s.read>0;
    if(shelfStatus==="open")return v._s.read>0&&v._s.unread>0;
    return true;
  });
  /* Most useful first, where useful means "someone you have a track record with
     and unfinished business". Sorting on mean alone put every author you rated a
     single book 5★ above Jim Butcher at twenty — a perfect average over one book
     is not evidence. Damping by log of the count ranks depth of relationship
     without letting a long mediocre series outrank a short loved one. */
  const pull=v=>(v.mean||0)*Math.log2(1+(v.n||0));
  rows.sort((a,b)=>{
    if((a._s.unread>0)!==(b._s.unread>0))return b._s.unread-a._s.unread;
    return pull(b)-pull(a) || b.n-a.n || a.name.localeCompare(b.name);
  });
  const noun=shelfMode==="author"?"authors":"series";
  document.getElementById("shelf-hint").textContent = rows.length===total
    ? `${total} ${noun} · ${rows.filter(r=>r._s.unread>0).length} with something unread`
    : `${rows.length} of ${total} ${noun}`;
  if(!rows.length)shelfRows.innerHTML=
    `<div class="fr-none" style="padding:26px 24px">Nothing matches that filter.</div>`;
  else shelfRows.innerHTML=rows.map(v=>{
    const open=shelfOpen.has(v.key), un=v._s.unread, vols=v._s.vols;
    const body=[
      ...v.read.sort((a,b)=>(a.vol||99)-(b.vol||99)).map(n=>
        `<div class="sb" data-id="${n.id}"><span class="sb-v">${n.vol?"#"+(n.vol%1?n.vol:n.vol|0):""}</span>
          <span class="sb-t">${n.t}</span>
          <span class="minirate" data-title="${n.t.replace(/"/g,"&quot;")}">${[1,2,3,4,5].map(v=>
            `<button class="ms${starClass(n.r,v)}" data-v="${v}" title="${v} stars — click the left half for ${v-0.5}">★</button>`).join("")}<b class="mr-v">${rateLabel(n.r)}</b></span></div>`),
      ...v.unread.sort((a,b)=>(b.praw??b.p)-(a.praw??a.p)).map(n=>{
        const cur=myRatingFor(n.t);
        return `<div class="sb${cur?"":" unread"}" data-id="${n.id}">
          <span class="sb-v">${n.vol?"#"+(n.vol%1?n.vol:n.vol|0):""}</span>
          <span class="sb-t">${n.t}</span>
          <span class="sb-fit">${cur?"":n.p.toFixed(1)}</span>
          <span class="minirate" data-title="${n.t.replace(/"/g,"&quot;")}">${[1,2,3,4,5].map(v=>
            `<button class="ms${starClass(cur,v)}" data-v="${v}" title="${v} stars — click the left half for ${v-0.5}">★</button>`).join("")}<b class="mr-v">${rateLabel(cur)}</b></span></div>`;}),
      ...(v.full? [] : v.extra.map(x=>
        `<div class="sb unread ext"><span class="sb-v">${x.ord?"#"+x.ord:""}</span>
          <span class="sb-t">${x.t}</span><span class="sb-r">${x.yr||""}</span></div>`))
    ].join("");
    // when a full bibliography exists it replaces the piecemeal lists: every
    // volume in order, so a book you read but never logged shows as a gap
    /* ISFDB lists the novel and the collection that reprints it as separate
       volumes — "The Atrocity Archive" and "The Atrocity Archives". Both now
       resolve to the same library book, so rendering both would show one book
       twice, rated twice, from a single rating. */
    const fullBody = v.full ? vols.map(x=>{
      const n=nodeForTitle(x.t);
      const cur=myRatingFor(x.t);
      const esc=canonicalTitle(x.t).replace(/"/g,"&quot;");
      return `<div class="sb${cur?"":" unread"}"${n?` data-id="${n.id}"`:""}>
        <span class="sb-v">${x.ord?"#"+x.ord:""}</span>
        <span class="sb-t">${x.t}${n?"":`<em class="notin">not in library</em>`}</span>
        <span class="sb-fit">${!cur&&n?n.p.toFixed(1):""}</span>
        <span class="minirate" data-title="${esc}">${[1,2,3,4,5].map(v=>
          `<button class="ms${starClass(cur,v)}" data-v="${v}" title="${v} star${v>1?"s":""} — click the left half for ${v-0.5}">★</button>`).join("")}<b class="mr-v">${rateLabel(cur)}</b>
        </span></div>`;}).join("") : "";
    // cross-link: from an author shelf jump to their series, and vice versa
    const cross=shelfMode==="author"
      ? [...new Set([...v.read,...v.unread].filter(n=>n.ser).map(n=>n.ser))].slice(0,3)
      : [...new Set([...v.read,...v.unread].map(n=>n.a))].slice(0,2);
    return `<div class="shelf${open?" open":""}" data-k="${v.key}">
      <div class="shelf-h"><span class="shelf-n">${v.name}${v.src?`<small>${v.src}</small>`:""}</span>
        ${v.mean?`<span class="shelf-m">${v.mean}★<em>over ${v.n}</em></span>`:`<span class="shelf-u">unrated</span>`}
        <span class="shelf-u${un||v._s.known?"":" thin"}">${
          un ? un+" unread"
             : v._s.known ? "complete"
             : v._s.read+" in library"}</span></div>
      <div class="shelf-body">${v.full?fullBody:body}${
        v.full?(()=>{const miss=vols.filter(x=>!myRatingFor(x.t)).length;
        return `<div class="xrow">${miss?`${miss} of ${vols.length} still unrated — star anything you've read`
                                     :`all ${vols.length} rated`}</div>`;})():""}${cross.length?`<div class="xrow">${
        shelfMode==="author"?"Series:":"By:"} ${cross.map(c=>
        `<button class="xlink" data-jump="${shelfMode==="author"?"series":"author"}" data-k="${
          (shelfMode==="author"?snorm(c):c).replace(/"/g,"&quot;")}">${c}</button>`).join(" · ")}</div>`:""}
      </div></div>`;}).join("");
  shelfRows.querySelectorAll(".shelf-h").forEach(h=>h.onclick=()=>{
    const k=h.parentElement.dataset.k;
    shelfOpen.has(k)?shelfOpen.delete(k):shelfOpen.add(k);
    h.parentElement.classList.toggle("open");
  });
  shelfRows.querySelectorAll(".minirate .ms").forEach(btn=>btn.onclick=e=>{
    e.stopPropagation();
    const title=btn.closest(".minirate").dataset.title, v=starValue(btn,e);
    setRatingByTitle(title, myRatingFor(title)===v?0:v, "rated from series list");
    renderShelves(); renderSync(); update();
    if(selected!==null)renderDetail();
    syncNote(`${title} — ${myRatingFor(title)?myRatingFor(title)+"★":"rating cleared"}`);
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
document.getElementById("shelf-find").addEventListener("input",e=>{
  shelfQuery=e.target.value; renderShelves();
});
{
  const modes=[["sf-all","all"],["sf-started","started"],["sf-open","open"]];
  for(const [id,key] of modes)document.getElementById(id).onclick=()=>{
    shelfStatus=key;
    modes.forEach(([i])=>document.getElementById(i).classList.toggle("on",i===id));
    renderShelves();
  };
}
document.getElementById("sh-auth").onclick=()=>{shelfMode="author";
  document.getElementById("sh-auth").classList.add("on");
  document.getElementById("sh-ser").classList.remove("on");shelfOpen.clear();renderShelves();};
document.getElementById("sh-ser").onclick=()=>{shelfMode="series";
  document.getElementById("sh-ser").classList.add("on");
  document.getElementById("sh-auth").classList.remove("on");shelfOpen.clear();renderShelves();};

/* ---------- needs you ---------- */
/* The queue of holes only a person can fill, generated by scripts/needsinput.py.
   Ordered by how sure we are: StoryGraph saying a book is read with no star is
   a fact, a volume with rated volumes either side of it is a strong inference,
   and a rating with no derivable author is a blocker. Deliberately does not
   include the 391 unread volumes sitting after the last one rated in a series —
   most of those are simply unread, and a queue that can't be finished is a
   queue nobody opens. */
const NEEDS=(window.__DATA__&&window.__DATA__.needs_input)||{};
const NEEDS_SECTIONS=[
  ["read","Read, never rated",
   "StoryGraph has these on your read shelf with no star. Not a guess — the export says so."],
  ["gap","Gaps in series you've read",
   "Unrated, with rated volumes on both sides. Skipping one mid-run is usually an unlogged read."],
  ["blocked","Can't file these without you",
   "Rated, but in no export and with no tagged sibling to borrow an author from. Tell me who wrote them."],
];
const needsRows=document.getElementById("needs-rows");
function needsOutstanding(){
  let n=0;
  for(const [k] of NEEDS_SECTIONS)
    for(const it of (NEEDS[k]||[])) if(!myRatingFor(it.t)) n++;
  return n;
}
function renderNeeds(){
  if(!needsRows)return;
  let h="";
  for(const [key,title,note] of NEEDS_SECTIONS){
    const items=(NEEDS[key]||[]);
    if(!items.length)continue;
    const left=items.filter(it=>!myRatingFor(it.t)).length;
    h+=`<div class="needs-sec"><div class="needs-h"><span>${title}</span>
        <span class="needs-c">${left} of ${items.length} left</span></div>
        <div class="needs-note">${note}</div>`;
    h+=items.map(it=>{
      const cur=myRatingFor(it.t);
      const esc=it.t.replace(/"/g,"&quot;");
      const sub=[it.a,it.ser&&(it.ser+(it.ord?" #"+it.ord:""))].filter(Boolean).join(" · ");
      return `<div class="needs-row${cur?" done":""}">
        <span class="needs-t">${it.t}${sub?`<em>${sub}</em>`:""}</span>
        ${key==="blocked"&&!cur?`<span class="needs-flag">author?</span>`:""}
        <span class="minirate" data-title="${esc}">${[1,2,3,4,5].map(v=>
          `<button class="ms${starClass(cur,v)}" data-v="${v}" aria-label="${v} stars, click left half for ${v-0.5}">★</button>`).join("")}<b class="mr-v">${rateLabel(cur)}</b></span>
      </div>`;}).join("");
    h+=`</div>`;
  }
  needsRows.innerHTML=h||`<p class="mood-none">Nothing outstanding.</p>`;
  needsRows.querySelectorAll(".minirate .ms").forEach(btn=>btn.onclick=e=>{
    e.stopPropagation();
    const title=btn.closest(".minirate").dataset.title, v=starValue(btn,e);
    setRatingByTitle(title, myRatingFor(title)===v?0:v, "rated from the needs-you queue");
    renderNeeds(); renderSync(); update(); syncNeedsBadge();
  });
}
function syncNeedsBadge(){
  const el=document.getElementById("needs-n");
  if(el)el.textContent=needsOutstanding()||"";
}

function setView(v){
  if(splitOn&&v!=="graph")setSplit(false);
  view=v;
  for(const [id,name] of [["v-mood","mood"],["v-graph","graph"],["v-shelf","shelf"],["v-list","list"],["v-needs","needs"]]){
    const b=document.getElementById(id);
    b.classList.toggle("on",v===name);
    b.setAttribute("aria-selected",String(v===name));
  }
  listEl.hidden = v!=="list";
  shelfView.hidden = v!=="shelf";
  moodView.hidden = v!=="mood";
  needsView.hidden = v!=="needs";
  if(v==="needs")renderNeeds();
  if(v==="mood")renderMood();
  if(v==="shelf")renderShelves();
  document.getElementById("hint").style.display = v==="graph"?"":"none";
  if(v==="list")renderList();
  if(v==="graph"){userZoomed=false;reheat(.85);}
  update();
}
/* Split puts the graph over the detail panel — for reading about a book while
   still seeing where it sits. It layers on top of the graph view rather than
   being a fourth view, since the other three are already full-screen lists. */
let splitOn=false;
function setSplit(on){
  splitOn=on;
  document.body.classList.toggle("split",on);
  document.getElementById("v-split").classList.toggle("on",on);
  if(on&&view!=="graph")setView("graph");
  if(on&&selected===null&&nodes.length){
    const best=nodes.filter(n=>n.r===0).sort((x,y)=>(y.praw??y.p)-(x.praw??x.p))[0];
    if(best){selected=best.id;renderDetail();}
  }
  resize();kick();
}
document.getElementById("v-split").onclick=()=>setSplit(!splitOn);
document.getElementById("v-mood").onclick=()=>setView("mood");
document.getElementById("v-graph").onclick=()=>setView("graph");
document.getElementById("v-shelf").onclick=()=>setView("shelf");
document.getElementById("v-list").onclick=()=>setView("list");
document.getElementById("v-needs").onclick=()=>setView("needs");

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
  // offClusters was the one filter "clear all" did not clear, so hiding groups
  // — now one click from the detail panel — survived every route back. Hide
  // enough of them and you sit on "No books match" with two buttons in front of
  // you that both claim to fix it and neither does.
  showRead=showRec=true;offEngines.clear();offClusters.clear();
  const q=document.getElementById("tag-search"); if(q)q.value="";
  syncControls();update();
}
function update(){
  const live=nodes.filter(passes);
  syncLegends();
  const v=document.getElementById("void");
  if(v)v.hidden=live.length>0||view==="list";
  if(view==="list"&&typeof renderList==="function")renderList();
  const tn=document.getElementById("topbar-n");
  if(tn)tn.textContent=nodes.filter(passes).length+" / "+nodes.length;
  document.getElementById("readout").innerHTML=
    `<b>${live.length}</b> of ${nodes.length} in range &nbsp;·&nbsp; <b>${live.filter(n=>n.r===0).length}</b> unread`;
  if(selected===null)renderRanked();
  renderTagFilter();
  saveUI();
  kick();
}
/* Counted rather than written down: the header read "274 books" for as long as it
   took to add fourteen. */
{
  const el=document.getElementById("lede-count");
  if(el)el.textContent=`Taxonomy v1.2 · ${nodes.length} books · StoryGraph-validated`;
}
/* ---------- session ----------
   A refresh used to drop you back on the mood screen with every filter reset,
   which made the browser's own reload button destructive: narrow the library
   down, follow a link, come back, start again.

   The open book is stored by TITLE, not by node id. Ids are indices into
   books.json, so adding a single book silently shifts every one after it and a
   restored id would open the wrong book. Camera is included because "the same
   spot" means the view you had, not just the filters. */
const LS_UI="reading-network:ui";
let uiTimer=null,wantedSplit=false;
const uiState=()=>({
  v:view, split:splitOn, flat, spotlight, cluster, colorBy,
  lim:limits, tags:[...activeTags], oe:[...offEngines], oc:[...offClusters],
  rd:showRead, rc:showRec,
  sel:(selected!==null&&nodes[selected])?nodes[selected].t:null,
  sm:shelfMode, sq:shelfQuery, ss:shelfStatus, so:[...shelfOpen],
  zoom:userZoomed?zoom:null, panX, panY, yaw, pitch,
});
function writeUI(){try{localStorage.setItem(LS_UI,JSON.stringify(uiState()))}catch(e){}}
function saveUI(){
  if(!storageOK||typeof uiState!=="function")return;   // update() runs once before these consts initialise
  clearTimeout(uiTimer);
  uiTimer=setTimeout(writeUI,250);   // update() fires on every slider tick
}
function restoreUI(){
  let s=null;
  try{s=JSON.parse(localStorage.getItem(LS_UI)||"null")}catch(e){}
  if(!s||typeof s!=="object")return false;
  if(s.lim)AXES.forEach(a=>{if(typeof s.lim[a.k]==="number")limits[a.k]=s.lim[a.k];});
  (s.tags||[]).forEach(t=>activeTags.add(t));
  (s.oe||[]).forEach(t=>offEngines.add(t));
  // a group id only means something if that group still exists
  (s.oc||[]).forEach(c=>{if(CLUSTERS.some(x=>x.id===c))offClusters.add(c);});
  if(typeof s.rd==="boolean")showRead=s.rd;
  if(typeof s.rc==="boolean")showRec=s.rc;
  if(typeof s.flat==="boolean")flat=s.flat;
  if(typeof s.spotlight==="boolean")spotlight=s.spotlight;
  if(typeof s.cluster==="boolean")cluster=s.cluster;
  if(s.colorBy)colorBy=s.colorBy;
  if(s.sm)shelfMode=s.sm;
  if(typeof s.sq==="string")shelfQuery=s.sq;
  if(s.ss)shelfStatus=s.ss;
  (s.so||[]).forEach(k=>shelfOpen.add(k));
  if(typeof s.yaw==="number")yaw=yawT=s.yaw;
  if(typeof s.pitch==="number")pitch=pitchT=s.pitch;
  if(typeof s.zoom==="number"){zoom=s.zoom;userZoomed=true;
    if(typeof s.panX==="number")panX=s.panX;
    if(typeof s.panY==="number")panY=s.panY;}
  if(s.sel){const n=nodeForTitle(s.sel);if(n)selected=n.id;}
  wantedSplit=s.split===true;
  return s.v||null;
}
window.addEventListener("resize",resize);
cv.style.cursor="grab";
loadRatings();applyRatings();
const wanted=restoreUI();
resize();update();renderRanked();reheat(1);renderSync();
renderMoodPicks();syncNeedsBadge();
syncControls();
document.getElementById("m-spot")?.classList.toggle("on",spotlight);
document.getElementById("m-flat")?.classList.toggle("on",flat);
document.getElementById("m-depth")?.classList.toggle("on",!flat);
setView(wanted||"mood");
if(selected!==null)renderDetail();
if(wantedSplit)setSplit(true);
// the debounce can still be pending when the tab goes; flush it
addEventListener("beforeunload",()=>{clearTimeout(uiTimer);writeUI();});
addEventListener("pagehide",()=>{clearTimeout(uiTimer);writeUI();});
