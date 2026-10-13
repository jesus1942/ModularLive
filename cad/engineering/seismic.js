import { bbox } from "../geometry.js";
import { SEISMIC_RISK, SEISMIC_SPECTRA, SEISMIC_AS, SEISMIC_T3_s, USES, SOURCES } from "./data/reglamentos.js";
import { actionResultant } from "./load-geometry.js";

/** Coeficiente estático C, período aproximado de otros sistemas; 103-I §§3.5 y 6.2. */
export function seismicCoefficient({ zone, site, height_m, R, riskGroup }) {
  if (!Number.isInteger(zone) || zone < 1 || zone > 4 || site === "SF" || !(R >= 1) || !(height_m > 0)) return null;
  const row = SEISMIC_SPECTRA[site === "SB" || site === "SC" ? "SA" : site]?.[zone - 1];
  if (!row) return null;
  const [Ca, Cv] = row, gamma = SEISMIC_RISK[riskGroup];
  const T_s = .0488 * height_m ** .75, T2_s = Cv / (2.5 * Ca), T3_s = SEISMIC_T3_s[zone - 1];
  const Sa = T_s <= T2_s ? 2.5 * Ca : T_s <= T3_s ? Cv / T_s : Cv * T3_s / T_s ** 2;
  const minimum = zone >= 3 ? .8 * SEISMIC_AS[zone - 1] * 1.2 / R : .11 * Ca * gamma;
  return { C: Math.max(Sa * gamma / R, minimum), Ca, Cv, gamma, R, T_s, T2_s, T3_s, Sa, minimum, verticalFactor: Ca * gamma / 2,
    reference: "103-I-2018 Tabla3.1/3.2;ec.6.3/6.4/6.5/6.6;Ta ec.6.8 (otros sistemas);Ev ec.3.10" };
}

/** Distribuye V0 por Wi·hi; para T>2T2 agrega 10 % en el nivel superior, §6.2.4.1. */
export function distributeSeismic_N(weights_N, heights_m, C, topFraction = 0) {
  const W_N = weights_N.reduce((a, b) => a + b, 0), V0_N = C * W_N;
  const denominator = weights_N.reduce((s, w, i) => s + w * heights_m[i], 0);
  return { W_N, V0_N, forces_N: weights_N.map((w, i) => denominator > 0 ? (1 - topFraction) * V0_N * w * heights_m[i] / denominator + (i === weights_N.length - 1 ? topFraction * V0_N : 0) : 0) };
}

/** Acciones E preliminares, cuatro sentidos, Ev± y torsión accidental ±5 %; sin reparto resistente. */
export function computeSeismic(project, gen, e, dead, live, snow) {
  const cases = [], issues = [], assumptions = [];
  const result = { source: SOURCES.seismic, cases, issues, assumptions, zone: e.location.seismicZone, status: "review" };
  if (gen.levels.some(lv => lv.footprints?.length > 1)) {
    issues.push("Estructuras independientes: la acción sísmica se debe resolver por edificio; no se usa el centro de la primera huella para repartir la masa de todas.");
    return result;
  }
  const height = Math.max(0, ...gen.levels.map((l) => l.zTop));
  const zone = e.location.seismicZone;
  if (!e.seismic.confirmed || !e.seismic.source) assumptions.push({ id: "seismic:system", scope: "sismo", message: `Sitio ${e.seismic.site}, grupo ${e.seismic.riskGroup} y R=${e.seismic.R} supuestos; requiere estudio de suelos y sistema lateral certificado. R=1 inicial no aprovecha ductilidad.` });
  if (zone === 0 && e.seismic.riskGroup !== "Ao" && project.levels.length <= 3 && height <= 12) {
    result.exempt = true;
    result.exemption = "103-I-2018 §2.5.2(b): construcción ≤3 pisos y ≤12 m, grupo distinto de Ao. Sólo válido si se confirma zona 0 y grupo.";
    return result;
  }
  if (zone === 0 && e.seismic.riskGroup === "Ao") { issues.push("Zona 0, grupo Ao: exige aplicación íntegra (§2.5.2a). Espectro de sitio debe determinarlo el profesional; no se calcula E con coeficientes de zona 1."); return result; }
  const coefficient = zone === 0 ? { C: .015, verticalFactor: 0, T_s: 0, T2_s: 1, reference: "103-I §2.5.2(c): fuerza horizontal mínima 1,5 % en cada centro de gravedad; arriostramiento de fundaciones pendiente" }
    : seismicCoefficient({ zone, site: e.seismic.site, height_m: height, R: e.seismic.R, riskGroup: e.seismic.riskGroup });
  if (!coefficient) { issues.push("Sismo sin calcular: sitio SF o espectro fuera de alcance. Requiere respuesta de sitio específica."); return result; }
  const liveRows = live.entries;
  const levels = gen.levels.map((lv, i) => {
    const D_N = dead.levels[i].weight_N;
    const use = USES[e.usage[i].use], f1 = use.seismicParticipation;
    const floorL_N = -liveRows.filter((r) => r.level === i && r.target === "floor").reduce((s, r) => s + r.force_N[2], 0);
    const roofL = liveRows.filter((r) => r.level === i && r.target === "roof").reduce((s, r) => s - r.force_N[2], 0);
    const S_N = snow.rows.filter((r) => r.level === i).reduce((s, r) => s - r.force_N[2], 0), f2 = e.snow.retain ? .7 : .2;
    const W_N = D_N + f1 * floorL_N + .25 * roofL + f2 * S_N;
    // Conservador: todo el peso del nivel se concentra en su diafragma superior.
    // La fase de análisis reasignará masas de medios niveles al diafragma correspondiente.
    const bb = lv.footprint ? bbox(lv.footprint) : { minX: 0, maxX: 0, minY: 0, maxY: 0 };
    return { level: i, D_N, L_N: floorL_N, roofL_N: roofL, S_N, f1, f2, W_N, height_m: lv.zTop, center_m: [(bb.minX + bb.maxX) / 2, (bb.minY + bb.maxY) / 2, lv.zTop], widthX_m: bb.maxX - bb.minX, widthY_m: bb.maxY - bb.minY };
  });
  const distribution = zone === 0 ? { W_N: levels.reduce((s, l) => s + l.W_N, 0), V0_N: .015 * levels.reduce((s, l) => s + l.W_N, 0), forces_N: levels.map((l) => .015 * l.W_N) }
    : distributeSeismic_N(levels.map((l) => l.W_N), levels.map((l) => l.height_m), coefficient.C, coefficient.T_s > 2 * coefficient.T2_s ? .1 : 0);
  Object.assign(result, { coefficient, levels, ...distribution });
  assumptions.push({ id: "seismic:mass", scope: "sismo", message: "Masa y fuerza de cada módulo concentradas en el centro geométrico del diafragma superior, sin reducción de D. Centro de masa real, regularidad, diafragmas y reparto por rigidez pendientes de la fase de análisis." });
  if (zone > 0) issues.push("Aplicabilidad del método estático: regularidad y límites de §2.7 aún no verificados. Se presentan acciones preliminares, no una verificación sismorresistente.");
  for (const axis of [0, 1]) for (const direction of [-1, 1]) for (const torsion of [-1, 1]) for (const vertical of [-1, 1]) {
    const entries = levels.map((lv, i) => {
      const force_N = [0, 0, vertical * coefficient.verticalFactor * lv.D_N]; force_N[axis] = direction * distribution.forces_N[i];
      const eccentricity_m = .05 * (axis === 0 ? lv.widthY_m : lv.widthX_m);
      return { id: `E:${i}:${axis}:${direction}:${torsion}:${vertical}`, level: i, point_m: lv.center_m, force_N, couple_Nm: [0, 0, torsion * distribution.forces_N[i] * eccentricity_m], eccentricity_m, reference: "103-I §6.2.4.2 ec.6.14;Ev ec.3.10" };
    });
    cases.push({ id: `E:${axis}:${direction}:T${torsion}:V${vertical}`, kind: "E", label: `${direction > 0 ? "+" : "−"}${axis === 0 ? "X" : "Y"} · torsión ${torsion} · Ev ${vertical}`, entries, ...actionResultant(entries) });
  }
  return result;
}
