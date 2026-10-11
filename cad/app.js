import { createStore } from "./store.js";
import { createPlanEditor } from "./plan-editor.js";
import { createViewer, LAYERS } from "./viewer3d.js";
import { generate } from "./generator.js";
import { bomToCsv, computeBom, cutListToCsv } from "./bom.js";
import { createDefaultProject, newId } from "./model.js";
import { FOUNDATIONS, ROOF_TYPES } from "./catalog.js";
import { pointKey, wallDir, wallLength } from "./geometry.js";

const PRICES_KEY = "modularlive_prices"; // compartido con la calculadora rápida
const $ = (sel) => document.querySelector(sel);

const store = createStore();
let gen = null;
let bom = null;

// ---------- utilidades ----------
const fmtNum = (v, d = 2) => Number(v).toLocaleString("es-AR", { maximumFractionDigits: d, minimumFractionDigits: 0 });
const fmtMoney = (v) => Number(v).toLocaleString("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });
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

const getPath = (obj, path) => path.split(".").reduce((o, k) => o?.[k], obj);
const setPath = (obj, path, value) => {
  const keys = path.split(".");
  const last = keys.pop();
  const target = keys.reduce((o, k) => (o[k] ??= {}), obj);
  target[last] = value;
};

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

const layerState = Object.fromEntries(LAYERS.map((l) => [l.id, !["cerramientos", "cubierta"].includes(l.id)]));
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
      layerState[l.id] = finished ? l.id !== "estructura" : !["cerramientos", "cubierta"].includes(l.id);
    });
    renderLayerToggles();
  })
);
$("#frame3d").addEventListener("click", () => viewer?.frame());

// ---------- regeneración ----------
function regenerate() {
  const project = store.project;
  gen = generate(project);
  bom = computeBom(project, gen);
  editor.setGeneration(gen);
  viewer?.build(gen);
  viewer?.highlightWall(editor.getSelection()?.wallId ?? null);
  renderMetrics();
  renderMaterials();
  renderCuts();
  renderSelection();
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
  renderFoundationFields();
  $("#floorSpacingField").hidden = store.project.foundation.type === "platea";
  const nameInput = $("#projectName");
  if (document.activeElement !== nameInput) nameInput.value = store.project.name;
  document.querySelectorAll("#settingsPanel [data-path]").forEach((el) => {
    if (document.activeElement === el) return;
    const value = getPath(store.project, el.dataset.path);
    if (el.type === "checkbox") el.checked = Boolean(value);
    else el.value = value ?? "";
  });
}

$("#settingsPanel").addEventListener("change", (e) => {
  const el = e.target;
  const path = el.dataset.path;
  if (!path) return;
  let value = el.type === "checkbox" ? el.checked : el.type === "number" ? Number(el.value) : el.value;
  if (el.type === "number" && !Number.isFinite(value)) return;
  store.update((p) => {
    setPath(p, path, value);
    if (path === "foundation.type") p.foundation = { ...FOUNDATIONS[value].defaults, type: value };
    if (path === "roof.type") p.roof.slope = ROOF_TYPES[value].defaultSlope;
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
  project.walls.forEach((w) => {
    if (pointKey(w.a) === key) w.a = { ...to };
    if (pointKey(w.b) === key) w.b = { ...to };
  });
}

function renderSelection() {
  const panel = $("#selectionPanel");
  const sel = editor.getSelection();
  const project = store.project;
  const wall = sel && project.walls.find((w) => w.id === sel.wallId);
  if (!sel || !wall) {
    const counts = project.walls.reduce((acc, w) => ((acc[w.type] += 1), acc), { exterior: 0, interior: 0 });
    panel.innerHTML = `
      <h3>Planta</h3>
      <p class="muted">${counts.exterior} muros exteriores · ${counts.interior} tabiques. Elegí una herramienta arriba para dibujar o tocá un elemento para editarlo.</p>
      <ul class="shortcuts">
        <li><kbd>R</kbd> rectángulo · <kbd>E</kbd> muro · <kbd>I</kbd> tabique</li>
        <li><kbd>P</kbd> puerta · <kbd>N</kbd> ventana · <kbd>V</kbd> seleccionar</li>
        <li>Mientras dibujás, escribí el largo y <kbd>Enter</kbd></li>
      </ul>`;
    return;
  }
  const index = project.walls.indexOf(wall) + 1;
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
      <div class="row-actions"><button type="button" class="btn btn--danger" data-action="delete">Eliminar abertura</button></div>`;
    panel.querySelectorAll("[data-o]").forEach((input) =>
      input.addEventListener("change", () => {
        const key = input.dataset.o;
        const value = key === "kind" ? input.value : Number(input.value);
        store.update((p) => {
          const op = p.walls.find((w) => w.id === wall.id).openings.find((x) => x.id === o.id);
          op[key] = value;
          if (key === "kind") Object.assign(op, value === "door" ? { sill: 0, height: 2.1 } : { sill: 1, height: 1 });
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
              .map((o) => `<li><button type="button" data-open="${o.id}">${o.kind === "door" ? "Puerta" : "Ventana"} ${fmtNum(o.width)} × ${fmtNum(o.height)} m · a ${fmtNum(o.offset)} m</button></li>`)
              .join("")
          : '<li class="muted">Sin aberturas</li>'
      }</ul>
      <div class="row-actions">
        <button type="button" class="btn btn--ghost" data-action="add-door">+ Puerta</button>
        <button type="button" class="btn btn--ghost" data-action="add-window">+ Ventana</button>
        <button type="button" class="btn btn--danger" data-action="delete">Eliminar muro</button>
      </div>`;
    panel.querySelector('[data-w="type"]').addEventListener("change", (e) => {
      store.update((p) => {
        p.walls.find((w) => w.id === wall.id).type = e.target.value;
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
      store.update((p) => {
        p.walls.find((w) => w.id === wall.id).openings.push({ id, kind, offset, ...def, width });
      });
      editor.setSelection({ type: "opening", wallId: wall.id, openingId: id });
    };
    panel.querySelector('[data-action="add-door"]').addEventListener("click", () => addOpening("door"));
    panel.querySelector('[data-action="add-window"]').addEventListener("click", () => addOpening("window"));
  }
  panel.querySelector('[data-action="delete"]').addEventListener("click", () => editor.deleteSelection());
}

// ---------- resultados ----------
function renderMetrics() {
  const s = bom.summary;
  const items = [
    ["Sup. cubierta", `${fmtNum(s.footprintArea)} m²`],
    ["Cubierta", `${fmtNum(s.roofArea)} m²`],
    ["Acero estructural", `${fmtNum(s.steelKg, 0)} kg`],
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

document.querySelectorAll("[data-tab]").forEach((tab) =>
  tab.addEventListener("click", () => {
    document.querySelectorAll("[data-tab]").forEach((t) => t.classList.toggle("is-active", t === tab));
    $("#materialsPanel").hidden = tab.dataset.tab !== "materials";
    $("#cutsPanel").hidden = tab.dataset.tab !== "cuts";
  })
);

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

document.querySelectorAll("[data-view]").forEach((b) =>
  b.addEventListener("click", () => {
    document.querySelectorAll("[data-view]").forEach((x) => x.classList.toggle("is-active", x === b));
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
  blank.walls = [];
  blank.name = "Proyecto nuevo";
  store.replace(blank);
  editor.setSelection(null);
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
    if (!Array.isArray(data.walls)) throw new Error("formato");
    store.replace(data);
    editor.setSelection(null);
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
  const img = viewer ? `<img src="${viewer.snapshot()}" alt="Vista 3D" />` : "";
  const plan = $("#planSvg").outerHTML;
  const p = store.project;
  $("#printSheet").innerHTML = `
    <h1>${escapeHtml(p.name)}</h1>
    <p>${new Date().toLocaleDateString("es-AR")} · ${fmtNum(bom.summary.footprintArea)} m² cubiertos · ${FOUNDATIONS[p.foundation.type].label} · techo ${ROOF_TYPES[p.roof.type].label.toLowerCase()}</p>
    <div class="print-views">${img}<div class="print-plan">${plan}</div></div>`;
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
  const keys = { v: "select", r: "rect", e: "exterior", i: "interior", p: "door", n: "window" };
  const tool = keys[e.key.toLowerCase()];
  if (tool && editor.tool !== tool && !/^[0-9]$/.test(e.key)) editor.setTool(tool);
});

window.addEventListener("resize", () => editor.render());

// ---------- inicio ----------
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

