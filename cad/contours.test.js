import test from "node:test";
import assert from "node:assert/strict";
import { copyContour, createDefaultProject, createLevel, createRectangle, findFootprint, placeBalcony } from "./model.js";
import { polygonArea } from "./geometry.js";
import { generate } from "./generator.js";
import { computeBom } from "./bom.js";
import { runEngineering } from "./engineering/engine.js";

/** Proyecto con un segundo módulo, conservando las carpinterías del primero. */
function twoModules(x = 8, y = 0) {
  const project = createDefaultProject();
  const added = createRectangle(x, y, 3, 3);
  project.levels[0].walls.push(...added);
  return { project, added };
}

/** Cada pieza y superficie aporta al cálculo una sola identidad. */
function uniqueGeneration(gen) {
  for (const collection of [gen.members, gen.surfaces, gen.solids]) {
    assert.equal(new Set(collection.map(piece => piece.key)).size, collection.length);
  }
  const columns = gen.members.filter(m => m.role === "column");
  assert.equal(new Set(columns.map(m => `${m.level}:${m.a.join(",")}`)).size, columns.length);
}

test("dos estructuras separadas reciben piso, techo y fundación sin cubrir el espacio entre ellas", () => {
  const { project } = twoModules(), gen = generate(project);
  assert.equal(gen.totals.footprintArea, 27);
  assert.equal(gen.totals.floorDeckArea, 27);
  assert.deepEqual(gen.levels[0].footprints.map(polygonArea), [18, 9]);
  assert.equal(gen.surfaces.filter(s => s.material === "piso").length, 2);
  assert.equal(gen.surfaces.filter(s => s.material === "cubierta").length, 2);
  assert.equal(gen.totals.anchorPlates, 10);
  const second = gen.surfaces.find(s => s.material === "piso" && s.region === 1);
  assert.ok(second.points.every(p => p[0] >= 8 && p[0] <= 11));
  assert.ok(computeBom(project, gen).rows.some(row => row.category === "Piso"));
  uniqueGeneration(gen);
});

test("módulos pegados: 27 m², un solo muro compartido y todas las aberturas conservadas", () => {
  const { project } = twoModules(6), source = JSON.stringify(project), gen = generate(project);
  assert.equal(gen.totals.floorDeckArea, 27);
  assert.equal(gen.surfaces.filter(s => s.material === "piso").length, 1);
  const shared = gen.effectiveWalls[0].filter(w => w.a.x === 6 && w.b.x === 6);
  assert.equal(shared.length, 1);
  assert.equal(shared[0].type, "interior");
  assert.equal(gen.effectiveWalls[0].flatMap(w => w.openings).length, 5);
  assert.equal(JSON.stringify(project), source);
  uniqueGeneration(gen);
});

test("rectángulos superpuestos computan su unión de 21 m² sin duplicar piso ni cubierta", () => {
  const { project } = twoModules(4), gen = generate(project);
  assert.equal(gen.totals.floorDeckArea, 21);
  assert.equal(gen.totals.coveredArea, 21);
  assert.ok(Math.abs(gen.totals.roofPlanArea - 26.25) < 1e-8);
  uniqueGeneration(gen);
});

test("dibujar dos veces el mismo módulo conserva las cantidades y el peso instalado", () => {
  const project = createDefaultProject(), before = generate(project), original = structuredClone(project);
  project.levels[0].walls.push(...createRectangle(0, 0, 6, 3));
  const after = generate(project);
  assert.equal(after.members.length, before.members.length);
  assert.equal(after.surfaces.length, before.surfaces.length);
  assert.equal(after.totals.floorDeckArea, 18);
  const base = runEngineering(original, before, { analyze: false });
  const result = runEngineering(project, after, { analyze: false });
  assert.ok(Math.abs(result.totals.total_N - base.totals.total_N) < 1e-7);
  uniqueGeneration(after);
});

test("balcón del segundo módulo sale hacia afuera y comparte la operación del inspector", () => {
  const { project, added } = twoModules();
  const balcony = placeBalcony(project.levels[0], added[0].id, 1.5);
  assert.equal(project.levels[0].balconies.length, 1);
  assert.equal(balcony.width, 2.4);
  const gen = generate(project), deck = gen.surfaces.find(s => s.material === "balcon");
  assert.ok(deck.points.every(p => p[0] >= 8 && p[0] <= 11 && p[1] <= 1e-9));
  assert.ok(deck.points.some(p => p[1] < -1));
  assert.equal(gen.levels[0].balconies.length, 1);
  uniqueGeneration(gen);
});

test("equipos sobre el segundo piso aportan su fuerza una vez; el análisis independiente queda explícito", () => {
  const { project } = twoModules();
  const before = runEngineering(project, generate(project), { analyze: false });
  project.engineering.extraLoads.push({ id: "test-equipo", levelId: project.levels[0].id, target: "floor", x_m: 9.5, y_m: 1.5, force_N: 1000, label: "Equipo", source: "Prueba", confirmed: true });
  const result = runEngineering(project, generate(project));
  assert.ok(Math.abs(result.totals.superstructure_N - before.totals.superstructure_N - 1000) < 1e-7);
  assert.equal(result.entries.filter(r => r.kind === "extra").length, 1);
  assert.equal(result.analysis.status, "unsupported");
  assert.equal(result.analysis.caseResponses.length, 0);
  assert.ok(result.analysis.issues.some(s => s.includes("estructuras independientes")));
});

test("un contorno abierto no borra sus muros ni bloquea el piso de otro contorno cerrado", () => {
  const { project } = twoModules(); project.levels[0].walls.splice(3, 1);
  const footprint = findFootprint(project.levels[0].walls), gen = generate(project);
  assert.equal(footprint.closed, false);
  assert.equal(gen.totals.floorDeckArea, 9);
  assert.ok(gen.members.some(m => m.wallId === project.levels[0].walls[0].id));
  assert.ok(gen.warnings.some(s => s.includes("contorno abierto")));
  assert.equal(runEngineering(project, gen).analysis.status, "unsupported");
  uniqueGeneration(gen);
});

test("varios módulos apilados tienen un entrepiso por contorno y techo solo donde quedan libres", () => {
  const { project } = twoModules();
  project.levels.push(createLevel(1, copyContour(project.levels[0].walls)));
  const gen = generate(project);
  assert.equal(gen.totals.coveredArea, 54);
  assert.equal(gen.totals.floorDeckArea, 27);
  assert.equal(gen.totals.mezzanineDeckArea, 27);
  assert.equal(gen.surfaces.filter(s => s.material === "cubierta" && s.level === 0).length, 0);
  assert.equal(gen.surfaces.filter(s => s.material === "cubierta" && s.level === 1).length, 2);
  uniqueGeneration(gen);
});

test("dos módulos superiores pequeños dejan 28 m² descubiertos sin duplicar los paños de abajo", () => {
  const project = createDefaultProject();
  project.levels[0].walls = createRectangle(0, 0, 6, 6);
  project.levels.push(createLevel(1, [...createRectangle(0, 0, 2, 2), ...createRectangle(4, 4, 2, 2)]));
  const gen = generate(project);
  assert.equal(gen.totals.coveredArea, 44);
  assert.ok(Math.abs(gen.levels[0].exposed.reduce((sum, part) => sum + part.area, 0) - 28) < 1e-8);
  assert.equal(gen.totals.roofCoveredArea, 36);
  uniqueGeneration(gen);
});

test("dados, pilotines y plateas computan las dos estructuras con volumen igual a la suma separada", () => {
  for (const type of ["dados", "vigas_pilotines", "platea"]) {
    const { project } = twoModules();
    project.foundation = { ...project.foundation, type, ...(type === "platea" ? { slabThickness: 0.12, edgeBeamWidth: 0.2, edgeBeamHeight: 0.3, margin: 0.15 } : type === "vigas_pilotines" ? { beamWidth: 0.2, beamHeight: 0.3, pileDiameter: 0.2, pileDepth: 1, pileSpacing: 2 } : {}) };
    const combined = generate(project);
    const volume = [project.levels[0].walls.slice(0, 4), project.levels[0].walls.slice(4)].reduce((sum, walls) => sum + generate({ ...project, levels: [{ ...project.levels[0], walls }] }).totals.concrete, 0);
    assert.ok(Math.abs(combined.totals.concrete - volume) < 1e-8, type);
    uniqueGeneration(combined);
  }
});
