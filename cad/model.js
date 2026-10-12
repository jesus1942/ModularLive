// Modelo de obra: niveles apilados, cada uno con muros en planta (eje) y aberturas;
// fundación, piso y techo.
import {
  bbox,
  dist,
  ensureCCW,
  pointInPolygon,
  pointKey,
  pointOnWall,
  simplifyPolygon,
  wallDir,
  wallLength
} from "./geometry.js";
import { FOUNDATIONS, ROOF_TYPES, SYSTEMS } from "./catalog.js";
import { defaultEngineering, normalizeEngineering } from "./engineering/settings.js";

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
  return { id: newId("l"), name: levelName(index), height, walls };
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
  project.levels = rawLevels.map((level, index) => ({
    id: level.id ?? newId("l"),
    name: level.name || levelName(index),
    height: Math.min(Math.max(Number(level.height) || project.settings.wallHeight, 2), 4.5),
    walls: normalizeWalls(level.walls ?? [])
  }));
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
 * Busca el contorno exterior: los muros exteriores deben formar un único circuito cerrado.
 * Devuelve { polygon, closed, warnings }.
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
    warnings.push(
      "El contorno exterior no está cerrado o tiene muros superpuestos. Uní los extremos de los muros exteriores."
    );
    return { polygon: null, closed: false, warnings };
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
    warnings.push("Hay muros exteriores que no forman parte del contorno principal; se marcan como sueltos.");
  }
  if (currentKey !== startKey) {
    return { polygon: null, closed: false, warnings: ["El contorno exterior no cierra."] };
  }
  return { polygon: ensureCCW(simplifyPolygon(polygon)), closed: true, warnings };
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
