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

function renderMaterials(materials) {
  tableBody.innerHTML = materials
    .map(
      (item) => `
        <tr>
          <td>${item.scope}</td>
          <td>${item.category}</td>
          <td>${item.material}</td>
          <td>${item.unit}</td>
          <td>${item.quantity}</td>
          <td>${item.profileCount === null ? "-" : `${item.profileCount} barras`}</td>
          <td>${item.detail}</td>
        </tr>
      `
    )
    .join("");
}

function renderConsolidatedMaterials(materials) {
  consolidatedTableBody.innerHTML = materials
    .map(
      (item) => `
        <tr>
          <td>${item.scope}</td>
          <td>${item.category}</td>
          <td>${item.material}</td>
          <td>${item.unit}</td>
          <td>${item.quantity}</td>
          <td>${item.profileCount === null ? "-" : `${item.profileCount} barras`}</td>
          <td>${item.detail}</td>
        </tr>
      `
    )
    .join("");
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
  const totalWidth = 1180;
  const totalHeight = 860;
  const planScale = Math.min(320 / input.length, 180 / input.width);
  const elevScale = Math.min(260 / input.width, 170 / input.height);
  const sideScale = Math.min(320 / input.length, 170 / input.height);
  const isoScale = 34;
  const planWidth = input.length * planScale;
  const planDepth = input.width * planScale;
  const frontWidth = input.width * elevScale;
  const frontHeight = input.height * elevScale;
  const sideWidth = input.length * sideScale;
  const sideHeight = input.height * sideScale;
  const roofOverhangFront = input.roofOverhang * elevScale;
  const roofOverhangSide = input.roofOverhang * sideScale;
  const planX = 70;
  const planY = 120;
  const frontX = 720;
  const frontBaseY = 310;
  const sideX = 70;
  const sideBaseY = 700;
  const isoOriginX = 780;
  const isoOriginY = 690;

  const isoLength = input.length * isoScale;
  const isoWidth = input.width * isoScale;
  const isoHeight = input.height * isoScale;
  const isoDx = isoLength * 0.88;
  const isoDy = isoLength * 0.42;
  const isoWx = isoWidth * 0.88;
  const isoWy = isoWidth * 0.42;

  const dimLine = (x1, y1, x2, y2, label, tx, ty, rotate = "") => `
    <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#1f3a30" stroke-width="1.6" marker-start="url(#arrow)" marker-end="url(#arrow)"></line>
    <text x="${tx}" y="${ty}" text-anchor="middle" font-size="16" font-family="IBM Plex Sans, sans-serif" fill="#1f3a30" ${rotate}>${label}</text>
  `;

  technicalSketch.innerHTML = `
    <svg viewBox="0 0 ${totalWidth} ${totalHeight}" role="img" aria-label="Lámina técnica del módulo">
      <defs>
        <marker id="arrow" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto">
          <path d="M0,0 L8,4 L0,8 Z" fill="#214034"></path>
        </marker>
      </defs>
      <rect x="0" y="0" width="${totalWidth}" height="${totalHeight}" fill="#fcfbf7"></rect>
      <text x="54" y="56" font-size="30" font-family="Avenir Next, Segoe UI, sans-serif" fill="#163126">Lámina técnica del módulo</text>
      <text x="54" y="84" font-size="15" font-family="IBM Plex Sans, sans-serif" fill="#5d6c64">${input.projectName} | ${input.quantity} módulo(s) iguales | ${input.length} x ${input.width} x ${input.height} m</text>

      <rect x="36" y="102" width="420" height="250" rx="18" fill="#fff" stroke="#d8d0c4"></rect>
      <text x="60" y="136" font-size="22" font-family="IBM Plex Sans, sans-serif" fill="#163126">Planta</text>
      <rect x="${planX}" y="${planY}" width="${planWidth}" height="${planDepth}" rx="6" fill="#fff" stroke="#214034" stroke-width="2"></rect>
      <rect x="${planX + 12}" y="${planY + 12}" width="${planWidth - 24}" height="${planDepth - 24}" rx="4" fill="none" stroke="#d67d44" stroke-dasharray="8 6" stroke-width="2"></rect>
      ${dimLine(planX, planY + planDepth + 36, planX + planWidth, planY + planDepth + 36, `${input.length} m`, planX + planWidth / 2, planY + planDepth + 28)}
      ${dimLine(planX - 26, planY, planX - 26, planY + planDepth, `${input.width} m`, planX - 38, planY + planDepth / 2, `transform="rotate(-90 ${planX - 38} ${planY + planDepth / 2})"`)}
      <text x="${planX + 14}" y="${planY + 28}" font-size="13" font-family="IBM Plex Sans, sans-serif" fill="#5d6c64">Aberturas: ${input.windowCount} ventanas / ${input.doorCount} puertas</text>

      <rect x="488" y="102" width="320" height="250" rx="18" fill="#fff" stroke="#d8d0c4"></rect>
      <text x="512" y="136" font-size="22" font-family="IBM Plex Sans, sans-serif" fill="#163126">Frente</text>
      <rect x="${frontX}" y="${frontBaseY - frontHeight}" width="${frontWidth}" height="${frontHeight}" rx="4" fill="#fff" stroke="#214034" stroke-width="2"></rect>
      <polygon points="${frontX - roofOverhangFront},${frontBaseY - frontHeight} ${frontX + frontWidth / 2},${frontBaseY - frontHeight - roofOverhangFront * 0.8} ${frontX + frontWidth + roofOverhangFront},${frontBaseY - frontHeight}" fill="#e7ded0" stroke="#214034" stroke-width="2"></polygon>
      <rect x="${frontX + frontWidth * 0.12}" y="${frontBaseY - frontHeight * 0.58}" width="${Math.max(24, frontWidth * 0.2)}" height="${Math.max(32, frontHeight * 0.24)}" fill="#d9eef7" stroke="#214034" stroke-width="1.5"></rect>
      <rect x="${frontX + frontWidth * 0.68}" y="${frontBaseY - frontHeight * 0.58}" width="${Math.max(24, frontWidth * 0.2)}" height="${Math.max(32, frontHeight * 0.24)}" fill="#d9eef7" stroke="#214034" stroke-width="1.5"></rect>
      <rect x="${frontX + frontWidth * 0.4}" y="${frontBaseY - frontHeight * 0.42}" width="${Math.max(30, frontWidth * 0.18)}" height="${Math.max(78, frontHeight * 0.42)}" fill="#eadfca" stroke="#214034" stroke-width="1.5"></rect>
      ${dimLine(frontX - 28, frontBaseY, frontX - 28, frontBaseY - frontHeight, `${input.height} m`, frontX - 42, frontBaseY - frontHeight / 2, `transform="rotate(-90 ${frontX - 42} ${frontBaseY - frontHeight / 2})"`)}
      ${dimLine(frontX, frontBaseY + 32, frontX + frontWidth, frontBaseY + 32, `${input.width} m`, frontX + frontWidth / 2, frontBaseY + 24)}

      <rect x="36" y="406" width="420" height="250" rx="18" fill="#fff" stroke="#d8d0c4"></rect>
      <text x="60" y="440" font-size="22" font-family="IBM Plex Sans, sans-serif" fill="#163126">Lateral</text>
      <rect x="${sideX}" y="${sideBaseY - sideHeight}" width="${sideWidth}" height="${sideHeight}" rx="4" fill="#fff" stroke="#214034" stroke-width="2"></rect>
      <polygon points="${sideX - roofOverhangSide},${sideBaseY - sideHeight} ${sideX + sideWidth * 0.5},${sideBaseY - sideHeight - roofOverhangSide * 0.7} ${sideX + sideWidth + roofOverhangSide},${sideBaseY - sideHeight}" fill="#e7ded0" stroke="#214034" stroke-width="2"></polygon>
      <rect x="${sideX + sideWidth * 0.18}" y="${sideBaseY - sideHeight * 0.54}" width="${Math.max(36, sideWidth * 0.16)}" height="${Math.max(30, sideHeight * 0.22)}" fill="#d9eef7" stroke="#214034" stroke-width="1.5"></rect>
      <rect x="${sideX + sideWidth * 0.56}" y="${sideBaseY - sideHeight * 0.54}" width="${Math.max(36, sideWidth * 0.16)}" height="${Math.max(30, sideHeight * 0.22)}" fill="#d9eef7" stroke="#214034" stroke-width="1.5"></rect>
      ${dimLine(sideX, sideBaseY + 32, sideX + sideWidth, sideBaseY + 32, `${input.length} m`, sideX + sideWidth / 2, sideBaseY + 24)}
      ${dimLine(sideX - 28, sideBaseY, sideX - 28, sideBaseY - sideHeight, `${input.height} m`, sideX - 42, sideBaseY - sideHeight / 2, `transform="rotate(-90 ${sideX - 42} ${sideBaseY - sideHeight / 2})"`)}

      <rect x="488" y="406" width="656" height="380" rx="18" fill="#fff" stroke="#d8d0c4"></rect>
      <text x="512" y="440" font-size="22" font-family="IBM Plex Sans, sans-serif" fill="#163126">Isométrica</text>
      <polygon points="${isoOriginX},${isoOriginY - isoHeight} ${isoOriginX + isoDx},${isoOriginY - isoHeight - isoDy} ${isoOriginX + isoDx + isoWx},${isoOriginY - isoHeight - isoDy + isoWy} ${isoOriginX + isoWx},${isoOriginY - isoHeight + isoWy}" fill="#e8dfd2" stroke="#214034" stroke-width="2"></polygon>
      <polygon points="${isoOriginX},${isoOriginY - isoHeight} ${isoOriginX + isoWx},${isoOriginY - isoHeight + isoWy} ${isoOriginX + isoWx},${isoOriginY + isoWy} ${isoOriginX},${isoOriginY}" fill="#c8874c" stroke="#214034" stroke-width="2"></polygon>
      <polygon points="${isoOriginX + isoWx},${isoOriginY - isoHeight + isoWy} ${isoOriginX + isoDx + isoWx},${isoOriginY - isoHeight - isoDy + isoWy} ${isoOriginX + isoDx + isoWx},${isoOriginY - isoDy + isoWy} ${isoOriginX + isoWx},${isoOriginY + isoWy}" fill="#efe3d0" stroke="#214034" stroke-width="2"></polygon>
      <rect x="${isoOriginX + isoWx * 0.48}" y="${isoOriginY - isoHeight * 0.34}" width="48" height="96" transform="skewY(26)" fill="#e5d4bd" stroke="#214034" stroke-width="2"></rect>
      <polygon points="${isoOriginX + 44},${isoOriginY - isoHeight * 0.6} ${isoOriginX + 92},${isoOriginY - isoHeight * 0.6 + 20} ${isoOriginX + 92},${isoOriginY - isoHeight * 0.38 + 20} ${isoOriginX + 44},${isoOriginY - isoHeight * 0.38}" fill="#b9dceb" stroke="#214034" stroke-width="1.5"></polygon>
      <polygon points="${isoOriginX + isoWx + 44},${isoOriginY - isoHeight * 0.62 + 16} ${isoOriginX + isoWx + 92},${isoOriginY - isoHeight * 0.62 - 8} ${isoOriginX + isoWx + 92},${isoOriginY - isoHeight * 0.38 - 8} ${isoOriginX + isoWx + 44},${isoOriginY - isoHeight * 0.38 + 16}" fill="#b9dceb" stroke="#214034" stroke-width="1.5"></polygon>
      <text x="512" y="484" font-size="14" font-family="IBM Plex Sans, sans-serif" fill="#5d6c64">Bastidor principal: ${result.system.mainFrameSection}</text>
      <text x="512" y="508" font-size="14" font-family="IBM Plex Sans, sans-serif" fill="#5d6c64">Piso / techo: ${result.system.floorJoist}</text>
      <text x="512" y="532" font-size="14" font-family="IBM Plex Sans, sans-serif" fill="#5d6c64">Muros exteriores: ${result.cladding.wallExteriorCladding.label}</text>
      <text x="512" y="556" font-size="14" font-family="IBM Plex Sans, sans-serif" fill="#5d6c64">Muros interiores: ${result.cladding.wallInteriorLining.label}</text>
      <text x="512" y="580" font-size="14" font-family="IBM Plex Sans, sans-serif" fill="#5d6c64">Cubierta: ${result.cladding.roofCladding.label}</text>
      <text x="512" y="604" font-size="14" font-family="IBM Plex Sans, sans-serif" fill="#5d6c64">Cantidad: ${input.quantity} módulo(s) idénticos</text>
    </svg>
  `;
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

applyPreset();
