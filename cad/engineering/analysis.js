import { createAnalyticalModel } from "./analytical-model.js";
import { computeTributaryLoads, mappedLoadResultant } from "./tributary.js";
import { createFrameSolver, sampleBarDiagram, checkFrameEquilibrium, FrameError } from "./frame3d.js";

const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const vecSum=(rows,selector,n)=>Array.from({length:n},(_,i)=>rows.reduce((s,{r,f})=>s+f*selector(r)[i],0));
const extrema=()=>({min:Infinity,max:-Infinity,minCombination:null,maxCombination:null,minAt_m:null,maxAt_m:null});
const update=(row,value,id,at=null)=>{if(value<row.min){row.min=value;row.minCombination=id;row.minAt_m=at;}if(value>row.max){row.max=value;row.maxCombination=id;row.maxAt_m=at;}};

/** Recupera cualquier combinación a partir de casos lineales, sin refactorizar K. */
export function responseForCombination(analysis,combination,includeBars=true) {
  if(analysis.status!=="calculated")return null;
  const map=new Map(analysis.caseResponses.map(r=>[r.id,r]));
  const rows=Object.entries(combination.factors).filter(([,f])=>f).map(([id,f])=>({r:map.get(id),f}));
  if(!rows.length)rows.push({r:analysis.caseResponses[0],f:0});
  if(rows.some(row=>!row.r))throw new FrameError("Combinación con un caso sin analizar.");
  return combine(rows,combination.id,includeBars);
}

function combine(rows,id,includeBars=false) {
  const first=rows[0].r;
  const displacements=vecSum(rows,r=>r.displacements,first.displacements.length);
  const reactions=first.reactions.map((r,i)=>({...r,force_N:vecSum(rows,r=>r.reactions[i].force_N,3),moment_Nm:vecSum(rows,r=>r.reactions[i].moment_Nm,3)}));
  const applied={force_N:vecSum(rows,r=>r.applied.force_N,3),moment_Nm:vecSum(rows,r=>r.applied.moment_Nm,3)};
  const groundReaction={force_N:vecSum(rows,r=>r.groundReaction.force_N,3),moment_Nm:vecSum(rows,r=>r.groundReaction.moment_Nm,3)};
  const bars=includeBars?first.bars.map((bar,i)=>{
    const points=new Map();
    for(const {r,f} of rows)for(const p of r.bars[i].points){const key=Math.round(p.t*1e9);if(!points.has(key))points.set(key,{t:p.t,force_N:[0,0,0],moment_Nm:[0,0,0]});const a=points.get(key);for(let j=0;j<3;j++){a.force_N[j]+=f*p.force_N[j];a.moment_Nm[j]+=f*p.moment_Nm[j];}}
    return {barId:bar.barId,endForces_local:vecSum(rows,r=>r.bars[i].endForces_local,12),endDisplacements_local:vecSum(rows,r=>r.bars[i].endDisplacements_local,12),wa_local_N_m:vecSum(rows,r=>r.bars[i].wa_local_N_m,3),wb_local_N_m:vecSum(rows,r=>r.bars[i].wb_local_N_m,3),points:[...points.values()].sort((a,b)=>a.t-b.t)};
  }):[];
  return {id,displacements,reactions,applied,groundReaction,bars,equilibrium:checkFrameEquilibrium(applied,reactions)};
}

/**
 * Análisis del pórtico y envolventes: cada caso se resuelve UNA vez con skyline.
 * Las combinaciones se superponen sólo para el modelo lineal sin tensores.
 * Se controlan transferencia y equilibrio de fuerza/momento antes de publicar cifras.
 */
export function analyzeGeneration(project,gen,e,cases,combinations,wind) {
  const model=createAnalyticalModel(project,gen,e),tributary=computeTributaryLoads(project,gen,e,model,cases,wind);
  const result={status:"unsupported",model,tributary,caseResponses:[],combinationChecks:[],reactionEnvelopes:[],barEnvelopes:[],nodeEnvelopes:[],drifts:[],equilibriumMax:null,
    assumptions:[...model.assumptions,...tributary.assumptions],issues:[...model.issues,...tributary.issues],
    scope:"Primer orden, elasticidad lineal, secundarias por reacciones estáticas. Cumplir equilibrio no acredita resistencia, rigidez de uniones ni estabilidad de fundaciones.",
    notVerified:["Resistencia y flechas de secundarias, dinteles/jambas, fijaciones de cenefas y arriostramientos reales: fase 3 y uniones en fase 4.","Segundo orden P-Δ/P-δ y reducciones de rigidez/inestabilidad normativa: no implementados; desplazamientos grandes exigen revisión y no habilitan dimensionado.","Diafragmas y reparto sísmico por rigideces no acreditados; acciones por nivel repartidas con pares conservados."]};
  if(combinations.length>10000)result.issues.push("Más de 10000 combinaciones: este análisis preliminar excede el límite implementado.");
  for(const c of tributary.cases) {
    const applied=mappedLoadResultant(model,c),expected=c.sourceResultant;
    const force=Math.hypot(...applied.force_N.map((v,i)=>v-expected.force_N[i]))/Math.max(1,Math.hypot(...expected.force_N));
    const moment=Math.hypot(...applied.moment_Nm.map((v,i)=>v-expected.moment_Nm[i]))/Math.max(1,Math.hypot(...expected.moment_Nm));
    if(Math.max(force,moment)>1e-6&&!result.issues.length)result.issues.push(`Caso ${c.id}: la transferencia de cargas no conserva fuerzas/momentos; resultados sin resolver.`);
  }
  if(result.issues.length)return result;
  try {
    const solver=createFrameSolver(model);result.storage=solver.storage;
    for(const c of tributary.cases) {
      const r=solver.solve(c),ground=mappedLoadResultant({nodes:[],bars:[]},{groundEntries:c.groundEntries});
      r.groundReaction={force_N:ground.force_N.map(v=>-v),moment_Nm:ground.moment_Nm.map(v=>-v)};
      result.caseResponses.push(r);
    }
    result.status="calculated";
    const nodes=new Map(model.nodes.map(n=>[n.id,n]));
    const references=new Map(result.caseResponses.map(r=>[r.id,r]));
    result.reactionEnvelopes=result.caseResponses[0].reactions.map(r=>({nodeId:r.nodeId,point_m:r.point_m,components:Array.from({length:6},extrema)}));
    result.nodeEnvelopes=model.nodes.map(n=>({nodeId:n.id,translations:Array.from({length:3},extrema)}));
    result.barEnvelopes=model.bars.map(b=>({barId:b.id,memberKey:b.key,level:b.level,role:b.role,components:Array.from({length:6},extrema),uy_m:extrema(),uz_m:extrema()}));
    // Muestreo de 11 puntos más ambos lados de cada salto. Las posiciones son
    // comunes a todos los casos para superponer diagramas sin perder discontinuidades.
    const grids=model.bars.map((b,i)=>{
      const L=Math.hypot(...nodes.get(b.b).point_m.map((v,j)=>v-nodes.get(b.a).point_m[j]));
      const points=result.caseResponses.flatMap(r=>r.bars[i].points.flatMap(p=>[Math.max(0,p.t*L-1e-8),p.t*L]));
      return [...new Set([...Array.from({length:11},(_,j)=>L*j/10),...points])].sort((a,b)=>a-b);
    });
    const diagrams=new Map(result.caseResponses.map(r=>[r.id,model.bars.map((b,i)=>sampleBarDiagram(b,nodes.get(b.a).point_m,nodes.get(b.b).point_m,r.bars[i],grids[i]))]));
    const driftPairs=gen.levels.map((lv,level)=>({level,height_m:lv.zTop-lv.elev,pairs:model.nodes.filter(n=>n.level===level&&Math.abs(n.point_m[2]-lv.zTop)<.015).map(top=>({top:model.nodes.indexOf(top),bottom:model.nodes.findIndex(n=>n.level===level&&Math.abs(n.point_m[2]-lv.elev)<.015&&Math.hypot(n.point_m[0]-top.point_m[0],n.point_m[1]-top.point_m[1])<.015)})).filter(p=>p.bottom>=0)}));
    result.drifts=driftPairs.map(l=>({level:l.level,height_m:l.height_m,limit_m:l.height_m/e.limits.drift,max_m:0,combination:null,status:"review"}));
    let maxError=0;
    for(const c of combinations) {
      const rows=Object.entries(c.factors).filter(([,f])=>f).map(([id,f])=>({r:references.get(id),f}));
      if(!rows.length)rows.push({r:result.caseResponses[0],f:0});
      if(rows.some(v=>!v.r))throw new FrameError(`Combinación ${c.id}: falta analizar un caso.`);
      const r=combine(rows,c.id);
      if(r.equilibrium.relativeError>1e-6)throw new FrameError(`Combinación ${c.id}: no cierra equilibrio.`);
      // Piso sobre suelo: se informa separado de reacciones del pórtico.
      const closure=checkFrameEquilibrium({force_N:c.force_N.map((v,i)=>v+r.groundReaction.force_N[i]),moment_Nm:c.moment_Nm.map((v,i)=>v+r.groundReaction.moment_Nm[i])},r.reactions);
      if(closure.relativeError>1e-6)throw new FrameError(`Combinación ${c.id}: no cierra la bajada hasta el suelo.`);
      maxError=Math.max(maxError,r.equilibrium.relativeError,closure.relativeError);
      result.combinationChecks.push({id:c.id,state:c.state,relativeError:Math.max(r.equilibrium.relativeError,closure.relativeError)});
      r.reactions.forEach((reaction,i)=>[...reaction.force_N,...reaction.moment_Nm].forEach((value,d)=>update(result.reactionEnvelopes[i].components[d],value,c.id)));
      model.nodes.forEach((_,i)=>{for(let d=0;d<3;d++)update(result.nodeEnvelopes[i].translations[d],r.displacements[i*6+d],c.id);});
      if(c.state==="ELS")driftPairs.forEach((level,li)=>{
        const drift=Math.max(0,...level.pairs.map(p=>Math.hypot(r.displacements[p.top*6]-r.displacements[p.bottom*6],r.displacements[p.top*6+1]-r.displacements[p.bottom*6+1])));
        if(drift>result.drifts[li].max_m){result.drifts[li].max_m=drift;result.drifts[li].combination=c.id;}
      });
      const sampled=rows.map(({r,f})=>({d:diagrams.get(r.id),f}));
      for(let bi=0;bi<model.bars.length;bi++)for(let pi=0;pi<grids[bi].length;pi++) {
        const row=result.barEnvelopes[bi];
        for(let d=0;d<6;d++){let value=0;for(const s of sampled)value+=s.f*s.d[bi][pi].forces_local[d];update(row.components[d],value,c.id,grids[bi][pi]);}
        if(c.state==="ELS"){let y=0,z=0;for(const s of sampled){y+=s.f*s.d[bi][pi].uy_m;z+=s.f*s.d[bi][pi].uz_m;}update(row.uy_m,y,c.id,grids[bi][pi]);update(row.uz_m,z,c.id,grids[bi][pi]);}
      }
    }
    result.drifts.forEach(d=>{d.status=d.max_m>d.limit_m?"fails_project_limit":"within_project_limit";if(d.max_m>d.limit_m)result.issues.push(`${project.levels[d.level].name}: deriva elástica de servicio ${(d.max_m*1000).toFixed(2)} mm > H/${e.limits.drift} (${(d.limit_m*1000).toFixed(2)} mm). Revisá arriostramientos, uniones y segundo orden antes de dimensionar.`);});
    result.equilibriumMax=maxError;
  } catch(error) {
    result.status=error instanceof FrameError&&/inestable/.test(error.message)?"unstable":"error";
    result.issues.push(error.message);result.diagnostic=error.details??{};
    // Una respuesta parcial nunca queda disponible como si fuera una envolvente completa.
    result.caseResponses=[];result.combinationChecks=[];result.reactionEnvelopes=[];result.barEnvelopes=[];result.nodeEnvelopes=[];result.drifts=[];result.equilibriumMax=null;
  }
  return result;
}
