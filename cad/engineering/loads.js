import { PROFILES, profileKgPerMeter } from "../catalog.js";
import { polygonArea } from "../geometry.js";
import { DEAD_LOAD_REFERENCE, resolveMaterial } from "./data/materials.js";
import { normalizeEngineering } from "./settings.js";
import { G0_m_s2 } from "./units.js";

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

  // Entradas de fases siguientes: se conservan, pero no modifican el peso propio en esta fase.
  const e = engineering;
  if (!e.location.confirmed || !e.location.source) remember("input:location", "Ubicación: V, exposición, nieve, sismo y helada son un escenario a confirmar. V = 58 m/s es una referencia del encargo para Telsen, no un valor local verificado.", "acciones pendientes");
  if (!e.soil.confirmed || !e.soil.source) remember("input:soil", `Suelo: qadm = ${e.soil.qadm} kPa y demás parámetros supuestos. Requiere estudio de suelos.`, "fundación pendiente");
  if (!e.steel.certified || !e.steel.source) remember("input:steel", `Resistencia ${e.steel.grade}, Fy = ${e.steel.Fy / 1e6} MPa: confirmar certificado. No se verificó ninguna barra.`, "resistencia pendiente");
  if (!e.concrete.certified || !e.concrete.source) remember("input:concrete", `Resistencia ${e.concrete.grade}, f'c = ${e.concrete.fc / 1e6} MPa: confirmar especificación. No se verificaron hormigón ni anclajes.`, "resistencia pendiente");
  issues.push(...e.inputIssues, ...gen.warnings);
  if (e.mode === "auto") issues.push("El modo automático todavía no dimensiona ni cambia secciones en la fase 0.");
  const totals = { members_N: 0, surfaces_N: 0, foundation_N: 0, superstructure_N: 0, total_N: 0 };
  const levels = project.levels.map((l, index) => ({ level: index, levelId: l.id, name: l.name, members_N: 0, surfaces_N: 0, weight_N: 0 }));
  const grouped = new Map();
  for (const row of entries) {
    const field = row.kind === "member" ? "members_N" : row.kind === "surface" ? "surfaces_N" : "foundation_N";
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
  totals.superstructure_N = totals.members_N + totals.surfaces_N;
  totals.total_N = totals.superstructure_N + totals.foundation_N;
  return {
    status: "review", statusLabel: "Revisar", reference: DEAD_LOAD_REFERENCE,
    entries, groups: [...grouped.values()], levels, totals,
    assumptions: [...assumptions.values()], issues: [...new Set(issues)],
    // La lista queda siempre visible: el peso calculado no acredita estabilidad ni seguridad.
    notVerified: [
      "Peso permanente completo: faltan equipamiento, instalaciones, terminaciones adicionales y herrajes que todavía no son piezas del modelo.",
      "Cielorraso bajo cubierta: no está en el modelo ni en el cómputo actual; no se agregó un peso ficticio. El cielorraso de entrepiso sí se incluye.",
      "Viento, nieve, sismo, sobrecargas y combinaciones; todavía no hay análisis ni bajada de cargas.",
      "Resistencia, flechas, uniones, anclajes, estabilidad y fundaciones; los tamaños actuales siguen siendo geométricos.",
      "El peso de la fundación se informa separado; no se supone que sus dados trabajen vinculados frente al levantamiento."
    ]
  };
}
