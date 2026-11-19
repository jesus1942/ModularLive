// Láminas de arquitectura a escala: plantas, planta de techos, cortes, vistas y planillas.
// Todo sale del mismo modelo y de las mismas piezas que el 3D y el cómputo: si el diseño cambia,
// los planos cambian. Cada lámina es un SVG en milímetros de papel (formato IRAM 4504, A3 apaisado).
import { pointInPolygon, wallDir, wallLength } from "./geometry.js";
import { doorLeaf, levelFootprints } from "./model.js";
import { FOUNDATIONS, PROFILES, ROOF_TYPES, SHEETS, SYSTEMS } from "./catalog.js";

export const PAPER = { w: 420, h: 297, left: 25, margin: 10 }; // A3 apaisado, margen de encuadernación a la izquierda
const TITLE = { w: 175, h: 46 }; // rótulo
const SCALES = [50, 75, 100, 125, 150, 200, 250, 500];
const WALL_T = { exterior: 0.14, interior: 0.1 };
const SKIN = 0.065; // de eje de muro a cara

export const SHEET_DEFAULTS = {
  obra: "",
  comitente: "",
  ubicacion: "",
  localidad: "",
  provincia: "",
  catastro: "",
  profesional: "",
  matricula: "",
  fecha: "",
  north: 0 // grados: 0 = el norte apunta hacia arriba de la planta
};

export function normalizeSheet(raw) {
  const out = { ...SHEET_DEFAULTS };
  Object.keys(SHEET_DEFAULTS).forEach((k) => {
    if (k === "north") out.north = Number.isFinite(Number(raw?.north)) ? ((Number(raw.north) % 360) + 360) % 360 : 0;
    else out[k] = String(raw?.[k] ?? "").slice(0, 90);
  });
  return out;
}

// ---------- utilidades ----------
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const f2 = (v) => (Math.abs(v) < 5e-4 ? 0 : v).toFixed(2).replace(".", ",");
const r2 = (v) => Math.round(v * 100) / 100;
const mm = (v) => r2(v);
const uniq = (list, tol = 1e-3) => [...list].sort((a, b) => a - b).filter((v, i, arr) => i === 0 || v - arr[i - 1] > tol);
const levelSign = (z) => `${z > 5e-4 ? "+" : z < -5e-4 ? "−" : "±"}${f2(Math.abs(z))}`;

const line = (a, b, cls) => `<line x1="${mm(a[0])}" y1="${mm(a[1])}" x2="${mm(b[0])}" y2="${mm(b[1])}" class="${cls}"/>`;
const text = (p, s, cls, extra = "") => `<text x="${mm(p[0])}" y="${mm(p[1])}" class="${cls}"${extra}>${esc(s)}</text>`;
const pathOf = (loops) => loops.map((loop) => `M ${loop.map((p) => `${mm(p[0])} ${mm(p[1])}`).join(" L ")} Z`).join(" ");
const poly = (loops, cls) => `<path d="${pathOf(loops)}" class="${cls}" fill-rule="evenodd"/>`;

/** Elige la escala normalizada más grande que entra en la celda y devuelve el pasaje de metros a papel. */
function fit(cell, bb, pad) {
  const w = Math.max(bb.maxU - bb.minU, 0.01);
  const h = Math.max(bb.maxV - bb.minV, 0.01);
  const availW = cell.w - pad.l - pad.r;
  const availH = cell.h - pad.t - pad.b;
  const scale = SCALES.find((s) => (w * 1000) / s <= availW && (h * 1000) / s <= availH) ?? SCALES[SCALES.length - 1];
  const k = 1000 / scale;
  const ox = cell.x + pad.l + (availW - w * k) / 2 - bb.minU * k;
  const oy = cell.y + pad.t + (availH - h * k) / 2 - bb.minV * k;
  return { scale, k, map: (u, v) => [ox + u * k, oy + v * k] };
}

/** Cadena de cotas sobre una recta horizontal ("h") o vertical ("v"), a off mm del borde. */
function dimChain(view, axis, coords, base, off, { total = false } = {}) {
  const pts = uniq(coords);
  if (pts.length < 2) return "";
  const out = [];
  const at = (c) => (axis === "h" ? view.map(c, base) : view.map(base, c));
  const shift = (p) => (axis === "h" ? [p[0], p[1] + off] : [p[0] + off, p[1]]);
  const list = total ? [pts[0], pts[pts.length - 1]] : pts;
  const first = shift(at(list[0]));
  const last = shift(at(list[list.length - 1]));
  out.push(line(first, last, "dim"));
  list.forEach((c) => {
    const p = at(c);
    const q = shift(p);
    const gap = off > 0 ? 2 : -2;
    out.push(line(axis === "h" ? [p[0], p[1] + gap] : [p[0] + gap, p[1]], axis === "h" ? [q[0], q[1] + Math.sign(off) * 1.2] : [q[0] + Math.sign(off) * 1.2, q[1]], "dim"));
    out.push(line([q[0] - 0.9, q[1] + 0.9], [q[0] + 0.9, q[1] - 0.9], "dim-tick"));
  });
  for (let i = 0; i + 1 < list.length; i += 1) {
    const a = shift(at(list[i]));
    const b = shift(at(list[i + 1]));
    const len = list[i + 1] - list[i];
    const paper = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (paper < 3.2) continue; // no entra el número: queda la marca
    const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    out.push(axis === "h"
      ? text([m[0], m[1] - 0.8], f2(len), paper < 7 ? "dim-text dim-text--small" : "dim-text")
      : text([m[0] - 0.8, m[1]], f2(len), paper < 7 ? "dim-text dim-text--small" : "dim-text", ` transform="rotate(-90 ${mm(m[0] - 0.8)} ${mm(m[1])})"`));
  }
  return out.join("");
}

/** Marca de nivel: triángulo, cota y nombre, sobre una línea de referencia. */
function levelMark(view, u, z, label, side = 1) {
  const p = view.map(u, -z);
  const x = p[0] + side * 4;
  return `${line([p[0], p[1]], [x + side * 16, p[1]], "ref")}
    <path d="M ${mm(x)} ${mm(p[1])} l ${-1.6} ${-2.6} l 3.2 0 Z" class="mark"/>
    ${text([x + side * 2.4 + (side < 0 ? -1 : 1), p[1] - 1], `${levelSign(z)}${label ? `  ${label}` : ""}`, side < 0 ? "note note--end" : "note")}`;
}

// ---------- tipos de aberturas ----------
/** Códigos V1, V2… y P1, P2… por medida (y mano en puertas), para planta, vistas y planilla. */
export function openingTypes(project) {
  const types = new Map();
  project.levels.forEach((level) =>
    level.walls.forEach((w) =>
      w.openings.forEach((o) => {
        const hand = o.kind === "door" ? doorLeaf(w, o).hand : "";
        const key = `${o.kind}|${r2(o.width)}|${r2(o.height)}|${o.kind === "door" ? hand : r2(o.sill)}`;
        const t = types.get(key) ?? { kind: o.kind, width: o.width, height: o.height, sill: o.sill, hand, count: 0, ids: [] };
        t.count += 1;
        t.ids.push(o.id);
        types.set(key, t);
      })
    )
  );
  const sorted = [...types.values()].sort((a, b) => (a.kind === b.kind ? b.width * b.height - a.width * a.height || b.sill - a.sill : a.kind === "door" ? -1 : 1));
  let d = 0;
  let v = 0;
  const byOpening = new Map();
  sorted.forEach((t) => {
    t.code = t.kind === "door" ? `P${(d += 1)}` : `V${(v += 1)}`;
    t.ids.forEach((id) => byOpening.set(id, t.code));
  });
  return { list: sorted, byOpening };
}

// ---------- geometría del conjunto ----------
function extents(project, gen) {
  const pts = [];
  project.levels.forEach((l) => l.walls.forEach((w) => pts.push(w.a, w.b)));
  gen.surfaces.filter((s) => s.material === "cubierta" || s.material === "balcon").forEach((s) => s.points.forEach(([x, y]) => pts.push({ x, y })));
  if (!pts.length) return { minX: 0, maxX: 1, minY: 0, maxY: 1 };
  return { minX: Math.min(...pts.map((p) => p.x)), maxX: Math.max(...pts.map((p) => p.x)), minY: Math.min(...pts.map((p) => p.y)), maxY: Math.max(...pts.map((p) => p.y)) };
}

function wallBox(project) {
  const pts = project.levels.flatMap((l) => l.walls.flatMap((w) => [w.a, w.b]));
  if (!pts.length) return { minX: 0, maxX: 1, minY: 0, maxY: 1 };
  return { minX: Math.min(...pts.map((p) => p.x)), maxX: Math.max(...pts.map((p) => p.x)), minY: Math.min(...pts.map((p) => p.y)), maxY: Math.max(...pts.map((p) => p.y)) };
}

/** Planos de corte: A-A transversal y B-B longitudinal, corridos si caen justo sobre un tabique. */
export function sectionPlanes(project) {
  const bb = wallBox(project);
  const walls = project.levels.flatMap((l) => l.walls);
  const clear = (axis, c) => !walls.some((w) => Math.abs(w.a[axis] - c) < 0.12 && Math.abs(w.b[axis] - c) < 0.12);
  const pick = (axis, lo, hi) => {
    const mid = (lo + hi) / 2;
    return [0, 0.35, -0.35, 0.7, -0.7].map((d) => mid + d).find((c) => c > lo + 0.3 && c < hi - 0.3 && clear(axis, c)) ?? mid;
  };
  return {
    A: { name: "A", axis: "x", c: pick("x", bb.minX, bb.maxX) },
    B: { name: "B", axis: "y", c: pick("y", bb.minY, bb.maxY) }
  };
}

/** Lado del frente: el que tiene más puertas (después, más aberturas); si empata, el de y máximo. */
export function frontSide(project) {
  const bb = wallBox(project);
  const sides = [
    { n: { x: 0, y: 1 }, on: (w) => Math.abs(w.a.y - bb.maxY) < 0.02 && Math.abs(w.b.y - bb.maxY) < 0.02 },
    { n: { x: 0, y: -1 }, on: (w) => Math.abs(w.a.y - bb.minY) < 0.02 && Math.abs(w.b.y - bb.minY) < 0.02 },
    { n: { x: 1, y: 0 }, on: (w) => Math.abs(w.a.x - bb.maxX) < 0.02 && Math.abs(w.b.x - bb.maxX) < 0.02 },
    { n: { x: -1, y: 0 }, on: (w) => Math.abs(w.a.x - bb.minX) < 0.02 && Math.abs(w.b.x - bb.minX) < 0.02 }
  ];
  const walls = project.levels.flatMap((l) => l.walls.filter((w) => w.type === "exterior"));
  const score = (s) => walls.filter(s.on).reduce((sum, w) => sum + w.openings.reduce((k, o) => k + (o.kind === "door" ? 100 : 1), 0), 0);
  return sides.map((s) => ({ ...s, score: score(s) })).sort((a, b) => b.score - a.score)[0].n;
}

/** Alero del techo: un valor si es igual en todo el contorno, si no uno por lado de la planta. */
function aleroText(roof) {
  const o = roof.overhangs;
  if (!o) return `alero ${f2(roof.overhang)} m`;
  const v = [o.arriba, o.abajo, o.izquierda, o.derecha];
  if (v.every((x) => Math.abs(x - v[0]) < 1e-6)) return v[0] > 0 ? `alero ${f2(v[0])} m` : "sin alero";
  return `alero ${[["arriba", o.arriba], ["abajo", o.abajo], ["izq.", o.izquierda], ["der.", o.derecha]].map(([k, x]) => `${k} ${f2(x)}`).join(" · ")} m`;
}

// ---------- planta ----------
function planView(project, gen, li, cell, types, planes, { showSections = true } = {}) {
  const level = project.levels[li];
  const info = gen.levels[li];
  const bbAll = wallBox(project);
  const pts = level.walls.flatMap((w) => [w.a, w.b]);
  const balconies = info?.balconies ?? [];
  balconies.forEach((b) => b.poly?.forEach((p) => pts.push(p)));
  // contorno de los muros: sobre él se miden las cotas
  const wp = level.walls.flatMap((w) => [w.a, w.b]);
  const wb = wp.length
    ? { minU: Math.min(...wp.map((p) => p.x)), maxU: Math.max(...wp.map((p) => p.x)), minV: Math.min(...wp.map((p) => p.y)), maxV: Math.max(...wp.map((p) => p.y)) }
    : null;
  // las escaleras exteriores también entran en el dibujo
  (gen.stairs ?? []).filter((lay) => lay.level === li && lay.solution?.ok).forEach((lay) => lay.rects.forEach((r) => pts.push({ x: r.x0, y: r.y0 }, { x: r.x1, y: r.y1 })));
  const bb = pts.length
    ? { minU: Math.min(...pts.map((p) => p.x)), maxU: Math.max(...pts.map((p) => p.x)), minV: Math.min(...pts.map((p) => p.y)), maxV: Math.max(...pts.map((p) => p.y)) }
    : { minU: bbAll.minX, maxU: bbAll.maxX, minV: bbAll.minY, maxV: bbAll.maxY };
  const view = fit(cell, bb, { l: 36, r: 36, t: 28, b: 32 });
  const M = (p) => view.map(p.x, p.y);
  const out = [];

  // superficie cubierta en gris muy claro
  levelFootprints(info).forEach((fp) => out.push(poly([fp.map(M)], "floor")));

  // proyección del alero o del nivel de arriba (línea de trazos)
  gen.surfaces.filter((s) => s.material === "cubierta" && s.level === li).forEach((s) => out.push(poly([s.points.map(([x, y]) => view.map(x, y))], "proj")));

  // vacíos y huecos del entrepiso
  (info?.holes ?? []).forEach((loop) => {
    const P = loop.map(M);
    out.push(poly([P], "hole"));
    const xs = P.map((p) => p[0]), ys = P.map((p) => p[1]);
    const isVoid = (level.voids ?? []).some((v) => loop.every((p) => p.x >= v.x0 - 0.01 && p.x <= v.x1 + 0.01 && p.y >= v.y0 - 0.01 && p.y <= v.y1 + 0.01));
    if (isVoid && loop.length === 4) out.push(line(P[0], P[2], "thin"), line(P[1], P[3], "thin"));
    out.push(text([(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2], isVoid ? "VACÍO · DOBLE ALTURA" : "HUECO DE ESCALERA", "label label--halo"));
  });

  // escaleras que arrancan en este nivel
  (gen.stairs ?? []).filter((lay) => lay.level === li && lay.solution?.ok).forEach((lay) => {
    lay.outline.forEach((loop) => out.push(poly([loop.map(M)], "stair")));
    lay.treads.forEach((t) => out.push(poly([t.poly.map(M)], "thin-shape")));
    lay.landings.forEach((l) => out.push(poly([l.poly.map(M)], "thin-shape")));
    const path = [];
    lay.flights.forEach((f, i) => {
      if (i === 0) path.push(f.start);
      path.push(f.end);
      if (lay.flights[i + 1]) path.push(lay.flights[i + 1].start);
    });
    const P = path.map(M);
    out.push(`<polyline points="${P.map((p) => `${mm(p[0])},${mm(p[1])}`).join(" ")}" class="thin-line"/>`);
    const tip = P[P.length - 1], prev = P[P.length - 2];
    const ang = Math.atan2(tip[1] - prev[1], tip[0] - prev[0]);
    out.push(`<path d="M ${mm(tip[0])} ${mm(tip[1])} L ${mm(tip[0] - 2.4 * Math.cos(ang - 0.4))} ${mm(tip[1] - 2.4 * Math.sin(ang - 0.4))} L ${mm(tip[0] - 2.4 * Math.cos(ang + 0.4))} ${mm(tip[1] - 2.4 * Math.sin(ang + 0.4))} Z" class="mark"/>`);
    out.push(`<circle cx="${mm(P[0][0])}" cy="${mm(P[0][1])}" r="0.7" class="mark"/>`);
    const f0 = lay.flights[0];
    const mid = M({ x: (f0.start.x + f0.end.x) / 2, y: (f0.start.y + f0.end.y) / 2 });
    out.push(text([mid[0], mid[1] - 1.6], `SUBE ${lay.solution.n} alz. de ${f2(lay.solution.a)} · ped. ${f2(lay.solution.p)}${lay.exterior ? " · EXTERIOR" : ""}`, "label label--halo"));
  });

  // balcones
  balconies.forEach((b) => {
    if (!b.poly) return;
    const P = b.poly.map(M);
    out.push(poly([P], "balcony"));
    if (b.rails) b.rails.forEach(([a, c]) => out.push(`<polyline points="${[M(a), M(c)].map((p) => `${mm(p[0])},${mm(p[1])}`).join(" ")}" class="rail"/>`));
    else out.push(`<polyline points="${[P[1], P[2], P[3], P[0]].map((p) => `${mm(p[0])},${mm(p[1])}`).join(" ")}" class="rail"/>`);
    out.push(text([(P[0][0] + P[2][0]) / 2, (P[0][1] + P[2][1]) / 2], "BALCÓN", "label"));
  });

  // muros cortados (lleno) con sus aberturas
  level.walls.forEach((w) => {
    const L = wallLength(w);
    const d = wallDir(w);
    const n = { x: -d.y, y: d.x };
    const t = WALL_T[w.type] / 2;
    const at = (s, k) => M({ x: w.a.x + d.x * s + n.x * k, y: w.a.y + d.y * s + n.y * k });
    const spans = [...w.openings].sort((a, b) => a.offset - b.offset);
    let cursor = -t;
    const solid = [];
    spans.forEach((o) => {
      if (o.offset > cursor) solid.push([cursor, o.offset]);
      cursor = o.offset + o.width;
    });
    if (L + t > cursor) solid.push([cursor, L + t]);
    solid.forEach(([s0, s1]) => out.push(poly([[at(s0, -t), at(s1, -t), at(s1, t), at(s0, t)]], w.type === "exterior" ? "wall" : "wall wall--int")));
    spans.forEach((o) => {
      const s0 = o.offset, s1 = o.offset + o.width;
      out.push(line(at(s0, -t), at(s0, t), "thin"), line(at(s1, -t), at(s1, t), "thin"));
      if (o.kind === "window") {
        out.push(line(at(s0, -t), at(s1, -t), "thin"), line(at(s0, t), at(s1, t), "thin"), line(at(s0, 0), at(s1, 0), "med"));
      } else {
        const leaf = doorLeaf(w, o);
        const H = M(leaf.hingePt), T = M(leaf.tip), F = M(leaf.freePt);
        const r = o.width * view.k;
        const sweep = (T[0] - H[0]) * (F[1] - H[1]) - (T[1] - H[1]) * (F[0] - H[0]) > 0 ? 1 : 0;
        out.push(line(H, T, "med"), `<path d="M ${mm(T[0])} ${mm(T[1])} A ${mm(r)} ${mm(r)} 0 0 ${sweep} ${mm(F[0])} ${mm(F[1])}" class="arc"/>`);
      }
      // código de la abertura, del lado interior
      const fp = levelFootprints(info).find((p) => pointInPolygon({ x: w.a.x + d.x * (s0 + s1) / 2 + n.x * 0.3, y: w.a.y + d.y * (s0 + s1) / 2 + n.y * 0.3 }, p));
      const side = w.type === "exterior" ? (fp ? 1 : -1) : 1;
      let c = at((s0 + s1) / 2, side * (t + 3.4 / view.k));
      if (o.kind === "door") {
        // dentro del barrido de la hoja, donde no pisa cotas ni muros
        const leaf = doorLeaf(w, o);
        const k = 0.42 * o.width;
        c = M({ x: leaf.hingePt.x + (leaf.freePt.x - leaf.hingePt.x) * 0.42 + leaf.out.x * k, y: leaf.hingePt.y + (leaf.freePt.y - leaf.hingePt.y) * 0.42 + leaf.out.y * k });
      }
      out.push(`<circle cx="${mm(c[0])}" cy="${mm(c[1])}" r="2.3" class="tag"/>`, text([c[0], c[1] + 0.75], types.byOpening.get(o.id) ?? "", "tag-text"));
    });
  });

  // columnas
  (info?.columns ?? []).forEach((p) => {
    const c = M(p);
    const s = Math.max(0.1 * view.k, 1.2);
    out.push(`<rect x="${mm(c[0] - s / 2)}" y="${mm(c[1] - s / 2)}" width="${mm(s)}" height="${mm(s)}" class="col"/>`);
  });

  // cotas: aberturas y tramos por lado, y total
  const ext = level.walls.filter((w) => w.type === "exterior");
  const sideCoords = (axis, value) => {
    const other = axis === "x" ? "y" : "x";
    const coords = [];
    ext.filter((w) => Math.abs(w.a[other] - value) < 0.02 && Math.abs(w.b[other] - value) < 0.02).forEach((w) => {
      const d = wallDir(w);
      coords.push(w.a[axis], w.b[axis]);
      w.openings.forEach((o) => coords.push(w.a[axis] + d[axis] * o.offset, w.a[axis] + d[axis] * (o.offset + o.width)));
    });
    return coords;
  };
  if (ext.length) {
    const allX = ext.flatMap((w) => [w.a.x, w.b.x]);
    const allY = ext.flatMap((w) => [w.a.y, w.b.y]);
    [[bb.maxV, 1, wb.maxV], [bb.minV, -1, wb.minV]].forEach(([v, sgn, wv]) => {
      const c = uniq(sideCoords("x", wv));
      // si el lado no tiene aberturas ni quiebres, alcanza con la cota total
      if (c.length > 2) out.push(dimChain(view, "h", c, v, sgn * 8), dimChain(view, "h", allX, v, sgn * 15, { total: true }));
      else out.push(dimChain(view, "h", allX, v, sgn * 8, { total: true }));
    });
    [[bb.minU, -1, wb.minU], [bb.maxU, 1, wb.maxU]].forEach(([u, sgn, wu]) => {
      const c = uniq(sideCoords("y", wu));
      if (c.length > 2) out.push(dimChain(view, "v", c, u, sgn * 8), dimChain(view, "v", allY, u, sgn * 15, { total: true }));
      else out.push(dimChain(view, "v", allY, u, sgn * 8, { total: true }));
    });
  }
  // tabiques: cota de posición respecto del contorno
  level.walls.filter((w) => w.type === "interior").forEach((w) => {
    const vertical = Math.abs(w.a.x - w.b.x) < 1e-6;
    const horizontal = Math.abs(w.a.y - w.b.y) < 1e-6;
    if (vertical) out.push(dimChain(view, "h", [wb.minU, w.a.x], Math.min(w.a.y, w.b.y) + 0.45, 0.01));
    else if (horizontal) out.push(dimChain(view, "v", [wb.minV, w.a.y], Math.min(w.a.x, w.b.x) + 0.45, 0.01));
  });

  // nivel de piso terminado
  if (info && pts.length) {
    const c = view.map((wb ?? bb).minU + 0.55, (wb ?? bb).maxV - 0.45);
    out.push(`<path d="M ${mm(c[0])} ${mm(c[1])} l -1.6 -2.6 l 3.2 0 Z" class="mark"/>`, text([c[0] + 2.4, c[1] - 0.6], `N.P.T. ${levelSign(info.floorTop)}`, "note"));
  }

  // marcas de corte
  if (showSections && pts.length) {
    const mark = (plane) => {
      const a = plane.axis === "x" ? view.map(plane.c, bb.minV) : view.map(bb.minU, plane.c);
      const b = plane.axis === "x" ? view.map(plane.c, bb.maxV) : view.map(bb.maxU, plane.c);
      const ext1 = plane.axis === "x" ? [a[0], a[1] - 22] : [a[0] - 25, a[1]];
      const ext2 = plane.axis === "x" ? [b[0], b[1] + 22] : [b[0] + 25, b[1]];
      // el corte mira hacia las coordenadas menores
      const look = plane.axis === "x" ? [-4, 0] : [0, -4];
      const head = (p) => `${line(p, [p[0] + look[0], p[1] + look[1]], "cut-arrow")}<path d="M ${mm(p[0] + look[0] * 1.5)} ${mm(p[1] + look[1] * 1.5)} L ${mm(p[0] + look[0] + look[1] * 0.3)} ${mm(p[1] + look[1] + look[0] * 0.3)} L ${mm(p[0] + look[0] - look[1] * 0.3)} ${mm(p[1] + look[1] - look[0] * 0.3)} Z" class="mark"/>`;
      const label = (p, outward) => text(plane.axis === "x" ? [p[0] + 3, p[1] + 1.5] : [p[0] + outward * 3.4, p[1] + 1.5], plane.name, "cut-text");
      return `${line(ext1, [ext1[0] + (plane.axis === "x" ? 0 : 6), ext1[1] + (plane.axis === "x" ? 6 : 0)], "cut")}${line(ext2, [ext2[0] - (plane.axis === "x" ? 0 : 6), ext2[1] - (plane.axis === "x" ? 6 : 0)], "cut")}${line(ext1, ext2, "cut-axis")}${head(ext1)}${head(ext2)}${label(ext1, -1)}${label(ext2, 1)}`;
    };
    out.push(mark(planes.A), mark(planes.B));
  }
  return { svg: out.join(""), scale: view.scale };
}

// ---------- planta de techos ----------
function roofView(project, gen, cell) {
  const e = extents(project, gen);
  const view = fit(cell, { minU: e.minX, maxU: e.maxX, minV: e.minY, maxV: e.maxY }, { l: 26, r: 26, t: 22, b: 26 });
  const out = [];
  project.levels.forEach((_, li) => levelFootprints(gen.levels[li]).forEach((fp) => out.push(poly([fp.map((p) => view.map(p.x, p.y))], "proj"))));
  const tops = [...gen.surfaces.filter((s) => s.material === "cubierta")].sort((a, b) => Math.min(...a.points.map((p) => p[2])) - Math.min(...b.points.map((p) => p[2])));
  tops.forEach((s) => {
    const P = s.points.map(([x, y]) => view.map(x, y));
    const terrace = s.access === "terraza";
    out.push(poly([P], terrace ? "roof roof--terrace" : "roof"));
    // dirección de caída: gradiente del plano de la cubierta
    const [p0, p1, p2] = s.points;
    const ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2];
    const vx = p2[0] - p0[0], vy = p2[1] - p0[1], vz = p2[2] - p0[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const cx = s.points.reduce((sum, p) => sum + p[0], 0) / s.points.length;
    const cy = s.points.reduce((sum, p) => sum + p[1], 0) / s.points.length;
    const c = view.map(cx, cy);
    const zs = s.points.map((p) => p[2]);
    if (Math.abs(nz) > 1e-9 && Math.hypot(nx, ny) / Math.abs(nz) > 1e-4) {
      // el plano sube en la dirección (−nx/nz, −ny/nz): el agua corre al revés
      const gx = nx / nz, gy = ny / nz, g = Math.hypot(gx, gy);
      const dx = gx / g, dy = gy / g;
      const a = [c[0] - dx * 9, c[1] - dy * 9], b = [c[0] + dx * 9, c[1] + dy * 9];
      const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
      out.push(line(a, b, "med"), `<path d="M ${mm(b[0])} ${mm(b[1])} L ${mm(b[0] - 2.6 * Math.cos(ang - 0.4))} ${mm(b[1] - 2.6 * Math.sin(ang - 0.4))} L ${mm(b[0] - 2.6 * Math.cos(ang + 0.4))} ${mm(b[1] - 2.6 * Math.sin(ang + 0.4))} Z" class="mark"/>`);
      // el texto va al costado de la flecha, no encima
      const side = Math.abs(dy) > Math.abs(dx) ? [14, 0] : [0, -5];
      out.push(text([c[0] + side[0], c[1] + side[1] + 0.8], `${terrace ? "TERRAZA · " : ""}p = ${f2(g * 100).replace(/,00$/, "")} %`, "label label--halo"));
    } else out.push(text(c, terrace ? "TERRAZA" : "CUBIERTA PLANA", "label label--halo"));
    out.push(text([c[0], c[1] + 15], `${f2(Math.abs(areaXY(s.points)))} m² en planta · de ${levelSign(Math.max(...zs))} a ${levelSign(Math.min(...zs))}`, "note note--mid"));
  });
  gen.surfaces.filter((s) => s.material === "balcon").forEach((s) => out.push(poly([s.points.map(([x, y]) => view.map(x, y))], "balcony")));
  // contorno de los muros bajo la cubierta, en línea de trazos
  const topLevel = gen.levels[gen.levels.length - 1];
  levelFootprints(topLevel).forEach((fp) => out.push(poly([fp.map((p) => view.map(p.x, p.y))], "proj")));
  out.push(dimChain(view, "h", [e.minX, e.maxX], e.maxY, 8), dimChain(view, "v", [e.minY, e.maxY], e.minX, -8));
  return { svg: out.join(""), scale: view.scale };
}

function areaXY(points) {
  let sum = 0;
  points.forEach((p, i) => {
    const q = points[(i + 1) % points.length];
    sum += p[0] * q[1] - q[0] * p[1];
  });
  return sum / 2;
}

// ---------- proyecciones (vistas y cortes) ----------
/** Ejes de una proyección vista desde afuera según la normal n: u hacia la derecha del observador. */
const axes = (n) => ({ n, u: { x: n.y, y: -n.x } });
const proj = (ax, p) => [p[0] * ax.u.x + p[1] * ax.u.y, -p[2]];
const depthOf = (ax, p) => p[0] * ax.n.x + p[1] * ax.n.y;

function solidBoxes(solid) {
  // cada sólido como caja alineada a los ejes: [minX, maxX, minY, maxY, minZ, maxZ]
  if (solid.shape === "cylinder") {
    const [x, y, z] = solid.center;
    return [x - solid.r, x + solid.r, y - solid.r, y + solid.r, z - solid.h / 2, z + solid.h / 2];
  }
  if (solid.shape === "prism") {
    const xs = solid.polygon.map((p) => p.x), ys = solid.polygon.map((p) => p.y);
    return [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys), solid.z0, solid.z1];
  }
  const { a, b, w, h } = solid;
  if (solid.vertical) return [a[0] - w / 2, a[0] + w / 2, a[1] - h / 2, a[1] + h / 2, Math.min(a[2], b[2]), Math.max(a[2], b[2])];
  const alongX = Math.abs(b[0] - a[0]) >= Math.abs(b[1] - a[1]);
  return alongX
    ? [Math.min(a[0], b[0]), Math.max(a[0], b[0]), a[1] - w / 2, a[1] + w / 2, a[2] - h / 2, a[2] + h / 2]
    : [a[0] - w / 2, a[0] + w / 2, Math.min(a[1], b[1]), Math.max(a[1], b[1]), a[2] - h / 2, a[2] + h / 2];
}

/** Banda vertical de una barra (cabio, cenefa, zanca): su eje con el alto de la sección. */
const memberQuad = (m) => [[m.a[0], m.a[1], m.a[2] - m.h / 2], [m.b[0], m.b[1], m.b[2] - m.h / 2], [m.b[0], m.b[1], m.b[2] + m.h / 2], [m.a[0], m.a[1], m.a[2] + m.h / 2]];

function boundsOf(items) {
  const pts = items.flatMap((it) => it.loops.flat());
  return { minU: Math.min(...pts.map((p) => p[0])), maxU: Math.max(...pts.map((p) => p[0])), minV: Math.min(...pts.map((p) => p[1])), maxV: Math.max(...pts.map((p) => p[1])) };
}

/** Polígonos de fachada ordenados de lejos a cerca: los de adelante tapan a los de atrás. */
function elevationItems(gen, ax) {
  const items = [];
  const push = (pts3, cls, holes = [], bias = 0) => {
    const loops = [pts3.map((p) => proj(ax, p)), ...holes.map((h) => h.map((p) => proj(ax, p)))];
    if (Math.abs(areaXY(loops[0])) < 1e-4) return; // de canto: no se ve
    items.push({ loops, cls, depth: pts3.reduce((sum, p) => sum + depthOf(ax, p), 0) / pts3.length + bias });
  };
  gen.surfaces.forEach((s) => {
    if (s.material === "exterior") push(s.points, "el-wall", s.holes);
    else if (s.material === "vidrio") push(s.points, "el-glass", [], 0.02);
    else if (s.material === "puerta") push(s.points, "el-door", [], 0.02);
    else if (s.material === "cubierta") push(s.points, "el-roof");
    else if (s.material === "volado") push(s.points, "el-wall");
  });
  // escaleras exteriores: se ven en las fachadas
  const outside = (level, x, y) => {
    const polys = levelFootprints(gen.levels[level]);
    return polys.length > 0 && !polys.some((poly) => pointInPolygon({ x, y }, poly));
  };
  gen.surfaces.filter((s) => s.material === "escalon").forEach((s) => {
    const cx = s.points.reduce((sum, p) => sum + p[0], 0) / s.points.length;
    const cy = s.points.reduce((sum, p) => sum + p[1], 0) / s.points.length;
    if (!outside(s.level, cx, cy)) return;
    const us = s.points.map((p) => proj(ax, p)[0]);
    const z = s.points[0][2];
    items.push({ loops: [[[Math.min(...us), -z], [Math.max(...us), -z], [Math.max(...us), -z + 0.04], [Math.min(...us), -z + 0.04]]], cls: "el-edge", depth: s.points.reduce((sum, p) => sum + depthOf(ax, p), 0) / s.points.length });
  });
  gen.members.forEach((m) => {
    if (m.layer === "escaleras" && outside(m.level, (m.a[0] + m.b[0]) / 2, (m.a[1] + m.b[1]) / 2)) {
      if (["stairStringer", "landingFrame"].includes(m.role)) push(memberQuad(m), "el-edge", [], 0.01);
      else {
        const a = proj(ax, m.a), b = proj(ax, m.b);
        if (Math.hypot(a[0] - b[0], a[1] - b[1]) > 0.02) items.push({ loops: [[a, b]], cls: m.role === "handrail" || m.role === "landingPost" ? "el-rail" : "el-bar", line: true, depth: (depthOf(ax, m.a) + depthOf(ax, m.b)) / 2 + 0.05 });
      }
      return;
    }
    if (["rafter", "roofEdge", "ridge"].includes(m.role)) push(memberQuad(m), "el-edge");
    else if (m.layer === "balcones" && m.role !== "floorJoist") {
      const a = proj(ax, m.a), b = proj(ax, m.b);
      if (Math.hypot(a[0] - b[0], a[1] - b[1]) > 0.02) items.push({ loops: [[a, b]], cls: m.role === "handrail" ? "el-rail" : "el-bar", line: true, depth: (depthOf(ax, m.a) + depthOf(ax, m.b)) / 2 + 0.05 });
      else if (m.role === "landingPost" || m.role === "railPost") push(memberQuad({ ...m, h: m.w }), "el-edge");
    }
  });
  gen.solids.forEach((sd) => {
    const [x0, x1, y0, y1, z0, z1] = solidBoxes(sd);
    const us = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(([x, y]) => x * ax.u.x + y * ax.u.y);
    const u0 = Math.min(...us), u1 = Math.max(...us);
    const d = Math.max(...[[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(([x, y]) => x * ax.n.x + y * ax.n.y));
    if (z1 > 0.001) items.push({ loops: [[[u0, -Math.max(z0, 0)], [u1, -Math.max(z0, 0)], [u1, -z1], [u0, -z1]]], cls: "el-conc", depth: d });
    if (z0 < -0.001) items.push({ loops: [[[u0, -z0], [u1, -z0], [u1, -Math.min(z1, 0)], [u0, -Math.min(z1, 0)]]], cls: "el-hidden", depth: d - 100 });
  });
  return items.sort((a, b) => a.depth - b.depth);
}

function drawItems(items, view) {
  return items.map((it) => {
    const loops = it.loops.map((loop) => loop.map(([u, v]) => view.map(u, v)));
    return it.line ? line(loops[0][0], loops[0][1], it.cls) : poly(loops, it.cls);
  }).join("");
}

function levelMarks(gen, view, u, side, names = true) {
  const out = [levelMark(view, u, 0, names ? "N.T." : "", side)];
  gen.levels.forEach((l) => out.push(levelMark(view, u, l.floorTop, names ? `N.P.T. ${l.name}` : "", side)));
  const top = Math.max(...gen.surfaces.filter((s) => s.material === "cubierta").flatMap((s) => s.points.map((p) => p[2])), gen.levels[gen.levels.length - 1]?.zTop ?? 0);
  out.push(levelMark(view, u, top, names ? "Cumbrera" : "", side));
  return out.join("");
}

function elevationView(gen, n, cell) {
  const ax = axes(n);
  const items = elevationItems(gen, ax);
  if (!items.length) return { svg: "", scale: 100 };
  const bb = boundsOf(items);
  bb.maxV = Math.max(bb.maxV, 0.05);
  const view = fit(cell, bb, { l: 8, r: 34, t: 8, b: 14 });
  const g0 = view.map(bb.minU - 0.6, 0), g1 = view.map(bb.maxU + 0.6, 0);
  return {
    svg: `${drawItems(items, view)}${line(g0, g1, "ground")}${levelMarks(gen, view, bb.maxU + 0.25, 1)}`,
    scale: view.scale
  };
}

/** Puntos donde un polígono 3D (con agujeros) cruza el plano axis = c, de a pares. */
function cutSegments(surface, axis, c) {
  const i = axis === "x" ? 0 : 1;
  const pts = [];
  [surface.points, ...(surface.holes ?? [])].forEach((loop) =>
    loop.forEach((p, k) => {
      const q = loop[(k + 1) % loop.length];
      const dp = p[i] - c, dq = q[i] - c;
      if ((dp > 0) === (dq > 0) || Math.abs(dp - dq) < 1e-12) return;
      const t = dp / (dp - dq);
      pts.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t]);
    })
  );
  if (pts.length < 2) return [];
  const o = axis === "x" ? 1 : 0; // la otra coordenada en planta
  const spanO = Math.max(...pts.map((p) => p[o])) - Math.min(...pts.map((p) => p[o]));
  const spanZ = Math.max(...pts.map((p) => p[2])) - Math.min(...pts.map((p) => p[2]));
  pts.sort((a, b) => (spanO >= spanZ ? a[o] - b[o] : a[2] - b[2]));
  const segs = [];
  for (let k = 0; k + 1 < pts.length; k += 2) segs.push([pts[k], pts[k + 1]]);
  return segs;
}

/** Recorta un polígono 3D al semiespacio axis ≤ c (lo que se ve más allá del corte). */
function clipBeyond(loop, axis, c) {
  const i = axis === "x" ? 0 : 1;
  const out = [];
  loop.forEach((p, k) => {
    const q = loop[(k + 1) % loop.length];
    const pin = p[i] <= c + 1e-9, qin = q[i] <= c + 1e-9;
    if (pin) out.push(p);
    if (pin !== qin) {
      const t = (c - p[i]) / (q[i] - p[i]);
      out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t]);
    }
  });
  return out;
}

function sectionView(project, gen, plane, cell) {
  const { axis, c } = plane;
  const n = axis === "x" ? { x: 1, y: 0 } : { x: 0, y: 1 }; // el observador mira hacia las coordenadas menores
  const ax = axes(n);
  const system = SYSTEMS[project.system] ?? SYSTEMS.steel_tube;
  const rafterH = PROFILES[system.roles.rafter].h;
  const items = [];
  const cut = [];
  const P = (p) => proj(ax, p);

  // lo que se ve más allá del plano de corte
  const beyond = (pts3, cls, holes = [], bias = 0) => {
    const outer = clipBeyond(pts3, axis, c);
    if (outer.length < 3) return;
    const loops = [outer.map(P), ...holes.map((h) => clipBeyond(h, axis, c)).filter((h) => h.length >= 3).map((h) => h.map(P))];
    if (Math.abs(areaXY(loops[0])) < 1e-4) return;
    items.push({ loops, cls, depth: outer.reduce((sum, p) => sum + depthOf(ax, p), 0) / outer.length + bias });
  };
  gen.surfaces.forEach((s) => {
    if (s.material === "interior") beyond(s.points, "se-wall", s.holes);
    else if (s.material === "vidrio") beyond(s.points, "el-glass", [], 0.02);
    else if (s.material === "puerta") beyond(s.points, "el-door", [], 0.02);
    else if (s.material === "cubierta" || s.material === "exterior") beyond(s.points, "se-far", s.holes, -0.01);
  });
  gen.members.forEach((m) => {
    const i = axis === "x" ? 0 : 1;
    if (m.a[i] > c + 1e-6 && m.b[i] > c + 1e-6) return;
    if (m.role === "stairStringer" || m.role === "landingFrame") beyond(memberQuad(m), "el-edge");
    else if (["handrail", "railPost", "baluster", "landingPost"].includes(m.role)) {
      const a = P(m.a), b = P(m.b);
      if (Math.hypot(a[0] - b[0], a[1] - b[1]) > 0.02) items.push({ loops: [[a, b]], cls: m.role === "handrail" ? "el-rail" : "el-bar", line: true, depth: (depthOf(ax, m.a) + depthOf(ax, m.b)) / 2 + 0.03 });
    }
  });
  // escalones: de canto en este corte o en vista
  gen.surfaces.filter((s) => s.material === "escalon").forEach((s) => {
    const pts = clipBeyond(s.points, axis, c);
    if (pts.length < 2) return;
    const us = pts.map((p) => P(p)[0]);
    const z = s.points[0][2];
    items.push({ loops: [[[Math.min(...us), -z], [Math.max(...us), -z], [Math.max(...us), -z + 0.04], [Math.min(...us), -z + 0.04]]], cls: "el-edge", depth: pts.reduce((sum, p) => sum + depthOf(ax, p), 0) / pts.length + 0.02 });
  });
  items.sort((a, b) => a.depth - b.depth);

  // muros cortados: la cara exterior y la interior de cada muro forman el lleno
  const byWall = new Map();
  gen.surfaces.filter((s) => (s.material === "exterior" || s.material === "interior") && s.wallId).forEach((s) => {
    const segs = cutSegments(s, axis, c);
    if (!segs.length) return;
    const key = `${s.level}:${s.wallId}`;
    if (!byWall.has(key)) byWall.set(key, []);
    byWall.get(key).push(segs.map(([a, b]) => [P(a), P(b)].sort((p, q) => q[1] - p[1])));
  });
  byWall.forEach((skins) => {
    const [first, second] = skins;
    if (second && first.length === second.length) {
      first.forEach((seg, k) => cut.push({ loops: [[seg[0], seg[1], second[k][1], second[k][0]]], cls: "cut-fill" }));
    } else {
      skins.flat().forEach((seg) => {
        const u = seg[0][0];
        cut.push({ loops: [[[u - 0.03, seg[0][1]], [u + 0.03, seg[0][1]], [u + 0.03, seg[1][1]], [u - 0.03, seg[1][1]]]], cls: "cut-fill" });
      });
    }
  });
  // pisos y entrepisos (bastidor + placa), cubierta (cabios + placa) y cielorraso
  gen.surfaces.forEach((s) => {
    const segs = cutSegments(s, axis, c).map(([a, b]) => [P(a), P(b)]);
    if (!segs.length) return;
    const lv = gen.levels[s.level];
    segs.forEach(([a, b]) => {
      if (s.material === "piso") cut.push({ loops: [[a, b, [b[0], -lv.elev], [a[0], -lv.elev]]], cls: "cut-hatch" });
      else if (s.material === "platea") cut.push({ loops: [[a, b, [b[0], b[1] + 0.02], [a[0], a[1] + 0.02]]], cls: "cut-fill" });
      else if (s.material === "cubierta") cut.push({ loops: [[a, b, [b[0], b[1] + rafterH + 0.011], [a[0], a[1] + rafterH + 0.011]]], cls: "cut-hatch" });
      else if (s.material === "cielorraso") cut.push({ loops: [[a, b, [b[0], b[1] + 0.0125], [a[0], a[1] + 0.0125]]], cls: "cut-fill" });
      else if (s.material === "balcon") cut.push({ loops: [[a, b, [b[0], b[1] + 0.07], [a[0], a[1] + 0.07]]], cls: "cut-hatch" });
      else if (s.material === "vidrio" || s.material === "puerta") cut.push({ loops: [[[a[0] - 0.02, a[1]], [a[0] + 0.02, a[1]], [b[0] + 0.02, b[1]], [b[0] - 0.02, b[1]]]], cls: "se-wall" });
    });
  });
  // fundación: cortada (hormigón rayado) o en proyección (trazos)
  const i = axis === "x" ? 0 : 1;
  gen.solids.forEach((sd) => {
    const box = solidBoxes(sd);
    const lo = box[i * 2], hi = box[i * 2 + 1];
    if (lo > c + 1e-6) return;
    const o = axis === "x" ? [box[2], box[3]] : [box[0], box[1]];
    const us = o.map((v) => (axis === "x" ? v * ax.u.y : v * ax.u.x));
    const rect = [[Math.min(...us), -box[4]], [Math.max(...us), -box[4]], [Math.max(...us), -box[5]], [Math.min(...us), -box[5]]];
    if (hi >= c - 1e-6) cut.push({ loops: [rect], cls: "cut-conc" });
    else items.unshift({ loops: [rect], cls: "el-hidden", depth: -1000 });
  });

  const all = [...items, ...[...byWall.values()].flat(2).map((seg) => ({ loops: [seg] }))];
  if (!all.length) return { svg: "", scale: 100 };
  const bb = boundsOf(all.concat(gen.solids.map((sd) => {
    const b = solidBoxes(sd);
    const us = (axis === "x" ? [b[2], b[3]] : [b[0], b[1]]).map((v) => (axis === "x" ? v * ax.u.y : v * ax.u.x));
    return { loops: [[[Math.min(...us), -b[4]], [Math.max(...us), -b[5]]]] };
  })));
  const view = fit(cell, bb, { l: 34, r: 30, t: 8, b: 14 });
  const cutSvg = drawItems(cut, view);
  const g0 = view.map(bb.minU - 0.6, 0), g1 = view.map(bb.maxU + 0.6, 0);
  // alturas libres de cada nivel
  const dims = dimChain(view, "v", [0, ...gen.levels.flatMap((l) => [-l.floorTop, -l.zTop])].map((v) => v), bb.maxU + 0.25, 9);
  return {
    svg: `${drawItems(items, view)}${cutSvg}${line(g0, g1, "ground")}${levelMarks(gen, view, bb.minU - 0.25, -1)}${dims}`,
    scale: view.scale
  };
}

// ---------- lámina: marco, rótulo y títulos ----------
function northArrow(x, y, deg) {
  return `<g transform="translate(${x} ${y}) rotate(${deg})">
    <circle r="6" class="thin-shape"/><path d="M 0 -6 L 2.2 3.4 L 0 1.6 Z" class="mark"/><path d="M 0 -6 L -2.2 3.4 L 0 1.6 Z" class="thin-shape"/>
    <text x="0" y="-7.4" class="tag-text">N</text></g>`;
}

function scaleBar(x, y, scale) {
  const unit = scale <= 50 ? 1 : scale <= 125 ? 2 : 5; // metros por tramo
  const w = (unit * 1000) / scale;
  const cells = [0, 1, 2, 3].map((i) => `<rect x="${mm(x + i * w)}" y="${y}" width="${mm(w)}" height="1.4" class="${i % 2 ? "thin-shape" : "mark"}"/>`).join("");
  const labels = [0, 1, 2, 3, 4].map((i) => text([x + i * w, y + 4.6], `${i * unit}`, "dim-text dim-text--small")).join("");
  return `${cells}${labels}${text([x + 4 * w + 2.5, y + 4.6], "m", "note")}`;
}

function titleBlock(meta, sheet, index, count, scaleText) {
  const x = PAPER.w - PAPER.margin - TITLE.w;
  const y = PAPER.h - PAPER.margin - TITLE.h;
  const cell = (cx, cy, w, h, label, value, cls = "tb-value") => `
    <rect x="${cx}" y="${cy}" width="${w}" height="${h}" class="tb"/>
    ${text([cx + 1.6, cy + 3.2], label, "tb-label")}
    ${text([cx + 1.6, cy + h - 2], value || "", cls)}`;
  const lugar = [meta.localidad, meta.provincia].filter(Boolean).join(", ");
  return `
    <rect x="${x}" y="${y}" width="${TITLE.w}" height="${TITLE.h}" class="tb tb--outer"/>
    ${cell(x, y, 112, 12, "Obra", meta.obra, "tb-value tb-value--big")}
    ${cell(x + 112, y, 63, 12, "Plano", sheet.title, "tb-value tb-value--big")}
    ${cell(x, y + 12, 62, 10, "Comitente", meta.comitente)}
    ${cell(x + 62, y + 12, 50, 10, "Nomenclatura catastral", meta.catastro)}
    ${cell(x + 112, y + 12, 33, 10, "Escala", scaleText)}
    ${cell(x + 145, y + 12, 30, 10, "Lámina", `${String(index + 1).padStart(2, "0")} / ${String(count).padStart(2, "0")}`)}
    ${cell(x, y + 22, 62, 10, "Ubicación", meta.ubicacion)}
    ${cell(x + 62, y + 22, 50, 10, "Localidad", lugar)}
    ${cell(x + 112, y + 22, 63, 10, "Fecha", meta.fecha)}
    ${cell(x, y + 32, 62, 14, "Proyecto y dirección técnica", meta.profesional)}
    ${cell(x + 62, y + 32, 50, 14, "Matrícula", meta.matricula)}
    ${cell(x + 112, y + 32, 63, 14, "Firma y sello", "")}`;
}

const STYLE = `
  .frame{fill:none;stroke:#000;stroke-width:.7} .tb{fill:#fff;stroke:#000;stroke-width:.25} .tb--outer{stroke-width:.7;fill:none}
  text{font-family:"IBM Plex Sans","Helvetica Neue",Arial,sans-serif;fill:#000}
  .tb-label{font-size:2px;fill:#444} .tb-value{font-size:3px;font-weight:600} .tb-value--big{font-size:4px;font-weight:700}
  .view-title{font-size:3.6px;font-weight:700} .view-sub{font-size:2.5px;fill:#333}
  .wall{fill:#000;stroke:#000;stroke-width:.2} .wall--int{fill:#555;stroke:#555}
  .floor{fill:#f1f1f1;stroke:none} .proj{fill:none;stroke:#000;stroke-width:.18;stroke-dasharray:2.4 1.2}
  .hole{fill:#fff;stroke:#000;stroke-width:.25;stroke-dasharray:3 1.2} .stair{fill:#fff;stroke:#000;stroke-width:.3}
  .balcony{fill:#fff;stroke:#000;stroke-width:.3} .rail{fill:none;stroke:#000;stroke-width:.6;stroke-dasharray:.4 1}
  .thin{stroke:#000;stroke-width:.18} .thin-line{fill:none;stroke:#000;stroke-width:.2} .thin-shape{fill:none;stroke:#000;stroke-width:.2}
  .med{stroke:#000;stroke-width:.35} .arc{fill:none;stroke:#000;stroke-width:.18;stroke-dasharray:1 .7}
  .col{fill:#fff;stroke:#000;stroke-width:.35} .mark{fill:#000;stroke:none}
  .tag{fill:#fff;stroke:#000;stroke-width:.2} .tag-text{font-size:2.1px;font-weight:700;text-anchor:middle}
  .dim{stroke:#000;stroke-width:.13} .dim-tick{stroke:#000;stroke-width:.35} .dim-text{font-size:2.3px;text-anchor:middle;paint-order:stroke;stroke:#fff;stroke-width:.7px} .dim-text--small{font-size:1.8px}
  .label{font-size:2.3px;font-weight:600;text-anchor:middle} .label--halo{paint-order:stroke;stroke:#fff;stroke-width:.9px}
  .note{font-size:2.3px} .note--end{text-anchor:end} .note--mid{text-anchor:middle;fill:#333}
  .ref{stroke:#000;stroke-width:.13;stroke-dasharray:3 1 .6 1}
  .cut{stroke:#000;stroke-width:.8} .cut-axis{stroke:#000;stroke-width:.18;stroke-dasharray:6 1.4 1 1.4} .cut-arrow{stroke:#000;stroke-width:.5} .cut-text{font-size:4.2px;font-weight:700;text-anchor:middle}
  .roof{fill:#f4f4f4;stroke:#000;stroke-width:.35} .roof--terrace{fill:url(#hatchDeck)}
  .el-wall{fill:#fff;stroke:#000;stroke-width:.3} .el-glass{fill:#dcdcdc;stroke:#000;stroke-width:.2} .el-door{fill:#bdbdbd;stroke:#000;stroke-width:.2}
  .el-roof{fill:#ededed;stroke:#000;stroke-width:.3} .el-edge{fill:#d2d2d2;stroke:#000;stroke-width:.2} .el-conc{fill:#e4e4e4;stroke:#000;stroke-width:.25}
  .el-hidden{fill:none;stroke:#000;stroke-width:.18;stroke-dasharray:1.6 1} .el-rail{stroke:#000;stroke-width:.4} .el-bar{stroke:#000;stroke-width:.15}
  .ground{stroke:#000;stroke-width:.8}
  .se-wall{fill:#fff;stroke:#000;stroke-width:.18} .se-far{fill:#fff;stroke:#000;stroke-width:.13}
  .cut-fill{fill:#000;stroke:#000;stroke-width:.15} .cut-hatch{fill:url(#hatchCut);stroke:#000;stroke-width:.35} .cut-conc{fill:url(#hatchConc);stroke:#000;stroke-width:.45}
  .tbl{fill:none;stroke:#000;stroke-width:.2} .tbl-head{fill:#000} .tbl-h{font-size:2.5px;font-weight:700;fill:#fff} .tbl-c{font-size:2.6px} .tbl-n{font-size:2.6px;text-anchor:end}
  .tbl-total{font-size:2.8px;font-weight:700}`;

const DEFS = `<defs>
  <pattern id="hatchCut" width="1.2" height="1.2" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="1.2" height="1.2" fill="#fff"/><line x1="0" y1="0" x2="0" y2="1.2" stroke="#000" stroke-width=".18"/></pattern>
  <pattern id="hatchConc" width="2" height="2" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)"><rect width="2" height="2" fill="#fff"/><line x1="0" y1="0" x2="0" y2="2" stroke="#000" stroke-width=".2"/><circle cx="1" cy="1" r=".18" fill="#000"/></pattern>
  <pattern id="hatchDeck" width="2.4" height="2.4" patternUnits="userSpaceOnUse"><rect width="2.4" height="2.4" fill="#f4f4f4"/><line x1="0" y1="0" x2="2.4" y2="0" stroke="#000" stroke-width=".12"/></pattern>
</defs>`;

function viewTitle(cell, title, scale, sub = "") {
  const y = cell.y + cell.h - 3;
  return `${line([cell.x + 2, y - 5.2], [cell.x + 62, y - 5.2], "med")}${text([cell.x + 2, y - 1], title, "view-title")}${text([cell.x + 64, y - 1], `Esc. 1:${scale}${sub ? ` · ${sub}` : ""}`, "view-sub")}`;
}

function assemble(sheet, meta, index, count) {
  const scales = [...new Set(sheet.views.map((v) => v.scale).filter(Boolean))];
  const scaleText = scales.length === 1 ? `1:${scales[0]}` : scales.length ? "Las indicadas" : "—";
  return {
    id: sheet.id,
    title: sheet.title,
    scale: scaleText,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${PAPER.w} ${PAPER.h}" width="${PAPER.w}mm" height="${PAPER.h}mm" class="sheet-svg">
      <style>${STYLE}</style>${DEFS}
      <rect x="0" y="0" width="${PAPER.w}" height="${PAPER.h}" fill="#fff"/>
      <rect x="${PAPER.left}" y="${PAPER.margin}" width="${PAPER.w - PAPER.left - PAPER.margin}" height="${PAPER.h - 2 * PAPER.margin}" class="frame"/>
      ${sheet.body}
      ${titleBlock(meta, sheet, index, count, scaleText)}
    </svg>`
  };
}

// ---------- planillas ----------
function table(x, y, title, cols, rows, footer = null) {
  const rowH = 6;
  const w = cols.reduce((sum, c) => sum + c.w, 0);
  const out = [text([x, y - 2.5], title, "view-title")];
  out.push(`<rect x="${x}" y="${y}" width="${w}" height="${rowH}" class="tbl-head"/>`);
  let cx = x;
  cols.forEach((c) => {
    out.push(text([c.num ? cx + c.w - 1.5 : cx + 1.5, y + 4.1], c.label, "tbl-h", c.num ? ' text-anchor="end"' : ""));
    cx += c.w;
  });
  rows.forEach((row, i) => {
    const ry = y + rowH * (i + 1);
    cx = x;
    out.push(`<rect x="${x}" y="${ry}" width="${w}" height="${rowH}" class="tbl"/>`);
    cols.forEach((c, k) => {
      out.push(text([c.num ? cx + c.w - 1.5 : cx + 1.5, ry + 4.1], row[k] ?? "", c.num ? "tbl-n" : "tbl-c"));
      if (k) out.push(line([cx, ry], [cx, ry + rowH], "dim"));
      cx += c.w;
    });
  });
  const endY = y + rowH * (rows.length + 1);
  if (footer) out.push(`<rect x="${x}" y="${endY}" width="${w}" height="${rowH + 1}" class="tbl" style="stroke-width:.5"/>`, text([x + 1.5, endY + 4.7], footer[0], "tbl-total"), text([x + w - 1.5, endY + 4.7], footer[1], "tbl-total", ' text-anchor="end"'));
  return { svg: out.join(""), height: rowH * (rows.length + 1 + (footer ? 1.2 : 0)) + 8 };
}

function schedules(project, gen, types, area) {
  const out = [];
  const x = area.x + 6;
  let y = area.y + 14;
  const openings = table(x, y, "Planilla de aberturas", [
    { label: "Código", w: 18 }, { label: "Tipo", w: 28 }, { label: "Cantidad", w: 20, num: true }, { label: "Ancho (m)", w: 22, num: true },
    { label: "Alto (m)", w: 22, num: true }, { label: "Antepecho (m)", w: 27, num: true }, { label: "Mano / observaciones", w: 60 }
  ], types.list.map((t) => [t.code, t.kind === "door" ? "Puerta" : "Ventana", String(t.count), f2(t.width), f2(t.height), t.kind === "door" ? "—" : f2(t.sill),
    t.kind === "door" ? `Mano ${t.hand}, vista desde donde abre` : `Vano ${f2(t.width * t.height)} m²`]));
  out.push(openings.svg);
  y += openings.height + 12;

  const rows = gen.levels.map((l) => {
    const cover = levelFootprints(l).reduce((sum, fp) => sum + Math.abs(areaXY(fp.map((p) => [p.x, p.y]))), 0);
    const voids = (project.levels[l.index]?.voids ?? []).reduce((sum, v) => sum + (v.x1 - v.x0) * (v.y1 - v.y0), 0);
    return { name: l.name, cover, voids, net: cover - voids, npt: l.floorTop, height: project.levels[l.index].height };
  });
  const semi = gen.totals.terraceArea + gen.totals.balconyArea;
  const total = rows.reduce((sum, r) => sum + r.net, 0);
  const surfaces = table(x, y, "Planilla de superficies", [
    { label: "Nivel", w: 40 }, { label: "N.P.T. (m)", w: 24, num: true }, { label: "Altura al bastidor (m)", w: 38, num: true },
    { label: "Contorno (m²)", w: 30, num: true }, { label: "Doble altura (m²)", w: 32, num: true }, { label: "Cubierta (m²)", w: 33, num: true }
  ], [
    ...rows.map((r) => [r.name, levelSign(r.npt), f2(r.height), f2(r.cover), r.voids ? f2(r.voids) : "—", f2(r.net)]),
    ...(semi > 0 ? [["Balcones y terrazas (semicubierta)", "", "", "", "", f2(semi)]] : [])
  ], ["Superficie cubierta total", `${f2(total)} m²`]);
  out.push(surfaces.svg);
  y += surfaces.height + 12;

  const s = project.settings;
  const system = SYSTEMS[project.system] ?? SYSTEMS.steel_tube;
  const data = table(x, y, "Sistema constructivo", [{ label: "Elemento", w: 55 }, { label: "Resolución", w: 142 }], [
    ["Estructura", `${system.label}; bastidor ${PROFILES[project.mainFrame]?.label ?? ""}`],
    ["Fundación", FOUNDATIONS[project.foundation.type].label],
    ["Muros exteriores", `${SHEETS[system.sheets.wallSheathing].label} + ${SHEETS[s.wallExteriorCladding].label}`],
    ["Revestimiento interior", SHEETS[s.wallInteriorLining].label],
    ["Cubierta", `${ROOF_TYPES[project.roof.type].label}, ${f2(project.roof.slope).replace(/,00$/, "")} %; ${SHEETS[s.roofCladding].label}; ${aleroText(project.roof)}`],
    ["Montantes / viguetas / cabios", `Cada ${f2(s.wallSpacing)} / ${f2(s.floorSpacing)} / ${f2(s.roofSpacing)} m`]
  ]);
  out.push(data.svg);
  y += data.height + 6;
  out.push(text([x, y], "Cotas en metros, a ejes de muro. Niveles referidos al terreno natural (N.T. ±0,00). Las medidas se verifican en obra.", "note"));
  out.push(text([x, y + 4.5], "Documentación generada desde el modelo de ActivaModular. Requiere revisión, firma y sello de un profesional matriculado.", "note"));
  return out.join("");
}

// ---------- juego de láminas ----------
const VIEW_NAMES = ["Vista frente", "Vista contrafrente", "Vista lateral derecha", "Vista lateral izquierda"];

/**
 * Arma todas las láminas de arquitectura del proyecto.
 * Devuelve [{ id, title, scale, svg }], cada una lista para imprimir en A3 apaisado.
 */
export function buildSheets(project, gen) {
  const meta = normalizeSheet(project.sheet);
  if (!meta.obra) meta.obra = project.name ?? "";
  const types = openingTypes(project);
  const planes = sectionPlanes(project);
  const area = { x: PAPER.left, y: PAPER.margin, w: PAPER.w - PAPER.left - PAPER.margin, h: PAPER.h - 2 * PAPER.margin };
  const full = { x: area.x, y: area.y, w: area.w, h: area.h - TITLE.h - 2 };
  const sheets = [];
  const hasWalls = project.levels.some((l) => l.walls.length);
  if (!hasWalls) return [];

  // plantas: una lámina por nivel
  project.levels.forEach((level, li) => {
    if (!level.walls.length) return;
    const v = planView(project, gen, li, full, types, planes);
    const title = /^planta/i.test(level.name) ? level.name : `Planta ${level.name.toLowerCase()}`;
    const body = `${v.svg}${viewTitle(full, title, v.scale, "cotas a ejes de muro")}
      ${northArrow(area.x + area.w - 16, area.y + 18, meta.north)}${scaleBar(area.x + 6, full.y + full.h - 22, v.scale)}`;
    sheets.push({ id: `planta-${li}`, title, views: [v], body });
  });

  // planta de techos
  {
    const v = roofView(project, gen, full);
    sheets.push({ id: "techos", title: "Planta de techos", views: [v], body: `${v.svg}${viewTitle(full, "Planta de techos", v.scale, "pendientes y desagüe")}${northArrow(area.x + area.w - 16, area.y + 18, meta.north)}` });
  }

  // cortes
  {
    const top = { x: area.x, y: area.y, w: area.w, h: (area.h - TITLE.h) / 2 + 12 };
    const bottom = { x: area.x, y: top.y + top.h, w: area.w - TITLE.w - 4, h: area.h - top.h };
    const a = sectionView(project, gen, planes.B, top);
    const b = sectionView(project, gen, planes.A, bottom);
    sheets.push({
      id: "cortes", title: "Cortes", views: [a, b],
      body: `${a.svg}${viewTitle(top, "Corte B-B · longitudinal", a.scale)}${b.svg}${viewTitle(bottom, "Corte A-A · transversal", b.scale)}`
    });
  }

  // vistas
  {
    const front = frontSide(project);
    const normals = [front, { x: -front.x, y: -front.y }, { x: front.y, y: -front.x }, { x: -front.y, y: front.x }];
    const halfW = area.w / 2;
    const rowH = area.h / 2;
    // la celda de abajo a la derecha deja libre el rótulo
    const cells = [
      { x: area.x, y: area.y, w: halfW, h: rowH }, { x: area.x + halfW, y: area.y, w: halfW, h: rowH },
      { x: area.x, y: area.y + rowH, w: halfW, h: rowH }, { x: area.x + halfW, y: area.y + rowH, w: halfW, h: rowH - TITLE.h - 2 }
    ];
    const views = normals.map((n, i) => elevationView(gen, n, cells[i]));
    sheets.push({
      id: "vistas", title: "Vistas", views,
      body: views.map((v, i) => `${v.svg}${viewTitle(cells[i], VIEW_NAMES[i], v.scale)}`).join("")
    });
  }

  // planillas
  sheets.push({ id: "planillas", title: "Planillas", views: [], body: schedules(project, gen, types, area) });

  return sheets.map((s, i) => assemble(s, meta, i, sheets.length));
}
