// Loft modular: una caja de doble altura con altillo (entrepiso parcial) sobre un extremo,
// vacío sobre el estar, escalera recta contra el muro del fondo y baranda en el borde del altillo.
// Se arma con las mismas piezas del diseñador: dos niveles con el mismo contorno y un vacío
// en el entrepiso. Por eso el cómputo, el 3D y la ingeniería salen del mismo modelo.
import { PROFILES, SYSTEMS } from "./catalog.js";
import { STAIR_DEFAULTS, createDefaultProject, createLevel, createRectangle, newId, normalizeProject } from "./model.js";
import { solveRisers, stairRules } from "./stairs.js";

export const LOFT_DEFAULTS = {
  length: 8.4, // largo exterior (m), sentido del estar al altillo
  width: 3.6, // ancho exterior (m)
  lowerHeight: 2.6, // altura de la planta baja al bastidor
  upperHeight: 2.4, // altura del altillo al bastidor
  mezzanine: 3, // profundidad del altillo (m)
  stair: true
};

export const LOFT_LIMITS = {
  length: [4, 18],
  width: [2.4, 7.2],
  lowerHeight: [2.3, 3.2],
  upperHeight: [2.1, 3.2],
  mezzanine: [1.8, 12]
};

const DECK = 0.018;
const WALL_FACE = 0.07; // de eje de muro a cara interior
const win = (offset, width, height, sill) => ({ id: newId("o"), kind: "window", offset: Math.round(offset * 100) / 100, width, height, sill });

/** Ventanas iguales repartidas en un tramo [from, to] de un muro. */
function spread(from, to, width, height, sill) {
  const room = to - from;
  const n = Math.max(0, Math.floor((room - 0.5) / (width + 0.5)));
  if (!n) return [];
  const gap = (room - n * width) / (n + 1);
  return Array.from({ length: n }, (_, i) => win(from + gap + i * (width + gap), width, height, sill));
}

/**
 * Devuelve { project, notes } con el loft armado, o { error } si las medidas no dan.
 * base: proyecto actual, del que se conservan sistema, fundación, revestimientos e ingeniería.
 */
export function buildLoft(input = {}, base = null) {
  const cfg = { ...LOFT_DEFAULTS, ...input };
  for (const [key, [lo, hi]] of Object.entries(LOFT_LIMITS)) {
    const v = Number(cfg[key]);
    if (!Number.isFinite(v) || v < lo || v > hi) return { error: `${LOFT_LABELS[key]}: entre ${String(lo).replace(".", ",")} y ${String(hi).replace(".", ",")} m.` };
    cfg[key] = v;
  }
  const { length: L, width: W, lowerHeight, upperHeight, mezzanine } = cfg;
  const voidLen = L - mezzanine;
  if (voidLen < 1.8) return { error: "El altillo ocupa casi todo el largo: dejá al menos 1,80 m de doble altura." };

  const start = base ? JSON.parse(JSON.stringify(base)) : createDefaultProject();
  const system = SYSTEMS[start.system] ?? SYSTEMS.steel_tube;
  const ringH = (PROFILES[start.mainFrame] ?? PROFILES[system.roles.ringBeam]).h;
  const notes = [];

  // Planta baja: estar de doble altura (x de 0 a voidLen) y zona bajo el altillo (de voidLen a L)
  const low = createRectangle(0, 0, L, W);
  const up = createRectangle(0, 0, L, W);
  const glassLow = Math.min(2, lowerHeight - 0.5);
  const glassUp = Math.min(1.4, upperHeight - 0.5);
  // El frente vidriado es el muro largo de y = W (el que mira la vista 3D inicial).
  // Ese muro corre de x = L a x = 0, así que cada posición en x se pasa a distancia desde su inicio.
  const flip = (list) => list.map((o) => ({ ...o, offset: Math.round((L - o.offset - o.width) * 100) / 100 }));
  low[2].openings = flip([
    ...spread(0.3, voidLen - 0.2, 1.8, glassLow, 0.3),
    { id: newId("o"), kind: "door", offset: Math.round((voidLen + 0.4) * 100) / 100, width: 0.9, height: Math.min(2.1, lowerHeight - 0.2), sill: 0, hinge: "start", swing: 1 },
    ...(mezzanine >= 3 ? [win(voidLen + 1.6, Math.min(1.2, mezzanine - 1.9), 1, 1)] : [])
  ]);
  up[2].openings = flip([
    ...spread(0.3, voidLen - 0.2, 1.8, glassUp, 0.3),
    ...spread(voidLen + 0.2, L - 0.2, 1.2, 1, 1).slice(0, 1)
  ]);
  // testero del estar (x = 0): vidriado en las dos alturas
  if (W >= 2.6) {
    const w = Math.min(1.8, W - 0.8);
    low[3].openings = [win((W - w) / 2, w, glassLow, 0.3)];
    up[3].openings = [win((W - w) / 2, w, glassUp, 0.3)];
  }
  // testero del altillo (x = L): ventilación abajo y ventana arriba
  low[1].openings = [win(Math.max(0.4, W / 2 - 0.3), 0.6, 0.6, 1.5)];
  up[1].openings = [win(Math.max(0.4, (W - 1.2) / 2), Math.min(1.2, W - 0.8), 1, 1)];

  const lower = createLevel(0, low, lowerHeight);
  const upper = createLevel(1, up, upperHeight);
  upper.name = "Altillo";
  upper.voids = [{ id: newId("v"), x0: 0, y0: 0, x1: Math.round(voidLen * 1000) / 1000, y1: W }];

  // Escalera recta contra el muro del fondo, que llega justo al borde del altillo
  if (cfg.stair) {
    const sol = solveRisers(lowerHeight + ringH + DECK, stairRules(STAIR_DEFAULTS.ruleSet));
    const run = sol.ok ? (sol.n - 1) * sol.p : Infinity;
    if (!sol.ok) notes.push("No se pudo resolver la escalera con esa altura de planta baja.");
    else if (run + 0.9 > voidLen) {
      notes.push(`La escalera recta necesita ${String(Math.round((run + 0.9) * 100) / 100).replace(".", ",")} m de doble altura y hay ${String(Math.round(voidLen * 100) / 100).replace(".", ",")} m: alargá el loft o achicá el altillo. Quedó sin escalera.`);
    } else {
      lower.stairs = [{
        id: newId("s"), ...STAIR_DEFAULTS, kind: "recta", dir: 0,
        x: Math.round((voidLen - run) * 1000) / 1000,
        y: Math.round((WALL_FACE + STAIR_DEFAULTS.width / 2) * 1000) / 1000
      }];
    }
  }
  if (W > system.defaults.maxJoistSpan) notes.push(`Con ${String(W).replace(".", ",")} m de ancho las viguetas superan la luz recomendada: hace falta una viga intermedia.`);

  const project = normalizeProject({
    ...start,
    name: "Loft modular",
    levels: [lower, upper],
    roof: { type: "una_agua", slope: 10, overhang: start.roof?.overhang ?? 0.25 },
    engineering: { ...(start.engineering ?? {}), usage: undefined }
  });
  return { project, notes, voidLen };
}

export const LOFT_LABELS = {
  length: "Largo exterior",
  width: "Ancho exterior",
  lowerHeight: "Altura de planta baja",
  upperHeight: "Altura del altillo",
  mezzanine: "Profundidad del altillo"
};
