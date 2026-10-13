import test from "node:test";
import assert from "node:assert/strict";

import { createRectangle, normalizeProject } from "./model.js";
import { generate } from "./generator.js";
import { computeBom } from "./bom.js";
import { layoutStair, solveRisers, stairRules } from "./stairs.js";
import { unionOutline } from "./geometry.js";

const near = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} ≠ ${b}`);
// Desnivel real entre pisos del módulo por defecto: 2,60 de muro + 0,10 de bastidor + 0,018 de placa
const H = 2.718;
const env = { f0: 0.318, H, zUnder: 2.918 - 0.013 };
const twoLevels = (stairs, W = 8, D = 4) =>
  normalizeProject({ levels: [{ walls: createRectangle(0, 0, W, D), stairs }, { walls: createRectangle(0, 0, W, D) }] });

test("alzada y pedada según reglas municipales y de accesibilidad", () => {
  const m = solveRisers(H, stairRules("municipal"));
  assert.equal(m.n, 16);
  near(m.a, 0.169875);
  near(m.p, 0.29);
  assert.ok(m.blondel >= 0.6 && m.blondel <= 0.66);
  const a = solveRisers(H, stairRules("accesible"));
  assert.equal(a.n, 17);
  assert.ok(a.a >= 0.14 && a.a <= 0.16);
  assert.ok(a.p >= 0.28 && a.p <= 0.3);
  assert.ok(a.blondel >= 0.6 && a.blondel <= 0.63);
});

test("tramos y descansos: recta larga se parte, L y U llevan descanso", () => {
  const recta = layoutStair({ kind: "recta", x: 0, y: 0, dir: 0, width: 0.9, ruleSet: "municipal" }, env);
  assert.deepEqual(recta.risers, [16]);
  assert.equal(recta.treads.length, 15);
  near(recta.flights[0].run, 15 * 0.29);
  const acc = layoutStair({ kind: "recta", x: 0, y: 0, dir: 0, width: 1.2, ruleSet: "accesible" }, env);
  assert.deepEqual(acc.risers, [9, 8]); // máximo 12 por tramo
  assert.equal(acc.landings.length, 1);
  const L = layoutStair({ kind: "L", x: 0, y: 0, dir: 0, width: 0.9, turn: "derecha", ruleSet: "municipal" }, env);
  assert.deepEqual(L.risers, [8, 8]);
  near(L.landings[0].z, 0.318 + 8 * (H / 16));
  // la última pisada llega exactamente al piso de arriba
  near(L.flights[1].zEnd, 0.318 + H);
  const U = layoutStair({ kind: "U", x: 0, y: 0, dir: 0, width: 0.9, turn: "izquierda", ruleSet: "municipal" }, env);
  assert.equal(U.flights.length, 2);
  assert.ok(U.flights[1].dir.x < 0, "el segundo tramo vuelve");
});

test("hueco por altura de paso: solo donde la pisada queda a menos de 2,00 m del entrepiso", () => {
  const lay = layoutStair({ kind: "recta", x: 0, y: 0, dir: 0, width: 0.9, ruleSet: "municipal" }, env);
  const limit = env.zUnder - 2.0;
  const first = lay.treads.find((t) => t.z > limit);
  const area = lay.hole.reduce((s, loop) => s + Math.abs(loop.reduce((acc, p, i) => {
    const q = loop[(i + 1) % loop.length];
    return acc + p.x * q.y - q.x * p.y;
  }, 0) / 2), 0);
  const holeRun = lay.treads.filter((t) => t.z > limit).length * 0.29;
  near(area, holeRun * 0.9, 1e-6);
  assert.ok(first.x0 > 0.5, "el arranque queda bajo entrepiso");
});

test("unión de rectángulos en un solo contorno", () => {
  const loops = unionOutline([{ x0: 0, x1: 2, y0: 0, y1: 1 }, { x0: 1, x1: 2, y0: 1, y1: 3 }]);
  assert.equal(loops.length, 1);
  assert.equal(loops[0].length, 6);
});

test("entrepiso con hueco: viguetas cortadas, brochales, vigas de borde y menos placa", () => {
  const without = generate(twoLevels([]));
  const p = twoLevels([{ kind: "L", x: 0.6, y: 0.6, dir: 0, width: 0.9, turn: "derecha" }]);
  const gen = generate(p);
  const lay = gen.stairs[0];
  assert.ok(lay.solution.ok);
  const holeArea = gen.levels[1].holes.reduce((s, loop) => s + Math.abs(loop.reduce((acc, a, i) => {
    const b = loop[(i + 1) % loop.length];
    return acc + a.x * b.y - b.x * a.y;
  }, 0) / 2), 0);
  near(gen.totals.mezzanineDeckArea, without.totals.mezzanineDeckArea - holeArea, 1e-9);
  const count = (g) => gen.members.filter((m) => m.group === g).length;
  assert.ok(count("Brochales del hueco") >= 2);
  assert.ok(count("Vigas de borde del hueco") >= 2);
  assert.equal(count("Zancas de escalera"), 4);
  assert.ok(count("Barandas") > 0);
  // ninguna vigueta de entrepiso cruza el hueco
  const joists = gen.members.filter((m) => m.group === "Viguetas de entrepiso");
  const inside = (x, y) => lay.holeRects.some((r) => x > r.x0 + 0.01 && x < r.x1 - 0.01 && y > r.y0 + 0.01 && y < r.y1 - 0.01);
  joists.forEach((m) => {
    for (let t = 0; t <= 1; t += 0.05) assert.ok(!inside(m.a[0] + (m.b[0] - m.a[0]) * t, m.a[1] + (m.b[1] - m.a[1]) * t), `vigueta ${m.key} cruza el hueco`);
  });
  // claves únicas para el motor de peso
  assert.equal(new Set(gen.members.map((m) => m.key)).size, gen.members.length);
  // cómputo
  const rows = computeBom(p, gen).rows.filter((r) => r.category === "Escaleras");
  assert.equal(rows.find((r) => r.material.startsWith("Escalón")).quantity, lay.treads.length);
  assert.ok(rows.some((r) => r.material.startsWith("Descanso")));
});

test("avisos: escalera que corta un muro, puerta que barre y escalera sin nivel encima", () => {
  const walls = createRectangle(0, 0, 8, 4);
  walls.push({ type: "interior", a: { x: 2, y: 0 }, b: { x: 2, y: 4 }, openings: [] });
  const p = normalizeProject({ levels: [{ walls, stairs: [{ kind: "recta", x: 0.6, y: 2, dir: 0, width: 0.9 }] }, { walls: createRectangle(0, 0, 8, 4) }] });
  assert.ok(generate(p).warnings.some((w) => w.includes("corta un muro")));
  const doorWalls = createRectangle(0, 0, 8, 4);
  doorWalls[0].openings = [{ kind: "door", offset: 1, width: 0.9, height: 2.1, hinge: "start", swing: 1 }];
  const pd = normalizeProject({ levels: [{ walls: doorWalls, stairs: [{ kind: "recta", x: 0.8, y: 0.6, dir: 0, width: 0.9 }] }, { walls: createRectangle(0, 0, 8, 4) }] });
  assert.ok(generate(pd).warnings.some((w) => w.includes("puerta barre")));
  const single = normalizeProject({ levels: [{ walls: createRectangle(0, 0, 6, 3), stairs: [{ kind: "recta", x: 0.6, y: 1.5, dir: 0 }] }] });
  assert.ok(generate(single).warnings.some((w) => w.includes("sin nivel superior")));
});

test("ancho menor al mínimo accesible queda marcado", () => {
  const p = twoLevels([{ kind: "U", x: 0.6, y: 0.6, dir: 0, width: 0.9, ruleSet: "accesible" }]);
  const lay = generate(p).stairs[0];
  assert.ok(lay.checks.some((c) => !c.ok && c.label.startsWith("Ancho")));
});
