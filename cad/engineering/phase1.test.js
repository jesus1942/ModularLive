import test from "node:test";
import assert from "node:assert/strict";
import { createDefaultProject, createLevel, createRectangle, normalizeProject } from "../model.js";
import { generate } from "../generator.js";
import { computeBom } from "../bom.js";
import { area3D, polygonArea } from "../geometry.js";
import { normalizeEngineering } from "./settings.js";
import { locationWind_m_s } from "./data/locations.js";
import { exposureKz, dynamicPressure, roofCp, wallCp, dominantOpening, componentGCp, computeWind, windCasePatches } from "./wind.js";
import { reducedLiveLoad_Pa, roofLiveLoad } from "./loads.js";
import { balancedSnow, snowDrift, driftHeight_m, computeSnow } from "./snow.js";
import { seismicCoefficient, distributeSeismic_N } from "./seismic.js";
import { runEngineering } from "./engine.js";
import { split3D, areaCenter_m, actionResultant } from "./load-geometry.js";
import { G0_m_s2 } from "./units.js";

const near = (actual, expected, tolerance = 1e-6) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} ≠ ${expected}`);
const run = (p) => runEngineering(p, generate(p));
const settings = (p) => normalizeEngineering(p.engineering, p.levels);

test("cielorraso real: 18 m², 16 tubos de 2,96 m, marco de 18 m, cortes y compra", () => {
  const p = createDefaultProject(), g = generate(p), b = computeBom(p, g), r = runEngineering(p, g);
  const pieces = g.members.filter((m) => m.role.startsWith("ceiling"));
  assert.equal(pieces.length, 20);
  near(pieces.reduce((s, m) => s + m.cut, 0), 65.36);
  near(g.totals.ceilingArea, 18);
  const area = (0.02 * 0.04 - (0.02 - .0032) * (0.04 - .0032));
  near(r.entries.filter((a) => a.role?.startsWith("ceiling")).reduce((s, a) => s + a.weight_N, 0), 65.36 * area * 7850 * G0_m_s2);
  near(r.groups.find((a) => a.group === "Cielorraso").weight_N, 18 * 8.15 * G0_m_s2);
  const cuts = b.cutLists.find((a) => a.profileId === "tubo_40x20x1_6");
  assert.equal(cuts.bars.flatMap((a) => a.pieces).length, 20);
  assert.equal(b.rows.find((a) => a.category === "Cielorraso").quantity, 7); // 18×1,10 /2,88 →7
});

test("cielorraso bajo cubierta no duplica el cielorraso de entrepiso ni entra en aleros", () => {
  const p = createDefaultProject(); p.levels.push(createLevel(1, createRectangle(0, 0, 3, 3)));
  const g = generate(p), r = runEngineering(p, g);
  near(g.totals.ceilingArea, 18); // 9 m² de techo bajo expuesto + 9 arriba
  near(g.surfaces.filter((a) => a.material === "cielorraso").reduce((s, a) => s + a.area, 0), 18);
  near(r.groups.filter((a) => a.group === "Cielorraso").reduce((s, a) => s + a.quantity, 0), 18);
  near(r.groups.find((a) => a.group === "Entrepiso" && a.label.includes("yeso")).quantity, 9);
});

test("L por uso y cubierta accesible; Lr alternativo, sin reducción global incorrecta", () => {
  const p = createDefaultProject(); p.engineering.usage[0].use = "oficina";
  let r = run(p); near(-r.live.L.force_N[2], 18 * 2500);
  near(r.live.Lr.entries[0].pressure_Pa, 765); // 101-2025 liviana, pendiente2%,R1=1,R2=1,70
  p.engineering.roofAccess = "terraza";
  r = run(p); near(-r.live.L.force_N[2], 18 * 2500 + 22.75 * 3000);
  near(r.live.Lr.force_N[2], 0);
});

test("reducción L: fórmula cerrada, límites por pisos y prohibición en depósitos", () => {
  near(reducedLiveLoad_Pa({ L0_Pa: 2000, At_m2: 50, KLL: 4 }), 2000 * (.25 + 4.57 / (200 ** .5)));
  near(reducedLiveLoad_Pa({ L0_Pa: 2000, At_m2: 10000, KLL: 4 }), 1000);
  near(reducedLiveLoad_Pa({ L0_Pa: 2000, At_m2: 10000, KLL: 4, floors: 2 }), 800);
  near(reducedLiveLoad_Pa({ L0_Pa: 6000, At_m2: 10000, KLL: 4, use: "deposito" }), 6000);
  assert.throws(() => reducedLiveLoad_Pa({ L0_Pa: 2000, At_m2: -1, KLL: 4 }));
});

test("Lr por edición: liviana2025 al2% .765; pesada/2005 .96; área del elemento", () => {
  near(roofLiveLoad({ edition: "2025", light: true, At_m2: 1, slope_percent: 2 }).pressure_Pa, 765);
  near(roofLiveLoad({ edition: "2025", light: true, At_m2: 100, slope_percent: 20 }).pressure_Pa, .45 * .75 * .88 * 1000);
  near(roofLiveLoad({ edition: "2025", light: false, At_m2: 1, slope_percent: 2 }).pressure_Pa, 960);
  near(roofLiveLoad({ edition: "2005", light: true, At_m2: 100, slope_percent: 100 }).pressure_Pa, 580);
});

test("qz 2025: caso RawsonII V73,5, C a5m contra multiplicación independiente", () => {
  const q = dynamicPressure({ edition: "2025", V_m_s: 73.5, exposure: "C", z_m: 3 });
  near(q.qz_Pa, .613 * .87 * 1 * .85 * 1 * 73.5 ** 2);
  assert.equal(q.I, null); assert.equal(q.Ke, 1);
  near(dynamicPressure({ edition: "2025", V_m_s: 73.5, importance: "IV" }).qz_Pa, q.qz_Pa);
  near(exposureKz("2025", "B", 15), .79); near(exposureKz("2025", "D", 20), 1.34);
  near(exposureKz("2025", "C", 7.5), (.87 + 1) / 2);
});

test("qz 2005: distingue ejemplo orientativo Kz.85 de Tabla5 C.87; I no desaparece", () => {
  const q = dynamicPressure({ edition: "2005", V_m_s: 58, exposure: "C", z_m: 3 });
  near(q.qz_Pa, .613 * .87 * .85 * 58 ** 2);
  near(dynamicPressure({ edition: "2005", V_m_s: 58, Kz: .85 }).qz_Pa, .613 * .85 * .85 * 58 ** 2);
  near(dynamicPressure({ edition: "2005", V_m_s: 58, importance: "IV" }).qz_Pa, q.qz_Pa * 1.15);
  near(exposureKz("2005", "B", 3, true), .72);
  assert.throws(() => exposureKz("2025", "C", 21));
});

test("cambiar edición no reutiliza confirmación ni velocidad de otra edición", () => {
  const p = createDefaultProject(); p.engineering.location.confirmed = true; p.engineering.location.source = "Mapa2025";
  p.engineering.codeEdition = "2005";
  const e = settings(p); near(e.location.V, 58); assert.equal(e.location.confirmed, false); assert.equal(e.location.source, "");
  assert.ok(e.inputIssues.some((s) => s.includes("Cambio de edición")));
  const old = structuredClone(p.engineering); delete old.codeEdition; old.location.V = 58;
  const restored = normalizeEngineering(old, p.levels); assert.equal(restored.codeEdition, "2025"); near(restored.location.V, 80.8);
});

test("tabla de localidades: riesgo cambia mapa2025, Madryn no inventado", () => {
  near(locationWind_m_s("rawson", "2025", "II"), 73.5);
  near(locationWind_m_s("comodoro-rivadavia", "2025", "IV"), 88.7);
  assert.equal(locationWind_m_s("puerto-madryn", "2025", "II"), null);
  assert.equal(locationWind_m_s("rawson", "2005", "II"), null);
});

test("Cp y GCp: interpolaciones de tablas, curvas logarítmicas y ediciones separadas", () => {
  near(wallCp("sotavento", 1.5), -.4);
  near(roofCp({ theta_deg: 0, h_m: 3, L_m: 6, distance_m: 1 }), -.9);
  near(roofCp({ theta_deg: 0, h_m: 3, L_m: 6, distance_m: 4 }), -.5);
  near(componentGCp({ edition: "2025", roofType: "plano", theta_deg: 0, zone: "3", area_m2: 1 }), -3.2);
  near(componentGCp({ edition: "2025", roofType: "plano", theta_deg: 0, zone: "3", area_m2: Math.sqrt(50) }), (-3.2 - 1.4) / 2);
  near(componentGCp({ edition: "2005", roofType: "plano", theta_deg: 0, zone: "3", area_m2: 1 }), -2.8);
  near(componentGCp({ edition: "2025", roofType: "una_agua", theta_deg: 6, zone: "3p", area_m2: 1 }), -2.6);
});

test("abertura dominante: no se compensan fachadas potencialmente abiertas contra otras cerradas", () => {
  assert.equal(dominantOpening(2, .1, 20, 100), true);
  assert.equal(dominantOpening(.1, 1, 20, 100), false);
  const p = createDefaultProject(), g = generate(p);
  let wind = computeWind(p, g, settings(p)); near(wind.GCpi, .55);
  assert.ok(wind.openingChecks.some((a) => a.isolatedDominant));
  p.engineering.wind.enclosure = "closed"; wind = computeWind(p, g, settings(p)); near(wind.GCpi, .18);
});

test("parches conservan áreas y fuerzas sobre superficies reales, sin contar alero como interior", () => {
  const p = createDefaultProject(), g = generate(p), r = runEngineering(p, g), wind = r.wind;
  const patches = wind.cases[0].patches;
  for (const sf of g.surfaces.filter((a) => ["exterior", "cubierta"].includes(a.material))) {
    near(patches.filter((a) => a.surfaceKey === sf.key).reduce((s, a) => s + a.area_m2, 0), area3D(sf.points));
  }
  for (const patch of patches) near(Math.hypot(...patch.force_N), Math.abs(patch.pressure_Pa) * patch.area_m2);
  assert.ok(patches.some((a) => a.eave));
  assert.ok(patches.filter((a) => a.eave).every((a) => a.GCpi === 0));
  near(wind.components.filter((a) => a.eave && a.zone === "3")[0].negative_Pa, -.613 * .87 * .85 * 80.8 ** 2 * 3.2);
});

test("succión total cerrada en techo horizontal contra integración por franjas Cp a mano", () => {
  const p = createDefaultProject(); p.roof.slope = 0; p.roof.overhang = 0; p.foundation.elevation = 0; p.engineering.wind.enclosure = "closed";
  const g = generate(p), w = computeWind(p, g, settings(p)), c = w.cases.find((a) => a.direction === "+X" && a.internalSign === 1 && a.branch === "succion");
  const h = g.levels[0].zTop + .1, q = .613 * .87 * .85 * 80.8 ** 2;
  const expected_N = q * .85 * 3 * (.9 * h + .5 * h + .3 * (6 - 2 * h)) + q * .18 * 18;
  near(c.patches.filter((a) => a.kind === "roof").reduce((s, a) => s + a.force_N[2], 0), expected_N);
});

test("caso2 torsional: fuerza .75 y par ±.15B; caso3 no suma dos presiones de cubierta", () => {
  const p = createDefaultProject(), w = computeWind(p, generate(p), settings(p));
  const base = w.cases.find((a) => a.direction === "+X" && a.internalSign === 1 && a.branch === "succion" && a.torsionCase === 1);
  const t = w.cases.find((a) => a.id === `${base.id}:T1`);
  near(t.force_N[0], .75 * base.force_N[0]); near(t.force_N[2], .75 * base.force_N[2]);
  near(t.couples[0].couple_Nm[2], .15 * 3 * .75 * base.force_N[0]);
  const diagonal = w.cases.find((a) => a.torsionCase === 3 && a.branch === "succion");
  const roof = windCasePatches(w, diagonal.id).filter((a) => a.kind === "roof");
  near(roof.reduce((s, a) => s + a.area_m2, 0), 22.75 * Math.sqrt(1 + .02 ** 2));
  assert.deepEqual(new Set(w.cases.filter((a) => a.torsionCase).map((a) => a.torsionCase)), new Set([1, 2, 3, 4]));
});

test("mínimo SPRFV horizontal y mínimo C&R800Pa nunca se confunden con levantamiento", () => {
  const p = createDefaultProject();p.engineering.location.V = 1;
  const w = computeWind(p, generate(p), settings(p));
  w.cases.filter((a) => a.id.startsWith("W:min:")).forEach((c) => near(c.force_N[2], 0));
  assert.ok(w.components.every((a) => a.positive_Pa >= 800 && a.negative_Pa <= -800));
});

test("nieve: piso mínimo de baja pendiente y Cs conservador, no sólo0,7pg", () => {
  const s = balancedSnow({ pg_Pa: 300, Ce: 1, Ct: 1.2, theta_deg: 1.15, roofType: "plano", width_m: 3 });
  near(s.basic_Pa, 252); near(s.minimum_Pa, 300); near(s.pressure_Pa, 300);
  near(balancedSnow({ pg_Pa: 2000, Ce: 1, Ct: 1.2, theta_deg: 1, roofType: "plano", width_m: 3 }).pressure_Pa, 1680);
});

test("acumulación: cota Fig9 y triángulo cortado en borde mantiene presión distinta de cero", () => {
  const d = snowDrift({ upperFetch_m: 3, lowerFetch_m: 1, pg_Pa: 300, balanced_Pa: 300, step_m: 2.6 });
  near(d.hd_m, .45); near(d.width_m, 1.8); near(d.peak_Pa, .45 * (.426 * 300 + 2200));
  const p = createDefaultProject(); p.levels.push(createLevel(1, createRectangle(0, 0, 5, 3)));
  const s = computeSnow(p, generate(p), settings(p));
  const extra = s.cases.find((a) => a.id.startsWith("S:drift:")).entries.at(-1);
  near(extra.force_N[2], -3 * d.peak_Pa * (1 - 1 / (2 * 1.8)));
  assert.ok(d.peak_Pa * (1 - 1 / d.width_m) > 0);
  assert.equal(driftHeight_m(121, 300), null);
});

test("dos aguas: nieve no balanceada de §6.1 en ambos sentidos, no reemplazada por carga parcial", () => {
  const p = createDefaultProject();p.roof.type = "dos_aguas";p.roof.slope = 30;
  const s = computeSnow(p, generate(p), settings(p));
  const cases = s.cases.filter((a) => a.id.startsWith("S:no-balanceada:"));assert.equal(cases.length, 2);
  near(cases[0].leewardFactor, 1.5);
  assert.ok(cases[0].entries.some((a) => a.force_N[2] === 0));
});

test("sismo estático: tabla SE zona2, Ta y plateau; W·h y equilibrio de fuerzas", () => {
  const c = seismicCoefficient({ zone: 2, site: "SE", height_m: 6, R: 1, riskGroup: "B" });
  near(c.Ca, .3);near(c.Cv, .5);near(c.C, .75);near(c.verticalFactor, .15);
  const d = distributeSeismic_N([10000, 20000], [3, 6], .2);
  near(d.V0_N, 6000);near(d.forces_N[0], 1200);near(d.forces_N[1], 4800);
  near(d.forces_N.reduce((a,b)=>a+b), d.V0_N);
  const top = distributeSeismic_N([10000, 20000], [3, 6], .2, .1);near(top.forces_N[1], .9 * 4800 + 600);
});

test("sismo zona0: exención condicionada, Ao y SF no se reemplazan por E=0", () => {
  const p = createDefaultProject();let r = run(p); assert.equal(r.seismic.exempt, true);
  p.engineering.seismic.riskGroup = "Ao";r = run(p); assert.equal(r.seismic.exempt, undefined);assert.ok(r.seismic.issues.length);
  p.engineering.seismic.riskGroup = "B";p.engineering.location.seismicZone = 2;p.engineering.seismic.site = "SF";
  r = run(p);assert.ok(r.seismic.issues.some((a)=>a.includes("SF")));assert.equal(r.seismic.cases.length,0);
});

test("sismo: cuatro sentidos, Ev±, par accidental5%, masa sin peso de fundación", () => {
  const p = createDefaultProject();p.engineering.location.seismicZone=2;const r=run(p), c=r.seismic.cases[0], lv=r.seismic.levels[0];
  assert.equal(r.seismic.cases.length,16);
  near(r.seismic.W_N, r.totals.superstructure_N + .25 * 36000 + .7 * 6825);
  near(Math.abs(c.entries[0].couple_Nm[2]), r.seismic.V0_N * .05 * 3);
  near(Math.abs(c.force_N[2]), .15 * lv.D_N);
});

test("combinaciones2025/2005 conservan caso y factores; Lr/S alternativos, C&R fuera del global", () => {
  const p=createDefaultProject();let r=run(p);const uplift=r.combinations.find((c)=>c.template==='U6');
  near(uplift.factors.D,.9);near(Object.values(uplift.factors).at(-1),1);
  near(r.deadCase.force_N[2],-r.totals.superstructure_N);
  for(const c of r.combinations.filter((a)=>a.template!=='U5'&&a.template!=='INPRES')) assert.ok(!(c.factors.Lr && Object.keys(c.factors).some((k)=>k.startsWith('S:'))));
  assert.ok(r.combinations.every((c)=>Object.keys(c.factors).every((id)=>r.loadCases.some((a)=>a.id===id))));
  p.engineering.codeEdition='2005';p.engineering.location.windEdition='2005';p.engineering.location.V=58;r=run(p);
  near(Object.values(r.combinations.find((c)=>c.template==='U6').factors).at(-1),1.6);
  assert.ok(!r.wind.cases.some((c)=>c.torsionCase===2)); // Fig.9 de 2005 sóloh>20; 2025 todasalturas
});

test("equilibrio de resultantes por combinación: suma independiente de fuerzas y momentos", () => {
  const r=run(createDefaultProject());const map=new Map(r.loadCases.map((a)=>[a.id,a]));
  for(const c of r.combinations){for(let i=0;i<3;i++){let f=0,m=0;for(const [id,k]of Object.entries(c.factors)){f+=k*map.get(id).force_N[i];m+=k*map.get(id).moment_Nm[i];}near(c.force_N[i],f);near(c.moment_Nm[i],m);}}
});

test("equipo puntual cambia D en el lugar elegido, sin crecer fundación ni masa de compra", () => {
  const p=createDefaultProject();const before=run(p), bom=computeBom(p,generate(p));
  p.engineering.extraLoads=[{id:'tank',levelId:p.levels[0].id,target:'roof',x_m:2,y_m:1,force_N:10500,label:'Tanque1000l',source:'Ficha',confirmed:true}];
  const after=run(p);near(after.totals.superstructure_N-before.totals.superstructure_N,10500);
  near(after.deadCase.moment_Nm[0]-before.deadCase.moment_Nm[0],-10500);near(after.deadCase.moment_Nm[1]-before.deadCase.moment_Nm[1],21000);
  assert.deepEqual(computeBom(p,generate(p)).rows,bom.rows);
  p.engineering.extraLoads[0].x_m=40;assert.ok(run(p).issues.some((a)=>a.includes('posición')));
});

test("geometría de carga: recorte conserva área, centro de triángulo y momento de fuerza puntual", () => {
  const pts=[[0,0,2],[6,0,2],[6,3,2],[0,3,2]];const pieces=split3D(pts,[[1,3,5],[1],[]]);
  near(pieces.reduce((s,a)=>s+area3D(a),0),18);
  assert.deepEqual(areaCenter_m([[0,0,0],[6,0,0],[0,3,0]]),[2,1,0]);
  const r=actionResultant([{point_m:[2,3,4],force_N:[0,0,-1000]}]);assert.deepEqual(r.moment_Nm,[-3000,2000,0]);
});

test("sin contorno, datos inválidos y altura fuera del alcance no rompen ni producen NaN", () => {
  const p=createDefaultProject();p.levels[0].walls.pop();const r=run(p);assert.equal(r.wind.cases.length,0);assert.ok(r.issues.length);
  const bad=createDefaultProject();bad.engineering.snow.Ce='';bad.engineering.seismic.R=0;const n=run(bad);assert.ok(!JSON.stringify(n).includes('NaN'));assert.ok(n.issues.length>=2);
  const high=createDefaultProject();for(let i=1;i<8;i++) high.levels.push(createLevel(i,createRectangle(0,0,6,3)));
  const h=run(normalizeProject(high));assert.equal(h.wind.cases.length,0);assert.ok(h.wind.issues.some((a)=>a.includes('20 m')));
});
