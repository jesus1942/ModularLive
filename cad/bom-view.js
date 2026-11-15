// Vista del cómputo compartida por el diseñador y el cómputo rápido:
// misma tabla de materiales, mismos precios guardados y misma lista de cortes.
export const PRICES_KEY = "modularlive_prices";

export const fmtNum = (v, d = 2) => Number(v).toLocaleString("es-AR", { maximumFractionDigits: d, minimumFractionDigits: 0 });
export const fmtMoney = (v) => Number(v).toLocaleString("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });
export const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
export const slug = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "proyecto";

export function getPrices() {
  try {
    return JSON.parse(localStorage.getItem(PRICES_KEY) || "{}");
  } catch {
    return {};
  }
}

export function savePrice(material, price) {
  try {
    const prices = getPrices();
    if (price > 0) prices[material] = price;
    else delete prices[material];
    localStorage.setItem(PRICES_KEY, JSON.stringify(prices));
  } catch {
    /* sin almacenamiento */
  }
}

export function download(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Suma de los renglones que tienen precio cargado. */
export function materialsTotal(bom, prices = getPrices()) {
  return bom.rows.reduce((sum, r) => sum + (Number(prices[r.material]) || 0) * r.quantity, 0);
}

/** Tabla de materiales por rubro, con precio unitario editable y subtotal. */
export function materialsTableHtml(bom, prices = getPrices()) {
  let total = 0;
  let priced = 0;
  let lastCategory = null;
  const rows = bom.rows
    .map((r) => {
      const price = Number(prices[r.material]) || 0;
      const subtotal = price * r.quantity;
      total += subtotal;
      if (price) priced += 1;
      const head = r.category !== lastCategory ? `<tr class="cat"><th colspan="5">${escapeHtml(r.category)}</th></tr>` : "";
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
  return `
    <div class="table-wrap"><table class="bom">
      <thead><tr><th>Material</th><th class="num">Cantidad</th><th>Unidad</th><th class="num">Precio unit.</th><th class="num">Subtotal</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><td colspan="4">Total de materiales con precio cargado (${priced} de ${bom.rows.length} renglones)</td><td class="num">${total ? fmtMoney(total) : "—"}</td></tr></tfoot>
    </table></div>`;
}

/** Lista de cortes: cada barra comercial con sus piezas y su sobrante. */
export function cutsHtml(bom) {
  return bom.cutLists
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
