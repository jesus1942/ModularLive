import test from "node:test";
import assert from "node:assert/strict";

import { createDefaultProject } from "./model.js";
import { generate } from "./generator.js";
import { computeBom } from "./bom.js";
import { QUICK_PRESETS, normalizeQuick, quickProject } from "./quick.js";

const near = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} ≠ ${b}`);
const run = (input) => {
  const res = quickProject(input);
  const gen = generate(res.project);
  return { ...res, gen, bom: computeBom(res.project, gen) };
};
const group = (gen, name) => gen.members.filter((m) => m.group === name);
const total = (gen, name) => group(gen, name).reduce((sum, m) => sum + m.cut, 0);
const row = (bom, start) => bom.rows.find((r) => r.material.startsWith(start));

test("módulo 6 × 3 × 2,60: cada cantidad coincide con la cuenta hecha a mano", () => {
  const { gen, bom, notes } = run({ preset: "vivienda", waste: 0 });
  assert.deepEqual(notes, []);
  // bastidor: 4 esquinas + 1 columna intermedia en cada muro de 6 m (separación máxima 3 m)
  assert.equal(group(gen, "Columnas").length, 6);
  near(total(gen, "Columnas"), 6 * (2.6 + 0.1 + 0.018));
  // bastidores inferior y superior: perímetro de 18 m menos 6 columnas de 10 cm
  near(total(gen, "Bastidor inferior"), 18 - 6 * 0.1);
  near(total(gen, "Bastidor superior"), 18 - 6 * 0.1);
  // viguetas de piso: 6 m cada 0,40 = 15 tramos → 14 viguetas de 3,00 − 0,10 m
  assert.equal(group(gen, "Viguetas de piso").length, 14);
  near(total(gen, "Viguetas de piso"), 14 * 2.9);
  // cabios: techo de 6,50 × 3,50 con alero de 0,25 y 2 % de pendiente
  const rafter = 3.5 * Math.hypot(1, 0.02);
  group(gen, "Cabios").forEach((m) => near(m.cut, rafter, 5e-4)); // el corte se redondea al milímetro
  near(gen.totals.roofArea, 6.5 * rafter, 1e-9);
  near(total(gen, "Cenefas"), 2 * 6.5);
  // superficies
  near(gen.totals.footprintArea, 18);
  near(gen.totals.floorDeckArea, 18);
  const openings = 4 * 1.2 * 1 + 0.9 * 2.1;
  const extSkin = gen.wallSummaries.reduce((sum, w) => sum + w.extArea, 0);
  near(extSkin, 18 * (2.6 + 0.1 + 0.018) - openings + gen.wallSummaries.reduce((s, w) => s + w.fillArea, 0), 1e-6);
  // placas: superficie ÷ cobertura de la placa, redondeado hacia arriba
  assert.equal(row(bom, "Placa OSB / fenólico 18").quantity, Math.ceil(18 / (1.22 * 2.44)));
  const chapa = bom.rows.filter((r) => r.material.startsWith("Chapa sinusoidal"));
  assert.deepEqual(chapa.map((r) => [r.category, r.quantity]), [["Muros", Math.ceil(extSkin / (1.1 * 2.4 * 0.88))], ["Techo", Math.ceil(gen.totals.roofArea / (1.1 * 2.4 * 0.88))]]);
  // dados de 40 × 40 × (60 + 20) cm, uno por columna
  near(gen.totals.concrete, 6 * 0.4 * 0.4 * 0.8);
  // aberturas
  assert.equal(bom.rows.filter((r) => r.category === "Aberturas").reduce((s, r) => s + r.quantity, 0), 5);
});

test("el cómputo rápido da exactamente lo mismo que el diseñador para el mismo módulo", () => {
  const quick = run({ preset: "vivienda" });
  const designer = createDefaultProject();
  const gen = generate(designer);
  const bom = computeBom(designer, gen);
  const key = (b) => b.rows.filter((r) => r.category !== "Aberturas").map((r) => `${r.category}|${r.material}|${r.quantity}`);
  // la única diferencia posible es dónde cae cada abertura; las cantidades no cambian
  assert.deepEqual(key(quick.bom).filter((k) => !k.startsWith("Estructura|Tubo rectangular AC 100×50×2") && !k.startsWith("Estructura|Perfil C")), key(bom).filter((k) => !k.startsWith("Estructura|Tubo rectangular AC 100×50×2") && !k.startsWith("Estructura|Perfil C")));
  assert.equal(quick.bom.summary.coveredArea, bom.summary.coveredArea);
  assert.equal(quick.bom.summary.roofArea, bom.summary.roofArea);
  assert.equal(quick.bom.summary.concrete, bom.summary.concrete);
});

test("la merma se aplica una sola vez y solo a placas y áreas", () => {
  const a = run({ preset: "vivienda", waste: 0 });
  const b = run({ preset: "vivienda", waste: 10 });
  const area = a.gen.totals.floorDeckArea;
  assert.equal(row(a.bom, "Lana de roca alta densidad").quantity, Math.ceil(area));
  assert.equal(row(b.bom, "Lana de roca alta densidad").quantity, Math.ceil(area * 1.1));
  // las barras salen de la lista de cortes, no de un porcentaje
  assert.equal(a.bom.summary.structuralBars, b.bom.summary.structuralBars);
  near(a.gen.members.reduce((s, m) => s + m.cut, 0), b.gen.members.reduce((s, m) => s + m.cut, 0));
});

test("varios módulos: piezas y superficies se multiplican; las barras se optimizan juntas", () => {
  const one = run({ preset: "vivienda" });
  const four = run({ preset: "vivienda", modules: 4 });
  assert.equal(four.gen.levels[0].footprints.length, 4);
  assert.equal(four.gen.members.length, one.gen.members.length * 4);
  near(four.gen.totals.coveredArea, one.gen.totals.coveredArea * 4);
  near(four.gen.totals.concrete, one.gen.totals.concrete * 4);
  near(four.gen.totals.roofArea, one.gen.totals.roofArea * 4, 1e-9);
  assert.ok(four.bom.summary.structuralBars <= one.bom.summary.structuralBars * 4);
  assert.ok(four.bom.summary.structuralBars >= Math.ceil(one.gen.members.reduce((s, m) => s + m.cut, 0) * 4 / 6));
  assert.equal(four.bom.rows.filter((r) => r.category === "Aberturas").reduce((s, r) => s + r.quantity, 0), 20);
});

test("las aberturas se reparten sin pisarse y avisa lo que no entra", () => {
  const { project, notes } = quickProject({ preset: "custom", length: 3, width: 2, windowCount: 12, doorCount: 2 });
  const placed = project.levels[0].walls.flatMap((w) => w.openings);
  assert.ok(placed.length < 14);
  assert.match(notes.join(" "), /No entr/);
  project.levels[0].walls.forEach((w) => {
    const L = Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y);
    const sorted = [...w.openings].sort((a, b) => a.offset - b.offset);
    sorted.forEach((o, i) => {
      assert.ok(o.offset >= 0.3 - 1e-6 && o.offset + o.width <= L - 0.3 + 1e-6);
      if (sorted[i + 1]) assert.ok(sorted[i + 1].offset - (o.offset + o.width) >= 0.3 - 1e-6);
    });
  });
  assert.deepEqual(generate(project).warnings.filter((w) => /abertura/i.test(w)), []);
});

test("presets y datos inválidos", () => {
  Object.keys(QUICK_PRESETS).forEach((preset) => {
    const res = run({ preset, ...QUICK_PRESETS[preset] });
    assert.ok(res.bom.rows.length > 15, preset);
    assert.equal(new Set(res.gen.members.map((m) => m.key)).size, res.gen.members.length);
  });
  const loft = run({ preset: "loft", ...QUICK_PRESETS.loft });
  assert.equal(loft.project.levels.length, 2);
  assert.ok(loft.gen.totals.voidArea > 0);
  const input = normalizeQuick({ length: "abc", width: -4, modules: 999, exterior: "oro" });
  assert.equal(input.length, 6);
  assert.equal(input.width, 1.5);
  assert.equal(input.modules, 20);
  assert.equal(input.exterior, "chapa_sinusoidal");
});
