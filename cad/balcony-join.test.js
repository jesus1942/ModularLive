import test from "node:test";
import assert from "node:assert/strict";

import { createDefaultProject, createLevel, findFootprint, normalizeProject } from "./model.js";
import { generate } from "./generator.js";
import { cloneItems, structureItems } from "./clone.js";
import { balconyCornerFills, balconyLineJoins, balconyReach } from "./outdoor-build.js";
import { overhangRects, planSide } from "./exposed.js";
import { offsetPolygon, polygonArea } from "./geometry.js";

const near = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} ≠ ${b}`);
const door = (id, offset) => ({ id, kind: "door", offset, width: 0.9, height: 2.05, sill: 0 });

/** Dos módulos de 6 × 3 pegados, con un nivel arriba igual y tres balcones arriba. */
function joinedModules() {
  const p = createDefaultProject();
  cloneItems(p, 0, structureItems(p.levels[0], p.levels[0].walls[0].id), { count: 1, direction: "right", gap: 0 });
  let q = normalizeProject(p);
  q.levels.push(createLevel(1, q.levels[0].walls.map((w) => ({ ...w, id: `${w.id}u`, openings: [] }))));
  q = normalizeProject(q);
  const up = q.levels[1];
  const find = (ax, ay, bx, by) => up.walls.find((w) => w.a.x === ax && w.a.y === ay && w.b.x === bx && w.b.y === by);
  const top1 = find(0, 0, 6, 0);
  const top2 = find(6, 0, 12, 0);
  const left = find(0, 3, 0, 0);
  top1.openings.push(door("d1", 2));
  top2.openings.push(door("d2", 2));
  left.openings.push(door("d3", 1));
  up.balconies = [
    { id: "A", wallId: top1.id, offset: 0, width: 6, depth: 1.2, support: "voladizo" },
    { id: "B", wallId: top2.id, offset: 0, width: 6, depth: 1.2, support: "voladizo" },
    { id: "C", wallId: left.id, offset: 0, width: 3, depth: 1.2, support: "voladizo" }
  ];
  return normalizeProject(q);
}
const bal = (gen, id) => gen.levels[1].balconies.find((b) => b.id === id);
const railCrossesX = (b, x) => b.rails.some(([p, q]) => Math.abs(p.x - q.x) < 1e-6 && Math.abs(p.x - x) < 0.05);

test("balcones de módulos pegados: la baranda entre los dos se abre y los frentes se unen", () => {
  const gen = generate(joinedModules());
  const A = bal(gen, "A");
  const B = bal(gen, "B");
  // ningún tramo de baranda corre sobre la unión x = 6
  assert.ok(!railCrossesX(A, 6) && !railCrossesX(B, 6) && !railCrossesX(A, 5.96) && !railCrossesX(B, 6.04));
  // los frentes llegan hasta la unión y comparten el parante
  assert.ok(A.rails.some(([p, q]) => Math.abs(Math.max(p.x, q.x) - 6) < 1e-6));
  assert.ok(B.rails.some(([p, q]) => Math.abs(Math.min(p.x, q.x) - 6) < 1e-6));
  const posts = gen.members.filter((m) => m.role === "railPost" && Math.abs(m.a[0] - 6) < 1e-6 && m.a[1] < -1);
  assert.equal(posts.length, 1);
});

test("barandas por lado: se puede sacar el frente o un costado", () => {
  const q = joinedModules();
  q.levels[1].balconies.find((b) => b.id === "C").rails = { start: true, front: false, end: true };
  const C = bal(generate(normalizeProject(q)), "C");
  assert.ok(C.rails.every(([p, q2]) => Math.abs(p.y - q2.y) < 1e-6)); // quedan solo los dos costados
  assert.equal(C.rails.length, 2);
});

test("esquina saliente: se completa con el balcón vecino, sin hueco, con columna en la punta", () => {
  const q = joinedModules();
  const info = findFootprint(q.levels[1].walls);
  const fills = balconyCornerFills(q.levels[1], info.polygons ?? [info.polygon], "A");
  assert.equal(fills.length, 1);
  const f = fills[0];
  assert.equal(f.otherId, "C");
  near(f.ext, 0.065 + 1.2);
  const A = q.levels[1].balconies.find((b) => b.id === "A");
  const C = q.levels[1].balconies.find((b) => b.id === "C");
  A[f.end === "start" ? "extStart" : "extEnd"] = f.ext;
  C[f.otherEnd === "start" ? "extStart" : "extEnd"] = f.otherExt;
  const gen = generate(normalizeProject(q));
  const a = bal(gen, "A");
  const c = bal(gen, "C");
  // el piso de A llega hasta el frente de C y el de C hasta el borde de A
  near(Math.min(...a.poly.map((p) => p.x)), -1.265);
  near(Math.min(...c.poly.map((p) => p.y)), -0.065);
  near(a.area + c.area, (6 + 1.265) * 1.2 + (3 + 0.065) * 1.2);
  // sin baranda entre A y C: C no tiene costado sobre y = −0,065; A sí cierra la esquina hacia afuera
  assert.ok(!c.rails.some(([p, q2]) => Math.abs(p.y - q2.y) < 1e-6 && Math.abs(p.y + 0.025) < 0.05));
  assert.ok(a.rails.some(([p, q2]) => Math.abs(p.x - q2.x) < 1e-6 && Math.abs(p.x + 1.225) < 1e-6));
  // la punta sin muro detrás lleva columna
  assert.equal(a.posts, 1);
  assert.ok(a.notes.length === 1);
});

test("escalera exterior que llega al balcón: sin descanso propio y la baranda deja el paso", () => {
  const q = joinedModules();
  q.levels[0].stairs = [{ id: "s1", kind: "recta", dir: 90, width: 0.9, turn: "derecha", ruleSet: "municipal", tread: "chapa", x: 9, y: -1.265 - 4.35 }];
  const gen = generate(normalizeProject(q));
  const lay = gen.stairs[0];
  assert.equal(lay.toBalcony, "B");
  assert.ok(!lay.landings.some((l) => l.arrival));
  assert.ok(!gen.warnings.some((w) => w.includes("descanso de llegada no toca")));
  const B = bal(gen, "B");
  const front = B.rails.filter(([p, q2]) => Math.abs(p.y - q2.y) < 1e-6).map(([p, q2]) => [Math.min(p.x, q2.x), Math.max(p.x, q2.x)]).sort((u, v) => u[0] - v[0]);
  assert.equal(front.length, 2);
  near(front[0][1], 8.55, 0.01);
  near(front[1][0], 9.45, 0.01);
});

test("alero por lado: el techo crece solo hacia los lados elegidos", () => {
  const q = normalizeProject({ levels: [{ walls: createDefaultProject().levels[0].walls }], roof: { type: "una_agua", slope: 10, overhang: 0.25, overhangs: { arriba: 0.6, abajo: 0, izquierda: 0, derecha: 0.25 } } });
  const gen = generate(q);
  const roof = gen.surfaces.filter((s) => s.material === "cubierta");
  const xs = roof.flatMap((s) => s.points.map((p) => p[0]));
  const ys = roof.flatMap((s) => s.points.map((p) => p[1]));
  near(Math.min(...xs), 0);
  near(Math.max(...xs), 6.25);
  near(Math.min(...ys), -0.6);
  near(Math.max(...ys), 3);
  // sin valores por lado, todos toman el alero general
  const r = normalizeProject({ roof: { overhang: 0.4 } }).roof;
  assert.deepEqual(r.overhangs, { arriba: 0.4, abajo: 0.4, izquierda: 0.4, derecha: 0.4 });
  // offsetPolygon por lado respeta la orientación del contorno
  const sq = [{ x: 0, y: 0 }, { x: 0, y: 2 }, { x: 2, y: 2 }, { x: 2, y: 0 }]; // horario
  near(Math.abs(polygonArea(offsetPolygon(sq, (n) => (planSide(n) === "derecha" ? 1 : 0)))), 6);
});

test("alero por lado en la parte descubierta", () => {
  const part = {
    rects: [{ x0: 0, x1: 4, y0: 0, y1: 3 }],
    edges: [
      { a: { x: 0, y: 0 }, b: { x: 4, y: 0 }, n: { x: 0, y: -1 }, kind: "exterior" },
      { a: { x: 4, y: 0 }, b: { x: 4, y: 3 }, n: { x: 1, y: 0 }, kind: "exterior" },
      { a: { x: 4, y: 3 }, b: { x: 0, y: 3 }, n: { x: 0, y: 1 }, kind: "exterior" },
      { a: { x: 0, y: 3 }, b: { x: 0, y: 0 }, n: { x: -1, y: 0 }, kind: "upper" }
    ]
  };
  const above = [{ x: -4, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 3 }, { x: -4, y: 3 }];
  const rects = overhangRects(part, (n) => (planSide(n) === "derecha" ? 0.5 : 0), above);
  const area = rects.reduce((s, r) => s + (r.x1 - r.x0) * (r.y1 - r.y0), 0);
  near(area, 12 + 0.5 * 3); // solo la franja de la derecha, sin cuadrados de esquina
});

/** Dos contenedores separados 1,5 m, con balcón al frente de cada uno y pasillo entre ellos. */
function separatedModules() {
  const p = createDefaultProject();
  cloneItems(p, 0, structureItems(p.levels[0], p.levels[0].walls[0].id), { count: 1, direction: "right", gap: 1.5 });
  const q = normalizeProject(p);
  const lv = q.levels[0];
  const W = (ax, ay, bx, by) => lv.walls.find((w) => w.a.x === ax && w.a.y === ay && w.b.x === bx && w.b.y === by);
  const topA = W(0, 0, 6, 0);
  const topB = W(7.5, 0, 13.5, 0);
  const rightA = W(6, 0, 6, 3);
  [topA, topB, rightA].forEach((w, i) => w.openings.push(door(`d${i}`, 1)));
  lv.balconies = [
    { id: "A", wallId: topA.id, offset: 0, width: 6, depth: 1.2, support: "voladizo" },
    { id: "B", wallId: topB.id, offset: 0, width: 6, depth: 1.2, support: "voladizo" },
    { id: "P", wallId: rightA.id, offset: 0, width: 3, depth: 1, support: "voladizo" }
  ];
  return normalizeProject(q);
}

test("pasillo entre contenedores: llega al módulo de enfrente, apoya en los dos y no lleva baranda de ese lado", () => {
  const q = separatedModules();
  const info = findFootprint(q.levels[0].walls);
  const polys = info.polygons ?? [info.polygon];
  const reach = balconyReach(q.levels[0], polys, "P");
  near(reach.depth, 1.5 - 2 * 0.065, 1e-3);
  q.levels[0].balconies.find((b) => b.id === "P").depth = reach.depth;
  const gen = generate(normalizeProject(q));
  const P = gen.levels[0].balconies.find((b) => b.id === "P");
  assert.equal(P.bridge, true);
  assert.ok(!P.rails.some(([a, b]) => Math.abs(a.x - b.x) < 1e-6 && a.x > 7)); // sin baranda contra el otro módulo
  assert.ok(!P.warnings.some((w) => w.includes("voladizo")));
});

test("pasillo + balcones del frente: la esquina se cierra y el balcón sigue sin corte hasta el del otro módulo", () => {
  const q = separatedModules();
  const lv = q.levels[0];
  const info = findFootprint(lv.walls);
  const polys = info.polygons ?? [info.polygon];
  lv.balconies.find((b) => b.id === "P").depth = balconyReach(lv, polys, "P").depth;
  const f = balconyCornerFills(lv, polys, "A").find((x) => x.otherId === "P");
  near(f.ext, 1.5, 1e-3); // llega justo al balcón del módulo B
  lv.balconies.find((b) => b.id === "A")[f.end === "start" ? "extStart" : "extEnd"] = f.ext;
  lv.balconies.find((b) => b.id === "P")[f.otherEnd === "start" ? "extStart" : "extEnd"] = f.otherExt;
  const gen = generate(normalizeProject(q));
  const get = (id) => gen.levels[0].balconies.find((b) => b.id === id);
  const verticalAt = (b, x0, x1) => b.rails.some(([a, c]) => Math.abs(a.x - c.x) < 1e-6 && a.x > x0 && a.x < x1);
  assert.ok(!verticalAt(get("A"), 6, 7.6) && !verticalAt(get("B"), 6, 7.6)); // sin barandas cruzando el paso
  const fronts = [...get("A").rails, ...get("B").rails].filter(([a, c]) => Math.abs(a.y - c.y) < 1e-6).map(([a, c]) => [Math.min(a.x, c.x), Math.max(a.x, c.x)]).sort((u, v) => u[0] - v[0]);
  near(fronts[0][1], fronts[1][0], 1e-6); // frente continuo
});

test("módulos casi pegados: el balcón se une al del módulo de al lado salvando la separación", () => {
  for (const gap of [0.05, 0.15, 0.4]) {
    const p = createDefaultProject();
    cloneItems(p, 0, structureItems(p.levels[0], p.levels[0].walls[0].id), { count: 1, direction: "right", gap });
    const q = normalizeProject(p);
    const lv = q.levels[0];
    const tops = lv.walls.filter((w) => w.a.y === 0 && w.b.y === 0);
    tops.forEach((w, i) => w.openings.push(door(`d${i}`, 1)));
    lv.balconies = tops.map((w, i) => ({ id: `b${i}`, wallId: w.id, offset: 0, width: 6, depth: 1.2, support: "voladizo" }));
    const n = normalizeProject(q);
    const info = findFootprint(n.levels[0].walls);
    const joins = balconyLineJoins(n.levels[0], info.polygons ?? [info.polygon], "b0");
    assert.equal(joins.length, 1);
    near(joins[0].gap, gap, 1e-3);
    n.levels[0].balconies[0][joins[0].end === "start" ? "extStart" : "extEnd"] = joins[0].ext;
    const gen = generate(normalizeProject(n));
    const all = gen.levels[0].balconies.flatMap((b) => b.rails);
    assert.ok(!all.some(([a, c]) => Math.abs(a.x - c.x) < 1e-6 && a.x > 5.5 && a.x < 6.5 + gap), `gap ${gap}: quedó baranda en el medio`);
    const fronts = all.filter(([a, c]) => Math.abs(a.y - c.y) < 1e-6).map(([a, c]) => [Math.min(a.x, c.x), Math.max(a.x, c.x)]).sort((u, v) => u[0] - v[0]);
    near(fronts[0][1], fronts[1][0], 1e-6);
  }
});
