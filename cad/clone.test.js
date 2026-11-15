import test from "node:test";
import assert from "node:assert/strict";

import { createDefaultProject, createLevel, createRectangle, doorLeaf, findFootprint, normalizeProject } from "./model.js";
import { generate } from "./generator.js";
import { computeBom } from "./bom.js";
import { cloneItems, copyOpenings, inwardSign, itemsInRect, removeItems, repeatOpening, structureItems } from "./clone.js";
import { buildLoft } from "./loft.js";
import { pointInPolygon, polygonArea } from "./geometry.js";

const near = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} ≠ ${b}`);
const keysUnique = (gen) => assert.equal(new Set(gen.members.map((m) => m.key)).size, gen.members.length);

test("módulo completo: toma contorno, tabiques, aberturas, escaleras y balcones", () => {
  const p = createDefaultProject();
  const lv = p.levels[0];
  lv.walls.push({ id: "tab", type: "interior", a: { x: 3, y: 0 }, b: { x: 3, y: 3 }, openings: [] });
  lv.walls.push(...createRectangle(10, 0, 4, 3)); // otra estructura, no se toca
  const items = structureItems(lv, lv.walls[0].id);
  assert.equal(items.filter((it) => it.type === "wall").length, 5);
});

test("clonar tres veces hacia la derecha: tres módulos iguales separados", () => {
  const p = createDefaultProject();
  const before = generate(p);
  const items = structureItems(p.levels[0], p.levels[0].walls[0].id);
  const res = cloneItems(p, 0, items, { count: 3, direction: "right", gap: 1 });
  assert.equal(res.created, 12);
  const q = normalizeProject(p);
  const gen = generate(q);
  assert.equal(gen.levels[0].footprints.length, 4);
  near(gen.totals.coveredArea, before.totals.coveredArea * 4);
  // cada copia lleva las mismas aberturas, en la misma posición relativa
  const xs = q.levels[0].walls.filter((w) => w.openings.some((o) => o.kind === "door")).map((w) => Math.min(w.a.x, w.b.x));
  assert.deepEqual(xs, [0, 7, 14, 21]);
  assert.equal(q.levels[0].walls.flatMap((w) => w.openings).length, 5 * 4);
  // el cómputo de cuatro módulos separados es cuatro veces el de uno, pieza por pieza
  assert.equal(gen.members.length, before.members.length * 4);
  const steel = (g) => g.members.reduce((sum, m) => sum + m.cut, 0);
  near(steel(gen), steel(before) * 4, 1e-6);
  keysUnique(gen);
  // ids nuevos en todo
  const ids = q.levels[0].walls.flatMap((w) => [w.id, ...w.openings.map((o) => o.id)]);
  assert.equal(new Set(ids).size, ids.length);
});

test("en espejo: la copia queda simétrica respecto del borde compartido y las puertas abren hacia adentro", () => {
  const p = createDefaultProject();
  const lv = p.levels[0];
  const items = structureItems(lv, lv.walls[0].id);
  cloneItems(p, 0, items, { count: 2, direction: "right", gap: 0.5, mirror: true });
  const q = normalizeProject(p);
  const doors = q.levels[0].walls.flatMap((w) => w.openings.filter((o) => o.kind === "door").map((o) => ({ w, o })));
  assert.equal(doors.length, 3);
  const centers = doors.map(({ w, o }) => {
    const leaf = doorLeaf(w, o);
    return (leaf.hingePt.x + leaf.freePt.x) / 2;
  });
  // original: puerta centrada en x = 3; espejo sobre el eje x = 6,25 → 9,5; la segunda copia repite al original corrida 13
  near(centers[0], 3);
  near(centers[1], 6 + 0.5 + 3);
  near(centers[2], 13 + 3);
  const info = findFootprint(q.levels[0].walls);
  doors.forEach(({ w, o }) => {
    const leaf = doorLeaf(w, o);
    const poly = info.polygons.find((pl) => pointInPolygon({ x: (leaf.hingePt.x + leaf.freePt.x) / 2, y: 0.5 }, pl));
    assert.ok(pointInPolygon(leaf.tip, poly), "la hoja barre hacia adentro del módulo");
  });
  // en el espejo la bisagra queda del lado opuesto
  const hx = doors.map(({ w, o }) => doorLeaf(w, o).hingePt.x - Math.min(w.a.x, w.b.x));
  near(hx[0], 2.55);
  near(hx[1], 6 - 2.55);
  near(hx[2], 2.55);
});

test("adosados sin separación: el muro compartido se computa una sola vez", () => {
  const p = createDefaultProject();
  const lv = p.levels[0];
  cloneItems(p, 0, structureItems(lv, lv.walls[0].id), { count: 1, direction: "right", gap: 0 });
  const gen = generate(normalizeProject(p));
  assert.equal(gen.levels[0].footprints?.length ?? 1, 1);
  near(gen.totals.coveredArea, 36);
  const shared = gen.wallSummaries.filter((w) => w.level === 0 && Math.abs(w.length - 3) < 1e-6);
  assert.equal(shared.length, 3); // dos testeros y un solo muro medianero
  keysUnique(gen);
});

test("clonar un módulo de dos plantas con escalera copia todos los niveles", () => {
  const p = createDefaultProject();
  p.levels[0].stairs = [{ id: "s1", kind: "L", x: 0.8, y: 2.3, dir: 0, width: 0.9, turn: "izquierda", ruleSet: "municipal", tread: "chapa" }];
  p.levels.push(createLevel(1, createRectangle(0, 0, 6, 3)));
  const res = cloneItems(p, 0, structureItems(p.levels[0], p.levels[0].walls[0].id), { count: 1, direction: "down", gap: 2, mirror: true, allLevels: true });
  assert.equal(res.levels, 2);
  const q = normalizeProject(p);
  assert.equal(q.levels[1].walls.length, 8);
  const st = q.levels[0].stairs[1];
  // espejo sobre el eje horizontal: la escalera sigue subiendo hacia +x, pero gira para el otro lado
  assert.equal(st.dir, 0);
  assert.equal(st.turn, "derecha");
  near(st.y, 3 - 2.3 + 5);
  const gen = generate(q);
  assert.equal(gen.stairs.filter((l) => l.solution.ok).length, 2);
  assert.equal(gen.levels[1].footprints.length, 2);
  keysUnique(gen);
});

test("copiar las aberturas de un lateral a otro, igual o enfrentadas", () => {
  const p = createDefaultProject();
  const lv = p.levels[0];
  const poly = findFootprint(lv.walls).polygon;
  const inward = (w) => inwardSign(w, poly);
  lv.walls[2].openings = [];
  const res = copyOpenings(lv, lv.walls[0].id, lv.walls[2].id, { mirror: true, inward });
  assert.deepEqual(res, { added: 3, skipped: 0 });
  // enfrentadas: mismo x en el muro opuesto
  const x = (w, o) => doorLeaf(w, { ...o, hinge: "start", swing: 1 }).hingePt.x;
  const a = lv.walls[0].openings.map((o) => Math.min(x(lv.walls[0], o), x(lv.walls[0], { ...o, offset: o.offset + o.width }))).sort((m, n) => m - n);
  const b = lv.walls[2].openings.map((o) => Math.min(x(lv.walls[2], o), x(lv.walls[2], { ...o, offset: o.offset + o.width }))).sort((m, n) => m - n);
  a.forEach((v, i) => near(v, b[i]));
  const door = lv.walls[2].openings.find((o) => o.kind === "door");
  assert.ok(pointInPolygon(doorLeaf(lv.walls[2], door).tip, poly));
  // repetir no pisa lo que ya está
  assert.equal(copyOpenings(lv, lv.walls[0].id, lv.walls[2].id, { mirror: true, inward }).added, 0);
  // un muro corto recibe solo lo que entra
  lv.walls[3].openings = [];
  const short = copyOpenings(lv, lv.walls[0].id, lv.walls[3].id, {});
  assert.equal(short.added + short.skipped, 3);
  assert.ok(short.skipped >= 1);
});

test("repetir una ventana a lo largo del muro respeta separación y largo", () => {
  const p = normalizeProject({ levels: [{ walls: createRectangle(0, 0, 10, 3) }] });
  const w = p.levels[0].walls[0];
  w.openings = [{ id: "o1", kind: "window", offset: 0.5, width: 1.2, height: 1, sill: 1 }];
  const res = repeatOpening(p.levels[0], w.id, "o1", 6, 0.6);
  assert.equal(res.added, 4); // 0,5 · 2,3 · 4,1 · 5,9 · 7,7 y la sexta ya no entra
  assert.deepEqual(w.openings.map((o) => o.offset), [0.5, 2.3, 4.1, 5.9, 7.7]);
});

test("selección por ventana y borrado de varias piezas", () => {
  const p = createDefaultProject();
  const lv = p.levels[0];
  lv.walls.push(...createRectangle(10, 0, 4, 3));
  const picked = itemsInRect(lv, { minX: 9, maxX: 15, minY: -1, maxY: 4 });
  assert.equal(picked.length, 4);
  removeItems(lv, picked);
  assert.equal(lv.walls.length, 4);
});

test("loft: doble altura con altillo, vacío, escalera que llega al borde y baranda", () => {
  const { project, notes } = buildLoft();
  assert.deepEqual(notes, []);
  const gen = generate(project);
  near(gen.totals.voidArea, 5.4 * 3.6);
  near(gen.totals.mezzanineDeckArea, 3 * 3.6);
  near(gen.totals.coveredArea, 2 * 8.4 * 3.6);
  const lay = gen.stairs[0];
  assert.ok(lay.solution.ok);
  // la última pisada llega justo al borde del altillo
  near(lay.flights[0].x1, 5.4, 1e-6);
  assert.ok(!gen.warnings.some((w) => /llegada|bloquea|hueco del entrepiso corta|fuera del contorno/.test(w)), gen.warnings.join(" | "));
  // baranda en el borde libre del altillo, sin tapar la llegada de la escalera
  const rails = gen.members.filter((m) => m.level === 1 && m.role === "handrail");
  const railLen = rails.reduce((s, m) => s + m.cut, 0);
  near(railLen, 3.6 - 0.9, 0.2);
  // el piso del altillo no invade el vacío
  const joists = gen.members.filter((m) => m.level === 1 && m.group === "Viguetas de entrepiso");
  assert.ok(joists.length > 0 && joists.every((m) => Math.min(m.a[0], m.b[0]) > 5.4));
  // el cielorraso bajo el altillo se computa solo donde hay entrepiso
  const bom = computeBom(project, gen);
  assert.ok(bom.rows.some((r) => r.category === "Entrepiso"));
  keysUnique(gen);
  near(Math.abs(polygonArea(gen.levels[1].holes[0])), 19.44);
});

test("loft: medidas que no dan se informan sin romper el diseño", () => {
  assert.match(buildLoft({ length: 3 }).error, /Largo exterior/);
  assert.match(buildLoft({ length: 6, mezzanine: 5 }).error, /doble altura/);
  const short = buildLoft({ length: 6, mezzanine: 3 });
  assert.equal(short.project.levels[0].stairs.length, 0);
  assert.match(short.notes[0], /escalera recta necesita/);
});
