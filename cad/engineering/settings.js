import { LOCATIONS } from "./data/locations.js";

/** Crea entradas independientes por proyecto; las unidades son SI salvo campos rotulados. */
export function defaultEngineering() {
  return {
    mode: "verify",
    location: { preset: "puerto-madryn", V: 58, exposure: "C", Kzt: 1, pg: 0.3, seismicZone: 0, frostDepth: 0.6, altitude: 0, confirmed: false, source: "" },
    importance: "II", usage: [], roofAccess: "inaccesible",
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
  limits: { floorTotal: [1, 5000], floorLive: [1, 5000], roof: [1, 5000], cantilever: [1, 5000], drift: [1, 5000] }
};

/** Normaliza diseños anteriores y conserva entradas/overrides; todo descarte deja un diagnóstico. */
export function normalizeEngineering(raw, levels) {
  const defaults = defaultEngineering();
  const input = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const next = { ...defaults, ...input };
  next.inputIssues = Array.isArray(input.inputIssues) ? input.inputIssues.filter((v) => typeof v === "string") : [];
  const issue = (text) => { if (!next.inputIssues.includes(text)) next.inputIssues.push(text); };
  for (const group of ["location", "soil", "steel", "concrete", "limits", "options"]) {
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
  next.materialOverrides = input.materialOverrides && typeof input.materialOverrides === "object" && !Array.isArray(input.materialOverrides)
    ? structuredClone(input.materialOverrides) : {};
  next.usage = levels.map((level, index) => {
    const old = Array.isArray(input.usage)
      ? input.usage.find((u) => u?.levelId === level.id) ?? input.usage.find((u) => u?.level === index)
      : null;
    return { level: index, levelId: level.id, use: old?.use ?? "vivienda" };
  });
  return next;
}
