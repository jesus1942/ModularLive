import {
  buildSummaryCards,
  calculateProject,
  consolidateMaterials,
  consolidatedMaterialsToCsv,
  getPreset,
  getStructureSystem,
  materialsToCsv
} from "./calculator.js";

const form = document.querySelector("#projectForm");
const summaryGrid = document.querySelector("#summaryGrid");
const template = document.querySelector("#summaryCardTemplate");
const tableBody = document.querySelector("#materialsTableBody");
const consolidatedTableBody = document.querySelector("#consolidatedTableBody");
const summaryText = document.querySelector("#projectSummary");
const presetButton = document.querySelector("#presetButton");
const csvButton = document.querySelector("#csvButton");
const reportButton = document.querySelector("#reportButton");
const jsonButton = document.querySelector("#jsonButton");
const printButton = document.querySelector("#printButton");
const heroArea = document.querySelector("#heroArea");
const heroItems = document.querySelector("#heroItems");
const heroPanels = document.querySelector("#heroPanels");
const systemNote = document.querySelector("#systemNote");
const technicalSketch = document.querySelector("#technicalSketch");
const printProjectTitle = document.querySelector("#printProjectTitle");
const printMeta = document.querySelector("#printMeta");
const costSummary = document.querySelector("#costSummary");
const approvalNote = document.querySelector("#approvalNote");
const commercialBox = document.querySelector("#commercialBox");

let latestResult;
let renderScheduled = false;

function showToast(message, duration = 2800) {
  const container = document.querySelector("#toastContainer");
  if (!container) return;
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add("toast--out");
    toast.addEventListener("transitionend", () => toast.remove(), { once: true });
  }, duration);
}

function animateMetric(element) {
  element.classList.remove("metric-pop");
  void element.offsetWidth;
  element.classList.add("metric-pop");
}

function formDataToObject(currentForm) {
  return Object.fromEntries(new FormData(currentForm).entries());
}

function fillForm(values) {
  Object.entries(values).forEach(([key, value]) => {
    const field = form.elements.namedItem(key);
    if (field) {
      field.value = value;
    }
  });
}

function syncInteriorOptions() {
  const interiorUseField = form.elements.namedItem("interiorUseType");
  const liningField = form.elements.namedItem("wallInteriorLining");
  const currentUse = interiorUseField?.value;

  if (!currentUse || !liningField) {
    return;
  }

  if (currentUse === "dry" && liningField.value === "cement_board") {
    liningField.value = "drywall";
  }

  if (currentUse === "kitchen" && liningField.value === "drywall") {
    liningField.value = "moisture_drywall";
  }

  if (currentUse === "wet" && !["cement_board", "frp_panel", "moisture_drywall"].includes(liningField.value)) {
    liningField.value = "cement_board";
  }
}

function downloadFile(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderSummaryCards(cards) {
  summaryGrid.innerHTML = "";

  cards.forEach((card) => {
    const fragment = template.content.cloneNode(true);
    fragment.querySelector(".summary-label").textContent = card.label;
    fragment.querySelector(".summary-value").textContent = card.value;
    fragment.querySelector(".summary-note").textContent = card.note;
    summaryGrid.appendChild(fragment);
  });
}

const PRICES_KEY = 'modularlive_prices';
function getPrices() {
  try { return JSON.parse(localStorage.getItem(PRICES_KEY) || '{}'); }
  catch { return {}; }
}
function savePrice(materialName, price) {
  const prices = getPrices();
  if (price > 0) prices[materialName] = price;
  else delete prices[materialName];
  localStorage.setItem(PRICES_KEY, JSON.stringify(prices));
}

const ML_CACHE_KEY = 'modularlive_ml_cache';

function getMLCache() {
  try { return JSON.parse(localStorage.getItem(ML_CACHE_KEY) || '{}'); }
  catch { return {}; }
}

function saveMLCache(cache) {
  localStorage.setItem(ML_CACHE_KEY, JSON.stringify(cache));
}

async function fetchMLItem(query) {
  const url = `https://api.mercadolibre.com/sites/MLA/search?q=${encodeURIComponent(query)}&limit=5`;
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!resp.ok) return null;
    const data = await resp.json();
    if (!data.results || data.results.length === 0) return null;
    const results = data.results.filter(r => r.price > 0);
    if (results.length === 0) return null;
    const prices = results.map(r => r.price).sort((a, b) => a - b);
    const median = prices[Math.floor(prices.length / 2)];
    const best = results[0];
    return { price: Math.round(median), link: best.permalink, title: best.title };
  } catch {
    return null;
  }
}

async function fetchAllMLPrices() {
  if (!latestResult) renderProject();
  const btn = document.querySelector('#mlFetchBtn');
  if (btn) { btn.textContent = 'Buscando…'; btn.disabled = true; }

  const materials = [
    ...latestResult.materials,
    ...consolidateMaterials(latestResult)
  ];
  // unique by material name
  const unique = [...new Map(materials.map(m => [m.material, m])).values()];

  const cache = getMLCache();
  let found = 0;

  for (let i = 0; i < unique.length; i++) {
    const mat = unique[i];
    if (cache[mat.material]) { found++; continue; }
    if (btn) btn.textContent = `Buscando ${i + 1}/${unique.length}…`;
    const result = await fetchMLItem(mat.material);
    if (result) {
      cache[mat.material] = result;
      found++;
    }
    // Save prices to the prices store too
    if (result && result.price) {
      savePrice(mat.material, result.price);
    }
    await new Promise(r => setTimeout(r, 350)); // rate limit
  }

  saveMLCache(cache);
  if (btn) { btn.textContent = 'Cotizar en ML'; btn.disabled = false; }
  renderProject(); // re-render with prices + links
  showToast(`Precios actualizados: ${found} materiales`);
}

function renderMaterials(materials) {
  const prices = getPrices();
  const mlCache = getMLCache();
  tableBody.innerHTML = materials.map(item => {
    const price = prices[item.material] || '';
    const qty = parseFloat(item.quantity) || 0;
    const total = price && qty ? formatCurrency(qty * parseFloat(price)) : '—';
    const cached = mlCache[item.material];
    const mlUrl = cached
      ? cached.link
      : `https://listado.mercadolibre.com.ar/${encodeURIComponent(item.material)}`;
    const mlTitle = cached ? escapeHtml(cached.title.slice(0, 40)) : 'Buscar';
    const priceLabel = cached && !prices[item.material] ? `$ ${cached.price.toLocaleString('es-AR')}` : escapeHtml(String(price));
    return `<tr>
      <td>${item.scope}</td>
      <td>${item.category}</td>
      <td>${item.material}</td>
      <td>${item.unit}</td>
      <td>${item.quantity}</td>
      <td>${item.profileCount === null ? '-' : `${item.profileCount} barras`}</td>
      <td><input class="price-input" type="number" min="0" step="100" placeholder="$ 0" value="${priceLabel}" data-material="${escapeHtml(item.material)}" /></td>
      <td class="price-total">${total}</td>
      <td><a href="${mlUrl}" target="_blank" rel="noopener noreferrer" class="ml-link" title="${mlTitle}">ML</a></td>
    </tr>`;
  }).join('');
}

function renderConsolidatedMaterials(materials) {
  const prices = getPrices();
  const mlCache = getMLCache();
  consolidatedTableBody.innerHTML = materials.map(item => {
    const price = prices[item.material] || '';
    const qty = parseFloat(item.quantity) || 0;
    const total = price && qty ? formatCurrency(qty * parseFloat(price)) : '—';
    const cached = mlCache[item.material];
    const mlUrl = cached
      ? cached.link
      : `https://listado.mercadolibre.com.ar/${encodeURIComponent(item.material)}`;
    const mlTitle = cached ? escapeHtml(cached.title.slice(0, 40)) : 'Buscar';
    const priceLabel = cached && !prices[item.material] ? `$ ${cached.price.toLocaleString('es-AR')}` : escapeHtml(String(price));
    return `<tr>
      <td>${item.scope}</td>
      <td>${item.category}</td>
      <td>${item.material}</td>
      <td>${item.unit}</td>
      <td>${item.quantity}</td>
      <td>${item.profileCount === null ? '-' : `${item.profileCount} barras`}</td>
      <td><input class="price-input" type="number" min="0" step="100" placeholder="$ 0" value="${priceLabel}" data-material="${escapeHtml(item.material)}" /></td>
      <td class="price-total">${total}</td>
      <td><a href="${mlUrl}" target="_blank" rel="noopener noreferrer" class="ml-link" title="${mlTitle}">ML</a></td>
    </tr>`;
  }).join('');
}

function refreshPriceTotals() {
  const prices = getPrices();
  document.querySelectorAll('tr:has(.price-input)').forEach(row => {
    const input = row.querySelector('.price-input');
    const totalCell = row.querySelector('.price-total');
    if (!input || !totalCell) return;
    const mat = input.dataset.material;
    const price = prices[mat] || 0;
    // get qty from the 5th td (index 4)
    const cells = row.querySelectorAll('td');
    const qty = parseFloat(cells[4]?.textContent) || 0;
    totalCell.textContent = price && qty ? formatCurrency(qty * price) : '—';
  });
}

function formatCurrency(value) {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0
  }).format(value);
}

function formatDateTime() {
  return new Intl.DateTimeFormat("es-AR", {
    dateStyle: "short",
    timeStyle: "short"
  }).format(new Date());
}

function buildSummaryCsv(result) {
  const rows = [
    ["Campo", "Valor"],
    ["Proyecto", result.input.projectName],
    ["Cantidad de módulos", String(result.input.quantity)],
    ["Dimensiones", `${result.input.length} x ${result.input.width} x ${result.input.height} m`],
    ["Superficie total", `${result.totals.area} m²`],
    ["Mano de obra por m²", formatCurrency(result.costs.laborRate)],
    ["Mano de obra por módulo", formatCurrency(result.costs.laborCostPerModule)],
    ["Mano de obra total", formatCurrency(result.costs.laborCostTotal)],
    ["Estado comercial", result.commercial.materialsPricingLabel],
    ["Validez", `${result.commercial.quoteValidityDays} días`]
  ];

  return rows
    .map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(","))
    .join("\n");
}

function buildReportHtml(result) {
  const consolidated = consolidateMaterials(result);
  const summaryCards = buildSummaryCards(result);
  const summaryHtml = summaryCards
    .map(
      (card) => `
        <div class="summary-item">
          <strong>${escapeHtml(card.value)}</strong>
          <span>${escapeHtml(card.label)}</span>
          <small>${escapeHtml(card.note)}</small>
        </div>
      `
    )
    .join("");

  const consolidatedRows = consolidated
    .map(
      (item) => `
        <tr>
          <td>${escapeHtml(item.scope)}</td>
          <td>${escapeHtml(item.category)}</td>
          <td>${escapeHtml(item.material)}</td>
          <td>${escapeHtml(item.unit)}</td>
          <td>${escapeHtml(item.quantity)}</td>
          <td>${item.profileCount === null ? "-" : `${item.profileCount} barras`}</td>
          <td>${escapeHtml(item.detail)}</td>
        </tr>
      `
    )
    .join("");

  const detailRows = result.materials
    .map(
      (item) => `
        <tr>
          <td>${escapeHtml(item.scope)}</td>
          <td>${escapeHtml(item.category)}</td>
          <td>${escapeHtml(item.material)}</td>
          <td>${escapeHtml(item.unit)}</td>
          <td>${escapeHtml(item.quantity)}</td>
          <td>${item.profileCount === null ? "-" : `${item.profileCount} barras`}</td>
          <td>${escapeHtml(item.detail)}</td>
        </tr>
      `
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>${escapeHtml(result.input.projectName)} - Informe</title>
  <style>
    @page { size: A4 portrait; margin: 10mm; }
    body { font-family: Arial, sans-serif; color: #222; margin: 0; }
    .page { padding: 12px; }
    h1, h2, h3 { margin: 0 0 8px; }
    p { margin: 6px 0; line-height: 1.4; }
    .header { display: flex; justify-content: space-between; gap: 16px; margin-bottom: 16px; }
    .summary { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin: 16px 0; }
    .summary-item { border: 1px solid #ccc; border-radius: 8px; padding: 10px; }
    .summary-item strong, .summary-item span, .summary-item small { display: block; }
    table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 11px; }
    th, td { border: 1px solid #ccc; padding: 6px; text-align: left; vertical-align: top; }
    th { background: #f3f3f3; }
    .note { border: 1px solid #ccc; padding: 10px; border-radius: 8px; margin: 14px 0; }
    .costs { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin: 14px 0; }
    .cost { border: 1px solid #ccc; border-radius: 8px; padding: 10px; }
    .technical-sheet { margin: 16px 0; border: 1px solid #ccc; border-radius: 8px; overflow: hidden; }
    .technical-sheet svg { display: block; width: 100%; height: auto; }
    .meta { color: #666; font-size: 12px; }
  </style>
</head>
<body>
  <div class="page">
    <div class="header">
      <div>
        <h1>${escapeHtml(result.input.projectName)}</h1>
        <p>${result.input.quantity} módulo(s) iguales | ${result.input.length} x ${result.input.width} x ${result.input.height} m</p>
        <p class="meta">Generado: ${escapeHtml(formatDateTime())}</p>
      </div>
      <div>
        <p><strong>MO por m²:</strong> ${escapeHtml(formatCurrency(result.costs.laborRate))}</p>
        <p><strong>Validez:</strong> ${result.commercial.quoteValidityDays} días</p>
      </div>
    </div>

    <div class="costs">
      <div class="cost"><strong>${escapeHtml(formatCurrency(result.costs.laborRate))}</strong><p>Mano de obra por m²</p></div>
      <div class="cost"><strong>${escapeHtml(formatCurrency(result.costs.laborCostPerModule))}</strong><p>Mano de obra por módulo</p></div>
      <div class="cost"><strong>${escapeHtml(formatCurrency(result.costs.laborCostTotal))}</strong><p>Mano de obra total</p></div>
    </div>

    <div class="note">
      <p><strong>Condición comercial:</strong> ${escapeHtml(result.commercial.materialsPricingLabel)}</p>
      <p>${escapeHtml(result.commercial.notes)}</p>
    </div>

    <div class="summary">${summaryHtml}</div>

    <h2>Compra consolidada por perfil</h2>
    <table>
      <thead>
        <tr><th>Tipo</th><th>Rubro base</th><th>Material</th><th>Unidad</th><th>Total</th><th>Perfiles</th><th>Detalle</th></tr>
      </thead>
      <tbody>${consolidatedRows}</tbody>
    </table>

    <h2 style="margin-top:16px;">Lista detallada de materiales</h2>
    <table>
      <thead>
        <tr><th>Tipo</th><th>Rubro</th><th>Material</th><th>Unidad</th><th>Cantidad</th><th>Perfiles</th><th>Detalle</th></tr>
      </thead>
      <tbody>${detailRows}</tbody>
    </table>
  </div>
</body>
</html>`;
}

function openPrintableReport(result) {
  const reportHtml = buildReportHtml(result);
  const reportWindow = window.open("", "_blank", "noopener,noreferrer");
  if (!reportWindow) {
    downloadFile(
      `${result.input.projectName.toLowerCase().replace(/\s+/g, "-")}-informe.html`,
      reportHtml,
      "text/html;charset=utf-8"
    );
    return;
  }

  reportWindow.document.open();
  reportWindow.document.write(reportHtml);
  reportWindow.document.close();
  reportWindow.focus();
  reportWindow.addEventListener("load", () => {
    reportWindow.print();
  });
}

function renderTechnicalSketch(result) {
  const { input } = result;
  const W = 1180, H = 860;
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "Boceto del módulo");
  technicalSketch.innerHTML = "";
  technicalSketch.appendChild(svg);

  if (!window.rough) return;
  const rc = rough.svg(svg);

  const addNode = (node) => svg.appendChild(node);
  const mkText = (x, y, txt, opts = {}) => {
    const t = document.createElementNS(ns, "text");
    t.setAttribute("x", x); t.setAttribute("y", y);
    t.setAttribute("text-anchor", opts.anchor || "middle");
    t.setAttribute("font-size", opts.size || 15);
    t.setAttribute("font-family", opts.font || "Caveat, cursive");
    t.setAttribute("fill", opts.fill || "#2a3f35");
    if (opts.weight) t.setAttribute("font-weight", opts.weight);
    if (opts.rotate) t.setAttribute("transform", opts.rotate);
    t.textContent = txt;
    addNode(t);
    return t;
  };

  // Paper background with noise texture
  const defs = document.createElementNS(ns, "defs");
  defs.innerHTML = `
    <filter id="sk-noise"><feTurbulence type="fractalNoise" baseFrequency="0.65" numOctaves="3" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/><feBlend in="SourceGraphic" mode="multiply"/></filter>
  `;
  addNode(defs);
  const bg = document.createElementNS(ns, "rect");
  bg.setAttribute("width", W); bg.setAttribute("height", H); bg.setAttribute("fill", "#faf8f2");
  addNode(bg);
  const noise = document.createElementNS(ns, "rect");
  noise.setAttribute("width", W); noise.setAttribute("height", H);
  noise.setAttribute("fill", "rgba(130,105,80,0.07)"); noise.setAttribute("filter", "url(#sk-noise)");
  addNode(noise);

  // Title
  mkText(W/2, 46, "Boceto técnico del módulo", { size: 26, weight: "700", fill: "#1a3028" });
  mkText(W/2, 72, `${input.projectName}  ·  ${input.quantity} módulo(s)  ·  ${input.length} × ${input.width} × ${input.height} m`, { size: 15, fill: "#5d6c64" });

  // Rough style options
  const rWall   = { roughness: 1.4, stroke: "#1f3a30", strokeWidth: 2.2, fill: "#fffef9", fillStyle: "solid", seed: 42 };
  const rRoof   = { roughness: 2.0, stroke: "#1f3a30", strokeWidth: 2, fill: "#e8dfd2", fillStyle: "hachure", hachureAngle: 40, hachureGap: 7, fillWeight: 0.7, seed: 13 };
  const rWin    = { roughness: 0.7, stroke: "#1a5878", strokeWidth: 1.5, fill: "#cce5f0", fillStyle: "solid", seed: 7 };
  const rDoor   = { roughness: 0.9, stroke: "#5a3010", strokeWidth: 1.5, fill: "#ddd0bc", fillStyle: "solid", seed: 5 };
  const rDim    = { roughness: 0.2, stroke: "#7a8c82", strokeWidth: 0.9, seed: 1 };
  const rPlanO  = { roughness: 1.6, stroke: "#1f3a30", strokeWidth: 2.8, fill: "#f5f3ec", fillStyle: "solid", seed: 8 };
  const rPlanI  = { roughness: 0.7, stroke: "#c67040", strokeWidth: 1.2, fill: "none", strokeLineDash: [6, 5], seed: 3 };
  const rGround = { roughness: 3.0, stroke: "#8a7060", strokeWidth: 1.5, seed: 99 };
  const rIsoF   = { roughness: 1.2, stroke: "#1f3a30", strokeWidth: 2, fill: "#f0e8d8", fillStyle: "solid", seed: 20 };
  const rIsoS   = { roughness: 1.2, stroke: "#1f3a30", strokeWidth: 2, fill: "#d8cfc0", fillStyle: "hachure", hachureAngle: -40, hachureGap: 9, fillWeight: 0.6, seed: 21 };
  const rIsoT   = { roughness: 1.4, stroke: "#1f3a30", strokeWidth: 2, fill: "#e0d5c5", fillStyle: "solid", seed: 22 };

  const dimLine = (x1, y1, x2, y2) => {
    addNode(rc.line(x1, y1, x2, y2, rDim));
    const len = Math.sqrt((x2-x1)**2+(y2-y1)**2);
    const nx = -(y2-y1)/len * 6, ny = (x2-x1)/len * 6;
    addNode(rc.line(x1, y1, x1+nx, y1+ny, rDim));
    addNode(rc.line(x2, y2, x2+nx, y2+ny, rDim));
  };
  const dimLabel = (x, y, txt, angle) =>
    mkText(x, y, txt, { size: 13, fill: "#5a6e63", rotate: angle ? `rotate(${angle} ${x} ${y})` : undefined });

  // ── PLANTA ──
  const ps = Math.min(300 / input.length, 160 / input.width);
  const pw = input.length * ps, pd = input.width * ps;
  const px = 68, py = 122;
  mkText(px + pw/2, py - 20, "PLANTA", { size: 19, weight: "bold" });
  addNode(rc.rectangle(px, py, pw, pd, rPlanO));
  addNode(rc.rectangle(px+14, py+14, pw-28, pd-28, rPlanI));
  const ww = Math.max(20, input.windowWidth * ps);
  [0.25, 0.75].forEach(f => {
    addNode(rc.rectangle(px + pw*f - ww/2, py - 5, ww, 10, rWin));
    addNode(rc.rectangle(px + pw*f - ww/2, py + pd - 5, ww, 10, rWin));
  });
  const dw = Math.max(18, input.doorWidth * ps);
  addNode(rc.rectangle(px + pw - 5, py + pd*0.4 - dw/2, 10, dw, rDoor));
  // north arrow
  const nax = px + pw + 36, nay = py + pd/2;
  addNode(rc.line(nax, nay+16, nax, nay-16, { roughness: 0.4, stroke: "#2a3f35", strokeWidth: 1.5 }));
  mkText(nax, nay-22, "N", { size: 13, weight: "bold", fill: "#2a3f35" });
  dimLine(px, py+pd+28, px+pw, py+pd+28);
  dimLabel(px+pw/2, py+pd+46, `${input.length} m`);
  dimLine(px-28, py, px-28, py+pd);
  dimLabel(px-44, py+pd/2, `${input.width} m`, -90);
  mkText(px+pw/2, py+pd/2+6, `${input.windowCount}V · ${input.doorCount}P`, { size: 14, fill: "#999" });

  // ── FRENTE ──
  const es = Math.min(240 / input.width, 150 / input.height);
  const ew = input.width * es, eh = input.height * es;
  const ex = 580, ey = 122 + eh;
  mkText(ex + ew/2, ey-eh-20, "FRENTE", { size: 19, weight: "bold" });
  addNode(rc.line(ex-30, ey, ex+ew+30, ey, rGround));
  addNode(rc.rectangle(ex, ey-eh, ew, eh, rWall));
  // Flat container roof with lip/overhang
  const rov = Math.min(input.roofOverhang * es, 14);
  addNode(rc.rectangle(ex - rov, ey - eh - 10, ew + rov * 2, 10, rRoof));
  // Slight drainage slope marker
  addNode(rc.line(ex - rov + 4, ey - eh - 6, ex + ew + rov - 4, ey - eh - 3, { roughness: 0.3, stroke: "#9aae9a", strokeWidth: 0.7, strokeLineDash: [4, 3] }));
  const wW = Math.max(22, input.windowWidth*es), wH = Math.max(28, input.windowHeight*es);
  const wY = ey - eh*0.62;
  [0.14, 0.65].forEach(f => {
    addNode(rc.rectangle(ex+ew*f, wY, wW, wH, rWin));
    addNode(rc.line(ex+ew*f+wW/2, wY, ex+ew*f+wW/2, wY+wH, { roughness: 0.4, stroke: "#3a6080", strokeWidth: 0.8 }));
    addNode(rc.line(ex+ew*f, wY+wH/2, ex+ew*f+wW, wY+wH/2, { roughness: 0.4, stroke: "#3a6080", strokeWidth: 0.8 }));
  });
  const dW = Math.max(26, input.doorWidth*es), dH = Math.max(60, input.doorHeight*es);
  addNode(rc.rectangle(ex+ew*0.42, ey-dH, dW, dH, rDoor));
  dimLine(ex-28, ey, ex-28, ey-eh);
  dimLabel(ex-42, ey-eh/2, `${input.height} m`, -90);
  dimLine(ex, ey+28, ex+ew, ey+28);
  dimLabel(ex+ew/2, ey+46, `${input.width} m`);

  // ── LATERAL ──
  const ss = Math.min(300 / input.length, 140 / input.height);
  const sw = input.length * ss, sh = input.height * ss;
  const ssx = 68, ssy = 700;
  mkText(ssx+sw/2, ssy-sh-20, "LATERAL", { size: 19, weight: "bold" });
  addNode(rc.line(ssx-30, ssy, ssx+sw+30, ssy, rGround));
  addNode(rc.rectangle(ssx, ssy-sh, sw, sh, rWall));
  // Flat container roof
  const srov = Math.min(input.roofOverhang * ss, 14);
  addNode(rc.rectangle(ssx - srov, ssy - sh - 10, sw + srov * 2, 10, rRoof));
  const sWW = Math.max(28, input.windowWidth*ss*0.8), sWH = Math.max(24, input.windowHeight*ss);
  [0.2, 0.6].forEach(f => addNode(rc.rectangle(ssx+sw*f, ssy-sh*0.60, sWW, sWH, rWin)));
  dimLine(ssx, ssy+28, ssx+sw, ssy+28);
  dimLabel(ssx+sw/2, ssy+46, `${input.length} m`);
  dimLine(ssx-28, ssy, ssx-28, ssy-sh);
  dimLabel(ssx-42, ssy-sh/2, `${input.height} m`, -90);

  // ── ISOMÉTRICA ──
  const is = 30;
  const iL = input.length*is, iW = input.width*is, iH = input.height*is;
  const iDx = iL*0.85, iDy = iL*0.4, iWx = iW*0.85, iWy = iW*0.4;
  const iox = 790, ioy = 720;
  mkText(iox+(iDx+iWx)/2-20, ioy-iH-44, "ISOMÉTRICA", { size: 19, weight: "bold" });
  // faces
  addNode(rc.polygon([[iox,ioy],[iox,ioy-iH],[iox+iWx,ioy-iH+iWy],[iox+iWx,ioy+iWy]], rIsoF));
  addNode(rc.polygon([[iox+iWx,ioy+iWy],[iox+iWx,ioy-iH+iWy],[iox+iWx+iDx,ioy-iH+iWy-iDy],[iox+iWx+iDx,ioy+iWy-iDy]], rIsoS));
  addNode(rc.polygon([[iox,ioy-iH],[iox+iDx,ioy-iH-iDy],[iox+iDx+iWx,ioy-iH-iDy+iWy],[iox+iWx,ioy-iH+iWy]], rIsoT));
  // Flat container roof — top face already drawn as rIsoT above
  // Add roof lip/cap overhang on front edge
  const iRov = Math.min(input.roofOverhang * is * 0.4, 8);
  addNode(rc.polygon([
    [iox - iRov, ioy - iH],
    [iox - iRov + iDx, ioy - iH - iDy],
    [iox - iRov + iDx + iWx + iRov*2, ioy - iH - iDy + iWy],
    [iox + iWx + iRov, ioy - iH + iWy]
  ], { ...rRoof, fill: "#ddd5c4", hachureAngle: 60, seed: 32 }));
  // front window
  const iwinW = Math.max(16, input.windowWidth*is*0.5), iwinH = Math.max(22, input.windowHeight*is*0.6);
  addNode(rc.rectangle(iox+iWx*0.3, ioy-iH*0.62+iWy*0.3, iwinW, iwinH, { ...rWin, seed:40 }));
  // front door
  addNode(rc.rectangle(iox+iWx*0.6, ioy-input.doorHeight*is*0.55+iWy*0.6, Math.max(20,input.doorWidth*is*0.5), Math.max(50,input.doorHeight*is*0.55), { ...rDoor, seed:45 }));
  // ground shadow
  addNode(rc.ellipse(iox+iDx/2+iWx/2, ioy+iWy/2+10, iDx+iWx, 24, { roughness: 2, stroke:"none", fill:"rgba(100,80,60,0.1)", fillStyle:"solid", seed:50 }));
  // spec notes on right
  const noteX = iox + iDx + iWx + 18, noteY = ioy - iH + 10;
  const specs = [
    `Bastidor: ${result.system.mainFrameSection}`,
    `Vigueta: ${result.system.floorJoist.split(" ").slice(0,3).join(" ")}`,
    `Ext: ${result.cladding.wallExteriorCladding.label}`,
    `Cubierta: ${result.cladding.roofCladding.label.split(" ").slice(0,3).join(" ")}`
  ];
  specs.forEach((s, i) => {
    addNode(rc.line(noteX-6, noteY+i*22, noteX, noteY+i*22, { roughness:0.3, stroke:"#9aae9a", strokeWidth:0.8 }));
    mkText(noteX+4, noteY+i*22+4, s, { size:12, fill:"#4a5e54", anchor:"start" });
  });
}

function renderCostSummary(result) {
  costSummary.innerHTML = `
    <article class="cost-card">
      <span>Mano de obra por m²</span>
      <strong>${formatCurrency(result.costs.laborRate)}</strong>
      <small>Valor editable en el formulario</small>
    </article>
    <article class="cost-card">
      <span>Mano de obra por módulo</span>
      <strong>${formatCurrency(result.costs.laborCostPerModule)}</strong>
      <small>${result.derived.moduleArea} m² por módulo</small>
    </article>
    <article class="cost-card">
      <span>Mano de obra total</span>
      <strong>${formatCurrency(result.costs.laborCostTotal)}</strong>
      <small>${result.input.quantity} módulo(s) iguales</small>
    </article>
  `;
}

function renderCommercialBox(result) {
  commercialBox.innerHTML = `
    <h3>Condiciones comerciales</h3>
    <p><strong>Subtotal mano de obra:</strong> ${formatCurrency(result.costs.laborCostTotal)}</p>
    <p><strong>Materiales:</strong> ${result.commercial.materialsPricingLabel}</p>
    <p><strong>Validez del presupuesto:</strong> ${result.commercial.quoteValidityDays} días</p>
    <p><strong>Observaciones técnicas:</strong> ${result.commercial.notes}</p>
  `;
}

const HISTORY_KEY = 'modularlive_history';
const MAX_HISTORY = 5;

function getHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); }
  catch { return []; }
}

function saveToHistory() {
  if (!latestResult) return;
  const history = getHistory();
  const fd = formDataToObject(form);
  const entry = {
    id: Date.now(),
    savedAt: new Date().toISOString(),
    formData: fd,
    meta: {
      name: latestResult.input.projectName,
      area: latestResult.totals.area,
      items: latestResult.totals.items,
      modules: latestResult.input.quantity,
      system: latestResult.system.label
    }
  };
  const filtered = history.filter(h => h.meta.name !== entry.meta.name);
  filtered.unshift(entry);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(filtered.slice(0, MAX_HISTORY)));
  renderHistory();
  showToast(`"${entry.meta.name}" guardado en el historial`);
}

function deleteFromHistory(id) {
  const history = getHistory().filter(h => h.id !== id);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  renderHistory();
}

function renderHistory() {
  const historyList = document.querySelector('#historyList');
  const historyCount = document.querySelector('#historyCount');
  if (!historyList || !historyCount) return;
  const history = getHistory();
  historyCount.textContent = history.length === 0 ? 'sin proyectos' : `${history.length} guardado${history.length !== 1 ? 's' : ''}`;
  if (history.length === 0) {
    historyList.innerHTML = '<p class="history-empty">No hay proyectos guardados todavía.</p>';
    return;
  }
  historyList.innerHTML = history.map(h => {
    const date = new Date(h.savedAt).toLocaleDateString('es-AR', { day:'2-digit', month:'2-digit', year:'2-digit', hour:'2-digit', minute:'2-digit' });
    return `<div class="history-card" data-id="${h.id}">
      <div class="history-card__info">
        <strong class="history-card__name">${escapeHtml(h.meta.name)}</strong>
        <span class="history-card__meta">${h.meta.area} m² · ${h.meta.modules} mód. · ${escapeHtml(h.meta.system)}</span>
        <span class="history-card__date">${date}</span>
      </div>
      <div class="history-card__actions">
        <button type="button" class="btn-load-history btn-ghost btn-sm" data-id="${h.id}">Cargar</button>
        <button type="button" class="btn-del-history btn-ghost btn-sm" data-id="${h.id}" title="Eliminar">✕</button>
      </div>
    </div>`;
  }).join('');
}

function buildShareUrl() {
  const fd = formDataToObject(form);
  const params = new URLSearchParams(fd);
  return `${location.origin}${location.pathname}#${params.toString()}`;
}

function loadFromShareUrl() {
  const hash = location.hash.slice(1);
  if (!hash) return false;
  try {
    const params = Object.fromEntries(new URLSearchParams(hash));
    if (params.projectName || params.width) {
      fillForm(params);
      return true;
    }
  } catch {}
  return false;
}

function renderProject() {
  syncInteriorOptions();
  renderScheduled = false;
  latestResult = calculateProject(formDataToObject(form));
  const cards = buildSummaryCards(latestResult);
  renderSummaryCards(cards);
  renderTechnicalSketch(latestResult);
  renderCostSummary(latestResult);
  renderCommercialBox(latestResult);
  renderConsolidatedMaterials(consolidateMaterials(latestResult));
  renderMaterials(latestResult.materials);

  const { input, totals, derived } = latestResult;
  summaryText.textContent =
    `${input.projectName}: ${totals.area} m² totales en ${input.quantity} módulo(s), ` +
    `bastidor principal de ${latestResult.system.mainFrameSection}, ` +
    `${derived.floorJoistsPerModule} viguetas de piso de ${derived.floorJoistSpan} m de luz, ` +
    `${derived.wallStudsPerModule} montantes por módulo y ${derived.roofRaftersPerModule} cabios de ${derived.roofRafterSpan} m.`;
  systemNote.textContent =
    `Sistema definido: ${latestResult.system.label}. ` +
    `Material base: ${latestResult.system.frameMaterial}. ` +
    `Bastidor principal del cubo: ${latestResult.system.mainFrameSection}. ` +
    `Exterior: ${latestResult.cladding.wallExteriorCladding.label}. ` +
    `Interior: ${latestResult.cladding.wallInteriorLining.label}. ` +
    `Cubierta: ${latestResult.cladding.roofCladding.label}. ` +
    `${latestResult.system.notes} ` +
    `Modo activo: ${input.calculationMode === "mixed" ? "presupuesto + despiece" : input.calculationMode === "structural" ? "solo despiece estructural" : "solo estimación comercial"}. ` +
    `Refuerzo de aberturas estimado: ${derived.openingReinforcementLength} ml por módulo antes de merma. ` +
    `Cantidad de perfiles calculada con barras comerciales de ${input.stockLength} m. ` +
    `${latestResult.commercial.materialsPricingLabel}.`;

  printProjectTitle.textContent = input.projectName;
  printMeta.innerHTML = `
    <div>${input.quantity} módulo(s) iguales</div>
    <div>${input.length} x ${input.width} x ${input.height} m</div>
    <div>MO: ${formatCurrency(latestResult.costs.laborRate)} / m²</div>
  `;
  approvalNote.innerHTML = `
    <strong>Condición económica del informe:</strong>
    La mano de obra se cotiza a ${formatCurrency(latestResult.costs.laborRate)} por m² y totaliza
    ${formatCurrency(latestResult.costs.laborCostTotal)} para ${input.quantity} módulo(s) iguales.
    Los materiales se listan en cantidades totales para la cantidad de módulos solicitada, pero el
    precio de los materiales queda sujeto a aprobación final del proyecto, disponibilidad y validación técnica.
  `;

  heroArea.textContent = `${totals.area} m²`;
  heroItems.textContent = String(totals.items);
  heroPanels.textContent = `${Math.ceil(totals.claddingUnits)} u`;
  animateMetric(heroArea);
  animateMetric(heroItems);
  animateMetric(heroPanels);

  showToast(`${totals.area} m² · ${totals.items} ítems calculados`);
}

function scheduleRender() {
  if (renderScheduled) {
    return;
  }

  renderScheduled = true;
  requestAnimationFrame(() => {
    renderProject();
  });
}

function applyPreset() {
  const spaceType = form.elements.namedItem("spaceType").value;
  const preset = getPreset(spaceType);
  const preservedValues = {
    projectName: form.elements.namedItem("projectName").value,
    quantity: form.elements.namedItem("quantity").value,
    laborRate: form.elements.namedItem("laborRate").value
  };
  fillForm(preset);
  fillForm(preservedValues);
  renderProject();
}

form.elements.namedItem("spaceType").addEventListener("change", applyPreset);

form.elements.namedItem("structureType").addEventListener("change", () => {
  const system = getStructureSystem(form.elements.namedItem("structureType").value);
  const mainFrameField = form.elements.namedItem("mainFrameSection");
  if (system.mainFrameOptions.length > 0) {
    mainFrameField.innerHTML = system.mainFrameOptions
      .map(
        (option) =>
          `<option value="${option}">Tubo ${option} mm</option>`
      )
      .join("");
    mainFrameField.value = system.defaultMainFrameSection;
  } else {
    mainFrameField.innerHTML = `<option value="${system.defaultMainFrameSection}">${system.defaultMainFrameSection}</option>`;
    mainFrameField.value = system.defaultMainFrameSection;
  }
  systemNote.textContent =
    `Sistema definido: ${system.label}. Material base: ${system.frameMaterial}. ${system.notes}`;
  renderProject();
});

form.elements.namedItem("calculationMode").addEventListener("change", scheduleRender);
form.elements.namedItem("mainFrameSection").addEventListener("change", scheduleRender);
form.elements.namedItem("interiorUseType").addEventListener("change", scheduleRender);
form.elements.namedItem("wallExteriorCladding").addEventListener("change", scheduleRender);
form.elements.namedItem("wallInteriorLining").addEventListener("change", scheduleRender);
form.elements.namedItem("roofCladding").addEventListener("change", scheduleRender);

form.addEventListener("input", (event) => {
  if (
    event.target instanceof HTMLInputElement ||
    event.target instanceof HTMLSelectElement
  ) {
    scheduleRender();
  }
});

form.addEventListener("change", (event) => {
  if (
    event.target instanceof HTMLInputElement ||
    event.target instanceof HTMLSelectElement
  ) {
    scheduleRender();
  }
});

form.addEventListener("submit", (event) => {
  event.preventDefault();
  renderProject();
});

presetButton.addEventListener("click", applyPreset);

document.querySelector('#saveHistoryBtn').addEventListener('click', saveToHistory);
document.querySelector('#historyList').addEventListener('click', (e) => {
  const loadBtn = e.target.closest('.btn-load-history');
  const delBtn = e.target.closest('.btn-del-history');
  if (loadBtn) {
    const id = Number(loadBtn.dataset.id);
    const entry = getHistory().find(h => h.id === id);
    if (entry) { fillForm(entry.formData); renderProject(); }
  }
  if (delBtn) {
    deleteFromHistory(Number(delBtn.dataset.id));
  }
});

document.querySelector('.results-panel').addEventListener('change', (e) => {
  if (e.target.classList.contains('price-input')) {
    const mat = e.target.dataset.material;
    const val = parseFloat(e.target.value);
    savePrice(mat, isNaN(val) ? 0 : val);
    // re-render just the total cells
    refreshPriceTotals();
  }
});

document.querySelector('#mlFetchBtn')?.addEventListener('click', fetchAllMLPrices);

document.querySelector('#copyLinkBtn').addEventListener('click', () => {
  const url = buildShareUrl();
  navigator.clipboard.writeText(url).then(() => showToast('Enlace copiado al portapapeles')).catch(() => {
    prompt('Copiá este enlace:', url);
  });
});

document.querySelector('#whatsappBtn').addEventListener('click', () => {
  if (!latestResult) return;
  const r = latestResult;
  const text = `*${r.input.projectName}*\n${r.input.quantity} módulo(s) de ${r.input.length}×${r.input.width}×${r.input.height} m\nSuperficie: ${r.totals.area} m²  ·  ${r.totals.items} ítems\nMO: ${formatCurrency(r.costs.laborCostTotal)}\n\n_Calculado con ModularLive_\n${buildShareUrl()}`;
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
});

csvButton.addEventListener("click", () => {
  if (!latestResult) {
    renderProject();
  }
  const safeName = latestResult.input.projectName.toLowerCase().replace(/\s+/g, "-");
  const csvSections = [
    "RESUMEN COMERCIAL",
    buildSummaryCsv(latestResult),
    "",
    "COMPRA CONSOLIDADA POR PERFIL",
    consolidatedMaterialsToCsv(latestResult),
    "",
    "LISTA DETALLADA DE MATERIALES",
    materialsToCsv(latestResult)
  ].join("\n");
  downloadFile(`${safeName}-materiales.csv`, `\uFEFF${csvSections}`, "text/csv;charset=utf-8");
});

reportButton.addEventListener("click", () => {
  if (!latestResult) {
    renderProject();
  }
  const safeName = latestResult.input.projectName.toLowerCase().replace(/\s+/g, "-");
  downloadFile(
    `${safeName}-informe.html`,
    buildReportHtml(latestResult),
    "text/html;charset=utf-8"
  );
});

jsonButton.addEventListener("click", () => {
  if (!latestResult) {
    renderProject();
  }
  const filename = `${latestResult.input.projectName.toLowerCase().replace(/\s+/g, "-")}.json`;
  downloadFile(
    filename,
    JSON.stringify(latestResult, null, 2),
    "application/json;charset=utf-8"
  );
});

printButton.addEventListener("click", () => {
  if (!latestResult) {
    renderProject();
  }
  openPrintableReport(latestResult);
});

window.addEventListener("load", async () => {
  try {
    if ("serviceWorker" in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((registration) => registration.unregister()));
    }

    if ("caches" in window) {
      const cacheKeys = await caches.keys();
      await Promise.all(cacheKeys.map((key) => caches.delete(key)));
    }
  } catch (error) {
    console.error("No se pudo limpiar el cache local de la app", error);
  }
});

renderHistory();

if (!loadFromShareUrl()) {
  applyPreset();
} else {
  renderProject();
}
