import test from "node:test";
import assert from "node:assert/strict";

import { createRectangle, normalizeProject } from "./model.js";
import { generate } from "./generator.js";
import { computeBom } from "./bom.js";
import { exposedParts } from "./exposed.js";
import { polygonArea } from "./geometry.js";
import { runEngineering } from "./engineering/engine.js";

const near = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} ≠ ${b}`);
const R = (x0, y0, w, h) => [{ x: x0, y: y0 }, { x: x0 + w, y: y0 }, { x: x0 + w, y: y0 + h }, { x: x0, y: y0 + h }];
const two = (upper, extra = {}) => normalizeProject({ levels: [{ walls: createRectangle(0, 0, 8, 4), ...extra.low }, { walls: upper, ...extra.up }] });
const count = (gen, group, level) => gen.members.filter((m) => m.group === group && (level === undefined || m.level === level)).length;
const uniqueKeys = (gen) => assert.equal(new Set(gen.members.map((m) => m.key)).size, gen.members.length);

test("partes descubiertas: el agua siempre se aleja del nivel de arriba", () => {
  const a = exposedParts(R(0, 0, 8, 4), R(0, 0, 4, 4));
  assert.equal(a.length, 1);
  assert.deepEqual(a[0].d, { x: 1, y: 0 });
  const b = exposedParts(R(0, 0, 8, 4), R(2, -2, 4, 8)); // girado: quedan dos franjas
  assert.deepEqual(b.map((p) => p.d.x).sort(), [-1, 1]);
  const c = exposedParts(R(0, 0, 8, 4), R(0, 0, 4, 2)); // en una esquina: un solo plano en L
  assert.equal(c.length, 1);
  assert.equal(c[0].area, 24);
  assert.ok(!c[0].drainsToUpper);
  const d = exposedParts(R(0, 0, 8, 6), R(2, 2, 4, 2)); // anillo: se parte en paños
  assert.ok(d.length > 1 && d.every((p) => p.split && !p.drainsToUpper));
});

test("techo a un agua: el muro de abajo sube hasta el techo y cierra el entretecho", () => {
  const gen = generate(two(createRectangle(0, 0, 4, 4)));
  const lv = gen.levels[0];
  // muro de abajo en y = 0: su revestimiento sube desde x = 4 (alto) hasta x = 8 (alero)
  const wall = gen.surfaces.find((sf) => sf.level === 0 && sf.material === "exterior" && sf.points.every((p) => Math.abs(p[1] + 0.065) < 1e-6));
  const top = Math.max(...wall.points.map((p) => p[2]));
  near(top, lv.zTop + 0.1 * 4);
  const summary = gen.wallSummaries.find((w) => w.level === 0 && w.wallId === wall.wallId);
  near(summary.fillArea, 0.5 * 4 * 0.4);
  assert.ok(count(gen, "Relleno de hastial", 0) > 4);
  // cabios en pendiente, apoyados en la viga contra el nivel de arriba
  const rafters = gen.members.filter((m) => m.level === 0 && m.group === "Cabios");
  assert.ok(rafters.every((m) => m.a[2] > m.b[2]));
  assert.equal(count(gen, "Vigas de apoyo de cubierta", 0), 1);
  near(gen.totals.flashing_m, 4);
  uniqueKeys(gen);
});

test("techo que tapa una ventana o recibe una puerta del nivel de arriba: avisa", () => {
  const up = createRectangle(0, 0, 4, 2);
  up[1].openings = [{ kind: "window", offset: 0.5, width: 1, height: 1, sill: 0.3 }];
  const gen = generate(two(up));
  assert.ok(gen.warnings.some((w) => w.includes("tapa una ventana")));
  up[1].openings = [{ kind: "window", offset: 0.5, width: 1, height: 1, sill: 1 }];
  assert.ok(!generate(two(up)).warnings.some((w) => w.includes("tapa una ventana")));
  up[1].openings = [{ kind: "door", offset: 0.5, width: 0.9, height: 2.1, sill: 0 }];
  assert.ok(generate(two(up)).warnings.some((w) => w.includes("puerta da al techo")));
});

test("terraza: piso con pendiente, escalón bajo la puerta, baranda y sobrecarga de terraza", () => {
  const up = createRectangle(0, 0, 4, 4);
  const p = two(up, { low: { exposed: { kind: "terraza" } } });
  let gen = generate(p);
  assert.ok(gen.warnings.some((w) => w.includes("terraza no tiene puerta")));
  const deck = gen.surfaces.find((sf) => sf.level === 0 && sf.access === "terraza");
  const zs = deck.points.map((q) => q[2]);
  near(gen.levels[1].floorTop - Math.max(...zs), 0.02); // 2 cm bajo el piso interior
  near(Math.max(...zs) - Math.min(...zs), 0.015 * 4); // 1,5 % hacia afuera
  assert.equal(gen.totals.exposedRoofArea, 0);
  near(gen.totals.terraceArea, 16);
  assert.ok(count(gen, "Barandas", 0) > 20);
  // las barandas tienen 1,00 m sobre el piso terminado
  const rail = gen.members.find((m) => m.level === 0 && m.role === "handrail");
  assert.ok(rail.a[2] - Math.max(...zs) > 0.9);
  // el cielorraso de abajo baja para dejar pasar las viguetas de la terraza
  const joists = gen.members.filter((m) => m.group === "Viguetas de terraza");
  const ceilingTop = Math.max(...gen.members.filter((m) => m.level === 0 && m.group === "Viguetas de cielorraso").map((m) => m.a[2] + m.h / 2));
  assert.ok(ceilingTop <= Math.min(...joists.map((m) => m.a[2] - m.h / 2)) + 1e-9);
  uniqueKeys(gen);
  // con puerta al frente de la terraza no hay aviso; la carga es L de terraza (3 kPa)
  p.levels[1].walls[1].openings = [{ id: "o1", kind: "door", offset: 1.5, width: 0.9, height: 2.1, sill: 0, hinge: "start", swing: 1 }];
  gen = generate(p);
  assert.ok(!gen.warnings.some((w) => w.includes("terraza no tiene puerta")));
  const L = runEngineering(p, gen).live.L.entries.find((e) => e.use === "terraza");
  near(L.pressure_Pa, 3000);
  const rows = computeBom(p, gen).rows.filter((r) => r.category === "Terrazas y balcones");
  assert.ok(rows.some((r) => r.material.startsWith("Membrana asfáltica")));
  assert.ok(rows.some((r) => r.material.startsWith("Embudo")));
});

test("volado: cierre inferior a la intemperie y sin cielorraso interior debajo", () => {
  const p = two(createRectangle(2, -2, 4, 8));
  const gen = generate(p);
  const soffit = gen.surfaces.filter((sf) => sf.material === "volado");
  near(soffit.reduce((s, sf) => s + sf.area, 0), 16);
  near(gen.totals.soffitArea, 16);
  const piso = gen.surfaces.find((sf) => sf.level === 1 && sf.material === "piso");
  const durlock = piso.layers.find((l) => l.materialId === "durlock");
  near(durlock.area_m2, piso.area - 16);
  assert.ok(computeBom(p, gen).rows.some((r) => r.category === "Volados"));
});

test("balcón en voladizo y con columnas: vigas, piso, baranda, dados y avisos", () => {
  const up = createRectangle(0, 0, 8, 4);
  const mk = (bal) => normalizeProject({ levels: [{ walls: createRectangle(0, 0, 8, 4) }, { walls: up, balconies: [{ wallId: up[0].id, offset: 2, width: 3, depth: 1.2, ...bal }] }] });
  let gen = generate(mk({}));
  const deck = gen.surfaces.find((sf) => sf.material === "balcon");
  near(deck.area, 3 * 1.2);
  near(deck.points[0][2], gen.levels[1].floorTop - 0.04);
  // el piso sale hacia afuera del muro (y < 0)
  assert.ok(deck.points.every((p) => p[1] < 0));
  assert.equal(count(gen, "Vigas de balcón en voladizo"), 6);
  assert.ok(count(gen, "Barandas", 1) > 20);
  assert.ok(gen.warnings.some((w) => w.includes("Balcón de Nivel 1: no tiene puerta")));
  uniqueKeys(gen);
  const before = generate(normalizeProject({ levels: [{ walls: createRectangle(0, 0, 8, 4) }, { walls: up }] })).totals.concrete;
  gen = generate(mk({ support: "columnas" }));
  assert.equal(count(gen, "Columnas de balcón"), 2);
  near(gen.totals.concrete - before, 2 * 0.4 * 0.4 * 0.65);
  assert.ok(computeBom(mk({ support: "columnas" }), gen).rows.some((r) => r.material.startsWith("Placa de anclaje 150")));
  assert.ok(generate(mk({ depth: 1.8 })).warnings.some((w) => w.includes("en voladizo es mucho")));
  // sobrecarga de balcón de vivienda hasta 10 m²
  const p = mk({});
  const L = runEngineering(p, generate(p)).live.L.entries.find((e) => e.use === "balcon");
  near(L.pressure_Pa, 3000);
});

test("balcón de un nivel alto encima de la parte descubierta de abajo: avisa", () => {
  const up = createRectangle(0, 0, 4, 4);
  const p = normalizeProject({ levels: [{ walls: createRectangle(0, 0, 8, 4) }, { walls: up, balconies: [{ wallId: up[1].id, offset: 1, width: 2, depth: 1.2 }] }] });
  assert.ok(generate(p).warnings.some((w) => w.includes("conviene hacerla terraza")));
});

test("modelo: valores por defecto y balcones de muros que ya no existen", () => {
  const p = normalizeProject({ levels: [{ walls: createRectangle(0, 0, 6, 3), balconies: [{ wallId: "no-existe", width: 2 }] }] });
  assert.deepEqual(p.levels[0].balconies, []);
  assert.equal(p.levels[0].exposed.kind, "techo");
  assert.equal(p.levels[0].exposed.slope, 10);
  const q = normalizeProject({ levels: [{ walls: createRectangle(0, 0, 6, 3), exposed: { kind: "terraza", slope: 500, overhang: -1 } }] });
  assert.deepEqual(q.levels[0].exposed, { kind: "terraza", slope: 60, overhang: 0, railing: true });
  assert.ok(Math.abs(polygonArea(R(0, 0, 1, 1))) === 1);
});
