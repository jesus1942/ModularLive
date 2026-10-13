import { area3D, bbox, polygonArea, scanPolygon } from "../geometry.js";
import { areaCenter_m, clip3D, actionResultant, netSurfaceGeometry } from "./load-geometry.js";
import { projectToSegment } from "./analytical-model.js";
import { windCasePatches } from "./wind.js";
import { doorLeaf } from "../model.js";

const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const scale=(a,s)=>a.map(v=>v*s);
const subtract=(a,b)=>a.map((v,i)=>v-b[i]);
const add=(a,b)=>a.map((v,i)=>v+b[i]);
const distance=(a,b)=>Math.hypot(...subtract(a,b));
const clip=(points,axis,lo,hi)=>clip3D(clip3D(points,axis,lo,true),axis,hi,false);

/** Reacciones de una secundaria entre dos apoyos: conserva fuerza y los tres momentos. */
export function secondaryReactions(point_m,force_N,a_m,b_m,couple_Nm=[0,0,0]) {
  const hit=projectToSegment(point_m,a_m,b_m);
  if(!hit)throw new Error("Secundaria sin distancia entre apoyos.");
  const t=hit.t,lever=cross(subtract(point_m,hit.point_m),force_N),moment=add(couple_Nm,lever);
  return [{point_m:a_m,force_N:scale(force_N,1-t),couple_Nm:scale(moment,1-t)},
    {point_m:b_m,force_N:scale(force_N,t),couple_Nm:scale(moment,t)}];
}

/**
 * Áreas tributarias geométricas y bajada a barras principales.
 * El origen, cada secundaria y cada recepción quedan en el registro.
 * Las cargas que no tienen camino físico bloquean el análisis; no se redistribuyen por cercanía.
 */
export function computeTributaryLoads(project,gen,e,model,cases,wind) {
  const issues=[],traces=[],mapped=[],surfaceMap=new Map(gen.surfaces.map(s=>[s.key,s]));
  const memberMap=new Map(gen.members.map(m=>[m.key,m])),nodeMap=new Map(model.nodes.map(n=>[n.id,n]));
  const geometric=new Map(),geometryCache=new Map(),routeCache=new Map(),ringCache=new Map(),attachmentCache=new Map(),ringBars=model.bars.filter(b=>b.role==="ringBeam");
  const ledgers=gen.members.filter(m=>m.role==="rafter"&&m.group==="Vigas de apoyo de cubierta");
  // La carga de huecos, escaleras y balcones requiere sus conexiones analíticas reales.
  // Se conserva el cálculo de cargas, pero no se informa una reacción global ficticia.
  if(gen.levels.some(l=>l.holes?.length))issues.push("Huecos de entrepiso: falta incorporar brochales y vigas de borde al camino analítico. El análisis global se deja pendiente.");
  if(gen.members.some(m=>["stairStringer","balconyBeam","landingPost"].includes(m.role)))issues.push("Escaleras/balcones: sus apoyos y uniones analíticas aún no están resueltos; no se emiten reacciones globales de ese proyecto.");
  const barEnds=(bar)=>[nodeMap.get(bar.a).point_m,nodeMap.get(bar.b).point_m];

  // Receptor real: la fuerza se lleva a su eje con el par r×F correspondiente.
  const attach=(out,bar,point,F,M=[0,0,0],source="")=>{
    const cacheKey=`${bar.id}:${point.map(v=>Math.round(v*1e8)).join()}`;
    const [a,b]=barEnds(bar);let hit=attachmentCache.get(cacheKey);
    if(!hit){hit=projectToSegment(point,a,b);if(hit)attachmentCache.set(cacheKey,hit);}
    if(!hit||hit.t<-.005||hit.t>1.005){issues.push(`Carga ${source}: cae fuera de su barra receptora.`);return;}
    const t=Math.min(1,Math.max(0,hit.t)),at=a.map((v,i)=>v+t*(b[i]-v));
    const moment=add(M,cross(subtract(point,at),F));
    out.pointLoads.push({barId:bar.id,t,force_N:F,moment_Nm:moment,sourceId:source});
  };
  const nearestRing=(level,side,point)=>{
    const key=`${level}:${side}:${point.map(v=>Math.round(v*1e8)).join()}`;
    if(ringCache.has(key))return ringCache.get(key);
    const expected=side==="bottom"?"Bastidor inferior":"Bastidor superior";
    const receiver=ringBars.filter(b=>b.level===level&&b.group===expected).map(bar=>({bar,hit:projectToSegment(point,...barEnds(bar))}))
      .filter(r=>r.hit&&r.hit.t>=-.005&&r.hit.t<=1.005)
      .sort((a,b)=>a.hit.distance_m-b.hit.distance_m||a.bar.id.localeCompare(b.bar.id))[0];
    ringCache.set(key,receiver);return receiver;
  };
  const toRing=(out,level,side,point,F,M,source,allowPlan_m=.12)=>{
    const lv=gen.levels[level];if(!lv)return;
    const z=side==="bottom"?lv.elev:lv.zTop,probe=[point[0],point[1],z],receiver=nearestRing(level,side,probe);
    if(!receiver||receiver.hit.distance_m>allowPlan_m){issues.push(`Carga ${source}: no existe bastidor ${side==="bottom"?"inferior":"superior"} bajo su apoyo (${point.slice(0,2).join(",")} m).`);return;}
    attach(out,receiver.bar,point,F,M,source);
  };
  const roofSupport=(out,level,point,F,M,source)=>{
    const ledger=ledgers.filter(m=>m.level===level).map(m=>({m,hit:projectToSegment(point,m.a,m.b)})).filter(r=>r.hit&&r.hit.t>=-.03&&r.hit.t<=1.03&&r.hit.distance_m<.18).sort((a,b)=>a.hit.distance_m-b.hit.distance_m)[0];
    if(ledger) {
      const m=ledger.m,axis=Math.abs(m.b[0]-m.a[0])>=Math.abs(m.b[1]-m.a[1])?0:1,other=1-axis;
      const posts=model.bars.filter(b=>b.role==="column"&&b.level===level+1).map(bar=>({bar,a:barEnds(bar)[0],b:barEnds(bar)[1]}))
        .filter(r=>Math.abs(r.a[other]-m.a[other])<.12&&point[2]>=r.a[2]-.02&&point[2]<=r.b[2]+.02).sort((a,b)=>a.a[axis]-b.a[axis]);
      const left=posts.filter(p=>p.a[axis]<=point[axis]+.01).at(-1),right=posts.find(p=>p.a[axis]>=point[axis]-.01);
      if(!left||!right){issues.push(`Viga de apoyo ${m.key}: faltan columnas superiores a ambos lados de la reacción.`);return;}
      if(left.bar.id===right.bar.id)attach(out,left.bar,point,F,M,source);
      else {
        const a=[...point],b=[...point];a[axis]=left.a[axis];b[axis]=right.a[axis];a[other]=left.a[other];b[other]=right.a[other];
        for(const [i,r] of secondaryReactions(point,F,a,b,M).entries())attach(out,i===0?left.bar:right.bar,r.point_m,r.force_N,r.couple_Nm,source);
      }
      return;
    }
    toRing(out,level,"top",point,F,M,source,project.roof.overhang+.12);
  };

  const supportPoints=(sf,m)=>{
    const axis=Math.abs(m.b[0]-m.a[0])>=Math.abs(m.b[1]-m.a[1])?0:1,other=1-axis;
    const lowRoof=sf.exposed&&sf.access!=="terraza";
    let lo,hi;
    if(lowRoof) {
      const target=gen.levels[sf.level].exposed?.find(part=>part.outline.some(p=>Math.abs(p[axis===0?"y":"x"]-m.a[other])<1e-4))??null;
      // Los bordes de la región descubierta, no el contorno completo del nivel.
      const pts=target?.outline??sf.points.map(p=>({x:p[0],y:p[1]}));const bb=bbox(pts);
      lo=axis===0?bb.minX:bb.minY;hi=axis===0?bb.maxX:bb.maxY;
      // Sin usar el alero como apoyo: el extremo alto de cabio está a FACE del ledger real.
      const alongLedgers=ledgers.filter(l=>l.level===sf.level&&Math.abs(l.b[other]-l.a[other])>.01);
      const ledger=alongLedgers.find(l=>m.a[other]>=Math.min(l.a[other],l.b[other])-.1&&m.a[other]<=Math.max(l.a[other],l.b[other])+.1&&Math.min(Math.abs(l.a[axis]-m.a[axis]),Math.abs(l.a[axis]-m.b[axis]))<.18);
      if(ledger){const c=ledger.a[axis];if(Math.abs(c-m.a[axis])<Math.abs(c-m.b[axis]))lo=c;else hi=c;}
      const footprint=gen.levels[sf.level].footprint,fb=bbox(footprint);
      lo=Math.max(lo,axis===0?fb.minX:fb.minY);hi=Math.min(hi,axis===0?fb.maxX:fb.maxY);
    } else {
      const footprint=gen.levels[sf.level].footprint,bb=bbox(footprint);
      const c=Math.min(Math.max(m.a[other],other===0?bb.minX:bb.minY),other===0?bb.maxX:bb.maxY);
      const intervals=scanPolygon(footprint,axis===0?"y":"x",c);
      const middle=(m.a[axis]+m.b[axis])/2;
      const span=intervals.find(([a,b])=>middle>=a-.1&&middle<=b+.1)??intervals[0];
      if(!span)return null;[lo,hi]=span;
    }
    if(!(hi-lo>.01))return null;
    const at=(x)=>{const t=(x-m.a[axis])/(m.b[axis]-m.a[axis]);return m.a.map((v,i)=>v+t*(m.b[i]-v));};
    return {a:at(lo),b:at(hi),axis,other};
  };
  const bands=(sf)=>{
    if(geometric.has(sf.key))return geometric.get(sf.key);
    const role=sf.material==="piso"||sf.material==="volado"?"floorJoist":sf.material==="cielorraso"?"ceilingJoist":sf.access==="terraza"?"floorJoist":"rafter";
    let members=gen.members.filter(m=>m.level===sf.level&&m.role===role&&(role!=="rafter"||m.group==="Cabios"));
    const normalPlane=(p)=>{const a=sf.points[0],b=sf.points[1],c=sf.points.at(-1),n=cross(subtract(b,a),subtract(c,a));return Math.abs(dot(subtract(p,a),n))/Math.hypot(...n);};
    members=members.filter(m=>normalPlane(m.a.map((v,i)=>(v+m.b[i])/2))<.35);
    if(!members.length){issues.push(`Superficie ${sf.key}: no tiene ${role} reales que reciban su carga.`);geometric.set(sf.key,[]);return [];}
    const axis=Math.abs(members[0].b[0]-members[0].a[0])>=Math.abs(members[0].b[1]-members[0].a[1])?0:1,other=1-axis;
    members=members.filter(m=>Math.abs(m.b[other]-m.a[other])<.01).sort((a,b)=>a.a[other]-b.a[other]||a.key.localeCompare(b.key));
    // Dos aguas no posee apoyos analíticos verificados para su cumbrera en esta fase.
    if(!sf.exposed&&sf.material==="cubierta"&&project.roof.type==="dos_aguas"){issues.push("Cubierta a dos aguas: falta modelar el apoyo real de cumbrera/cercha. No se emiten reacciones globales hasta cerrar ese camino.");geometric.set(sf.key,[]);return [];}
    const unique=[];for(const m of members)if(!unique.length||Math.abs(unique.at(-1).a[other]-m.a[other])>1e-5)unique.push(m);
    const rows=unique.map((m,i)=>({member:m,axis,other,lo:i?(unique[i-1].a[other]+m.a[other])/2:-Infinity,hi:i+1<unique.length?(m.a[other]+unique[i+1].a[other])/2:Infinity,support:supportPoints(sf,m)}));
    geometric.set(sf.key,rows);return rows;
  };
  const surfaceAction=(out,load,sf,F,holes=[])=>{
    const geometryId=`${sf.key}:${load.points?load.id:"full"}:${holes.length>0?"net":"gross"}`;
    const isWall=!!sf.wallId;
    if(isWall) {
      // Fachada: reacción superior/inferior de montantes; el marco de las
      // carpinterías participa en la carga bruta de viento. Resistencia pendiente.
      const wall=project.levels[sf.level].walls.find(w=>w.id===sf.wallId);
      if(!wall){issues.push(`Superficie ${sf.key}: muro receptor ausente.`);return;}
      if(sf.material==="puerta"&&load.kind==="D") {
        const opening=wall.openings.find(o=>sf.key.endsWith(`:${o.id}`));
        if(!opening){issues.push(`Hoja ${sf.key}: no se encontró su bisagra.`);return;}
        const hinge=doorLeaf(wall,opening).hingePt,at=[hinge.x,hinge.y,gen.levels[sf.level].elev];
        toRing(out,sf.level,"bottom",at,F,cross(subtract(load.point_m,at),F),load.id);return;
      }
      const axis=Math.abs(wall.b.x-wall.a.x)>=Math.abs(wall.b.y-wall.a.y)?0:1;
      const verticals=gen.members.filter(m=>m.level===sf.level&&Math.abs(m.b[2]-m.a[2])>.1&&Math.abs(m.b[axis]-m.a[axis])<.01&&(m.wallId===wall.id||m.role==="column"&&Math.abs(m.a[1-axis]-(axis===0?wall.a.y:wall.a.x))<.1)).sort((a,b)=>a.a[axis]-b.a[axis]);
      const coordinates=[...new Set(verticals.map(m=>Math.round(m.a[axis]*1e6)/1e6))].sort((a,b)=>a-b);
      if(!coordinates.length){issues.push(`Muro ${wall.id}: no tiene montantes ni columnas reales.`);return;}
      let geometries=geometryCache.get(geometryId);
      if(!geometries){const total=netSurfaceGeometry(load.points??sf.points,holes).area_m2;geometries={total,parts:coordinates.map((c,i)=>{const lo=i?(coordinates[i-1]+c)/2:-Infinity,hi=i+1<coordinates.length?(c+coordinates[i+1])/2:Infinity;const pts=clip(load.points??sf.points,axis,lo,hi),hs=holes.map(h=>clip(h,axis,lo,hi)).filter(h=>h.length>=3);return netSurfaceGeometry(pts,hs);})};geometryCache.set(geometryId,geometries);}
      const total=geometries.total;
      coordinates.forEach((c,i)=>{
        const geo=geometries.parts[i];
        if(geo.area_m2<1e-9)return;
        const force=scale(F,geo.area_m2/total),point=geo.center_m,lv=gen.levels[sf.level];
        if(load.kind==="D")toRing(out,sf.level,"bottom",point,force,[0,0,0],load.id);
        else {
          const a=[...point],b=[...point];a[axis]=b[axis]=c;a[1-axis]=b[1-axis]=axis===0?wall.a.y:wall.a.x;a[2]=lv.elev;b[2]=lv.zTop;
          for(const [j,r] of secondaryReactions(point,force,a,b).entries())toRing(out,sf.level,j?"top":"bottom",r.point_m,r.force_N,r.couple_Nm,load.id);
        }
        if(out.trace)traces.push({caseId:out.id,sourceId:load.id,surfaceKey:sf.key,role:"montante/fachada",coordinate_m:c,area_m2:geo.area_m2,force_N:force});
      });
      return;
    }
    if(sf.material==="platea") {
      // El piso en contacto con el suelo NO descarga su uso/peso en las columnas.
      const point=load.point_m,F0=F;
      out.groundEntries.push({id:load.id,point_m:point,force_N:F0,reference:"Piso apoyado directamente en suelo; no es reacción de columna ni cálculo de platea."});return;
    }
    const rows=bands(sf),pts=load.points??sf.points;
    let geometries=geometryCache.get(geometryId);
    if(!geometries){geometries={total:netSurfaceGeometry(pts,holes).area_m2,parts:rows.map(r=>netSurfaceGeometry(clip(pts,r.other,r.lo,r.hi),holes.map(h=>clip(h,r.other,r.lo,r.hi)).filter(h=>h.length>=3)))};geometryCache.set(geometryId,geometries);}
    const total=geometries.total;
    for(const [ri,r] of rows.entries()) {
      const geo=geometries.parts[ri];
      if(geo.area_m2<1e-9)continue;
      if(!r.support){issues.push(`Secundaria ${r.member.key}: no se encontraron sus apoyos.`);continue;}
      const force=scale(F,geo.area_m2/total),reactions=secondaryReactions(geo.center_m,force,r.support.a,r.support.b);
      for(const reaction of reactions) {
        if(sf.material==="cubierta"&&sf.access!=="terraza")roofSupport(out,sf.level,reaction.point_m,reaction.force_N,reaction.couple_Nm,load.id);
        else toRing(out,sf.level,["piso","volado"].includes(sf.material)?"bottom":"top",reaction.point_m,reaction.force_N,reaction.couple_Nm,load.id);
      }
      if(out.trace)traces.push({caseId:out.id,sourceId:load.id,surfaceKey:sf.key,memberKey:r.member.key,role:r.member.role,area_m2:geo.area_m2,point_m:geo.center_m,force_N:force,supports_m:[r.support.a,r.support.b],reactions,
        formula:"F=q×área tributaria; RA=(1−t)F, RB=tF; pares r×F por excentricidad. Sin reducir L ni Lr."});
    }
  };

  // Los 128 casos derivados de viento reutilizan la MISMA geometría. Las
  // reacciones son lineales con la presión: se recalcula el factor, no el recorte.
  const routeSurface=(out,load,sf)=>{
    if(out.kind!=="W"){surfaceAction(out,{...load,kind:out.kind},sf,load.force_N,out.kind==="D"?sf.holes??[]:[]);return;}
    const F=load.force_N,axis=F.reduce((best,v,i)=>Math.abs(v)>Math.abs(F[best])?i:best,0),factor=F[axis];
    if(Math.abs(factor)<1e-14)return;
    const key=`${sf.key}:${load.id}:${axis}:${F.map(v=>Math.round(v/factor*1e8)).join()}`;
    const cached=routeCache.get(key);
    if(cached){for(const p of cached.loads)out.pointLoads.push({...p,force_N:scale(p.force_N,factor),moment_Nm:scale(p.moment_Nm,factor),sourceId:load.id});return;}
    const start=out.pointLoads.length,traceStart=traces.length;
    surfaceAction(out,{...load,kind:"W"},sf,F);
    routeCache.set(key,{sourceId:load.id,surfaceKey:sf.key,axis,unitDirection:F.map(v=>v/factor),loads:out.pointLoads.slice(start).map(p=>({...p,force_N:scale(p.force_N,1/factor),moment_Nm:scale(p.moment_Nm,1/factor)}))});
  };

  for(const c of cases) {
    const out={id:c.id,kind:c.kind,nodal:[],distributed:[],pointLoads:[],groundEntries:[],trace:!c.baseIds,sourceResultant:{force_N:c.force_N,moment_Nm:c.moment_Nm}};
    const entries=c.kind==="W"?[...windCasePatches(wind,c.id),...(c.pointEntries??[]),...(c.couples??[])]:c.entries??[];
    for(const load of entries) {
      const id=load.id,deadMember=c.kind==="D"?memberMap.get(id):null,sf=surfaceMap.get(load.surfaceKey);
      if(deadMember&&model.memberSegments[id]?.length) {
        const segments=model.memberSegments[id].map(id=>model.bars.find(b=>b.id===id)),length=segments.reduce((s,b)=>s+distance(...barEnds(b)),0);
        for(const bar of segments)out.distributed.push({barId:bar.id,w_N_m:scale(load.force_N,1/length),sourceId:id});
        continue;
      }
      if(sf){routeSurface(out,load,sf);continue;}
      const lv=gen.levels[load.level];if(!lv){issues.push(`Carga ${id}: nivel sin geometría.`);continue;}
      if(deadMember) {
        const p=load.point_m;
        const floor=deadMember.role==="floorJoist";
        const roof=["rafter","roofEdge","ridge","ceilingJoist","ceilingTrack"].includes(deadMember.role);
        if(roof||floor) {
          const closest=gen.surfaces.filter(s=>s.level===load.level&&s.material===(floor?"piso":deadMember.role.startsWith("ceiling")?"cielorraso":"cubierta")).sort((a,b)=>distance(areaCenter_m(a.points),p)-distance(areaCenter_m(b.points),p))[0];
          const row=closest&&bands(closest).map(r=>({...r,distance:Math.abs(r.member.a[r.other]-p[r.other])})).sort((a,b)=>a.distance-b.distance)[0];
          if(row?.support)for(const reaction of secondaryReactions(p,load.force_N,row.support.a,row.support.b)) (floor?toRing(out,load.level,"bottom",reaction.point_m,reaction.force_N,reaction.couple_Nm,id):roofSupport(out,load.level,reaction.point_m,reaction.force_N,reaction.couple_Nm,id));
          else issues.push(`Pieza ${id}: no hay apoyo del techo/cielorraso para su peso.`);
        } else toRing(out,load.level,"bottom",p,load.force_N,[0,0,0],id);
      } else {
        // Equipos, sismo y pares mínimos/torsionales: reparto por traslaciones
        // a un punto del bastidor con el par exacto; no se presume diafragma rígido.
        const side=load.target==="floor"?"bottom":"top",receiver=nearestRing(load.level,side,[load.point_m[0],load.point_m[1],side==="bottom"?lv.elev:lv.zTop]);
        if(!receiver){issues.push(`Carga ${id}: no tiene receptor real.`);continue;}
        if(id.startsWith("extra:")) {
          const target=gen.surfaces.find(s=>s.level===load.level&&s.material===(load.target==="floor"?"piso":"cubierta"));
          const row=target&&bands(target).map(r=>({...r,distance:Math.abs(r.member.a[r.other]-load.point_m[r.other])})).sort((a,b)=>a.distance-b.distance)[0];
          if(row?.support)for(const r of secondaryReactions(load.point_m,load.force_N,row.support.a,row.support.b)) (load.target==="floor"?toRing(out,load.level,"bottom",r.point_m,r.force_N,r.couple_Nm,id):roofSupport(out,load.level,r.point_m,r.force_N,r.couple_Nm,id));
          else issues.push(`Equipo ${id}: no tiene secundaria receptora.`);
        } else {
          // Las resultantes por nivel (sismo, mínimo de viento y torsión)
          // se reparten por igual a los nodos del anillo, conservando el par.
          const targets=model.nodes.filter(n=>n.level===load.level&&Math.abs(n.point_m[2]-(side==="bottom"?lv.elev:lv.zTop))<.015);
          for(const n of targets){const force=scale(load.force_N,1/targets.length),moment=scale(add(load.couple_Nm??[0,0,0],cross(subtract(load.point_m,n.point_m),load.force_N)),1/targets.length);out.nodal.push({nodeId:n.id,force_N:force,moment_Nm:moment,sourceId:id});}
        }
      }
    }
    // Suma en cada punto receptor; las fuentes conservan sus IDs para la trazabilidad.
    const grouped=new Map();
    for(const p of out.pointLoads){const id=`${p.barId}:${Math.round(p.t*1e8)}`;if(!grouped.has(id))grouped.set(id,{...p,sourceIds:[],force_N:[0,0,0],moment_Nm:[0,0,0]});const row=grouped.get(id);row.force_N=add(row.force_N,p.force_N);row.moment_Nm=add(row.moment_Nm,p.moment_Nm);row.sourceIds.push(p.sourceId);}
    out.pointLoads=[...grouped.values()];delete out.trace;mapped.push(out);
  }
  return {cases:mapped,traces,windUnitRoutes:[...routeCache.values()],issues:[...new Set(issues)],assumptions:[{id:"analysis:tributary",scope:"bajada de cargas",message:"Secundarias por bandas a mitad de distancia, sin reducciones de sobrecarga. Reacciones estáticas con pares de excentricidad. Fachadas descargan sobre ambos bastidores; su peso sobre el inferior. Cabios de borde transmiten por las cenefas reales; su flexión y fijaciones todavía no se verifican. Las rutas unitarias de viento se multiplican por la componente indicada de cada parche; no se duplican las trazas en 128 casos derivados."},
    {id:"analysis:diaphragm",scope:"acciones por nivel",message:"Resultantes concentradas por nivel repartidas a nodos del anillo con sus pares, sin acreditar diafragma rígido ni repartir sismo por rigideces. Revisar diafragma, excentricidad y conexiones."}]};
}

/** Resultante exacta del caso aplicado al modelo, útil para contrastar la transferencia. */
export function mappedLoadResultant(model,loadCase) {
  const map=new Map(model.nodes.map(n=>[n.id,n.point_m])),bars=new Map(model.bars.map(b=>[b.id,b]));
  const entries=(loadCase.nodal??[]).map(n=>({point_m:map.get(n.nodeId),force_N:n.force_N,couple_Nm:n.moment_Nm}));
  for(const p of loadCase.pointLoads??[]){const b=bars.get(p.barId),a=map.get(b.a),z=map.get(b.b);entries.push({point_m:a.map((v,i)=>v+p.t*(z[i]-v)),force_N:p.force_N,couple_Nm:p.moment_Nm});}
  for(const q of loadCase.distributed??[]){const b=bars.get(q.barId),a=map.get(b.a),z=map.get(b.b),L=distance(a,z),wa=q.wa_N_m??q.w_N_m,wb=q.wb_N_m??wa;entries.push({point_m:a,force_N:wa.map((v,i)=>L*(v+wb[i])/2),couple_Nm:cross(subtract(z,a),wa.map((v,i)=>L*(v+2*wb[i])/6))});}
  return actionResultant([...entries,...(loadCase.groundEntries??[])]);
}
