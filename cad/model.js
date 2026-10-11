// Modelo de obra: muros en planta (eje), aberturas sobre muros, fundación, piso y techo.
import {
  bbox,
  dist,
  ensureCCW,
  pointKey,
  simplifyPolygon,
  wallLength
} from "./geometry.js";
import { FOUNDATIONS, ROOF_TYPES, SYSTEMS } from "./catalog.js";

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

/** Proyecto inicial: módulo 3 × 6 m, equivalente al preset "vivienda" de la calculadora. */
export function createDefaultProject() {
  const walls = createRectangle(0, 0, 6, 3);
  // muro inferior (y=0, largo 6): puerta + 2 ventanas
  walls[0].openings = [
    { id: newId("o"), kind: "window", offset: 0.6, width: 1.2, height: 1, sill: 1 },
    { id: newId("o"), kind: "door", offset: 2.55, width: 0.9, height: 2.1, sill: 0 },
    { id: newId("o"), kind: "window", offset: 4.2, width: 1.2, height: 1, sill: 1 }
  ];
  walls[2].openings = [
    { id: newId("o"), kind: "window", offset: 2.4, width: 1.2, height: 1, sill: 1 }
  ];
  walls[1].openings = [
    { id: newId("o"), kind: "window", offset: 0.9, width: 1.2, height: 1, sill: 1 }
  ];
  return {
    version: 1,
    name: "Vivienda modular",
    system: "steel_tube",
    mainFrame: "tubo_100x100x3_2",
    walls,
    foundation: { type: "dados", ...FOUNDATIONS.dados.defaults },
    roof: { type: "plano", slope: ROOF_TYPES.plano.defaultSlope, overhang: 0.25 },
    settings: { ...DEFAULT_SETTINGS }
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
  project.walls = (raw?.walls ?? base.walls)
    .filter((w) => w && w.a && w.b && dist(w.a, w.b) > 0.05)
    .map((w) => ({
      id: w.id ?? newId("w"),
      type: w.type === "interior" ? "interior" : "exterior",
      a: { x: Number(w.a.x), y: Number(w.a.y) },
      b: { x: Number(w.b.x), y: Number(w.b.y) },
      openings: (w.openings ?? []).map((o) => ({
        id: o.id ?? newId("o"),
        kind: o.kind === "door" ? "door" : "window",
        offset: Number(o.offset) || 0,
        width: Number(o.width) || 0.9,
        height: Number(o.height) || 1,
        sill: o.kind === "door" ? 0 : Number(o.sill ?? 1)
      }))
    }));
  return project;
}

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
  const pts = project.walls.flatMap((w) => [w.a, w.b]);
  return pts.length ? bbox(pts) : { minX: 0, maxX: 6, minY: 0, maxY: 3 };
}

export function validateOpenings(project) {
  const warnings = [];
  project.walls.forEach((wall, index) => {
    const L = wallLength(wall);
    const sorted = [...wall.openings].sort((a, b) => a.offset - b.offset);
    sorted.forEach((o, k) => {
      if (o.offset < 0.05 || o.offset + o.width > L - 0.05) {
        warnings.push(`Muro ${index + 1}: una abertura queda fuera del muro o pegada al extremo.`);
      }
      const next = sorted[k + 1];
      if (next && o.offset + o.width > next.offset - 0.1) {
        warnings.push(`Muro ${index + 1}: hay aberturas superpuestas o con menos de 10 cm entre sí.`);
      }
      if (o.sill + o.height > project.settings.wallHeight - 0.1) {
        warnings.push(`Muro ${index + 1}: una abertura es más alta que el muro.`);
      }
    });
  });
  return warnings;
}
