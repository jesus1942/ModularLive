import { PROFILES, profileKgPerMeter } from "../catalog.js";
import { polygonArea } from "../geometry.js";
import { DEAD_LOAD_REFERENCE, resolveMaterial } from "./data/materials.js";
import { normalizeEngineering } from "./settings.js";
import { G0_m_s2 } from "./units.js";
import { areaCenter_m, normal3D, actionResultant, netSurfaceGeometry } from "./load-geometry.js";
import { USES, SOURCES } from "./data/reglamentos.js";
import { pointInPolygon } from "../geometry.js";

/** Volumen en m³ de un sólido real generado (sin merma ni acero agregado dos veces). */
export function solidVolume_m3(solid) {
  if (solid.shape === "beam") return Math.hypot(...solid.b.map((v, i) => v - solid.a[i])) * solid.w * solid.h;
  if (solid.shape === "cylinder") return Math.PI * solid.r ** 2 * solid.h;
  if (solid.shape === "prism") return Math.abs(polygonArea(solid.polygon)) * (solid.z1 - solid.z0);
  return NaN;
}

/**
 * Peso propio instalado: barras kg/m × corte, capas kg/m² × área y sólidos kg/m³ × volumen.
 * Devuelve cada contribución en N y kg, fórmula, fuente y supuestos, sin DOM ni aleatoriedad.
 * El resultado es PARCIAL: no equivale a una carga D completa ni a una verificación de resistencia.
 */
export function computeDeadLoad(project, gen) {
  const engineering = normalizeEngineering(project.engineering, project.levels);
  const entries = [];
  const assumptions = new Map();
  const issues = [];
  const remember = (id, message, scope = "peso propio") => {
    assumptions.set(id, { id, message, scope });
    return id;
  };
  const material = (id) => {
    const m = resolveMaterial(id, engineering.materialOverrides);
    if (!m) { issues.push(`Material ${id} sin peso definido; esa contribución no se pudo calcular.`); return null; }
    if (m.assumed) remember(`material:${id}`, `${m.label}: ${m.value} ${m.unit} supuestos. ${m.source}`);
    if (m.invalid) issues.push(`${m.label}: peso editable inválido; se usó el valor de referencia como supuesto.`);
    return m;
  };
  const append = (row, quantity, unitMass) => {
    if (!Number.isFinite(quantity) || quantity < 0 || !Number.isFinite(unitMass) || unitMass <= 0) {
      issues.push(`${row.label}: cantidad o peso inválidos; contribución sin calcular.`);
      return;
    }
    const mass_kg = quantity * unitMass;
    entries.push({ ...row, quantity, unitMass, mass_kg, weight_N: mass_kg * G0_m_s2 });
  };
  const steel = material("steel");
  const keys = new Set();
  for (const m of gen.members) {
    if (!m.key || keys.has(m.key)) issues.push(`Pieza ${m.id}: clave estable ausente o duplicada; revisá la geometría.`);
    keys.add(m.key);
    const p = PROFILES[m.profileId];
    if (!p || !steel) { issues.push(`Pieza ${m.id}: perfil ${m.profileId} sin propiedades de peso.`); continue; }
    const assumption = remember("section:nominal", "Las masas de perfiles salen de dimensiones nominales sin radios de esquina ni tolerancias. Confirmá kg/m con el proveedor.");
    append({
      key: m.key, memberId: m.id, wallId: m.wallId, level: m.level, kind: "member",
      role: m.role, point_m: m.a.map((v, i) => (v + m.b[i]) / 2),
      group: m.group, label: `${m.group} · ${p.label}`, materialId: "steel", profileId: m.profileId,
      unit: "m", formula: "masa = largo de corte × área nominal de sección × densidad; peso = masa × g₀",
      inputs: { cut_m: m.cut, b_m: p.b, h_m: p.h, t_m: p.t, density_kg_m3: steel.value, g0_m_s2: G0_m_s2 },
      source: steel.source, reference: DEAD_LOAD_REFERENCE.label,
      assumptionIds: [assumption, ...(steel.assumed ? ["material:steel"] : [])]
    }, m.cut, profileKgPerMeter(p, steel.value));
  }
  for (const sf of gen.surfaces) {
    if (!Array.isArray(sf.layers)) { issues.push(`Superficie ${sf.key ?? sf.material}: paquete constructivo sin definir.`); continue; }
    sf.layers.forEach((layer, i) => {
      const m = material(layer.materialId);
      if (!m) return;
      append({
        key: `${sf.key}:layer:${i}:${m.id}`, surfaceKey: sf.key, wallId: sf.wallId,
        level: sf.level, kind: "surface", group: sf.packageLabel, label: m.label, materialId: m.id,
        point_m: netSurfaceGeometry(sf.points, sf.holes ?? []).center_m,
        unit: "m²", formula: "masa = área neta instalada × masa por m²; peso = masa × g₀",
        inputs: { area_m2: layer.area_m2, mass_kg_m2: m.value, g0_m_s2: G0_m_s2 },
        source: m.source, reference: DEAD_LOAD_REFERENCE.label,
        assumptionIds: m.assumed ? [`material:${m.id}`] : []
      }, layer.area_m2, m.value);
    });
  }
  for (const solid of gen.solids) {
    const m = material(solid.material === "hormigon" ? "concrete" : solid.material);
    if (!m) continue;
    const volume_m3 = solidVolume_m3(solid);
    append({
      key: solid.key, level: solid.level, kind: "foundation", group: "Fundación", label: m.label,
      materialId: m.id, unit: "m³", formula: "masa = volumen geométrico × densidad equivalente; peso = masa × g₀",
      inputs: { shape: solid.shape, volume_m3, density_kg_m3: m.value, g0_m_s2: G0_m_s2 },
      source: m.source, reference: DEAD_LOAD_REFERENCE.label,
      assumptionIds: m.assumed ? [`material:${m.id}`] : []
    }, volume_m3, m.value);
  }

  // Equipos permanentes aportados: son acciones puntuales, no piezas ficticias del BOM.
  for (const load of engineering.extraLoads) {
    const li = project.levels.findIndex((l) => l.id === load.levelId);
    const lv = gen.levels[li];
    const roof = gen.surfaces.find((sf) => sf.level === li && sf.material === "cubierta" && pointInPolygon({ x: load.x_m, y: load.y_m }, sf.points.map((p) => ({ x: p[0], y: p[1] }))));
    const inside = lv?.footprint && pointInPolygon({ x: load.x_m, y: load.y_m }, lv.footprint);
    if (load.target === "floor" ? !inside : !roof) { issues.push(`${load.label}: la posición no cae en el ${load.target === "floor" ? "piso" : "techo expuesto"} del nivel; carga sin aplicar.`); continue; }
    const n = roof ? normal3D(roof.points) : [0, 0, 1], a = roof?.points[0];
    const z = load.target === "floor" ? lv.floorTop : a[2] - (n[0] * (load.x_m - a[0]) + n[1] * (load.y_m - a[1])) / n[2];
    const id = `extra:${load.id}`;
    if (!load.confirmed || !load.source) remember(id, `${load.label}: ${load.force_N / 1000} kN aportados sin fuente confirmada.`, "carga permanente");
    append({ key: id, level: li, kind: "extra", target: load.target, group: "Equipos permanentes", label: load.label, materialId: "extra", unit: "u", point_m: [load.x_m, load.y_m, z],
      inputs: { force_N: load.force_N, x_m: load.x_m, y_m: load.y_m, target: load.target }, formula: "D puntual = fuerza aportada; masa equivalente = D/g₀", source: load.source || "Dato manual supuesto", reference: DEAD_LOAD_REFERENCE.label,
      assumptionIds: !load.confirmed || !load.source ? [id] : [] }, 1, load.force_N / G0_m_s2);
  }
  // El suelo y las resistencias se conservan sin acreditar aún capacidad portante ni barras.
  const e = engineering;
  if (!e.location.confirmed || !e.location.source) remember("input:location", `Ubicación a confirmar: V=${e.location.V} m/s (${e.codeEdition}), pg=${e.location.pg} kPa, zona sísmica=${e.location.seismicZone}. Son un escenario de cálculo, no valores locales certificados; confirmar exposición, topografía y helada.`, "acciones climáticas");
  if (!e.jurisdictionConfirmed) remember("input:jurisdiction", `Edición ${e.codeEdition}: adopción provincial y municipal a confirmar.`, "reglamentos");
  if (!e.soil.confirmed || !e.soil.source) remember("input:soil", `Suelo: qadm = ${e.soil.qadm} kPa y demás parámetros supuestos. Requiere estudio de suelos.`, "fundación pendiente");
  if (!e.steel.certified || !e.steel.source) remember("input:steel", `Resistencia ${e.steel.grade}, Fy = ${e.steel.Fy / 1e6} MPa: confirmar certificado. No se verificó ninguna barra.`, "resistencia pendiente");
  if (!e.concrete.certified || !e.concrete.source) remember("input:concrete", `Resistencia ${e.concrete.grade}, f'c = ${e.concrete.fc / 1e6} MPa: confirmar especificación. No se verificaron hormigón ni anclajes.`, "resistencia pendiente");
  issues.push(...e.inputIssues, ...gen.warnings);
  if (e.mode === "auto") issues.push("El modo automático todavía no dimensiona ni cambia secciones en la fase 1.");
  const totals = { members_N: 0, surfaces_N: 0, extra_N: 0, foundation_N: 0, superstructure_N: 0, total_N: 0 };
  const levels = project.levels.map((l, index) => ({ level: index, levelId: l.id, name: l.name, members_N: 0, surfaces_N: 0, extra_N: 0, weight_N: 0 }));
  const grouped = new Map();
  for (const row of entries) {
    const field = row.kind === "member" ? "members_N" : row.kind === "surface" ? "surfaces_N" : row.kind === "extra" ? "extra_N" : "foundation_N";
    totals[field] += row.weight_N;
    if (row.kind !== "foundation" && levels[row.level]) {
      levels[row.level][field] += row.weight_N;
      levels[row.level].weight_N += row.weight_N;
    }
    const id = `${row.kind}:${row.level}:${row.group}:${row.profileId ?? row.materialId}`;
    if (!grouped.has(id)) grouped.set(id, { id, kind: row.kind, level: row.level, group: row.group, label: row.kind === "member" ? PROFILES[row.profileId].label : row.label, unit: row.unit, quantity: 0, unitMass: row.unitMass, mass_kg: 0, weight_N: 0, assumptionIds: [], source: row.source });
    const group = grouped.get(id);
    group.quantity += row.quantity;
    group.mass_kg += row.mass_kg;
    group.weight_N += row.weight_N;
    group.assumptionIds = [...new Set([...group.assumptionIds, ...row.assumptionIds])];
  }
  totals.superstructure_N = totals.members_N + totals.surfaces_N + totals.extra_N;
  totals.total_N = totals.superstructure_N + totals.foundation_N;
  return {
    status: "review", statusLabel: "Revisar", reference: DEAD_LOAD_REFERENCE,
    entries, groups: [...grouped.values()], levels, totals,
    assumptions: [...assumptions.values()], issues: [...new Set(issues)],
    // La lista queda siempre visible: el peso calculado no acredita estabilidad ni seguridad.
    notVerified: [
      "Peso permanente completo: faltan equipamiento, instalaciones, terminaciones adicionales y herrajes que todavía no son piezas del modelo.",
      "Cielorraso bajo cubierta: tubos nominales 40×20×1,6 cada ≤0,40 m, marco y placa de 12,5 mm incluidos. Secciones, uniones y altura libre final pendientes de verificación.",
      "Análisis, bajada de cargas y áreas tributarias a cada barra: pendientes de la fase 2.",
      "Resistencia, flechas, uniones, anclajes, estabilidad y fundaciones; los tamaños actuales siguen siendo geométricos.",
      "El peso de la fundación se informa separado; no se supone que sus dados trabajen vinculados frente al levantamiento."
    ]
  };
}

/** L reducida (Pa) por elemento, CIRSOC 101 §4.7 (2025) / §4.8 (2005); sin reducción prohibida. */
export function reducedLiveLoad_Pa({ L0_Pa, At_m2, KLL, floors = 1, use = "vivienda" }) {
  if (![L0_Pa, At_m2, KLL].every(Number.isFinite) || L0_Pa < 0 || At_m2 <= 0 || KLL <= 0) throw new RangeError("Reducción L: entradas inválidas.");
  if (!USES[use]?.reducible || L0_Pa > 5000 || KLL * At_m2 < 37) return L0_Pa;
  return L0_Pa * Math.min(1, Math.max(floors > 1 ? .4 : .5, .25 + 4.57 / Math.sqrt(KLL * At_m2)));
}

/** Mantenimiento de cubierta en Pa sobre proyección horizontal; At_m2 del ELEMENTO analizado. */
export function roofLiveLoad({ edition, light, At_m2, slope_percent }) {
  if (!(At_m2 > 0) || slope_percent < 0 || !Number.isFinite(slope_percent)) throw new RangeError("Lr: entradas inválidas.");
  if (edition === "2025" && light) {
    const R1 = At_m2 < 20 ? 1 : At_m2 <= 60 ? 1.125 - .00625 * At_m2 : .75;
    const R2 = slope_percent < 3 ? 1.70 : slope_percent <= 55 ? 1.04 - .008 * slope_percent : .60;
    return { pressure_Pa: 1000 * Math.max(.203, Math.min(.765, .45 * R1 * R2)), R1, R2, At_m2, light: true, slope_percent, reference: "101-25 §4.8.1(b) ec.4.8.b" };
  }
  const F = .12 * slope_percent;
  const R1 = At_m2 < 20 ? 1 : At_m2 <= 60 ? Math.max(.6, 1.2 - .01076 * At_m2) : .6;
  const R2 = F <= 4 ? 1 : F < 12 ? 1.2 - .05 * F : .6;
  return { pressure_Pa: 1000 * Math.max(.58, Math.min(.96, .96 * R1 * R2)), R1, R2, At_m2, light, slope_percent, reference: edition === "2025" ? "101-25 §4.8.1(a) ec.4.8.a" : "101-05 §4.9.1" };
}

/** Casos L/Lr sin reducción global: la fase tributaria podrá reducir donde corresponda. */
export function computeLiveLoads(project, gen, e, dead) {
  const entries = [], roofEntries = [], issues = [];
  const source = SOURCES[`loads${e.codeEdition}`];
  const surfaceLoad = (sf, pressure_Pa, data) => {
    const planArea_m2 = Math.abs(polygonArea(sf.points.map((p) => ({ x: p[0], y: p[1] }))));
    return { id: `${data.kind}:${sf.key}`, level: sf.level, surfaceKey: sf.key, points: sf.points, point_m: areaCenter_m(sf.points), planArea_m2, pressure_Pa, force_N: [0, 0, -pressure_Pa * planArea_m2], ...data };
  };
  const roofWeights = new Map();
  dead.entries.forEach((r) => {
    if (["rafter", "roofEdge", "ridge", "ceilingJoist", "ceilingTrack"].includes(r.role) || ["Techo", "Cielorraso"].includes(r.group) || r.kind === "extra" && r.target === "roof") roofWeights.set(r.level, (roofWeights.get(r.level) ?? 0) + r.weight_N);
  });
  const concentratedChecks = [];
  for (const sf of gen.surfaces) {
    if (["piso", "platea"].includes(sf.material)) {
      const use = USES[e.usage[sf.level].use];
      const L0_Pa = e.usage[sf.level].use === "balcon" && sf.area <= 10 ? 3000 : use.L0_Pa;
      entries.push(surfaceLoad(sf, L0_Pa, { kind: "L", target: "floor", use: e.usage[sf.level].use, reference: `${source.label} Tabla4.1: ${use.row};sin reducción global` }));
      if (use.concentrated_N) concentratedChecks.push({ level: sf.level, force_N: use.concentrated_N, target: "floor", reference: `${source.label} Tabla4.1`, note: "Carga concentrada alternativa a L uniforme; posición más desfavorable pendiente de análisis de barra." });
    }
    // Balcones y terrazas dibujados en la planta llevan su propia sobrecarga de uso (Tabla 4.1).
    if (sf.material === "balcon") {
      const L0_Pa = sf.area <= 10 ? 3000 : USES.balcon.L0_Pa;
      entries.push(surfaceLoad(sf, L0_Pa, { kind: "L", target: "floor", use: "balcon", reference: `${source.label} Tabla4.1: ${USES.balcon.row};sin reducción global` }));
      continue;
    }
    if (sf.material === "cubierta" && sf.access === "terraza") {
      const use = e.roofAccess === "terraza_publica" ? "terraza_publica" : "terraza";
      entries.push(surfaceLoad(sf, USES[use].L0_Pa, { kind: "L", target: "roof", use, reference: `${source.label} Tabla4.1: ${USES[use].row}` }));
      continue;
    }
    if (sf.material !== "cubierta") continue;
    const totalArea = gen.surfaces.filter((r) => r.material === "cubierta" && r.level === sf.level).reduce((s, r) => s + Math.abs(polygonArea(r.points.map((p) => ({ x: p[0], y: p[1] })))), 0);
    const roofD_Pa = (roofWeights.get(sf.level) ?? 0) / totalArea;
    if (e.roofAccess === "inaccesible") {
      const info = roofLiveLoad({ edition: e.codeEdition, light: roofD_Pa <= 500, At_m2: 1, slope_percent: sf.level === gen.levels.length - 1 ? project.roof.slope : 0 });
      roofEntries.push(surfaceLoad(sf, info.pressure_Pa, { kind: "Lr", target: "roof", roofD_Pa, ...info }));
      concentratedChecks.push({ level: sf.level, force_N: 1000, target: "roof", reference: `${source.label} Tabla4.1: cubiertas inaccesibles`, note: "Mantenimiento concentrado alternativo; posición más desfavorable pendiente de análisis local." });
    } else {
      const use = USES[e.roofAccess];
      entries.push(surfaceLoad(sf, use.L0_Pa, { kind: "L", target: "roof", use: e.roofAccess, reference: `${source.label} Tabla4.1: ${use.row}` }));
      if (project.roof.slope > 5) issues.push("Cubierta accesible con pendiente >5 %: requiere diseño de piso, barandas, acceso y drenaje; L accesible se aplica como escenario.");
    }
  }
  const L = { id: "L", kind: "L", label: "Sobrecarga de uso", entries, ...actionResultant(entries) };
  const Lr = { id: "Lr", kind: "Lr", label: "Mantenimiento de cubierta", entries: roofEntries, ...actionResultant(roofEntries) };
  return { source, L, Lr, concentratedChecks, issues: [...new Set(issues)], assumptions: [{ id: "live:tributary", scope: "sobrecargas", message: "L y Lr uniformes sin reducción por área en la carga global (At=1 m² para R1=1). Reducir por barra requiere áreas tributarias y continuidad de fase 2. No se diseñaron cargas concentradas, patrones locales ni barandas." }] };
}
