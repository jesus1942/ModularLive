import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { copyContour, createDefaultProject, createLevel, createRectangle, normalizeProject } from "../model.js";
import { generate } from "../generator.js";
import { computeBom } from "../bom.js";
import { createStore } from "../store.js";
import { runEngineering } from "./engine.js";
import { solidVolume_m3 } from "./loads.js";
import { MATERIALS, resolveMaterial } from "./data/materials.js";
import { LOCATIONS } from "./data/locations.js";
import { defaultEngineering, normalizeEngineering } from "./settings.js";
import { engineeringResultHtml } from "./panel.js";
import { G0_m_s2, NToKgf, kNToTf, tfToKN, MPaToKgfCm2, kgfCm2ToMPa, formatForce } from "./units.js";

const near = (actual, expected, tolerance = 1e-7) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} ≠ ${expected}`);
const calculate = (p) => runEngineering(p, generate(p));

/** Identidades fijas para comparar todo el resultado, sin fecha ni aleatoriedad en el fixture. */
export function fixedProject() {
  const p = createDefaultProject();
  p.levels.forEach((l, li) => {
    l.id = `level-${li}`;
    l.walls.forEach((w, wi) => {
      w.id = `wall-${li}-${wi}`;
      w.openings.forEach((o, oi) => { o.id = `opening-${li}-${wi}-${oi}`; });
    });
  });
  return p;
}

test("unidades de fuerza y presión: ida y vuelta, signo y separación masa/fuerza", () => {
  near(NToKgf(G0_m_s2), 1);
  near(kNToTf(tfToKN(2.5)), 2.5);
  near(kgfCm2ToMPa(MPaToKgfCm2(235)), 235);
  assert.match(formatForce(-10000), /^-10 kN \(-1,02 tf\)$/);
});

test("peso por defecto contra suma manual de cortes, áreas netas y seis dados", () => {
  const p = fixedProject();
  const r = calculate(p);
  // Área nominal del tubo: BH − (B−2t)(H−2t), sin radios (m²); densidad 7.850 kg/m³.
  const rhs = (B, H, t) => (B * H - (B - 2 * t) * (H - 2 * t)) * 7850;
  const steel_kg = (6 * 2.718 + 2 * 17.4) * rhs(0.1, 0.1, 0.0032)
    + (105.21 + 10.5) * rhs(0.05, 0.1, 0.002)
    + 22.7 * ((0.1 + 2 * 0.05 + 0.03) * 0.002 * 7850)
    + (14 * 2.9 + 13 * 3.501 + 13) * rhs(0.05, 0.1, 0.0032);
  // Exterior: 18 × (2,6 + 0,118) + 0,54 de relleno − 6,69 de aberturas.
  const skins_kg = 42.774 * (7 + 0.5 + 5.1) + 40.11 * (8.15 + 4)
    + 18 * (11.2 + 10) + 22.75 * Math.sqrt(1 + 0.02 ** 2) * (7 + 0.5 + 5.1)
    + 18 * 6 + 4.8 * 15 + 1.89 * 15;
  near(r.totals.members_N, steel_kg * G0_m_s2);
  near(r.totals.surfaces_N, skins_kg * G0_m_s2);
  near(r.totals.foundation_N, 6 * 0.4 * 0.4 * 0.8 * 24000);
  near(r.totals.total_N, 54986.52461549544);
  assert.equal(r.statusLabel, "Revisar");
  assert.equal(r.issues.length, 0);
});

test("claves únicas: identidad sobrevive a tabique agregado y a reordenar muros/aberturas", () => {
  const p = fixedProject();
  const before = generate(p);
  const old = new Set(before.members.map((m) => m.key));
  assert.equal(old.size, before.members.length);
  p.levels[0].walls.push({ id: "new-partition", type: "interior", a: { x: 2, y: 0 }, b: { x: 2, y: 3 }, openings: [] });
  p.levels[0].walls.reverse();
  p.levels[0].walls.forEach((w) => w.openings.reverse());
  const after = generate(p);
  const next = new Set(after.members.map((m) => m.key));
  assert.equal(next.size, after.members.length);
  for (const key of old) assert.ok(next.has(key), key);
  const cutKeys = computeBom(p, after).cutLists.flatMap((c) => c.bars.flatMap((b) => b.pieces.map((piece) => piece.key)));
  assert.ok(cutKeys.every((key) => next.has(key)));
});

test("viguetas conservan key al cambiar sección y columnas al cambiar altura", () => {
  const p = fixedProject();
  const before = generate(p);
  p.mainFrame = "tubo_80x80x3_2";
  const joists = (g) => g.members.filter((m) => m.role === "floorJoist").map((m) => m.key).sort();
  assert.deepEqual(joists(generate(p)), joists(before));
  p.mainFrame = "tubo_100x100x3_2";
  p.levels[0].height = 3.2;
  const columns = (g) => g.members.filter((m) => m.role === "column").map((m) => m.key).sort();
  assert.deepEqual(columns(generate(p)), columns(before));
});

test("peso instalado no depende de merma, largo comercial ni espesor de corte", () => {
  const p = fixedProject();
  const a = calculate(p).totals;
  p.settings.wasteFactor = 30;
  p.settings.stockLength = 12;
  p.settings.kerf = 10;
  assert.deepEqual(calculate(p).totals, a);
});

test("abrir un diseño anterior agrega ingeniería sin alterar muros ni cantidades", () => {
  const p = fixedProject();
  const expected = computeBom(p, generate(p));
  const old = { ...p, walls: p.levels[0].walls };
  delete old.levels;
  delete old.engineering;
  const restored = normalizeProject(old);
  assert.equal(restored.engineering.soil.qadm, 100);
  assert.equal(restored.engineering.soil.confirmed, false);
  assert.equal(restored.engineering.steel.Fy, 235e6);
  assert.deepEqual(computeBom(restored, generate(restored)).rows, expected.rows);
});

test("densidad/pesos editables cambian solo sus contribuciones y no se certifican solos", () => {
  const p = fixedProject();
  const a = calculate(p);
  p.engineering.materialOverrides.durlock = { value: 12, confirmed: true, source: "" };
  const b = calculate(p);
  near(b.totals.surfaces_N - a.totals.surfaces_N, 40.11 * (12 - 8.15) * G0_m_s2);
  near(b.totals.members_N, a.totals.members_N);
  assert.ok(b.assumptions.some((v) => v.id === "material:durlock"));
  p.engineering.materialOverrides.durlock.source = "Ficha de la placa realmente elegida";
  assert.ok(!calculate(p).assumptions.some((v) => v.id === "material:durlock"));
  p.engineering.materialOverrides.steel = { value: 8000, source: "", confirmed: false };
  near(calculate(p).totals.members_N, a.totals.members_N * 8000 / 7850);
});

test("números inválidos se reemplazan con supuesto visible; nunca producen NaN silencioso", () => {
  const p = fixedProject();
  p.engineering.soil.qadm = 0;
  p.engineering.steel.Fy = "";
  p.engineering.location.seismicZone = 2.5;
  p.engineering.materialOverrides.osb_11 = { value: -8 };
  const e = normalizeEngineering(p.engineering, p.levels);
  assert.equal(e.soil.qadm, 100);
  assert.equal(e.steel.Fy, 235e6);
  assert.equal(e.location.seismicZone, 0);
  const r = calculate(p);
  assert.ok(r.issues.length >= 4);
  assert.ok(Number.isFinite(r.totals.total_N));
  assert.equal(resolveMaterial("osb_11", p.engineering.materialOverrides).assumed, true);
});

test("localidades no inventan valores; entrada local pendiente no cambia el peso propio", () => {
  const p = fixedProject();
  const before = calculate(p);
  Object.values(LOCATIONS).forEach((l) => assert.equal(l.V, null));
  p.engineering.location.preset = "esquel";
  p.engineering.location.V = 80;
  p.engineering.location.pg = 2;
  p.engineering.soil.qadm = 50;
  assert.deepEqual(calculate(p).totals, before.totals);
  assert.ok(before.assumptions.some((a) => a.id === "input:location" && a.message.includes("no un valor local")));
});

test("un tabique tiene dos caras pero una sola aislación; al quitarla baja solo ese peso", () => {
  const p = fixedProject();
  p.levels[0].walls.push({ id: "partition", type: "interior", a: { x: 3, y: 0 }, b: { x: 3, y: 3 }, openings: [] });
  const gen = generate(p);
  const faces = gen.surfaces.filter((s) => s.wallId === "partition");
  near(faces.flatMap((sf) => sf.layers).filter((l) => l.materialId === "aislacion_muro").reduce((sum, l) => sum + l.area_m2, 0), 3 * 2.6);
  const before = calculate(p);
  p.settings.interiorWallInsulation = false;
  near(before.totals.total_N - calculate(p).totals.total_N, 3 * 2.6 * 4 * G0_m_s2);
});

test("dos aguas: aislación sobre planta; placas sobre pendiente con alero, sin doble conteo", () => {
  const p = fixedProject();
  p.roof.type = "dos_aguas";
  p.roof.slope = 30;
  const gen = generate(p);
  const roof = gen.surfaces.filter((s) => s.material === "cubierta");
  assert.equal(roof.length, 2);
  near(roof.reduce((sum, s) => sum + s.coveredArea_m2, 0), 18);
  near(roof.reduce((sum, s) => sum + s.area, 0), 22.75 * Math.sqrt(1 + 0.3 ** 2));
  assert.equal(new Set(gen.surfaces.map((s) => s.key)).size, gen.surfaces.length);
  assert.equal(calculate(p).issues.length, 0);
});

test("sólidos de todas las fundaciones coinciden con volumen del cómputo sin sumar merma", () => {
  const p = fixedProject();
  for (const type of ["dados", "vigas_pilotines", "platea"]) {
    const project = normalizeProject({ ...p, foundation: { type } });
    const gen = generate(project);
    near(gen.solids.reduce((sum, s) => sum + solidVolume_m3(s), 0), gen.totals.concrete);
    near(calculate(project).totals.foundation_N, gen.totals.concrete * 24000);
  }
});

test("niveles apilados: peso de cada nivel y fundación suman el total; entrepiso lleva cielorraso", () => {
  const p = fixedProject();
  p.levels.push(createLevel(1, copyContour(p.levels[0].walls)));
  const r = calculate(p);
  near(r.levels.reduce((s, l) => s + l.weight_N, 0), r.totals.superstructure_N);
  near(r.totals.total_N, r.totals.superstructure_N + r.totals.foundation_N);
  const ceiling = r.groups.find((g) => g.group === "Entrepiso" && g.label === MATERIALS.durlock.label);
  near(ceiling.quantity, 18);
  assert.ok(r.notVerified.some((s) => s.includes("anclajes")));
});

test("niveles de distinta huella mantienen claves y áreas de cubierta descubierta coherentes", () => {
  const p = fixedProject();
  p.levels.push(createLevel(1, createRectangle(0, 0, 3, 3)));
  const g = generate(p);
  const roof = g.surfaces.filter((s) => s.material === "cubierta");
  near(roof.reduce((s, sf) => s + sf.coveredArea_m2, 0), 18);
  assert.equal(new Set(g.members.map((m) => m.key)).size, g.members.length);
  assert.ok(Number.isFinite(calculate(p).totals.total_N));
});

test("contorno abierto calcula lo disponible y explica qué falta; no aparenta verificación", () => {
  const p = fixedProject();
  p.levels[0].walls.pop();
  const r = calculate(p);
  assert.ok(r.totals.members_N > 0);
  assert.equal(r.totals.foundation_N, 0);
  assert.ok(r.issues.some((s) => s.includes("contorno")));
  assert.equal(r.statusLabel, "Revisar");
});

test("valores y supuestos persisten al guardar/abrir, deshacer y rehacer", () => {
  const old = globalThis.localStorage;
  const data = new Map();
  globalThis.localStorage = { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, v) };
  try {
    const store = createStore();
    store.update((p) => { p.engineering.materialOverrides.durlock = { value: 9, source: "Ficha X", confirmed: true }; });
    store.undo();
    assert.equal(store.project.engineering.materialOverrides.durlock, undefined);
    store.redo();
    assert.equal(store.project.engineering.materialOverrides.durlock.value, 9);
    assert.deepEqual(createStore().project.engineering, store.project.engineering);
  } finally { globalThis.localStorage = old; }
});

test("interfaz escapa fuentes y nombres; muestra alcance, supuestos y resultado con unidades", () => {
  const p = fixedProject();
  p.levels[0].name = "<script>mal</script>";
  p.engineering.materialOverrides.durlock = { value: 9, source: '<img src=x onerror="alert(1)">', confirmed: true };
  const html = engineeringResultHtml(calculate(p), p);
  assert.ok(!html.includes("<script>mal"));
  assert.ok(!html.includes("<img src=x"));
  assert.ok(html.includes("&lt;img"));
  assert.ok(html.includes("Jesús Olguín"));
  assert.ok(html.includes("kN"));
  assert.ok(html.includes("tf"));
  assert.ok(html.includes("profesional matriculado"));
  assert.ok(!html.includes("APROBADO"));
});

test("regresión completa y determinista del motor base", () => {
  const p = fixedProject();
  const a = calculate(p);
  assert.deepEqual(calculate(structuredClone(p)), a);
  const expected = JSON.parse(readFileSync(new URL("./fixtures/default-phase-0.json", import.meta.url), "utf8"));
  assert.deepEqual(JSON.parse(JSON.stringify(a)), expected);
});
