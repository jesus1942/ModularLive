import { PROFILES } from "../catalog.js";
import { nominalSectionProperties } from "./data/sections.js";

const dist=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]));
const coord=(p)=>p.map(v=>(Math.round(v*1e6)/1e6).toString()).join(",");

/** Proyección de un punto sobre una barra, t sin recortar y distancia perpendicular en m. */
export function projectToSegment(point_m,a_m,b_m) {
  const d=b_m.map((v,i)=>v-a_m[i]),l2=d.reduce((s,v)=>s+v*v,0);
  if(l2<1e-16)return null;
  const t=point_m.reduce((s,v,i)=>s+(v-a_m[i])*d[i],0)/l2;
  const point=a_m.map((v,i)=>v+t*d[i]);
  return {t,point_m:point,distance_m:dist(point_m,point)};
}

/**
 * Piezas de columna/bastidor → nodos y barras del pórtico (sin fabricar piezas).
 * Se corrige el desplazamiento visual ±h/2 de los bastidores por su cota lógica;
 * no se aumenta la tolerancia para juntar elementos físicamente desconectados.
 * Cada interfaz entre módulos comparte traslaciones, con giros independientes.
 */
export function createAnalyticalModel(project,generation,e) {
  const nodes=[],bars=[],ties=[],issues=[],assumptions=[],memberSegments={};
  const raw=[],nodeMap=new Map();
  const addNode=(level,p)=>{
    const id=`L${project.levels[level].id}:node:${coord(p)}`;
    if(!nodeMap.has(id)){const n={id,point_m:p.map(v=>Math.round(v*1e6)/1e6),level,label:`${project.levels[level].name} (${coord(p)})`};nodeMap.set(id,n);nodes.push(n);}
    return id;
  };
  for(const member of generation.members.filter(m=>["column","ringBeam"].includes(m.role))) {
    const lv=generation.levels[member.level],section=nominalSectionProperties(PROFILES[member.profileId]);
    if(!lv||!section){issues.push(`Pieza ${member.key}: faltan propiedades de análisis para ${member.profileId}.`);continue;}
    const isRing=member.role==="ringBeam",z=member.group==="Bastidor inferior"?lv.elev:lv.zTop;
    const a=isRing?[member.a[0],member.a[1],z]:member.a.slice(),b=isRing?[member.b[0],member.b[1],z]:member.b.slice();
    raw.push({member,section,a,b,cuts:[0,1]});
  }
  if(generation.levels.some(l=>!l.footprint))issues.push("Contorno abierto: el camino de cargas no está cerrado; el análisis global se deja sin resolver.");
  // Cualquier extremo que cae dentro de una barra del MISMO módulo la divide.
  // También se crea el nodo de transferencia para columnas superiores sobre vigas.
  for(const r of raw) {
    const candidates=raw.flatMap(q=>q.member.level===r.member.level?[q.a,q.b]:q.member.role==="column"&&q.member.level===r.member.level+1?[q.a]:[]);
    for(const p of candidates){const hit=projectToSegment(p,r.a,r.b);if(hit&&hit.distance_m<.015&&hit.t>1e-6&&hit.t<1-1e-6)r.cuts.push(hit.t);}
  }
  for(const r of raw) {
    const {member:m}=r,cuts=[...new Set(r.cuts.map(t=>Math.round(t*1e8)/1e8))].sort((a,b)=>a-b);
    memberSegments[m.key]=[];
    for(let i=0;i<cuts.length-1;i++) {
      const a=r.a.map((v,j)=>v+cuts[i]*(r.b[j]-v)),b=r.a.map((v,j)=>v+cuts[i+1]*(r.b[j]-v));
      if(dist(a,b)<.001){issues.push(`Pieza ${m.key}: segmento analítico demasiado corto.`);continue;}
      const bar={id:`${m.key}:segment:${i}`,key:m.key,memberId:m.id,role:m.role,group:m.group,level:m.level,wallId:m.wallId,profileId:m.profileId,a:addNode(m.level,a),b:addNode(m.level,b),section:r.section,E_Pa:e.steel.E,G_Pa:e.steel.E/2.6,
        // En columnas no cuadradas, nrm orienta el ancho del perfil como en el visor.
        ...(m.role==="column"&&m.nrm?{yAxis:[...m.nrm,0]}:{})};
      bars.push(bar);memberSegments[m.key].push(bar.id);
    }
  }
  for(const r of raw.filter(r=>r.member.role==="column")) {
    const n=nodeMap.get(addNode(r.member.level,r.a));
    if(r.member.level===0)n.restraints=[true,true,true,false,false,false];
    else {
      const below=nodes.filter(q=>q.level===r.member.level-1&&dist(q.point_m,n.point_m)<.015).sort((a,b)=>a.id.localeCompare(b.id))[0];
      if(below)ties.push({a:below.id,b:n.id,dofs:[0,1,2],kind:"interfaz articulada entre módulos"});
      else issues.push(`Columna ${r.member.key}: no tiene columna ni viga de transferencia debajo. Agregá un apoyo real; no se reparte su carga a una columna lejana.`);
    }
  }
  if(!bars.length)issues.push("No hay estructura principal analizable.");
  if(bars.length>600)issues.push("El modelo excede 600 barras principales; dividí el proyecto para este análisis preliminar.");
  if(e.options.baseFixity==="fixed")issues.push("Base empotrada solicitada: falta diseñar placa y anclajes para momento. Se mantiene base articulada en esta fase.");
  if(e.options.useSheathingAsShearWall)issues.push("Muros de corte solicitados: no hay capacidad de placas/fijaciones verificada. No se les asigna rigidez resistente.");
  assumptions.push({id:"analysis:joints",scope:"análisis",message:"Bastidores y columnas del mismo módulo unidos rígidamente como escenario soldado; capacidad y rigidez real de soldaduras pendientes. Bases articuladas e interfaces entre niveles sin continuidad de momento. No se acredita resistencia de OSB ni se agregan cruces inexistentes."},
    {id:"analysis:axes",scope:"análisis",message:"Ejes de bastidores llevados desde sus centros visuales ±h/2 a elev/zTop. Las excentricidades de las cargas se conservan como pares. Transferencias: se divide la viga existente en el punto de apoyo, sin crear acero ficticio."},
    {id:"analysis:sections",scope:"análisis",message:"A, Iy e Iz nominales sin radios, coherentes con el peso modelado; J por Bredt-Batho y ν=0,30. No se aplican reducciones por pandeo local, conexión ni ancho efectivo."});
  return {nodes,bars,ties,memberSegments,issues:[...new Set(issues)],assumptions,scope:"Pórtico principal elástico de primer orden. Las uniones rígidas internas son un supuesto de análisis; no una verificación de su capacidad."};
}
