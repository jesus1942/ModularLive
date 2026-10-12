import { area3D, bbox, pointInPolygon, polygonArea } from "../geometry.js";
import { KZ_TABLES, WIND_IMPORTANCE_2005, ROOF_CP, CC_WALL, CC_ROOF_2025, CC_ROOF_2005, SOURCES } from "./data/reglamentos.js";
import { areaCenter_m, normal3D, split3D, actionResultant } from "./load-geometry.js";

const dirs = [{ id: "+X", axis: 0, sign: 1 }, { id: "-X", axis: 0, sign: -1 }, { id: "+Y", axis: 1, sign: 1 }, { id: "-Y", axis: 1, sign: -1 }];
const mix = (a, b, t) => a + (b - a) * t;

/** Interpolación lineal tabulada con extremos constantes (sin extrapolaciones). */
export function interpolateTable(rows, value) {
  if (value <= rows[0][0]) return rows[0][1];
  for (let i = 1; i < rows.length; i += 1) if (value <= rows[i][0]) {
    return mix(rows[i - 1][1], rows[i][1], (value - rows[i - 1][0]) / (rows[i][0] - rows[i - 1][0]));
  }
  return rows.at(-1)[1];
}

/** Kz adimensional; Tablas 1.13-1 (2025) y 5 (2005), interpolación permitida. z en m. */
export function exposureKz(edition, exposure, z_m, components = false) {
  const rows = KZ_TABLES[edition];
  if (!rows || !["B", "C", "D"].includes(exposure) || !Number.isFinite(z_m) || z_m < 0 || z_m > 20) throw new RangeError("Kz: edición/exposición inválida o z fuera de 0–20 m.");
  const index = { B: 1, C: 2, D: 3 }[exposure];
  const kz = interpolateTable(rows.map((r) => [r[0], r[index]]), z_m);
  return edition === "2005" && components && exposure === "B" ? Math.max(.72, kz) : kz;
}

/** qz en Pa. 2025 §1.13-1 usa Ke (se adopta 1 permitido); 2005 ec.(13) usa I. */
export function dynamicPressure({ edition = "2025", V_m_s, exposure = "C", z_m = 5, Kzt = 1, importance = "II", components = false, Kz }) {
  if (![V_m_s, Kzt, z_m].every(Number.isFinite) || V_m_s <= 0 || Kzt <= 0) throw new RangeError("Presión dinámica: entradas inválidas.");
  const kz = Kz ?? exposureKz(edition, exposure, z_m, components);
  const I = edition === "2005" ? WIND_IMPORTANCE_2005[importance] : 1;
  if (!Number.isFinite(kz) || kz <= 0 || !I) throw new RangeError("Presión dinámica: coeficiente inválido.");
  return { qz_Pa: .613 * kz * Kzt * .85 * V_m_s ** 2 * I, Kz: kz, Kzt, Kd: .85, Ke: edition === "2025" ? 1 : null, I: edition === "2005" ? I : null,
    V_m_s, z_m, formula: edition === "2025" ? "qz = 0,613 Kz Kzt Kd Ke V²" : "qz = 0,613 Kz Kzt Kd V² I", reference: edition === "2025" ? "102-25 §1.13.2 ec.1.13-1;Ke=1 §1.12" : "102-05 §5.10 ec.13;Tabla5" };
}

/** Cp para paredes, interpolando L/B en sotavento; ambas ediciones Fig.2.4-1/Fig.3. */
export function wallCp(face, ratio) {
  return face === "barlovento" ? .8 : face === "lateral" ? -.7 : interpolateTable([[1, -.5], [2, -.3], [4, -.2]], ratio);
}

/** Cp de cubierta direccional. Distancia d desde barlovento, h y L en m, θ en grados. */
export function roofCp({ theta_deg, parallel, face, h_m, L_m, distance_m, branch = "succion" }) {
  const ratio = h_m / L_m;
  if (theta_deg < 10 || parallel) {
    if (branch === "alternativa") return -.18;
    const low = distance_m < h_m ? -.9 : distance_m < 2 * h_m ? -.5 : -.3;
    const high = distance_m < h_m / 2 ? -1.3 : -.7;
    return mix(low, high, Math.max(0, Math.min(1, (ratio - .5) / .5)));
  }
  const values = face === "sotavento" ? ROOF_CP.leeward : branch === "succion" ? ROOF_CP.windwardNegative : ROOF_CP.windwardPositive;
  const atRatio = values.map((row, i) => [ROOF_CP.ratios[i], interpolateTable(row.map((v, j) => [ROOF_CP.angles_deg[j], v]), theta_deg)]);
  return interpolateTable(atRatio, ratio);
}

/** Evalúa abertura dominante con la geometría: Ao, Aoi, Ag, Agi (m²), 102-25 §1.10. */
export function dominantOpening(Ao_m2, Aoi_m2, Ag_m2, Agi_m2) {
  return Ao_m2 > 1.1 * Aoi_m2 && Ao_m2 > Math.min(.4, .01 * Ag_m2) && Agi_m2 > 0 && Aoi_m2 / Agi_m2 <= .2;
}

/** Interpola los extremos de una curva GCp con escala log10(A), A en m². */
export function curveGCp(curve, area_m2) {
  if (!(area_m2 > 0)) throw new RangeError("Área efectiva de viento debe ser positiva.");
  return interpolateTable(curve.map(([a, c]) => [Math.log10(a), c]), Math.log10(area_m2));
}



/** GCp local por edición, forma, pendiente, zona y área efectiva; null indica fuera de alcance. */
export function componentGCp({ edition, roofType, theta_deg, zone, area_m2, eave = false, positive = false }) {
  if (["4", "5"].includes(zone)) return curveGCp(CC_WALL[positive ? "positive" : zone], area_m2);
  const mono = roofType !== "dos_aguas";
  let table;
  if (edition === "2005") {
    // Las curvas de vertiente única 7A son las mismas que 5.3-5A/B de 2025.
    table = mono && theta_deg > 3 ? (theta_deg <= 10 ? CC_ROOF_2025.mono10 : theta_deg <= 30 ? CC_ROOF_2025.mono30 : null)
      : theta_deg <= 10 ? CC_ROOF_2005.flat : theta_deg <= 30 ? CC_ROOF_2005.gable30 : theta_deg <= 45 ? CC_ROOF_2005.gable45 : null;
  } else {
    table = mono && theta_deg > 3 ? (theta_deg <= 10 ? CC_ROOF_2025.mono10 : theta_deg <= 30 ? CC_ROOF_2025.mono30 : null)
      : theta_deg <= 7 ? CC_ROOF_2025.flat : theta_deg <= 20 ? CC_ROOF_2025.gable20 : theta_deg <= 27 ? CC_ROOF_2025.gable27 : theta_deg <= 45 ? CC_ROOF_2025.gable45 : null;
  }
  if (!table) return null;
  if (edition === "2025" && !mono && theta_deg > 27 && theta_deg < 45 && !eave) {
    const key = positive ? "positive" : zone;
    return mix(curveGCp(CC_ROOF_2025.gable27[key], area_m2), curveGCp(CC_ROOF_2025.gable45[key], area_m2), (theta_deg - 27) / 18);
  }
  // Sobre alero inclinado sin curva neta tabulada se usa techo + underside GCp=0,85×0,8,
  // como envolvente adicional conservadora declarada; no se lo etiqueta coeficiente normativo local.
  const curve = positive ? table.positive : eave && table.eave ? table.eave[zone] : table[zone] ?? table["3"];
  const c = curveGCp(curve, area_m2);
  return eave && !table.eave && !positive ? c - .85 * .8 : c;
}

function envelopeNormal(surface, level) {
  let n = normal3D(surface.points);
  if (surface.material === "cubierta") return n[2] < 0 ? n.map((v) => -v) : n;
  const p = areaCenter_m(surface.points);
  if (level.footprint && pointInPolygon({ x: p[0] + n[0] * .02, y: p[1] + n[1] * .02 }, level.footprint)) n = n.map((v) => -v);
  return n;
}

function patchAction(sf, points, n, pressure_Pa, data) {
  const area_m2 = area3D(points);
  return { id: data.id, surfaceKey: sf.key, level: sf.level, kind: sf.material === "cubierta" ? "roof" : "wall", points, normal: n, area_m2,
    point_m: areaCenter_m(points), pressure_Pa, force_N: n.map((v) => -pressure_Pa * area_m2 * v), ...data };
}

function zoneWidth(bb, h) { return Math.max(1, .04 * Math.min(bb.maxX - bb.minX, bb.maxY - bb.minY), Math.min(.1 * Math.min(bb.maxX - bb.minX, bb.maxY - bb.minY), .4 * h)); }

function roofZone(e, bb, point, h, theta, type, spanAxis) {
  const dx = Math.min(point[0] - bb.minX, bb.maxX - point[0]), dy = Math.min(point[1] - bb.minY, bb.maxY - point[1]);
  const flat = type === "dos_aguas" ? theta <= (e === "2025" ? 7 : 10) : theta <= 3;
  if (flat && e === "2025") {
    if ((dx < .2 * h && dy < .6 * h) || (dy < .2 * h && dx < .6 * h)) return "3";
    if (Math.min(dx, dy) < .6 * h) return "2";
    if (Math.min(dx, dy) < 1.2 * h) return "1";
    return "1p";
  }
  const a = zoneWidth(bb, h);
  if (!flat && type !== "dos_aguas") {
    const cross = spanAxis === "x" ? dx : dy, along = spanAxis === "x" ? dy : dx;
    const u = spanAxis === "x" ? point[0] : point[1], umin = spanAxis === "x" ? bb.minX : bb.minY, umax = spanAxis === "x" ? bb.maxX : bb.maxY;
    const high = umax - u < 2 * a, low = u - umin < (theta <= 10 ? 2 * a : a);
    if (high && along < 4 * a) return theta <= 10 ? "3p" : "3";
    if (low && along < 2 * a && theta <= 10) return "3";
    if (along < a) return theta <= 10 ? "2p" : "2";
    if (high || low) return "2";
    return "1";
  }
  // Cubiertas a dos aguas: cumbrera con franjas a ambos lados; esquinas en extremos.
  const ridgeDistance = !flat && type === "dos_aguas" ? Math.abs(point[spanAxis === "x" ? 0 : 1] - (spanAxis === "x" ? (bb.minX + bb.maxX) / 2 : (bb.minY + bb.maxY) / 2)) : Infinity;
  if (dx < a && dy < a || ridgeDistance < a && (spanAxis === "x" ? dy : dx) < a) return "3";
  return Math.min(dx, dy, ridgeDistance) < a ? "2" : "1";
}

/** Resuelve parches de un caso principal, sus escalas y envolvente diagonal sin duplicar datos. */
export function windCasePatches(wind, caseId) {
  const c = wind.cases.find((v) => v.id === caseId);
  if (!c) return [];
  if (c.patches) return c.patches;
  const bases = c.baseIds.map((id) => wind.cases.find((b) => b.id === id));
  if (bases.length === 1) return bases[0].patches.map((p) => ({ ...p, pressure_Pa: p.pressure_Pa * c.scale, force_N: p.force_N.map((v) => v * c.scale) }));
  const roofs = new Map();
  const walls = [];
  bases.forEach((base) => base.patches.forEach((p) => {
    if (p.kind === "roof") {
      const current = roofs.get(p.id);
      const severe = !current || (c.branch === "succion" ? p.pressure_Pa < current.pressure_Pa : p.pressure_Pa > current.pressure_Pa);
      if (severe) roofs.set(p.id, p);
    } else if (Math.abs(p.normal[base.axis]) > .99) walls.push({ ...p, pressure_Pa: p.pressure_Pa * c.scale, force_N: p.force_N.map((v) => v * c.scale) });
  }));
  return [...walls, ...[...roofs.values()].map((p) => ({ ...p, pressure_Pa: p.pressure_Pa * c.roofScale, force_N: p.force_N.map((v) => v * c.roofScale) }))];
}

/** Viento de edificio regular ≤20 m: cuatro sentidos, GCpi±, Cp alternativos, torsión y C&R. */
export function computeWind(project, gen, e) {
  const edition = e.codeEdition, source = SOURCES[`wind${edition}`];
  const issues = [], assumptions = [], cases = [], components = [];
  const envelope = gen.surfaces.filter((sf) => ["exterior", "cubierta"].includes(sf.material) && gen.levels[sf.level]?.footprint);
  if (gen.levels.some((lv) => !lv.footprint)) issues.push("Viento: se omiten niveles sin contorno cerrado; sus presiones no se pudieron determinar.");
  const height = Math.max(0, ...envelope.flatMap((s) => s.points.map((p) => p[2])));
  const result = { edition, riskCategory: e.importance, source, height_m: height, cases, components, assumptions, issues, status: "review", scope: "Edificio regular, rectangular, rígido supuesto y altura ≤20 m. Presiones normales a la envolvente bruta; sin resguardo entre niveles." };
  if (!envelope.length || height <= 0 || height > 20) { issues.push("Viento sin calcular: falta envolvente o la altura excede 20 m del alcance implementado."); return result; }
  const footprints = gen.levels.filter((lv) => lv.footprint);
  if (footprints.some((lv) => Math.abs(Math.abs(polygonArea(lv.footprint)) - (bbox(lv.footprint).maxX - bbox(lv.footprint).minX) * (bbox(lv.footprint).maxY - bbox(lv.footprint).minY)) > .01)) issues.push("Planta irregular: zonas de viento aproximadas por caja envolvente; requiere estudio de forma y túnel de viento cuando corresponda.");
  if (gen.levels.length > 1) issues.push("Niveles escalonados: no se descuenta resguardo. Interferencia aerodinámica y presiones en escalones requieren revisión específica.");
  assumptions.push({ id: "wind:rigid", scope: "viento", message: "G=0,85 supone estructura rígida (102-25 §1.9.4 / 102-05 §5.8.1). La frecuencia y el sistema lateral aún no están verificados." },
    { id: "wind:envelope", scope: "viento", message: "Se aplica presión a la envolvente bruta de fachadas, incluyendo carpinterías, como cota conservadora cuando hay apertura potencial. No se descuenta superficie abierta ni se supone protección de vidrios." });
  if (!e.wind.serviceConfirmed) assumptions.push({ id: "wind:service", scope: "servicio", message: `Vserv=${e.wind.serviceV_m_s} m/s supuesto; Wa=W(Vserv/V)² es un escenario, no una lectura del mapa de servicio. 102-25 B.4.2.` });
  const q = (z, cc = false) => dynamicPressure({ edition, V_m_s: e.location.V, exposure: e.location.exposure, z_m: Math.max(0, Math.min(20, z)), Kzt: e.location.Kzt, importance: e.importance, components: cc });
  const zones = envelope.map((sf, si) => {
    const lv = gen.levels[sf.level], bb = bbox(lv.footprint), n = envelopeNormal(sf, lv);
    const outlinePoints = envelope.filter((s) => s.level === sf.level && s.material === "cubierta").flatMap((s) => s.points.map((p) => ({ x: p[0], y: p[1] })));
    const outer = outlinePoints.length ? bbox(outlinePoints) : bb;
    const zlo = Math.min(...sf.points.map((p) => p[2])), zhi = Math.max(...sf.points.map((p) => p[2]));
    const theta = sf.material === "cubierta" ? Math.acos(Math.min(1, Math.abs(n[2]))) * 180 / Math.PI : 0;
    // Baja pendiente: h en alero; para >10° altura media, 102 definición de h.
    const h = theta <= 10 ? zlo : (zlo + zhi) / 2;
    const a = zoneWidth(bb, h);
    let cuts;
    if (sf.material === "cubierta") {
      cuts = [0, 1].map((axis) => {
        const min = axis === 0 ? bb.minX : bb.minY, max = axis === 0 ? bb.maxX : bb.maxY;
        const omin = axis === 0 ? outer.minX : outer.minY, omax = axis === 0 ? outer.maxX : outer.maxY;
        const flat = project.roof.type === "dos_aguas" ? theta <= (edition === "2025" ? 7 : 10) : theta <= 3;
        const ccDistances = flat && edition === "2025" ? [.2 * h, .6 * h, 1.2 * h] : project.roof.type === "dos_aguas" || flat ? [a] : [a, 2 * a, 4 * a];
        const ridgeCuts = !flat && project.roof.type === "dos_aguas" && axis === (lv.spanAxis === "x" ? 0 : 1) ? [(min + max) / 2 - a, (min + max) / 2 + a] : [];
        return [min, max, ...ridgeCuts, ...[h / 2, h, 2 * h].flatMap((d) => [min + d, max - d]), ...ccDistances.flatMap((d) => [omin + d, omax - d])].filter((v) => v > omin && v < omax);
      });
    } else {
      cuts = [[bb.minX + a, bb.maxX - a], [bb.minY + a, bb.maxY - a], [5, 10, 15]];
    }
    const patches = split3D(sf.points, cuts).map((points, pi) => ({ id: `wind:${si}:${pi}`, points, center: areaCenter_m(points) }));
    return { sf, lv, bb, outer, n, theta, h, a, patches };
  });
  const roofHeights = zones.filter((z) => z.sf.material === "cubierta").map((z) => z.h);
  const globalH = roofHeights.length ? Math.max(...roofHeights) : height;
  result.referencePressure = q(globalH);
  const wallAreas = new Map();
  envelope.filter((s) => s.material === "exterior").forEach((sf) => wallAreas.set(sf.wallId, (wallAreas.get(sf.wallId) ?? 0) + area3D(sf.points)));
  const totalWalls = [...wallAreas.values()].reduce((a, b) => a + b, 0);
  const openingRows = project.levels.flatMap((l) => l.walls.filter((w) => w.type === "exterior").map((w) => ({ wallId: w.id, area_m2: w.openings.reduce((s, o) => s + o.width * o.height, 0) })));
  const totalOpenings = openingRows.reduce((s, r) => s + r.area_m2, 0);
  result.openingChecks = openingRows.map((r) => {
    const Ag = wallAreas.get(r.wallId) ?? 0, Aoi = totalOpenings - r.area_m2, Agi = totalWalls - Ag + gen.totals.roofPlanArea;
    const simultaneousDominant = dominantOpening(r.area_m2, Aoi, Ag, Agi);
    const isolatedDominant = dominantOpening(r.area_m2, 0, Ag, Agi);
    return { ...r, Ag_m2: Ag, Aoi_m2: Aoi, Agi_m2: Agi, simultaneousDominant, isolatedDominant, dominant: simultaneousDominant || isolatedDominant };
  });
  const hasDominant = result.openingChecks.some((r) => r.dominant);
  result.GCpi = e.wind.enclosure === "partial" || e.wind.enclosure === "potential" && hasDominant ? .55 : .18;
  result.enclosure = result.GCpi === .55 ? "parcialmente cerrado" : "cerrado / parcialmente abierto";
  assumptions.push({ id: "wind:opening", scope: "viento", message: `${result.enclosure}, GCpi=±${result.GCpi}. ${e.wind.enclosure === "potential" ? "Se evalúa apertura potencial de cada fachada con las demás cerradas y apertura simultánea. No se usa la aparente compensación de ventanas en caras opuestas; confirmar estado y protección." : "Clasificación ingresada: confirmar estado de puertas y ventanas."}` });

  for (const dir of dirs) for (const internalSign of [-1, 1]) for (const branch of ["succion", "alternativa"]) {
    const patches = [];
    for (const z of zones) {
      const { sf, lv, bb, n, theta, h } = z;
      const min = dir.axis === 0 ? bb.minX : bb.minY, max = dir.axis === 0 ? bb.maxX : bb.maxY;
      const L = max - min, B = dir.axis === 0 ? bb.maxY - bb.minY : bb.maxX - bb.minX;
      for (const patch of z.patches) {
        const dot = n[dir.axis] * dir.sign;
        const face = sf.material === "cubierta" ? dot < -1e-8 ? "barlovento" : "sotavento" : dot < -.1 ? "barlovento" : dot > .1 ? "sotavento" : "lateral";
        const eave = sf.material === "cubierta" && !pointInPolygon({ x: patch.center[0], y: patch.center[1] }, lv.footprint);
        const distance = dir.sign > 0 ? patch.center[dir.axis] - min : max - patch.center[dir.axis];
        const Cp = sf.material === "cubierta" ? roofCp({ theta_deg: theta, parallel: dir.axis !== (lv.spanAxis === "x" ? 0 : 1), face, h_m: h, L_m: L, distance_m: Math.max(0, distance), branch }) : wallCp(face, L / B);
        const qh = q(globalH).qz_Pa, qz = sf.material === "exterior" && face === "barlovento" ? q(patch.center[2]).qz_Pa : qh;
        // Alero abierto: GCpi no actúa; la presión inferior +0,8 se resta del Cp superior.
        const pressure = eave ? qh * .85 * (Cp - .8) : qz * .85 * Cp - qh * result.GCpi * internalSign;
        patches.push(patchAction(sf, patch.points, n, pressure, { id: patch.id, zone: eave ? `alero ${face}` : face, Cp, G: .85, GCpi: eave ? 0 : result.GCpi * internalSign, qz_Pa: qz, qh_Pa: qh, eave,
          reference: edition === "2025" ? "102-25 §2.4.1;Fig.2.4-1;alero §2.4.4" : "102-05 §5.11.1;Fig.3;alero §5.11.4" }));
      }
    }
    const c = { id: `W:${dir.id}:i${internalSign}:${branch}:1`, kind: "W", direction: dir.id, axis: dir.axis, sign: dir.sign, internalSign, branch, torsionCase: 1, patches, label: `${dir.id} · GCpi ${internalSign > 0 ? "+" : "−"} · ${branch} · caso 1` };
    // Fig.2.4-1 nota 7 / Fig.3 nota 6: el techo no puede reducir el corte de paredes.
    // Se agrega la diferencia como fuerza horizontal al diafragma, conservando presión normal.
    const pointEntries = [];
    gen.levels.forEach((lv) => {
      const wallForce = patches.filter((p) => p.level === lv.index && p.kind === "wall").reduce((s, p) => s + p.force_N[dir.axis], 0);
      const totalForce = patches.filter((p) => p.level === lv.index).reduce((s, p) => s + p.force_N[dir.axis], 0);
      if (dir.sign * totalForce < dir.sign * wallForce) {
        const force_N = [0, 0, 0]; force_N[dir.axis] = wallForce - totalForce;
        const bb = lv.footprint ? bbox(lv.footprint) : { minX: 0, maxX: 0, minY: 0, maxY: 0 };
        pointEntries.push({ id: `${c.id}:corte-minimo:${lv.index}`, level: lv.index, force_N, point_m: [(bb.minX + bb.maxX) / 2, (bb.minY + bb.maxY) / 2, lv.zTop], reference: edition === "2025" ? "102-25 Fig.2.4-1 nota7" : "102-05 Fig.3 nota6" });
      }
    });
    c.pointEntries = pointEntries;
    Object.assign(c, actionResultant([...patches, ...pointEntries])); cases.push(c);
  }
  if (edition === "2025") {
    const bases = [...cases];
    const addDerived = (c, signs) => {
      const patches = windCasePatches({ cases: [...cases, c] }, c.id);
      const entries = [...patches];
      c.pointEntries = [];
      c.baseIds.forEach((id) => {
        const base = bases.find((b) => b.id === id);
        (base.pointEntries ?? []).forEach((entry) => {
          const scaled = { ...entry, id: `${c.id}:${entry.id}`, force_N: entry.force_N.map((v) => v * c.scale) };
          c.pointEntries.push(scaled); entries.push(scaled);
        });
      });
      c.couples = [];
      for (const [i, id] of c.baseIds.entries()) {
        const base = bases.find((b) => b.id === id);
        gen.levels.forEach((lv) => {
          if (!lv.footprint) return;
          const bb = bbox(lv.footprint), B = base.axis === 0 ? bb.maxY - bb.minY : bb.maxX - bb.minX;
          const horizontal = base.patches.filter((p) => p.kind === "wall" && p.level === lv.index && Math.abs(p.normal[base.axis]) > .99).reduce((s, p) => s + p.force_N[base.axis], 0) * c.scale;
          if (signs) {
            const couple = { id: `${c.id}:torsion:${i}:${lv.index}`, level: lv.index, force_N: [0, 0, 0], point_m: [0, 0, lv.zTop], couple_Nm: [0, 0, signs[i] * Math.abs(horizontal) * .15 * B] };
            c.couples.push(couple); entries.push(couple);
          }
        });
      }
      Object.assign(c, actionResultant(entries)); cases.push(c);
    };
    bases.forEach((b) => [-1, 1].forEach((sign) => addDerived({ ...b, id: `${b.id}:T${sign}`, patches: undefined, baseIds: [b.id], scale: .75, torsionCase: 2, label: `${b.direction} · caso 2 · torsión ${sign > 0 ? "+" : "−"}` }, [sign])));
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const internalSign of [-1, 1]) for (const branch of ["succion", "alternativa"]) {
      const ids = [`W:${sx > 0 ? "+" : "-"}X:i${internalSign}:${branch}:1`, `W:${sy > 0 ? "+" : "-"}Y:i${internalSign}:${branch}:1`];
      const id = `W:diagonal:${sx}:${sy}:i${internalSign}:${branch}`;
      addDerived({ id: `${id}:3`, kind: "W", baseIds: ids, scale: .75, roofScale: 1, branch, torsionCase: 3, label: `Diagonal ${sx}X/${sy}Y · caso 3` });
      for (const tx of [-1, 1]) for (const ty of [-1, 1]) addDerived({ id: `${id}:4:${tx}:${ty}`, kind: "W", baseIds: ids, scale: .75 ** 2, roofScale: .75, branch, torsionCase: 4, label: `Diagonal ${sx}X/${sy}Y · caso 4 · torsión ${tx}/${ty}` }, [tx, ty]);
    }
  }

  // C&R: envolventes locales independientes (no sumables como carga global).
  for (const z of zones) for (const patch of z.patches) {
    const { sf, bb, n, theta, h, a, lv } = z;
    const roof = sf.material === "cubierta";
    const eave = roof && !pointInPolygon({ x: patch.center[0], y: patch.center[1] }, lv.footprint);
    const distanceX = Math.min(patch.center[0] - bb.minX, bb.maxX - patch.center[0]), distanceY = Math.min(patch.center[1] - bb.minY, bb.maxY - patch.center[1]);
    const edge = Math.abs(n[0]) > .9 ? distanceY < a : distanceX < a;
    const zone = roof ? roofZone(edition, z.outer, patch.center, h, theta, sf.level === gen.levels.length - 1 ? project.roof.type : "plano", lv.spanAxis) : edge ? "5" : "4";
    const area = e.wind.effectiveArea_m2;
    const gc = (positive) => componentGCp({ edition, roofType: sf.level === gen.levels.length - 1 ? project.roof.type : "plano", theta_deg: theta, zone, area_m2: area, eave, positive });
    const low = gc(false), high = gc(true);
    if (low === null || high === null) { issues.push("C&R de vertiente única >30° no implementado; faltan presiones locales y fijaciones en esa cubierta."); continue; }
    const qh = q(globalH, true).qz_Pa;
    const minP = edition === "2025" ? 800 : 500;
    const internal = eave ? 0 : result.GCpi;
    components.push({ ...patchAction(sf, patch.points, n, -Math.max(minP, -qh * (low - internal)), { id: patch.id, zone, eave }), effectiveArea_m2: area, GCpNegative: low, GCpPositive: high,
      negative_Pa: -Math.max(minP, -qh * (low - internal)), positive_Pa: Math.max(minP, qh * (high + internal)), qh_Pa: qh, GCpi: internal,
      reference: edition === "2025" ? `102-25 §5.3.2;Fig.5.3-${roof ? project.roof.type === "dos_aguas" ? "2" : theta <= 3 ? "2A" : "5A/B" : "1"};mínimo §5.2.2` : `102-05 §5.12;Fig.${roof ? theta <= 3 || project.roof.type === "dos_aguas" ? "5B" : "7A" : "5A"};mínimo §1.4.2` });
  }
  if (zones.some((z) => z.sf.material === "cubierta" && z.theta > (edition === "2025" ? 7 : 10) && project.roof.overhang > 0)) assumptions.push({ id: "wind:slopedEave", scope: "C&R", message: "Aleros inclinados 2025: se adopta envolvente adicional techo + presión inferior 0,85×0,8 donde no se tabuló curva neta. Revisar coeficientes locales específicos antes de diseñar fijaciones." });
  // Mínimo SPRFV: acción HORIZONTAL sobre proyección vertical, no levantamiento de techo.
  for (const dir of dirs) {
    const entries = [];
    for (const z of zones) {
      const windward = z.sf.material === "exterior" && z.n[dir.axis] * dir.sign < -.99;
      const roof = z.sf.material === "cubierta";
      if (!windward && !roof) continue;
      const area = area3D(z.sf.points) * Math.abs(z.n[dir.axis]);
      const load = (edition === "2025" ? roof ? 400 : 750 : 500) * area;
      const force_N = [0, 0, 0]; force_N[dir.axis] = dir.sign * load;
      entries.push({ id: `Wmin:${z.sf.key}`, level: z.sf.level, surfaceKey: z.sf.key, force_N, point_m: areaCenter_m(z.sf.points), projectedArea_m2: area });
    }
    cases.push({ id: `W:min:${dir.id}`, kind: "W", direction: dir.id, axis: dir.axis, sign: dir.sign, label: `${dir.id} · mínimo horizontal reglamentario`, patches: [], pointEntries: entries,
      reference: edition === "2025" ? "102-25 §2.1.5:0,75 pared+0,4 techo proyectado vertical" : "102-05 §1.4.1:0,5 kPa área proyectada vertical", ...actionResultant(entries) });
  }
  result.issues = [...new Set(issues)];
  result.localRange_Pa = components.length ? [Math.min(...components.map((p) => p.negative_Pa)), Math.max(...components.map((p) => p.positive_Pa))] : [0, 0];
  return result;
}
