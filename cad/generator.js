// Generador de piezas: a partir del modelo de obra produce cada pieza real
// (posición 3D + largo de corte), los sólidos de fundación y las superficies de cerramiento.
// El visor 3D y el cómputo de materiales se alimentan de este mismo resultado.
//
// Cada nivel es un módulo completo (bastidor inferior, piso, muros, bastidor superior)
// que apoya sobre el bastidor superior del nivel de abajo.
import {
  EPS,
  area3D,
  bbox,
  clipPolygonHalfPlane,
  differenceRects,
  segmentCrossesRect,
  unionOutline,
  distributePositions,
  isOrthogonal,
  offsetPolygon,
  pointInPolygon,
  pointKey,
  pointOnWall,
  polygonArea,
  polygonPerimeter,
  round,
  scanPolygon,
  wallDir,
  wallLength
} from "./geometry.js";
import { PROFILES, SYSTEMS } from "./catalog.js";
import { doorLeaf, findFootprint, validateOpenings } from "./model.js";
import { layoutStair, stairChecks } from "./stairs.js";
import { alongWall, buildStair, railAlong } from "./stair-build.js";
import { memberKey } from "./engineering/keys.js";
import { surfaceLayers } from "./engineering/data/materials.js";

const DECK_THICKNESS = 0.018;
const MIN_FILL = 0.15; // relleno de hastial por debajo de esto se resuelve con calces
const DOOR_AJAR = (25 * Math.PI) / 180; // apertura con que se dibuja la hoja en 3D

export function generate(project) {
  const system = SYSTEMS[project.system];
  const roles = { ...system.roles, column: project.mainFrame, ringBeam: project.mainFrame };
  const prof = (role) => PROFILES[roles[role]];
  const s = project.settings;
  const multi = project.levels.length > 1;
  const warnings = [...validateOpenings(project)];

  const members = [];
  const solids = [];
  const surfaces = [];
  let memberSeq = 0;

  const wallById = new Map(project.levels.flatMap((l) => l.walls).map((w) => [w.id, w]));
  const addMember = (role, group, layer, a, b, cut, extra = {}) => {
    const p = prof(role);
    if (cut <= 0.01) return;
    memberSeq += 1;
    if (extra.wallId) {
      const d = wallDir(wallById.get(extra.wallId));
      extra = { ...extra, nrm: [d.y, -d.x] };
    }
    members.push({
      id: `m${memberSeq}`,
      role,
      group,
      layer,
      profileId: roles[role],
      w: p.b,
      h: p.h,
      a,
      b,
      cut: round(cut, 3),
      ...extra
    });
  };

  const f = project.foundation;
  const ring = prof("ringBeam");
  const stud = prof("stud");
  const track = prof("track");
  const frame = prof("openingFrame");
  const rafter = prof("rafter");
  const ridge = prof("ridge");
  const joist = prof("floorJoist");
  const col = system.hasMainFrame ? prof("column") : null;
  const colB = col ? col.b : 0;

  const totals = {
    footprintArea: 0, // planta baja (fundación)
    coveredArea: 0, // suma de todos los niveles
    roofArea: 0,
    roofPlanArea: 0,
    roofCoveredArea: 0, // superficie bajo cubierta (cielorraso)
    perimeter: 0,
    floorDeckArea: 0,
    mezzanineDeckArea: 0,
    concrete: 0,
    excavation: 0,
    formwork: 0,
    film: 0,
    gravel: 0,
    meshPanels: 0,
    rebar: { 6: 0, 8: 0, 10: 0, 12: 0 },
    anchorPlates: 0,
    anchorBolts: 0,
    chemicalAnchors: 0,
    columns: 0,
    levels: project.levels.length
  };
  const wallSummaries = [];
  const levelsOut = [];

  const footprints = project.levels.map((level, i) => {
    const info = findFootprint(level.walls);
    const tag = multi ? `${level.name}: ` : "";
    info.warnings.forEach((w) => warnings.push(tag + w));
    if (!info.polygon && i > 0 && level.walls.length) {
      warnings.push(`${level.name}: sin contorno cerrado no apoya sobre el nivel inferior.`);
    }
    return info.polygon;
  });

  // esquinas de los niveles de arriba: si caen sobre un muro de este nivel, ahí va una columna
  const cornersAbove = project.levels.map((_, li) =>
    project.levels
      .slice(li + 1)
      .flatMap((l) => l.walls.filter((w) => w.type === "exterior").flatMap((w) => [w.a, w.b]))
  );

  // Cotas de cada nivel (mismo cálculo que el recorrido de abajo), para resolver escaleras y huecos antes
  const levelZ = [];
  {
    let b = f.elevation;
    project.levels.forEach((level, li) => {
      const elevated = li > 0 || f.type !== "platea";
      const floorTop = elevated ? b + ring.h + DECK_THICKNESS : b;
      levelZ.push({ elev: b, floorTop, zTop: floorTop + level.height });
      b = floorTop + level.height;
    });
  }

  // Escaleras: cada una pertenece al nivel de abajo y abre un hueco en el entrepiso de arriba
  const stairLayouts = [];
  const holeRectsByLevel = project.levels.map(() => []);
  const arrivalsByLevel = project.levels.map(() => []);
  const guardByLevel = project.levels.map(() => null);
  project.levels.forEach((level, li) => {
    (level.stairs ?? []).forEach((st) => {
      if (li + 1 >= project.levels.length) {
        warnings.push(`${level.name}: hay una escalera sin nivel superior al que llegar. Agregá un nivel encima o borrala.`);
        return;
      }
      const lo = levelZ[li];
      const up = levelZ[li + 1];
      const zUnder = Math.min(up.elev + ring.h - joist.h, up.elev) - 0.013; // cara inferior de viguetas y cielorraso
      const lay = layoutStair(st, { f0: lo.floorTop, H: up.floorTop - lo.floorTop, zUnder });
      lay.level = li;
      lay.warnings = [];
      lay.checks = stairChecks(lay);
      stairLayouts.push(lay);
      if (!lay.solution.ok) {
        warnings.push(`Escalera de ${level.name}: ${lay.solution.reason}`);
        return;
      }
      holeRectsByLevel[li + 1].push(...lay.holeRects);
      arrivalsByLevel[li + 1].push(lay.arrival.edge);
      guardByLevel[li + 1] = Math.max(guardByLevel[li + 1] ?? 0, lay.rules.guardHeight);
      lay.checks.filter((c) => !c.ok).forEach((c) => warnings.push(`Escalera de ${level.name}: no cumple «${c.label}» (${c.detail}).`));
    });
  });
  const holesByLevel = holeRectsByLevel.map((rects) => unionOutline(rects));

  let base = f.elevation;
  let lowerColumns = null;

  project.levels.forEach((level, li) => {
    const lv = { level: li };
    const footprint = footprints[li];
    const above = li + 1 < project.levels.length ? footprints[li + 1] : null;
    const isTop = !above;
    const elevated = li > 0 || f.type !== "platea";
    const elev = base;
    const floorTop = elevated ? elev + ring.h + DECK_THICKNESS : elev;
    const zTop = floorTop + level.height; // cara superior del bastidor superior
    const height = level.height;
    const exteriorWalls = level.walls.filter((w) => w.type === "exterior");
    const interiorWalls = level.walls.filter((w) => w.type === "interior");

    // ---------- Geometría del techo de este nivel ----------
    let roofUnderside = () => zTop;
    let spanAxis = "x";
    let uRange = [0, 0];
    if (footprint) {
      const bb = bbox(footprint);
      spanAxis = bb.maxX - bb.minX <= bb.maxY - bb.minY ? "x" : "y";
      uRange = spanAxis === "x" ? [bb.minX, bb.maxX] : [bb.minY, bb.maxY];
      if (isTop) {
        const slope = Math.max(project.roof.slope, 0) / 100;
        const [umin, umax] = uRange;
        const umid = (umin + umax) / 2;
        const half = (umax - umin) / 2;
        const uOf = (p) => (spanAxis === "x" ? p.x : p.y);
        roofUnderside =
          project.roof.type === "dos_aguas"
            ? (p) => zTop + slope * (half - Math.abs(uOf(p) - umid))
            : (p) => zTop + slope * (uOf(p) - umin);
      }
    }

    const openingSpans = (wall) => wall.openings.map((o) => [o.offset, o.offset + o.width]);
    const insideOpening = (wall, sPos, margin = 0) => openingSpans(wall).some(([a, b]) => sPos > a - margin && sPos < b + margin);

    // ---------- Columnas y bastidores ----------
    const columnNodes = new Map();
    const wallColumns = new Map();
    if (system.hasMainFrame) {
      exteriorWalls.forEach((wall) => {
        const L = wallLength(wall);
        const dir = wallDir(wall);
        const onWall = (p) => {
          const rel = { x: p.x - wall.a.x, y: p.y - wall.a.y };
          const along = rel.x * dir.x + rel.y * dir.y;
          const across = Math.abs(rel.x * dir.y - rel.y * dir.x);
          return across < 0.01 && along > col.b && along < L - col.b ? along : null;
        };
        const lowerKeys = new Set(lowerColumns ? lowerColumns.keys() : []);
        const supported = (pos) => lowerKeys.has(pointKey(pointOnWall(wall, pos)));
        const positions = [0, L];
        // columnas del nivel de abajo que caen sobre este muro (continuidad de carga)
        (lowerColumns ? [...lowerColumns.values()] : []).forEach((p) => {
          const along = onWall(p);
          if (along !== null && !insideOpening(wall, along, col.b)) positions.push(along);
        });
        // esquinas de los niveles de arriba que apoyan sobre este muro
        cornersAbove[li].forEach((p) => {
          const along = onWall(p);
          if (along !== null && !insideOpening(wall, along, col.b / 2)) positions.push(along);
        });
        const sorted = [...new Set(positions.map((v) => round(v, 4)))].sort((a, b) => a - b);
        const filled = [];
        sorted.forEach((pos, i) => {
          filled.push(pos);
          const next = sorted[i + 1];
          if (next === undefined) return;
          // si el vano ya está resuelto abajo, se respeta para que las columnas coincidan
          if (supported(pos) && supported(next)) return;
          const gap = next - pos;
          const n = Math.ceil(gap / system.defaults.maxColumnSpacing - 1e-9);
          for (let k = 1; k < n; k += 1) {
            let mid = pos + (gap * k) / n;
            const hit = openingSpans(wall).find(([a, b]) => mid > a - col.b && mid < b + col.b);
            if (hit) {
              const left = hit[0] - col.b;
              const right = hit[1] + col.b;
              mid = mid - left < right - mid ? left : right;
            }
            if (mid > pos + col.b && mid < next - col.b) filled.push(mid);
          }
        });
        const unique = [...new Set(filled.map((v) => round(v, 4)))].sort((a, b) => a - b);
        wallColumns.set(wall.id, unique);
        unique.forEach((pos) => {
          const p = pointOnWall(wall, pos);
          columnNodes.set(pointKey(p), p);
        });
      });

      columnNodes.forEach((p) => {
        addMember("column", "Columnas", "estructura", [p.x, p.y, elev], [p.x, p.y, zTop], zTop - elev, lv);
      });

      exteriorWalls.forEach((wall) => {
        const cols = wallColumns.get(wall.id);
        for (let i = 0; i + 1 < cols.length; i += 1) {
          const pa = pointOnWall(wall, cols[i]);
          const pb = pointOnWall(wall, cols[i + 1]);
          const cut = cols[i + 1] - cols[i] - col.b;
          const zb = elev + ring.h / 2;
          const zt = zTop - ring.h / 2;
          addMember("ringBeam", "Bastidor inferior", "estructura", [pa.x, pa.y, zb], [pb.x, pb.y, zb], cut, { ...lv, wallId: wall.id });
          addMember("ringBeam", "Bastidor superior", "estructura", [pa.x, pa.y, zt], [pb.x, pb.y, zt], cut, { ...lv, wallId: wall.id });
        }
      });

      if (li > 0 && lowerColumns) {
        const lowerKeys = new Set(lowerColumns.keys());
        const floating = [...columnNodes.keys()].filter((k) => !lowerKeys.has(k)).length;
        if (floating) {
          warnings.push(`${level.name}: ${floating} columna${floating > 1 ? "s" : ""} no coincide${floating > 1 ? "n" : ""} con columnas del nivel inferior; apoya${floating > 1 ? "n" : ""} sobre el bastidor y hay que verificarlo.`);
        }
      }
    }

    // ---------- Muros ----------
    const buildOpenings = (wall, studBottom, studTop) => {
      const pt = (sPos, z) => {
        const p = pointOnWall(wall, sPos);
        return [p.x, p.y, z];
      };
      const ex = { ...lv, wallId: wall.id };
      wall.openings.forEach((o) => {
        const left = o.offset;
        const right = o.offset + o.width;
        const bottom = floorTop + o.sill;
        const top = floorTop + o.sill + o.height;
        [left - stud.b / 2, right + stud.b / 2].forEach((sp, side) => {
          addMember("stud", "Montantes", "estructura", pt(sp, studBottom), pt(sp, studTop), studTop - studBottom, { ...ex, identity: `${o.id}:jamb:${side}` });
        });
        addMember("stud", "Dinteles y antepechos", "estructura", pt(left, top + stud.b / 2), pt(right, top + stud.b / 2), o.width, { ...ex, identity: `${o.id}:header` });
        if (o.kind === "window") {
          addMember("stud", "Dinteles y antepechos", "estructura", pt(left, bottom - stud.b / 2), pt(right, bottom - stud.b / 2), o.width, { ...ex, identity: `${o.id}:sill` });
        }
        addMember("openingFrame", "Marcos de aberturas", "estructura", pt(left + frame.b / 2, bottom), pt(left + frame.b / 2, top), o.height, { ...ex, identity: `${o.id}:frame:left` });
        addMember("openingFrame", "Marcos de aberturas", "estructura", pt(right - frame.b / 2, bottom), pt(right - frame.b / 2, top), o.height, { ...ex, identity: `${o.id}:frame:right` });
        addMember("openingFrame", "Marcos de aberturas", "estructura", pt(left, top - frame.b / 2), pt(right, top - frame.b / 2), o.width, { ...ex, identity: `${o.id}:frame:header` });
        if (o.kind === "window") {
          addMember("openingFrame", "Marcos de aberturas", "estructura", pt(left, bottom + frame.b / 2), pt(right, bottom + frame.b / 2), o.width, { ...ex, identity: `${o.id}:frame:sill` });
        }
        distributePositions(left, right, s.wallSpacing)
          .slice(1, -1)
          .forEach((sp) => {
            const upperFrom = top + stud.b;
            if (studTop - upperFrom > 0.05) addMember("stud", "Montantes", "estructura", pt(sp, upperFrom), pt(sp, studTop), studTop - upperFrom, { ...ex, identity: `${o.id}:infill:upper:${round(sp, 6)}` });
            if (o.kind === "window") {
              const lowerTo = bottom - stud.b;
              if (lowerTo - studBottom > 0.05) addMember("stud", "Montantes", "estructura", pt(sp, studBottom), pt(sp, lowerTo), lowerTo - studBottom, { ...ex, identity: `${o.id}:infill:lower:${round(sp, 6)}` });
            }
          });
        if (o.kind === "door") {
          // hoja entreabierta: muestra la bisagra y hacia dónde abre
          const leaf = doorLeaf(wall, o);
          const u = { x: (leaf.freePt.x - leaf.hingePt.x) / o.width, y: (leaf.freePt.y - leaf.hingePt.y) / o.width };
          const d = { x: Math.cos(DOOR_AJAR) * u.x + Math.sin(DOOR_AJAR) * leaf.out.x, y: Math.cos(DOOR_AJAR) * u.y + Math.sin(DOOR_AJAR) * leaf.out.y };
          const h = leaf.hingePt;
          const w = o.width - 0.04;
          const e = { x: h.x + d.x * w, y: h.y + d.y * w };
          surfaces.push({
            ...lv, wallId: wall.id, openingId: o.id,
            layer: "aberturas",
            material: "puerta",
            points: [[h.x, h.y, bottom], [e.x, e.y, bottom], [e.x, e.y, top - 0.01], [h.x, h.y, top - 0.01]],
            holes: [],
            area: o.width * o.height
          });
        } else {
          surfaces.push({ ...lv, wallId: wall.id, openingId: o.id, layer: "aberturas", material: "vidrio", points: [pt(left, bottom), pt(right, bottom), pt(right, top), pt(left, top)], holes: [], area: o.width * o.height });
        }
      });
    };

    const wallFrameAt = (wall, normalOffset) => {
      const dir = wallDir(wall);
      const n = { x: dir.y, y: -dir.x };
      return (sPos, z) => {
        const p = pointOnWall(wall, sPos);
        return [p.x + n.x * normalOffset, p.y + n.y * normalOffset, z];
      };
    };
    const outwardSign = (wall) => {
      if (!footprint) return 1;
      const dir = wallDir(wall);
      const mid = pointOnWall(wall, wallLength(wall) / 2);
      return pointInPolygon({ x: mid.x + dir.y * 0.2, y: mid.y - dir.x * 0.2 }, footprint) ? -1 : 1;
    };
    const openingHoles = (wall, toPoint) =>
      wall.openings.map((o) => [
        toPoint(o.offset, floorTop + o.sill),
        toPoint(o.offset + o.width, floorTop + o.sill),
        toPoint(o.offset + o.width, floorTop + o.sill + o.height),
        toPoint(o.offset, floorTop + o.sill + o.height)
      ]);
    const openingArea = (wall) => wall.openings.reduce((sum, o) => sum + o.width * o.height, 0);
    const topBreakpoints = (wall) => {
      const L = wallLength(wall);
      const pts = [0, L];
      if (footprint && isTop && project.roof.type === "dos_aguas") {
        const umid = (uRange[0] + uRange[1]) / 2;
        const ua = spanAxis === "x" ? wall.a.x : wall.a.y;
        const ub = spanAxis === "x" ? wall.b.x : wall.b.y;
        if ((ua - umid) * (ub - umid) < 0) pts.push((L * (umid - ua)) / (ub - ua));
      }
      return pts.sort((a, b) => a - b);
    };

    exteriorWalls.forEach((wall) => {
      const L = wallLength(wall);
      const dir = wallDir(wall);
      const ex = { ...lv, wallId: wall.id };
      const cols = wallColumns.get(wall.id) ?? [0, L];
      const studBottom = system.hasMainFrame ? elev + ring.h : floorTop + track.b;
      const studTop = system.hasMainFrame ? zTop - ring.h : zTop - track.b;
      const pt = (sp, z) => {
        const p = pointOnWall(wall, sp);
        return [p.x, p.y, z];
      };
      distributePositions(0, L, s.wallSpacing, cols)
        .filter((sp) => !cols.some((c) => Math.abs(sp - c) < colB / 2 + stud.b / 2) && !insideOpening(wall, sp, stud.b * 1.5))
        .forEach((sp) => addMember("stud", "Montantes", "estructura", pt(sp, studBottom), pt(sp, studTop), studTop - studBottom, ex));
      buildOpenings(wall, studBottom, studTop);

      let fillArea = 0;
      if (footprint && isTop) {
        const parallelToSpan = spanAxis === "x" ? Math.abs(dir.y) < 1e-3 : Math.abs(dir.x) < 1e-3;
        let maxFill = 0;
        distributePositions(0, L, s.wallSpacing, cols).forEach((sp) => {
          const p = pointOnWall(wall, sp);
          const fill = roofUnderside(p) - zTop;
          maxFill = Math.max(maxFill, fill);
          if (fill > MIN_FILL) addMember("stud", "Relleno de hastial", "estructura", [p.x, p.y, zTop], [p.x, p.y, zTop + fill], fill, ex);
        });
        if (maxFill > MIN_FILL && !parallelToSpan) {
          const z = roofUnderside(wall.a) - track.b / 2;
          addMember("track", "Relleno de hastial", "estructura", [wall.a.x, wall.a.y, z], [wall.b.x, wall.b.y, z], L, ex);
        }
        if (Math.abs(dir.x) > 1e-3 && Math.abs(dir.y) > 1e-3) warnings.push("Hay muros exteriores no ortogonales: el relleno bajo techo se aproxima.");
        const bps = topBreakpoints(wall);
        for (let i = 0; i + 1 < bps.length; i += 1) {
          const f1 = Math.max(roofUnderside(pointOnWall(wall, bps[i])) - zTop, 0);
          const f2 = Math.max(roofUnderside(pointOnWall(wall, bps[i + 1])) - zTop, 0);
          fillArea += ((f1 + f2) / 2) * (bps[i + 1] - bps[i]);
        }
      }

      const sign = outwardSign(wall);
      const extPt = wallFrameAt(wall, sign * 0.065);
      const intPt = wallFrameAt(wall, -sign * 0.065);
      const bps = topBreakpoints(wall);
      const topZ = (sp) => Math.max(roofUnderside(pointOnWall(wall, sp)), zTop);
      const extOutline = [extPt(0, elev), extPt(L, elev), ...[...bps].reverse().map((sp) => extPt(sp, topZ(sp)))];
      const extArea = area3D(extOutline) - openingArea(wall);
      surfaces.push({ ...lv, wallId: wall.id, layer: "cerramientos", material: "exterior", points: extOutline, holes: openingHoles(wall, extPt), area: extArea });
      const intArea = L * height - openingArea(wall);
      surfaces.push({
        ...lv, wallId: wall.id, coreArea_m2: intArea,
        layer: "cerramientos",
        material: "interior",
        points: [intPt(0, floorTop), intPt(L, floorTop), intPt(L, zTop), intPt(0, zTop)],
        holes: openingHoles(wall, intPt),
        area: intArea
      });
      wallSummaries.push({ ...lv, wallId: wall.id, type: "exterior", length: L, extArea, intArea, fillArea, openingArea: openingArea(wall) });
    });

    interiorWalls.forEach((wall) => {
      const L = wallLength(wall);
      const ex = { ...lv, wallId: wall.id };
      const studBottom = floorTop + track.b;
      const studTop = zTop - track.b;
      const pt = (sp, z) => {
        const p = pointOnWall(wall, sp);
        return [p.x, p.y, z];
      };
      const doorSpans = wall.openings.filter((o) => o.kind === "door").map((o) => [o.offset, o.offset + o.width]).sort((a, b) => a[0] - b[0]);
      let cursor = 0;
      [...doorSpans, [L, L]].forEach(([a, b]) => {
        if (a - cursor > 0.05) addMember("track", "Soleras", "estructura", pt(cursor, floorTop + track.b / 2), pt(a, floorTop + track.b / 2), a - cursor, { ...ex, identity: `bottom:${round(cursor, 6)}..${round(a, 6)}` });
        cursor = b;
      });
      addMember("track", "Soleras", "estructura", pt(0, zTop - track.b / 2), pt(L, zTop - track.b / 2), L, { ...ex, identity: "top" });
      distributePositions(0, L, s.wallSpacing)
        .filter((sp) => !insideOpening(wall, sp, stud.b * 1.5))
        .forEach((sp) => {
          const c = Math.min(Math.max(sp, stud.b / 2), L - stud.b / 2);
          addMember("stud", "Montantes", "estructura", pt(c, studBottom), pt(c, studTop), studTop - studBottom, ex);
        });
      buildOpenings(wall, studBottom, studTop);
      const area = L * height - openingArea(wall);
      [wallFrameAt(wall, 0.065), wallFrameAt(wall, -0.065)].forEach((toPt, face) => {
        surfaces.push({
          ...lv, wallId: wall.id, face, coreArea_m2: face === 0 && s.interiorWallInsulation ? area : 0,
          layer: "cerramientos",
          material: "interior",
          points: [toPt(0, floorTop), toPt(L, floorTop), toPt(L, zTop), toPt(0, zTop)],
          holes: openingHoles(wall, toPt),
          area
        });
      });
      wallSummaries.push({ ...lv, wallId: wall.id, type: "interior", length: L, faceArea: area, openingArea: openingArea(wall) });
    });

    // ---------- Escaleras que arrancan en este nivel ----------
    stairLayouts
      .filter((lay) => lay.level === li && lay.solution.ok)
      .forEach((lay) => {
        lay.stats = buildStair(lay, {
          add: (role, grp, a3, b3, cut, extra) => addMember(role, grp, "escaleras", a3, b3, cut, extra),
          prof, surfaces, walls: level.walls, lv, f0: floorTop
        });
        const warn = (text) => {
          lay.warnings.push(text);
          warnings.push(`Escalera de ${level.name}: ${text}`);
        };
        const shrink = (r, d) => ({ x0: r.x0 + d, x1: r.x1 - d, y0: r.y0 + d, y1: r.y1 - d });
        const cornersOf = (r) => [{ x: r.x0, y: r.y0 }, { x: r.x1, y: r.y0 }, { x: r.x1, y: r.y1 }, { x: r.x0, y: r.y1 }];
        if (footprint && lay.rects.some((r) => cornersOf(shrink(r, 0.03)).some((c) => !pointInPolygon(c, footprint)))) {
          warn("queda (en parte) fuera de la planta.");
        }
        if (level.walls.some((wl) => lay.rects.some((r) => segmentCrossesRect(wl.a, wl.b, r, 0.08)))) {
          warn("corta un muro o tabique. Movela o cambiá el tipo (recta, L, U).");
        }
        level.walls.forEach((wl) =>
          wl.openings
            .filter((o) => o.kind === "door")
            .forEach((o) => {
              const leaf = doorLeaf(wl, o);
              const far = { x: leaf.freePt.x + leaf.out.x * o.width, y: leaf.freePt.y + leaf.out.y * o.width };
              const pts = [leaf.hingePt, leaf.freePt, leaf.tip, far];
              const sweep = { x0: Math.min(...pts.map((q) => q.x)), x1: Math.max(...pts.map((q) => q.x)), y0: Math.min(...pts.map((q) => q.y)), y1: Math.max(...pts.map((q) => q.y)) };
              const overlap = lay.rects.some((r) => Math.min(r.x1, sweep.x1) - Math.max(r.x0, sweep.x0) > 0.05 && Math.min(r.y1, sweep.y1) - Math.max(r.y0, sweep.y0) > 0.05);
              if (overlap) warn("una puerta barre sobre la escalera. Cambiá el sentido de apertura o mové la escalera.");
            })
        );
        const upFoot = footprints[li + 1];
        const upWalls = project.levels[li + 1]?.walls ?? [];
        const arr = shrink(lay.arrival, 0.03);
        if (upFoot && cornersOf(arr).some((c) => !pointInPolygon(c, upFoot))) warn(`la llegada queda fuera de ${project.levels[li + 1].name}.`);
        if (upWalls.some((wl) => segmentCrossesRect(wl.a, wl.b, lay.arrival, 0.08))) warn(`un muro de ${project.levels[li + 1].name} bloquea la llegada.`);
        if (upWalls.some((wl) => lay.holeRects.some((r) => segmentCrossesRect(wl.a, wl.b, r, 0.08)))) warn(`el hueco del entrepiso corta un muro de ${project.levels[li + 1].name}.`);
      });

    // ---------- Piso o entrepiso ----------
    const scanAxis = spanAxis === "x" ? "y" : "x";
    const bOf = (p) => (scanAxis === "x" ? p.x : p.y);
    const makePoint = (u, b) => (spanAxis === "x" ? { x: u, y: b } : { x: b, y: u });

    if (footprint) {
      const area = polygonArea(footprint);
      totals.coveredArea += area;
      if (li === 0) {
        totals.footprintArea = area;
        totals.perimeter = polygonPerimeter(footprint);
      }
      if (li > 0 && footprints[li - 1]) {
        const overhang = differenceRects(footprint, footprints[li - 1]).reduce((sum, r) => sum + (r.x1 - r.x0) * (r.y1 - r.y0), 0);
        if (overhang > 0.01) warnings.push(`${level.name}: ${round(overhang, 2)} m² quedan en voladizo sobre el nivel inferior; verificá la estructura.`);
      }

      if (elevated) {
        const group = li === 0 ? "Viguetas de piso" : "Viguetas de entrepiso";
        const holes = holesByLevel[li] ?? [];
        const uOf = (p) => (spanAxis === "x" ? p.x : p.y);
        const hb = joist.b; // ancho de brochales y vigas de borde
        const edgeJoists = [];
        const headers = [];
        holes.forEach((loop) =>
          loop.forEach((p, i) => {
            const q = loop[(i + 1) % loop.length];
            const mid = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
            if (Math.abs(bOf(p) - bOf(q)) < 1e-6) {
              const c = bOf(p);
              const inside = pointInPolygon(makePoint(uOf(mid), c + 0.01), loop);
              edgeJoists.push(c + (inside ? -1 : 1) * (hb / 2));
            } else if (Math.abs(uOf(p) - uOf(q)) < 1e-6) {
              const u0 = uOf(p);
              const inside = pointInPolygon(makePoint(u0 + 0.01, bOf(mid)), loop);
              headers.push({ u: u0 + (inside ? -1 : 1) * (hb / 2), b0: Math.min(bOf(p), bOf(q)), b1: Math.max(bOf(p), bOf(q)) });
            }
          })
        );
        const holeCut = (c, span) => {
          let pieces = [span];
          holes.forEach((loop) =>
            scanPolygon(loop, scanAxis, c).forEach(([h1, h2]) => {
              const lo = h1 - hb;
              const hi = h2 + hb;
              pieces = pieces.flatMap(([a, b]) => [[a, Math.min(b, lo)], [Math.max(a, hi), b]]).filter(([a, b]) => b - a > 0.05);
            })
          );
          return pieces;
        };
        const bCoords = footprint.map(bOf);
        const positions = distributePositions(Math.min(...bCoords), Math.max(...bCoords), s.floorSpacing, bCoords).filter(
          (c) => !bCoords.some((v) => Math.abs(v - c) < (ring.b + joist.b) / 2) && !edgeJoists.some((e) => Math.abs(e - c) < hb)
        );
        const zJ = elev + ring.h - joist.h / 2;
        let maxSpan = 0;
        const placeJoist = (c, grp) => {
          scanPolygon(footprint, scanAxis, c).forEach(([u1, u2]) => {
            maxSpan = Math.max(maxSpan, u2 - u1);
            (holes.length ? holeCut(c, [u1, u2]) : [[u1, u2]]).forEach(([a, b]) => {
              const a2 = Math.abs(a - u1) < 1e-9 ? a + ring.b / 2 : a;
              const b2 = Math.abs(b - u2) < 1e-9 ? b - ring.b / 2 : b;
              const p1 = makePoint(a2, c);
              const p2 = makePoint(b2, c);
              addMember("floorJoist", grp, "piso", [p1.x, p1.y, zJ], [p2.x, p2.y, zJ], b2 - a2, lv);
            });
          });
        };
        positions.forEach((c) => placeJoist(c, group));
        [...new Set(edgeJoists.map((c) => round(c, 4)))].forEach((c) => placeJoist(c, "Vigas de borde del hueco"));
        headers.forEach((hd) => {
          const p1 = makePoint(hd.u, hd.b0);
          const p2 = makePoint(hd.u, hd.b1);
          addMember("floorJoist", "Brochales del hueco", "piso", [p1.x, p1.y, zJ], [p2.x, p2.y, zJ], hd.b1 - hd.b0, lv);
        });
        if (maxSpan > system.defaults.maxJoistSpan) {
          warnings.push(`${multi ? `${level.name}: l` : "L"}as viguetas de ${li === 0 ? "piso" : "entrepiso"} salvan ${round(maxSpan, 2)} m: verificá la sección o agregá una viga intermedia con apoyo.`);
        }
        // Baranda en los bordes del hueco, salvo la llegada de la escalera y los bordes contra muros
        const arrivals = arrivalsByLevel[li] ?? [];
        holes.forEach((loop, hi) =>
          loop.forEach((p, i) => {
            const q = loop[(i + 1) % loop.length];
            const e = { x: q.x - p.x, y: q.y - p.y };
            const L = Math.hypot(e.x, e.y);
            if (L < 0.05) return;
            const ux = { x: e.x / L, y: e.y / L };
            let free = [[0, L]];
            arrivals.forEach(([A, B]) => {
              const offA = Math.abs((A.x - p.x) * ux.y - (A.y - p.y) * ux.x);
              const offB = Math.abs((B.x - p.x) * ux.y - (B.y - p.y) * ux.x);
              if (offA > 0.02 || offB > 0.02) return;
              const ta = (A.x - p.x) * ux.x + (A.y - p.y) * ux.y;
              const tb = (B.x - p.x) * ux.x + (B.y - p.y) * ux.y;
              const lo = Math.min(ta, tb);
              const hi2 = Math.max(ta, tb);
              free = free.flatMap(([a, b]) => [[a, Math.min(b, lo)], [Math.max(a, hi2), b]]).filter(([a, b]) => b - a > 0.1);
            });
            const mid = { x: p.x + e.x / 2, y: p.y + e.y / 2 };
            const n = { x: ux.y, y: -ux.x };
            const out = pointInPolygon({ x: mid.x + n.x * 0.02, y: mid.y + n.y * 0.02 }, loop) ? { x: -n.x, y: -n.y } : n;
            free.forEach(([a, b], k) => {
              const A = { x: p.x + ux.x * a + out.x * 0.03, y: p.y + ux.y * a + out.y * 0.03 };
              const B = { x: p.x + ux.x * b + out.x * 0.03, y: p.y + ux.y * b + out.y * 0.03 };
              if (alongWall(A, B, level.walls)) return;
              railAlong((role, grp, a3, b3, cut, extra) => addMember(role, grp, "escaleras", a3, b3, cut, extra), {
                a: A, b: B, za: floorTop, zb: floorTop, height: guardByLevel[li] ?? 1.0, kind: "baranda", gap: 0.1,
                identity: `hueco:${hi}:${i}:${k}`, prof, lv
              });
            });
          })
        );
        const holeArea = holes.reduce((sum, loop) => sum + Math.abs(polygonArea(loop)), 0);
        const deckArea = area - holeArea;
        if (li === 0) totals.floorDeckArea = deckArea;
        else totals.mezzanineDeckArea += deckArea;
        surfaces.push({
          ...lv, layer: "piso", material: "piso", points: footprint.map((p) => [p.x, p.y, floorTop]),
          holes: holes.map((loop) => loop.map((p) => [p.x, p.y, floorTop])), area: deckArea
        });
      } else {
        surfaces.push({ ...lv, layer: "piso", material: "platea", points: footprint.map((p) => [p.x, p.y, floorTop + 0.002]), holes: [], area });
      }

      // ---------- Techo ----------
      if (isTop) {
        const roofOutline = offsetPolygon(footprint, project.roof.overhang);
        const [umin, umax] = uRange;
        const umid = (umin + umax) / 2;
        const bCoordsRoof = [...footprint.map(bOf), ...roofOutline.map(bOf)];
        const rafterPositions = distributePositions(Math.min(...bCoordsRoof) + rafter.b / 2, Math.max(...bCoordsRoof) - rafter.b / 2, s.roofSpacing, footprint.map(bOf));
        const rafterPoint = (u, c) => {
          const p = makePoint(u, c);
          return [p.x, p.y, roofUnderside(p) + rafter.h / 2];
        };
        rafterPositions.forEach((c) => {
          scanPolygon(roofOutline, scanAxis, c).forEach(([u1, u2]) => {
            const segments = project.roof.type === "dos_aguas" && u1 < umid && u2 > umid ? [[u1, umid - ridge.b / 2], [umid + ridge.b / 2, u2]] : [[u1, u2]];
            segments.forEach(([a, b]) => {
              const A = rafterPoint(a, c);
              const B = rafterPoint(b, c);
              addMember("rafter", "Cabios", "techo", A, B, Math.hypot(B[0] - A[0], B[1] - A[1], B[2] - A[2]), lv);
            });
          });
        });
        if (project.roof.type === "dos_aguas") {
          scanPolygon(roofOutline, spanAxis, umid).forEach(([b1, b2]) => {
            const p1 = makePoint(umid, b1);
            const p2 = makePoint(umid, b2);
            const z = roofUnderside(p1) + rafter.h - ridge.h / 2;
            addMember("ridge", "Cumbrera", "techo", [p1.x, p1.y, z], [p2.x, p2.y, z], b2 - b1, lv);
          });
        }
        roofOutline.forEach((p, i) => {
          const q = roofOutline[(i + 1) % roofOutline.length];
          const du = spanAxis === "x" ? q.x - p.x : q.y - p.y;
          if (Math.abs(du) > EPS) return;
          const za = roofUnderside(p) + rafter.h / 2;
          addMember("roofEdge", "Cenefas", "techo", [p.x, p.y, za], [q.x, q.y, za], Math.hypot(q.x - p.x, q.y - p.y), lv);
        });
        const planes =
          project.roof.type === "dos_aguas"
            ? [clipPolygonHalfPlane(roofOutline, spanAxis, umid, "below"), clipPolygonHalfPlane(roofOutline, spanAxis, umid, "above")].filter((pl) => pl.length >= 3)
            : [roofOutline];
        planes.forEach((plane, planeIndex) => {
          const pts = plane.map((p) => [p.x, p.y, roofUnderside(p) + rafter.h]);
          const a = area3D(pts);
          totals.roofArea += a;
          const covered = project.roof.type === "dos_aguas"
            ? clipPolygonHalfPlane(footprint, spanAxis, umid, planeIndex === 0 ? "below" : "above")
            : footprint;
          surfaces.push({ ...lv, layer: "cubierta", material: "cubierta", points: pts, holes: [], area: a, coveredArea_m2: Math.abs(polygonArea(covered)) });
        });
        totals.roofPlanArea += Math.abs(polygonArea(roofOutline));
        totals.roofCoveredArea += area;
      } else {
        // parte de este nivel que queda descubierta por el nivel de arriba: cubierta plana
        if (!isOrthogonal(footprint) || !isOrthogonal(above)) warnings.push(`${level.name}: la cubierta descubierta se aproxima porque hay muros no ortogonales.`);
        const zR = zTop + rafter.h / 2;
        differenceRects(footprint, above).forEach((r) => {
          const alongX = r.x1 - r.x0 <= r.y1 - r.y0; // cabios en la luz corta
          const outside = (x, y) => !pointInPolygon({ x, y }, footprint);
          const nextToUpper = (x, y) => pointInPolygon({ x, y }, above);
          const trim = ring.b / 2;
          if (alongX) {
            const t0 = nextToUpper(r.x0 - 0.05, (r.y0 + r.y1) / 2) ? trim : 0;
            const t1 = nextToUpper(r.x1 + 0.05, (r.y0 + r.y1) / 2) ? trim : 0;
            distributePositions(r.y0 + rafter.b / 2, r.y1 - rafter.b / 2, s.roofSpacing).forEach((y) => {
              addMember("rafter", "Cabios", "techo", [r.x0 + t0, y, zR], [r.x1 - t1, y, zR], r.x1 - r.x0 - t0 - t1, lv);
            });
            [r.y0, r.y1].forEach((y) => {
              const probe = y === r.y0 ? y - 0.05 : y + 0.05;
              if (outside((r.x0 + r.x1) / 2, probe)) addMember("roofEdge", "Cenefas", "techo", [r.x0, y, zR], [r.x1, y, zR], r.x1 - r.x0, lv);
            });
          } else {
            const t0 = nextToUpper((r.x0 + r.x1) / 2, r.y0 - 0.05) ? trim : 0;
            const t1 = nextToUpper((r.x0 + r.x1) / 2, r.y1 + 0.05) ? trim : 0;
            distributePositions(r.x0 + rafter.b / 2, r.x1 - rafter.b / 2, s.roofSpacing).forEach((x) => {
              addMember("rafter", "Cabios", "techo", [x, r.y0 + t0, zR], [x, r.y1 - t1, zR], r.y1 - r.y0 - t0 - t1, lv);
            });
            [r.x0, r.x1].forEach((x) => {
              const probe = x === r.x0 ? x - 0.05 : x + 0.05;
              if (outside(probe, (r.y0 + r.y1) / 2)) addMember("roofEdge", "Cenefas", "techo", [x, r.y0, zR], [x, r.y1, zR], r.y1 - r.y0, lv);
            });
          }
          const a = (r.x1 - r.x0) * (r.y1 - r.y0);
          const z = zTop + rafter.h;
          surfaces.push({ ...lv, layer: "cubierta", material: "cubierta", points: [[r.x0, r.y0, z], [r.x1, r.y0, z], [r.x1, r.y1, z], [r.x0, r.y1, z]], holes: [], area: a, coveredArea_m2: a });
          totals.roofArea += a;
          totals.roofPlanArea += a;
          totals.roofCoveredArea += a;
        });
      }
    }

    totals.columns += columnNodes.size;
    levelsOut.push({ index: li, name: level.name, elev, floorTop, zTop, footprint, spanAxis, columns: [...columnNodes.values()], holes: holesByLevel[li] ?? [] });
    lowerColumns = columnNodes;
    base = zTop;
  });

  // ---------- Fundación (bajo la planta baja) ----------
  const ground = levelsOut[0];
  const footprint = ground?.footprint;
  if (footprint) {
    const elev = ground.elev;
    const groundCols = ground.columns;
    const groundZ = 0;
    if (f.type === "dados") {
      const size = f.padSize;
      const h = f.padDepth + elev;
      groundCols.forEach((p) => {
        solids.push({ level: 0, layer: "fundacion", shape: "beam", a: [p.x, p.y, groundZ - f.padDepth], b: [p.x, p.y, elev], w: size, h: size, material: "hormigon", vertical: true });
        totals.concrete += size * size * h;
        totals.excavation += size * size * f.padDepth;
        totals.formwork += 4 * size * Math.max(elev, 0);
        totals.rebar[10] += 4 * (h - 0.05 + 0.3);
        totals.rebar[6] += (Math.ceil(h / 0.15) + 1) * (4 * (size - 0.05) + 0.1);
      });
      if (project.levels.length > 1) warnings.push("Con más de un nivel, verificá el tamaño de los dados con un cálculo de cargas.");
    }
    if (f.type === "vigas_pilotines") {
      const w = f.beamWidth;
      const h = f.beamHeight;
      footprint.forEach((p, i) => {
        const q = footprint[(i + 1) % footprint.length];
        solids.push({ level: 0, layer: "fundacion", shape: "beam", a: [p.x, p.y, elev - h / 2], b: [q.x, q.y, elev - h / 2], w, h, material: "hormigon" });
      });
      const per = totals.perimeter;
      totals.concrete += per * w * h;
      totals.excavation += per * w * Math.max(h - elev, 0);
      totals.formwork += 2 * per * Math.max(elev, 0);
      totals.rebar[10] += per * 4;
      totals.rebar[6] += (Math.ceil(per / 0.2) + footprint.length) * (2 * (w + h) - 0.1);
      const piles = new Map();
      footprint.forEach((p, i) => {
        const q = footprint[(i + 1) % footprint.length];
        const L = Math.hypot(q.x - p.x, q.y - p.y);
        const n = Math.max(1, Math.ceil(L / f.pileSpacing - 1e-9));
        for (let k = 0; k < n; k += 1) {
          const pt = { x: p.x + ((q.x - p.x) * k) / n, y: p.y + ((q.y - p.y) * k) / n };
          piles.set(pointKey(pt), pt);
        }
      });
      const r = f.pileDiameter / 2;
      piles.forEach((pt) => {
        solids.push({ level: 0, layer: "fundacion", shape: "cylinder", center: [pt.x, pt.y, elev - h - f.pileDepth / 2], r, h: f.pileDepth, material: "hormigon" });
        totals.concrete += Math.PI * r * r * f.pileDepth;
        totals.excavation += Math.PI * r * r * f.pileDepth;
        totals.rebar[8] += 4 * (f.pileDepth + 0.4);
        totals.rebar[6] += Math.ceil(f.pileDepth / 0.2) * Math.PI * (f.pileDiameter - 0.05);
      });
      totals.piles = piles.size;
    }
    if (f.type === "platea") {
      const slabPoly = offsetPolygon(footprint, f.margin);
      const slabArea = Math.abs(polygonArea(slabPoly));
      const slabPer = polygonPerimeter(slabPoly);
      const t = f.slabThickness;
      solids.push({ level: 0, layer: "fundacion", shape: "prism", polygon: slabPoly, z0: elev - t, z1: elev, material: "hormigon" });
      const edgeH = Math.max(f.edgeBeamHeight - t, 0);
      const edgeLine = offsetPolygon(slabPoly, -f.edgeBeamWidth / 2);
      edgeLine.forEach((p, i) => {
        const q = edgeLine[(i + 1) % edgeLine.length];
        solids.push({ level: 0, layer: "fundacion", shape: "beam", a: [p.x, p.y, elev - t - edgeH / 2], b: [q.x, q.y, elev - t - edgeH / 2], w: f.edgeBeamWidth, h: edgeH, material: "hormigon" });
      });
      const edgePer = polygonPerimeter(edgeLine);
      totals.concrete += slabArea * t + edgePer * f.edgeBeamWidth * edgeH;
      totals.excavation += edgePer * f.edgeBeamWidth * Math.max(f.edgeBeamHeight - elev, 0);
      totals.formwork += slabPer * (elev + 0.05);
      totals.film += slabArea * 1.1 + slabPer * f.edgeBeamHeight;
      totals.gravel += slabArea * 0.1;
      totals.meshPanels = Math.ceil((slabArea * 1.15) / 14.4);
      totals.rebar[10] += edgePer * 4;
      totals.rebar[6] += (Math.ceil(edgePer / 0.2) + edgeLine.length) * (2 * (f.edgeBeamWidth + f.edgeBeamHeight) - 0.1);
      totals.slabArea = slabArea;
      totals.chemicalAnchors = Math.ceil(totals.perimeter / 1.2);
    }
    totals.anchorPlates = groundCols.length;
    totals.anchorBolts = groundCols.length * 4;
    // uniones abulonadas entre niveles apilados
    totals.stackPlates = levelsOut.slice(1).reduce((sum, l) => sum + l.columns.length, 0);
  } else {
    warnings.push("Sin contorno exterior cerrado en la planta baja no se calculan piso, techo ni fundación.");
  }

  // Identidades y paquetes del mismo modelo que alimenta visor, peso y cómputo.
  members.forEach((m) => { m.key = memberKey(m, project.levels[m.level], levelsOut[m.level]); });
  surfaces.forEach((sf) => {
    const center = sf.points[0]?.slice(0, 2).map((v) => round(v, 6)).join(",") ?? "empty";
    sf.key = `L${project.levels[sf.level].id}:surface:${sf.material}:${sf.wallId ?? "grid"}:${sf.openingId ?? sf.face ?? center}`;
    sf.packageLabel = sf.material === "piso" ? (sf.level === 0 ? "Piso" : "Entrepiso")
      : sf.material === "cubierta" ? "Techo" : sf.material === "escalon" ? "Escaleras" : sf.layer === "aberturas" ? "Aberturas" : "Muros";
    sf.layers = surfaceLayers(project, sf);
  });
  solids.forEach((solid) => {
    const point = solid.a ?? solid.center ?? [solid.polygon?.[0]?.x, solid.polygon?.[0]?.y];
    solid.key = `L${project.levels[solid.level].id}:foundation:${solid.shape}:${point.map((v) => round(v, 6)).join(",")}`;
  });

  return {
    members,
    solids,
    surfaces,
    footprint,
    levels: levelsOut,
    spanAxis: ground?.spanAxis ?? "x",
    wallSummaries,
    totals,
    stairs: stairLayouts,
    warnings: [...new Set(warnings)]
  };
}
