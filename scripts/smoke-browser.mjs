// Prueba optativa de interfaz. Playwright se instala solo en el entorno de CI, no en la PWA.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, writeFile, readFile, unlink } from "node:fs/promises";
import { chromium } from "playwright";

const root = new URL("../", import.meta.url).pathname;
const output = new URL("../test-results/browser/", import.meta.url).pathname;
await mkdir(output, { recursive: true });
const server = spawn("python3", ["-m", "http.server", "4173", "--bind", "127.0.0.1"], { cwd: root, stdio: "ignore" });
const browser = await chromium.launch({ args: ["--enable-unsafe-swiftshader"] });
const errors = [];
const checks = [];

/** Espera que el servidor de esta prueba esté atendiendo, con límite y sin demora fija larga. */
async function waitForServer() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try { if ((await fetch("http://127.0.0.1:4173/cad.html")).ok) return; } catch { /* aún inicia */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("El servidor local no inició.");
}

/** Abre la app con consola vigilada y tipografías locales para aislar fallas de redes externas. */
async function openPage(viewport) {
  const context = await browser.newContext({ viewport });
  // La prueba usa la fuente de sistema; los recursos de aplicación y el 3D sí se cargan reales.
  await context.route("https://fonts.googleapis.com/**", (route) => route.fulfill({ status: 200, contentType: "text/css", body: "" }));
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto("http://127.0.0.1:4173/cad.html");
  await page.locator("#engineeringSummary [data-show-engineering]").waitFor();
  return { page, context };
}

/** Comprueba el ancho de documento, sin confundir el desplazamiento interno de tablas con desborde. */
async function verifyWidth(page) {
  const sizes = await page.evaluate(() => ({ document: document.documentElement.scrollWidth, viewport: innerWidth }));
  assert.ok(sizes.document <= sizes.viewport + 1, JSON.stringify(sizes));
}

try {
  await waitForServer();
  const { page, context } = await openPage({ width: 1440, height: 1000 });
  assert.match(await page.locator("#engineeringSummary").innerText(), /38,91 kN/);
  assert.equal(await page.locator("#viewer canvas").count(), 1);
  assert.equal(await page.locator(".viewer__error").count(), 0);
  assert.match(await page.locator("#engineeringSummary").innerText(), /Equilibrio verificado en 2661 combinaciones/);
  assert.match(await page.locator("#engineeringSummary").innerText(), /No cumple el límite de desplazamiento/);
  await page.locator('#windViewMode').selectOption('analysis-model');
  await page.waitForFunction(()=>document.querySelector('#windLegend').textContent.includes('Ejes analíticos'));
  await page.locator('#windViewMode').selectOption('analysis-reactions');
  await page.waitForFunction(()=>document.querySelector('#windLegend').textContent.includes('Flechas de reacción'));
  assert.match(await page.locator('#analysisDetail').innerText(), /38,91 kN/);
  await page.screenshot({path:`${output}desktop-reactions.png`});
  await page.locator('#windViewMode').selectOption('analysis-deformed');
  await page.waitForFunction(()=>document.querySelector('#windLegend').textContent.includes('×10'));
  await page.screenshot({path:`${output}desktop-deformed.png`});
  await page.locator('#windViewMode').selectOption('model');
  checks.push('Fase 2: modelo, reacciones y deformada; 2661 combinaciones con equilibrio y deriva insuficiente explícita.');
  await page.getByRole("button", { name: "Ingeniería", exact: true }).click();
  await page.locator('input[data-material="durlock"][data-material-field="value"]').fill("12");
  await page.locator('input[data-material="durlock"][data-material-field="value"]').press("Tab");
  await page.waitForFunction(() => document.querySelector("#engineeringSummary").textContent.includes("41,1 kN"));
  await page.locator('input[data-material="durlock"][data-material-field="source"]').fill("Ficha de prueba, placa elegida");
  await page.locator('input[data-material="durlock"][data-material-field="source"]').press("Tab");
  await page.locator('input[data-material="durlock"][data-material-field="confirmed"]').check();
  await page.waitForFunction(() => document.querySelector('input[data-material="durlock"][data-material-field="confirmed"]').checked);
  const material = page.locator(".eng-material").filter({ has: page.locator('input[data-material="durlock"]') });
  assert.match(await material.innerText(), /Dato aportado/);
  await page.reload();
  await page.locator("#engineeringSummary [data-show-engineering]").waitFor();
  assert.match(await page.locator("#engineeringSummary").innerText(), /41,1 kN/);
  assert.equal(await page.locator("#undoBtn").isEnabled(), false); // historial reiniciado al recargar
  await page.getByRole("button", { name: "Ingeniería", exact: true }).click();
  await page.locator('[data-material-reset="durlock"]').click();
  await page.waitForFunction(() => document.querySelector("#engineeringSummary").textContent.includes("38,91 kN"));
  await page.locator("#undoBtn").click();
  await page.waitForFunction(() => document.querySelector("#engineeringSummary").textContent.includes("41,1 kN"));
  await page.locator("#redoBtn").click();
  await page.waitForFunction(() => document.querySelector("#engineeringSummary").textContent.includes("38,91 kN"));
  // Presiones reales, casos torsionales y control de unidades del visor.
  await page.locator('#windViewMode').selectOption('main');
  assert.equal(await page.locator('#windCaseSelect option').count(), 132);
  await page.waitForFunction(() => document.querySelector('#windLegend').textContent.includes('2025'));
  await page.locator('#windCaseSelect').selectOption({ index: 16 }); // primer caso torsional
  await page.locator('#viewer').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${output}desktop-wind.png` });
  await page.locator('#windViewMode').selectOption('local-negative');
  assert.match(await page.locator('#windLegend').innerText(), /envolvente local/);
  await page.screenshot({ path: `${output}desktop-local-pressure.png` });
  await page.locator('#windViewMode').selectOption('model');
  // La carga puntual se conserva en el proyecto y desaparece al quitar el equipo.
  await page.locator('#extraLoadsEditor summary').click();
  await page.locator('[data-extra-add]').click();
  await page.waitForFunction(() => document.querySelector('#engineeringSummary').textContent.includes('39,91 kN'));
  await page.locator('[data-extra-index="0"][data-extra-field="force_N"]').fill('10.5');
  await page.locator('[data-extra-index="0"][data-extra-field="force_N"]').press('Tab');
  await page.waitForFunction(() => document.querySelector('#engineeringSummary').textContent.includes('49,41 kN'));
  await page.locator('[data-extra-remove="0"]').click();
  await page.waitForFunction(() => document.querySelector('#engineeringSummary').textContent.includes('38,91 kN'));
  await page.locator("#engineeringSettings > summary").click();
  // La opción de edición cambia la base del viento y persiste la intención del usuario.
  await page.locator('select[data-path="engineering.codeEdition"]').selectOption('2005');
  await page.waitForFunction(() => document.querySelector('#engineeringSummary').textContent.includes('Viento 2005'));
  assert.equal(await page.locator('input[data-path="engineering.location.V"]').inputValue(), '58');
  await page.locator('select[data-path="engineering.codeEdition"]').selectOption('2025');
  await page.waitForFunction(() => document.querySelector('#engineeringSummary').textContent.includes('Viento 2025'));
  await page.locator('#engineeringInputs summary').filter({ hasText: 'Uso y cargas permanentes' }).click();
  await page.locator('select[data-path="engineering.usage.0.use"]').selectOption('oficina');
  await page.waitForFunction(() => document.querySelector('#engineeringPanel').textContent.includes('oficina 2,5'));
  await page.locator('select[data-path="engineering.usage.0.use"]').selectOption('vivienda');
  await page.waitForFunction(() => document.querySelector('#engineeringPanel').textContent.includes('vivienda 2'));
  await verifyWidth(page);
  await page.getByRole("button", { name: "Ingeniería", exact: true }).click();
  await page.getByRole("heading", { name: "Cargas del modelo · edición 2025", exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${output}desktop.png` });
  // La exportación incluye el detalle que permanece en el Worker, sin truncarlo al resumen de interfaz.
  const downloadPromise=page.waitForEvent('download');
  await page.locator('#engineeringJsonBtn').click();
  const exported=await downloadPromise,exportPath=`${output}engineering-export.json`;
  await exported.saveAs(exportPath);
  const full=JSON.parse(await readFile(exportPath,'utf8'));
  assert.equal(full.result.phase,2);assert.equal(full.result.analysis.caseResponses.length,136);
  assert.equal(full.result.analysis.tributary.cases.length,136);assert.equal(full.result.analysis.combinationChecks.length,2661);
  await unlink(exportPath);
  checks.push('JSON completo descargado desde el Worker: casos, rutas y 2661 comprobaciones presentes.');
  checks.push("Escritorio: 3D y presiones/torsión/C&R, cargas puntuales, edición 2005/2025, usos, pesos con fuente, guardado y deshacer/rehacer.");

  const mobile = await openPage({ width: 390, height: 844 });
  await mobile.page.screenshot({ path: `${output}mobile-initial.png` });
  await verifyWidth(mobile.page);
  await mobile.page.locator('#windViewMode').selectOption('local-negative');
  await mobile.page.locator('#viewer').scrollIntoViewIfNeeded();
  await mobile.page.screenshot({ path: `${output}mobile-wind.png` });
  await verifyWidth(mobile.page);
  await mobile.page.getByRole("button", { name: "Ingeniería", exact: true }).click();
  await mobile.page.getByRole("heading", { name: "Cargas del modelo · edición 2025", exact: true }).scrollIntoViewIfNeeded();
  await mobile.page.screenshot({ path: `${output}mobile-engineering.png` });
  await verifyWidth(mobile.page);
  await mobile.page.locator('#windViewMode').selectOption('analysis-deformed');
  await mobile.page.waitForFunction(()=>document.querySelector('#windLegend').textContent.includes('×10'));
  await mobile.page.locator('#viewer').scrollIntoViewIfNeeded();
  await mobile.page.screenshot({path:`${output}mobile-deformed.png`});
  await verifyWidth(mobile.page);
  checks.push("Celular 390 × 844: diseñador y detalle de Ingeniería sin desborde horizontal.");

  // Comprueba los módulos nuevos realmente servidos desde la caché del service worker.
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.locator("#engineeringSummary [data-show-engineering]").waitFor();
  await context.setOffline(true);
  await page.reload();
  await page.locator("#engineeringSummary [data-show-engineering]").waitFor();
  assert.match(await page.locator("#engineeringSummary").innerText(), /38,91 kN/);
  checks.push("PWA sin conexión: el cálculo carga con todos sus módulos nuevos en caché.");
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ checks, errors }, null, 2));
} finally {
  await writeFile(`${output}checks.json`, JSON.stringify({ checks, errors }, null, 2));
  await browser.close();
  server.kill();
}
