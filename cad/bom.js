// Cómputo de materiales a partir de las piezas generadas.
import {
  AREA_MATERIALS,
  PROFILES,
  REBAR_KG_PER_M,
  REBAR_STOCK,
  SHEETS,
  SYSTEMS,
  profileKgPerMeter,
  profilePaintAreaPerMeter,
  sheetCoverage
} from "./catalog.js";
import { round } from "./geometry.js";
import { doorLeaf } from "./model.js";
import { STAIR_TREADS } from "./stairs.js";
import { resolveMaterial } from "./engineering/data/materials.js";

const n = (v, d = 2) => String(round(v, d)).replace(".", ",");

/**
 * Optimización de cortes (first-fit decreasing) sobre barras de largo "stock".
 * Piezas más largas que la barra se resuelven con barras completas + empalme.
 */
export function optimizeCuts(pieces, stock, kerf = 0.003) {
  const bars = [];
  let splices = 0;
  const queue = [];
  pieces.forEach((piece) => {
    let remaining = piece.length;
    while (remaining > stock + 1e-9) {
      bars.push({ pieces: [{ ...piece, length: stock, spliced: true }], used: stock });
      remaining -= stock;
      splices += 1;
    }
    if (remaining > 1e-6) queue.push({ ...piece, length: remaining });
  });
  queue.sort((a, b) => b.length - a.length);
  const open = [];
  queue.forEach((piece) => {
    const need = piece.length;
    let target = null;
    for (const bar of open) {
      const extra = bar.pieces.length ? kerf : 0;
      if (bar.used + extra + need <= stock + 1e-9) {
        target = bar;
        break;
      }
    }
    if (!target) {
      target = { pieces: [], used: 0 };
      open.push(target);
    }
    target.used += (target.pieces.length ? kerf : 0) + need;
    target.pieces.push(piece);
  });
  const allBars = [...bars, ...open].map((bar) => ({ ...bar, waste: round(stock - bar.used, 3) }));
  const totalLength = pieces.reduce((sum, p) => sum + p.length, 0);
  return {
    bars: allBars,
    barCount: allBars.length,
    splices,
    totalLength,
    wastePercent: allBars.length ? round((1 - totalLength / (allBars.length * stock)) * 100, 1) : 0
  };
}

const sheetsNeeded = (area, sheetId, waste) => Math.ceil((area * (1 + waste)) / sheetCoverage(sheetId));

export function computeBom(project, gen) {
  const s = project.settings;
  const waste = s.wasteFactor / 100;
  const kerf = s.kerf / 1000;
  const system = SYSTEMS[project.system];
  const rows = [];
  const cutLists = [];
  const add = (category, material, unit, quantity, detail, extra = {}) => {
    if (!(quantity > 0)) return;
    rows.push({ category, material, unit, quantity, detail, ...extra });
  };

  // ---------- Fundación ----------
  const t = gen.totals;
  const f = project.foundation;
  if (t.concrete > 0) {
    add("Fundación", "Hormigón H-21", "m³", round(t.concrete * (1 + waste), 2), `${n(t.concrete, 2)} m³ netos + ${s.wasteFactor}% merma`);
  }
  if (t.excavation > 0) add("Fundación", "Excavación", "m³", round(t.excavation, 2), "Volumen bajo nivel de terreno");
  if (t.gravel > 0) add("Fundación", "Base de suelo seleccionado / tosca compactada", "m³", round(t.gravel, 2), "Espesor 10 cm bajo platea");
  if (t.film > 0) add("Fundación", AREA_MATERIALS.film, "m²", Math.ceil(t.film), "Bajo platea con solapes y laterales");
  if (t.meshPanels > 0) add("Fundación", "Malla electrosoldada Q188 (Ø6 c/15) 2,40 × 6,00 m", "u", t.meshPanels, "Incluye 15% de solape");
  Object.entries(t.rebar).forEach(([dia, meters]) => {
    if (meters <= 0) return;
    const m = meters * 1.1;
    add("Fundación", `Acero ADN-420 Ø${dia} mm (barra 12 m)`, "barra", Math.ceil(m / REBAR_STOCK), `${n(m, 1)} m · ${n(m * REBAR_KG_PER_M[dia], 1)} kg (incluye 10% de anclajes y solapes)`, {
      kg: m * REBAR_KG_PER_M[dia]
    });
  });
  if (t.formwork > 0) add("Fundación", "Encofrado (tablas o fenólico)", "m²", round(t.formwork, 2), "Caras sobre nivel de terreno");
  if (t.anchorPlates > 0) add("Fundación", "Placa de anclaje 200 × 200 × 9,5 mm", "u", t.anchorPlates, "Una por columna");
  if (t.anchorBolts > 0) add("Fundación", "Bulón de anclaje Ø12 × 300 mm con tuerca y arandela", "u", t.anchorBolts, "Cuatro por placa");
  if (t.chemicalAnchors > 0) add("Fundación", "Anclaje químico Ø10 para bastidor inferior", "u", t.chemicalAnchors, "Uno cada 1,2 m de perímetro");
  if (t.stackPlates > 0) {
    add("Estructura", "Placa de unión entre niveles 200 × 200 × 9,5 mm", "u", t.stackPlates, "Una por columna de niveles superiores");
    add("Estructura", "Bulón Ø12 × 50 mm grado 8.8 con tuerca y arandela", "u", t.stackPlates * 4, "Cuatro por placa de unión");
  }

  // ---------- Estructura ----------
  const byProfile = new Map();
  gen.members.forEach((m) => {
    if (!byProfile.has(m.profileId)) byProfile.set(m.profileId, []);
    byProfile.get(m.profileId).push({ length: m.cut, group: m.group, id: m.id, key: m.key });
  });
  let steelKg = 0;
  let paintArea = 0;
  byProfile.forEach((pieces, profileId) => {
    const profile = PROFILES[profileId];
    const stock = s.stockLength || profile.stock;
    const result = optimizeCuts(pieces, stock, kerf);
    const kgPerM = profileKgPerMeter(profile, resolveMaterial("steel", project.engineering?.materialOverrides).value);
    const kg = result.barCount * stock * kgPerM;
    steelKg += kg;
    paintArea += result.totalLength * profilePaintAreaPerMeter(profile);
    const groups = [...new Set(pieces.map((p) => p.group))].join(", ");
    add("Estructura", profile.label, "barra", result.barCount, `${pieces.length} piezas · ${n(result.totalLength, 2)} m · ${groups}`, {
      meters: result.totalLength,
      kg,
      stock,
      wastePercent: result.wastePercent
    });
    cutLists.push({ profileId, label: profile.label, stock, ...result });
  });
  const joints = gen.members.length * 2;
  if (system.welded) {
    add("Estructura", "Electrodos E6013 Ø2,5 mm", "kg", Math.ceil(joints * 0.03), `${joints} uniones soldadas estimadas (≈30 g por unión)`);
  }
  if (paintArea > 0) {
    add("Estructura", AREA_MATERIALS.pintura, "l", Math.ceil((paintArea * 2) / 10), `${n(paintArea, 1)} m² de perfil, rendimiento 10 m²/l por mano`);
  }

  // ---------- Piso ----------
  if (t.floorDeckArea > 0) {
    add("Piso", SHEETS[system.sheets.floorDeck].label, "u", sheetsNeeded(t.floorDeckArea, system.sheets.floorDeck, waste), `${n(t.floorDeckArea, 2)} m² de piso`);
    add("Piso", AREA_MATERIALS.aislacion_piso, "m²", Math.ceil(t.floorDeckArea * (1 + waste)), "Entre viguetas");
  }
  if (t.mezzanineDeckArea > 0) {
    add("Entrepiso", SHEETS[system.sheets.floorDeck].label, "u", sheetsNeeded(t.mezzanineDeckArea, system.sheets.floorDeck, waste), `${n(t.mezzanineDeckArea, 2)} m² de entrepiso`);
    add("Entrepiso", "Lana de roca 50 mm (acústica)", "m²", Math.ceil(t.mezzanineDeckArea * (1 + waste)), "Entre viguetas de entrepiso");
    add("Entrepiso", SHEETS.durlock.label, "u", sheetsNeeded(t.mezzanineDeckArea, "durlock", waste), "Cielorraso bajo entrepiso");
  }

  // ---------- Muros ----------
  const ext = gen.wallSummaries.filter((w) => w.type === "exterior");
  const int = gen.wallSummaries.filter((w) => w.type === "interior");
  const extSkin = ext.reduce((sum, w) => sum + w.extArea, 0);
  const extInner = ext.reduce((sum, w) => sum + w.intArea, 0);
  const intFaces = int.reduce((sum, w) => sum + w.faceArea * 2, 0);
  const intCore = int.reduce((sum, w) => sum + w.faceArea, 0);
  if (extSkin > 0) {
    add("Muros", SHEETS[system.sheets.wallSheathing].label, "u", sheetsNeeded(extSkin, system.sheets.wallSheathing, waste), `${n(extSkin, 2)} m² de muro exterior (con hastiales, sin aberturas)`);
    add("Muros", AREA_MATERIALS.barrera_viento, "m²", Math.ceil(extSkin * (1 + waste)), "Cara exterior");
    add("Muros", SHEETS[s.wallExteriorCladding].label, "u", sheetsNeeded(extSkin, s.wallExteriorCladding, waste), "Revestimiento exterior");
  }
  if (extInner > 0) add("Muros", AREA_MATERIALS.aislacion_muro, "m²", Math.ceil((extInner + (s.interiorWallInsulation ? intCore : 0)) * (1 + waste)), s.interiorWallInsulation ? "Muros exteriores e interiores" : "Muros exteriores");
  if (extInner + intFaces > 0) {
    add("Muros", SHEETS[s.wallInteriorLining].label, "u", sheetsNeeded(extInner + intFaces, s.wallInteriorLining, waste), `${n(extInner + intFaces, 2)} m² de cara interior`);
  }

  // ---------- Techo ----------
  if (t.roofArea > 0) {
    add("Techo", SHEETS[system.sheets.roofSheathing].label, "u", sheetsNeeded(t.roofArea, system.sheets.roofSheathing, waste), `${n(t.roofArea, 2)} m² de cubierta${t.levels > 1 ? " (incluye zonas descubiertas de niveles inferiores)" : " (en pendiente, con alero)"}`);
    add("Techo", AREA_MATERIALS.membrana_techo, "m²", Math.ceil(t.roofArea * (1 + waste)), "Bajo cubierta");
    add("Techo", SHEETS[s.roofCladding].label, "u", sheetsNeeded(t.roofArea, s.roofCladding, waste), "Cubierta");
    add("Techo", AREA_MATERIALS.aislacion_techo, "m²", Math.ceil(t.roofCoveredArea * (1 + waste)), "Sobre cielorraso");
  }

  // ---------- Aberturas ----------
  if (t.ceilingArea > 0) {
    add("Cielorraso", SHEETS.durlock.label, "u", sheetsNeeded(t.ceilingArea, "durlock", waste), `${n(t.ceilingArea, 2)} m² netos bajo cubierta; tubos incluidos en estructura y cortes`);
  }
  const openings = new Map();
  project.levels.forEach((level) =>
    level.walls.forEach((w) =>
      w.openings.forEach((o) => {
        const size = `${n(o.width)} × ${n(o.height)} m`;
        const key = o.kind === "door" ? `Puerta ${size} · mano ${doorLeaf(w, o).hand}` : `Ventana ${size}`;
        const entry = openings.get(key) ?? { count: 0, door: o.kind === "door" };
        entry.count += 1;
        openings.set(key, entry);
      })
    )
  );
  openings.forEach(({ count, door }, key) =>
    add("Aberturas", key, "u", count, door ? "Mano vista desde el lado hacia donde abre · marco para perfil C" : "Con marco para fijar al perfil C")
  );

  // ---------- Escaleras ----------
  const stairRows = new Map();
  const addStair = (material, unit, quantity, detail) => {
    const k = `${material}|${unit}`;
    const row = stairRows.get(k) ?? { material, unit, quantity: 0, detail };
    row.quantity += quantity;
    stairRows.set(k, row);
  };
  (gen.stairs ?? []).filter((lay) => lay.solution?.ok && lay.stats).forEach((lay) => {
    const st = lay.stair;
    const t = lay.stats;
    const label = STAIR_TREADS[st.tread] ?? STAIR_TREADS.chapa;
    addStair(`Escalón ${label.toLowerCase()} ${n(st.width)} × ${n(lay.solution.p + 0.03)} m`, "u", t.treads, `Pedada ${n(lay.solution.p)} m + 3 cm de nariz; alzada ${n(lay.solution.a, 3)} m`);
    if (t.landingArea > 0) addStair(`Descanso de ${label.toLowerCase()}`, "m²", t.landingArea, "Superficie de descansos (sobre bastidor de tubos)");
    addStair("Placa de anclaje 150 × 150 × 6,35 mm (zancas y apoyos)", "u", t.basePlates, "Al piso de abajo; 4 anclajes por placa");
    addStair("Anclaje Ø10 mm para placa de zanca o apoyo", "u", t.basePlates * 4, "Cuatro por placa");
    addStair("Planchuela de unión zanca–estructura 100 × 100 × 6,35 mm", "u", t.topPlates, "Llegada de cada zanca al descanso o al borde del hueco");
    if (t.brackets > 0) addStair("Soporte de pasamanos amurado", "u", t.brackets, "Uno cada 1 m como máximo");
    if (st.tread === "madera") addStair("Ángulo de apoyo de escalón 1 1/2\" × 3/16\" (par)", "u", t.treads, "Un par por escalón, soldado a las zancas");
    else addStair("Banda antideslizante para nariz de escalón", "u", t.treads, "Una por escalón");
    if (lay.rules.tactileStrip) addStair("Banda táctil de prevención 0,60 m", "u", t.flights * 2, "Al inicio y al final de cada tramo (Decreto 914/97)");
  });
  stairRows.forEach((r) => add("Escaleras", r.material, r.unit, r.unit === "u" ? Math.ceil(r.quantity) : round(r.quantity * (1 + waste), 2), r.detail));

  // ---------- Fijaciones ----------
  const sheetArea = t.floorDeckArea + t.mezzanineDeckArea * 2 + extSkin * 2 + extInner + intFaces + t.roofArea * 2 + t.ceilingArea;
  if (sheetArea > 0) {
    add("Fijaciones", 'Tornillo autoperforante punta mecha 8 × 1 1/4"', "u", Math.ceil((sheetArea * 15) / 100) * 100, "≈15 por m² de placa y chapa");
  }
  const openingCount = [...openings.values()].reduce((a, b) => a + b.count, 0);
  if (openingCount > 0) add("Fijaciones", "Espuma de poliuretano + sellador MS", "u", openingCount * 2, "Dos por abertura");

  const concreteRebarKg = rows.filter((r) => r.category === "Fundación" && r.kg).reduce((sum, r) => sum + r.kg, 0);
  const structuralBars = rows.filter((r) => r.category === "Estructura" && r.unit === "barra").reduce((sum, r) => sum + r.quantity, 0);

  return {
    rows,
    cutLists,
    summary: {
      footprintArea: round(t.footprintArea, 2),
      coveredArea: round(t.coveredArea, 2),
      levels: t.levels,
      roofArea: round(t.roofArea, 2),
      wallArea: round(extSkin, 2),
      steelKg: round(steelKg, 0),
      rebarKg: round(concreteRebarKg, 0),
      concrete: round(t.concrete, 2),
      structuralBars,
      pieces: gen.members.length,
      columns: t.columns
    }
  };
}

export function bomToCsv(project, bom, prices = {}) {
  const header = ["Rubro", "Material", "Unidad", "Cantidad", "Precio unitario", "Subtotal", "Detalle"];
  const lines = bom.rows.map((r) => {
    const price = Number(prices[r.material]) || 0;
    return [r.category, r.material, r.unit, r.quantity, price || "", price ? round(price * r.quantity, 2) : "", r.detail];
  });
  return [header, ...lines]
    .map((row) => row.map((v) => `"${String(v ?? "").replaceAll('"', '""')}"`).join(";"))
    .join("\n");
}

export function cutListToCsv(bom) {
  const header = ["Perfil", "Barra", "Piezas (m)", "Sobrante (m)"];
  const lines = [];
  bom.cutLists.forEach((list) => {
    list.bars.forEach((bar, i) => {
      lines.push([list.label, i + 1, bar.pieces.map((p) => p.length.toFixed(3)).join(" + "), bar.waste.toFixed(3)]);
    });
  });
  return [header, ...lines].map((row) => row.map((v) => `"${String(v).replaceAll('"', '""')}"`).join(";")).join("\n");
}
