import { LOCATIONS } from "./data/locations.js";
import { USES } from "./data/reglamentos.js";
import { resolveMaterial } from "./data/materials.js";
import { formatForce, formatNumber as n, formatPressure, formatStress, G0_m_s2 } from "./units.js";

/** Escapa texto del proyecto o de una fuente ingresada por el usuario para insertar HTML. */
export function escapeEngineeringHtml(text) {
  return String(text ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
const esc = escapeEngineeringHtml;
const input = (path, label, step = "any", scale = 1, min = 0, max = "") => `<label>${label}<input type="number" step="${step}" min="${min}" ${max !== "" ? `max="${max}"` : ""} data-path="engineering.${path}" data-scale="${scale}" /></label>`;
const source = (group, label) => `<label>Fuente / documento<input type="text" data-path="engineering.${group}.source" placeholder="Ficha, estudio o referencia" /></label><label class="check"><input type="checkbox" data-path="engineering.${group}.${["steel", "concrete"].includes(group) ? "certified" : "confirmed"}" /> ${label}</label>`;

/** Entradas de fase 1: ediciones separadas, unidades visibles y confirmaciones independientes. */
export function engineeringInputsHtml() {
  return `<p class="eng-note">Cargas · fase 1. Se pesa el modelo y se calculan acciones preliminares. Barras, estabilidad y anclajes pendientes.</p>
    <label>Edición por jurisdicción<select data-path="engineering.codeEdition"><option value="2025">2025 · cargas y viento</option><option value="2005">2005 · exigencia local anterior</option></select></label>
    <label>Jurisdicción / norma local<input type="text" data-path="engineering.jurisdiction" placeholder="Municipio y disposición aplicable" /></label>
    <label class="check"><input type="checkbox" data-path="engineering.jurisdictionConfirmed" /> Edición contrastada con la jurisdicción</label>
    <label>Modo<select data-path="engineering.mode"><option value="verify">Verificar secciones elegidas (pendiente)</option><option value="auto" disabled>Dimensionado automático (próximamente)</option></select></label>
    <details open><summary>Ubicación y escenario</summary><div class="fields">
      <label>Localidad<select data-path="engineering.location.preset">${Object.entries(LOCATIONS).map(([id, l]) => `<option value="${id}">${esc(l.label)}</option>`).join("")}<option value="manual">Ubicación manual</option></select></label>
      <p class="eng-note">V participa del viento. Al cambiar edición o riesgo se actualiza desde la tabla disponible o se vuelve a un escenario supuesto. Puerto Madryn sigue a confirmar; 58 m/s de Telsen es una referencia 2005.</p>
      <label>Categoría de riesgo<select data-path="engineering.importance"><option value="I">I · bajo riesgo</option><option value="II">II · vivienda / uso habitual</option><option value="III">III · importancia pública</option><option value="IV">IV · servicio esencial</option></select></label>
      ${input("location.V", "Viento básico V (m/s) · escenario", 1, 1, 1, 150)}
      <label>Exposición<select data-path="engineering.location.exposure"><option value="B">B · entorno edificado</option><option value="C">C · terreno abierto</option><option value="D">D · costa abierta (evaluar)</option></select></label>
      ${input("location.Kzt", "Factor topográfico Kzt", 0.05, 1, 0.1, 5)}
      ${input("location.altitude", "Altitud (m) · Ke=1 conservador", 1, 1, -500, 9000)}
      ${input("location.pg", "Nieve en terreno pg (kN/m²)", 0.05, 1, 0, 30)}
      ${input("location.seismicZone", "Zona sísmica (0–4) · confirmar", 1, 1, 0, 4)}
      ${input("location.frostDepth", "Profundidad de helada (m)", 0.05, 1, 0, 5)}
      ${source("location", "Datos contrastados con sus fuentes")}
    </div></details>
    <details><summary>Uso y cargas permanentes</summary><div class="fields">
      <div id="engineeringUsageInputs"></div>
      <label>Acceso a cubierta<select data-path="engineering.roofAccess"><option value="inaccesible">Sólo mantenimiento · Lr</option><option value="terraza">Terraza privada · L</option><option value="terraza_publica">Terraza pública · L</option></select></label>
      <p class="eng-note">Los equipos permanentes se ubican con nivel, coordenadas y fuerza en la pestaña Ingeniería. L uniforme no se reduce antes de conocer el área tributaria de cada barra.</p>
    </div></details>
    <details><summary>Viento · cerramiento y fijaciones</summary><div class="fields">
      <label>Estado de aberturas<select data-path="engineering.wind.enclosure"><option value="potential">Evaluar apertura potencial por fachada</option><option value="closed">Cerrado · confirmar carpinterías</option><option value="partial">Parcialmente cerrado · GCpi ±0,55</option></select></label>
      ${input("wind.effectiveArea_m2", "Área efectiva del componente (m²)", .1, 1, .01, 1000)}
      <p class="eng-note">Área de cada fijación o componente; no es el área de toda la zona dibujada. Las presiones locales son una envolvente independiente.</p>
      ${input("wind.serviceV_m_s", "Velocidad de servicio Vserv (m/s)", 1, 1, 1, 150)}
      <label>Fuente de Vserv<input type="text" data-path="engineering.wind.source" /></label>
      <label class="check"><input type="checkbox" data-path="engineering.wind.serviceConfirmed" /> Vserv contrastada con mapa / criterio de servicio</label>
    </div></details>
    <details><summary>Nieve y sismo</summary><div class="fields">
      ${input("snow.Ce", "Exposición de nieve Ce", .1, 1, .7, 1.3)}
      ${input("snow.Ct", "Factor térmico Ct", .1, 1, 1, 1.3)}
      <label class="check"><input type="checkbox" data-path="engineering.snow.retain" /> La cubierta retiene nieve (masa sísmica 70 %)</label>
      ${source("snow", "Factores de nieve documentados")}
      <label>Sitio sísmico<select data-path="engineering.seismic.site">${["SA", "SB", "SC", "SD", "SE", "SF"].map((v) => `<option value="${v}">${v}${v === "SF" ? " · estudio específico" : ""}</option>`).join("")}</select></label>
      <label>Grupo sísmico<select data-path="engineering.seismic.riskGroup"><option value="B">B · vivienda</option><option value="A">A · importancia pública</option><option value="Ao">Ao · función esencial</option><option value="C">C · instalación aislada de baja ocupación</option></select></label>
      ${input("seismic.R", "Reducción sísmica R · justificar sistema", .1, 1, 1, 8)}
      ${source("seismic", "Sitio, grupo y sistema lateral documentados")}
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
    <dl class="eng-metrics"><div><dt>Viento ${result.codeEdition} · qh</dt><dd>${result.wind.referencePressure ? formatPressure(result.wind.referencePressure.qz_Pa) : "Sin calcular"}</dd></div></dl>
    <p class="eng-note">${result.loadCases.length} casos · ${result.combinations.length} combinaciones. ${result.analysis?.status === "calculated" ? `Equilibrio verificado en ${result.analysis.combinationChecks.length} combinaciones. ${result.analysis.drifts.some(d=>d.status==="fails_project_limit")?"No cumple el límite de desplazamiento del proyecto.":"Análisis elástico disponible."}` : "Análisis sin resolver."} Escenario con supuestos; resistencia y anclajes pendientes.</p>
    <button type="button" class="btn btn--ghost" data-show-engineering>Ver detalle y supuestos</button>`;
}

const groupsTable = (result, project) => `<div class="table-wrap"><table class="eng-table"><thead><tr><th>Grupo / material</th><th>Cantidad instalada</th><th>Masa unitaria</th><th>Peso modelado</th></tr></thead><tbody>${result.groups.map((g) => `<tr><td><strong>${esc(g.group)} · ${esc(project.levels[g.level]?.name)}</strong><small>${esc(g.label)}</small><small>${g.assumptionIds.length ? "Con supuestos" : "Dato aportado"} · ${esc(g.source)}</small></td><td>${n(g.quantity, 3)} ${g.unit}</td><td>${n(g.unitMass, 4)} kg/${g.unit}</td><td>${formatForce(g.weight_N)}</td></tr>`).join("")}</tbody></table></div>`;

/** Detalle de pesos, trazabilidad por pieza y edición de los materiales usados. */
export function engineeringResultHtml(result, project) {
  const used = [...new Set(result.entries.map((row) => row.materialId))].filter((id) => resolveMaterial(id));
  return `<div class="eng-heading"><div><p class="eng-kicker">ActivaModular · Ingeniería · fase ${result.phase}</p><h2>Cargas del modelo · edición ${result.codeEdition}</h2><p>Autor del proyecto: <strong>Jesús Olguín · jesus.olguin</strong> · implementación asistida: ingeniero Astra el Evangelista</p></div><button type="button" class="btn btn--ghost" id="engineeringJsonBtn">Descargar detalle JSON</button></div>
    <div class="eng-chips"><span>Revisar</span><span>Supuestos (${result.assumptions.length})</span>${result.issues.length ? `<span>Datos a revisar (${result.issues.length})</span>` : ""}</div>
    <p class="eng-note eng-scope">Peso modelado parcial: ${formatForce(result.totals.total_N)}. Incluye la vivienda y la fundación por separado. No acredita resistencia ni estabilidad. El cálculo y los planos para construir requieren revisión y firma de un profesional matriculado.</p>
    ${loadResultsHtml(result)}
    ${analysisResultsHtml(result, project)}
    ${extraLoadsHtml(project)}
    <div class="eng-totals"><div><span>Barras instaladas</span><strong>${formatForce(result.totals.members_N)}</strong></div><div><span>Paquetes y aberturas</span><strong>${formatForce(result.totals.surfaces_N)}</strong></div><div><span>Fundación</span><strong>${formatForce(result.totals.foundation_N)}</strong></div></div>
    <h3>Por nivel · sin fundación</h3><ul class="eng-levels">${result.levels.map((l) => `<li><strong>${esc(l.name)}</strong> ${formatForce(l.weight_N)}</li>`).join("")}</ul>
    <h3>Cantidades y fórmulas</h3><p class="eng-note">Barras: kg/m × largo de corte. Capas: kg/m² × área neta. Hormigón: kg/m³ × volumen. Peso = masa × 9,80665 m/s². No se cargan sobrantes ni merma de compra.</p>
    <p class="eng-note">Referencia de pesos: <a href="${esc(result.reference.url)}" target="_blank" rel="noopener">${esc(result.reference.label)}</a>. ${esc(project.engineering.jurisdiction || "Jurisdicción a confirmar")} · edición ${result.codeEdition}.</p>
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
    <p class="eng-note">E=${n(project.engineering.steel.E/1e9)} GPa usado en el análisis. Resistencias aún sin verificar: acero ${formatStress(project.engineering.steel.Fy)}; hormigón ${formatStress(project.engineering.concrete.fc)}.</p>`;
}

/** Extracto imprimible de la fase base; no se titula memoria estructural completa. */
export function engineeringPrintHtml(result, project) {
  return `<section class="eng-print"><h2>Cargas y análisis preliminar · fase ${result.phase} · edición ${result.codeEdition} · motor ${esc(result.version)}</h2><p>ActivaModular · Jesús Olguín · jesus.olguin · ingeniero Astra el Evangelista. Vivienda: ${formatForce(result.totals.superstructure_N)}. Fundación: ${formatForce(result.totals.foundation_N)}.</p>
    <p>Peso parcial. Resistencia, estabilidad y anclajes no verificados. Requiere revisión y firma profesional. Se usan ${result.assumptions.length} supuestos.</p>${groupsTable(result, project)}
    ${loadResultsHtml(result)}${analysisResultsHtml(result, project)}<h3>Supuestos y datos pendientes</h3><ul>${[...result.assumptions.map((a) => a.message), ...result.issues].map((w) => `<li>${esc(w)}</li>`).join("")}</ul><h3>Alcance pendiente</h3><ul>${result.notVerified.map((w) => `<li>${esc(w)}</li>`).join("")}</ul></section>`;
}

/** Reacciones por apoyo, derivas y gobernantes; no se presentan como fundaciones dimensionadas. */
export function analysisResultsHtml(result, project) {
  const a=result.analysis;if(!a)return "";
  if(a.status!=="calculated")return `<section class="eng-analysis"><h3>Análisis sin resolver</h3><p class="eng-note eng-scope">${esc(a.scope)}</p><ul class="eng-list">${a.issues.map(s=>`<li>${esc(s)}</li>`).join("")}</ul></section>`;
  return `<section class="eng-analysis"><h3>Análisis del pórtico · primer orden</h3><p class="eng-note">${a.model.nodes.length} nodos · ${a.model.bars.length} barras principales · ${a.model.ties.length} interfaces articuladas. ${esc(a.storage.kind)}. Equilibrio de fuerzas y momentos: ${a.combinationChecks.length} combinaciones; error relativo máximo ${n(a.equilibriumMax,14)} &lt; 10⁻⁶.</p>
    <p class="eng-note eng-scope">${esc(a.scope)} Los máximos de la tabla son envolventes; pueden pertenecer a combinaciones distintas. Compresión positiva; tracción de anclaje cuando la reacción vertical es negativa. Fundación excluida del análisis.</p>
    <div class="table-wrap"><table class="eng-table"><thead><tr><th>Apoyo (x, y) m</th><th>Compresión máxima</th><th>Tracción máxima de anclaje</th><th>Combinación de tracción</th></tr></thead><tbody>${a.reactionEnvelopes.map(r=>`<tr><td>(${n(r.point_m[0])}, ${n(r.point_m[1])})</td><td>${formatForce(Math.max(0,r.components[2].max))}</td><td>${formatForce(Math.max(0,-r.components[2].min))}</td><td><button class="eng-combination-link" type="button" data-analysis-combination="${esc(r.components[2].minCombination)}">${esc(r.components[2].minCombination)}</button></td></tr>`).join("")}</tbody></table></div>
    <h4>Desplazamiento entre niveles · servicio</h4><ul class="eng-list">${a.drifts.map(d=>`<li><strong>${esc(project.levels[d.level].name)}:</strong> ${n(d.max_m*1000,2)} mm / límite ${n(d.limit_m*1000,2)} mm. <strong>${d.status==="fails_project_limit"?"No cumple el límite del proyecto":"Dentro del límite del proyecto"}</strong>. <button class="eng-combination-link" type="button" data-analysis-combination="${esc(d.combination)}">Ver combinación</button></li>`).join("")}</ul>
    <p class="eng-note">Seleccioná Modelo analítico, Reacciones o Deformada bajo el 3D para revisar una combinación. El JSON completo incluye cada caso, ruta tributaria, diagrama recuperable y las envolventes con su posición. Las uniones y el segundo orden siguen pendientes.</p></section>`;
}

/** Selectores de uso por identidad de nivel; conserva los destinos al reordenar niveles. */
export function engineeringUsageHtml(project) {
  return project.levels.map((lv, i) => `<label>Uso · ${esc(lv.name)}<select data-path="engineering.usage.${i}.use">${Object.entries(USES).map(([id, use]) => `<option value="${id}">${esc(use.label)}</option>`).join("")}</select></label>`).join("");
}

function loadResultsHtml(r) {
  const wind = r.wind, q = wind.referencePressure, seismic = r.seismic;
  const forceRow = (c) => `<tr><td>${esc(c.label)}</td><td>${formatForce(-c.force_N[2])}</td><td>${formatForce(Math.hypot(c.force_N[0], c.force_N[1]))}</td></tr>`;
  const pressureRow = (p) => `<tr><td>${esc(p.zone)} · nivel ${p.level + 1}${p.eave ? " · alero" : ""}</td><td>${n(p.area_m2, 3)} m²</td><td>${formatPressure(p.negative_Pa)}</td><td>${formatPressure(p.positive_Pa)}</td><td>${esc(p.reference)}</td></tr>`;
  return `<h3>Acciones L, Lr y S · cargas hacia abajo</h3><div class="table-wrap"><table class="eng-table"><thead><tr><th>Caso</th><th>Vertical hacia abajo</th><th>Horizontal</th></tr></thead><tbody>${[r.live.L, r.live.Lr, ...r.snow.cases].map(forceRow).join("")}</tbody></table></div>
    <p class="eng-note">L: ${r.live.L.entries.map((a) => `${esc(a.use)} ${formatPressure(a.pressure_Pa)}`).join("; ")}. Lr: ${r.live.Lr.entries.map((a) => `${formatPressure(a.pressure_Pa)} (${esc(a.reference)}; D cubierta ${n(a.roofD_Pa / 1000, 3)} kPa)`).join("; ") || "Cubierta accesible: participa como L"}.</p>
    <p class="eng-note">S: ${r.snow.rows.map((a) => `${formatPressure(a.pressure_Pa)} = máx.(0,7×${a.Ce}×${a.Ct}×${a.I}×${n(a.pg_Pa / 1000, 3)}, mínimo ${n(a.minimum_Pa / 1000, 3)})×Cs=${a.Cs}`).join("; ")} · CIRSOC 104-2005 §§3/4. Casos de acumulación incluyen cota superior de Fig.9 y corte real en el borde.</p>
    <h3>Viento ${wind.edition} · sistema principal</h3>
    <p class="eng-note">${esc(wind.scope)}</p><p>${q ? `${esc(q.formula)} = ${formatPressure(q.qz_Pa)}; V=${q.V_m_s} m/s; Kz=${n(q.Kz, 3)}; Kzt=${q.Kzt}; Kd=${q.Kd}; ${q.Ke ? `Ke=${q.Ke}` : `I=${q.I}`}. ${esc(q.reference)}.` : "Presiones sin calcular: revisá los datos."}</p>
    <p class="eng-note">${esc(wind.enclosure ?? "")} · GCpi=±${wind.GCpi ?? "—"}. Usá el selector debajo del 3D para ver presión, succión, aleros y sentidos del viento. ${wind.cases.length} casos principales; C&R es una envolvente local independiente.</p>
    <details><summary>Casos de viento y torsión (${wind.cases.length})</summary><div class="table-wrap"><table class="eng-table"><thead><tr><th>Caso</th><th>Vertical hacia abajo</th><th>Horizontal</th></tr></thead><tbody>${wind.cases.map(forceRow).join("")}</tbody></table></div></details>
    <details><summary>Presiones locales · 24 parches más exigidos</summary><p class="eng-note">Área efectiva por componente: ${r.wind.components[0]?.effectiveArea_m2 ?? "—"} m². El área del parche sólo dibuja la zona; no sustituye el área efectiva de cada fijación. Todos los parches y coeficientes están en el JSON.</p><div class="table-wrap"><table class="eng-table"><thead><tr><th>Zona</th><th>Parche</th><th>Succión</th><th>Presión</th><th>Fuente</th></tr></thead><tbody>${[...wind.components].sort((a, b) => a.negative_Pa - b.negative_Pa).slice(0, 24).map(pressureRow).join("")}</tbody></table></div></details>
    <h3>Sismo · acciones preliminares</h3><p>${seismic.exempt ? esc(seismic.exemption) : seismic.coefficient ? `Zona ${seismic.zone}; C=${n(seismic.coefficient.C, 4)}; W=${formatForce(seismic.W_N)}; V₀=${formatForce(seismic.V0_N)}; R=${seismic.coefficient.R ?? "mínimo zona 0"}. ${esc(seismic.coefficient.reference)}.` : "Acción E sin calcular: requiere estudio específico; no se reemplaza por cero."}</p>
    <p class="eng-note">${seismic.cases.length ? "Incluye cuatro sentidos, Ev± y excentricidad accidental ±5 %. El reparto por rigidez no está calculado." : "La exención depende de zona y grupo confirmados."}</p>
    <h3>Combinaciones · ${r.combinations.length} alternativas</h3><p class="eng-note">${esc(r.scope)} Cada sentido y torsión conserva su ID. Lr y S son alternativos. Se omiten variables favorables en variantes adicionales. Las envolventes siguientes son de cargas globales; no identifican todavía qué barra o anclaje gobierna.</p>
    <div class="table-wrap"><table class="eng-table"><thead><tr><th>Estado</th><th>Eje</th><th>Mínimo</th><th>Máximo</th></tr></thead><tbody>${r.envelopes.flatMap((en) => en.force.map((f) => `<tr><td>${en.state}</td><td>${["X", "Y", "Z"][f.axis]}</td><td>${formatForce(f.min_N)}<small>${esc(f.minCombination)}</small></td><td>${formatForce(f.max_N)}<small>${esc(f.maxCombination)}</small></td></tr>`)).join("")}</tbody></table></div>
    <details><summary>Fórmulas y fuentes · primeras 40 (detalle completo en JSON)</summary><div class="table-wrap"><table class="eng-table"><thead><tr><th>Combinación</th><th>Fórmula</th><th>Artículo</th></tr></thead><tbody>${r.combinations.slice(0, 40).map((c) => `<tr><td>${esc(c.id)}</td><td>${esc(c.formula)}</td><td>${esc(c.reference)}</td></tr>`).join("")}</tbody></table></div></details>`;
}

function extraLoadsHtml(project) {
  const loads = project.engineering.extraLoads;
  return `<details id="extraLoadsEditor"><summary>Equipos permanentes · cargas puntuales (${loads.length})</summary><p class="eng-note">Ubicá tanque, termotanque o equipo en planta. Fuerza en kN; las coordenadas siguen el plano. Se muestra un marcador en 3D. El equipo no se agrega como material estructural al BOM.</p>
    ${loads.map((a, i) => `<div class="eng-material"><div class="fields fields--2"><label>Equipo<input data-extra-index="${i}" data-extra-field="label" value="${esc(a.label)}" /></label>
    <label>Nivel<select data-extra-index="${i}" data-extra-field="levelId">${project.levels.map((lv) => `<option value="${esc(lv.id)}" ${a.levelId === lv.id ? "selected" : ""}>${esc(lv.name)}</option>`).join("")}</select></label>
    <label>Destino<select data-extra-index="${i}" data-extra-field="target"><option value="floor" ${a.target === "floor" ? "selected" : ""}>Piso</option><option value="roof" ${a.target === "roof" ? "selected" : ""}>Cubierta</option></select></label>
    ${[["x_m", "x (m)", a.x_m], ["y_m", "y (m)", a.y_m], ["force_N", "Carga (kN)", a.force_N / 1000]].map(([field, label, v]) => `<label>${label}<input type="number" step="any" ${field === "force_N" ? 'min="0.001" max="10000"' : ""} value="${v}" data-extra-index="${i}" data-extra-field="${field}" /></label>`).join("")}
    <label>Fuente<input data-extra-index="${i}" data-extra-field="source" value="${esc(a.source)}" /></label><label class="check"><input type="checkbox" data-extra-index="${i}" data-extra-field="confirmed" ${a.confirmed ? "checked" : ""} /> Carga documentada</label><button type="button" class="btn btn--ghost" data-extra-remove="${i}">Quitar equipo</button></div></div>`).join("")}
    <button type="button" class="btn btn--ghost" data-extra-add>Agregar carga permanente</button></details>`;
}
