import test from "node:test";
import assert from "node:assert/strict";

import {
  calculateProject,
  consolidateMaterials,
  consolidatedMaterialsToCsv,
  materialsToCsv
} from "./calculator.js";

test("calculateProject returns a coherent material list", () => {
  const result = calculateProject({
    projectName: "Modulo test",
    spaceType: "vivienda",
    quantity: 2,
    width: 3,
    length: 6,
    height: 2.6,
    floorSpacing: 0.4,
    wallSpacing: 0.4,
    roofSpacing: 0.4,
    roofOverhang: 0.25,
    panelArea: 2.98,
    wasteFactor: 8,
    windowCount: 4,
    windowWidth: 1.2,
    windowHeight: 1,
    doorCount: 1,
    doorWidth: 0.9,
    doorHeight: 2.1
  });

  assert.equal(result.totals.area, 36);
  assert.equal(result.totals.items, 24);
  assert.ok(result.totals.panelUnits > 0);
  assert.ok(result.totals.claddingUnits > 0);
  assert.equal(result.costs.laborCostPerModule, 1080000);
  assert.equal(result.costs.laborCostTotal, 2160000);
  assert.ok(result.materials.every((item) => item.quantity > 0));
  assert.equal(result.system.label, "Estructura metálica");
  assert.equal(result.system.mainFrameSection, "100x100x3.2");
  assert.ok(
    result.materials.some((item) =>
      item.material.includes("Perfil estructural para viguetas")
    )
  );
  assert.ok(
    result.materials.some((item) =>
      item.material.includes("Bastidor principal 100x100x3.2")
    )
  );
  assert.equal(result.derived.floorJoistsPerModule, 16);
  assert.equal(result.derived.floorJoistSpan, 3);
  assert.equal(result.derived.mainCubeFrameLength, 46.4);
  assert.ok(result.totals.profileUnits > 0);
  assert.ok(
    result.materials.some((item) => item.unit === "ml" && item.profileCount !== null)
  );
  assert.ok(result.materials.some((item) => item.scope === "Cerramiento"));
  assert.ok(
    result.materials.some((item) =>
      item.material.includes("refuerzos de aberturas")
    )
  );
});

test("materialsToCsv exports header and rows", () => {
  const result = calculateProject({
    projectName: "CSV test",
    spaceType: "bano",
    quantity: 1,
    width: 2.4,
    length: 3,
    height: 2.5,
    floorSpacing: 0.4,
    wallSpacing: 0.4,
    roofSpacing: 0.4,
    roofOverhang: 0.15,
    panelArea: 2.98,
    wasteFactor: 10,
    windowCount: 1,
    windowWidth: 0.6,
    windowHeight: 0.6,
    doorCount: 1,
    doorWidth: 0.8,
    doorHeight: 2
  });

  const csv = materialsToCsv(result);
  assert.ok(
    csv.startsWith("\"Tipo\",\"Rubro\",\"Material\",\"Unidad\",\"Cantidad\",\"Perfiles\",\"Detalle\"")
  );
  assert.ok(csv.includes("\"Ventanas\""));
});

test("structural mode filters out complementary estimate items", () => {
  const result = calculateProject({
    projectName: "Estructural",
    spaceType: "vivienda",
    structureType: "wood",
    calculationMode: "structural",
    quantity: 1,
    width: 3,
    length: 6,
    height: 2.6,
    floorSpacing: 0.4,
    wallSpacing: 0.4,
    roofSpacing: 0.4,
    roofOverhang: 0.25,
    panelArea: 2.98,
    wasteFactor: 8,
    windowCount: 4,
    windowWidth: 1.2,
    windowHeight: 1,
    doorCount: 1,
    doorWidth: 0.9,
    doorHeight: 2.1
  });

  assert.ok(result.materials.every((item) => item.scope === "Despiece estructural"));
  assert.equal(result.totals.estimateItems, 0);
});

test("consolidated materials preserve grouped purchase data", () => {
  const result = calculateProject({
    projectName: "Consolidado",
    spaceType: "vivienda",
    structureType: "steel_tube",
    calculationMode: "mixed",
    quantity: 1,
    width: 3,
    length: 6,
    height: 2.6,
    floorSpacing: 0.4,
    wallSpacing: 0.4,
    roofSpacing: 0.4,
    roofOverhang: 0.25,
    panelArea: 2.98,
    stockLength: 6,
    wasteFactor: 8,
    windowCount: 4,
    windowWidth: 1.2,
    windowHeight: 1,
    doorCount: 1,
    doorWidth: 0.9,
    doorHeight: 2.1
  });

  const consolidated = consolidateMaterials(result);
  assert.ok(consolidated.length > 0);
  assert.ok(consolidated.some((item) => item.profileCount !== null));
  assert.ok(
    consolidated.some(
      (item) =>
        item.material.includes("Perfil estructural 100x50x3.2 mm") &&
        item.category.includes("Piso") &&
        item.category.includes("Techo")
    )
  );
  assert.ok(
    consolidated.some((item) => item.material.includes("Chapa senoidal"))
  );

  const csv = consolidatedMaterialsToCsv(result);
  assert.ok(
    csv.startsWith("\"Tipo\",\"Rubro base\",\"Material\",\"Unidad\",\"Total\",\"Perfiles\",\"Detalle\"")
  );
});
