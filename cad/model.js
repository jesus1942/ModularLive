// Modelo de obra: niveles apilados, cada uno con muros en planta (eje) y aberturas;
// fundación, piso y techo.
import {
  bbox,
  cross,
  dist,
  ensureCCW,
  pointInPolygon,
  pointKey,
  pointOnWall,
  polygonArea,
  simplifyPolygon,
  sub,
  wallDir,
  wallLength
} from "./geometry.js";
import { FOUNDATIONS, ROOF_TYPES, SYSTEMS } from "./catalog.js";
import { defaultEngineering, normalizeEngineering } from "./engineering/settings.js";
import { EXPOSED_DEFAULTS } from "./exposed.js";

let idCounter = 0;
export const newId = (prefix) => `${prefix}${Date.now().toString(36)}${(idCounter += 1).toString(36)}`;

export const DEFAULT_SETTINGS = {
  wallHeight: 2.6,
  wallSpacing: 0.4,
  floorSpacing: 0.4,
  roofSpacing: 0.6,
  wasteFactor: 8,
  stockLength: 6,
  kerf: 3, // mm por corte
  wallExteriorCladding: "chapa_sinusoidal",
  wallInteriorLining: "durlock",
  roofCladding: "chapa_sinusoidal",
  interiorWallInsulation: true
};

export function createRectangle(x0, y0, width, depth) {
  const p = [
    { x: x0, y: y0 },
    { x: x0 + width, y: y0 },
    { x: x0 + width, y: y0 + depth },
    { x: x0, y: y0 + depth }
  ];
  return p.map((a, i) => ({ id: newId("w"), type: "exterior", a: { ...a }, b: { ...p[(i + 1) % 4] }, openings: [] }));
}

export const levelName = (index) => (index === 0 ? "Planta baja" : `Nivel ${index}`);

export function createLevel(index, walls = [], height = DEFAULT_SETTINGS.wallHeight) {
  return { id: newId("l"), name: levelName(index), height, walls, stairs: [], exposed: { ...EXPOSED_DEFAULTS }, balconies: [] };
}

const clamp = (v, lo, hi, fallback) => (Number.isFinite(Number(v)) ? Math.min(Math.max(Number(v), lo), hi) : fallback);

/** Qué se hace con la parte del nivel que queda sin otro nivel encima. */
export function normalizeExposed(raw) {
  const e = raw && typeof raw === "object" ? raw : {};
  return {
    kind: e.kind === "terraza" ? "terraza" : "techo",
    slope: clamp(e.slope, 2, 60, EXPOSED_DEFAULTS.slope),
    overhang: clamp(e.overhang, 0, 1.2, EXPOSED_DEFAULTS.overhang),
    railing: e.railing !== false
  };
}

export const BALCONY_DEFAULTS = { width: 2.4, depth: 1.2, support: "voladizo", railing: true };

/** Todos los contornos válidos del nivel, compatible con proyectos de un solo módulo. */
export function levelFootprints(level) {
  return level?.footprints?.filter(Boolean) ?? (level?.footprint ? [level.footprint] : []);
}

/** Contorno al que pertenece un muro, probado a ambos lados de su eje. */
export function wallFootprint(level, wall) {
  const d = wallDir(wall), p = pointOnWall(wall, wallLength(wall) / 2);
  return levelFootprints(level).find(poly => [1, -1].some(sign => pointInPolygon({ x: p.x - sign * d.y * 0.02, y: p.y + sign * d.x * 0.02 }, poly))) ?? null;
}

/** Coloca un balcón; el botón del inspector y la herramienta de planta usan esta operación. */
export function placeBalcony(level, wallId, center_m = null) {
  const wall = level.walls.find(w => w.id === wallId && w.type === "exterior");
  const L = wall ? wallLength(wall) : 0;
  if (L < 0.8) return null;
  const info = findFootprint(level.walls);
  if (!info.polygon) return null;
  const door = wall.openings.find(o => o.kind === "door");
  const center = center_m ?? (door ? door.offset + door.width / 2 : L / 2);
  const direction = wallDir(wall);
  const outside = (info.walls ?? level.walls).filter(w => w.type === "exterior" && (w.sourceWallIds ?? [w.id]).includes(wallId)).map(w => {
    const at = p => (p.x - wall.a.x) * direction.x + (p.y - wall.a.y) * direction.y;
    return [Math.min(at(w.a), at(w.b)), Math.max(at(w.a), at(w.b))];
  }).find(([a, b]) => center >= a - 1e-6 && center <= b + 1e-6);
  if (!outside || outside[1] - outside[0] < 0.8) return null;
  const width = Math.round(Math.min(BALCONY_DEFAULTS.width, Math.max(outside[1] - outside[0] - 0.4, 0.6)) * 100) / 100;
  const balcony = { id: newId("b"), wallId, ...BALCONY_DEFAULTS, width,
    offset: Math.round(Math.max(outside[0], Math.min(outside[1] - width, center - width / 2)) * 1000) / 1000 };
  level.balconies = [...(level.balconies ?? []), balcony];
  return balcony;
}

function normalizeBalconies(list, walls) {
  const ids = new Set(walls.map((w) => w.id));
  return (Array.isArray(list) ? list : [])
    .filter((b) => b && ids.has(b.wallId))
    .map((b) => ({
      id: b.id ?? newId("b"),
      wallId: b.wallId,
      offset: clamp(b.offset, 0, 100, 0),
      width: clamp(b.width, 0.6, 30, BALCONY_DEFAULTS.width),
      depth: clamp(b.depth, 0.6, 3, BALCONY_DEFAULTS.depth),
      support: b.support === "columnas" ? "columnas" : "voladizo",
      railing: b.railing !== false
    }));
}

export const STAIR_DEFAULTS = { kind: "recta", dir: 0, width: 0.9, turn: "derecha", ruleSet: "municipal", tread: "chapa" };

function normalizeStairs(stairs) {
  return (Array.isArray(stairs) ? stairs : [])
    .filter((st) => st && Number.isFinite(Number(st.x)) && Number.isFinite(Number(st.y)))
    .map((st) => ({
      id: st.id ?? newId("s"),
      kind: ["recta", "L", "U"].includes(st.kind) ? st.kind : "recta",
      x: Number(st.x),
      y: Number(st.y),
      dir: [0, 90, 180, 270].includes(Number(st.dir)) ? Number(st.dir) : 0,
      width: Math.min(Math.max(Number(st.width) || STAIR_DEFAULTS.width, 0.6), 2),
      turn: st.turn === "izquierda" ? "izquierda" : "derecha",
      ruleSet: st.ruleSet === "accesible" ? "accesible" : "municipal",
      tread: st.tread === "madera" ? "madera" : "chapa"
    }));
}

/** Copia solo el contorno exterior (sin aberturas) para apilar un nivel nuevo encima. */
export function copyContour(walls) {
  return walls
    .filter((w) => w.type === "exterior")
    .map((w) => ({ id: newId("w"), type: "exterior", a: { ...w.a }, b: { ...w.b }, openings: [] }));
}

/** Lado hacia donde abre por defecto: hacia el interior del contorno, si se conoce. */
export function defaultSwing(wall, footprint) {
  if (!footprint) return 1;
  const dir = wallDir(wall);
  const mid = pointOnWall(wall, wallLength(wall) / 2);
  const probe = { x: mid.x - dir.y * 0.2, y: mid.y + dir.x * 0.2 };
  return pointInPolygon(probe, footprint) ? 1 : -1;
}

/**
 * Geometría de la hoja de una puerta en planta.
 * hinge: "start" (bisagra en el extremo cercano al inicio del muro) o "end".
 * swing: 1 o -1, lado hacia donde abre respecto de la normal n = (-dir.y, dir.x).
 * hand: "derecha" / "izquierda", vista desde el lado hacia donde abre.
 */
export function doorLeaf(wall, o) {
  const dir = wallDir(wall);
  const n = { x: -dir.y, y: dir.x };
  const side = o.swing === -1 ? -1 : 1;
  const sHinge = o.hinge === "end" ? o.offset + o.width : o.offset;
  const sFree = o.hinge === "end" ? o.offset : o.offset + o.width;
  const hingePt = pointOnWall(wall, sHinge);
  const freePt = pointOnWall(wall, sFree);
  const out = { x: n.x * side, y: n.y * side };
  const tip = { x: hingePt.x + out.x * o.width, y: hingePt.y + out.y * o.width };
  // de pie del lado hacia donde abre, mirando la puerta
  const facing = { x: -out.x, y: -out.y };
  const right = { x: -facing.y, y: facing.x };
  const toHinge = { x: hingePt.x - freePt.x, y: hingePt.y - freePt.y };
  const hand = toHinge.x * right.x + toHinge.y * right.y > 0 ? "derecha" : "izquierda";
  return { hingePt, freePt, tip, out, side, hand };
}

/** Proyecto inicial: módulo 3 × 6 m, equivalente al preset "vivienda" de la calculadora. */
export function createDefaultProject() {
  const walls = createRectangle(0, 0, 6, 3);
  // muro inferior (y=0, largo 6): puerta + 2 ventanas
  walls[0].openings = [
    { id: newId("o"), kind: "window", offset: 0.6, width: 1.2, height: 1, sill: 1 },
    { id: newId("o"), kind: "door", offset: 2.55, width: 0.9, height: 2.1, sill: 0, hinge: "start", swing: 1 },
    { id: newId("o"), kind: "window", offset: 4.2, width: 1.2, height: 1, sill: 1 }
  ];
  walls[2].openings = [
    { id: newId("o"), kind: "window", offset: 2.4, width: 1.2, height: 1, sill: 1 }
  ];
  walls[1].openings = [
    { id: newId("o"), kind: "window", offset: 0.9, width: 1.2, height: 1, sill: 1 }
  ];
  const level = createLevel(0, walls);
  return {
    version: 2,
    name: "Vivienda modular",
    system: "steel_tube",
    mainFrame: "tubo_100x100x3_2",
    levels: [level],
    foundation: { type: "dados", ...FOUNDATIONS.dados.defaults },
    roof: { type: "plano", slope: ROOF_TYPES.plano.defaultSlope, overhang: 0.25 },
    settings: { ...DEFAULT_SETTINGS },
    engineering: { ...defaultEngineering(), usage: [{ level: 0, levelId: level.id, use: "vivienda" }] }
  };
}

export function normalizeProject(raw) {
  const base = createDefaultProject();
  const project = { ...base, ...raw };
  project.settings = { ...DEFAULT_SETTINGS, ...(raw?.settings ?? {}) };
  if (!SYSTEMS[project.system]) project.system = "steel_tube";
  const system = SYSTEMS[project.system];
  if (!system.mainFrameOptions.includes(project.mainFrame)) project.mainFrame = system.roles.column;
  const fType = FOUNDATIONS[raw?.foundation?.type] ? raw.foundation.type : "dados";
  project.foundation = { ...FOUNDATIONS[fType].defaults, ...(raw?.foundation ?? {}), type: fType };
  const rType = ROOF_TYPES[raw?.roof?.type] ? raw.roof.type : "plano";
  project.roof = { slope: ROOF_TYPES[rType].defaultSlope, overhang: 0.25, ...(raw?.roof ?? {}), type: rType };
  // Diseños guardados antes de los niveles tenían "walls" en la raíz
  const rawLevels = Array.isArray(raw?.levels) && raw.levels.length
    ? raw.levels
    : [{ walls: raw?.walls ?? base.levels[0].walls, height: raw?.settings?.wallHeight }];
  project.levels = rawLevels.map((level, index) => {
    const walls = normalizeWalls(level.walls ?? []);
    return {
      id: level.id ?? newId("l"),
      name: level.name || levelName(index),
      height: Math.min(Math.max(Number(level.height) || project.settings.wallHeight, 2), 4.5),
      walls,
      stairs: normalizeStairs(level.stairs),
      exposed: normalizeExposed(level.exposed),
      balconies: normalizeBalconies(level.balconies, walls)
    };
  });
  project.engineering = normalizeEngineering(raw?.engineering, project.levels);
  delete project.walls;
  return project;
}

function normalizeWalls(walls) {
  return walls
    .filter((w) => w && w.a && w.b && dist(w.a, w.b) > 0.05)
    .map((w) => ({
      id: w.id ?? newId("w"),
      type: w.type === "interior" ? "interior" : "exterior",
      a: { x: Number(w.a.x), y: Number(w.a.y) },
      b: { x: Number(w.b.x), y: Number(w.b.y) },
      openings: (w.openings ?? []).map((o) => {
        const opening = {
          id: o.id ?? newId("o"),
          kind: o.kind === "door" ? "door" : "window",
          offset: Number(o.offset) || 0,
          width: Number(o.width) || 0.9,
          height: Number(o.height) || 1,
          sill: o.kind === "door" ? 0 : Number(o.sill ?? 1)
        };
        if (opening.kind === "door") {
          opening.hinge = o.hinge === "end" ? "end" : "start";
          opening.swing = Number(o.swing) === -1 ? -1 : 1;
        }
        return opening;
      })
    }));
}

/** Todos los muros de todos los niveles (para búsquedas por id). */
export const allWalls = (project) => project.levels.flatMap((level) => level.walls);

/**
 * Busca todos los contornos cerrados. Mantiene polygon para el módulo único y agrega
 * polygons / regions cuando hay varios módulos o encuentros de muros.
 */
export function findFootprint(walls) {
  const exterior = walls.filter((w) => w.type === "exterior");
  const warnings = [];
  if (exterior.length < 3) {
    return { polygon: null, closed: false, warnings: ["Dibujá al menos tres muros exteriores que cierren el contorno."] };
  }
  const nodes = new Map();
  const addEdge = (p, q, wall) => {
    const k = pointKey(p);
    if (!nodes.has(k)) nodes.set(k, { p, edges: [] });
    nodes.get(k).edges.push({ to: pointKey(q), wall });
  };
  exterior.forEach((w) => {
    addEdge(w.a, w.b, w);
    addEdge(w.b, w.a, w);
  });
  const badNodes = [...nodes.values()].filter((n) => n.edges.length !== 2);
  if (badNodes.length) {
    return resolveContours(walls);
  }
  const startKey = pointKey(exterior[0].a);
  const polygon = [];
  const used = new Set();
  let currentKey = startKey;
  let prevWall = null;
  do {
    const node = nodes.get(currentKey);
    polygon.push(node.p);
    const edge = node.edges.find((e) => e.wall !== prevWall && !used.has(e.wall)) ?? node.edges.find((e) => !used.has(e.wall));
    if (!edge) break;
    used.add(edge.wall);
    prevWall = edge.wall;
    currentKey = edge.to;
  } while (currentKey !== startKey && polygon.length <= exterior.length + 1);
  if (used.size !== exterior.length) {
    return resolveContours(walls);
  }
  if (currentKey !== startKey) {
    return { polygon: null, closed: false, warnings: ["El contorno exterior no cierra."] };
  }
  return { polygon: ensureCCW(simplifyPolygon(polygon)), closed: true, warnings };
}

/**
 * Resuelve varios contornos y sus encuentros como un grafo de tramos únicos.
 * Parte cruces y solapes; el borde exterior de cada componente define su piso.
 * Los tramos dentro de un contorno pasan a tabique y nunca generan dos piezas.
 * Se conserva el modelo dibujado: esta geometría efectiva se usa para generar y computar.
 */
function resolveContours(walls) {
  const exterior = walls.filter(w => w.type === "exterior");
  const cuts = exterior.map(() => [0, 1]);
  const addCut = (i, t) => { if (t >= -1e-7 && t <= 1 + 1e-7) cuts[i].push(Math.max(0, Math.min(1, t))); };
  exterior.forEach((w, i) => exterior.forEach((v, j) => {
    if (j <= i) return;
    const r = sub(w.b, w.a), s = sub(v.b, v.a), q = sub(v.a, w.a), den = cross(r, s);
    if (Math.abs(den) > 1e-9) {
      const t = cross(q, s) / den, u = cross(q, r) / den;
      if (t >= -1e-7 && t <= 1 + 1e-7 && u >= -1e-7 && u <= 1 + 1e-7) { addCut(i, t); addCut(j, u); }
    } else if (Math.abs(cross(q, r)) < 1e-8) {
      const project = (p, a, d) => ((p.x - a.x) * d.x + (p.y - a.y) * d.y) / (d.x ** 2 + d.y ** 2);
      [v.a, v.b].forEach(p => addCut(i, project(p, w.a, r)));
      [w.a, w.b].forEach(p => addCut(j, project(p, v.a, s)));
    }
  }));
  const edges = new Map(), nodes = new Map();
  const at = (w, t) => ({ x: Math.round((w.a.x + (w.b.x - w.a.x) * t) * 1000) / 1000, y: Math.round((w.a.y + (w.b.y - w.a.y) * t) * 1000) / 1000 });
  exterior.forEach((wall, i) => {
    const ts = [...new Set(cuts[i].map(t => Math.round(t * 1e9) / 1e9))].sort((a, b) => a - b);
    for (let k = 0; k + 1 < ts.length; k += 1) {
      const a = at(wall, ts[k]), b = at(wall, ts[k + 1]), ka = pointKey(a), kb = pointKey(b);
      if (ka === kb) continue;
      const key = [ka, kb].sort().join("|");
      if (!edges.has(key)) {
        const edge = { key, a: ka, b: kb, owners: [] };
        edges.set(key, edge);
        for (const [from, to, p] of [[ka, kb, a], [kb, ka, b]]) {
          if (!nodes.has(from)) nodes.set(from, { p, links: [] });
          nodes.get(from).links.push({ to, edge });
        }
      }
      edges.get(key).owners.push({ wall, a, b, start: ts[k] * wallLength(wall), end: ts[k + 1] * wallLength(wall) });
    }
  });
  for (const node of nodes.values()) node.links.sort((a, b) => {
    const pa = nodes.get(a.to).p, pb = nodes.get(b.to).p;
    return Math.atan2(pa.y - node.p.y, pa.x - node.p.x) - Math.atan2(pb.y - node.p.y, pb.x - node.p.x);
  });
  const visited = new Set(), components = [], seenNodes = new Set();
  for (const start of nodes.keys()) {
    if (seenNodes.has(start)) continue;
    const component = [], pending = [start];
    while (pending.length) {
      const key = pending.pop();
      if (seenNodes.has(key)) continue;
      seenNodes.add(key); component.push(key);
      nodes.get(key).links.forEach(l => pending.push(l.to));
    }
    components.push(component);
  }
  const contours = [], boundary = new Set(), unresolved = new Set(), warnings = [];
  for (const component of components) {
    if (component.some(k => nodes.get(k).links.length < 2)) {
      warnings.push("Hay un contorno abierto: uní sus extremos para generar piso, techo y balcón.");
      component.forEach(k => nodes.get(k).links.forEach(link => unresolved.add(link.edge.key)));
      continue;
    }
    for (const start of component) for (const first of nodes.get(start).links) {
      if (visited.has(`${start}>${first.to}`)) continue;
      const polygon = [], faceEdges = [];
      let from = start, link = first;
      do {
        visited.add(`${from}>${link.to}`); polygon.push(nodes.get(from).p); faceEdges.push(link.edge.key);
        const node = nodes.get(link.to), reverse = node.links.findIndex(l => l.to === from);
        from = link.to; link = node.links[(reverse + node.links.length - 1) % node.links.length];
      } while ((from !== start || link.to !== first.to) && polygon.length <= edges.size * 2);
      // El recorrido exterior es horario; las caras interiores son antihorarias.
      if (polygon.length < 3 || polygonArea(polygon) >= -1e-6) continue;
      // Dos módulos que solo tocan una esquina mantienen dos pisos, sin unir el hueco entre ellos.
      const split = (loop) => {
        const seen = new Map();
        for (let i = 0; i < loop.length; i += 1) {
          const key = pointKey(loop[i]);
          if (seen.has(key)) { const j = seen.get(key); return [...split(loop.slice(j, i)), ...split([...loop.slice(0, j), ...loop.slice(i)])]; }
          seen.set(key, i);
        }
        return loop.length >= 3 ? [ensureCCW(simplifyPolygon(loop))] : [];
      };
      contours.push(...split(polygon)); faceEdges.forEach(k => boundary.add(k));
    }
  }
  const effectiveWalls = walls.filter(w => w.type !== "exterior");
  const pieces = [];
  for (const edge of edges.values()) {
    const owner = edge.owners[0], type = boundary.has(edge.key) || unresolved.has(edge.key) ? "exterior" : "interior";
    const last = pieces.find(p => p.wall === owner.wall && p.type === type && Math.abs(p.end - owner.start) < 1e-6);
    if (last) { last.b = owner.b; last.end = owner.end; last.owners.push(...edge.owners); }
    else pieces.push({ ...owner, type, owners: [...edge.owners] });
  }
  // No se parte una puerta o ventana en cruces que no cambian el tipo de muro.
  for (const piece of pieces) {
    const { wall, a, b, start, end, type } = piece;
    const whole = start < 1e-6 && Math.abs(end - wallLength(wall)) < 1e-6;
    const direction = wallDir({ a, b });
    const openings = piece.owners.flatMap(o => (o.wall.openings ?? []).map(op => {
      const origin = pointOnWall(o.wall, op.offset), same = wallDir(o.wall).x * direction.x + wallDir(o.wall).y * direction.y > 0;
      const offset = (origin.x - a.x) * direction.x + (origin.y - a.y) * direction.y - (same ? 0 : op.width);
      return { ...op, offset, ...(op.kind === "door" && !same ? { hinge: op.hinge === "end" ? "start" : "end", swing: -(op.swing ?? 1) } : {}) };
    })).filter((op, i, list) => op.offset >= -1e-6 && op.offset + op.width <= end - start + 1e-6 && list.findIndex(o => Math.abs(o.offset - op.offset) < 1e-6 && Math.abs(o.width - op.width) < 1e-6) === i);
    effectiveWalls.push({ ...wall, id: whole || start < 1e-6 ? wall.id : `${wall.id}:part:${start.toFixed(3)}`, a, b, openings,
      type, sourceWallId: wall.id, sourceWallIds: [...new Set(piece.owners.map(o => o.wall.id))], sourceOffset: start });
  }
  for (const wall of exterior) for (const opening of wall.openings ?? []) {
    if (!effectiveWalls.some(w => w.openings.some(o => o.id === opening.id))) warnings.push("Una abertura cruza el encuentro de dos estructuras: ajustá su posición o ancho.");
  }
  // Los contornos desconectados se conservan en el orden en que fueron dibujados.
  const regions = contours.map(polygon => ({ polygon, walls: effectiveWalls.filter(w => {
    const mid = { x: (w.a.x + w.b.x) / 2, y: (w.a.y + w.b.y) / 2 };
    return pointInPolygon(mid, polygon) || polygon.some((p, i) => {
      const q = polygon[(i + 1) % polygon.length], d = sub(q, p), r = sub(mid, p);
      return Math.abs(cross(d, r)) < 1e-6 && r.x * d.x + r.y * d.y >= -1e-6 && r.x * d.x + r.y * d.y <= d.x ** 2 + d.y ** 2 + 1e-6;
    });
  }) }));
  const rank = region => Math.min(...region.walls.map(w => walls.findIndex(original => original.id === (w.sourceWallId ?? w.id))));
  regions.sort((a, b) => rank(a) - rank(b));
  const polygons = regions.map(r => r.polygon);
  return { polygon: polygons[0] ?? null, polygons, regions, walls: effectiveWalls, closed: polygons.length > 0 && !warnings.length,
    warnings: warnings.length ? warnings : contours.length ? [] : ["El contorno exterior no cierra."] };
}

export function projectExtents(project) {
  const pts = allWalls(project).flatMap((w) => [w.a, w.b]);
  return pts.length ? bbox(pts) : { minX: 0, maxX: 6, minY: 0, maxY: 3 };
}

export function validateOpenings(project) {
  const warnings = [];
  project.levels.forEach((level) => {
    const prefix = project.levels.length > 1 ? `${level.name}, muro` : "Muro";
    level.walls.forEach((wall, index) => validateWall(wall, level.height, `${prefix} ${index + 1}`, warnings));
  });
  return warnings;
}

function validateWall(wall, height, label, warnings) {
  const L = wallLength(wall);
  const sorted = [...wall.openings].sort((a, b) => a.offset - b.offset);
  sorted.forEach((o, k) => {
    if (o.offset < 0.05 || o.offset + o.width > L - 0.05) {
      warnings.push(`${label}: una abertura queda fuera del muro o pegada al extremo.`);
    }
    const next = sorted[k + 1];
    if (next && o.offset + o.width > next.offset - 0.1) {
      warnings.push(`${label}: hay aberturas superpuestas o con menos de 10 cm entre sí.`);
    }
    if (o.sill + o.height > height - 0.1) {
      warnings.push(`${label}: una abertura es más alta que el muro.`);
    }
  });
}
