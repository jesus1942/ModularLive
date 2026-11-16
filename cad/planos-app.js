// Planos: lee el diseño abierto en el diseñador y arma las láminas a escala.
import { createStore } from "./store.js";
import { generate } from "./generator.js";
import { SHEET_DEFAULTS, buildSheets, normalizeSheet } from "./sheets.js";
import { download, escapeHtml, slug } from "./bom-view.js";

const $ = (sel) => document.querySelector(sel);
const store = createStore();
const fields = [...document.querySelectorAll("[data-s]")];
let sheets = [];

let toastTimer;
function toast(message) {
  const el = $("#toast");
  el.textContent = message;
  el.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("is-visible"), 2800);
}

function fillForm() {
  const meta = normalizeSheet(store.project.sheet);
  fields.forEach((el) => {
    if (document.activeElement === el) return;
    el.value = meta[el.dataset.s] ?? "";
    if (el.dataset.s === "obra") el.placeholder = store.project.name ?? "";
    if (el.dataset.s === "fecha") el.placeholder = new Date().toLocaleDateString("es-AR");
  });
}

function render() {
  const project = store.project;
  // la fecha de hoy va al rótulo si no se cargó otra
  const meta = normalizeSheet(project.sheet);
  const shown = { ...project, sheet: { ...meta, fecha: meta.fecha || new Date().toLocaleDateString("es-AR") } };
  sheets = buildSheets(shown, generate(project));
  if (!sheets.length) {
    $("#sheets").innerHTML = `<div class="planos__empty"><h1>Todavía no hay nada para dibujar</h1><p>Los planos salen del diseño abierto en el diseñador. Dibujá el contorno o armá un módulo o un loft, y volvé a esta pantalla.</p><p><a class="btn" href="cad.html">Ir al diseñador</a></p></div>`;
    $("#sheetList").innerHTML = "";
    return;
  }
  $("#sheets").innerHTML = sheets
    .map((s, i) => `<figure class="sheet" id="lamina-${s.id}">
      <figcaption><strong>${String(i + 1).padStart(2, "0")} · ${escapeHtml(s.title)}</strong><span>Esc. ${escapeHtml(s.scale)} · A3 · <button type="button" data-svg="${i}">SVG</button></span></figcaption>
      <div class="sheet__paper">${s.svg}</div>
    </figure>`)
    .join("");
  $("#sheetList").innerHTML = sheets.map((s) => `<li><a href="#lamina-${s.id}">${escapeHtml(s.title)}</a></li>`).join("");
}

$("#sheetForm").addEventListener("change", (e) => {
  const key = e.target.dataset?.s;
  if (!key) return;
  store.update((p) => {
    p.sheet = normalizeSheet({ ...SHEET_DEFAULTS, ...(p.sheet ?? {}), [key]: e.target.value });
  });
});
$("#sheetForm").addEventListener("submit", (e) => e.preventDefault());
store.subscribe(() => {
  fillForm();
  render();
});

const fileOf = (s, i) => `${slug(store.project.name)}-${String(i + 1).padStart(2, "0")}-${slug(s.title)}.svg`;
$("#sheets").addEventListener("click", (e) => {
  const i = e.target.dataset?.svg;
  if (i === undefined) return;
  download(fileOf(sheets[i], Number(i)), sheets[i].svg, "image/svg+xml");
});
$("#svgAllBtn").addEventListener("click", () => {
  if (!sheets.length) { toast("No hay láminas para descargar."); return; }
  sheets.forEach((s, i) => setTimeout(() => download(fileOf(s, i), s.svg, "image/svg+xml"), i * 250));
  toast(`${sheets.length} láminas en SVG, a escala, para abrir en cualquier programa de dibujo.`);
});
$("#printBtn").addEventListener("click", () => {
  if (!sheets.length) { toast("No hay láminas para imprimir."); return; }
  window.print();
});
// si el diseño cambió en otra pestaña, se vuelve a dibujar al volver
window.addEventListener("storage", (e) => {
  if (e.key === "modularlive_cad_project") location.reload();
});

fillForm();
render();

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
