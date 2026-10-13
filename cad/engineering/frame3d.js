// Pórtico espacial elástico: Euler-Bernoulli, 6 GDL/nodo, SI (N, m, Pa).
// Rigidez directa, condensación de liberaciones, RCM y LDLᵀ en skyline.
// Referencia de formulación: TU Delft, Computational Modelling, Euler-Bernoulli beam
// https://interactivetextbooks.citg.tudelft.nl/computational-modelling/structural_linear/euler_bernouilli.html
// Las articulaciones y uniones rígidas son entradas, nunca resistencias acreditadas.

const DOFS = ["traslación X", "traslación Y", "traslación Z", "giro X", "giro Y", "giro Z"];
const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
const sub = (a, b) => a.map((v, i) => v - b[i]);
const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const unit = (v) => { const l = Math.hypot(...v); return v.map((x) => x / l); };
const zeros = (n) => Array.from({ length: n }, () => new Float64Array(n));
const mv = (a, x) => a.map((r) => dot(r, x));

/** Error localizado: no se agregan resortes ficticios para ocultar mecanismos. */
export class FrameError extends Error {
  constructor(message, details = {}) { super(message); this.name = "FrameError"; this.details = details; }
}

/** Base ortonormal derecha. local z sigue la altura del perfil; local y es su ancho. */
export function barAxes(a_m, b_m, yAxis = null) {
  const x = unit(sub(b_m, a_m));
  let y;
  if (yAxis) { y = sub(yAxis, x.map((v) => v * dot(x, yAxis))); }
  else {
    const zReference = Math.abs(x[2]) < .99 ? [0, 0, 1] : [0, 1, 0];
    y = cross(zReference, x);
  }
  if (!Number.isFinite(x[0]) || Math.hypot(...y) < 1e-10) throw new FrameError("Barra sin longitud o eje de sección paralelo a su eje longitudinal.");
  y = unit(y);
  return [x, y, cross(x, y)];
}

/** Matriz local 12×12: ux,uy,uz,rx,ry,rz en A y B; propiedades en m²/m⁴/Pa. */
export function beamStiffness({ E_Pa, G_Pa, section, L_m, tensionOnly = false }) {
  const { A_m2, Iy_m4, Iz_m4, J_m4 } = section;
  if (![E_Pa, G_Pa, A_m2, L_m, ...(tensionOnly ? [] : [Iy_m4, Iz_m4, J_m4])].every((v) => Number.isFinite(v) && v > 0)) throw new FrameError("Propiedades de barra inválidas; no se pudo armar la rigidez.");
  const k = zeros(12);
  const pair = (i, j, v) => { k[i][i] += v; k[j][j] += v; k[i][j] -= v; k[j][i] -= v; };
  pair(0, 6, E_Pa * A_m2 / L_m);
  if (tensionOnly) return k;
  pair(3, 9, G_Pa * J_m4 / L_m);
  const bend = (indices, EI, sign) => {
    const a = 12*EI/L_m**3, b = sign*6*EI/L_m**2, c = 4*EI/L_m, d = 2*EI/L_m;
    const block = [[a,b,-a,b],[b,c,-b,d],[-a,-b,a,-b],[b,d,-b,c]];
    indices.forEach((r, i) => indices.forEach((s, j) => { k[r][s] += block[i][j]; }));
  };
  bend([1,5,7,11], E_Pa * Iz_m4, 1);
  bend([2,4,8,10], E_Pa * Iy_m4, -1);
  return k;
}

// Inversa pequeña sólo para GDL liberados. No se invierte la matriz global.
function invertSmall(a) {
  // Pseudoinversa espectral: liberar la torsión en ambos extremos deja un
  // giro rígido interno. Se elimina ese modo sin agregar una rigidez ficticia.
  const n=a.length,b=a.map(r=>[...r]),v=zeros(n);for(let i=0;i<n;i++)v[i][i]=1;
  const magnitude=Math.max(1,...a.flat().map(Math.abs));
  for(let iteration=0;iteration<60*n*n;iteration++) {
    let p=0,q=0,largest=0;
    for(let i=0;i<n;i++)for(let j=i+1;j<n;j++)if(Math.abs(b[i][j])>largest){largest=Math.abs(b[i][j]);p=i;q=j;}
    if(largest<magnitude*1e-14)break;
    const angle=.5*Math.atan2(2*b[p][q],b[q][q]-b[p][p]),c=Math.cos(angle),s=Math.sin(angle);
    const pp=b[p][p],qq=b[q][q],pq=b[p][q];
    b[p][p]=c*c*pp-2*s*c*pq+s*s*qq;b[q][q]=s*s*pp+2*s*c*pq+c*c*qq;b[p][q]=b[q][p]=0;
    for(let i=0;i<n;i++)if(i!==p&&i!==q){const ip=b[i][p],iq=b[i][q];b[i][p]=b[p][i]=c*ip-s*iq;b[i][q]=b[q][i]=s*ip+c*iq;}
    for(let i=0;i<n;i++){const ip=v[i][p],iq=v[i][q];v[i][p]=c*ip-s*iq;v[i][q]=s*ip+c*iq;}
  }
  const inverse=zeros(n);
  for(let r=0;r<n;r++) {
    if(b[r][r]<-magnitude*1e-12)throw new FrameError("Rigidez negativa en una liberación de barra.");
    if(b[r][r]>magnitude*1e-12)for(let i=0;i<n;i++)for(let j=0;j<n;j++)inverse[i][j]+=v[i][r]*v[j][r]/b[r][r];
  }
  return inverse;
}

function makeElement(bar, nodes) {
  const a = nodes.get(bar.a), b = nodes.get(bar.b);
  if (!a || !b || a.id === b.id) throw new FrameError(`Barra ${bar.id}: nodos ausentes o coincidentes.`, {barId:bar.id});
  const L_m = Math.hypot(...sub(b.point_m, a.point_m));
  const axes = barAxes(a.point_m, b.point_m, bar.yAxis);
  const original = beamStiffness({ ...bar, L_m });
  const transform = zeros(12);
  for (let block = 0; block < 4; block++) for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) transform[block*3+i][block*3+j] = axes[i][j];
  const released = bar.tensionOnly ? [] : ["a", "b"].flatMap((end, index) => (bar.releases?.[end] ?? []).flatMap((v, i) => v ? [index*6+i] : []));
  const kept = Array.from({length:12}, (_, i) => i).filter((i) => !released.includes(i));
  const inverse = released.length ? invertSmall(released.map((i) => released.map((j) => original[i][j]))) : [];
  const condensed = original.map((r) => Float64Array.from(r));
  if (released.length) {
    for (const i of kept) for (const j of kept) condensed[i][j] -= released.reduce((s,r,ri) => s + original[i][r] * released.reduce((t,q,qi) => t + inverse[ri][qi]*original[q][j], 0), 0);
    for (const i of released) for (let j = 0; j < 12; j++) condensed[i][j] = condensed[j][i] = 0;
  }
  const temp = zeros(12), global = zeros(12);
  for (let i=0;i<12;i++) for(let j=0;j<12;j++) for(let h=0;h<12;h++) temp[i][j] += condensed[i][h]*transform[h][j];
  for (let i=0;i<12;i++) for(let j=0;j<12;j++) for(let h=0;h<12;h++) global[i][j] += transform[h][i]*temp[h][j];
  return { bar, a, b, axes, L_m, original, condensed, global, transform, released, kept, inverse };
}

/** Carga consistente de q lineal (N/m) global, convertida a ejes locales. */
function uniformLoad(el, wa, wb) {
  const a = mv(el.axes, wa), b = mv(el.axes, wb), L = el.L_m, f = new Float64Array(12);
  f[0]=L*(2*a[0]+b[0])/6; f[6]=L*(a[0]+2*b[0])/6;
  for (const [d,r,s] of [[1,5,1],[2,4,-1]]) {
    f[d]=L*(7*a[d]+3*b[d])/20; f[d+6]=L*(3*a[d]+7*b[d])/20;
    f[r]=s*L**2*(3*a[d]+2*b[d])/60; f[r+6]=-s*L**2*(2*a[d]+3*b[d])/60;
  }
  return { f, wa:a, wb:b };
}

/** Fuerza y par puntuales consistentes por funciones de Hermite; t en [0,1]. */
function pointLoad(el, load) {
  const t = load.t;
  if (!Number.isFinite(t) || t < -1e-9 || t > 1+1e-9) throw new FrameError(`Carga fuera de barra ${el.bar.id}.`);
  const L = el.L_m, F = mv(el.axes, load.force_N ?? [0,0,0]), M = mv(el.axes, load.moment_Nm ?? [0,0,0]);
  const h = [1-3*t*t+2*t**3, L*(t-2*t*t+t**3), 3*t*t-2*t**3, L*(-t*t+t**3)];
  const dh = [(-6*t+6*t*t)/L, 1-4*t+3*t*t, (6*t-6*t*t)/L, -2*t+3*t*t];
  const f = new Float64Array(12);
  f[0]=(1-t)*F[0]; f[6]=t*F[0]; f[3]=(1-t)*M[0]; f[9]=t*M[0];
  for (const [d,r,s] of [[1,5,1],[2,4,-1]]) {
    f[d]=h[0]*F[d]+s*dh[0]*M[r-3]; f[r]=s*h[1]*F[d]+dh[1]*M[r-3];
    f[d+6]=h[2]*F[d]+s*dh[2]*M[r-3]; f[r+6]=s*h[3]*F[d]+dh[3]*M[r-3];
  }
  return { f, t, force_N:F, moment_Nm:M };
}

function condenseLoad(el, f) {
  const out = Float64Array.from(f);
  for (const i of el.kept) out[i] -= el.released.reduce((s,r,ri) => s + el.original[i][r] * el.released.reduce((v,q,qi) => v + el.inverse[ri][qi]*f[q], 0), 0);
  for (const i of el.released) out[i] = 0;
  return out;
}

/** Reverse Cuthill-McKee determinista; admite componentes desconectadas. */
export function reverseCuthillMcKee(adjacency) {
  const visited = new Set(), order = [];
  const compare = (a,b) => adjacency[a].size-adjacency[b].size || a-b;
  while (visited.size < adjacency.length) {
    const start = Array.from({length:adjacency.length}, (_,i)=>i).filter((i)=>!visited.has(i)).sort(compare)[0];
    const queue=[start]; visited.add(start);
    for(let head=0;head<queue.length;head++) {
      const i=queue[head]; order.push(i);
      [...adjacency[i]].filter((j)=>!visited.has(j)).sort(compare).forEach((j)=>{ if(!visited.has(j)){visited.add(j);queue.push(j);} });
    }
  }
  return order.reverse();
}

function buildKernel(model, inactive = new Set()) {
  const nodes=new Map(model.nodes.map((n)=>[n.id,n]));
  if (nodes.size !== model.nodes.length || !nodes.size) throw new FrameError("El modelo no tiene nodos o contiene IDs duplicados.");
  if(model.nodes.some(n=>n.point_m?.length!==3||!n.point_m.every(Number.isFinite)))throw new FrameError("Coordenadas de nodo inválidas.");
  const index=new Map(model.nodes.map((n,i)=>[n.id,i]));
  const elements=model.bars.filter((b)=>!inactive.has(b.id)).map((bar)=>makeElement(bar,nodes));
  if (new Set(model.bars.map(b=>b.id)).size !== model.bars.length) throw new FrameError("El modelo tiene IDs de barra duplicados.");
  const size=nodes.size*6, parent=Array.from({length:size},(_,i)=>i);
  const find=(i)=> { while(parent[i]!==i){parent[i]=parent[parent[i]];i=parent[i];} return i; };
  const join=(i,j)=>{ const a=find(i),b=find(j); parent[Math.max(a,b)]=Math.min(a,b); };
  for(const tie of model.ties??[]) {
    if (!index.has(tie.a)||!index.has(tie.b)) throw new FrameError("Vínculo entre nodos desconocidos.");
    for(const d of tie.dofs??[0,1,2]) join(index.get(tie.a)*6+d,index.get(tie.b)*6+d);
  }
  const groups=parent.map((_,i)=>find(i)), restraints=new Map(), diagonal=new Map();
  model.nodes.forEach((n,i)=>(n.restraints??[]).forEach((v,d)=>{if(v&&!restraints.has(groups[i*6+d]))restraints.set(groups[i*6+d],i*6+d);}));
  for(const el of elements) {
    el.dofs=[index.get(el.a.id),index.get(el.b.id)].flatMap((i)=>Array.from({length:6},(_,d)=>i*6+d));
    for(let i=0;i<12;i++) for(let j=0;j<12;j++) if(groups[el.dofs[i]]===groups[el.dofs[j]]) diagonal.set(groups[el.dofs[i]],(diagonal.get(groups[el.dofs[i]])??0)+el.global[i][j]);
  }
  const free=[...new Set(groups)].filter((g)=>!restraints.has(g)&&(diagonal.get(g)??0)>1e-15);
  const freeIndex=new Map(free.map((g,i)=>[g,i])), adjacency=free.map(()=>new Set());
  for(const el of elements) {
    const local=[...new Set(el.dofs.map(d=>freeIndex.get(groups[d])).filter(d=>d!==undefined))];
    for(const i of local) for(const j of local) if(i!==j) adjacency[i].add(j);
  }
  const order=reverseCuthillMcKee(adjacency), eq=new Map(order.map((i,j)=>[free[i],j]));
  const first=order.map((_,i)=>i);
  for(const el of elements) for(const a of el.dofs) for(const b of el.dofs) {
    const i=eq.get(groups[a]),j=eq.get(groups[b]);
    if(i!==undefined&&j!==undefined&&i>=j)first[i]=Math.min(first[i],j);
  }
  const skyline=first.map((f,i)=>new Float64Array(i-f+1));
  const scale=order.map((i)=>Math.sqrt(diagonal.get(free[i])));
  for(const el of elements) for(let a=0;a<12;a++) for(let b=0;b<12;b++) {
    const i=eq.get(groups[el.dofs[a]]),j=eq.get(groups[el.dofs[b]]);
    if(i!==undefined&&j!==undefined&&i>=j) skyline[i][j-first[i]]+=el.global[a][b]/(scale[i]*scale[j]);
  }
  const at=(i,j)=>j<first[i]?0:skyline[i][j-first[i]];
  const D=new Float64Array(order.length);
  for(let i=0;i<order.length;i++) {
    for(let j=first[i];j<i;j++) {
      let s=at(i,j);
      for(let k=Math.max(first[i],first[j]);k<j;k++)s-=at(i,k)*D[k]*at(j,k);
      skyline[i][j-first[i]]=s/D[j];
    }
    let pivot=at(i,i);for(let j=first[i];j<i;j++)pivot-=at(i,j)**2*D[j];
    if(!Number.isFinite(pivot)||pivot<=1e-11) {
      const g=free[order[i]], node=model.nodes[Math.floor(g/6)], dof=g%6;
      throw new FrameError(`Modelo inestable en ${node.label??node.id}: ${DOFS[dof]}. Revisá apoyos, continuidad y arriostramientos.`,{nodeId:node.id,dof,pivot});
    }
    D[i]=pivot;
  }
  return {model,nodes,index,elements,groups,eq,restraints,scale,first,skyline,D,inactive};
}

function solveKernel(k, loadCase) {
  const nodal=new Float64Array(k.model.nodes.length*6), grouped=new Map(), localLoads=new Map();
  const resultants={force_N:[0,0,0],moment_Nm:[0,0,0]};
  const addResultant=(p,F,M=[0,0,0])=>{const c=cross(p,F);for(let i=0;i<3;i++){resultants.force_N[i]+=F[i];resultants.moment_Nm[i]+=c[i]+M[i];}};
  for(const n of loadCase.nodal??[]) {
    const i=k.index.get(n.nodeId);
    if(i===undefined)throw new FrameError(`Carga en nodo desconocido ${n.nodeId}.`);
    const f=[...(n.force_N??[0,0,0]),...(n.moment_Nm??[0,0,0])];
    if(!f.every(Number.isFinite))throw new FrameError("Carga nodal no finita.");
    f.forEach((v,d)=>{nodal[i*6+d]+=v;});addResultant(k.model.nodes[i].point_m,f.slice(0,3),f.slice(3));
  }
  const elementMap=new Map(k.elements.map(el=>[el.bar.id,el]));
  for(const load of [...(loadCase.distributed??[]),...(loadCase.pointLoads??[])]) if(!elementMap.has(load.barId))throw new FrameError(`Carga sobre barra ausente o tensor inactivo: ${load.barId}.`);
  for(const el of k.elements) {
    const f=new Float64Array(12), wa=[0,0,0],wb=[0,0,0],points=[];
    for(const q of (loadCase.distributed??[]).filter(q=>q.barId===el.bar.id)) {
      const u=uniformLoad(el,q.wa_N_m??q.w_N_m,q.wb_N_m??q.wa_N_m??q.w_N_m);
      if(!u.f.every(Number.isFinite))throw new FrameError("Carga distribuida no finita.");
      u.f.forEach((v,i)=>{f[i]+=v;});for(let i=0;i<3;i++){wa[i]+=u.wa[i];wb[i]+=u.wb[i];}
      const ag=mvTranspose3(el.axes,u.wa),bg=mvTranspose3(el.axes,u.wb),L=el.L_m;
      addResultant(el.a.point_m,ag.map((v,i)=>L*(v+bg[i])/2),cross(sub(el.b.point_m,el.a.point_m),ag.map((v,i)=>L*(v+2*bg[i])/6)));
    }
    for(const p of (loadCase.pointLoads??[]).filter(p=>p.barId===el.bar.id)) {
      const v=pointLoad(el,p);if(!v.f.every(Number.isFinite))throw new FrameError("Carga puntual no finita.");v.f.forEach((n,i)=>{f[i]+=n;});points.push(v);
      addResultant(el.a.point_m.map((a,i)=>a+p.t*(el.b.point_m[i]-a)),p.force_N??[0,0,0],p.moment_Nm??[0,0,0]);
    }
    if(el.bar.tensionOnly&&(Math.hypot(wa[1],wa[2],wb[1],wb[2])>0||points.some(p=>Math.hypot(...p.force_N.slice(1),...p.moment_Nm)>0)))throw new FrameError("Un tensor sólo admite acciones axiales.");
    localLoads.set(el.bar.id,{f,wa,wb,points});
    const global=transposeMultiply(el.transform,condenseLoad(el,f));
    global.forEach((v,i)=>{nodal[el.dofs[i]]+=v;});
  }
  nodal.forEach((v,i)=>grouped.set(k.groups[i],(grouped.get(k.groups[i])??0)+v));
  for(const [g,F] of grouped) if(!k.eq.has(g)&&!k.restraints.has(g)&&Math.abs(F)>1e-7)throw new FrameError(`Carga en un grado de libertad sin rigidez: ${DOFS[g%6]}.`,{nodeId:k.model.nodes[Math.floor(g/6)].id,dof:g%6});
  const u=new Float64Array(k.D.length);
  for(const [g,i] of k.eq)u[i]=(grouped.get(g)??0)/k.scale[i];
  for(let i=0;i<u.length;i++)for(let j=k.first[i];j<i;j++)u[i]-=k.skyline[i][j-k.first[i]]*u[j];
  for(let i=0;i<u.length;i++)u[i]/=k.D[i];
  for(let i=u.length-1;i>=0;i--)for(let j=k.first[i];j<i;j++)u[j]-=k.skyline[i][j-k.first[i]]*u[i];
  const displacement=Array.from(nodal,(_,i)=>{const q=k.eq.get(k.groups[i]);return q===undefined?0:u[q]/k.scale[q];});
  const internal=new Float64Array(nodal.length),bars=[];
  for(const el of k.elements) {
    const load=localLoads.get(el.bar.id),d=mv(el.transform,el.dofs.map(i=>displacement[i]));
    if(el.released.length) {
      const rhs=el.released.map(r=>load.f[r]-el.kept.reduce((s,j)=>s+el.original[r][j]*d[j],0));
      const values=mv(el.inverse,rhs);el.released.forEach((r,i)=>{d[r]=values[i];});
      const error=el.released.map((r,i)=>el.released.reduce((s,q,j)=>s+el.original[r][q]*values[j],0)-rhs[i]);
      if(Math.hypot(...error)>1e-6*Math.max(1,Math.hypot(...rhs)))throw new FrameError(`Barra ${el.bar.id}: carga incompatible con sus liberaciones.`,{barId:el.bar.id});
    }
    const forces=mv(el.original,d).map((v,i)=>v-load.f[i]);
    // forces ya descuenta las acciones de barra. Para K·u−F global se repone
    // su carga consistente; de otro modo q se descontaría dos veces.
    const consistent=condenseLoad(el,load.f);
    const global=transposeMultiply(el.transform,forces.map((v,i)=>v+consistent[i]));
    global.forEach((v,i)=>{internal[el.dofs[i]]+=v;});
    bars.push({barId:el.bar.id,endForces_local:[...forces],endDisplacements_local:[...d],wa_local_N_m:load.wa,wb_local_N_m:load.wb,points:load.points.map(({t,force_N,moment_Nm})=>({t,force_N,moment_Nm}))});
  }
  const residual=new Map();internal.forEach((v,i)=>residual.set(k.groups[i],(residual.get(k.groups[i])??0)+v-nodal[i]));
  let residualError=0;
  for(const g of k.eq.keys())residualError=Math.max(residualError,Math.abs(residual.get(g)??0));
  const reactions=k.model.nodes.map((n,i)=>({nodeId:n.id,point_m:n.point_m,force_N:[0,0,0],moment_Nm:[0,0,0]}));
  for(const [g,d] of k.restraints){const n=Math.floor(d/6),i=d%6; (i<3?reactions[n].force_N:reactions[n].moment_Nm)[i%3]=residual.get(g)??0;}
  const supports=reactions.filter((_,i)=>k.model.nodes[i].restraints?.some(Boolean));
  const equilibrium=checkFrameEquilibrium(resultants,supports);
  if(!Number.isFinite(equilibrium.relativeError)||equilibrium.relativeError>1e-6||residualError/Math.max(1,...[...nodal].map(Math.abs))>1e-6)throw new FrameError("Error interno: el análisis no cierra equilibrio; resultados descartados.",{equilibrium,residualError});
  return {id:loadCase.id,displacements:displacement,bars,reactions:supports,applied:resultants,equilibrium,inactiveBars:[...k.inactive]};
}

function transposeMultiply(a,x){return Array.from({length:a[0].length},(_,i)=>x.reduce((s,v,j)=>s+a[j][i]*v,0));}
function mvTranspose3(a,x){return [0,1,2].map(i=>x.reduce((s,v,j)=>s+a[j][i]*v,0));}

/** Equilibrio de fuerzas Y momentos respecto del origen; tolerancia relativa de 10⁻⁶. */
export function checkFrameEquilibrium(applied,reactions) {
  const f=[...applied.force_N],m=[...applied.moment_Nm];let fScale=Math.max(1,Math.hypot(...f)),mScale=Math.max(1,Math.hypot(...m));
  for(const r of reactions){const c=cross(r.point_m,r.force_N);for(let i=0;i<3;i++){f[i]+=r.force_N[i];m[i]+=c[i]+r.moment_Nm[i];}fScale+=Math.hypot(...r.force_N);mScale+=Math.hypot(...c)+Math.hypot(...r.moment_Nm);}
  return {forceResidual_N:f,momentResidual_Nm:m,relativeError:Math.max(Math.hypot(...f)/fScale,Math.hypot(...m)/mScale)};
}

/** Prepara una única factorización para muchos casos lineales. Los tensores usan conjunto activo. */
export function createFrameSolver(model) {
  const hasTensors=model.bars.some(b=>b.tensionOnly), initial=buildKernel(model);
  return {storage:{kind:"skyline LDLᵀ + RCM",equations:initial.D.length,entries:initial.skyline.reduce((s,r)=>s+r.length,0)},solve(loadCase){
    if(!hasTensors)return solveKernel(initial,loadCase);
    let inactive=new Set();
    for(let iteration=0;iteration<10;iteration++) {
      const k=inactive.size?buildKernel(model,inactive):initial,result=solveKernel(k,loadCase),next=new Set(inactive);
      for(const bar of model.bars.filter(b=>b.tensionOnly)) {
        const a=k.index.get(bar.a),b=k.index.get(bar.b),axis=barAxes(k.model.nodes[a].point_m,k.model.nodes[b].point_m)[0];
        const extension=dot(axis,[0,1,2].map(d=>result.displacements[b*6+d]-result.displacements[a*6+d]));
        if(extension < -1e-10)next.add(bar.id);else if(extension > 1e-10)next.delete(bar.id);
      }
      if([...next].sort().join() === [...inactive].sort().join()){result.iterations=iteration+1;return result;}
      inactive=next;
    }
    throw new FrameError("Los tensores no convergieron en 10 pasadas; revisá el sistema lateral.");
  }};
}

/** Resuelve un caso independiente. Restricciones y liberaciones: booleanos en orden ux,uy,uz,rx,ry,rz. */
export function solveFrame3D(model,loadCase) { return createFrameSolver(model).solve(loadCase); }

/** Diagramas exactos con q lineal y cargas puntuales; agrega ambos lados de discontinuidades. */
export function sampleBarDiagram(bar,a_m,b_m,response,pointCount=11) {
  const L=Math.hypot(...sub(b_m,a_m)),{E_Pa,G_Pa,section}=bar,f=response.endForces_local,d=response.endDisplacements_local;
  const w=response.wa_local_N_m??[0,0,0], wb=response.wb_local_N_m??w, slope=w.map((v,i)=>(wb[i]-v)/L);
  const points=response.points??[];
  const base=Array.isArray(pointCount)?pointCount:Array.from({length:pointCount},(_,i)=>L*i/(pointCount-1));
  const positions=[...new Set([...base,...points.flatMap(p=>[Math.max(0,p.t*L-1e-8),p.t*L])])].sort((a,b)=>a-b);
  return positions.map(x=>{
    const q=w.map((v,i)=>v*x+slope[i]*x*x/2),qm=w.map((v,i)=>v*x*x/2+slope[i]*x**3/6);
    const force=[-f[0]-q[0],-f[1]-q[1],-f[2]-q[2],-f[3],-f[4]-f[2]*x-qm[2],-f[5]+f[1]*x+qm[1]];
    let uy=d[1]+d[5]*x+(-f[5]*x*x/2+f[1]*x**3/6+w[1]*x**4/24+slope[1]*x**5/120)/(E_Pa*section.Iz_m4);
    let uz=d[2]-d[4]*x+(f[4]*x*x/2+f[2]*x**3/6+w[2]*x**4/24+slope[2]*x**5/120)/(E_Pa*section.Iy_m4);
    for(const p of points)if(x>=p.t*L){const s=x-p.t*L;for(let i=0;i<3;i++)force[i]-=p.force_N[i];force[3]-=p.moment_Nm[0];force[4]-=p.force_N[2]*s+p.moment_Nm[1];force[5]+=p.force_N[1]*s-p.moment_Nm[2];uy+=(p.force_N[1]*s**3/6-p.moment_Nm[2]*s*s/2)/(E_Pa*section.Iz_m4);uz+=(p.force_N[2]*s**3/6+p.moment_Nm[1]*s*s/2)/(E_Pa*section.Iy_m4);}
    return {x_m:x,forces_local:force,uy_m:bar.tensionOnly?0:uy,uz_m:bar.tensionOnly?0:uz};
  });
}
