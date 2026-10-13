// Partes descubiertas: lo que queda de un nivel sin otro nivel encima (nivel de arriba más chico,
// girado o corrido). Se agrupan en regiones conexas, se clasifican sus bordes y se elige hacia dónde
// corre el agua para que nunca vaya contra el muro del nivel de arriba.
import { differenceRects, pointInPolygon, round, unionOutline } from "./geometry.js";

export const EXPOSED_KINDS = {
  techo: "Techo a un agua",
  terraza: "Terraza transitable"
};

export const EXPOSED_DEFAULTS = { kind: "techo", slope: 10, overhang: 0.25, railing: true };

/**
 * Terraza seca sobre estructura liviana: pendiente de la membrana, paquete de terminación
 * (cuñas + fenólico + membrana + deck) y escalón mínimo bajo el piso interior para que no entre agua.
 */
export const TERRACE = { minSlope: 1, maxSlope: 2, finish: 0.07, step: 0.02 };

/**
 * Barandas de balcones y terrazas. Altura y separación habituales en códigos municipales;
 * se marcan a confirmar con el código de edificación de la localidad.
 */
export const GUARD = {
  height: 1.0,
  gap: 0.1,
  confirmed: false,
  source: "Altura 1,00 m y paso libre ≤ 0,10 m entre barrotes: criterio habitual de códigos municipales. Confirmar con el código local."
};

/** Altura mínima de la babeta de la cubierta contra el muro del nivel de arriba. */
export const FLASHING_UPSTAND = 0.15;

const DIRS = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 }
];
const tol = 1e-6;
const inRect = (p, r) => p.x > r.x0 + tol && p.x < r.x1 - tol && p.y > r.y0 + tol && p.y < r.y1 - tol;
const dotD = (p, d) => p.x * d.x + p.y * d.y;
const lexLess = (a, b) => {
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return a[i] < b[i];
  return false;
};

/** Lados de un rectángulo con su normal hacia afuera. */
function sides(r) {
  return [
    { a: { x: r.x0, y: r.y0 }, b: { x: r.x1, y: r.y0 }, n: { x: 0, y: -1 } },
    { a: { x: r.x1, y: r.y0 }, b: { x: r.x1, y: r.y1 }, n: { x: 1, y: 0 } },
    { a: { x: r.x1, y: r.y1 }, b: { x: r.x0, y: r.y1 }, n: { x: 0, y: 1 } },
    { a: { x: r.x0, y: r.y1 }, b: { x: r.x0, y: r.y0 }, n: { x: -1, y: 0 } }
  ];
}

const touching = (r, s) => {
  const ox = Math.min(r.x1, s.x1) - Math.max(r.x0, s.x0);
  const oy = Math.min(r.y1, s.y1) - Math.max(r.y0, s.y0);
  return (Math.abs(ox) < 1e-6 && oy > 1e-6) || (Math.abs(oy) < 1e-6 && ox > 1e-6);
};

/** Agrupa rectángulos que comparten un tramo de lado. */
function groupRects(rects) {
  const parent = rects.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  rects.forEach((r, i) => rects.forEach((s, j) => {
    if (j > i && touching(r, s)) parent[find(i)] = find(j);
  }));
  const groups = new Map();
  rects.forEach((r, i) => {
    const k = find(i);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  });
  return [...groups.values()];
}

/**
 * Bordes de un grupo de rectángulos, partidos en la grilla y clasificados:
 * "upper" (contra el nivel de arriba), "exterior" (borde libre sobre el muro de abajo),
 * "neighbor" (otra parte descubierta que se resolvió aparte).
 */
function classifyEdges(rects, footprint, above, grid) {
  const edges = [];
  rects.forEach((r) => {
    sides(r).forEach((sd) => {
      const horizontal = Math.abs(sd.a.y - sd.b.y) < tol;
      const lo = horizontal ? Math.min(sd.a.x, sd.b.x) : Math.min(sd.a.y, sd.b.y);
      const hi = horizontal ? Math.max(sd.a.x, sd.b.x) : Math.max(sd.a.y, sd.b.y);
      const cuts = [lo, ...(horizontal ? grid.xs : grid.ys).filter((v) => v > lo + tol && v < hi - tol), hi];
      const forward = horizontal ? sd.b.x > sd.a.x : sd.b.y > sd.a.y;
      const ordered = forward ? cuts : [...cuts].reverse();
      const at = (v) => (horizontal ? { x: v, y: sd.a.y } : { x: sd.a.x, y: v });
      let current = null;
      for (let i = 0; i + 1 < ordered.length; i += 1) {
        const p = at(ordered[i]);
        const q = at(ordered[i + 1]);
        const probe = { x: (p.x + q.x) / 2 + sd.n.x * 0.01, y: (p.y + q.y) / 2 + sd.n.y * 0.01 };
        let kind;
        if (rects.some((o) => inRect(probe, o))) kind = "internal";
        else if (pointInPolygon(probe, above)) kind = "upper";
        else if (!pointInPolygon(probe, footprint)) kind = "exterior";
        else kind = "neighbor";
        if (current && current.kind === kind) current.b = q;
        else {
          if (current) edges.push(current);
          current = { a: p, b: q, n: sd.n, kind };
        }
      }
      if (current) edges.push(current);
    });
  });
  return edges
    .filter((e) => e.kind !== "internal")
    .map((e) => ({ ...e, length: Math.hypot(e.b.x - e.a.x, e.b.y - e.a.y) }))
    .filter((e) => e.length > 1e-4);
}

/** Dirección en que corre el agua: nunca hacia el nivel de arriba; si empata, la de menor recorrido. */
function chooseDrain(rects, edges) {
  let best = null;
  DIRS.forEach((d) => {
    let bad = 0;
    let good = 0;
    edges.filter((e) => e.kind === "upper").forEach((e) => {
      const k = e.n.x * d.x + e.n.y * d.y;
      if (k > 0.5) bad += e.length;
      if (k < -0.5) good += e.length;
    });
    const ts = rects.flatMap((r) => [{ x: r.x0, y: r.y0 }, { x: r.x1, y: r.y1 }]).map((p) => dotD(p, d));
    const run = Math.max(...ts) - Math.min(...ts);
    const score = [round(bad, 4), -round(good, 4), round(run, 4)];
    if (!best || lexLess(score, best.score)) best = { d, bad, good, run, tMin: Math.min(...ts), tMax: Math.max(...ts), score };
  });
  return best;
}

function makePart(rects, footprint, above, grid, split) {
  const edges = classifyEdges(rects, footprint, above, grid);
  const drain = chooseDrain(rects, edges);
  const area = rects.reduce((s, r) => s + (r.x1 - r.x0) * (r.y1 - r.y0), 0);
  return { rects, edges, d: drain.d, run: drain.run, tMin: drain.tMin, tMax: drain.tMax, drainsToUpper: drain.bad > 1e-6, area, outline: unionOutline(rects), split };
}

/**
 * Partes descubiertas de un nivel. Cada parte es un plano único (techo a un agua o terraza).
 * Si una región no puede desaguar sin ir contra el nivel de arriba (anillo alrededor), se parte
 * en sus rectángulos y cada uno desagua por su lado.
 */
export function exposedParts(footprint, above) {
  if (!footprint || !above) return [];
  const rects = differenceRects(footprint, above);
  if (!rects.length) return [];
  const upperPoints = Array.isArray(above[0]) ? above.flat() : above;
  const grid = {
    xs: [...new Set([...footprint, ...upperPoints].map((p) => round(p.x, 4)).concat(rects.flatMap((r) => [r.x0, r.x1])))],
    ys: [...new Set([...footprint, ...upperPoints].map((p) => round(p.y, 4)).concat(rects.flatMap((r) => [r.y0, r.y1])))]
  };
  return groupRects(rects).flatMap((group) => {
    const part = makePart(group, footprint, above, grid, false);
    if (!part.drainsToUpper || group.length === 1) return [part];
    return group.map((r) => makePart([r], footprint, above, grid, true));
  });
}

/** Coordenada a lo largo del desagüe (crece hacia donde baja el agua). */
export const drainT = (part, p) => dotD(p, part.d);

/**
 * Rectángulos de la cubierta con alero en los bordes libres (no contra el nivel de arriba).
 * Se agrega el cuadrado de esquina donde dos aleros se cruzan.
 */
export function overhangRects(part, overhang, above) {
  const out = part.rects.map((r) => ({ x0: r.x0, x1: r.x1, y0: r.y0, y1: r.y1 }));
  if (!(overhang > 0)) return out;
  const ext = part.edges.filter((e) => e.kind === "exterior");
  const rectOf = (pts) => ({
    x0: Math.min(...pts.map((p) => p.x)), x1: Math.max(...pts.map((p) => p.x)),
    y0: Math.min(...pts.map((p) => p.y)), y1: Math.max(...pts.map((p) => p.y))
  });
  ext.forEach((e) => {
    const strip = rectOf([e.a, e.b, { x: e.a.x + e.n.x * overhang, y: e.a.y + e.n.y * overhang }, { x: e.b.x + e.n.x * overhang, y: e.b.y + e.n.y * overhang }]);
    const c = { x: (strip.x0 + strip.x1) / 2, y: (strip.y0 + strip.y1) / 2 };
    if (!pointInPolygon(c, above)) out.push(strip);
  });
  ext.forEach((e1, i) => ext.forEach((e2, j) => {
    if (j <= i || Math.abs(e1.n.x * e2.n.x + e1.n.y * e2.n.y) > 1e-6) return;
    const shared = [e1.a, e1.b].find((p) => [e2.a, e2.b].some((q) => Math.hypot(p.x - q.x, p.y - q.y) < 1e-6));
    if (!shared) return;
    const far = { x: shared.x + (e1.n.x + e2.n.x) * overhang, y: shared.y + (e1.n.y + e2.n.y) * overhang };
    const sq = rectOf([shared, far]);
    const c = { x: (sq.x0 + sq.x1) / 2, y: (sq.y0 + sq.y1) / 2 };
    if (!pointInPolygon(c, above) && !part.rects.some((r) => inRect(c, r))) out.push(sq);
  }));
  return out;
}
