import test from "node:test";
import assert from "node:assert/strict";

import { createDefaultProject, createLevel, createRectangle, normalizeProject } from "./model.js";
import { generate } from "./generator.js";
import { buildLoft } from "./loft.js";
import { buildSheets, frontSide, normalizeSheet, openingTypes, sectionPlanes } from "./sheets.js";
import { cloneItems, structureItems } from "./clone.js";

const sheetsOf = (p) => buildSheets(p, generate(p));
const clean = (sheets) => sheets.forEach((s) => assert.ok(!/NaN|undefined|Infinity/.test(s.svg), `${s.id} tiene valores inválidos`));

test("módulo de una planta: planta, techos, cortes, vistas y planillas a escala", () => {
  const p = createDefaultProject();
  const sheets = sheetsOf(p);
  assert.deepEqual(sheets.map((s) => s.id), ["planta-0", "techos", "cortes", "vistas", "planillas"]);
  clean(sheets);
  assert.equal(sheets[0].title, "Planta baja");
  assert.equal(sheets[0].scale, "1:50");
  // cotas del contorno y de las aberturas del frente: 0,60 · 1,20 · 0,75 · 0,90 · 0,75 · 1,20 · 0,60
  ["6,00", "3,00", "0,60", "1,20", "0,75", "0,90"].forEach((v) => assert.ok(sheets[0].svg.includes(`>${v}<`), `falta la cota ${v}`));
  assert.ok(sheets[0].svg.includes("N.P.T. +0,32"));
  // formato A3 apaisado en milímetros reales
  assert.match(sheets[0].svg, /viewBox="0 0 420 297" width="420mm" height="297mm"/);
  assert.match(sheets[4].svg, /Superficie cubierta total<\/text>.*18,00 m²/s);
});

test("códigos de aberturas: por medida, con la mano en las puertas", () => {
  const p = createDefaultProject();
  const types = openingTypes(p);
  assert.deepEqual(types.list.map((t) => `${t.code}×${t.count}`), ["P1×1", "V1×4"]);
  const { project } = buildLoft();
  const loft = openingTypes(project);
  assert.equal(loft.list.filter((t) => t.kind === "door").length, 1);
  assert.equal(loft.list.reduce((sum, t) => sum + t.count, 0), project.levels.flatMap((l) => l.walls.flatMap((w) => w.openings)).length);
  // cada abertura del proyecto tiene su código en la planta
  assert.equal(loft.byOpening.size, 9);
});

test("loft: una planta por nivel, vacío rotulado, escalera en planta y cortes con niveles", () => {
  const { project } = buildLoft();
  project.sheet = { obra: "Loft <prueba> & cía", localidad: "Rawson", provincia: "Chubut", north: 450 };
  const sheets = sheetsOf(project);
  assert.deepEqual(sheets.map((s) => s.id), ["planta-0", "planta-1", "techos", "cortes", "vistas", "planillas"]);
  clean(sheets);
  assert.ok(sheets[0].svg.includes("SUBE 16 alz. de 0,17"));
  assert.ok(sheets[1].svg.includes("VACÍO · DOBLE ALTURA"));
  assert.ok(sheets[2].svg.includes("p = 10 %"));
  ["±0,00  N.T.", "+0,32  N.P.T. Planta baja", "+3,04  N.P.T. Altillo"].forEach((t) => assert.ok(sheets[3].svg.includes(t), t));
  // el texto del rótulo se escapa y el norte se normaliza
  assert.ok(sheets[0].svg.includes("Loft &lt;prueba&gt; &amp; cía"));
  assert.equal(normalizeSheet(project.sheet).north, 90);
  assert.match(sheets[5].svg, /41,04 m²/);
  assert.match(sheets[0].svg, />01 \/ 06</);
});

test("los cortes no caen sobre un tabique y el frente es el lado de la puerta", () => {
  const p = createDefaultProject();
  p.levels[0].walls.push({ id: "t", type: "interior", a: { x: 3, y: 0 }, b: { x: 3, y: 3 }, openings: [] });
  const planes = sectionPlanes(normalizeProject(p));
  assert.ok(Math.abs(planes.A.c - 3) > 0.2);
  assert.deepEqual(frontSide(createDefaultProject()), { x: 0, y: -1 }); // la puerta está en y = 0
  assert.deepEqual(frontSide(buildLoft().project), { x: 0, y: 1 });
});

test("varios módulos, niveles desiguales, balcón y platea: todas las láminas se generan", () => {
  const p = createDefaultProject();
  cloneItems(p, 0, structureItems(p.levels[0], p.levels[0].walls[0].id), { count: 2, direction: "right", gap: 1, mirror: true });
  clean(sheetsOf(normalizeProject(p)));
  const up = createRectangle(0, 0, 3, 3);
  up[0].openings = [{ kind: "door", offset: 1, width: 0.9, height: 2.1, sill: 0 }];
  const q = normalizeProject({
    levels: [{ walls: createRectangle(0, 0, 6, 3), exposed: { kind: "terraza" } }, { ...createLevel(1, up), balconies: [{ wallId: up[0].id, offset: 0.5, width: 2, depth: 1 }] }],
    foundation: { type: "platea" }, roof: { type: "dos_aguas", slope: 30, overhang: 0.3 }
  });
  const sheets = sheetsOf(q);
  clean(sheets);
  assert.ok(sheets.find((s) => s.id === "techos").svg.includes("TERRAZA"));
  assert.ok(sheets.find((s) => s.id === "planta-1").svg.includes("BALCÓN"));
  assert.deepEqual(sheetsOf(normalizeProject({ levels: [{ walls: [] }] })), []);
});
