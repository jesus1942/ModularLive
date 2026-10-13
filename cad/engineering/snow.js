import { bbox, polygonArea, pointInPolygon } from "../geometry.js";
import { SNOW_IMPORTANCE, SOURCES } from "./data/reglamentos.js";
import { areaCenter_m, clip3D, actionResultant } from "./load-geometry.js";
import { roofSurfaceGeometry } from "./roof-surface.js";

// 104-2005 Fig.9: cotas superiores leídas del gráfico, redondeadas HACIA ARRIBA.
// Se usa siguiente lu y siguiente pg, sin interpolar ni extrapolar: aproximación conservadora,
// explícita en cada caso. No es la ecuación ASCE trasladada sin validar al reglamento argentino.
const DRIFT_UPPER_m = { fetch_m: [7.5, 15, 30, 60, 120], pg_kPa: [0, 1, 2, 3, 4, 5],
  heights: [[.30, .45, .60, .70, .75, .80], [.50, .70, .85, .95, 1.05, 1.10], [.75, 1.05, 1.25, 1.40, 1.45, 1.50], [1.05, 1.40, 1.65, 1.85, 1.95, 2.00], [1.45, 1.90, 2.25, 2.45, 2.60, 2.65]] };

/** Nieve balanceada en Pa sobre proyección horizontal; incluye mínimo de baja pendiente. */
export function balancedSnow({ pg_Pa, Ce, Ct, importance = "II", theta_deg, roofType, width_m, Cs = 1 }) {
  const I = SNOW_IMPORTANCE[importance];
  const basic_Pa = .7 * Ce * Ct * I * pg_Pa;
  const lowSlope = roofType === "dos_aguas" ? theta_deg <= 21 / width_m + .5 : theta_deg < 15;
  const minimum_Pa = lowSlope ? I * Math.min(pg_Pa, 1000) : 0;
  const pf_Pa = Math.max(basic_Pa, minimum_Pa);
  return { pressure_Pa: Cs * pf_Pa, pf_Pa, basic_Pa, minimum_Pa, pg_Pa, Ce, Ct, I, Cs, lowSlope,
    reference: "104-05 §§3,3.4 y 4;ec.(1)/(2);Cs=1 sin reducción por pendiente" };
}

/** Cota superior de hd en m tomada de Fig.9; null fuera del dominio tabulado. */
export function driftHeight_m(fetch_m, pg_Pa) {
  if (pg_Pa <= 0) return { hd_m: 0, fetchUpper_m: 7.5, pgUpper_Pa: 0 };
  const i = DRIFT_UPPER_m.fetch_m.findIndex((v) => v >= Math.max(7.5, fetch_m));
  const j = DRIFT_UPPER_m.pg_kPa.findIndex((v) => v * 1000 >= pg_Pa);
  return i < 0 || j < 0 ? null : { hd_m: DRIFT_UPPER_m.heights[i][j], fetchUpper_m: DRIFT_UPPER_m.fetch_m[i], pgUpper_Pa: DRIFT_UPPER_m.pg_kPa[j] * 1000 };
}

/** Acumulación triangular de §7.1: anchura y pico, incluyendo límite 8hc y corte en borde. */
export function snowDrift({ upperFetch_m, lowerFetch_m, pg_Pa, balanced_Pa, step_m }) {
  const up = driftHeight_m(upperFetch_m, pg_Pa), down = driftHeight_m(lowerFetch_m, pg_Pa);
  if (!up || !down) return null;
  const gamma_N_m3 = Math.min(.426 * pg_Pa + 2200, 4700);
  const hb_m = balanced_Pa / gamma_N_m3, hc_m = Math.max(0, step_m - hb_m);
  const hd_m = Math.max(up.hd_m, .75 * down.hd_m);
  const active = pg_Pa > 0 && hc_m > 0 && (hb_m === 0 || hc_m / hb_m >= .2);
  const height_m = Math.min(hd_m, hc_m);
  const width_m = active ? Math.min(8 * hc_m, hd_m <= hc_m ? 4 * hd_m : 4 * hd_m ** 2 / hc_m) : 0;
  return { gamma_N_m3, hb_m, hc_m, hd_m, height_m, width_m, peak_Pa: active ? height_m * gamma_N_m3 : 0, active, upper: up, lower: down,
    reference: "104-05 §7.1;Fig.8/9;ec.(4). Cota superior tabulada de Fig.9, sin extrapolación." };
}

/** Casos S balanceado, parcial y acumulación junto a un nivel superior, fuerzas en N. */
export function computeSnow(project, gen, e) {
  const surfaces = gen.surfaces.filter((s) => s.material === "cubierta");
  const rows = [], issues = [], assumptions = [], cases = [];
  for (const sf of surfaces) {
    const lv = gen.levels[sf.level];
    const bb = bbox(lv.regions?.[sf.region ?? 0]?.footprint ?? lv.footprint);
    const geometry = roofSurfaceGeometry(project, gen, sf);
    const theta = geometry.theta_deg;
    const type = geometry.roofType;
    const width = type === "dos_aguas" ? Math.min(bb.maxX - bb.minX, bb.maxY - bb.minY) / 2 + project.roof.overhang : Math.min(bb.maxX - bb.minX, bb.maxY - bb.minY);
    const info = balancedSnow({ pg_Pa: e.location.pg * 1000, Ce: e.snow.Ce, Ct: e.snow.Ct, importance: e.importance, theta_deg: theta, roofType: type, width_m: width });
    const planArea_m2 = Math.abs(polygonArea(sf.points.map((p) => ({ x: p[0], y: p[1] }))));
    rows.push({ ...info, roofType: type, theta_deg: theta, slope_percent: geometry.slope_percent, id: `S:${sf.key}`, level: sf.level, surfaceKey: sf.key, points: sf.points, planArea_m2, point_m: areaCenter_m(sf.points), force_N: [0, 0, -info.pressure_Pa * planArea_m2] });
  }
  cases.push({ id: "S:balanceada", kind: "S", label: "Nieve balanceada", entries: rows, ...actionResultant(rows) });
  if (!e.snow.confirmed || !e.snow.source) assumptions.push({ id: "snow:factors", scope: "nieve", message: `Ce=${e.snow.Ce} y Ct=${e.snow.Ct} supuestos (104 Tablas2/3). Ct=1,2 inicial evita suponer calefacción permanente. Confirmá exposición y condición térmica.` });
  assumptions.push({ id: "snow:slope", scope: "nieve", message: "Cada paño usa su tipo y pendiente reales. Cs=1: cota conservadora sin aprovechar evacuación (104 Fig.2); no se acredita ausencia de obstrucciones/aislación. Deslizamiento sobre cubiertas inferiores según Cap.9, suponiendo que puede ocurrir: no se reduce por retención sin diseño documentado." });
  // Carga parcial por paño (conserva equilibrio y evita sumar casos alternativos).
  if (rows.length > 1) rows.forEach((r) => {
    const entries = rows.map((a) => a.id === r.id ? a : { ...a, pressure_Pa: a.pressure_Pa / 2, force_N: a.force_N.map((v) => v / 2) });
    cases.push({ id: `S:parcial:${r.surfaceKey}`, kind: "S", label: `Nieve parcial · nivel ${r.level + 1}`, entries, reference: "104-05 §5.2: paño completo/resto a mitad; patrón por tramo pendiente de análisis", ...actionResultant(entries) });
  });
  if (gen.levels.some(lv => lv.footprints?.length > 1)) {
    issues.push("Estructuras independientes: nieve balanceada por cubierta y cargas parciales disponibles; acumulación, nieve no balanceada e interferencias requieren calcular cada edificio por separado.");
    return { source: SOURCES.snow, cases, assumptions, issues, rows, status: "review" };
  }
  for (const sf of surfaces) {
    const above = gen.levels[sf.level + 1];
    if (!above?.footprint) continue;
    const roofBox = bbox(sf.points.map((p) => ({ x: p[0], y: p[1] }))), upperBox = bbox(above.footprint);
    const balanced = rows.find((r) => r.surfaceKey === sf.key);
    project.levels[sf.level + 1].walls.filter((w) => w.type === "exterior").forEach((wall) => {
      const vertical = Math.abs(wall.a.x - wall.b.x) < 1e-6;
      const horizontal = Math.abs(wall.a.y - wall.b.y) < 1e-6;
      if (!vertical && !horizontal) { issues.push("Acumulación de nieve junto a muros oblicuos no implementada."); return; }
      const axis = vertical ? 0 : 1, coordinate = axis === 0 ? wall.a.x : wall.a.y;
      const min = axis === 0 ? roofBox.minX : roofBox.minY, max = axis === 0 ? roofBox.maxX : roofBox.maxY;
      if (Math.abs(coordinate - min) > .01 && Math.abs(coordinate - max) > .01) return;
      const alongAxis = 1 - axis, amin = Math.min(wall.a[vertical ? "y" : "x"], wall.b[vertical ? "y" : "x"]), amax = Math.max(wall.a[vertical ? "y" : "x"], wall.b[vertical ? "y" : "x"]);
      const sign = Math.abs(coordinate - min) < .01 ? 1 : -1;
      const middle = areaCenter_m(sf.points);
      const probe = { x: axis === 0 ? coordinate - sign * .02 : middle[0], y: axis === 1 ? coordinate - sign * .02 : middle[1] };
      if (!pointInPolygon(probe, above.footprint)) return;
      const upperFetch = axis === 0 ? upperBox.maxX - upperBox.minX : upperBox.maxY - upperBox.minY;
      const data = snowDrift({ upperFetch_m: upperFetch, lowerFetch_m: max - min, pg_Pa: e.location.pg * 1000, balanced_Pa: balanced.pressure_Pa, step_m: above.zTop - balanced.point_m[2] });
      if (!data) { issues.push("Acumulación de nieve fuera de Fig.9 tabulada: pg>5 kPa o longitud>120 m; requiere cálculo específico."); return; }
      if (!data.active || !data.width_m) return;
      let points = clip3D(clip3D(sf.points, alongAxis, amin, true), alongAxis, amax, false);
      points = clip3D(points, axis, coordinate + sign * data.width_m, sign < 0);
      if (points.length < 3) return;
      const center = areaCenter_m(points);
      const average_Pa = data.peak_Pa * Math.max(0, 1 - sign * (center[axis] - coordinate) / data.width_m);
      const area_m2 = Math.abs(polygonArea(points.map((p) => ({ x: p[0], y: p[1] }))));
      const drift = { id: `S:drift:${sf.key}:${wall.id}`, level: sf.level, surfaceKey: sf.key, points, point_m: center, pressure_Pa: average_Pa, planArea_m2: area_m2, force_N: [0, 0, -average_Pa * area_m2], ...data };
      const entries = [...rows, drift];
      cases.push({ id: drift.id, kind: "S", label: `Nieve acumulada junto a ${project.levels[sf.level + 1].name}`, entries, ...actionResultant(entries) });
    });
  }
  // El pico de todos los muros simultáneo es una cota adicional, no sustituye los casos direccionales.
  const drifts = cases.filter((c) => c.id.startsWith("S:drift:")).map((c) => c.entries.at(-1));
  if (drifts.length > 1) { const entries = [...rows, ...drifts]; cases.push({ id: "S:acumulacion-envolvente", kind: "S", label: "Acumulación simultánea · cota conservadora", entries, ...actionResultant(entries) }); }
  if (project.roof.type === "dos_aguas") {
    const top = gen.levels.length - 1, lv = gen.levels[top], bb = lv.footprint ? bbox(lv.footprint) : null;
    const W = bb ? Math.min(bb.maxX - bb.minX, bb.maxY - bb.minY) / 2 + project.roof.overhang : 0;
    const theta = Math.atan(project.roof.slope / 100) * 180 / Math.PI;
    if (W > 0 && theta > 21 / W + .5 && theta <= 70) {
      const beta = e.location.pg <= 1 ? 1 : e.location.pg < 2 ? 1.5 - .5 * e.location.pg : .5;
      const factor = (W <= 6 ? 1.5 : 1.2 * (1 + beta / 2)) / e.snow.Ce;
      const topRows = rows.filter((a) => a.level === top);
      topRows.forEach((leeward) => {
        const entries = rows.map((a) => a.level !== top ? a : { ...a, pressure_Pa: a.pressure_Pa * (a.id === leeward.id ? factor : W <= 6 ? 0 : .3), force_N: a.force_N.map((v) => v * (a.id === leeward.id ? factor : W <= 6 ? 0 : .3)) });
        cases.push({ id: `S:no-balanceada:${leeward.surfaceKey}`, kind: "S", label: "Nieve no balanceada · dos aguas", entries, beta, W_m: W, leewardFactor: factor, reference: "104-05 §6.1;Fig.5;ec.(3)", ...actionResultant(entries) });
      });
    }
  }
  const sliding = slidingSnow(project, gen, e, surfaces, rows, issues);
  if (sliding.length) {
    const entries = [...rows, ...sliding];
    cases.push({ id:"S:deslizamiento", kind:"S", label:"Nieve balanceada + caída por deslizamiento", entries, reference:"CIRSOC 104-2005 Cap.9:0,4pfW por m de alero, franja 4,5 m; reducción proporcional por ancho inferior", ...actionResultant(entries) });
    // §7 y Cap.9 pueden actuar juntos; no son alternativas que puedan omitirse.
    for (const c of cases.filter(c=>c.id.startsWith("S:drift:")||c.id==="S:acumulacion-envolvente")) {
      const joined=[...c.entries,...sliding];
      cases.push({...c,id:`${c.id}:deslizamiento`,label:`${c.label} + deslizamiento`,entries:joined,...actionResultant(joined)});
    }
  }
  return { source: SOURCES.snow, cases, assumptions, issues: [...new Set(issues)], rows, status: "review" };
}

/** Caída desde paños superiores ortogonales, sobre la proyección horizontal de cubiertas reales. */
export function slidingSnow(project,gen,e,surfaces,rows,issues=[]) {
  const result=[];
  for(const upper of surfaces) {
    const geometry=roofSurfaceGeometry(project,gen,upper),smooth=["chapa_sinusoidal","chapa_trapezoidal","panel_sandwich"].includes(project.settings.roofCladding);
    if(geometry.slope_percent <= (smooth?2:16)+1e-8)continue;
    const n=geometry.normal,axis=geometry.axis,other=1-axis;
    if(Math.abs(n[other])>1e-6){issues.push("Deslizamiento de nieve en paño oblicuo: requiere trazado de caída específico.");continue;}
    const box=bbox(upper.points.map(p=>({x:p[0],y:p[1]}))),min=axis===0?box.minX:box.minY,max=axis===0?box.maxX:box.maxY;
    const sign=n[axis]>0?1:-1,eave=sign>0?max:min,W_m=max-min;
    const upperLoad=rows.find(r=>r.surfaceKey===upper.key),pressure_Pa=.4*upperLoad.pf_Pa*W_m/4.5;
    const sideMin=other===0?box.minX:box.minY,sideMax=other===0?box.maxX:box.maxY;
    const edgeZ=Math.min(...upper.points.map(p=>p[2]));
    for(const lower of surfaces.filter(s=>s.level<upper.level)) {
      let points=clip3D(clip3D(lower.points,other,sideMin,true),other,sideMax,false);
      points=clip3D(clip3D(points,axis,eave,sign>0),axis,eave+sign*4.5,sign<0);
      if(points.length<3||Math.max(...points.map(p=>p[2]))>=edgeZ-.01)continue;
      const planArea_m2=Math.abs(polygonArea(points.map(p=>({x:p[0],y:p[1]}))));
      if(planArea_m2<1e-8)continue;
      result.push({id:`S:slide:${upper.key}:${lower.key}`,level:lower.level,surfaceKey:lower.key,upperSurfaceKey:upper.key,points,point_m:areaCenter_m(points),pressure_Pa,planArea_m2,force_N:[0,0,-pressure_Pa*planArea_m2],pf_Pa:upperLoad.pf_Pa,W_m,spread_m:4.5,reference:"CIRSOC 104-2005 Cap.9:pslide=0,4pfW/4,5; F=pslide×área horizontal receptora"});
    }
  }
  return result;
}
