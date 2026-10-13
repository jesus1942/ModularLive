import { createStore } from "./store.js";
import { createPlanEditor } from "./plan-editor.js";
import { createViewer, LAYERS } from "./viewer3d.js";
import { generate } from "./generator.js";
import { bomToCsv, computeBom, cutListToCsv } from "./bom.js";
import { copyContour, createDefaultProject, createLevel, defaultSwing, doorLeaf, levelName, newId } from "./model.js";
import { STAIR_KINDS, STAIR_TREADS } from "./stairs.js";
import { STAIR_RULES } from "./data/stair-rules.js";
import { GUARD } from "./exposed.js";
import { FOUNDATIONS, ROOF_TYPES } from "./catalog.js";
import { pointKey, wallDir, wallLength } from "./geometry.js";
import { createEngineeringClient } from "./engineering/worker-client.js";
import { engineeringInputsHtml, engineeringUsageHtml, engineeringPrintHtml, engineeringResultHtml, engineeringSummaryHtml } from "./engineering/panel.js";
import { MATERIALS } from "./engineering/data/materials.js";
import { LOCATIONS, locationWind_m_s } from "./engineering/data/locations.js";
import { windCasePatches } from "./engineering/wind.js";
import { formatPressure, formatForce } from "./engineering/units.js";

const PRICES_KEY = "modularlive_prices"; // compartido con la calculadora rápida
const $ = (sel) => document.querySelector(sel);

const store = createStore();
let gen = null;
let bom = null;
let engineering = null;
let engineeringExtraOpen = false;

// ---------- utilidades ----------
const fmtNum = (v, d = 2) => Number(v).toLocaleString("es-AR", { maximumFractionDigits: d, minimumFractionDigits: 0 });
const fmtMoney = (v) => Number(v).toLocaleString("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });
const opt = (value, label, current) => `<option value="${value}" ${value === current ? "selected" : ""}>${label}</option>`;
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

let toastTimer;
function toast(message) {
  const el = $("#toast");
  el.textContent = message;
  el.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("is-visible"), 2600);
}

function getPrices() {
  try {
    return JSON.parse(localStorage.getItem(PRICES_KEY) || "{}");
  } catch {
    return {};
  }
}
function savePrice(material, price) {
  try {
    const prices = getPrices();
    if (price > 0) prices[material] = price;
    else delete prices[material];
    localStorage.setItem(PRICES_KEY, JSON.stringify(prices));
  } catch {
    /* sin almacenamiento */
  }
}

function download(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const slug = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "proyecto";

/**
 * Rechaza solo datos fuera de rango o ilegibles. El atributo step es una ayuda de las flechas:
 * una medida como 2,62 m o un alero de 0,33 m es válida aunque no caiga en el paso de 0,05.
 */
const outOfRange = (el) => el.validity.badInput || el.validity.rangeUnderflow || el.validity.rangeOverflow;

const getPath = (obj, path) => path.split(".").reduce((o, k) => o?.[k], obj);
const setPath = (obj, path, value) => {
  const keys = path.split(".");
  const last = keys.pop();
  const target = keys.reduce((o, k) => (o[k] ??= {}), obj);
  target[last] = value;
};

// ---------- nivel activo ----------
const activeLevel = () => Math.min(editor.level, store.project.levels.length - 1);
const levelOf = (p) => p.levels[activeLevel()];

// ---------- editor y visor ----------
const editor = createPlanEditor({
  svg: $("#planSvg"),
  store,
  status: $("#planStatus"),
  onSelectionChange: (sel) => {
    renderSelection();
    viewer?.highlightWall(sel?.wallId ?? null);
  },
  onToolChange: (tool) => {
    document.querySelectorAll("[data-tool]").forEach((b) => b.classList.toggle("is-active", b.dataset.tool === tool));
  }
});

let viewer = null;
try {
  viewer = createViewer($("#viewer"));
} catch (error) {
  $("#viewer").innerHTML = `<p class="viewer__error">No se pudo iniciar el 3D en este dispositivo (${escapeHtml(error.message)}).</p>`;
}

const layerState = Object.fromEntries(LAYERS.map((l) => [l.id, !["cerramientos", "cubierta", "cielorraso"].includes(l.id)]));
function renderLayerToggles() {
  $("#layerToggles").innerHTML = LAYERS.map(
    (l) => `<label class="chip"><input type="checkbox" data-layer="${l.id}" ${layerState[l.id] ? "checked" : ""}/> ${l.label}</label>`
  ).join("");
  LAYERS.forEach((l) => viewer?.setLayerVisible(l.id, layerState[l.id]));
}
$("#layerToggles").addEventListener("change", (e) => {
  const id = e.target.dataset.layer;
  if (!id) return;
  layerState[id] = e.target.checked;
  viewer?.setLayerVisible(id, e.target.checked);
});
document.querySelectorAll("[data-preset]").forEach((btn) =>
  btn.addEventListener("click", () => {
    const finished = btn.dataset.preset === "terminado";
    LAYERS.forEach((l) => {
      layerState[l.id] = finished ? l.id !== "estructura" : !["cerramientos", "cubierta", "cielorraso"].includes(l.id);
    });
    renderLayerToggles();
  })
);
$("#frame3d").addEventListener("click", () => viewer?.frame());

/** Aplica al visor el caso seleccionado; el selector no altera ni recalcula el proyecto. */
function renderWindView() {
  if (!engineering) return;
  const mode = $("#windViewMode").value;
  $("#windTooltip").textContent="";
  const analytical=mode.startsWith("analysis-");
  $("#analysisCaseField").hidden=!analytical;
  $("#deformationScaleField").hidden=mode!=="analysis-deformed";
  $("#analysisDetail").hidden=!analytical;
  if(analytical) {
    $("#windCaseField").hidden=true;viewer?.setWindPatches([]);viewer?.setPointLoads([]);
    if(engineering.analysis?.status!=="calculated") {viewer?.setAnalysisView(null,null,"none");$("#windLegend").textContent="Análisis sin resolver: revisá los apoyos y las advertencias en Ingeniería.";$("#analysisDetail").textContent="";return;}
    viewer?.setAnalysisView(null,null,"none");$("#analysisDetail").textContent="";
    $("#windLegend").textContent="Recuperando combinación…";
    engineeringClient.detail($("#analysisCombinationSelect").value);return;
  }
  viewer?.setAnalysisView(null,null,"none");
  const select = $("#windCaseSelect");
  const previous = select.value;
  select.innerHTML = engineering.wind.cases.map((c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.label)} · ${escapeHtml(c.id)}</option>`).join("");
  if ([...select.options].some((op) => op.value === previous)) select.value = previous;
  $("#windCaseField").hidden = mode !== "main";
  let patches = [], pointEntries = [];
  const minimumCase = select.value.startsWith("W:min:");
  if (mode === "main") {
    patches = windCasePatches(engineering.wind, select.value);
    pointEntries = engineering.wind.cases.find((c) => c.id === select.value)?.pointEntries ?? [];
  } else if (mode.startsWith("local-")) {
    patches = engineering.wind.components.map((p) => {
      const pressure_Pa = mode === "local-positive" ? p.positive_Pa : p.negative_Pa;
      return { ...p, pressure_Pa, force_N: p.normal.map((n) => -pressure_Pa * p.area_m2 * n) };
    });
  }
  viewer?.setWindPatches(patches, pointEntries);
  viewer?.setPointLoads(engineering.entries.filter((r) => r.kind === "extra"));
  const lo = Math.min(0, ...patches.map((p) => p.pressure_Pa)), hi = Math.max(0, ...patches.map((p) => p.pressure_Pa));
  $("#windLegend").textContent = mode === "model" ? "Cielorraso: activá su capa para ver placa y estructura. Los equipos aportados llevan una flecha vertical."
    : `${engineering.wind.edition} · oscuro: succión (−); claro: presión (+). Flechas normales a la superficie. ${formatPressure(lo)} a ${formatPressure(hi)}. ${mode === "main" ? minimumCase ? "Mínimo horizontal sobre proyección vertical; no es succión de techo." : "Caso simultáneo del sistema principal." : "C&R: envolvente local por componente, no simultánea ni sumable al viento global."} Escenario con supuestos.`;
  $("#windTooltip").textContent = "";
}
$("#windViewMode").addEventListener("change", renderWindView);
$("#windCaseSelect").addEventListener("change", renderWindView);
$("#analysisCombinationSelect").addEventListener("change", renderWindView);
$("#deformationScale").addEventListener("change", renderWindView);

/** Publica sólo la revisión vigente; ningún resultado anterior permanece tras editar. */
const engineeringClient=createEngineeringClient({
  onResult(result) {
    engineering=result;
    $("#engineeringSummary").innerHTML=engineeringSummaryHtml(engineering);
    $("#engineeringPanel").innerHTML=engineeringResultHtml(engineering,store.project);
    if($("#extraLoadsEditor"))$("#extraLoadsEditor").open=engineeringExtraOpen;
    const select=$("#analysisCombinationSelect"),previous=select.value;
    select.innerHTML=engineering.analysis?.status==="calculated"?engineering.combinations.map(c=>`<option value="${escapeHtml(c.id)}">${escapeHtml(c.state)} · ${escapeHtml(c.formula || "Sin acciones variables")}</option>`).join(""):"";
    if([...select.options].some(op=>op.value===previous))select.value=previous;
    else select.value=engineering.combinations.find(c=>c.state==="ELS"&&c.template==="SD")?.id??select.options[0]?.value??"";
    select.disabled=engineering.analysis?.status!=="calculated";
    $("#windCaseSelect").disabled=false;
    renderWindView();
  },
  onDetail(response,id) {
    if(!engineering||!$("#windViewMode").value.startsWith("analysis-")||id!==$("#analysisCombinationSelect").value)return;
    const mode=$("#windViewMode").value,amplification=Number($("#deformationScale").value);
    viewer?.setAnalysisView(engineering.analysis.model,response,mode,{amplification});
    const combination=engineering.combinations.find(c=>c.id===id);
    $("#windLegend").textContent=mode==="analysis-deformed"?`Deformada elástica amplificada ×${amplification}. Modelo original en gris. Sin segundo orden ni verificación de resistencia.`:mode==="analysis-reactions"?"Flechas de reacción sobre la estructura; hacia abajo indica tracción del anclaje. No incluyen peso ni capacidad de la fundación.":"Ejes analíticos de la estructura principal. Los puntos entre módulos comparten traslación y permiten giros independientes.";
    $("#analysisDetail").innerHTML=response?`<p class="eng-note"><strong>${escapeHtml(combination.state)} · ${escapeHtml(combination.formula||"Sin acciones")}</strong></p><p class="eng-note">Carga sobre el pórtico: X ${formatForce(response.applied.force_N[0])}; Y ${formatForce(response.applied.force_N[1])}; Z ${formatForce(response.applied.force_N[2])}. Error de equilibrio ${response.equilibrium.relativeError.toExponential(2)}.</p>`:"<p>Análisis sin resolver.</p>";
  },
  onExport(json){download(`${slug(store.project.name)}-ingenieria-completa.json`,json,"application/json");},
  onError(message) {
    engineering=null;viewer?.setAnalysisView(null,null,"none");
    $("#engineeringSummary").innerHTML='<h3>Ingeniería</h3><p>El cálculo no pudo completarse.</p>';
    $("#engineeringPanel").innerHTML=`<p class="eng-note eng-scope">${escapeHtml(message)}. Editá el proyecto para reintentar; no hay resultados vigentes.</p>`;
  }
});
window.addEventListener("pagehide",()=>engineeringClient.dispose());

// ---------- regeneración ----------
let lastLevelCount = null;
function regenerate() {
  const project = store.project;
  if($("#extraLoadsEditor"))engineeringExtraOpen=$("#extraLoadsEditor").open;
  if (editor.level > project.levels.length - 1) editor.setLevel(project.levels.length - 1);
  gen = generate(project);
  bom = computeBom(project, gen);
  engineering = null;
  editor.setGeneration(gen);
  viewer?.build(gen);
  viewer?.setWindPatches([]);viewer?.setPointLoads([]);viewer?.setAnalysisView(null,null,"none");
  $("#windCaseSelect").disabled=true;$("#analysisCombinationSelect").disabled=true;
  $("#analysisDetail").textContent="";$("#windLegend").textContent="Calculando…";
  if (lastLevelCount !== null && lastLevelCount !== project.levels.length) viewer?.frame();
  lastLevelCount = project.levels.length;
  viewer?.highlightWall(editor.getSelection()?.wallId ?? null);
  renderMetrics();
  renderMaterials();
  renderCuts();
  renderSelection();
  renderLevelBar();
  $("#engineeringSummary").innerHTML = '<h3>Ingeniería</h3><p role="status">Calculando…</p>';
  $("#engineeringPanel").innerHTML = '<p class="eng-note" role="status">Calculando cargas y estructura… Podés seguir editando la planta.</p>';
  engineeringClient.schedule(project,gen);
  syncSettingsForm();
  $("#undoBtn").disabled = !store.canUndo();
  $("#redoBtn").disabled = !store.canRedo();
}

let pending = null;
store.subscribe(() => {
  cancelAnimationFrame(pending);
  pending = requestAnimationFrame(regenerate);
});

// ---------- formulario de parámetros ----------
const FOUNDATION_FIELDS = {
  dados: [
    ["padSize", "Lado del dado (m)", 0.05],
    ["padDepth", "Profundidad bajo terreno (m)", 0.05],
    ["elevation", "Altura sobre terreno (m)", 0.05]
  ],
  vigas_pilotines: [
    ["beamWidth", "Ancho de viga (m)", 0.05],
    ["beamHeight", "Alto de viga (m)", 0.05],
    ["pileDiameter", "Diámetro de pilotín (m)", 0.05],
    ["pileDepth", "Profundidad de pilotín (m)", 0.1],
    ["pileSpacing", "Separación máx. de pilotines (m)", 0.1],
    ["elevation", "Altura sobre terreno (m)", 0.05]
  ],
  platea: [
    ["slabThickness", "Espesor de platea (m)", 0.01],
    ["edgeBeamWidth", "Ancho de viga de borde (m)", 0.05],
    ["edgeBeamHeight", "Alto de viga de borde (m)", 0.05],
    ["margin", "Sobresale del muro (m)", 0.05],
    ["elevation", "Altura sobre terreno (m)", 0.01]
  ]
};

let renderedFoundation = null;
function renderFoundationFields() {
  const type = store.project.foundation.type;
  if (renderedFoundation === type) return;
  renderedFoundation = type;
  $("#foundationFields").innerHTML = FOUNDATION_FIELDS[type]
    .map(([key, label, step]) => `<label>${label}<input type="number" min="0" step="${step}" data-path="foundation.${key}" /></label>`)
    .join("");
}

function syncSettingsForm() {
  const usage = $("#engineeringUsageInputs");
  if (usage && !usage.contains(document.activeElement)) usage.innerHTML = engineeringUsageHtml(store.project);
  renderFoundationFields();
  $("#levelHeight").dataset.path = `levels.${activeLevel()}.height`;
  $("#levelHeightLabel").textContent = `Altura al bastidor superior · ${levelOf(store.project).name} (m)`;
  $("#floorSpacingField").hidden = store.project.foundation.type === "platea";
  const nameInput = $("#projectName");
  if (document.activeElement !== nameInput) nameInput.value = store.project.name;
  document.querySelectorAll("#settingsPanel [data-path]").forEach((el) => {
    if (document.activeElement === el) return;
    const value = getPath(store.project, el.dataset.path);
    if (el.type === "checkbox") el.checked = Boolean(value);
    else el.value = typeof value === "number" ? value / Number(el.dataset.scale ?? 1) : value ?? "";
  });
}

$("#settingsPanel").addEventListener("change", (e) => {
  const el = e.target;
  const path = el.dataset.path;
  if (!path) return;
  let value = el.type === "checkbox" ? el.checked : el.type === "number" ? Number(el.value) : el.value;
  if (el.type === "number" && (!el.value.trim() || outOfRange(el) || !Number.isFinite(value))) {
    toast("Ingresá un número válido dentro del rango indicado.");
    el.value = getPath(store.project, path) / Number(el.dataset.scale ?? 1);
    return;
  }
  if (el.type === "number") value *= Number(el.dataset.scale ?? 1);
  store.update((p) => {
    setPath(p, path, value);
    if (path === "foundation.type") p.foundation = { ...FOUNDATIONS[value].defaults, type: value };
    if (path === "roof.type") p.roof.slope = ROOF_TYPES[value].defaultSlope;
    if (path.startsWith("engineering.")) {
      const group = path.split(".")[1];
      if (["location", "soil", "steel", "concrete"].includes(group) && !path.endsWith(".confirmed") && !path.endsWith(".certified")) {
        if (group === "location" || group === "soil") p.engineering[group].confirmed = false;
        else p.engineering[group].certified = false;
      }
      p.engineering.inputIssues = p.engineering.inputIssues.filter((message) => !message.includes(path));
      // Reconocer un preset no inventa datos locales ni elimina el escenario ingresado.
      if (["engineering.location.preset", "engineering.codeEdition", "engineering.importance"].includes(path)) {
        const edition = p.engineering.codeEdition;
        p.engineering.location.V = locationWind_m_s(p.engineering.location.preset, edition, p.engineering.importance) ?? (edition === "2025" ? p.engineering.importance === "II" || p.engineering.importance === "I" ? 80.8 : 88.7 : 58);
        p.engineering.location.windEdition = edition;
        p.engineering.location.windRisk = p.engineering.importance;
        p.engineering.location.confirmed = false;
        p.engineering.location.source = "";
        p.engineering.jurisdictionConfirmed = false;
        if (path === "engineering.location.preset") {
          p.engineering.location.pg = LOCATIONS[value]?.pg ?? .3;
          p.engineering.location.seismicZone = 0;
        }
      }
      if (path === "engineering.jurisdiction") p.engineering.jurisdictionConfirmed = false;
      if (path.startsWith("engineering.snow.") && !path.endsWith(".confirmed")) p.engineering.snow.confirmed = false;
      if (path.startsWith("engineering.seismic.") && !path.endsWith(".confirmed")) p.engineering.seismic.confirmed = false;
      if (path.startsWith("engineering.wind.") && !path.endsWith(".serviceConfirmed")) p.engineering.wind.serviceConfirmed = false;
    }
  });
});

$("#projectName").addEventListener("change", (e) => {
  const name = e.target.value.trim() || "Proyecto modular";
  store.update((p) => {
    p.name = name;
  });
});

$("#snapStep").addEventListener("change", (e) => editor.setSnapStep(Number(e.target.value)));
$("#orthoToggle").addEventListener("change", (e) => editor.setOrtho(e.target.checked));

// ---------- panel de selección ----------
function moveVertex(project, from, to) {
  const key = pointKey(from);
  levelOf(project).walls.forEach((w) => {
    if (pointKey(w.a) === key) w.a = { ...to };
    if (pointKey(w.b) === key) w.b = { ...to };
  });
}

function renderSelection() {
  const panel = $("#selectionPanel");
  const sel = editor.getSelection();
  const project = store.project;
  const level = levelOf(project);
  const li = activeLevel();
  if (sel?.type === "stair") {
    const st = (level.stairs ?? []).find((x) => x.id === sel.stairId);
    if (st) {
      renderStairPanel(panel, st, li);
      return;
    }
  }
  if (sel?.type === "balcony") {
    const bal = (level.balconies ?? []).find((x) => x.id === sel.balconyId);
    if (bal) {
      renderBalconyPanel(panel, bal, li);
      return;
    }
  }
  if (sel?.type === "exposed" && gen?.levels?.[li]?.exposed) {
    panel.innerHTML = `<h3>${escapeHtml(level.name)} <span class="muted">parte descubierta</span></h3>${exposedHtml(li)}`;
    wireExposed(panel, li);
    return;
  }
  const wall = sel && level.walls.find((w) => w.id === sel.wallId);
  if (!sel || !wall) {
    const counts = level.walls.reduce((acc, w) => ((acc[w.type] += 1), acc), { exterior: 0, interior: 0 });
    const info = gen?.levels?.[li];
    panel.innerHTML = `
      <h3>${escapeHtml(level.name)} <span class="muted">${project.levels.length > 1 ? `de ${project.levels.length} niveles` : ""}</span></h3>
      <p class="muted">${counts.exterior} muros exteriores · ${counts.interior} tabiques${info ? ` · piso a ${fmtNum(info.floorTop)} m` : ""}. Elegí una herramienta arriba para dibujar o tocá un elemento para editarlo.</p>
      <div class="row-actions">
        <button type="button" class="btn btn--ghost" data-action="add-level">+ Nivel encima</button>
        ${li < project.levels.length - 1 ? '<button type="button" class="btn btn--ghost" data-action="add-stair">+ Escalera al nivel de arriba</button>' : ""}
        ${li > 0 ? '<button type="button" class="btn btn--ghost" data-action="copy-contour">Copiar contorno de abajo</button>' : ""}
        ${project.levels.length > 1 ? '<button type="button" class="btn btn--danger" data-action="delete-level">Eliminar nivel</button>' : ""}
      </div>
      ${exposedHtml(li)}
      <ul class="shortcuts">
        <li><kbd>R</kbd> rectángulo · <kbd>E</kbd> muro · <kbd>I</kbd> tabique</li>
        <li><kbd>P</kbd> puerta · <kbd>N</kbd> ventana · <kbd>V</kbd> seleccionar</li>
        <li>Doble clic en una puerta cambia hacia dónde abre</li>
        <li>Balcón: tocá un muro exterior y <em>+ Balcón</em></li>
        <li>Mientras dibujás, escribí el largo y <kbd>Enter</kbd></li>
      </ul>`;
    panel.querySelector('[data-action="add-level"]').addEventListener("click", addLevelAbove);
    wireExposed(panel, li);
    panel.querySelector('[data-action="add-stair"]')?.addEventListener("click", () => editor.setTool("stair"));
    panel.querySelector('[data-action="copy-contour"]')?.addEventListener("click", () => {
      if (level.walls.length && !confirm(`¿Reemplazar los muros de ${level.name} por el contorno del nivel de abajo?`)) return;
      store.update((p) => {
        p.levels[li].walls = copyContour(p.levels[li - 1].walls);
        p.levels[li].balconies = []; // colgaban de muros que ya no existen
      });
    });
    panel.querySelector('[data-action="delete-level"]')?.addEventListener("click", () => {
      if (!confirm(`¿Eliminar ${level.name}${li < project.levels.length - 1 ? " y bajar los niveles de arriba" : ""}? Se puede deshacer.`)) return;
      store.update((p) => {
        p.levels.splice(li, 1);
        p.levels.forEach((l, i) => {
          if (/^(Planta baja|Nivel \d+)$/.test(l.name)) l.name = levelName(i);
        });
      });
      editor.setLevel(Math.max(0, li - 1));
    });
    return;
  }
  const index = level.walls.indexOf(wall) + 1;
  if (sel.type === "opening") {
    const o = wall.openings.find((x) => x.id === sel.openingId);
    if (!o) {
      editor.setSelection(null);
      return;
    }
    panel.innerHTML = `
      <h3>${o.kind === "door" ? "Puerta" : "Ventana"} <span class="muted">en muro ${index}</span></h3>
      <div class="fields fields--2">
        <label>Tipo<select data-o="kind"><option value="door" ${o.kind === "door" ? "selected" : ""}>Puerta</option><option value="window" ${o.kind === "window" ? "selected" : ""}>Ventana</option></select></label>
        <label>Ancho (m)<input type="number" step="0.05" min="0.4" data-o="width" value="${o.width}" /></label>
        <label>Alto (m)<input type="number" step="0.05" min="0.3" data-o="height" value="${o.height}" /></label>
        ${o.kind === "window" ? `<label>Antepecho (m)<input type="number" step="0.05" min="0" data-o="sill" value="${o.sill}" /></label>` : ""}
        <label>Desde el inicio (m)<input type="number" step="0.05" min="0" data-o="offset" value="${o.offset.toFixed(2)}" /></label>
      </div>
      ${o.kind === "door" ? doorSwingHtml(wall, o, li) : ""}
      <div class="row-actions"><button type="button" class="btn btn--danger" data-action="delete">Eliminar abertura</button></div>`;
    panel.querySelectorAll("[data-swing]").forEach((b) =>
      b.addEventListener("click", () => {
        store.update((p) => {
          const op = levelOf(p).walls.find((w) => w.id === wall.id).openings.find((x) => x.id === o.id);
          if (b.dataset.swing === "hinge") op.hinge = op.hinge === "end" ? "start" : "end";
          else op.swing = op.swing === -1 ? 1 : -1;
        });
      })
    );
    panel.querySelectorAll("[data-o]").forEach((input) =>
      input.addEventListener("change", () => {
        const key = input.dataset.o;
        const value = key === "kind" ? input.value : Number(input.value);
        store.update((p) => {
          const op = levelOf(p).walls.find((w) => w.id === wall.id).openings.find((x) => x.id === o.id);
          op[key] = value;
          if (key === "kind") {
            Object.assign(op, value === "door" ? { sill: 0, height: 2.1, hinge: "start", swing: defaultSwing(wall, gen?.levels?.[li]?.footprint ?? null) } : { sill: 1, height: 1 });
          }
        });
      })
    );
  } else {
    const L = wallLength(wall);
    panel.innerHTML = `
      <h3>Muro ${index} <span class="muted">${wall.type === "exterior" ? "exterior" : "tabique"}</span></h3>
      <div class="fields fields--2">
        <label>Tipo<select data-w="type"><option value="exterior" ${wall.type === "exterior" ? "selected" : ""}>Exterior</option><option value="interior" ${wall.type === "interior" ? "selected" : ""}>Tabique interior</option></select></label>
        <label>Largo (m)<input type="number" step="0.05" min="0.3" data-w="length" value="${L.toFixed(2)}" /></label>
      </div>
      <p class="muted small">Cambiar el largo mueve el extremo final y arrastra los muros conectados.</p>
      <h4>Aberturas</h4>
      <ul class="opening-list">${
        wall.openings.length
          ? wall.openings
              .map((o) => `<li><button type="button" data-open="${o.id}">${o.kind === "door" ? `Puerta mano ${doorLeaf(wall, o).hand}` : "Ventana"} ${fmtNum(o.width)} × ${fmtNum(o.height)} m · a ${fmtNum(o.offset)} m</button></li>`)
              .join("")
          : '<li class="muted">Sin aberturas</li>'
      }</ul>
      <div class="row-actions">
        <button type="button" class="btn btn--ghost" data-action="add-door">+ Puerta</button>
        <button type="button" class="btn btn--ghost" data-action="add-window">+ Ventana</button>
        ${wall.type === "exterior" ? '<button type="button" class="btn btn--ghost" data-action="add-balcony">+ Balcón</button>' : ""}
        <button type="button" class="btn btn--danger" data-action="delete">Eliminar muro</button>
      </div>`;
    panel.querySelector('[data-w="type"]').addEventListener("change", (e) => {
      store.update((p) => {
        levelOf(p).walls.find((w) => w.id === wall.id).type = e.target.value;
      });
    });
    panel.querySelector('[data-w="length"]').addEventListener("change", (e) => {
      const next = Number(e.target.value);
      if (!(next > 0.2)) return;
      const dir = wallDir(wall);
      const target = { x: wall.a.x + dir.x * next, y: wall.a.y + dir.y * next };
      store.update((p) => moveVertex(p, wall.b, target));
    });
    panel.querySelectorAll("[data-open]").forEach((b) =>
      b.addEventListener("click", () => editor.setSelection({ type: "opening", wallId: wall.id, openingId: b.dataset.open }))
    );
    const addOpening = (kind) => {
      const def = kind === "door" ? { width: 0.9, height: 2.1, sill: 0 } : { width: 1.2, height: 1, sill: 1 };
      const width = Math.min(def.width, L - 0.4);
      // primer hueco libre
      const sorted = [...wall.openings].sort((a, b) => a.offset - b.offset);
      let offset = Math.max((L - width) / 2, 0.2);
      const free = (o) => !sorted.some((x) => o < x.offset + x.width + 0.1 && o + width > x.offset - 0.1);
      if (!free(offset)) {
        const candidates = [0.2, ...sorted.map((x) => x.offset + x.width + 0.2)];
        offset = candidates.find((c) => c + width <= L - 0.2 && free(c));
      }
      if (offset === undefined || width < 0.4) {
        toast("No hay lugar libre para otra abertura en este muro.");
        return;
      }
      const id = newId("o");
      const extra = kind === "door" ? { hinge: "start", swing: defaultSwing(wall, gen?.levels?.[li]?.footprint ?? null) } : {};
      store.update((p) => {
        levelOf(p).walls.find((w) => w.id === wall.id).openings.push({ id, kind, offset, ...def, width, ...extra });
      });
      editor.setSelection({ type: "opening", wallId: wall.id, openingId: id });
    };
    panel.querySelector('[data-action="add-door"]').addEventListener("click", () => addOpening("door"));
    panel.querySelector('[data-action="add-window"]').addEventListener("click", () => addOpening("window"));
    panel.querySelector('[data-action="add-balcony"]')?.addEventListener("click", () => {
      if (!gen?.levels?.[li]?.footprint) {
        toast("Cerrá el contorno exterior del nivel antes de colgar un balcón.");
        return;
      }
      const width = Math.round(Math.min(2.4, Math.max(L - 0.4, 0.6)) * 100) / 100;
      const door = wall.openings.find((o) => o.kind === "door");
      const center = door ? door.offset + door.width / 2 : L / 2;
      const offset = Math.round(Math.max(0, Math.min(L - width, center - width / 2)) * 1000) / 1000;
      const id = newId("b");
      store.update((p) => {
        const lv = levelOf(p);
        lv.balconies = [...(lv.balconies ?? []), { id, wallId: wall.id, offset, width, depth: 1.2, support: "voladizo", railing: true }];
      });
      editor.setSelection({ type: "balcony", balconyId: id });
      if (!door) toast("Balcón agregado. Falta una puerta en este muro para salir a él.");
    });
  }
  panel.querySelector('[data-action="delete"]').addEventListener("click", () => editor.deleteSelection());
}

/** Qué se hace con la parte del nivel que el de arriba no tapa: techo a un agua o terraza. */
function exposedHtml(li) {
  const info = gen?.levels?.[li]?.exposed;
  const project = store.project;
  if (!info?.length || !project.levels[li + 1]) return "";
  const cfg = project.levels[li].exposed;
  const up = project.levels[li + 1].name;
  const area = info.reduce((sum, part) => sum + part.area, 0);
  const isRoof = cfg.kind !== "terraza";
  return `
    <div class="exposed-box">
      <h4>Parte descubierta · ${fmtNum(area)} m²</h4>
      <p class="muted small">Es lo que ${escapeHtml(up)} no tapa. Donde ${escapeHtml(up)} apoya, el techo de este nivel es su entrepiso.</p>
      <div class="fields fields--2">
        <label>Se cubre con<select data-ex="kind">${opt("techo", "Techo a un agua", cfg.kind)}${opt("terraza", "Terraza transitable", cfg.kind)}</select></label>
        ${isRoof
          ? `<label>Pendiente (%)<input type="number" min="2" max="60" step="1" data-ex="slope" value="${cfg.slope}" /></label>
             <label>Alero (m)<input type="number" min="0" max="1.2" step="0.05" data-ex="overhang" value="${cfg.overhang}" /></label>`
          : `<label class="check"><input type="checkbox" data-ex="railing" ${cfg.railing ? "checked" : ""} /> Baranda de ${GUARD.height.toFixed(2).replace(".", ",")} m en los bordes libres</label>`}
      </div>
      <p class="muted small">${isRoof
        ? "El agua corre hacia afuera, nunca contra el nivel de arriba. Los muros de abajo suben hasta el techo y cierran el entretecho; contra el nivel de arriba lleva babeta."
        : `Deck sobre membrana con 1,5 % hacia afuera y 2 cm por debajo del piso interior. Necesita una puerta desde ${escapeHtml(up)}.`}</p>
    </div>`;
}

function wireExposed(panel, li) {
  panel.querySelectorAll("[data-ex]").forEach((el) =>
    el.addEventListener("change", () => {
      const key = el.dataset.ex;
      if (el.type === "number" && (!el.value.trim() || outOfRange(el) || !Number.isFinite(Number(el.value)))) {
        toast(key === "slope" ? "La pendiente va de 2 a 60 %." : "El alero va de 0 a 1,20 m.");
        el.value = store.project.levels[li].exposed[key];
        return;
      }
      store.update((p) => {
        p.levels[li].exposed = { ...p.levels[li].exposed, [key]: el.type === "checkbox" ? el.checked : el.type === "number" ? Number(el.value) : el.value };
      });
    })
  );
}

/** Panel de un balcón colgado de un muro exterior. */
function renderBalconyPanel(panel, bal, li) {
  const level = levelOf(store.project);
  const info = gen?.levels?.[li]?.balconies?.find((b) => b.id === bal.id);
  const wall = level.walls.find((w) => w.id === bal.wallId);
  const index = level.walls.indexOf(wall) + 1;
  panel.innerHTML = `
    <h3>Balcón <span class="muted">en muro ${index}</span></h3>
    <p class="stair-sum"><strong>${fmtNum(bal.width)} × ${fmtNum(bal.depth)} m</strong> · ${fmtNum(bal.width * bal.depth)} m² · piso 4 cm bajo el interior${info ? `<br>${info.cantilevers} vigas ${bal.support === "voladizo" ? "en voladizo soldadas al bastidor" : `y ${info.posts} columnas con dado`}` : ""}</p>
    <div class="fields fields--2">
      <label>Ancho (m)<input type="number" min="0.6" max="30" step="0.05" data-bal="width" value="${bal.width}" /></label>
      <label>Profundidad libre (m)<input type="number" min="0.6" max="3" step="0.05" data-bal="depth" value="${bal.depth}" /></label>
      <label>Desde el inicio del muro (m)<input type="number" min="0" max="100" step="0.05" data-bal="offset" value="${bal.offset.toFixed(2)}" /></label>
      <label>Apoyo<select data-bal="support">${opt("voladizo", "En voladizo", bal.support)}${opt("columnas", "Con columnas al terreno", bal.support)}</select></label>
      <label class="check"><input type="checkbox" data-bal="railing" ${bal.railing ? "checked" : ""} /> Baranda de ${GUARD.height.toFixed(2).replace(".", ",")} m</label>
    </div>
    <div class="row-actions"><button type="button" class="btn btn--danger" data-action="delete">Eliminar balcón</button></div>
    ${info?.warnings?.length ? `<ul class="warnings">${info.warnings.map((w) => `<li>${escapeHtml(w)}</li>`).join("")}</ul>` : ""}
    <p class="muted small">Arrastralo para correrlo a lo largo del muro. Voladizo recomendado hasta 1,20 m; más profundo, con columnas. ${escapeHtml(GUARD.source)}</p>`;
  panel.querySelectorAll("[data-bal]").forEach((el) =>
    el.addEventListener("change", () => {
      const key = el.dataset.bal;
      if (el.type === "number" && (!el.value.trim() || outOfRange(el) || !Number.isFinite(Number(el.value)))) {
        toast("Ingresá una medida válida dentro del rango indicado.");
        el.value = bal[key];
        return;
      }
      store.update((p) => {
        const target = (levelOf(p).balconies ?? []).find((b) => b.id === bal.id);
        if (!target) return;
        target[key] = el.type === "checkbox" ? el.checked : el.type === "number" ? Number(el.value) : el.value;
        if (key === "depth" && target.depth > 1.2 && target.support === "voladizo") toast("Más de 1,20 m en voladizo: conviene apoyarlo en columnas.");
      });
    })
  );
  panel.querySelector('[data-action="delete"]').addEventListener("click", () => editor.deleteSelection());
}

/** Panel de una escalera: tipo, ancho, reglas, verificaciones y avisos. */
function renderStairPanel(panel, st, li) {
  const lay = gen?.stairs?.find((l) => l.stair.id === st.id && l.level === li);
  const fmt3 = (v) => fmtNum(v, 3);
  const sol = lay?.solution;
  const option = (value, label, current) => `<option value="${value}" ${value === current ? "selected" : ""}>${label}</option>`;
  const rules = STAIR_RULES[st.ruleSet] ?? STAIR_RULES.municipal;
  panel.innerHTML = `
    <h3>Escalera <span class="muted">${STAIR_KINDS[st.kind]}</span></h3>
    ${!lay ? '<p class="warn-inline">No hay nivel encima: agregá un nivel para que la escalera tenga adónde llegar.</p>' : ""}
    ${sol?.ok ? `<p class="stair-sum"><strong>${sol.n} alzadas de ${fmt3(sol.a)} m</strong> · pedada ${fmtNum(sol.p)} m · 2a + p = ${fmt3(sol.blondel)} m<br>${lay.risers.length} tramo${lay.risers.length > 1 ? "s" : ""} (${lay.risers.join(" + ")}) · salva ${fmt3(sol.a * sol.n)} m · largo ${fmtNum(lay.length)} m</p>` : ""}
    <div class="fields fields--2">
      <label>Tipo<select data-st="kind">${Object.entries(STAIR_KINDS).map(([k, l]) => option(k, l, st.kind)).join("")}</select></label>
      ${st.kind !== "recta" ? `<label>Gira hacia<select data-st="turn">${option("derecha", "Derecha", st.turn)}${option("izquierda", "Izquierda", st.turn)}</select></label>` : ""}
      <label>Ancho libre (m)<input type="number" min="0.6" max="2" step="0.05" data-st="width" value="${st.width}" /></label>
      <label>Escalones<select data-st="tread">${Object.entries(STAIR_TREADS).map(([k, l]) => option(k, l, st.tread)).join("")}</select></label>
      <label>Reglas<select data-st="ruleSet">${option("municipal", "Código municipal (vivienda)", st.ruleSet)}${option("accesible", "Accesible (Ley 24.314)", st.ruleSet)}</select></label>
    </div>
    <div class="row-actions">
      <button type="button" class="btn btn--ghost" data-st-action="rotate">↻ Girar 90°</button>
      <button type="button" class="btn btn--ghost" data-st-action="flip">⇄ Invertir sentido</button>
      <button type="button" class="btn btn--danger" data-action="delete">Eliminar escalera</button>
    </div>
    ${lay?.checks?.length ? `<h4>Verificación</h4><ul class="checks">${lay.checks.map((c) => `<li class="${c.ok ? "ok" : "bad"}"><span>${c.ok ? "✓" : "✗"}</span> ${escapeHtml(c.label)} <small>${escapeHtml(c.detail)}</small></li>`).join("")}</ul>` : ""}
    ${lay?.warnings?.length ? `<ul class="warnings">${lay.warnings.map((w) => `<li>${escapeHtml(w)}</li>`).join("")}</ul>` : ""}
    <p class="muted small">${escapeHtml(rules.label)}. ${escapeHtml(rules.source)} Arrastrá la escalera para moverla: si queda cerca de un muro se pega a su cara.</p>`;
  const update = (fn) =>
    store.update((p) => {
      const target = levelOf(p).stairs.find((x) => x.id === st.id);
      if (target) fn(target);
    });
  panel.querySelectorAll("[data-st]").forEach((el) =>
    el.addEventListener("change", () => {
      const key = el.dataset.st;
      if (key === "width" && (outOfRange(el) || !Number.isFinite(Number(el.value)))) {
        toast("El ancho tiene que estar entre 0,60 y 2,00 m.");
        el.value = st.width;
        return;
      }
      update((t) => {
        t[key] = key === "width" ? Number(el.value) : el.value;
        if (key === "ruleSet" && el.value === "accesible") t.width = Math.max(t.width, STAIR_RULES.accesible.minWidth);
      });
    })
  );
  panel.querySelector('[data-st-action="rotate"]').addEventListener("click", () => update((t) => { t.dir = (t.dir + 90) % 360; }));
  panel.querySelector('[data-st-action="flip"]').addEventListener("click", () => update((t) => { t.dir = (t.dir + 180) % 360; }));
  panel.querySelector('[data-action="delete"]').addEventListener("click", () => editor.deleteSelection());
}

function doorSwingHtml(wall, o, li) {
  const leaf = doorLeaf(wall, o);
  const footprint = gen?.levels?.[li]?.footprint;
  let side = leaf.side === 1 ? "hacia un lado" : "hacia el otro lado";
  if (wall.type === "exterior" && footprint) side = defaultSwing(wall, footprint) === leaf.side ? "hacia adentro" : "hacia afuera";
  return `
    <h4>Apertura</h4>
    <p class="swing-desc">Abre <strong>${side}</strong> · mano <strong>${leaf.hand}</strong> <span class="muted small">(vista desde el lado hacia donde abre)</span></p>
    <div class="row-actions">
      <button type="button" class="btn btn--ghost" data-swing="hinge" title="Pasa las bisagras al otro extremo">⇄ Cambiar bisagra</button>
      <button type="button" class="btn btn--ghost" data-swing="side" title="Abre hacia el otro lado del muro">⇅ Abrir del otro lado</button>
    </div>
    <p class="muted small">También podés hacer doble clic sobre la puerta en la planta.</p>`;
}

function addLevelAbove() {
  const project = store.project;
  const top = project.levels.length - 1;
  const source = project.levels[top];
  if (!source.walls.some((w) => w.type === "exterior")) {
    toast("Dibujá primero el contorno del nivel de abajo.");
    return;
  }
  store.update((p) => {
    p.levels.push(createLevel(p.levels.length, copyContour(source.walls), source.height));
  });
  editor.setLevel(top + 1);
  toast(`${levelName(top + 1)} agregado con el contorno de abajo. Editalo como quieras.`);
}

function renderLevelBar() {
  const project = store.project;
  const li = activeLevel();
  const short = (l, i) => (i === 0 ? "PB" : `N${i}`);
  $("#levelBar").innerHTML =
    [...project.levels]
      .map((l, i) => ({ l, i }))
      .reverse()
      .map(({ l, i }) => `<button type="button" data-level="${i}" class="${i === li ? "is-active" : ""}" title="${escapeHtml(l.name)}">${short(l, i)}</button>`)
      .join("") + '<button type="button" data-level-add title="Agregar un nivel encima (copia el contorno)">+</button>';
  const sel = $("#levelView");
  const options = ['<option value="all">Todos los niveles</option>', ...project.levels.map((l, i) => `<option value="${i}">Hasta ${escapeHtml(l.name.toLowerCase())}</option>`)];
  if (project.levels.length > 1) {
    const value = sel.value;
    sel.innerHTML = options.join("");
    sel.value = [...sel.options].some((op) => op.value === value) ? value : "all";
    sel.hidden = false;
  } else {
    sel.hidden = true;
    sel.value = "all";
  }
  viewer?.setMaxLevel(sel.value === "all" ? Infinity : Number(sel.value));
}

$("#levelBar").addEventListener("click", (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;
  if (btn.hasAttribute("data-level-add")) {
    addLevelAbove();
    return;
  }
  editor.setLevel(Number(btn.dataset.level));
  regenerate();
  requestAnimationFrame(() => editor.render());
});
$("#levelView").addEventListener("change", (e) => viewer?.setMaxLevel(e.target.value === "all" ? Infinity : Number(e.target.value)));

// ---------- resultados ----------
function renderMetrics() {
  const s = bom.summary;
  const items = [
    ["Sup. cubierta", `${fmtNum(s.coveredArea)} m²${s.levels > 1 ? ` · ${s.levels} niveles` : ""}`],
    ["Cubierta", `${fmtNum(s.roofArea)} m²`],
    ["Acero a comprar (barras)", `${fmtNum(s.steelKg, 0)} kg`],
    ["Barras de perfil", fmtNum(s.structuralBars, 0)],
    ["Hormigón", `${fmtNum(s.concrete)} m³`],
    ["Piezas", fmtNum(s.pieces, 0)]
  ];
  $("#metrics").innerHTML = items.map(([k, v]) => `<div><span>${k}</span><strong>${v}</strong></div>`).join("");
  $("#warnings").innerHTML = gen.warnings.map((w) => `<li>${escapeHtml(w)}</li>`).join("");
}

function renderMaterials() {
  const prices = getPrices();
  let total = 0;
  let lastCategory = null;
  const rows = bom.rows
    .map((r) => {
      const price = Number(prices[r.material]) || 0;
      const subtotal = price * r.quantity;
      total += subtotal;
      const head = r.category !== lastCategory ? `<tr class="cat"><th colspan="5">${r.category}</th></tr>` : "";
      lastCategory = r.category;
      return `${head}<tr>
        <td><strong>${escapeHtml(r.material)}</strong><small>${escapeHtml(r.detail)}</small></td>
        <td class="num">${fmtNum(r.quantity)}</td>
        <td>${r.unit}</td>
        <td class="num"><input type="number" min="0" step="any" inputmode="decimal" data-price="${escapeHtml(r.material)}" value="${price || ""}" placeholder="$" aria-label="Precio unitario de ${escapeHtml(r.material)}" /></td>
        <td class="num">${subtotal ? fmtMoney(subtotal) : "—"}</td>
      </tr>`;
    })
    .join("");
  $("#materialsPanel").innerHTML = `
    <div class="table-wrap"><table class="bom">
      <thead><tr><th>Material</th><th class="num">Cantidad</th><th>Unidad</th><th class="num">Precio unit.</th><th class="num">Subtotal</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><td colspan="4">Total materiales con precio cargado</td><td class="num">${total ? fmtMoney(total) : "—"}</td></tr></tfoot>
    </table></div>`;
}

$("#materialsPanel").addEventListener("change", (e) => {
  const material = e.target.dataset.price;
  if (!material) return;
  savePrice(material, Number(e.target.value));
  renderMaterials();
});

function renderCuts() {
  $("#cutsPanel").innerHTML = bom.cutLists
    .map((list) => {
      const bars = list.bars
        .map((bar, i) => {
          const segs = bar.pieces
            .map((p) => `<span class="seg${p.spliced ? " seg--splice" : ""}" style="flex-basis:${(p.length / list.stock) * 100}%" title="${escapeHtml(p.group)} · ${fmtNum(p.length, 3)} m">${p.length >= 0.45 ? fmtNum(p.length, 2) : ""}</span>`)
            .join("");
          return `<div class="bar"><span class="bar__n">${i + 1}</span><div class="bar__track">${segs}<span class="seg seg--waste" style="flex-basis:${(bar.waste / list.stock) * 100}%"></span></div></div>`;
        })
        .join("");
      return `<article class="cutlist">
        <header><h4>${escapeHtml(list.label)}</h4><span>${list.barCount} barras de ${fmtNum(list.stock)} m · ${fmtNum(list.totalLength)} m útiles · desperdicio ${fmtNum(list.wastePercent, 1)}%${list.splices ? ` · ${list.splices} empalmes` : ""}</span></header>
        <div class="bars">${bars}</div>
      </article>`;
    })
    .join("");
}

/** Cambia la pestaña sin descartar el resultado ni alterar el modelo de obra. */
function showTab(name) {
  document.querySelectorAll("[data-tab]").forEach((t) => t.classList.toggle("is-active", t.dataset.tab === name));
  ["materials", "cuts", "engineering"].forEach((id) => { $(`#${id}Panel`).hidden = id !== name; });
}
document.querySelectorAll("[data-tab]").forEach((tab) => tab.addEventListener("click", () => showTab(tab.dataset.tab)));
$("#engineeringSummary").addEventListener("click", (e) => {
  if (!e.target.closest("[data-show-engineering]")) return;
  showTab("engineering");
  $("#engineeringPanel").scrollIntoView({ behavior: "smooth", block: "start" });
});
$("#engineeringPanel").addEventListener("change", (e) => {
  const el = e.target;
  if (el.dataset.extraIndex !== undefined) {
    const index = Number(el.dataset.extraIndex), field = el.dataset.extraField;
    let value = el.type === "checkbox" ? el.checked : el.type === "number" ? Number(el.value) : el.value;
    if (el.type === "number" && (!el.value.trim() || outOfRange(el) || !Number.isFinite(value))) { toast("Ingresá una coordenada o fuerza válida."); regenerate(); return; }
    if (field === "force_N") value *= 1000;
    store.update((p) => { const load = p.engineering.extraLoads[index]; if (!load) return; load[field] = value; if (field !== "confirmed") load.confirmed = false; });
    return;
  }
  const id = el.dataset.material;
  const field = el.dataset.materialField;
  if (!MATERIALS[id] || !["value", "source", "confirmed"].includes(field)) return;
  if (field === "value" && (!el.value.trim() || outOfRange(el) || !Number.isFinite(Number(el.value)))) {
    toast("Cargá un peso mayor que cero. El dato anterior se conserva.");
    el.value = store.project.engineering.materialOverrides[id]?.value ?? MATERIALS[id].value;
    return;
  }
  store.update((p) => {
    const override = p.engineering.materialOverrides[id] ??= { value: MATERIALS[id].value, source: "", confirmed: false };
    override[field] = field === "confirmed" ? el.checked : field === "value" ? Number(el.value) : el.value.trim();
    if (field !== "confirmed") override.confirmed = false;
  });
});
$("#engineeringPanel").addEventListener("click", (e) => {
  const caseId=e.target.closest("[data-analysis-combination]")?.dataset.analysisCombination;
  if(caseId){$("#analysisCombinationSelect").value=caseId;$("#windViewMode").value="analysis-reactions";renderWindView();$("#viewer").scrollIntoView({behavior:"smooth",block:"center"});return;}
  if (e.target.closest("[data-extra-add]")) {
    const lv = gen.levels[activeLevel()], footprint = lv.footprint;
    if (!footprint) { toast("Cerrá el contorno del nivel para ubicar un equipo."); return; }
    const x = footprint.reduce((s, p) => s + p.x, 0) / footprint.length, y = footprint.reduce((s, p) => s + p.y, 0) / footprint.length;
    store.update((p) => p.engineering.extraLoads.push({ id: newId("load"), levelId: p.levels[activeLevel()].id, target: "floor", x_m: x, y_m: y, force_N: 1000, label: "Equipo permanente", source: "", confirmed: false }));
  }
  const remove = e.target.closest("[data-extra-remove]");
  if (remove) store.update((p) => p.engineering.extraLoads.splice(Number(remove.dataset.extraRemove), 1));
  const id = e.target.closest("[data-material-reset]")?.dataset.materialReset;
  if (MATERIALS[id]) store.update((p) => { delete p.engineering.materialOverrides[id]; });
  if (e.target.closest("#engineeringJsonBtn")) {
    if(!engineeringClient.export())toast("Esperá a que termine el cálculo vigente.");
  }
});

// ---------- barra superior ----------
document.querySelectorAll("[data-tool]").forEach((b) => b.addEventListener("click", () => editor.setTool(b.dataset.tool)));
$("#undoBtn").addEventListener("click", () => store.undo());
$("#redoBtn").addEventListener("click", () => store.redo());
$("#fitBtn").addEventListener("click", () => {
  editor.fit();
  viewer?.frame();
});
$("#zoomIn").addEventListener("click", () => editor.zoom(1.25));
$("#zoomOut").addEventListener("click", () => editor.zoom(0.8));

document.querySelectorAll("button[data-view]").forEach((b) =>
  b.addEventListener("click", () => {
    document.querySelectorAll("button[data-view]").forEach((x) => x.classList.toggle("is-active", x === b));
    $("#stage").dataset.view = b.dataset.view;
    requestAnimationFrame(() => {
      editor.render();
      viewer?.resize();
    });
  })
);

$("#newBtn").addEventListener("click", () => {
  if (!confirm("¿Empezar un diseño nuevo? El actual se puede recuperar con Deshacer.")) return;
  const blank = createDefaultProject();
  blank.levels = [createLevel(0, [])];
  blank.name = "Proyecto nuevo";
  store.replace(blank);
  editor.setLevel(0);
  editor.setTool("rect");
});

$("#saveBtn").addEventListener("click", () => {
  download(`${slug(store.project.name)}.modular.json`, JSON.stringify(store.project, null, 2), "application/json");
});

$("#openFile").addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data.walls) && !Array.isArray(data.levels)) throw new Error("formato");
    store.replace(data);
    editor.setLevel(0);
    requestAnimationFrame(() => {
      editor.fit();
      viewer?.frame();
    });
    toast(`Diseño "${data.name ?? file.name}" abierto.`);
  } catch {
    toast("El archivo no es un diseño de ModularLive válido.");
  }
  e.target.value = "";
});

$("#csvBtn").addEventListener("click", () => {
  download(`${slug(store.project.name)}-materiales.csv`, "﻿" + bomToCsv(store.project, bom, getPrices()), "text/csv;charset=utf-8");
});
$("#cutsCsvBtn").addEventListener("click", () => {
  download(`${slug(store.project.name)}-cortes.csv`, "﻿" + cutListToCsv(bom), "text/csv;charset=utf-8");
});

$("#printBtn").addEventListener("click", () => {
  if(!engineering){toast("Esperá a que termine el cálculo vigente para imprimir.");return;}
  const img = viewer ? `<img src="${viewer.snapshot()}" alt="Vista 3D" />` : "";
  const plan = $("#planSvg").outerHTML;
  const p = store.project;
  $("#printSheet").innerHTML = `
    <h1>${escapeHtml(p.name)}</h1>
    <p>${new Date().toLocaleDateString("es-AR")} · ${fmtNum(bom.summary.footprintArea)} m² cubiertos · ${FOUNDATIONS[p.foundation.type].label} · techo ${ROOF_TYPES[p.roof.type].label.toLowerCase()}</p>
    <div class="print-views">${img}<div class="print-plan">${plan}</div></div>
    ${engineeringPrintHtml(engineering, p)}`;
  window.print();
});

window.addEventListener("keydown", (e) => {
  const tag = e.target?.tagName;
  if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
    e.preventDefault();
    if (e.shiftKey) store.redo();
    else store.undo();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
    e.preventDefault();
    store.redo();
    return;
  }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const keys = { v: "select", r: "rect", e: "exterior", i: "interior", p: "door", n: "window", s: "stair" };
  const tool = keys[e.key.toLowerCase()];
  if (tool && editor.tool !== tool && !/^[0-9]$/.test(e.key)) editor.setTool(tool);
});

window.addEventListener("resize", () => editor.render());

// ---------- inicio ----------
$("#engineeringInputs").innerHTML = engineeringInputsHtml();
renderLayerToggles();
editor.setTool("select");
regenerate();
requestAnimationFrame(() => {
  editor.fit();
  viewer?.frame();
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

