// Piezas de lo que queda a la intemperie: techo a un agua o terraza sobre la parte descubierta
// de un nivel, y balcones colgados de un muro exterior. Todo pasa por addMember / surfaces / solids,
// así el 3D, el cómputo, los cortes y el peso salen del mismo modelo.
import {
  area3D,
  distributePositions,
  pointInPolygon,
  pointOnWall,
  polygonArea,
  round,
  scanPolygon,
  unionOutline,
  wallDir,
  wallLength
} from "./geometry.js";
import { FLASHING_UPSTAND, GUARD, TERRACE, drainT, overhangRects } from "./exposed.js";
import { railAlong } from "./stair-build.js";

const FACE = 0.065; // de eje de muro a cara exterior del revestimiento
const TERRACE_SLOPE = 0.015;
export const MIN_ROOF_SLOPE = { chapa_sinusoidal: 10, chapa_trapezoidal: 5, panel_sandwich: 5 }; // % recomendado por fabricantes

const coord = (p, axis) => (axis === "x" ? p.x : p.y);
const pointAt = (runAxis, u, c) => (runAxis === "x" ? { x: u, y: c } : { x: c, y: u });
const move = (p, v, k) => ({ x: p.x + v.x * k, y: p.y + v.y * k });
const scanLoops = (loops, runAxis, c) => loops.flatMap((loop) => scanPolygon(loop, runAxis === "x" ? "y" : "x", c));
const len2 = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);

/** Qué hay más allá del extremo p de una pieza que corre en dirección dir. */
function endKind(p, dir, ctx) {
  const perp = { x: -dir.y, y: dir.x };
  const probes = [-1, 1].map((k) => ({ x: p.x + dir.x * 0.03 + perp.x * 0.01 * k, y: p.y + dir.y * 0.03 + perp.y * 0.01 * k }));
  if (probes.some((q) => pointInPolygon(q, ctx.above))) return "upper";
  if (probes.every((q) => !pointInPolygon(q, ctx.footprint))) return "exterior";
  return "neighbor";
}

/** Corta un segmento en las coordenadas de la grilla para clasificar cada tramo por separado. */
function splitSegment(p, q, coords) {
  const horizontal = Math.abs(p.y - q.y) < 1e-9;
  const a = horizontal ? p.x : p.y;
  const b = horizontal ? q.x : q.y;
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  const cuts = [...new Set([lo, ...coords.filter((v) => v > lo + 1e-6 && v < hi - 1e-6), hi])].sort((x, y) => x - y);
  const at = (v) => (horizontal ? { x: v, y: p.y } : { x: p.x, y: v });
  return cuts.slice(0, -1).map((v, i) => [at(v), at(cuts[i + 1])]);
}

/**
 * Plano de una parte descubierta.
 * techo: cara inferior de los cabios; apoya en el bastidor superior en el borde más bajo.
 * terraza: cara superior terminada; queda TERRACE.step por debajo del piso de arriba en su punto más alto.
 */
export function exposedPlane(part, cfg, env) {
  if (cfg.kind === "terraza") {
    const joistTop = Math.min(env.zTop, env.upFloorTop - TERRACE.step - TERRACE.finish - TERRACE_SLOPE * part.run);
    const top = (p) => joistTop + TERRACE.finish + TERRACE_SLOPE * (part.tMax - drainT(part, p));
    return { kind: "terraza", slope: TERRACE_SLOPE, joistTop, top, edgeZ: top };
  }
  const slope = Math.max(cfg.slope, 0) / 100;
  const under = (p) => env.zTop + slope * (part.tMax - drainT(part, p));
  return { kind: "techo", slope, under, edgeZ: under };
}

/** Aberturas del nivel de arriba sobre los bordes de la parte que tocan ese nivel. */
export function openingsOnUpperEdges(part, upperWalls) {
  const found = [];
  part.edges.filter((e) => e.kind === "upper").forEach((e) => {
    upperWalls.filter((w) => w.type === "exterior").forEach((w) => {
      const dir = wallDir(w);
      const off = (p) => Math.abs((p.x - w.a.x) * dir.y - (p.y - w.a.y) * dir.x);
      if (off(e.a) > 0.02 || off(e.b) > 0.02) return;
      const sOf = (p) => (p.x - w.a.x) * dir.x + (p.y - w.a.y) * dir.y;
      const lo = Math.min(sOf(e.a), sOf(e.b));
      const hi = Math.max(sOf(e.a), sOf(e.b));
      w.openings.forEach((o) => {
        const a = Math.max(lo, o.offset);
        const b = Math.min(hi, o.offset + o.width);
        if (b - a > 0.05) found.push({ wall: w, o, p1: pointOnWall(w, a), p2: pointOnWall(w, b) });
      });
    });
  });
  return found;
}

/**
 * Tramos de un muro exterior de abajo que quedan bajo una parte descubierta, con la altura
 * hasta donde sube el muro (relleno de hastial que cierra el entretecho, o frentín de terraza).
 */
export function exposedWallIntervals(wall, items, zTop) {
  const L = wallLength(wall);
  const dir = wallDir(wall);
  const sOf = (p) => (p.x - wall.a.x) * dir.x + (p.y - wall.a.y) * dir.y;
  const off = (p) => Math.abs((p.x - wall.a.x) * dir.y - (p.y - wall.a.y) * dir.x);
  const ivs = [];
  items.forEach(({ part, plane }) =>
    part.edges.filter((e) => e.kind === "exterior").forEach((e) => {
      if (off(e.a) > 0.01 || off(e.b) > 0.01) return;
      const s1 = Math.max(0, Math.min(sOf(e.a), sOf(e.b)));
      const s2 = Math.min(L, Math.max(sOf(e.a), sOf(e.b)));
      if (s2 - s1 < 1e-4) return;
      ivs.push({ s1, s2, kind: plane.kind, z: (sp) => Math.max(plane.edgeZ(pointOnWall(wall, sp)), zTop) });
    })
  );
  return ivs.sort((a, b) => a.s1 - b.s1);
}

/** Perfil superior del muro (s, z) con saltos donde empieza o termina una parte descubierta. */
export function wallTopProfile(L, ivs, zTop) {
  const pts = [];
  let cursor = 0;
  ivs.forEach((iv) => {
    if (iv.s1 > cursor + 1e-6) {
      if (!pts.length) pts.push({ s: 0, z: zTop });
      pts.push({ s: iv.s1, z: zTop });
    }
    pts.push({ s: iv.s1, z: iv.z(iv.s1) }, { s: iv.s2, z: iv.z(iv.s2) });
    cursor = iv.s2;
  });
  if (cursor < L - 1e-6) pts.push({ s: cursor, z: zTop }, { s: L, z: zTop });
  return pts.filter((p, i) => i === 0 || Math.abs(p.s - pts[i - 1].s) > 1e-6 || Math.abs(p.z - pts[i - 1].z) > 1e-6);
}

/** Techo a un agua sobre una parte descubierta: cabios, vigas de apoyo, cenefas y cubierta. */
export function buildExposedRoof(part, pi, plane, ctx) {
  const { add, prof, s, lv, surfaces, totals, cfg } = ctx;
  const rafter = prof("rafter");
  const d = part.d;
  const runAxis = Math.abs(d.x) > 0.5 ? "x" : "y";
  const posAxis = runAxis === "x" ? "y" : "x";
  const runDir = runAxis === "x" ? { x: 1, y: 0 } : { x: 0, y: 1 };
  const back = { x: -runDir.x, y: -runDir.y };
  const loops = unionOutline(overhangRects(part, cfg.overhang, ctx.above));
  const id = `descubierto:${pi}`;
  const zc = (p) => plane.under(p) + rafter.h / 2;

  // Cabios en el sentido de la pendiente; los que corren junto al nivel de arriba se corren a su cara
  const lateralUpper = part.edges.filter((e) => e.kind === "upper" && Math.abs(e.n.x * d.x + e.n.y * d.y) < 0.5);
  const blocked = lateralUpper.map((e) => coord(e.a, posAxis));
  const required = part.rects
    .flatMap((r) => (posAxis === "x" ? [r.x0, r.x1] : [r.y0, r.y1]))
    .filter((v) => !blocked.some((b) => Math.abs(b - v) < 1e-6))
    .concat(lateralUpper.map((e) => coord(e.a, posAxis) - coord(e.n, posAxis) * (FACE + rafter.b / 2)));
  const pcs = loops.flat().map((p) => coord(p, posAxis));
  let maxSpan = 0;
  distributePositions(Math.min(...pcs) + rafter.b / 2, Math.max(...pcs) - rafter.b / 2, s.roofSpacing, required).forEach((c) => {
    scanLoops(loops, runAxis, c).forEach(([u1, u2], j) => {
      let A = pointAt(runAxis, u1, c);
      let B = pointAt(runAxis, u2, c);
      if (endKind(A, back, ctx) === "upper") A = move(A, runDir, FACE);
      if (endKind(B, runDir, ctx) === "upper") B = move(B, back, FACE);
      const a3 = [A.x, A.y, zc(A)];
      const b3 = [B.x, B.y, zc(B)];
      const cut = Math.hypot(b3[0] - a3[0], b3[1] - a3[1], b3[2] - a3[2]);
      if (cut < 0.15) return;
      maxSpan = Math.max(maxSpan, len2(A, B));
      add("rafter", "Cabios", "techo", a3, b3, cut, { ...lv, identity: `${id}:cabio:${round(c, 4)}:${j}` });
    });
  });

  // Vigas de apoyo: contra el muro de arriba (abulonadas a sus columnas) y en el borde entre paños
  part.edges
    .filter((e) => (e.kind === "upper" || e.kind === "neighbor") && Math.abs(e.n.x * d.x + e.n.y * d.y) > 0.5)
    .forEach((e, k) => {
      const offset = e.kind === "upper" ? FACE + rafter.b / 2 : rafter.b / 2;
      const A = move(e.a, e.n, -offset);
      const B = move(e.b, e.n, -offset);
      const z = plane.under(A) - rafter.h / 2;
      add("rafter", e.kind === "upper" ? "Vigas de apoyo de cubierta" : "Vigas de borde entre paños", "techo", [A.x, A.y, z], [B.x, B.y, z], len2(A, B), { ...lv, identity: `${id}:apoyo:${k}` });
    });

  // Cenefas en los bordes libres perpendiculares a los cabios (alero bajo y borde alto)
  const upperPoints = Array.isArray(ctx.above[0]) ? ctx.above.flat() : ctx.above;
  const aboveXs = upperPoints.map((p) => p.x);
  const aboveYs = upperPoints.map((p) => p.y);
  loops.forEach((loop, li2) =>
    loop.forEach((p, i) => {
      const q = loop[(i + 1) % loop.length];
      if (Math.abs(coord(p, runAxis) - coord(q, runAxis)) > 1e-6) return; // lateral
      const out = pointInPolygon(move({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 }, runDir, 0.02), loop) ? back : runDir;
      // tramos libres contiguos se unen en una sola cenefa; contra el nivel de arriba no va
      const free = [];
      splitSegment(p, q, Math.abs(p.y - q.y) < 1e-9 ? aboveXs : aboveYs).forEach(([a, b]) => {
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        if (pointInPolygon(move(mid, out, 0.05), ctx.above)) return;
        const last = free[free.length - 1];
        if (last && len2(last[1], a) < 1e-6) last[1] = b;
        else free.push([a, b]);
      });
      free.forEach(([a, b], k) => {
        const z = zc({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
        add("roofEdge", "Cenefas", "techo", [a.x, a.y, z], [b.x, b.y, z], len2(a, b), { ...lv, identity: `${id}:cenefa:${li2}:${i}:${k}` });
      });
    })
  );

  loops.forEach((loop, k) => {
    const pts = loop.map((p) => [p.x, p.y, plane.under(p) + rafter.h]);
    const area = area3D(pts);
    surfaces.push({
      ...lv, layer: "cubierta", material: "cubierta", face: `${id}:${k}`, points: pts, holes: [], area,
      coveredArea_m2: k === 0 ? part.area : 0, roofType: "una_agua", slope_percent: cfg.slope, exposed: true
    });
    totals.roofArea += area;
    totals.exposedRoofArea += area;
    totals.roofPlanArea += Math.abs(polygonArea(loop));
  });
  totals.roofCoveredArea += part.area;
  const flashing = part.edges.filter((e) => e.kind === "upper").reduce((sum, e) => sum + e.length, 0);
  totals.flashing_m += flashing;
  return { maxSpan, flashing };
}

/** Terraza transitable: viguetas, vigas de borde, piso con membrana y baranda en los bordes libres. */
export function buildTerrace(part, pi, plane, ctx) {
  const { add, prof, s, lv, surfaces, totals, cfg } = ctx;
  const joist = prof("floorJoist");
  const ring = ctx.ring;
  const id = `terraza:${pi}`;
  const loops = part.outline;
  // viguetas en el sentido que deja la menor luz
  const spanFor = (runAxis) => {
    const posAxis = runAxis === "x" ? "y" : "x";
    const cs = [...new Set(part.rects.flatMap((r) => (posAxis === "x" ? [r.x0, r.x1] : [r.y0, r.y1])))].sort((a, b) => a - b);
    let max = 0;
    cs.slice(0, -1).forEach((c, i) => scanLoops(loops, runAxis, (c + cs[i + 1]) / 2).forEach(([u1, u2]) => { max = Math.max(max, u2 - u1); }));
    return max;
  };
  const runAxis = spanFor("x") <= spanFor("y") ? "x" : "y";
  const posAxis = runAxis === "x" ? "y" : "x";
  const runDir = runAxis === "x" ? { x: 1, y: 0 } : { x: 0, y: 1 };
  const back = { x: -runDir.x, y: -runDir.y };
  const zJ = plane.joistTop - joist.h / 2;
  const trimFor = (kind) => (kind === "exterior" ? ring.b / 2 : kind === "upper" ? FACE + joist.b : joist.b / 2);
  const parallel = part.edges.filter((e) => Math.abs(coord(e.n, posAxis)) > 0.5);
  const pcs = loops.flat().map((p) => coord(p, posAxis));
  let maxSpan = 0;
  distributePositions(Math.min(...pcs), Math.max(...pcs), s.floorSpacing)
    .filter((c) => !parallel.some((e) => Math.abs(coord(e.a, posAxis) - c) < (e.kind === "upper" ? FACE + joist.b * 1.5 : e.kind === "exterior" ? (ring.b + joist.b) / 2 : joist.b)))
    .forEach((c) => {
      scanLoops(loops, runAxis, c).forEach(([u1, u2], j) => {
        let A = pointAt(runAxis, u1, c);
        let B = pointAt(runAxis, u2, c);
        maxSpan = Math.max(maxSpan, u2 - u1);
        A = move(A, runDir, trimFor(endKind(A, back, ctx)));
        B = move(B, back, trimFor(endKind(B, runDir, ctx)));
        const cut = len2(A, B);
        if (cut < 0.15) return;
        add("floorJoist", "Viguetas de terraza", "balcones", [A.x, A.y, zJ], [B.x, B.y, zJ], cut, { ...lv, identity: `${id}:vigueta:${round(c, 4)}:${j}` });
      });
    });
  part.edges.filter((e) => e.kind === "upper" || e.kind === "neighbor").forEach((e, k) => {
    const offset = e.kind === "upper" ? FACE + joist.b / 2 : joist.b / 2;
    const A = move(e.a, e.n, -offset);
    const B = move(e.b, e.n, -offset);
    add("floorJoist", "Vigas de borde de terraza", "balcones", [A.x, A.y, zJ], [B.x, B.y, zJ], len2(A, B), { ...lv, identity: `${id}:borde:${k}` });
  });

  const points = loops[0].map((p) => [p.x, p.y, plane.top(p)]);
  const area = area3D(points);
  surfaces.push({
    ...lv, layer: "cubierta", material: "cubierta", style: "terraza", access: "terraza", face: id, points, holes: [], area,
    coveredArea_m2: part.area, roofType: "plano", slope_percent: TERRACE_SLOPE * 100, exposed: true
  });
  totals.terraceArea += part.area;
  const upperLen = part.edges.filter((e) => e.kind === "upper").reduce((sum, e) => sum + e.length, 0);
  const extEdges = part.edges.filter((e) => e.kind === "exterior");
  totals.terraceFlashing_m += upperLen;
  totals.dripEdge_m += extEdges.reduce((sum, e) => sum + e.length, 0);
  totals.drains += Math.max(1, Math.ceil(part.area / 25));

  // Baranda en los bordes libres, metida 5 cm; en las esquinas los tramos se encuentran
  let railing = 0;
  if (cfg.railing !== false) {
    const pull = (p, e) => {
      let r = move(p, e.n, -0.05);
      part.edges.forEach((o) => {
        if (o === e || Math.abs(o.n.x * e.n.x + o.n.y * e.n.y) > 1e-6) return;
        if (![o.a, o.b].some((q) => len2(q, p) < 1e-6)) return;
        if (o.kind === "exterior") r = move(r, o.n, -0.05);
        if (o.kind === "upper") r = move(r, o.n, -(FACE + 0.02));
      });
      return r;
    };
    extEdges.forEach((e, k) => {
      const A = pull(e.a, e);
      const B = pull(e.b, e);
      const res = railAlong(ctx.addRail, {
        a: A, b: B, za: plane.top(A), zb: plane.top(B), height: GUARD.height, kind: "baranda", gap: GUARD.gap,
        identity: `${id}:baranda:${k}`, prof, lv, placed: ctx.placed
      });
      railing += res.handrail_m;
    });
  }
  return { maxSpan, area, railing };
}

/**
 * Balcón colgado de un muro exterior. depth es la profundidad libre desde la cara del muro.
 * support "voladizo": vigas soldadas al bastidor inferior con cartela; "columnas": apoyo en el frente.
 */
/** Planta de un balcón: tramo del muro que ocupa, normal hacia afuera y contorno del piso. */
export function balconyGeometry(bal, wall, footprint) {
  const L = wallLength(wall);
  const dir = wallDir(wall);
  const mid = pointOnWall(wall, L / 2);
  let n = { x: dir.y, y: -dir.x };
  if (footprint && pointInPolygon(move(mid, n, 0.2), footprint)) n = { x: -n.x, y: -n.y };
  const s0 = Math.min(Math.max(bal.offset, 0), Math.max(L - 0.6, 0));
  const s1 = Math.min(s0 + bal.width, L);
  const at = (sp, depth) => move(pointOnWall(wall, sp), n, depth);
  const poly = [at(s0, FACE), at(s1, FACE), at(s1, FACE + bal.depth), at(s0, FACE + bal.depth)];
  return { L, n, s0, s1, at, poly };
}

export function buildBalcony(bal, bi, ctx) {
  const { add, prof, lv, surfaces, solids, totals, footprint, floorTop } = ctx;
  const wall = ctx.walls.find((w) => w.id === bal.wallId);
  if (!wall || wall.type !== "exterior" || !footprint) return null;
  const { L, s0, s1, at } = balconyGeometry(bal, wall, footprint);
  const D = bal.depth;
  const id = `balcon:${bal.id}`;
  const beam = prof("balconyBeam");
  const post = prof("landingPost");
  const deckZ = floorTop - 0.04;
  const zB = deckZ - 0.05 - beam.h / 2;
  const front = FACE + D;
  const stats = { id: bal.id, wallId: wall.id, cantilevers: 0, gussets: 0, posts: 0, area: 0, railing_m: 0, warnings: [] };
  const warn = (text) => {
    stats.warnings.push(text);
    ctx.warn(text);
  };

  // Vigas perpendiculares al muro (las de los costados también hacen de borde)
  const positions = distributePositions(s0 + beam.b / 2, s1 - beam.b / 2, 0.6);
  positions.forEach((sp, k) => {
    const A = at(sp, ctx.ring.b / 2);
    const B = at(sp, front - beam.b);
    add("balconyBeam", bal.support === "voladizo" ? "Vigas de balcón en voladizo" : "Vigas de balcón", "balcones", [A.x, A.y, zB], [B.x, B.y, zB], len2(A, B), { ...lv, identity: `${id}:viga:${k}` });
    stats.cantilevers += 1;
  });
  if (bal.support === "voladizo") stats.gussets = positions.length;
  const F0 = at(s0, front - beam.b / 2);
  const F1 = at(s1, front - beam.b / 2);
  add("balconyBeam", "Vigas de balcón", "balcones", [F0.x, F0.y, zB], [F1.x, F1.y, zB], len2(F0, F1), { ...lv, identity: `${id}:frente` });

  // Columnas al terreno con su dado, si no hay otro nivel debajo de ese punto
  if (bal.support === "columnas") {
    const count = Math.max(1, Math.ceil((s1 - s0 - post.b) / 3 - 1e-9));
    const zTopPost = zB - beam.h / 2;
    for (let k = 0; k <= count; k += 1) {
      const sp = s0 + post.b / 2 + ((s1 - s0 - post.b) * k) / count;
      const p = at(sp, front - post.b / 2);
      if (ctx.lowerFootprints.some((fp) => fp && pointInPolygon(p, fp))) {
        warn(`una columna del balcón cae sobre ${ctx.lowerName}: apoyala en su estructura o usá voladizo.`);
        continue;
      }
      add("landingPost", "Columnas de balcón", "balcones", [p.x, p.y, 0.05], [p.x, p.y, zTopPost], zTopPost - 0.05, { ...lv, identity: `${id}:columna:${k}` });
      const size = 0.4;
      const depth = 0.6;
      solids.push({ level: lv.level, layer: "fundacion", shape: "beam", a: [p.x, p.y, -depth], b: [p.x, p.y, 0.05], w: size, h: size, material: "hormigon", vertical: true });
      totals.concrete += size * size * (depth + 0.05);
      totals.excavation += size * size * depth;
      totals.rebar[10] += 4 * (depth + 0.3);
      totals.rebar[6] += (Math.ceil((depth + 0.05) / 0.15) + 1) * (4 * (size - 0.05) + 0.1);
      stats.posts += 1;
    }
  }

  // Piso del balcón
  const P = [at(s0, FACE), at(s1, FACE), at(s1, front), at(s0, front)];
  const area = (s1 - s0) * D;
  surfaces.push({ ...lv, layer: "balcones", material: "balcon", face: id, points: P.map((p) => [p.x, p.y, deckZ]), holes: [], area });
  stats.area = area;
  totals.balconyArea += area;
  totals.dripEdge_m += D * 2 + (s1 - s0);

  // Baranda en los tres bordes libres
  if (bal.railing !== false) {
    const c0 = at(s0 + 0.04, front - 0.04);
    const c1 = at(s1 - 0.04, front - 0.04);
    const segs = [[at(s0 + 0.04, FACE + 0.02), c0], [c0, c1], [c1, at(s1 - 0.04, FACE + 0.02)]];
    segs.forEach(([a, b], k) => {
      const r = railAlong(ctx.addRail, { a, b, za: deckZ, zb: deckZ, height: GUARD.height, kind: "baranda", gap: GUARD.gap, identity: `${id}:baranda:${k}`, prof, lv, placed: ctx.placed });
      stats.railing_m += r.handrail_m;
    });
  }

  // Avisos
  const door = wall.openings.some((o) => o.kind === "door" && Math.min(o.offset + o.width, s1) - Math.max(o.offset, s0) > 0.3);
  if (!door) warn("no tiene puerta: agregá una puerta en ese muro, dentro del ancho del balcón.");
  if (bal.support === "voladizo" && D > 1.5) warn(`${round(D, 2)} m en voladizo es mucho para tubos soldados al bastidor: usá columnas o hacelo verificar.`);
  else if (bal.support === "voladizo" && D > 1.2) warn(`voladizo de ${round(D, 2)} m: verificá la torsión del bastidor y la flecha antes de construir.`);
  if (ctx.lowerFootprints.some((fp) => fp && [P[2], P[3], { x: (P[2].x + P[3].x) / 2, y: (P[2].y + P[3].y) / 2 }].some((p) => pointInPolygon(p, fp)))) {
    warn(`queda encima de ${ctx.lowerName}: si es la parte descubierta, conviene hacerla terraza.`);
  }
  if (bal.offset + bal.width > L + 1e-6) warn("es más ancho que el muro: se recortó al largo del muro.");
  stats.poly = P;
  stats.deckZ = deckZ;
  return stats;
}
