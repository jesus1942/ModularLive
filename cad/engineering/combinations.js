import { STRENGTH_COMBINATIONS, SERVICE_COMBINATIONS, USES } from "./data/reglamentos.js";

/** Genera alternativas ELU/ELS como datos; fuerzas y momentos son resultantes, no reacciones. */
export function computeCombinations(e, loadCases, wind, seismic) {
  const map = new Map(loadCases.map((c) => [c.id, c]));
  const combinations = [];
  const liveFactor = e.usage.some((u) => USES[u.use].L0_Pa > 5000 || USES[u.use].publicAssembly) || e.roofAccess === "terraza_publica" ? 1 : .5;
  const append = (id, state, reference, factors, template) => {
    const force_N = [0, 0, 0], moment_Nm = [0, 0, 0];
    for (const [caseId, factor] of Object.entries(factors)) {
      const c = map.get(caseId);
      if (!c || !factor) continue;
      for (let j = 0; j < 3; j += 1) { force_N[j] += factor * c.force_N[j]; moment_Nm[j] += factor * c.moment_Nm[j]; }
    }
    combinations.push({ id, state, template, reference, factors, force_N, moment_Nm, formula: Object.entries(factors).filter(([, f]) => f).map(([key, f]) => `${f}×${key}`).join(" + ") });
  };
  const roofCases = loadCases.filter((c) => c.kind === "Lr" || c.kind === "S");
  const make = (t, state, reference) => {
    const variable = t.W || t.Wa ? "W" : t.E ? "E" : null;
    const actions = variable ? loadCases.filter((c) => c.kind === variable) : [null];
    const roofs = t.roof ? [null, ...roofCases] : [null];
    for (const action of actions) for (const roof of roofs) for (const includeL of t.L ? [false, true] : [false]) {
      const factors = { D: t.D ?? 0 };
      if (includeL) factors.L = t.L === "f1" ? liveFactor : t.L;
      if (roof) factors[roof.id] = t.roof === "f1r" ? roof.kind === "S" ? .5 : liveFactor : t.roof;
      if (t.Lr) factors.Lr = t.Lr === "f1" ? liveFactor : t.Lr;
      if (t.S) factors["S:balanceada"] = t.S === "f2" ? e.snow.retain ? .7 : .2 : t.S;
      if (action) factors[action.id] = t.Wa ? t.Wa * (e.wind.serviceV_m_s / e.location.V) ** 2 : t.W ?? t.E;
      const id = `${state}:${t.id}:${action?.id ?? "gravedad"}:${roof?.id ?? "sin-techo-variable"}:${includeL ? "con-L" : "sin-L"}`;
      append(id, state, reference ?? t.reference, factors, t.id);
    }
  };
  STRENGTH_COMBINATIONS[e.codeEdition].forEach((t) => make(t, "ELU"));
  [{ id: "SD", D: 1 }, { id: "SDL", D: 1, L: 1 }, { id: "SL", L: 1 }, { id: "SDR", D: 1, roof: 1 }].forEach((t) => make(t, "ELS", "Criterio de servicio gravitatorio: D, D+L, L, D+(Lr o S); sin mayoración"));
  SERVICE_COMBINATIONS[e.codeEdition].forEach((t) => make(t, "ELS", e.codeEdition === "2025" ? "102-25 B.4.2;Wa con Vserv supuesto o aportado" : "Criterio de proyecto conservador con W nominal completo; no aplicar 0,7W sin base normativa"));
  // 103-I-2018 §3.7 prevalece para sismo: f1/f2 de Tabla3.3 también en ELU.
  if (seismic.cases.length) for (const action of seismic.cases) {
    const factors = { D: 1.2, [action.id]: 1 };
    for (const c of loadCases.filter((c) => c.kind === "L")) factors[c.id] = 1; // cota conservadora: no se reduce L global.
    factors["S:balanceada"] = e.snow.retain ? .7 : .2;
    append(`ELU:INPRES:${action.id}`, "ELU", "103-I-2018 §3.7.1 ec.3.16: L completo conservador;f2 Tabla3.3", factors, "INPRES");
  }
  const envelopes = ["ELU", "ELS"].map((state) => {
    const rows = combinations.filter((c) => c.state === state);
    return { state, force: [0, 1, 2].map((axis) => {
      const min = rows.reduce((a, b) => !a || b.force_N[axis] < a.force_N[axis] ? b : a, null);
      const max = rows.reduce((a, b) => !a || b.force_N[axis] > a.force_N[axis] ? b : a, null);
      return { axis, min_N: min?.force_N[axis] ?? null, max_N: max?.force_N[axis] ?? null, minCombination: min?.id ?? null, maxCombination: max?.id ?? null };
    }) };
  });
  return { combinations, envelopes, scope: "Resultantes de cargas de la vivienda respecto del origen global. Fundación excluida; no son reacciones, esfuerzo de barra ni comprobación de anclajes. C&R locales no se suman al viento global." };
}
