import { computeDeadLoad, computeLiveLoads } from "./loads.js";
import { normalizeEngineering } from "./settings.js";
import { computeWind } from "./wind.js";
import { computeSnow } from "./snow.js";
import { computeSeismic } from "./seismic.js";
import { computeCombinations } from "./combinations.js";
import { actionResultant } from "./load-geometry.js";
import { analyzeGeneration } from "./analysis.js";

export const ENGINE_VERSION = "0.3.0";
export const PROJECT_AUTHOR = "Jesús Olguín · jesus.olguin";

/** Ejecuta los chequeos efectivamente implementados sobre la generación que usa el 3D y el BOM. */
export function runEngineering(project, generation, { analyze = true } = {}) {
  if (generation.effectiveWalls) project = { ...project, levels: project.levels.map((level, i) => ({ ...level, walls: generation.effectiveWalls[i] })) };
  const e = normalizeEngineering(project.engineering, project.levels);
  const dead = computeDeadLoad({ ...project, engineering: e }, generation);
  const live = computeLiveLoads(project, generation, e, dead);
  const snow = computeSnow(project, generation, e);
  const wind = computeWind(project, generation, e);
  const seismic = computeSeismic(project, generation, e, dead, live.L, snow);
  const entries = dead.entries.filter((r) => r.kind !== "foundation").map((r) => ({ id: r.key, level: r.level, surfaceKey: r.surfaceKey, target: r.target, point_m: r.point_m, force_N: [0, 0, -r.weight_N] }));
  const D = { id: "D", kind: "D", label: "Peso modelado + equipos aportados", entries, ...actionResultant(entries) };
  const loadCases = [D, live.L, live.Lr, ...snow.cases, ...wind.cases, ...seismic.cases];
  const combined = computeCombinations(e, loadCases, wind, seismic);
  const analysis = analyze ? analyzeGeneration(project, generation, e, loadCases, combined.combinations, wind) : null;
  // Registro compacto: conserva fuerzas/IDs; el detalle está en las acciones, sin exportarlo dos veces.
  const caseRegistry = loadCases.map(({ id, kind, label, force_N, moment_Nm }) => ({ id, kind, label, force_N, moment_Nm }));
  return { version: ENGINE_VERSION, phase: analyze ? 2 : 1, author: PROJECT_AUTHOR, ...dead, codeEdition: e.codeEdition, deadCase: D, live, snow, wind, seismic, loadCases: caseRegistry, ...combined, analysis,
    assumptions: [...dead.assumptions, ...live.assumptions, ...snow.assumptions, ...wind.assumptions, ...seismic.assumptions, ...(analysis?.assumptions ?? [])],
    issues: [...new Set([...dead.issues, ...live.issues, ...snow.issues, ...wind.issues, ...seismic.issues, ...(analysis?.issues ?? [])])],
    notVerified: [...dead.notVerified.filter(s=>!analysis || !s.startsWith("Análisis, bajada")), ...(analysis?.notVerified ?? []), "Presiones bajo piso elevado (102-25 Fig.5.3-1A), parapetos, edificios abiertos y respuesta dinámica de viento: requieren casos específicos adicionales.", "Lluvia/embalsamiento y cargas de hielo; estados de montaje y acciones térmicas.", "Reparto sísmico por rigidez, centro de masa, regularidad, sobrerresistencia Ω0 y verificación de diafragmas y sistema lateral."] };
}
