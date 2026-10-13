import test from "node:test";
import assert from "node:assert/strict";
import { createDefaultProject, createLevel, createRectangle } from "../model.js";
import { generate } from "../generator.js";
import { normalizeEngineering } from "./settings.js";
import { runEngineering } from "./engine.js";
import { responseForCombination } from "./analysis.js";
import { createAnalyticalModel } from "./analytical-model.js";
import { mappedLoadResultant, secondaryReactions } from "./tributary.js";
import { actionResultant, netSurfaceGeometry } from "./load-geometry.js";
import { computeSnow, slidingSnow } from "./snow.js";
import { computeWind, componentGCp } from "./wind.js";
import { nominalSectionProperties } from "./data/sections.js";
import { PROFILES } from "../catalog.js";
import { engineeringResultHtml } from "./panel.js";

const close=(a,b,tol=1e-6)=>assert.ok(Math.abs(a-b)<=tol,`${a} ≠ ${b}`);
const settings=(p)=>normalizeEngineering(p.engineering,p.levels);

test("Propiedades nominales: A/I calculados del tubo usado en masa y 3D; eje fuerte vertical",()=>{
  const s=nominalSectionProperties(PROFILES.tubo_100x50x3_2);
  close(s.A_m2,9.1904e-4,1e-12);close(s.Iy_m4,1.187382613333334e-6,1e-9);
  assert.ok(s.Iy_m4>s.Iz_m4&&s.J_m4>0);assert.equal(nominalSectionProperties(PROFILES.perfil_c_100x50x2),null);
});

test("Área y centro netos descuentan un hueco excéntrico, sin inventar peso",()=>{
  const outer=[[0,0,0],[4,0,0],[4,2,0],[0,2,0]],hole=[[0,0,0],[1,0,0],[1,2,0],[0,2,0]];
  const net=netSurfaceGeometry(outer,[hole]);close(net.area_m2,6);close(net.center_m[0],2.5);close(net.center_m[1],1);
});

test("Secundaria w=2kN/m,L=4m: 4kN por apoyo; volado y excentricidad conservan momento",()=>{
  const reactions=secondaryReactions([2,0,0],[0,0,-8000],[0,0,0],[4,0,0]);
  close(reactions[0].force_N[2],-4000);close(reactions[1].force_N[2],-4000);
  const load={point_m:[5,.1,.2],force_N:[123,456,-5000],couple_Nm:[11,22,33]};
  const delivered=secondaryReactions(load.point_m,load.force_N,[0,0,0],[4,0,0],load.couple_Nm);
  assert.ok(delivered[0].force_N[2]>0,"El apoyo trasero recibe levantamiento.");
  const a=actionResultant([load]),b=actionResultant(delivered);for(let i=0;i<3;i++){close(a.force_N[i],b.force_N[i]);close(a.moment_Nm[i],b.moment_Nm[i]);}
});

test("Módulo inicial: una sola fuente, 136 casos y 2661 combinaciones cierran fuerzas/momentos",()=>{
  const p=createDefaultProject(),g=generate(p),r=runEngineering(p,g),a=r.analysis;
  assert.equal(a.status,"calculated");assert.equal(a.model.nodes.length,12);assert.equal(a.model.bars.length,18);
  assert.equal(a.combinationChecks.length,r.combinations.length);assert.ok(a.equilibriumMax<1e-6);
  assert.ok(a.combinationChecks.every(c=>c.relativeError<1e-6));
  for(const c of a.tributary.cases){const actual=mappedLoadResultant(a.model,c);for(let i=0;i<3;i++){close(actual.force_N[i],c.sourceResultant.force_N[i]);close(actual.moment_Nm[i],c.sourceResultant.moment_Nm[i]);}}
  const D=a.caseResponses.find(c=>c.id==="D");close(D.reactions.reduce((s,x)=>s+x.force_N[2],0),r.totals.superstructure_N);
  close(r.totals.superstructure_N,38907.695926356944);assert.equal(g.members.length,150);
  assert.ok(a.drifts[0].max_m>a.drifts[0].limit_m);assert.equal(a.drifts[0].status,"fails_project_limit");
  assert.ok(a.reactionEnvelopes.some(x=>x.components[2].min<0),"El viento produce tracción de anclajes; no se supone retenido por los dados.");
  const governing=r.combinations.find(c=>c.id===a.drifts[0].combination),detail=responseForCombination(a,governing);
  assert.equal(detail.bars.length,a.model.bars.length);assert.ok(detail.equilibrium.relativeError<1e-6);
  const html=engineeringResultHtml(r,p);assert.match(html,/No cumple el límite del proyecto/);assert.ok(!html.includes("APROBADO"));
});

test("Dos niveles: la carga completa baja a seis apoyos, interfaces comparten sólo traslación",()=>{
  const p=createDefaultProject();p.levels.push(createLevel(1,createRectangle(0,0,6,3)));
  const r=runEngineering(p,generate(p)),a=r.analysis;
  assert.equal(a.status,"calculated");assert.ok(a.model.ties.length>=6);assert.ok(a.model.ties.every(t=>JSON.stringify(t.dofs)==="[0,1,2]"));
  const D=a.caseResponses.find(c=>c.id==="D");assert.equal(D.reactions.length,6);close(D.reactions.reduce((s,x)=>s+x.force_N[2],0),r.totals.superstructure_N);
  assert.ok(a.combinationChecks.every(c=>c.relativeError<1e-6));
});

test("Columna de arriba a mitad de una viga existente: nodo de transferencia y división sin agregar acero",()=>{
  const p=createDefaultProject();p.levels.push(createLevel(1,createRectangle(0,0,6,3)));
  const g=generate(p),m=g.members.find(m=>m.role==="column"&&m.level===1&&m.a[0]===0&&m.a[1]===0);
  m.a[0]=m.b[0]=1.5;
  const model=createAnalyticalModel(p,g,settings(p));
  const node=model.nodes.find(n=>n.level===0&&Math.abs(n.point_m[0]-1.5)<1e-6&&n.point_m[1]===0&&Math.abs(n.point_m[2]-g.levels[0].zTop)<1e-6);
  assert.ok(node);assert.ok(model.ties.some(t=>t.a===node.id));
  const receiving=model.bars.filter(b=>b.level===0&&b.group==="Bastidor superior"&&(b.a===node.id||b.b===node.id));
  assert.equal(receiving.length,2);assert.equal(receiving[0].memberId,receiving[1].memberId);
});

test("Columna flotante y hueco: se explican y no se emiten reacciones globales falsas",()=>{
  const p=createDefaultProject();p.levels.push(createLevel(1,createRectangle(.5,.5,3,2)));
  const r=runEngineering(p,generate(p));assert.notEqual(r.analysis.status,"calculated");assert.deepEqual(r.analysis.caseResponses,[]);assert.ok(r.analysis.issues.some(s=>s.includes("no tiene columna")));
});

test("Cubierta inferior al 20%: nieve y C&R usan su pendiente/tipo propios aunque arriba sea dos aguas",()=>{
  const p=createDefaultProject();p.levels[0].exposed={kind:"techo",slope:20,overhang:0,railing:false};p.levels.push(createLevel(1,createRectangle(0,0,3,3)));p.roof.type="dos_aguas";p.roof.slope=30;
  const g=generate(p),e=settings(p),S=computeSnow(p,g,e),W=computeWind(p,g,e);
  const lower=g.surfaces.find(s=>s.material==="cubierta"&&s.level===0);
  const s=S.rows.find(r=>r.surfaceKey===lower.key);assert.equal(s.roofType,"una_agua");close(s.theta_deg,Math.atan(.2)*180/Math.PI);close(s.slope_percent,20);
  const rows=W.components.filter(c=>c.surfaceKey===lower.key);assert.ok(rows.length);
  for(const c of rows)close(c.GCpNegative,componentGCp({edition:e.codeEdition,roofType:"una_agua",theta_deg:s.theta_deg,zone:c.zone,area_m2:e.wind.effectiveArea_m2,eave:c.eave,positive:false}));
});

test("Nieve que desliza: 0,4pfW/4,5; receptor de 1m reduce fuerza, no concentra el total",()=>{
  const p=createDefaultProject(),e=settings(p);
  const upper={key:"upper",material:"cubierta",level:1,roofType:"una_agua",slope_percent:100,points:[[0,0,7],[2,0,5],[2,6,5],[0,6,7]]};
  const lower={key:"lower",material:"cubierta",level:0,roofType:"plano",slope_percent:0,points:[[2,0,3],[3,0,3],[3,6,3],[2,6,3]]};
  const gen={levels:[{spanAxis:"x"},{spanAxis:"x"}]};
  const rows=[{surfaceKey:"upper",pf_Pa:300},{surfaceKey:"lower",pf_Pa:300}],slides=slidingSnow(p,gen,e,[upper,lower],rows);
  assert.equal(slides.length,1);close(slides[0].pressure_Pa,.4*300*2/4.5);close(slides[0].force_N[2],-320);close(slides[0].planArea_m2,6);
  upper.slope_percent=2;assert.equal(slidingSnow(p,gen,e,[upper,lower],rows).length,0);
  upper.slope_percent=10;p.settings.roofCladding="otra-superficie";assert.equal(slidingSnow(p,gen,e,[upper,lower],rows).length,0);
});

test("Deslizamiento se suma a balanceada y acumulación, nunca las reemplaza",()=>{
  const p=createDefaultProject();p.levels.push(createLevel(1,createRectangle(0,0,3,3)));p.roof.type="una_agua";p.roof.slope=30;p.roof.overhang=0;
  // Hace que la vertiente superior desagüe hacia la parte descubierta.
  const g=generate(p),upper=g.surfaces.find(s=>s.material==="cubierta"&&s.level===1);
  upper.points=upper.points.map(([x,y,z])=>[x,y,8-.3*x]);upper.roofType="una_agua";upper.slope_percent=30;
  const r=computeSnow(p,g,settings(p)),slide=r.cases.find(c=>c.id==="S:deslizamiento");
  assert.ok(slide);assert.ok(slide.entries.some(e=>e.id.startsWith("S:slide:")));assert.ok(slide.entries.some(e=>e.id.startsWith("S:L")));
  const balance=r.cases.find(c=>c.id==="S:balanceada");assert.ok(slide.force_N[2]<balance.force_N[2]);
  if(r.cases.some(c=>c.id.startsWith("S:drift:")))assert.ok(r.cases.some(c=>c.id.startsWith("S:drift:")&&c.id.endsWith(":deslizamiento")));
});
