// Escaleras entre niveles: resolución reglamentaria (alzada, pedada, tramos) y geometría en planta.
// Todo en metros. La escalera pertenece al nivel de ABAJO y llega al piso terminado del nivel de arriba.
import { STAIR_RULES } from "./data/stair-rules.js";
import { round, unionOutline } from "./geometry.js";

export const STAIR_KINDS = {
  recta: "Recta",
  L: "En L (con descanso)",
  U: "En U (con descanso)"
};

export const STAIR_TREADS = {
  chapa: "Chapa plegada 3,2 mm",
  madera: "Madera dura 38 mm"
};

const U_GAP = 0.1; // ojo de la escalera en U

export const stairRules = (id) => STAIR_RULES[id] ?? STAIR_RULES.municipal;

/** Vector de subida en planta para dir = 0 | 90 | 180 | 270 (y crece hacia abajo en pantalla). */
export function dirVector(dir) {
  const r = ((dir % 360) + 360) % 360;
  if (r === 90) return { x: 0, y: 1 };
  if (r === 180) return { x: -1, y: 0 };
  if (r === 270) return { x: 0, y: -1 };
  return { x: 1, y: 0 };
}

/** Cantidad de alzadas, alzada y pedada que cumplen la regla elegida para salvar H. */
export function solveRisers(H, rules) {
  if (!(H > 0)) return { ok: false, reason: "No hay desnivel para salvar." };
  const first = Math.max(1, Math.ceil(H / rules.aMax - 1e-9));
  for (let n = first; n < first + 10; n += 1) {
    const a = H / n;
    if (a < rules.aMin - 1e-9) break;
    const target = (rules.blondel[0] + rules.blondel[1]) / 2 - 2 * a;
    const p = Math.min(Math.max(Math.round(target * 100) / 100, rules.pMin), rules.pMax);
    const b = 2 * a + p;
    if (b >= rules.blondel[0] - 1e-9 && b <= rules.blondel[1] + 1e-9) return { ok: true, n, a, p, blondel: b };
  }
  return { ok: false, reason: `No hay combinación de alzada y pedada que cumpla con H = ${round(H, 3)} m.` };
}

/** Reparto de alzadas por tramo. */
export function splitFlights(n, kind, rules) {
  if (kind === "recta" && n <= rules.maxRisers) return [n];
  const r1 = Math.ceil(n / 2);
  return [r1, n - r1];
}

/**
 * Geometría completa de una escalera en planta y en altura.
 * stair: { kind, x, y, dir, width, turn: "derecha"|"izquierda", ruleSet }
 * levels: { f0 (piso terminado de abajo), H (desnivel), zUnder (cara inferior del entrepiso de arriba) }
 */
export function layoutStair(stair, { f0, H, zUnder }) {
  const rules = stairRules(stair.ruleSet);
  const sol = solveRisers(H, rules);
  const w = stair.width;
  const out = { stair, rules, solution: sol, flights: [], landings: [], treads: [], rects: [], hole: [], holeRects: [], arrival: null };
  if (!sol.ok) return out;
  const { n, a, p } = sol;
  const u = dirVector(stair.dir);
  const r = { x: -u.y, y: u.x }; // derecha mirando hacia donde sube
  const sgn = stair.turn === "izquierda" ? -1 : 1;
  const O = { x: stair.x, y: stair.y };
  const world = (s, t) => ({ x: O.x + u.x * s + r.x * t, y: O.y + u.y * s + r.y * t });
  const rectOf = (s0, s1, t0, t1) => {
    const pts = [world(s0, t0), world(s1, t0), world(s1, t1), world(s0, t1)];
    const xs = pts.map((q) => q.x);
    const ys = pts.map((q) => q.y);
    return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys), poly: pts };
  };
  const risers = splitFlights(n, stair.kind, rules);
  out.risers = risers;

  // Tramo genérico en coordenadas locales (s a lo largo de la subida, t a la derecha)
  const flight = (c0, d, count, baseRiser) => {
    const lat = { s: -d.t, t: d.s };
    const run = (count - 1) * p;
    const at = (k, side) => ({ s: c0.s + d.s * k + lat.s * side, t: c0.t + d.t * k + lat.t * side });
    const treads = [];
    for (let k = 1; k < count; k += 1) {
      const A = at((k - 1) * p, -w / 2);
      const B = at(k * p, w / 2);
      const rc = rectOf(Math.min(A.s, B.s), Math.max(A.s, B.s), Math.min(A.t, B.t), Math.max(A.t, B.t));
      treads.push({ ...rc, z: f0 + (baseRiser + k) * a, index: baseRiser + k });
    }
    const A = at(0, -w / 2);
    const B = at(run, w / 2);
    const rc = rectOf(Math.min(A.s, B.s), Math.max(A.s, B.s), Math.min(A.t, B.t), Math.max(A.t, B.t));
    const sides = [-1, 1].map((side) => {
      const s0 = at(0, (side * w) / 2);
      const s1 = at(run, (side * w) / 2);
      return { a: world(s0.s, s0.t), b: world(s1.s, s1.t), side };
    });
    const start = at(0, 0);
    const end = at(run, 0);
    const dirW = { x: u.x * d.s + r.x * d.t, y: u.y * d.s + r.y * d.t };
    return {
      ...rc, treads, sides, risers: count, run, rise: count * a,
      zStart: f0 + baseRiser * a, zEnd: f0 + (baseRiser + count) * a,
      start: world(start.s, start.t), end: world(end.s, end.t), dir: dirW
    };
  };

  if (stair.kind === "recta") {
    const f1 = flight({ s: 0, t: 0 }, { s: 1, t: 0 }, risers[0], 0);
    out.flights.push(f1);
    let sEnd = f1.run;
    if (risers.length > 1) {
      const Ld = Math.max(w, 0.9);
      const land = rectOf(f1.run, f1.run + Ld, -w / 2, w / 2);
      out.landings.push({ ...land, z: f0 + risers[0] * a });
      const f2 = flight({ s: f1.run + Ld, t: 0 }, { s: 1, t: 0 }, risers[1], risers[0]);
      out.flights.push(f2);
      sEnd = f1.run + Ld + f2.run;
    }
    out.arrival = rectOf(sEnd, sEnd + Math.max(w, 0.9), -w / 2, w / 2);
    out.arrival.edge = [world(sEnd, -w / 2), world(sEnd, w / 2)];
  } else if (stair.kind === "L") {
    const f1 = flight({ s: 0, t: 0 }, { s: 1, t: 0 }, risers[0], 0);
    const land = rectOf(f1.run, f1.run + w, -w / 2, w / 2);
    out.landings.push({ ...land, z: f0 + risers[0] * a });
    const f2 = flight({ s: f1.run + w / 2, t: (sgn * w) / 2 }, { s: 0, t: sgn }, risers[1], risers[0]);
    out.flights.push(f1, f2);
    const tEnd = sgn * (w / 2 + f2.run);
    out.arrival = rectOf(f1.run, f1.run + w, Math.min(tEnd, tEnd + sgn * w), Math.max(tEnd, tEnd + sgn * w));
    out.arrival.edge = [world(f1.run, tEnd), world(f1.run + w, tEnd)];
  } else {
    const f1 = flight({ s: 0, t: 0 }, { s: 1, t: 0 }, risers[0], 0);
    const tFar = sgn * (w + U_GAP);
    const land = rectOf(f1.run, f1.run + w, Math.min(-sgn * w / 2, tFar + sgn * w / 2), Math.max(-sgn * w / 2, tFar + sgn * w / 2));
    out.landings.push({ ...land, z: f0 + risers[0] * a });
    const f2 = flight({ s: f1.run, t: tFar }, { s: -1, t: 0 }, risers[1], risers[0]);
    out.flights.push(f1, f2);
    const sEnd = f1.run - f2.run;
    out.arrival = rectOf(sEnd - Math.max(w, 0.9), sEnd, tFar - w / 2, tFar + w / 2);
    out.arrival.edge = [world(sEnd, tFar - w / 2), world(sEnd, tFar + w / 2)];
  }

  out.treads = out.flights.flatMap((f) => f.treads);
  out.rects = [...out.flights, ...out.landings].map(({ x0, x1, y0, y1 }) => ({ x0, x1, y0, y1 }));
  out.outline = unionOutline(out.rects);

  // Hueco en el entrepiso: todo lo que pisa más alto que (cara inferior de arriba − altura de paso)
  const zLimit = zUnder - rules.headroom;
  const needs = [...out.treads, ...out.landings].filter((e) => e.z > zLimit + 1e-6);
  out.holeRects = needs.map(({ x0, x1, y0, y1 }) => ({ x0, x1, y0, y1 }));
  // En U, el ojo entre tramos queda dentro del hueco: una tira de 10 cm de entrepiso no se puede construir
  if (stair.kind === "U" && out.flights[1]?.treads.some((t) => t.z > zLimit + 1e-6)) {
    const f1run = out.flights[0].run;
    const f2run = out.flights[1].run;
    const gap = rectOf(f1run - f2run, f1run, Math.min(sgn * w / 2, sgn * (w / 2 + U_GAP)), Math.max(sgn * w / 2, sgn * (w / 2 + U_GAP)));
    out.holeRects.push({ x0: gap.x0, x1: gap.x1, y0: gap.y0, y1: gap.y1 });
  }
  out.hole = unionOutline(out.holeRects);
  out.headroom = { zLimit, required: rules.headroom };
  out.length = Math.max(...out.rects.map((q) => Math.max(q.x1 - q.x0, q.y1 - q.y0)));
  return out;
}

/** Verificaciones geométricas de reglamento para mostrar con cumple / no cumple. */
export function stairChecks(lay) {
  const R = lay.rules;
  const checks = [];
  const add = (label, ok, detail) => checks.push({ label, ok, detail });
  const fmt = (v, d = 3) => String(round(v, d)).replace(".", ",");
  if (!lay.solution.ok) {
    add("Alzada y pedada", false, lay.solution.reason);
    return checks;
  }
  const { a, p, blondel, n } = lay.solution;
  add(`Alzada a = ${fmt(a)} m`, a <= R.aMax + 1e-9 && a >= R.aMin - 1e-9, `entre ${fmt(R.aMin, 2)} y ${fmt(R.aMax, 2)} m`);
  add(`Pedada p = ${fmt(p, 2)} m`, p >= R.pMin - 1e-9 && p <= R.pMax + 1e-9, `entre ${fmt(R.pMin, 2)} y ${fmt(R.pMax, 2)} m`);
  add(`Blondel 2a + p = ${fmt(blondel)} m`, blondel >= R.blondel[0] - 1e-9 && blondel <= R.blondel[1] + 1e-9, `entre ${fmt(R.blondel[0], 2)} y ${fmt(R.blondel[1], 2)} m`);
  add(`${n} alzadas en ${lay.risers.length} tramo${lay.risers.length > 1 ? "s" : ""} (${lay.risers.join(" + ")})`, lay.risers.every((x) => x <= R.maxRisers), `máximo ${R.maxRisers} por tramo`);
  add(`Ancho libre ${fmt(lay.stair.width, 2)} m`, lay.stair.width >= R.minWidth - 1e-9, `mínimo ${fmt(R.minWidth, 2)} m`);
  add("Escalones iguales", true, "todas las alzadas y pedadas son iguales");
  add(`Altura de paso ≥ ${fmt(R.headroom, 2)} m`, lay.hole.length > 0, lay.hole.length ? "garantizada por el hueco del entrepiso" : "falta el hueco");
  if (R.handrailBothSides) add("Pasamanos a ambos lados a 0,90 m", true, "se generan en los dos lados");
  return checks;
}
