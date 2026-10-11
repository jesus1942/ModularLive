// Generador de piezas: a partir del modelo de obra produce cada pieza real
// (posición 3D + largo de corte), los sólidos de fundación y las superficies de cerramiento.
// El visor 3D y el cómputo de materiales se alimentan de este mismo resultado.
import {
  EPS,
  area3D,
  bbox,
  clipPolygonHalfPlane,
  distributePositions,
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
import { findFootprint, validateOpenings } from "./model.js";

const DECK_THICKNESS = 0.018;
const MIN_FILL = 0.15; // relleno de hastial por debajo de esto se resuelve con calces

export function generate(project) {
  const system = SYSTEMS[project.system];
  const roles = { ...system.roles, column: project.mainFrame, ringBeam: project.mainFrame };
  const prof = (role) => PROFILES[roles[role]];
  const s = project.settings;
  const warnings = [...validateOpenings(project)];

  const members = [];
  const solids = [];
  const surfaces = [];
  let memberSeq = 0;

  const wallById = new Map(project.walls.map((w) => [w.id, w]));
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

  const footprintInfo = findFootprint(project.walls);
  warnings.push(...footprintInfo.warnings);
  const footprint = footprintInfo.polygon;

  // ---------- Niveles ----------
  const f = project.foundation;
  const elevated = f.type !== "platea";
  const ring = prof("ringBeam");
  const elev = f.elevation;
  const floorTop = elevated ? elev + ring.h + DECK_THICKNESS : elev;
  const zTop = floorTop + s.wallHeight; // cara superior del bastidor superior
  const levels = { elev, floorTop, zTop };

  // ---------- Geometría del techo ----------
  let roofFn = () => zTop;
  let spanAxis = "x";
  let uRange = [0, 0];
  if (footprint) {
    const bb = bbox(footprint);
    spanAxis = bb.maxX - bb.minX <= bb.maxY - bb.minY ? "x" : "y";
    uRange = spanAxis === "x" ? [bb.minX, bb.maxX] : [bb.minY, bb.maxY];
    const slope = Math.max(project.roof.slope, 0) / 100;
    const [umin, umax] = uRange;
    const umid = (umin + umax) / 2;
    const half = (umax - umin) / 2;
    const uOf = (p) => (spanAxis === "x" ? p.x : p.y);
    if (project.roof.type === "dos_aguas") {
      roofFn = (p) => zTop + slope * (half - Math.abs(uOf(p) - umid));
    } else {
      roofFn = (p) => zTop + slope * (uOf(p) - umin);
    }
  }
  const roofUnderside = roofFn; // cara inferior de cabios en un punto de planta

  // ---------- Columnas y bastidores (solo sistemas con bastidor principal) ----------
  const exteriorWalls = project.walls.filter((w) => w.type === "exterior");
  const interiorWalls = project.walls.filter((w) => w.type === "interior");
  const columnNodes = new Map();
  const wallColumns = new Map(); // wall.id -> posiciones s de columnas

  const openingSpans = (wall) => wall.openings.map((o) => [o.offset, o.offset + o.width]);
  const insideOpening = (wall, sPos, margin = 0) =>
    openingSpans(wall).some(([a, b]) => sPos > a - margin && sPos < b + margin);

  if (system.hasMainFrame) {
    const col = prof("column");
    exteriorWalls.forEach((wall) => {
      const L = wallLength(wall);
      const n = Math.max(1, Math.ceil(L / system.defaults.maxColumnSpacing - 1e-9));
      const positions = [0];
      for (let k = 1; k < n; k += 1) {
        let pos = (L * k) / n;
        const hit = openingSpans(wall).find(([a, b]) => pos > a - col.b && pos < b + col.b);
        if (hit) {
          const left = hit[0] - col.b;
          const right = hit[1] + col.b;
          pos = pos - left < right - pos ? left : right;
        }
        if (pos > col.b && pos < L - col.b) positions.push(pos);
      }
      positions.push(L);
      const unique = [...new Set(positions.map((v) => round(v, 4)))].sort((a, b) => a - b);
      wallColumns.set(wall.id, unique);
      unique.forEach((pos) => {
        const p = pointOnWall(wall, pos);
        columnNodes.set(pointKey(p), p);
      });
    });

    columnNodes.forEach((p) => {
      addMember("column", "Columnas", "estructura", [p.x, p.y, elev], [p.x, p.y, zTop], zTop - elev);
    });

    exteriorWalls.forEach((wall) => {
      const cols = wallColumns.get(wall.id);
      for (let i = 0; i + 1 < cols.length; i += 1) {
        const pa = pointOnWall(wall, cols[i]);
        const pb = pointOnWall(wall, cols[i + 1]);
        const cut = cols[i + 1] - cols[i] - col.b;
        const zb = elev + ring.h / 2;
        const zt = zTop - ring.h / 2;
        addMember("ringBeam", "Bastidor inferior", "estructura", [pa.x, pa.y, zb], [pb.x, pb.y, zb], cut, { wallId: wall.id });
        addMember("ringBeam", "Bastidor superior", "estructura", [pa.x, pa.y, zt], [pb.x, pb.y, zt], cut, { wallId: wall.id });
      }
    });
  }

  // ---------- Muros: montantes, aberturas y rellenos ----------
  const stud = prof("stud");
  const track = prof("track");
  const frame = prof("openingFrame");
  const colB = system.hasMainFrame ? prof("column").b : 0;

  const wallSummaries = [];

  const buildOpenings = (wall, zBase, studBottom, studTop) => {
    const pt = (sPos, z) => {
      const p = pointOnWall(wall, sPos);
      return [p.x, p.y, z];
    };
    wall.openings.forEach((o) => {
      const left = o.offset;
      const right = o.offset + o.width;
      const bottom = zBase + o.sill;
      const top = zBase + o.sill + o.height;
      // jambas de altura completa
      [left - stud.b / 2, right + stud.b / 2].forEach((sp) => {
        addMember("stud", "Montantes", "estructura", pt(sp, studBottom), pt(sp, studTop), studTop - studBottom, { wallId: wall.id });
      });
      // dintel y antepecho
      addMember("stud", "Dinteles y antepechos", "estructura", pt(left, top + stud.b / 2), pt(right, top + stud.b / 2), o.width, { wallId: wall.id });
      if (o.kind === "window") {
        addMember("stud", "Dinteles y antepechos", "estructura", pt(left, bottom - stud.b / 2), pt(right, bottom - stud.b / 2), o.width, { wallId: wall.id });
      }
      // marco perimetral de la abertura
      addMember("openingFrame", "Marcos de aberturas", "estructura", pt(left + frame.b / 2, bottom), pt(left + frame.b / 2, top), o.height, { wallId: wall.id });
      addMember("openingFrame", "Marcos de aberturas", "estructura", pt(right - frame.b / 2, bottom), pt(right - frame.b / 2, top), o.height, { wallId: wall.id });
      addMember("openingFrame", "Marcos de aberturas", "estructura", pt(left, top - frame.b / 2), pt(right, top - frame.b / 2), o.width, { wallId: wall.id });
      if (o.kind === "window") {
        addMember("openingFrame", "Marcos de aberturas", "estructura", pt(left, bottom + frame.b / 2), pt(right, bottom + frame.b / 2), o.width, { wallId: wall.id });
      }
      // montantes cortos (cripples) sobre dintel y bajo antepecho
      const inner = distributePositions(left, right, s.wallSpacing).slice(1, -1);
      inner.forEach((sp) => {
        const upperFrom = top + stud.b;
        if (studTop - upperFrom > 0.05) {
          addMember("stud", "Montantes", "estructura", pt(sp, upperFrom), pt(sp, studTop), studTop - upperFrom, { wallId: wall.id });
        }
        if (o.kind === "window") {
          const lowerTo = bottom - stud.b;
          if (lowerTo - studBottom > 0.05) {
            addMember("stud", "Montantes", "estructura", pt(sp, studBottom), pt(sp, lowerTo), lowerTo - studBottom, { wallId: wall.id });
          }
        }
      });
      // panel de abertura para el 3D
      surfaces.push({
        layer: "aberturas",
        material: o.kind === "door" ? "puerta" : "vidrio",
        points: [pt(left, bottom), pt(right, bottom), pt(right, top), pt(left, top)],
        holes: [],
        area: o.width * o.height,
        countsFor: null
      });
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
    const probe = { x: mid.x + dir.y * 0.2, y: mid.y - dir.x * 0.2 };
    return pointInPolygon(probe, footprint) ? -1 : 1;
  };

  const openingHoles = (wall, toPoint, zBase) =>
    wall.openings.map((o) => [
      toPoint(o.offset, zBase + o.sill),
      toPoint(o.offset + o.width, zBase + o.sill),
      toPoint(o.offset + o.width, zBase + o.sill + o.height),
      toPoint(o.offset, zBase + o.sill + o.height)
    ]);

  const openingArea = (wall) => wall.openings.reduce((sum, o) => sum + o.width * o.height, 0);

  // Contorno superior de un muro exterior siguiendo la cara inferior del techo
  const topBreakpoints = (wall) => {
    const L = wallLength(wall);
    const pts = [0, L];
    if (footprint && project.roof.type === "dos_aguas") {
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
    const cols = wallColumns.get(wall.id) ?? [0, L];
    const studBottom = system.hasMainFrame ? elev + ring.h : floorTop + track.b;
    const studTop = system.hasMainFrame ? zTop - ring.h : zTop - track.b;
    const regular = distributePositions(0, L, s.wallSpacing, cols).filter((sp) => {
      if (cols.some((c) => Math.abs(sp - c) < colB / 2 + stud.b / 2)) return false;
      if (insideOpening(wall, sp, stud.b * 1.5)) return false;
      return true;
    });
    const pt = (sp, z) => {
      const p = pointOnWall(wall, sp);
      return [p.x, p.y, z];
    };
    regular.forEach((sp) => {
      addMember("stud", "Montantes", "estructura", pt(sp, studBottom), pt(sp, studTop), studTop - studBottom, { wallId: wall.id });
    });
    buildOpenings(wall, floorTop, studBottom, studTop);

    // Relleno de hastial / muro alto de una agua
    let fillArea = 0;
    if (footprint) {
      const parallelToSpan = spanAxis === "x" ? Math.abs(dir.y) < 1e-3 : Math.abs(dir.x) < 1e-3;
      const fillPositions = distributePositions(0, L, s.wallSpacing, cols);
      let maxFill = 0;
      fillPositions.forEach((sp) => {
        const p = pointOnWall(wall, sp);
        const fill = roofUnderside(p) - zTop;
        maxFill = Math.max(maxFill, fill);
        if (fill > MIN_FILL) {
          addMember("stud", "Relleno de hastial", "estructura", [p.x, p.y, zTop], [p.x, p.y, zTop + fill], fill, { wallId: wall.id });
        }
      });
      if (maxFill > MIN_FILL && !parallelToSpan) {
        const z = roofUnderside(wall.a) - track.b / 2;
        addMember("track", "Relleno de hastial", "estructura", [wall.a.x, wall.a.y, z], [wall.b.x, wall.b.y, z], L, { wallId: wall.id });
      }
      if (Math.abs(dir.x) > 1e-3 && Math.abs(dir.y) > 1e-3) {
        warnings.push("Hay muros exteriores no ortogonales: el relleno bajo techo se aproxima.");
      }
      const bps = topBreakpoints(wall);
      for (let i = 0; i + 1 < bps.length; i += 1) {
        const f1 = Math.max(roofUnderside(pointOnWall(wall, bps[i])) - zTop, 0);
        const f2 = Math.max(roofUnderside(pointOnWall(wall, bps[i + 1])) - zTop, 0);
        fillArea += ((f1 + f2) / 2) * (bps[i + 1] - bps[i]);
      }
    }

    // Superficies de cerramiento
    const sign = outwardSign(wall);
    const extPt = wallFrameAt(wall, sign * 0.065);
    const intPt = wallFrameAt(wall, -sign * 0.065);
    const bps = topBreakpoints(wall);
    const topZ = (sp) => Math.max(roofUnderside(pointOnWall(wall, sp)), zTop);
    const extOutline = [extPt(0, elev), extPt(L, elev), ...[...bps].reverse().map((sp) => extPt(sp, topZ(sp)))];
    const extArea = area3D(extOutline) - openingArea(wall);
    surfaces.push({
      layer: "cerramientos",
      material: "exterior",
      points: extOutline,
      holes: openingHoles(wall, extPt, floorTop),
      area: extArea
    });
    const intOutline = [intPt(0, floorTop), intPt(L, floorTop), intPt(L, zTop), intPt(0, zTop)];
    const intArea = L * s.wallHeight - openingArea(wall);
    surfaces.push({
      layer: "cerramientos",
      material: "interior",
      points: intOutline,
      holes: openingHoles(wall, intPt, floorTop),
      area: intArea
    });
    wallSummaries.push({ wallId: wall.id, type: "exterior", length: L, extArea, intArea, fillArea, openingArea: openingArea(wall) });
  });

  interiorWalls.forEach((wall) => {
    const L = wallLength(wall);
    const studBottom = floorTop + track.b;
    const studTop = zTop - track.b;
    const pt = (sp, z) => {
      const p = pointOnWall(wall, sp);
      return [p.x, p.y, z];
    };
    // solera inferior cortada en puertas, solera superior continua
    const doorSpans = wall.openings.filter((o) => o.kind === "door").map((o) => [o.offset, o.offset + o.width]).sort((a, b) => a[0] - b[0]);
    let cursor = 0;
    [...doorSpans, [L, L]].forEach(([a, b]) => {
      if (a - cursor > 0.05) {
        addMember("track", "Soleras", "estructura", pt(cursor, floorTop + track.b / 2), pt(a, floorTop + track.b / 2), a - cursor, { wallId: wall.id });
      }
      cursor = b;
    });
    addMember("track", "Soleras", "estructura", pt(0, zTop - track.b / 2), pt(L, zTop - track.b / 2), L, { wallId: wall.id });
    const regular = distributePositions(0, L, s.wallSpacing).filter((sp) => !insideOpening(wall, sp, stud.b * 1.5));
    regular.forEach((sp) => {
      const clamped = Math.min(Math.max(sp, stud.b / 2), L - stud.b / 2);
      addMember("stud", "Montantes", "estructura", pt(clamped, studBottom), pt(clamped, studTop), studTop - studBottom, { wallId: wall.id });
    });
    buildOpenings(wall, floorTop, studBottom, studTop);
    const pA = wallFrameAt(wall, 0.065);
    const pB = wallFrameAt(wall, -0.065);
    const area = L * s.wallHeight - openingArea(wall);
    [pA, pB].forEach((toPt) => {
      surfaces.push({
        layer: "cerramientos",
        material: "interior",
        points: [toPt(0, floorTop), toPt(L, floorTop), toPt(L, zTop), toPt(0, zTop)],
        holes: openingHoles(wall, toPt, floorTop),
        area
      });
    });
    wallSummaries.push({ wallId: wall.id, type: "interior", length: L, faceArea: area, openingArea: openingArea(wall) });
  });

  // ---------- Piso ----------
  const totals = {
    footprintArea: 0,
    roofArea: 0,
    roofPlanArea: 0,
    perimeter: 0,
    floorDeckArea: 0,
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
    columns: columnNodes.size
  };

  const scanAxis = spanAxis === "x" ? "y" : "x"; // eje sobre el que se distribuyen viguetas y cabios
  const bOf = (p) => (scanAxis === "x" ? p.x : p.y);
  const makePoint = (u, b) => (spanAxis === "x" ? { x: u, y: b } : { x: b, y: u });

  if (footprint) {
    totals.footprintArea = polygonArea(footprint);
    totals.perimeter = polygonPerimeter(footprint);

    if (elevated) {
      const joist = prof("floorJoist");
      const bCoords = footprint.map(bOf);
      const bMin = Math.min(...bCoords);
      const bMax = Math.max(...bCoords);
      const positions = distributePositions(bMin, bMax, s.floorSpacing, bCoords).filter(
        (c) => !bCoords.some((v) => Math.abs(v - c) < (ring.b + joist.b) / 2)
      );
      const zJ = elev + ring.h - joist.h / 2;
      let maxSpan = 0;
      positions.forEach((c) => {
        scanPolygon(footprint, scanAxis, c).forEach(([u1, u2]) => {
          const p1 = makePoint(u1 + ring.b / 2, c);
          const p2 = makePoint(u2 - ring.b / 2, c);
          maxSpan = Math.max(maxSpan, u2 - u1);
          addMember("floorJoist", "Viguetas de piso", "piso", [p1.x, p1.y, zJ], [p2.x, p2.y, zJ], u2 - u1 - ring.b);
        });
      });
      if (maxSpan > system.defaults.maxJoistSpan) {
        warnings.push(`Las viguetas de piso salvan ${round(maxSpan, 2)} m: verificá la sección o agregá una viga intermedia con apoyo.`);
      }
      totals.floorDeckArea = totals.footprintArea;
      surfaces.push({
        layer: "piso",
        material: "piso",
        points: footprint.map((p) => [p.x, p.y, floorTop]),
        holes: [],
        area: totals.footprintArea
      });
    } else {
      surfaces.push({
        layer: "piso",
        material: "platea",
        points: footprint.map((p) => [p.x, p.y, floorTop + 0.002]),
        holes: [],
        area: totals.footprintArea
      });
    }

    // ---------- Techo ----------
    const roofOutline = offsetPolygon(footprint, project.roof.overhang);
    const rafter = prof("rafter");
    const [umin, umax] = uRange;
    const umid = (umin + umax) / 2;
    const bCoordsRoof = [...footprint.map(bOf), ...roofOutline.map(bOf)];
    const rbMin = Math.min(...bCoordsRoof);
    const rbMax = Math.max(...bCoordsRoof);
    const rafterPositions = distributePositions(rbMin + rafter.b / 2, rbMax - rafter.b / 2, s.roofSpacing, footprint.map(bOf));
    const rafterPoint = (u, c) => {
      const p = makePoint(u, c);
      return [p.x, p.y, roofUnderside(p) + rafter.h / 2];
    };
    const ridge = prof("ridge");
    rafterPositions.forEach((c) => {
      scanPolygon(roofOutline, scanAxis, c).forEach(([u1, u2]) => {
        const segments = project.roof.type === "dos_aguas" && u1 < umid && u2 > umid ? [[u1, umid - ridge.b / 2], [umid + ridge.b / 2, u2]] : [[u1, u2]];
        segments.forEach(([a, b]) => {
          const A = rafterPoint(a, c);
          const B = rafterPoint(b, c);
          const len = Math.hypot(B[0] - A[0], B[1] - A[1], B[2] - A[2]);
          addMember("rafter", "Cabios", "techo", A, B, len);
        });
      });
    });
    if (project.roof.type === "dos_aguas") {
      scanPolygon(roofOutline, spanAxis, umid).forEach(([b1, b2]) => {
        const p1 = makePoint(umid, b1);
        const p2 = makePoint(umid, b2);
        const z = roofUnderside(p1) + rafter.h - ridge.h / 2;
        addMember("ridge", "Cumbrera", "techo", [p1.x, p1.y, z], [p2.x, p2.y, z], b2 - b1);
      });
    }
    // cenefas en los bordes del alero perpendiculares a los cabios
    roofOutline.forEach((p, i) => {
      const q = roofOutline[(i + 1) % roofOutline.length];
      const du = spanAxis === "x" ? q.x - p.x : q.y - p.y;
      if (Math.abs(du) > EPS) return; // borde paralelo a los cabios: lo cubre un cabio
      const za = roofUnderside(p) + rafter.h / 2;
      addMember("roofEdge", "Cenefas", "techo", [p.x, p.y, za], [q.x, q.y, za], Math.hypot(q.x - p.x, q.y - p.y));
    });

    // superficies de cubierta
    const lift = rafter.h;
    const planes =
      project.roof.type === "dos_aguas"
        ? [
            clipPolygonHalfPlane(roofOutline, spanAxis, umid, "below"),
            clipPolygonHalfPlane(roofOutline, spanAxis, umid, "above")
          ].filter((pl) => pl.length >= 3)
        : [roofOutline];
    planes.forEach((plane) => {
      const pts = plane.map((p) => [p.x, p.y, roofUnderside(p) + lift]);
      const area = area3D(pts);
      totals.roofArea += area;
      surfaces.push({ layer: "cubierta", material: "cubierta", points: pts, holes: [], area });
    });
    totals.roofPlanArea = Math.abs(polygonArea(roofOutline));

    // ---------- Fundación ----------
    const groundZ = 0;
    if (f.type === "dados") {
      const size = f.padSize;
      const height = f.padDepth + elev;
      columnNodes.forEach((p) => {
        solids.push({
          layer: "fundacion",
          shape: "beam",
          a: [p.x, p.y, groundZ - f.padDepth],
          b: [p.x, p.y, elev],
          w: size,
          h: size,
          material: "hormigon",
          vertical: true
        });
        totals.concrete += size * size * height;
        totals.excavation += size * size * f.padDepth;
        totals.formwork += 4 * size * Math.max(elev, 0);
        totals.rebar[10] += 4 * (height - 0.05 + 0.3);
        totals.rebar[6] += (Math.ceil(height / 0.15) + 1) * (4 * (size - 0.05) + 0.1);
      });
      totals.anchorPlates = columnNodes.size;
      totals.anchorBolts = columnNodes.size * 4;
    }
    if (f.type === "vigas_pilotines") {
      const w = f.beamWidth;
      const h = f.beamHeight;
      footprint.forEach((p, i) => {
        const q = footprint[(i + 1) % footprint.length];
        solids.push({ layer: "fundacion", shape: "beam", a: [p.x, p.y, elev - h / 2], b: [q.x, q.y, elev - h / 2], w, h, material: "hormigon" });
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
        const top = elev - h;
        solids.push({ layer: "fundacion", shape: "cylinder", center: [pt.x, pt.y, top - f.pileDepth / 2], r, h: f.pileDepth, material: "hormigon" });
        totals.concrete += Math.PI * r * r * f.pileDepth;
        totals.excavation += Math.PI * r * r * f.pileDepth;
        totals.rebar[8] += 4 * (f.pileDepth + 0.4);
        totals.rebar[6] += Math.ceil(f.pileDepth / 0.2) * Math.PI * (f.pileDiameter - 0.05);
      });
      totals.piles = piles.size;
      totals.anchorPlates = columnNodes.size;
      totals.anchorBolts = columnNodes.size * 4;
    }
    if (f.type === "platea") {
      const slabPoly = offsetPolygon(footprint, f.margin);
      const slabArea = Math.abs(polygonArea(slabPoly));
      const slabPer = polygonPerimeter(slabPoly);
      const t = f.slabThickness;
      solids.push({ layer: "fundacion", shape: "prism", polygon: slabPoly, z0: elev - t, z1: elev, material: "hormigon" });
      const edgeH = Math.max(f.edgeBeamHeight - t, 0);
      const edgeLine = offsetPolygon(slabPoly, -f.edgeBeamWidth / 2);
      edgeLine.forEach((p, i) => {
        const q = edgeLine[(i + 1) % edgeLine.length];
        solids.push({ layer: "fundacion", shape: "beam", a: [p.x, p.y, elev - t - edgeH / 2], b: [q.x, q.y, elev - t - edgeH / 2], w: f.edgeBeamWidth, h: edgeH, material: "hormigon" });
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
      totals.anchorPlates = columnNodes.size;
      totals.anchorBolts = columnNodes.size * 4;
      totals.chemicalAnchors = Math.ceil(totals.perimeter / 1.2);
    }
  } else {
    warnings.push("Sin contorno exterior cerrado no se calculan piso, techo ni fundación.");
  }

  return {
    members,
    solids,
    surfaces,
    footprint,
    levels,
    spanAxis,
    wallSummaries,
    totals,
    warnings: [...new Set(warnings)]
  };
}
