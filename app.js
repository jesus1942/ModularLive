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
const jsonButton = document.querySelector("#jsonButton");
const printButton = document.querySelector("#printButton");
const heroArea = document.querySelector("#heroArea");
const heroItems = document.querySelector("#heroItems");
const heroPanels = document.querySelector("#heroPanels");
const systemNote = document.querySelector("#systemNote");
const technicalSketch = document.querySelector("#technicalSketch");
const conceptSketch = document.querySelector("#conceptSketch");
const printProjectTitle = document.querySelector("#printProjectTitle");
const printMeta = document.querySelector("#printMeta");
const costSummary = document.querySelector("#costSummary");

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

function renderTechnicalSketch(result) {
  const { input } = result;
  const scalePlan = 36;
  const scaleElev = 46;
  const planWidth = input.length * scalePlan;
  const planDepth = input.width * scalePlan;
  const elevWidth = input.width * scaleElev;
  const elevHeight = input.height * scaleElev;
  const roofOverhang = input.roofOverhang * scaleElev;
  const totalWidth = 820;
  const totalHeight = 430;
  const planX = 40;
  const planY = 90;
  const elevX = 500;
  const elevY = 270;

  technicalSketch.innerHTML = `
    <svg viewBox="0 0 ${totalWidth} ${totalHeight}" role="img" aria-label="Boceto técnico del módulo">
      <defs>
        <marker id="arrow" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto">
          <path d="M0,0 L8,4 L0,8 Z" fill="#214034"></path>
        </marker>
      </defs>
      <rect x="0" y="0" width="${totalWidth}" height="${totalHeight}" fill="#faf8f2"></rect>
      <text x="40" y="38" font-size="20" font-family="IBM Plex Sans, sans-serif" fill="#163126">Planta</text>
      <rect x="${planX}" y="${planY}" width="${planWidth}" height="${planDepth}" rx="6" fill="#fff" stroke="#214034" stroke-width="2"></rect>
      <rect x="${planX + 12}" y="${planY + 12}" width="${planWidth - 24}" height="${planDepth - 24}" rx="4" fill="none" stroke="#d67d44" stroke-dasharray="8 6" stroke-width="2"></rect>
      <line x1="${planX}" y1="${planY + planDepth + 36}" x2="${planX + planWidth}" y2="${planY + planDepth + 36}" stroke="#214034" stroke-width="1.5" marker-start="url(#arrow)" marker-end="url(#arrow)"></line>
      <text x="${planX + planWidth / 2}" y="${planY + planDepth + 28}" text-anchor="middle" font-size="16" font-family="IBM Plex Sans, sans-serif" fill="#214034">${input.length} m</text>
      <line x1="${planX - 26}" y1="${planY}" x2="${planX - 26}" y2="${planY + planDepth}" stroke="#214034" stroke-width="1.5" marker-start="url(#arrow)" marker-end="url(#arrow)"></line>
      <text x="${planX - 36}" y="${planY + planDepth / 2}" text-anchor="middle" font-size="16" font-family="IBM Plex Sans, sans-serif" fill="#214034" transform="rotate(-90 ${planX - 36} ${planY + planDepth / 2})">${input.width} m</text>
      <text x="${planX + 14}" y="${planY + 28}" font-size="13" font-family="IBM Plex Sans, sans-serif" fill="#5d6c64">aberturas: ${input.windowCount} ventanas / ${input.doorCount} puertas</text>

      <text x="500" y="38" font-size="20" font-family="IBM Plex Sans, sans-serif" fill="#163126">Elevación frontal</text>
      <rect x="${elevX}" y="${elevY - elevHeight}" width="${elevWidth}" height="${elevHeight}" rx="6" fill="#fff" stroke="#214034" stroke-width="2"></rect>
      <polygon points="${elevX - roofOverhang},${elevY - elevHeight} ${elevX + elevWidth / 2},${elevY - elevHeight - roofOverhang * 0.8} ${elevX + elevWidth + roofOverhang},${elevY - elevHeight}" fill="#e7ded0" stroke="#214034" stroke-width="2"></polygon>
      <rect x="${elevX + elevWidth * 0.1}" y="${elevY - elevHeight * 0.55}" width="${Math.max(24, elevWidth * 0.22)}" height="${Math.max(34, elevHeight * 0.26)}" fill="#d9eef7" stroke="#214034" stroke-width="1.5"></rect>
      <rect x="${elevX + elevWidth * 0.68}" y="${elevY - elevHeight * 0.55}" width="${Math.max(24, elevWidth * 0.22)}" height="${Math.max(34, elevHeight * 0.26)}" fill="#d9eef7" stroke="#214034" stroke-width="1.5"></rect>
      <rect x="${elevX + elevWidth * 0.39}" y="${elevY - elevHeight * 0.42}" width="${Math.max(30, elevWidth * 0.2)}" height="${Math.max(80, elevHeight * 0.42)}" fill="#eadfca" stroke="#214034" stroke-width="1.5"></rect>
      <line x1="${elevX - 34}" y1="${elevY}" x2="${elevX - 34}" y2="${elevY - elevHeight}" stroke="#214034" stroke-width="1.5" marker-start="url(#arrow)" marker-end="url(#arrow)"></line>
      <text x="${elevX - 46}" y="${elevY - elevHeight / 2}" text-anchor="middle" font-size="16" font-family="IBM Plex Sans, sans-serif" fill="#214034" transform="rotate(-90 ${elevX - 46} ${elevY - elevHeight / 2})">${input.height} m</text>
      <line x1="${elevX}" y1="${elevY + 34}" x2="${elevX + elevWidth}" y2="${elevY + 34}" stroke="#214034" stroke-width="1.5" marker-start="url(#arrow)" marker-end="url(#arrow)"></line>
      <text x="${elevX + elevWidth / 2}" y="${elevY + 26}" text-anchor="middle" font-size="16" font-family="IBM Plex Sans, sans-serif" fill="#214034">${input.width} m</text>
      <text x="${elevX}" y="${elevY + 78}" font-size="13" font-family="IBM Plex Sans, sans-serif" fill="#5d6c64">Bastidor: ${result.system.mainFrameSection}</text>
      <text x="${elevX}" y="${elevY + 98}" font-size="13" font-family="IBM Plex Sans, sans-serif" fill="#5d6c64">Piso/techo: ${result.system.floorJoist}</text>
      <text x="${elevX}" y="${elevY + 118}" font-size="13" font-family="IBM Plex Sans, sans-serif" fill="#5d6c64">Exterior: ${result.cladding.wallExteriorCladding.label}</text>
    </svg>
  `;
}

function renderConceptSketch(result) {
  const { input } = result;
  const palette = {
    wall: result.input.wallExteriorCladding.includes("cement") ? "#d8d3ca" : "#c8874c",
    roof: result.input.roofCladding.includes("sandwich") ? "#d8dfe4" : "#7a8c95",
    frame: "#214034",
    glass: "#b9dceb",
    accent: "#d67d44"
  };

  conceptSketch.innerHTML = `
    <svg viewBox="0 0 820 430" role="img" aria-label="Vista conceptual del módulo">
      <rect x="0" y="0" width="820" height="430" fill="#f8f4ec"></rect>
      <ellipse cx="410" cy="350" rx="250" ry="34" fill="rgba(22,49,38,0.08)"></ellipse>
      <polygon points="230,150 490,150 610,225 350,225" fill="${palette.roof}" stroke="${palette.frame}" stroke-width="2"></polygon>
      <polygon points="230,150 230,310 350,388 350,225" fill="${palette.wall}" stroke="${palette.frame}" stroke-width="2"></polygon>
      <polygon points="350,225 610,225 610,388 350,388" fill="#f0e6d8" stroke="${palette.frame}" stroke-width="2"></polygon>
      <line x1="230" y1="150" x2="350" y2="225" stroke="${palette.frame}" stroke-width="2"></line>
      <line x1="490" y1="150" x2="610" y2="225" stroke="${palette.frame}" stroke-width="2"></line>
      <rect x="402" y="270" width="74" height="118" fill="#e3d1b7" stroke="${palette.frame}" stroke-width="2"></rect>
      <rect x="522" y="255" width="50" height="56" fill="${palette.glass}" stroke="${palette.frame}" stroke-width="2"></rect>
      <rect x="274" y="215" width="42" height="52" fill="${palette.glass}" stroke="${palette.frame}" stroke-width="2"></rect>
      <line x1="230" y1="310" x2="350" y2="388" stroke="${palette.frame}" stroke-width="2"></line>
      <line x1="610" y1="225" x2="610" y2="388" stroke="${palette.frame}" stroke-width="2"></line>
      <line x1="350" y1="388" x2="610" y2="388" stroke="${palette.frame}" stroke-width="2"></line>
      <line x1="230" y1="150" x2="490" y2="150" stroke="${palette.frame}" stroke-width="2"></line>
      <line x1="490" y1="150" x2="610" y2="225" stroke="${palette.frame}" stroke-width="2"></line>
      <text x="44" y="52" font-size="28" font-family="Avenir Next, Segoe UI, sans-serif" fill="#163126">Módulo habitacional conceptual</text>
      <text x="44" y="84" font-size="16" font-family="IBM Plex Sans, sans-serif" fill="#5d6c64">${input.length} m x ${input.width} m x ${input.height} m</text>
      <text x="44" y="112" font-size="15" font-family="IBM Plex Sans, sans-serif" fill="#5d6c64">Exterior: ${result.cladding.wallExteriorCladding.label}</text>
      <text x="44" y="136" font-size="15" font-family="IBM Plex Sans, sans-serif" fill="#5d6c64">Interior: ${result.cladding.wallInteriorLining.label}</text>
      <text x="44" y="160" font-size="15" font-family="IBM Plex Sans, sans-serif" fill="#5d6c64">Cubierta: ${result.cladding.roofCladding.label}</text>
      <text x="44" y="184" font-size="15" font-family="IBM Plex Sans, sans-serif" fill="#5d6c64">Estructura: ${result.system.mainFrameSection} + ${result.system.floorJoist}</text>
      <circle cx="92" cy="334" r="8" fill="${palette.accent}"></circle>
      <text x="110" y="339" font-size="14" font-family="IBM Plex Sans, sans-serif" fill="#163126">Apto para presentar al cliente como referencia visual</text>
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

function renderProject() {
  syncInteriorOptions();
  renderScheduled = false;
  latestResult = calculateProject(formDataToObject(form));
  const cards = buildSummaryCards(latestResult);
  renderSummaryCards(cards);
  renderTechnicalSketch(latestResult);
  renderConceptSketch(latestResult);
  renderCostSummary(latestResult);
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
    `Cantidad de perfiles calculada con barras comerciales de ${input.stockLength} m.`;

  printProjectTitle.textContent = input.projectName;
  printMeta.innerHTML = `
    <div>${input.quantity} módulo(s) iguales</div>
    <div>${input.length} x ${input.width} x ${input.height} m</div>
    <div>MO: ${formatCurrency(latestResult.costs.laborRate)} / m²</div>
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
    "COMPRA CONSOLIDADA POR PERFIL",
    consolidatedMaterialsToCsv(latestResult),
    "",
    "LISTA DETALLADA DE MATERIALES",
    materialsToCsv(latestResult)
  ].join("\n");
  downloadFile(`${safeName}-materiales.csv`, csvSections, "text/csv;charset=utf-8");
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
  window.print();
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", async () => {
    try {
      await navigator.serviceWorker.register("./sw.js");
    } catch (error) {
      console.error("No se pudo registrar el service worker", error);
    }
  });
}

applyPreset();
