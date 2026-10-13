import test from "node:test";
import assert from "node:assert/strict";
import { FrameError, solveFrame3D, sampleBarDiagram, createFrameSolver } from "./frame3d.js";

const E=200e9,section={A_m2:9.19e-4,Iy_m4:118.7e-8,Iz_m4:40e-8,J_m4:70e-8};
const beam=(id,a,b,extra={})=>({id,a,b,E_Pa:E,G_Pa:E/2.6,section,...extra});
const node=(id,x,restraints)=>({id,point_m:[x,0,0],restraints});
const pin=[true,true,true,true,false,true],roller=[false,true,true,true,false,true];
const close=(a,b,rel=.005)=>assert.ok(Math.abs(a-b)<=rel*Math.max(Math.abs(b),1e-8),`${a} ≠ ${b}`);
const equilibrium=(r)=>assert.ok(r.equilibrium.relativeError<1e-6,JSON.stringify(r.equilibrium));

test("Viga simple: 4 kN·m, 28,082 mm y equilibrio con carga distribuida",()=>{
  const bar=beam("b","a","z"),model={nodes:[node("a",0,pin),node("z",4,roller)],bars:[bar]};
  const r=solveFrame3D(model,{id:"q",distributed:[{barId:"b",w_N_m:[0,0,-2000]}]});
  close(r.reactions[0].force_N[2],4000,1e-10);
  const mid=sampleBarDiagram(bar,[0,0,0],[4,0,0],r.bars[0])[5];
  close(Math.abs(mid.forces_local[4]),4000);close(-mid.uz_m,5*2000*4**4/(384*E*section.Iy_m4),1e-10);equilibrium(r);
});

test("Voladizo: 6 kN·m y 12,131 mm con 5 kN en la punta",()=>{
  const model={nodes:[node("a",0,Array(6).fill(true)),node("z",1.2)],bars:[beam("b","a","z")]};
  const r=solveFrame3D(model,{id:"P",nodal:[{nodeId:"z",force_N:[0,0,-5000]}]});
  close(r.reactions[0].moment_Nm[1],-6000);close(-r.displacements[8],5000*1.2**3/(3*E*section.Iy_m4),1e-10);equilibrium(r);
});

test("Viga continua: 0,375 / 1,25 / 0,375 wL, M central=wL²/8",()=>{
  const model={nodes:[node("a",0,pin),node("b",4,roller),node("c",8,roller)],bars:[beam("ab","a","b"),beam("bc","b","c")]};
  const r=solveFrame3D(model,{id:"q",distributed:model.bars.map(b=>({barId:b.id,w_N_m:[0,0,-2000]}))});
  [3000,10000,3000].forEach((v,i)=>close(r.reactions[i].force_N[2],v,1e-10));close(Math.abs(r.bars[0].endForces_local[10]),4000,1e-10);equilibrium(r);
});

test("Pórtico fijo: solución manual de δ, θ y axil de columna sin aproximar EA",()=>{
  // Simetría: ux de ambos dinteles=δ, giros=θ, uz opuestos=±v.
  // v=(12EIb/L²)/(EA/h+24EIb/L³)θ; la condensación produce kr.
  const h=3,L=4,I=4e-6,A=.01,P=1000,EI=E*I;
  const kr=4*EI/h+6*EI/L-(12*EI/L**2)**2/(E*A/h+24*EI/L**3);
  const delta=P/(2*(12*EI/h**3-(6*EI/h**2)**2/kr)),theta=6*EI/h**2*delta/kr;
  const s={...section,A_m2:A,Iy_m4:I,Iz_m4:I};
  const model={nodes:[{id:"a",point_m:[0,0,0],restraints:Array(6).fill(true)},{id:"b",point_m:[L,0,0],restraints:Array(6).fill(true)},{id:"c",point_m:[0,0,h]},{id:"d",point_m:[L,0,h]}],bars:[beam("ac","a","c",{section:s,yAxis:[0,1,0]}),beam("bd","b","d",{section:s,yAxis:[0,1,0]}),beam("cd","c","d",{section:s,yAxis:[0,1,0]})]};
  const r=solveFrame3D(model,{id:"P",nodal:[{nodeId:"c",force_N:[P/2,0,0]},{nodeId:"d",force_N:[P/2,0,0]}]});
  close(r.displacements[12],delta,1e-9);close(r.displacements[16],theta,1e-9);equilibrium(r);
});

test("Liberaciones de momento en ambos extremos, incluyendo torsión: cero momentos y flecha exacta",()=>{
  const bar=beam("b","a","z",{releases:{a:[false,false,false,true,true,true],b:[false,false,false,true,true,true]}});
  const model={nodes:[node("a",0,[true,true,true]),node("z",4,[false,true,true])],bars:[bar]};
  const r=solveFrame3D(model,{id:"q",distributed:[{barId:"b",w_N_m:[0,0,-2000]}]});
  r.bars[0].endForces_local.filter((_,i)=>i%6>=3).forEach(v=>assert.ok(Math.abs(v)<1e-8));
  close(-sampleBarDiagram(bar,[0,0,0],[4,0,0],r.bars[0])[5].uz_m,.02808199943836,1e-9);equilibrium(r);
});

test("Carga trapezoidal y par puntual: se conservan las seis componentes de equilibrio",()=>{
  const model={nodes:[node("a",0,Array(6).fill(true)),node("z",4)],bars:[beam("b","a","z")]};
  const r=solveFrame3D(model,{id:"q",distributed:[{barId:"b",wa_N_m:[300,400,-2000],wb_N_m:[600,800,-4000]}],pointLoads:[{barId:"b",t:.3,force_N:[111,222,-333],moment_Nm:[100,-200,300]}]});
  close(r.applied.force_N[2],-12333,1e-10);equilibrium(r);
});

test("Misma estructura rotada 90°: mismas respuestas locales y desplazamientos rotados",()=>{
  const rotate=([x,y,z])=>[-y,x,z],bar=beam("b","a","z",{yAxis:[0,1,0]});
  const model={nodes:[node("a",0,Array(6).fill(true)),node("z",4)],bars:[bar]};
  const load={id:"P",nodal:[{nodeId:"z",force_N:[300,200,-5000],moment_Nm:[111,222,333]}]};
  const a=solveFrame3D(model,load),rotated={nodes:model.nodes.map(n=>({...n,point_m:rotate(n.point_m)})),bars:[{...bar,yAxis:rotate(bar.yAxis)}]};
  const b=solveFrame3D(rotated,{...load,nodal:load.nodal.map(n=>({...n,force_N:rotate(n.force_N),moment_Nm:rotate(n.moment_Nm)}))});
  a.bars[0].endForces_local.forEach((v,i)=>close(b.bars[0].endForces_local[i],v,1e-9));
  rotate(a.displacements.slice(6,9)).forEach((v,i)=>close(b.displacements[6+i],v,1e-9));equilibrium(b);
});

test("Cruces de tensores: se desactiva el comprimido, cambia con el sentido y no se superpone",()=>{
  const model={nodes:[{id:"a",point_m:[0,0,0],restraints:Array(6).fill(true)},{id:"b",point_m:[1,0,0],restraints:Array(6).fill(true)},{id:"c",point_m:[0,0,1],restraints:[false,true,true,true,true,true]},{id:"d",point_m:[1,0,1],restraints:[false,true,true,true,true,true]}],ties:[{a:"c",b:"d",dofs:[0]}],bars:[beam("ad","a","d",{tensionOnly:true}),beam("bc","b","c",{tensionOnly:true})]};
  const solver=createFrameSolver(model);
  const plus=solver.solve({id:"+",nodal:[{nodeId:"d",force_N:[1000,0,0]}]}),minus=solver.solve({id:"-",nodal:[{nodeId:"d",force_N:[-1000,0,0]}]});
  assert.deepEqual(plus.inactiveBars,["bc"]);assert.deepEqual(minus.inactiveBars,["ad"]);close(plus.bars[0].endForces_local[6],1000*Math.SQRT2,1e-9);equilibrium(plus);equilibrium(minus);
});

test("Mecanismo localizado: columna con base articulada sin sistema lateral",()=>{
  const model={nodes:[node("a",0,[true,true,true]),node("z",4)],bars:[beam("b","a","z")]};
  assert.throws(()=>solveFrame3D(model,{id:"P",nodal:[{nodeId:"z",force_N:[0,0,-1000]}]}),e=>e instanceof FrameError&&/inestable/.test(e.message)&&Number.isInteger(e.details.dof));
});

test("Carga en GDL sin rigidez y datos NaN se rechazan sin reacción inventada",()=>{
  const model={nodes:[node("a",0,[true,true,true]),node("z",4,[false,true,true])],bars:[beam("b","a","z",{tensionOnly:true})]};
  assert.throws(()=>solveFrame3D(model,{id:"M",nodal:[{nodeId:"z",moment_Nm:[100,0,0]}]}),/sin rigidez/);
  assert.throws(()=>solveFrame3D(model,{id:"P",nodal:[{nodeId:"z",force_N:[NaN,0,0]}]}),/no finita/);
});
