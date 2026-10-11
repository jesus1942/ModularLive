import test from "node:test";
import assert from "node:assert/strict";

import { createDefaultProject, findFootprint, normalizeProject } from "./model.js";
import { generate } from "./generator.js";
import { computeBom, optimizeCuts } from "./bom.js";
import { offsetPolygon, polygonArea, scanPolygon } from "./geometry.js";

const count = (gen, group) => gen.members.filter((m) => m.group === group).length;
const sum = (gen, group) => gen.members.filter((m) => m.group === group).reduce((s, m) => s + m.cut, 0);

const lShape = () => {
  const pts = [[0, 0], [8, 0], [8, 3], [4, 3], [4, 6], [0, 6]];
  return pts.map((p, i) => ({
    type: "exterior",
    a: { x: p[0], y: p[1] },
    b: { x: pts[(i + 1) % pts.length][0], y: pts[(i + 1) % pts.length][1] },
    openings: []
  }));
};

test("módulo 3 × 6 por defecto: piezas verificables a mano", () => {
  const project = createDefaultProject();
  const gen = generate(project);
  assert.equal(gen.totals.footprintArea, 18);
  assert.equal(gen.spanAxis, "y");
  // 4 esquinas + 1 intermedia por muro de 6 m (corrida por la puerta)
  assert.equal(count(gen, "Columnas"), 6);
  // viguetas cada 40 cm a lo largo de 6 m, sin las de borde
  assert.equal(count(gen, "Viguetas de piso"), 14);
  assert.ok(Math.abs(sum(gen, "Viguetas de piso") - 14 * 2.9) < 1e-6);
  // bastidor: 2 × (5,80) + 2 × (2,90) por nivel
  assert.ok(Math.abs(sum(gen, "Bastidor inferior") - 17.4) < 1e-6);
  // cabios cada 60 cm sobre 6,50 m de alero a alero
  assert.equal(count(gen, "Cabios"), 13);
  // dados 0,4 × 0,4 × 0,8 m bajo 6 columnas
  assert.ok(Math.abs(gen.totals.concrete - 6 * 0.4 * 0.4 * 0.8) < 1e-9);
  assert.equal(gen.warnings.length, 0);
});

test("ninguna columna intermedia cae dentro de una abertura", () => {
  const project = createDefaultProject();
  const gen = generate(project);
  project.walls.forEach((wall) => {
    wall.openings.forEach((o) => {
      gen.members
        .filter((m) => m.group === "Columnas")
        .forEach((m) => {
          const dx = wall.b.x - wall.a.x;
          const dy = wall.b.y - wall.a.y;
          const L = Math.hypot(dx, dy);
          const sPos = ((m.a[0] - wall.a.x) * dx + (m.a[1] - wall.a.y) * dy) / L;
          const across = Math.abs((m.a[0] - wall.a.x) * dy - (m.a[1] - wall.a.y) * dx) / L;
          if (across < 0.01) assert.ok(sPos <= o.offset || sPos >= o.offset + o.width);
        });
    });
  });
});

test("detecta contorno en L y avisa cuando no cierra", () => {
  const fp = findFootprint(lShape());
  assert.equal(fp.closed, true);
  assert.equal(polygonArea(fp.polygon), 36);
  const open = findFootprint(lShape().slice(0, 5));
  assert.equal(open.closed, false);
  assert.ok(open.warnings.length > 0);
});

test("geometría: offset y barrido de polígonos", () => {
  const square = [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 2 }];
  assert.ok(Math.abs(polygonArea(offsetPolygon(square, 0.5)) - 9) < 1e-9);
  const fp = findFootprint(lShape()).polygon;
  // recta x = 6 corta solo el ala baja (y 0..3)
  assert.deepEqual(scanPolygon(fp, "x", 6).map(([a, b]) => [Math.round(a * 1000) / 1000, Math.round(b * 1000) / 1000]), [[0, 3]]);
  // recta x = 4 (justo en el quiebre) toma el tramo más largo
  const atNotch = scanPolygon(fp, "x", 4);
  assert.ok(Math.abs(atNotch[0][1] - atNotch[0][0] - 6) < 1e-3);
});

test("dos aguas genera cumbrera y relleno de hastial; platea no lleva viguetas", () => {
  const project = normalizeProject({ walls: lShape(), roof: { type: "dos_aguas", slope: 30, overhang: 0.3 }, foundation: { type: "platea" } });
  const gen = generate(project);
  assert.equal(count(gen, "Viguetas de piso"), 0);
  assert.equal(count(gen, "Cumbrera"), 1);
  assert.ok(count(gen, "Relleno de hastial") > 0);
  // la cubierta en pendiente es mayor que su proyección
  assert.ok(gen.totals.roofArea > gen.totals.roofPlanArea);
  assert.ok(gen.totals.concrete > 36 * 0.12);
});

test("vigas con pilotines: un pilotín por esquina y cada ≤ 2 m", () => {
  const project = normalizeProject({ walls: lShape(), foundation: { type: "vigas_pilotines" } });
  const gen = generate(project);
  assert.equal(gen.totals.piles, 15);
  assert.ok(gen.warnings.some((w) => w.includes("viguetas")));
});

test("optimización de cortes: respeta el largo de barra y empalma piezas largas", () => {
  const pieces = [5, 3, 3, 2.9, 1, 0.5, 7].map((length, i) => ({ length, id: i }));
  const result = optimizeCuts(pieces, 6, 0.003);
  result.bars.forEach((bar) => assert.ok(bar.used <= 6 + 1e-9));
  const cut = result.bars.flatMap((b) => b.pieces).reduce((s, p) => s + p.length, 0);
  assert.ok(Math.abs(cut - 22.4) < 1e-9);
  assert.equal(result.splices, 1);
  assert.equal(result.barCount, 4);
});

test("el cómputo incluye fundación, estructura, cerramientos y aberturas", () => {
  const project = createDefaultProject();
  const bom = computeBom(project, generate(project));
  const categories = new Set(bom.rows.map((r) => r.category));
  ["Fundación", "Estructura", "Piso", "Muros", "Techo", "Aberturas", "Fijaciones"].forEach((c) => assert.ok(categories.has(c), c));
  assert.ok(bom.rows.every((r) => r.quantity > 0));
  const windows = bom.rows.find((r) => r.material.startsWith("Ventana"));
  assert.equal(windows.quantity, 4);
});
