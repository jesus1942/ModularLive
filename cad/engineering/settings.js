import { LOCATIONS, locationWind_m_s } from "./data/locations.js";
import { USES } from "./data/reglamentos.js";

/** Crea entradas independientes por proyecto; las unidades son SI salvo campos rotulados. */
export function defaultEngineering() {
  return {
    mode: "verify",
    codeEdition: "2025", jurisdiction: "", jurisdictionConfirmed: false,
    // 80,8 es un escenario conservador de comparación, NO una lectura local de Puerto Madryn.
    location: { preset: "puerto-madryn", V: 80.8, windEdition: "2025", windRisk: "II", exposure: "C", Kzt: 1, pg: 0.3, seismicZone: 0, frostDepth: 0.6, altitude: 0, confirmed: false, source: "" },
    importance: "II", usage: [], roofAccess: "inaccesible",
    wind: { enclosure: "potential", effectiveArea_m2: 1, serviceV_m_s: 35, serviceConfirmed: false, source: "" },
    snow: { Ce: 1, Ct: 1.2, retain: true, confirmed: false, source: "" },
    seismic: { site: "SE", riskGroup: "B", R: 1, confirmed: false, source: "" },
    extraLoads: [],
    soil: { qadm: 100, gamma: 17, phi: 28, mu: 0.45, pileSkinFriction: 20, pileTip: 400, subgradeModulus: 30000, confirmed: false, source: "" },
    steel: { grade: "F-24", Fy: 235e6, Fu: 370e6, E: 200e9, certified: false, source: "" },
    concrete: { grade: "H-21", fc: 21e6, rebarFy: 420e6, certified: false, source: "" },
    limits: { floorTotal: 300, floorLive: 360, roof: 200, cantilever: 150, drift: 400 },
    options: { bracing: "auto", baseFixity: "pinned", useSheathingAsShearWall: false },
    materialOverrides: {}, inputIssues: []
  };
}

const RANGES = {
  location: { V: [1, 150], Kzt: [0.1, 5], pg: [0, 30], seismicZone: [0, 4], frostDepth: [0, 5], altitude: [-500, 9000] },
  soil: { qadm: [1, 10000], gamma: [1, 40], phi: [0, 60], mu: [0, 2], pileSkinFriction: [1, 10000], pileTip: [1, 100000], subgradeModulus: [1, 1e7] },
  steel: { Fy: [1e6, 1e9], Fu: [1e6, 2e9], E: [1e9, 1e12] },
  concrete: { fc: [1e6, 150e6], rebarFy: [1e6, 1e9] },
  limits: { floorTotal: [1, 5000], floorLive: [1, 5000], roof: [1, 5000], cantilever: [1, 5000], drift: [1, 5000] },
  wind: { effectiveArea_m2: [.01, 1000], serviceV_m_s: [1, 150] },
  snow: { Ce: [.7, 1.3], Ct: [1, 1.3] }, seismic: { R: [1, 8] }
};

/** Normaliza diseños anteriores y conserva entradas/overrides; todo descarte deja un diagnóstico. */
export function normalizeEngineering(raw, levels) {
  const defaults = defaultEngineering();
  const input = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const next = { ...defaults, ...input };
  next.inputIssues = Array.isArray(input.inputIssues) ? input.inputIssues.filter((v) => typeof v === "string") : [];
  const issue = (text) => { if (!next.inputIssues.includes(text)) next.inputIssues.push(text); };
  for (const group of ["location", "soil", "steel", "concrete", "limits", "options", "wind", "snow", "seismic"]) {
    const values = input[group] && typeof input[group] === "object" ? input[group] : {};
    next[group] = { ...defaults[group], ...values };
    for (const [key, [min, max]] of Object.entries(RANGES[group] ?? {})) {
      const value = values[key];
      if (value === undefined) continue;
      const numeric = typeof value === "number" || (typeof value === "string" && value.trim());
      const n = numeric ? Number(value) : NaN;
      if (Number.isFinite(n) && n >= min && n <= max && (key !== "seismicZone" || Number.isInteger(n))) next[group][key] = n;
      else {
        next[group][key] = defaults[group][key];
        next[group].confirmed = false;
        next[group].certified = false;
        issue(`Dato inválido engineering.${group}.${key}: se usa ${defaults[group][key]} como supuesto.`);
      }
    }
    if ("source" in next[group]) next[group].source = typeof next[group].source === "string" ? next[group].source.trim() : "";
    if ("confirmed" in next[group]) next[group].confirmed = next[group].confirmed === true;
    if ("certified" in next[group]) next[group].certified = next[group].certified === true;
  }
  if (!LOCATIONS[next.location.preset] && next.location.preset !== "manual") {
    next.location.preset = "manual";
    next.location.confirmed = false;
    issue("Ubicación desconocida: se conserva el escenario manual, sin datos locales confirmados.");
  }
  if (!["B", "C", "D"].includes(next.location.exposure)) {
    next.location.exposure = "C";
    next.location.confirmed = false;
    issue("Exposición inválida: se usa C como supuesto.");
  }
  if (!["verify", "auto"].includes(next.mode)) { next.mode = "verify"; issue("Modo desconocido: se usa verificar."); }
  if (!["2005", "2025"].includes(next.codeEdition)) { next.codeEdition = "2025"; issue("Edición desconocida: se usa 2025, a confirmar por jurisdicción."); }
  if (!input.codeEdition && input.location?.V !== undefined) {
    // No convertir 58 m/s nominales en velocidad última 2025 ni preservar su confirmación.
    next.location.windEdition = "2005";
    next.location.confirmed = false;
    issue("Diseño de fase 0: la velocidad heredada corresponde a un escenario 2005. Confirmá una velocidad de la edición seleccionada.");
  }
  if (next.location.windEdition !== next.codeEdition) {
    next.location.V = next.codeEdition === "2025" ? 80.8 : 58;
    next.location.windEdition = next.codeEdition;
    next.location.confirmed = false;
    next.location.source = "";
    issue(`Cambio de edición: V = ${next.location.V} m/s es un escenario supuesto ${next.codeEdition}; confirmá el mapa local.`);
  }
  next.jurisdiction = typeof input.jurisdiction === "string" ? input.jurisdiction.trim() : "";
  next.jurisdictionConfirmed = input.jurisdictionConfirmed === true && !!next.jurisdiction;
  if (!["I", "II", "III", "IV"].includes(next.importance)) { next.importance = "II"; issue("Categoría de riesgo inválida: se usa II supuesta."); }
  if (next.codeEdition === "2025" && next.location.windRisk !== next.importance) {
    // El riesgo está en el mapa 2025: también se controla al importar JSON, no sólo desde el DOM.
    next.location.V = locationWind_m_s(next.location.preset, "2025", next.importance) ?? (["III", "IV"].includes(next.importance) ? 88.7 : 80.8);
    next.location.confirmed = false;
    next.location.source = "";
    issue(`Cambio de riesgo: la velocidad anterior no corresponde al mapa ${next.importance}. V=${next.location.V} m/s a confirmar.`);
  }
  next.location.windRisk = next.importance;
  if (!["inaccesible", "terraza", "terraza_publica"].includes(next.roofAccess)) { next.roofAccess = "inaccesible"; issue("Acceso a cubierta desconocido: se usa mantenimiento supuesto."); }
  for (const [group, key, allowed] of [["wind", "enclosure", ["potential", "closed", "partial"]], ["seismic", "site", ["SA", "SB", "SC", "SD", "SE", "SF"]], ["seismic", "riskGroup", ["Ao", "A", "B", "C"]]]) {
    if (!allowed.includes(next[group][key])) { next[group][key] = defaults[group][key]; next[group].confirmed = false; issue(`Dato inválido engineering.${group}.${key}: se usa un supuesto.`); }
  }
  next.snow.retain = input.snow?.retain !== false;
  next.wind.serviceConfirmed = input.wind?.serviceConfirmed === true && !!next.wind.source;
  next.materialOverrides = input.materialOverrides && typeof input.materialOverrides === "object" && !Array.isArray(input.materialOverrides)
    ? structuredClone(input.materialOverrides) : {};
  next.usage = levels.map((level, index) => {
    const old = Array.isArray(input.usage)
      ? input.usage.find((u) => u?.levelId === level.id) ?? input.usage.find((u) => u?.level === index)
      : null;
    const use = USES[old?.use] ? old.use : "vivienda";
    if (old?.use && !USES[old.use]) issue(`Uso ${old.use} desconocido en ${level.name}: se usa vivienda supuesta.`);
    return { level: index, levelId: level.id, use };
  });
  next.extraLoads = [];
  for (const [index, load] of (Array.isArray(input.extraLoads) ? input.extraLoads : []).entries()) {
    const level = levels.findIndex((l) => l.id === load?.levelId);
    if (level < 0 || !["floor", "roof"].includes(load?.target) || ![load.x_m, load.y_m, load.force_N].every(Number.isFinite) || load.force_N <= 0 || load.force_N > 1e7) {
      issue(`Carga permanente ${index + 1} inválida o sin nivel: no se pudo incluir.`); continue;
    }
    next.extraLoads.push({ id: typeof load.id === "string" ? load.id : `extra-${index}`, levelId: levels[level].id, target: load.target,
      x_m: load.x_m, y_m: load.y_m, force_N: load.force_N, label: String(load.label || "Equipo permanente"), source: String(load.source || ""), confirmed: load.confirmed === true });
  }
  return next;
}
