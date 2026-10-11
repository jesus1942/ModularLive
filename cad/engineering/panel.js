import { LOCATIONS } from "./data/locations.js";
import { resolveMaterial } from "./data/materials.js";
import { formatForce, formatNumber as n, formatPressure, formatStress, G0_m_s2 } from "./units.js";

/** Escapa texto del proyecto o de una fuente ingresada por el usuario para insertar HTML. */
export function escapeEngineeringHtml(text) {
  return String(text ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
const esc = escapeEngineeringHtml;
const input = (path, label, step = "any", scale = 1, min = 0, max = "") => `<label>${label}<input type="number" step="${step}" min="${min}" ${max !== "" ? `max="${max}"` : ""} data-path="engineering.${path}" data-scale="${scale}" /></label>`;
const source = (group, label) => `<label>Fuente / documento<input type="text" data-path="engineering.${group}.source" placeholder="Ficha, estudio o referencia" /></label><label class="check"><input type="checkbox" data-path="engineering.${group}.${["steel", "concrete"].includes(group) ? "certified" : "confirmed"}" /> ${label}</label>`;

/** Formulario de la fase base; lo climático y resistente se conserva para fases siguientes. */
export function engineeringInputsHtml() {
  return `<p class="eng-note">Base de cálculo · fase 0. Se pesa el modelo actual. La estructura todavía no se verifica ni se dimensiona.</p>
    <label>Modo<select data-path="engineering.mode"><option value="verify">Verificar secciones elegidas (pendiente)</option><option value="auto" disabled>Dimensionado automático (próximamente)</option></select></label>
    <details open><summary>Ubicación y escenario</summary><div class="fields">
      <label>Localidad<select data-path="engineering.location.preset">${Object.entries(LOCATIONS).map(([id, l]) => `<option value="${id}">${esc(l.label)}</option>`).join("")}<option value="manual">Ubicación manual</option></select></label>
      <p class="eng-note">Los mapas locales están a confirmar. Los valores siguientes no participan del peso propio; se usarán cuando estén implementadas las acciones.</p>
      ${input("location.V", "Viento básico V (m/s) · escenario", 1, 1, 1, 150)}
      <label>Exposición<select data-path="engineering.location.exposure"><option value="B">B · entorno edificado</option><option value="C">C · terreno abierto</option><option value="D">D · costa abierta (evaluar)</option></select></label>
      ${input("location.Kzt", "Factor topográfico Kzt", 0.05, 1, 0.1, 5)}
      ${input("location.pg", "Nieve en terreno pg (kN/m²)", 0.05, 1, 0, 30)}
      ${input("location.seismicZone", "Zona sísmica (0–4) · confirmar", 1, 1, 0, 4)}
      ${input("location.frostDepth", "Profundidad de helada (m)", 0.05, 1, 0, 5)}
      ${source("location", "Datos contrastados con sus fuentes")}
    </div></details>
    <details><summary>Suelo</summary><div class="fields">
      <p class="eng-note">SUPUESTO inicial qadm = 100 kPa (≈ 1,02 kgf/cm²). Requiere estudio de suelos; editarlo no recalcula la fundación en esta fase.</p>
      ${input("soil.qadm", "Tensión admisible (kPa)", 10, 1, 1, 10000)}
      ${input("soil.gamma", "Peso unitario (kN/m³)", 0.5, 1, 1, 40)}
      ${input("soil.phi", "Ángulo de fricción (°)", 1, 1, 0, 60)}
      ${input("soil.mu", "Fricción base–suelo μ", 0.05, 1, 0, 2)}
      ${source("soil", "Datos respaldados por estudio de suelos")}
    </div></details>
    <details><summary>Acero y hormigón</summary><div class="fields">
      <label>Grado del acero<input type="text" data-path="engineering.steel.grade" /></label>
      ${input("steel.Fy", "Fluencia Fy (MPa)", 1, 1e6, 1, 1000)}
      ${input("steel.Fu", "Rotura Fu (MPa)", 1, 1e6, 1, 2000)}
      ${input("steel.E", "Módulo E (GPa)", 1, 1e9, 1, 1000)}
      ${source("steel", "Resistencias según certificado")}
      <label>Grado del hormigón<input type="text" data-path="engineering.concrete.grade" /></label>
      ${input("concrete.fc", "Resistencia f'c (MPa)", 1, 1e6, 1, 150)}
      ${input("concrete.rebarFy", "Fluencia de armadura (MPa)", 1, 1e6, 1, 1000)}
      ${source("concrete", "Resistencias según especificación")}
      <p class="eng-note">Los pesos se ajustan en la pestaña Ingeniería. Fy, E y f'c son resistencias; cambiarlas no cambia la masa.</p>
    </div></details>`;
}

/** Resumen visible junto al 3D, sin presentar seguridad estructural como acreditada. */
export function engineeringSummaryHtml(result) {
  return `<h3>Ingeniería <span class="eng-version">${esc(result.version)}</span></h3>
    <div class="eng-chips"><span>Revisar</span><span>Supuestos (${result.assumptions.length})</span></div>
    <dl class="eng-metrics"><div><dt>Vivienda · peso modelado</dt><dd>${formatForce(result.totals.superstructure_N)}</dd></div>
    <div><dt>Fundación · peso separado</dt><dd>${formatForce(result.totals.foundation_N)}</dd></div></dl>
    <p class="eng-note">Peso propio parcial. Resistencia, viento y anclajes pendientes.</p>
    <button type="button" class="btn btn--ghost" data-show-engineering>Ver detalle y supuestos</button>`;
}

const groupsTable = (result, project) => `<div class="table-wrap"><table class="eng-table"><thead><tr><th>Grupo / material</th><th>Cantidad instalada</th><th>Masa unitaria</th><th>Peso modelado</th></tr></thead><tbody>${result.groups.map((g) => `<tr><td><strong>${esc(g.group)} · ${esc(project.levels[g.level]?.name)}</strong><small>${esc(g.label)}</small><small>${g.assumptionIds.length ? "Con supuestos" : "Dato aportado"} · ${esc(g.source)}</small></td><td>${n(g.quantity, 3)} ${g.unit}</td><td>${n(g.unitMass, 4)} kg/${g.unit}</td><td>${formatForce(g.weight_N)}</td></tr>`).join("")}</tbody></table></div>`;

/** Detalle de pesos, trazabilidad por pieza y edición de los materiales usados. */
export function engineeringResultHtml(result, project) {
  const used = [...new Set(result.entries.map((row) => row.materialId))];
  return `<div class="eng-heading"><div><p class="eng-kicker">ActivaModular · Ingeniería · fase 0</p><h2>Peso propio del modelo</h2><p>Autor del proyecto: <strong>Jesús Olguín · jesus.olguin</strong></p></div><button type="button" class="btn btn--ghost" id="engineeringJsonBtn">Descargar detalle JSON</button></div>
    <div class="eng-chips"><span>Revisar</span><span>Supuestos (${result.assumptions.length})</span>${result.issues.length ? `<span>Datos a revisar (${result.issues.length})</span>` : ""}</div>
    <p class="eng-note eng-scope">Peso modelado parcial: ${formatForce(result.totals.total_N)}. Incluye la vivienda y la fundación por separado. No acredita resistencia ni estabilidad. El cálculo y los planos para construir requieren revisión y firma de un profesional matriculado.</p>
    <div class="eng-totals"><div><span>Barras instaladas</span><strong>${formatForce(result.totals.members_N)}</strong></div><div><span>Paquetes y aberturas</span><strong>${formatForce(result.totals.surfaces_N)}</strong></div><div><span>Fundación</span><strong>${formatForce(result.totals.foundation_N)}</strong></div></div>
    <h3>Por nivel · sin fundación</h3><ul class="eng-levels">${result.levels.map((l) => `<li><strong>${esc(l.name)}</strong> ${formatForce(l.weight_N)}</li>`).join("")}</ul>
    <h3>Cantidades y fórmulas</h3><p class="eng-note">Barras: kg/m × largo de corte. Capas: kg/m² × área neta. Hormigón: kg/m³ × volumen. Peso = masa × 9,80665 m/s². No se cargan sobrantes ni merma de compra.</p>
    <p class="eng-note">Referencia: <a href="${esc(result.reference.url)}" target="_blank" rel="noopener">${esc(result.reference.label)}</a>. Adopción provincial y municipal a confirmar; no se implementaron combinaciones reglamentarias en esta fase.</p>
    ${groupsTable(result, project)}
    <details class="eng-trace"><summary>Rastrear cada pieza y cada capa (${result.entries.length})</summary><div class="table-wrap"><table class="eng-table"><thead><tr><th>Pieza / capa</th><th>Entrada → fórmula → resultado</th></tr></thead><tbody>${result.entries.map((r) => `<tr><td><strong>${esc(r.label)}</strong><code>${esc(r.key)}</code></td><td>${n(r.quantity, 4)} ${r.unit} × ${n(r.unitMass, 6)} kg/${r.unit} = ${n(r.mass_kg, 4)} kg → ${formatForce(r.weight_N)}<small>${esc(r.formula)}</small><small>${r.assumptionIds.length ? "Con supuestos" : "Dato aportado"} · ${esc(r.source)}</small></td></tr>`).join("")}</tbody></table></div></details>
    <h3>Pesos editables · materiales usados</h3><p class="eng-note">Cargá el peso instalado de la ficha, su fuente y la confirmación. Un peso sin fuente continúa como supuesto. En chapas usá masa por m² de cobertura neta, con solapes físicos incluidos.</p>
    <div class="eng-materials">${used.map((id) => {
      const m = resolveMaterial(id, project.engineering.materialOverrides);
      const override = project.engineering.materialOverrides[id];
      return `<div class="eng-material"><strong>${esc(m.label)} <span>${m.assumed ? "Supuesto" : "Dato aportado"}</span></strong><div class="fields fields--2">
        <label>Masa / densidad (${m.unit})<input type="number" min="0.000001" step="any" value="${m.value}" data-material="${id}" data-material-field="value" /></label>
        <label>Fuente del dato<input type="text" value="${esc(override?.source ?? "")}" placeholder="Ficha y producto" data-material="${id}" data-material-field="source" /></label>
        <label class="check"><input type="checkbox" ${override?.confirmed === true ? "checked" : ""} data-material="${id}" data-material-field="confirmed" /> Según documento cargado</label>
        <button type="button" class="btn btn--ghost" data-material-reset="${id}">Restablecer referencia</button></div>
        <small>${esc(m.source)}</small>${m.basis === "area" ? `<small>${formatPressure(m.value * G0_m_s2)}</small>` : `<small>${n(m.value * G0_m_s2 / 1000, 3)} kN/m³ (${n(m.value)} kgf/m³)</small>`}
      </div>`;
    }).join("")}</div>
    <h3>Supuestos</h3><ul class="eng-list">${result.assumptions.map((a) => `<li><strong>${esc(a.scope)}:</strong> ${esc(a.message)}</li>`).join("")}</ul>
    ${result.issues.length ? `<h3>Datos y geometría a revisar</h3><ul class="eng-list">${result.issues.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>` : ""}
    <h3>Alcance pendiente</h3><ul class="eng-list">${result.notVerified.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>
    <p class="eng-note">Entradas resistentes guardadas, sin usar aún: acero ${formatStress(project.engineering.steel.Fy)}; hormigón ${formatStress(project.engineering.concrete.fc)}.</p>`;
}

/** Extracto imprimible de la fase base; no se titula memoria estructural completa. */
export function engineeringPrintHtml(result, project) {
  return `<section class="eng-print"><h2>Peso propio modelado · fase 0 · motor ${esc(result.version)}</h2><p>ActivaModular · Jesús Olguín · jesus.olguin. Vivienda: ${formatForce(result.totals.superstructure_N)}. Fundación: ${formatForce(result.totals.foundation_N)}.</p>
    <p>Peso parcial. Resistencia, estabilidad y anclajes no verificados. Requiere revisión y firma profesional. Se usan ${result.assumptions.length} supuestos.</p>${groupsTable(result, project)}
    <h3>Supuestos y datos pendientes</h3><ul>${[...result.assumptions.map((a) => a.message), ...result.issues].map((w) => `<li>${esc(w)}</li>`).join("")}</ul><h3>Alcance pendiente</h3><ul>${result.notVerified.map((w) => `<li>${esc(w)}</li>`).join("")}</ul></section>`;
}
