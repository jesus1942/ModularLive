import test from "node:test";
import assert from "node:assert/strict";

import { copyContour, createDefaultProject, createLevel, doorLeaf, findFootprint, normalizeProject } from "./model.js";
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
  project.levels[0].walls.forEach((wall) => {
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

const rectWalls = (w, d, x0 = 0, y0 = 0) => {
  const pts = [[x0, y0], [x0 + w, y0], [x0 + w, y0 + d], [x0, y0 + d]];
  return pts.map((p, i) => ({ type: "exterior", a: { x: p[0], y: p[1] }, b: { x: pts[(i + 1) % 4][0], y: pts[(i + 1) % 4][1] }, openings: [] }));
};

test("los diseños guardados antes de los niveles se abren como planta baja", () => {
  const project = normalizeProject({ walls: rectWalls(4, 3), settings: { wallHeight: 2.4 } });
  assert.equal(project.levels.length, 1);
  assert.equal(project.levels[0].name, "Planta baja");
  assert.equal(project.levels[0].height, 2.4);
  assert.equal(project.walls, undefined);
});

test("dos módulos apilados: el nivel superior apoya sobre el inferior y el cómputo suma ambos", () => {
  const one = normalizeProject({ levels: [{ walls: rectWalls(6, 3) }] });
  const two = normalizeProject({ levels: [{ walls: rectWalls(6, 3) }, { walls: rectWalls(6, 3) }] });
  const g1 = generate(one);
  const g2 = generate(two);
  // el nivel 1 arranca donde termina la planta baja
  assert.ok(Math.abs(g2.levels[1].elev - g2.levels[0].zTop) < 1e-9);
  // columnas alineadas: mismas posiciones en planta
  const keys = (l) => l.columns.map((p) => `${p.x}:${p.y}`).sort().join("|");
  assert.equal(keys(g2.levels[0]), keys(g2.levels[1]));
  // el doble de columnas, una sola cubierta y una sola fundación
  assert.equal(count(g2, "Columnas"), 2 * count(g1, "Columnas"));
  assert.equal(count(g2, "Cabios"), count(g1, "Cabios"));
  assert.ok(Math.abs(g2.totals.concrete - g1.totals.concrete) < 1e-9);
  assert.equal(g2.totals.coveredArea, 36);
  assert.equal(count(g2, "Viguetas de entrepiso"), count(g1, "Viguetas de piso"));
  assert.equal(g2.totals.stackPlates, g2.levels[1].columns.length);
  const bom = computeBom(two, g2);
  assert.ok(bom.rows.some((r) => r.category === "Entrepiso"));
  assert.ok(bom.summary.steelKg > computeBom(one, g1).summary.steelKg * 1.6);
});

test("nivel superior más chico: la parte descubierta lleva cubierta plana", () => {
  const project = normalizeProject({ levels: [{ walls: rectWalls(8, 3) }, { walls: rectWalls(4, 3) }] });
  const gen = generate(project);
  const flat = gen.surfaces.filter((sf) => sf.layer === "cubierta" && sf.level === 0);
  assert.equal(flat.length, 1);
  assert.ok(Math.abs(flat[0].area - 12) < 1e-9);
  assert.ok(gen.members.some((m) => m.group === "Cabios" && m.level === 0));
  assert.ok(Math.abs(gen.totals.roofCoveredArea - 24) < 1e-9);
  assert.equal(gen.warnings.filter((w) => w.includes("voladizo")).length, 0);
});

test("avisa cuando el nivel superior vuela sobre el inferior", () => {
  const project = normalizeProject({ levels: [{ walls: rectWalls(4, 3) }, { walls: rectWalls(6, 3) }] });
  const gen = generate(project);
  assert.ok(gen.warnings.some((w) => w.includes("voladizo")));
});

test("copiar contorno toma solo los muros exteriores sin aberturas", () => {
  const base = createDefaultProject();
  const copy = copyContour(base.levels[0].walls);
  assert.equal(copy.length, 4);
  assert.ok(copy.every((w) => w.openings.length === 0));
  const level = createLevel(1, copy);
  assert.equal(level.name, "Nivel 1");
});

test("sentido de apertura de puertas: bisagra, lado y mano", () => {
  const wall = { a: { x: 0, y: 0 }, b: { x: 4, y: 0 } };
  const door = { offset: 1, width: 0.9 };
  const a = doorLeaf(wall, { ...door, hinge: "start", swing: 1 });
  const b = doorLeaf(wall, { ...door, hinge: "end", swing: 1 });
  const c = doorLeaf(wall, { ...door, hinge: "start", swing: -1 });
  assert.deepEqual(a.hingePt, { x: 1, y: 0 });
  assert.deepEqual(b.hingePt, { x: 1.9, y: 0 });
  assert.ok(a.tip.y > 0 && c.tip.y < 0);
  assert.notEqual(a.hand, b.hand);
  assert.notEqual(a.hand, c.hand);
  // la mano se separa en el cómputo
  const project = normalizeProject({
    walls: rectWalls(6, 3).map((w, i) =>
      i === 0
        ? { ...w, openings: [{ kind: "door", offset: 1, width: 0.9, height: 2.1, hinge: "start", swing: 1 }, { kind: "door", offset: 3, width: 0.9, height: 2.1, hinge: "end", swing: 1 }] }
        : w
    )
  });
  const doors = computeBom(project, generate(project)).rows.filter((r) => r.material.startsWith("Puerta"));
  assert.equal(doors.length, 2);
  assert.ok(doors.some((r) => r.material.includes("derecha")) && doors.some((r) => r.material.includes("izquierda")));
});

test("columnas continuas: el mismo contorno arriba no deja columnas sin apoyo", () => {
  const ground = createDefaultProject().levels[0].walls; // con puerta que corre una columna
  const project = normalizeProject({ levels: [{ walls: ground }, { walls: copyContour(ground) }] });
  const gen = generate(project);
  assert.equal(gen.warnings.filter((w) => w.includes("no coincide")).length, 0);
  // una esquina de arriba sobre un muro de abajo genera columna abajo
  const p2 = normalizeProject({ levels: [{ walls: rectWalls(8, 3) }, { walls: rectWalls(5, 3) }] });
  const g2 = generate(p2);
  assert.ok(g2.levels[0].columns.some((c) => Math.abs(c.x - 5) < 1e-6 && Math.abs(c.y) < 1e-6));
  assert.equal(g2.warnings.filter((w) => w.includes("no coincide")).length, 0);
});
