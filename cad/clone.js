// Copiar y clonar partes del diseño: un módulo completo, un lateral, varias piezas elegidas.
// Todo opera sobre el modelo (muros, aberturas, escaleras, balcones y vacíos de doble altura);
// las piezas reales se regeneran solas a partir de la copia.
import { dist, pointInPolygon, wallDir, wallLength } from "./geometry.js";
import { findFootprint, newId } from "./model.js";

const r3 = (v) => Math.round(v * 1000) / 1000;
const mid = (w) => ({ x: (w.a.x + w.b.x) / 2, y: (w.a.y + w.b.y) / 2 });
const item = (type, id) => ({ type, id });
export const itemKey = (it) => `${it.type}:${it.id}`;

export const DIRECTIONS = {
  right: { x: 1, y: 0, label: "Hacia la derecha" },
  left: { x: -1, y: 0, label: "Hacia la izquierda" },
  down: { x: 0, y: 1, label: "Hacia abajo" },
  up: { x: 0, y: -1, label: "Hacia arriba" }
};

const nearPolygon = (p, poly, tol = 2e-3) =>
  poly.some((a, i) => {
    const b = poly[(i + 1) % poly.length];
    const dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy;
    const t = L2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2)) : 0;
    return Math.hypot(p.x - a.x - dx * t, p.y - a.y - dy * t) < tol;
  });
const insideOrOn = (p, poly) => pointInPolygon(p, poly) || nearPolygon(p, poly);

/** Suma los balcones que cuelgan de los muros elegidos y quita repetidos. */
export function expandItems(level, items) {
  const seen = new Map(items.map((it) => [itemKey(it), it]));
  const wallIds = new Set(items.filter((it) => it.type === "wall").map((it) => it.id));
  (level.balconies ?? []).forEach((b) => {
    if (wallIds.has(b.wallId)) seen.set(`balcony:${b.id}`, item("balcony", b.id));
  });
  // un balcón sin su muro no se puede copiar
  return [...seen.values()].filter((it) => it.type !== "balcony" || wallIds.has((level.balconies ?? []).find((b) => b.id === it.id)?.wallId));
}

/** Todo lo que hay en el nivel. */
export function allItems(level) {
  return [
    ...level.walls.map((w) => item("wall", w.id)),
    ...(level.stairs ?? []).map((s) => item("stair", s.id)),
    ...(level.balconies ?? []).map((b) => item("balcony", b.id)),
    ...(level.voids ?? []).map((v) => item("void", v.id))
  ];
}

/** Piezas completamente dentro de un rectángulo (selección por ventana o por caja del módulo). */
export function itemsInRect(level, rect, tol = 1e-6) {
  const inside = (p) => p.x >= rect.minX - tol && p.x <= rect.maxX + tol && p.y >= rect.minY - tol && p.y <= rect.maxY + tol;
  const walls = level.walls.filter((w) => inside(w.a) && inside(w.b));
  return expandItems(level, [
    ...walls.map((w) => item("wall", w.id)),
    ...(level.stairs ?? []).filter((s) => inside(s)).map((s) => item("stair", s.id)),
    ...(level.voids ?? []).filter((v) => inside({ x: v.x0, y: v.y0 }) && inside({ x: v.x1, y: v.y1 })).map((v) => item("void", v.id))
  ]);
}

/**
 * El módulo completo al que pertenece un muro: su contorno cerrado, los tabiques,
 * escaleras y vacíos de adentro y los balcones que cuelgan de sus muros.
 * Si el muro no cierra ningún contorno, devuelve los muros conectados a él.
 */
export function structureItems(level, wallId) {
  const info = findFootprint(level.walls);
  const polygons = info.polygons ?? (info.polygon ? [info.polygon] : []);
  const wall = level.walls.find((w) => w.id === wallId);
  if (!wall) return [];
  const polygon = polygons.find((poly) => insideOrOn(mid(wall), poly) && insideOrOn(wall.a, poly) && insideOrOn(wall.b, poly));
  if (!polygon) {
    const picked = new Set([wall.id]);
    let grew = true;
    while (grew) {
      grew = false;
      level.walls.forEach((w) => {
        if (picked.has(w.id)) return;
        const touches = level.walls.some((o) => picked.has(o.id) && [o.a, o.b].some((p) => [w.a, w.b].some((q) => dist(p, q) < 1e-3)));
        if (touches) { picked.add(w.id); grew = true; }
      });
    }
    return expandItems(level, [...picked].map((id) => item("wall", id)));
  }
  const walls = level.walls.filter((w) => [w.a, w.b, mid(w)].every((p) => insideOrOn(p, polygon)));
  return expandItems(level, [
    ...walls.map((w) => item("wall", w.id)),
    ...(level.stairs ?? []).filter((s) => insideOrOn(s, polygon)).map((s) => item("stair", s.id)),
    ...(level.voids ?? []).filter((v) => insideOrOn({ x: (v.x0 + v.x1) / 2, y: (v.y0 + v.y1) / 2 }, polygon)).map((v) => item("void", v.id))
  ]);
}

/** Caja que envuelve la selección; las escaleras cuentan por su arranque. */
export function itemsBounds(level, items) {
  const pts = [];
  items.forEach((it) => {
    if (it.type === "wall") {
      const w = level.walls.find((x) => x.id === it.id);
      if (w) pts.push(w.a, w.b);
    } else if (it.type === "stair") {
      const s = (level.stairs ?? []).find((x) => x.id === it.id);
      if (s) pts.push({ x: s.x, y: s.y });
    } else if (it.type === "void") {
      const v = (level.voids ?? []).find((x) => x.id === it.id);
      if (v) pts.push({ x: v.x0, y: v.y0 }, { x: v.x1, y: v.y1 });
    }
  });
  if (!pts.length) return null;
  return {
    minX: Math.min(...pts.map((p) => p.x)), maxX: Math.max(...pts.map((p) => p.x)),
    minY: Math.min(...pts.map((p) => p.y)), maxY: Math.max(...pts.map((p) => p.y))
  };
}

/** Transformación de la copia k: espejo (en las impares, si se pide) y traslado. */
function transformFor(bounds, k, { direction, gap = 0, mirror = false }) {
  const d = DIRECTIONS[direction] ?? DIRECTIONS.right;
  const size = d.x ? bounds.maxX - bounds.minX : bounds.maxY - bounds.minY;
  const step = size + Math.max(0, gap);
  const mirrored = mirror && k % 2 === 1;
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  const point = (p) => {
    const x = mirrored && d.x ? 2 * cx - p.x : p.x;
    const y = mirrored && d.y ? 2 * cy - p.y : p.y;
    return { x: r3(x + d.x * step * k), y: r3(y + d.y * step * k) };
  };
  return { point, mirrored, axis: d.x ? "x" : "y", step };
}

function cloneWall(wall, t) {
  return {
    id: newId("w"),
    type: wall.type,
    a: t.point(wall.a),
    b: t.point(wall.b),
    // el muro conserva su sentido a→b, así las aberturas quedan a la misma distancia del inicio;
    // al espejar, la normal del muro se invierte y la puerta tiene que abrir del otro lado
    openings: wall.openings.map((o) => ({ ...o, id: newId("o"), ...(o.kind === "door" && t.mirrored ? { swing: o.swing === -1 ? 1 : -1 } : {}) }))
  };
}

function cloneStair(st, t) {
  const p = t.point(st);
  let dir = st.dir;
  if (t.mirrored) {
    if (t.axis === "x" && (dir === 0 || dir === 180)) dir = (dir + 180) % 360;
    if (t.axis === "y" && (dir === 90 || dir === 270)) dir = (dir + 180) % 360;
  }
  return { ...st, id: newId("s"), x: p.x, y: p.y, dir, turn: t.mirrored ? (st.turn === "izquierda" ? "derecha" : "izquierda") : st.turn };
}

function cloneVoid(v, t) {
  const a = t.point({ x: v.x0, y: v.y0 });
  const b = t.point({ x: v.x1, y: v.y1 });
  return { id: newId("v"), x0: Math.min(a.x, b.x), x1: Math.max(a.x, b.x), y0: Math.min(a.y, b.y), y1: Math.max(a.y, b.y) };
}

/** Arma las copias de un nivel sin tocar el modelo. */
function buildCopies(level, items, bounds, opts) {
  const count = Math.max(1, Math.min(50, Math.round(Number(opts.count) || 1)));
  const has = (type, id) => items.some((it) => it.type === type && it.id === id);
  const out = { walls: [], stairs: [], balconies: [], voids: [], items: [] };
  for (let k = 1; k <= count; k += 1) {
    const t = transformFor(bounds, k, opts);
    const idMap = new Map();
    level.walls.filter((w) => has("wall", w.id)).forEach((w) => {
      const copy = cloneWall(w, t);
      idMap.set(w.id, copy.id);
      out.walls.push(copy);
      out.items.push(item("wall", copy.id));
    });
    (level.stairs ?? []).filter((s) => has("stair", s.id)).forEach((s) => {
      const copy = cloneStair(s, t);
      out.stairs.push(copy);
      out.items.push(item("stair", copy.id));
    });
    (level.balconies ?? []).filter((b) => has("balcony", b.id) && idMap.has(b.wallId)).forEach((b) => {
      const copy = { ...b, ...(b.rails ? { rails: { ...b.rails } } : {}), id: newId("b"), wallId: idMap.get(b.wallId) };
      out.balconies.push(copy);
      out.items.push(item("balcony", copy.id));
    });
    (level.voids ?? []).filter((v) => has("void", v.id)).forEach((v) => {
      const copy = cloneVoid(v, t);
      out.voids.push(copy);
      out.items.push(item("void", copy.id));
    });
  }
  return out;
}

/** Muros de las copias, para mostrarlas en la planta antes de confirmar. */
export function previewClones(level, items, opts) {
  const all = expandItems(level, items);
  const bounds = itemsBounds(level, all);
  return bounds ? buildCopies(level, all, bounds, opts) : { walls: [], stairs: [], balconies: [], voids: [], items: [] };
}

/**
 * Crea las copias en el proyecto. Con allLevels, lo que cae dentro de la misma caja en los
 * otros niveles se copia igual (un módulo de dos plantas se clona entero).
 * Devuelve las piezas nuevas del nivel activo y el total creado.
 */
export function cloneItems(project, levelIndex, items, opts = {}) {
  const level = project.levels[levelIndex];
  const all = expandItems(level, items);
  const bounds = itemsBounds(level, all);
  if (!bounds) return { items: [], created: 0, levels: 0 };
  let created = 0;
  let levels = 0;
  let activeItems = [];
  project.levels.forEach((lv, li) => {
    const own = li === levelIndex;
    if (!own && !opts.allLevels) return;
    const picked = own ? all : itemsInRect(lv, bounds, 0.02);
    if (!picked.length) return;
    const copies = buildCopies(lv, picked, bounds, opts);
    lv.walls.push(...copies.walls);
    lv.stairs = [...(lv.stairs ?? []), ...copies.stairs];
    lv.balconies = [...(lv.balconies ?? []), ...copies.balconies];
    lv.voids = [...(lv.voids ?? []), ...copies.voids];
    created += copies.items.length;
    levels += 1;
    if (own) activeItems = copies.items;
  });
  return { items: activeItems, created, levels };
}

/** Borra las piezas elegidas (y los balcones que colgaban de los muros borrados). */
export function removeItems(level, items) {
  const ids = (type) => new Set(items.filter((it) => it.type === type).map((it) => it.id));
  const walls = ids("wall"), stairs = ids("stair"), balconies = ids("balcony"), voids = ids("void");
  level.walls = level.walls.filter((w) => !walls.has(w.id));
  level.stairs = (level.stairs ?? []).filter((s) => !stairs.has(s.id));
  level.balconies = (level.balconies ?? []).filter((b) => !balconies.has(b.id) && !walls.has(b.wallId));
  level.voids = (level.voids ?? []).filter((v) => !voids.has(v.id));
}

const clashes = (list, offset, width) => list.some((o) => offset < o.offset + o.width + 0.1 && offset + width > o.offset - 0.1);

/**
 * Copia las aberturas de un muro a otro (un lateral igual a otro).
 * mirror: mide desde el otro extremo, para que queden enfrentadas en muros opuestos.
 * inward(wall) devuelve hacia qué lado queda el interior (±1) para conservar si la puerta abre hacia adentro.
 */
export function copyOpenings(level, fromWallId, toWallId, { mirror = false, inward = () => 1 } = {}) {
  // el origen puede ser un muro copiado antes (de este u otro nivel) o el id de un muro del nivel
  const from = typeof fromWallId === "object" ? fromWallId : level.walls.find((w) => w.id === fromWallId);
  const to = level.walls.find((w) => w.id === toWallId);
  if (!from || !to || from === to || from.id === to.id) return { added: 0, skipped: 0 };
  const L = wallLength(to);
  let added = 0;
  let skipped = 0;
  [...from.openings].sort((a, b) => a.offset - b.offset).forEach((o) => {
    const offset = r3(mirror ? L - o.offset - o.width : o.offset);
    if (offset < 0.05 || offset + o.width > L - 0.05 || clashes(to.openings, offset, o.width)) {
      skipped += 1;
      return;
    }
    const copy = { ...o, id: newId("o"), offset };
    if (o.kind === "door") {
      copy.hinge = mirror ? (o.hinge === "end" ? "start" : "end") : (o.hinge ?? "start");
      copy.swing = (o.swing === -1 ? -1 : 1) * inward(from) * inward(to);
    }
    to.openings.push(copy);
    added += 1;
  });
  return { added, skipped };
}

/** Repite una abertura a lo largo de su muro: count copias separadas gap entre sí. */
export function repeatOpening(level, wallId, openingId, count, gap) {
  const wall = level.walls.find((w) => w.id === wallId);
  const o = wall?.openings.find((x) => x.id === openingId);
  if (!o) return { added: 0, skipped: 0 };
  const L = wallLength(wall);
  const n = Math.max(1, Math.min(30, Math.round(Number(count) || 1)));
  const step = o.width + Math.max(0.1, Number(gap) || 0);
  let added = 0;
  for (let k = 1; k <= n; k += 1) {
    const offset = r3(o.offset + step * k);
    if (offset + o.width > L - 0.05 || clashes(wall.openings, offset, o.width)) continue;
    wall.openings.push({ ...o, id: newId("o"), offset });
    added += 1;
  }
  return { added, skipped: n - added };
}

/** Lado interior de un muro respecto de un contorno: 1 si la normal (-dy, dx) mira hacia adentro. */
export function inwardSign(wall, polygon) {
  if (!polygon) return 1;
  const d = wallDir(wall);
  const m = mid(wall);
  return pointInPolygon({ x: m.x - d.y * 0.2, y: m.y + d.x * 0.2 }, polygon) ? 1 : -1;
}
