// Cómputo rápido: formulario → proyecto del diseñador → mismas piezas, mismo cómputo.
import { generate } from "./generator.js";
import { bomToCsv, computeBom, cutListToCsv } from "./bom.js";
import { createViewer, LAYERS } from "./viewer3d.js";
import { QUICK_DEFAULTS, QUICK_PRESETS, normalizeQuick, quickProject } from "./quick.js";
import { FOUNDATIONS, ROOF_TYPES } from "./catalog.js";
import { cutsHtml, download, escapeHtml, fmtMoney, fmtNum, getPrices, materialsTableHtml, materialsTotal, savePrice, slug } from "./bom-view.js";

const FORM_KEY = "modularlive_quick";
const DESIGN_KEY = "modularlive_cad_project"; // el diseño abierto en el diseñador
const $ = (sel) => document.querySelector(sel);
const fields = [...document.querySelectorAll("[data-q]")];

let state = null; // { input, project, gen, bom, notes }

let toastTimer;
function toast(message) {
  const el = $("#toast");
  el.textContent = message;
  el.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("is-visible"), 2800);
}

// ---------- formulario ----------
function readForm() {
  const raw = {};
  fields.forEach((el) => {
    raw[el.dataset.q] = el.type === "checkbox" ? el.checked : el.type === "number" ? (el.value.trim() === "" ? NaN : Number(el.value)) : el.value;
  });
  return raw;
}

function fillForm(input) {
  fields.forEach((el) => {
    const value = input[el.dataset.q];
    if (el.type === "checkbox") el.checked = Boolean(value);
    else if (document.activeElement !== el) el.value = value ?? "";
  });
}

function loadInitial() {
  const params = new URLSearchParams(location.search);
  if ([...params.keys()].length) return normalizeQuick(Object.fromEntries(params));
  try {
    const saved = JSON.parse(localStorage.getItem(FORM_KEY) || "null");
    if (saved) return normalizeQuick(saved);
  } catch {
    /* sin almacenamiento */
  }
  return normalizeQuick(QUICK_DEFAULTS);
}

function applyPreset(preset, keep) {
  const values = QUICK_PRESETS[preset];
  if (!values) return keep;
  const roof = values.roofType ?? "plano";
  return normalizeQuick({ ...keep, ...values, preset, roofType: roof, slope: values.slope ?? ROOF_TYPES[roof].defaultSlope });
}

// ---------- visor ----------
let viewer = null;
try {
  viewer = createViewer($("#viewer"));
  LAYERS.forEach((l) => viewer.setLayerVisible(l.id, l.id !== "estructura"));
} catch (error) {
  $("#viewer").innerHTML = `<p class="viewer__error">No se pudo iniciar el 3D en este dispositivo (${escapeHtml(error.message)}).</p>`;
}

// ---------- cálculo y dibujo ----------
function compute() {
  const result = quickProject(readForm());
  const input = result.input;
  $("#openingsSection").hidden = input.preset === "loft";
  $("#loftOnly").hidden = input.preset !== "loft";
  $("#mirrorField").hidden = input.modules < 2;
  $("#heightLabel").textContent = input.preset === "loft" ? "Altura de planta baja (m)" : "Altura al bastidor superior (m)";
  $("#outTitle").textContent = input.name;
  if (result.error) {
    state = null;
    $("#outLead").textContent = "";
    $("#outNotes").innerHTML = `<li>${escapeHtml(result.error)}</li>`;
    $("#outFigures").innerHTML = $("#outMoney").innerHTML = $("#materialsPanel").innerHTML = $("#cutsPanel").innerHTML = "";
    return;
  }
  const gen = generate(result.project);
  const bom = computeBom(result.project, gen);
  state = { input, project: result.project, gen, bom, notes: [...result.notes, ...gen.warnings] };
  try {
    localStorage.setItem(FORM_KEY, JSON.stringify(input));
  } catch {
    /* sin almacenamiento */
  }
  viewer?.build(gen);
  viewer?.frame();
  render();
}

function render() {
  const { input, gen, bom, notes } = state;
  const s = bom.summary;
  const loft = input.preset === "loft";
  const what = loft ? "loft con altillo" : input.modules > 1 ? "módulos" : "módulo";
  $("#outLead").textContent = `${input.modules > 1 ? `${input.modules} ${loft ? "lofts con altillo" : what}` : `Un ${what}`} de ${fmtNum(input.length)} × ${fmtNum(input.width)} m${input.modules > 1 ? `${input.mirror ? ", en espejo," : ""} independientes, cada uno con sus muros, piso, techo y fundación` : ""}. ${FOUNDATIONS[input.foundation].label}, techo ${ROOF_TYPES[input.roofType].label.toLowerCase()}.`;
  $("#outNotes").innerHTML = [...new Set(notes)].map((n) => `<li>${escapeHtml(n)}</li>`).join("");
  const openings = bom.rows.filter((r) => r.category === "Aberturas").reduce((sum, r) => sum + r.quantity, 0);
  const figures = [
    ["Superficie cubierta", `${fmtNum(s.coveredArea)} m²`],
    ["Cubierta", `${fmtNum(s.roofArea)} m²`],
    ["Muros exteriores", `${fmtNum(s.wallArea)} m²`],
    ["Aberturas", `${fmtNum(openings, 0)}`],
    ["Barras de perfil", `${fmtNum(s.structuralBars, 0)}`],
    ["Acero a comprar", `${fmtNum(s.steelKg, 0)} kg`],
    ["Hormigón", `${fmtNum(s.concrete)} m³`],
    ["Piezas de estructura", `${fmtNum(s.pieces, 0)}`]
  ];
  $("#outFigures").innerHTML = figures.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("");
  renderMoney();
  $("#materialsPanel").innerHTML = materialsTableHtml(bom);
  $("#cutsPanel").innerHTML = cutsHtml(bom);
}

function renderMoney() {
  const { input, bom } = state;
  const prices = getPrices();
  const materials = materialsTotal(bom, prices);
  const priced = bom.rows.filter((r) => Number(prices[r.material]) > 0).length;
  const labor = input.laborRate * bom.summary.coveredArea;
  const complete = priced === bom.rows.length;
  $("#outMoney").innerHTML = `
    <div><dt>Materiales${complete ? "" : ` (${priced} de ${bom.rows.length} con precio)`}</dt><dd>${materials ? fmtMoney(materials) : "—"}</dd></div>
    <div><dt>Mano de obra${input.laborRate ? ` · ${fmtNum(bom.summary.coveredArea)} m² × ${fmtMoney(input.laborRate)}` : ""}</dt><dd>${labor ? fmtMoney(labor) : "—"}</dd></div>
    <div><dt>Total${complete || !materials ? "" : " parcial"}</dt><dd>${materials + labor ? fmtMoney(materials + labor) : "—"}</dd></div>`;
}

let pending;
const schedule = () => {
  clearTimeout(pending);
  pending = setTimeout(compute, 140);
};

$("#quickForm").addEventListener("input", (e) => {
  const key = e.target.dataset.q;
  if (key === "preset") {
    fillForm(applyPreset(e.target.value, readFormSafe()));
  } else if (key === "roofType") {
    fields.find((el) => el.dataset.q === "slope").value = ROOF_TYPES[e.target.value].defaultSlope;
  } else if (key && !["name", "modules", "mirror", "laborRate", "preset"].includes(key)) {
    // un cambio a mano deja de ser el tipo predefinido, salvo en el loft, que tiene sus propias medidas
    const preset = fields.find((el) => el.dataset.q === "preset");
    if (preset.value !== "loft" && preset.value !== "custom" && ["length", "width", "height"].includes(key)) preset.value = "custom";
  }
  schedule();
});
$("#quickForm").addEventListener("change", (e) => {
  // al salir de un campo, lo que quedó fuera de rango se corrige a la vista
  if (!e.target.dataset?.q) return;
  clearTimeout(pending);
  compute();
  if (state) fillForm(state.input);
});
$("#quickForm").addEventListener("submit", (e) => e.preventDefault());
const readFormSafe = () => normalizeQuick(readForm());

$("#resetBtn").addEventListener("click", () => {
  const current = readFormSafe();
  const preset = current.preset === "custom" ? "vivienda" : current.preset;
  fillForm(applyPreset(preset, { ...QUICK_DEFAULTS, name: current.name, modules: current.modules, mirror: current.mirror, laborRate: current.laborRate }));
  compute();
});

// ---------- resultados ----------
$("#materialsPanel").addEventListener("change", (e) => {
  const material = e.target.dataset.price;
  if (!material || !state) return;
  savePrice(material, Number(e.target.value));
  $("#materialsPanel").innerHTML = materialsTableHtml(state.bom);
  renderMoney();
});
document.querySelectorAll("[data-tab]").forEach((tab) =>
  tab.addEventListener("click", () => {
    document.querySelectorAll("[data-tab]").forEach((t) => t.classList.toggle("is-active", t === tab));
    $("#materialsPanel").hidden = tab.dataset.tab !== "materials";
    $("#cutsPanel").hidden = tab.dataset.tab !== "cuts";
  })
);
$("#csvBtn").addEventListener("click", () => state && download(`${slug(state.input.name)}-materiales.csv`, "﻿" + bomToCsv(state.project, state.bom, getPrices()), "text/csv;charset=utf-8"));
$("#cutsCsvBtn").addEventListener("click", () => state && download(`${slug(state.input.name)}-cortes.csv`, "﻿" + cutListToCsv(state.bom), "text/csv;charset=utf-8"));
$("#printBtn").addEventListener("click", () => window.print());
$("#linkBtn").addEventListener("click", async () => {
  if (!state) return;
  const url = `${location.origin}${location.pathname}?${new URLSearchParams(Object.entries(state.input).map(([k, v]) => [k, String(v)]))}`;
  try {
    await navigator.clipboard.writeText(url);
    toast("Enlace copiado: abre este mismo cómputo en cualquier dispositivo.");
  } catch {
    prompt("Copiá el enlace:", url);
  }
});
$("#openDesigner").addEventListener("click", () => {
  if (!state) { toast("Corregí las medidas antes de abrirlo en el diseñador."); return; }
  let existing = false;
  try {
    existing = Boolean(localStorage.getItem(DESIGN_KEY));
  } catch {
    /* sin almacenamiento */
  }
  if (existing && !confirm("Esto reemplaza el diseño que tenés abierto en el diseñador. Si lo querés conservar, guardalo antes desde el diseñador. ¿Seguir?")) return;
  try {
    localStorage.setItem(DESIGN_KEY, JSON.stringify(state.project));
    location.href = "cad.html";
  } catch {
    toast("Este navegador no permite pasar el diseño. Usá «Copiar enlace» y armalo desde el diseñador.");
  }
});
window.addEventListener("resize", () => viewer?.resize());

// ---------- inicio ----------
fillForm(loadInitial());
compute();

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
