// Cómputo rápido: de unas pocas medidas a un diseño completo.
// No tiene fórmulas propias: arma el mismo modelo que el diseñador (muros, aberturas, niveles)
// y lo pasa por el mismo generador y el mismo cómputo. Así las cantidades coinciden siempre.
import { FOUNDATIONS, ROOF_TYPES, SHEETS } from "./catalog.js";
import { DEFAULT_SETTINGS, createDefaultProject, createLevel, createRectangle, newId, normalizeProject } from "./model.js";
import { allItems, cloneItems } from "./clone.js";
import { buildLoft } from "./loft.js";

export const QUICK_PRESETS = {
  vivienda: {
    label: "Vivienda",
    length: 6, width: 3, height: 2.6,
    windowCount: 4, windowWidth: 1.2, windowHeight: 1, windowSill: 1,
    doorCount: 1, doorWidth: 0.9, doorHeight: 2.1,
    exterior: "chapa_sinusoidal", interior: "durlock", roofCladding: "chapa_sinusoidal"
  },
  oficina: {
    label: "Oficina",
    length: 7.2, width: 3, height: 2.7,
    windowCount: 5, windowWidth: 1.2, windowHeight: 1, windowSill: 1,
    doorCount: 1, doorWidth: 0.9, doorHeight: 2.1,
    exterior: "chapa_sinusoidal", interior: "durlock", roofCladding: "chapa_trapezoidal"
  },
  bano: {
    label: "Baño",
    length: 3, width: 2.4, height: 2.5,
    windowCount: 1, windowWidth: 0.6, windowHeight: 0.6, windowSill: 1.5,
    doorCount: 1, doorWidth: 0.8, doorHeight: 2,
    exterior: "cementicia", interior: "durlock_verde", roofCladding: "chapa_trapezoidal"
  },
  loft: {
    label: "Loft con altillo",
    length: 8.4, width: 3.6, height: 2.6, upperHeight: 2.4, mezzanine: 3,
    exterior: "chapa_trapezoidal", interior: "durlock", roofCladding: "chapa_trapezoidal",
    roofType: "una_agua", slope: 10
  }
};

export const QUICK_DEFAULTS = {
  name: "Proyecto modular",
  preset: "vivienda",
  ...QUICK_PRESETS.vivienda,
  upperHeight: 2.4,
  mezzanine: 3,
  modules: 1,
  mirror: false,
  roofType: "plano",
  slope: ROOF_TYPES.plano.defaultSlope,
  overhang: 0.25,
  foundation: "dados",
  wallSpacing: DEFAULT_SETTINGS.wallSpacing,
  floorSpacing: DEFAULT_SETTINGS.floorSpacing,
  roofSpacing: DEFAULT_SETTINGS.roofSpacing,
  waste: DEFAULT_SETTINGS.wasteFactor,
  stock: DEFAULT_SETTINGS.stockLength,
  laborRate: 0
};

const RANGES = {
  length: [1.5, 18], width: [1.5, 7.2], height: [2, 4.5], upperHeight: [2.1, 3.2], mezzanine: [1.8, 12],
  modules: [1, 20], windowCount: [0, 40], windowWidth: [0.4, 4], windowHeight: [0.3, 3], windowSill: [0, 2.5],
  doorCount: [0, 10], doorWidth: [0.6, 3], doorHeight: [1.8, 3], slope: [0, 100], overhang: [0, 1.2],
  wallSpacing: [0.3, 1.2], floorSpacing: [0.3, 1], roofSpacing: [0.3, 1.2], waste: [0, 30], stock: [3, 12], laborRate: [0, 1e9]
};

/** Lleva cada dato a un valor válido; lo que no se entiende vuelve al valor por defecto. */
export function normalizeQuick(raw = {}) {
  const input = { ...QUICK_DEFAULTS, ...raw };
  if (!QUICK_PRESETS[input.preset] && input.preset !== "custom") input.preset = "vivienda";
  for (const [key, [lo, hi]] of Object.entries(RANGES)) {
    const v = Number(input[key]);
    input[key] = Number.isFinite(v) ? Math.min(Math.max(v, lo), hi) : QUICK_DEFAULTS[key];
  }
  ["modules", "windowCount", "doorCount"].forEach((k) => { input[k] = Math.round(input[k]); });
  input.mirror = input.mirror === true || input.mirror === "true" || input.mirror === "on" || input.mirror === "1";
  if (!ROOF_TYPES[input.roofType]) input.roofType = "plano";
  if (!FOUNDATIONS[input.foundation]) input.foundation = "dados";
  ["exterior", "interior", "roofCladding"].forEach((k) => { if (!SHEETS[input[k]]) input[k] = QUICK_DEFAULTS[k]; });
  input.name = String(input.name ?? "").trim().slice(0, 80) || QUICK_DEFAULTS.name;
  return input;
}

/**
 * Reparte puertas y ventanas en los cuatro muros: las puertas al frente, las ventanas
 * donde queda más lugar, todas centradas en tramos iguales. Devuelve lo que no entró.
 */
export function placeOpenings(walls, input) {
  const L = (w) => Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y);
  const lists = walls.map(() => []);
  // lugar libre por abertura si se agrega una más: tiene que quedar 0,30 m entre aberturas y a los extremos
  const slack = (i, width) => {
    const used = lists[i].reduce((sum, o) => sum + o.width, 0) + width;
    return (L(walls[i]) - used) / (lists[i].length + 2);
  };
  const missed = { doors: 0, windows: 0 };
  const put = (kind, width, extra, order) => {
    const best = order.map((i) => ({ i, s: slack(i, width) })).filter((c) => c.s >= 0.3).sort((a, b) => b.s - a.s)[0];
    if (!best) { missed[kind === "door" ? "doors" : "windows"] += 1; return; }
    lists[best.i].push({ kind, width, ...extra });
  };
  const maxHeight = input.height - 0.1;
  for (let k = 0; k < input.doorCount; k += 1) {
    // el frente es el muro largo que mira la vista 3D inicial
    const front = slack(2, input.doorWidth) >= 0.3 ? [2] : [0, 1, 3];
    put("door", input.doorWidth, { height: Math.min(input.doorHeight, maxHeight), sill: 0, hinge: "start", swing: 1 }, front);
  }
  const sill = Math.min(input.windowSill, Math.max(0, maxHeight - input.windowHeight));
  for (let k = 0; k < input.windowCount; k += 1) {
    put("window", input.windowWidth, { height: Math.min(input.windowHeight, maxHeight - sill), sill }, [2, 0, 1, 3]);
  }
  walls.forEach((wall, i) => {
    const list = lists[i];
    // la puerta va al centro del muro y las ventanas a los lados
    const doors = list.filter((o) => o.kind === "door");
    const windows = list.filter((o) => o.kind === "window");
    const half = Math.ceil(windows.length / 2);
    const ordered = [...windows.slice(0, half), ...doors, ...windows.slice(half)];
    const gap = (L(wall) - ordered.reduce((sum, o) => sum + o.width, 0)) / (ordered.length + 1);
    let cursor = gap;
    wall.openings = ordered.map((o) => {
      const opening = { id: newId("o"), ...o, offset: Math.round(cursor * 1000) / 1000 };
      cursor += o.width + gap;
      return opening;
    });
  });
  return missed;
}

/** Arma el proyecto del diseñador que corresponde a los datos del cómputo rápido. */
export function quickProject(raw = {}) {
  const input = normalizeQuick(raw);
  const notes = [];
  const base = createDefaultProject();
  base.name = input.name;
  base.settings = {
    ...base.settings,
    wallSpacing: input.wallSpacing, floorSpacing: input.floorSpacing, roofSpacing: input.roofSpacing,
    wasteFactor: input.waste, stockLength: input.stock,
    wallExteriorCladding: input.exterior, wallInteriorLining: input.interior, roofCladding: input.roofCladding
  };
  base.foundation = { ...FOUNDATIONS[input.foundation].defaults, type: input.foundation };
  base.roof = { type: input.roofType, slope: input.slope, overhang: input.overhang };

  let project;
  if (input.preset === "loft") {
    const loft = buildLoft({ length: input.length, width: input.width, lowerHeight: input.height, upperHeight: input.upperHeight, mezzanine: input.mezzanine }, base);
    if (loft.error) return { input, error: loft.error };
    project = loft.project;
    project.name = input.name;
    project.roof = { ...project.roof, type: input.roofType, slope: input.slope, overhang: input.overhang, overhangs: undefined };
    notes.push(...loft.notes);
  } else {
    const walls = createRectangle(0, 0, input.length, input.width);
    const missed = placeOpenings(walls, input);
    if (missed.doors) notes.push(`${missed.doors === 1 ? "No entró 1 puerta" : `No entraron ${missed.doors} puertas`} con 30 cm entre aberturas: achicá su ancho o agrandá el módulo.`);
    if (missed.windows) notes.push(`${missed.windows === 1 ? "No entró 1 ventana" : `No entraron ${missed.windows} ventanas`} con 30 cm entre aberturas: achicá su ancho o agrandá el módulo.`);
    const level = createLevel(0, walls, input.height);
    project = normalizeProject({ ...base, levels: [level], engineering: { ...base.engineering, usage: undefined } });
  }

  // Varios módulos iguales, separados 1 m: cada uno con sus muros, piso, techo y fundación.
  if (input.modules > 1) {
    cloneItems(project, 0, allItems(project.levels[0]), { count: input.modules - 1, direction: "right", gap: 1, mirror: input.mirror, allLevels: true });
    project = normalizeProject(project);
  }
  return { input, project, notes };
}
