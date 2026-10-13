// Piezas reales de escaleras, barandas y bordes de hueco a partir de layoutStair().
// Todas las piezas pasan por addMember (3D, cómputo, cortes y peso) o por surfaces.
import { round } from "./geometry.js";

const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const len = (v) => Math.hypot(v.x, v.y);

/** ¿El segmento ab corre pegado a algún muro (paralelo y a menos de tol del eje)? */
export function alongWall(a, b, walls, tol = 0.16) {
  return walls.some((w) => {
    const d = sub(w.b, w.a);
    const L = len(d);
    if (L < 1e-6) return false;
    const u = { x: d.x / L, y: d.y / L };
    const ok = (p) => {
      const rel = sub(p, w.a);
      const t = rel.x * u.x + rel.y * u.y;
      const off = Math.abs(rel.x * u.y - rel.y * u.x);
      return t >= -0.05 && t <= L + 0.05 && off <= tol;
    };
    return ok(a) && ok(b);
  });
}

/**
 * Baranda o pasamanos a lo largo de ab. za y zb son las cotas de pisada en cada extremo
 * (iguales en un borde horizontal, distintas sobre la línea de narices de un tramo).
 * kind: "baranda" (pasamanos + parantes + barrotes) o "pared" (pasamanos amurado con soportes).
 */
export function railAlong(add, { a, b, za, zb, height, kind, gap, identity, prof, postSpacing = 1.0, lv }) {
  const L = len(sub(b, a));
  if (L < 0.1) return { handrail_m: 0, brackets: 0, posts: 0, balusters: 0 };
  const at = (t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: za + (zb - za) * t });
  const rail3D = Math.hypot(L, zb - za);
  add("handrail", kind === "pared" ? "Pasamanos amurados" : "Barandas", [a.x, a.y, za + height], [b.x, b.y, zb + height], rail3D, { ...lv, identity: `${identity}:rail` });
  if (kind === "pared") return { handrail_m: rail3D, brackets: Math.ceil(L / 1.0) + 1, posts: 0, balusters: 0 };
  const nPosts = Math.max(1, Math.ceil(L / postSpacing - 1e-9));
  const postH = height - prof("handrail").h / 2;
  for (let k = 0; k <= nPosts; k += 1) {
    const p = at(k / nPosts);
    add("railPost", "Barandas", [p.x, p.y, p.z], [p.x, p.y, p.z + postH], postH, { ...lv, identity: `${identity}:post:${k}` });
  }
  const bal = prof("baluster");
  const step = gap + bal.b;
  const count = Math.max(0, Math.ceil(L / step) - 1);
  let balusters = 0;
  const postPitch = L / nPosts;
  for (let j = 1; j <= count; j += 1) {
    const t = j / (count + 1);
    const along = t * L;
    const nearPost = Math.abs(along - Math.round(along / postPitch) * postPitch) < 0.04;
    if (nearPost) continue;
    const p = at(t);
    const h = height - 0.1;
    add("baluster", "Barandas", [p.x, p.y, p.z + 0.06], [p.x, p.y, p.z + 0.06 + h], h, { ...lv, identity: `${identity}:bal:${j}` });
    balusters += 1;
  }
  return { handrail_m: rail3D, brackets: 0, posts: nPosts + 1, balusters };
}

/**
 * Genera las piezas de una escalera ya resuelta (lay.solution.ok).
 * ctx: { add, prof, surfaces, walls (del nivel de abajo), lv, f0 }
 */
export function buildStair(lay, ctx) {
  const { add, prof, surfaces, walls, lv, f0 } = ctx;
  const st = lay.stair;
  const R = lay.rules;
  const id = st.id;
  const stats = { treads: lay.treads.length, landingArea: 0, stringers: 0, basePlates: 0, topPlates: 0, wallHandrail_m: 0, brackets: 0, railing_m: 0, posts: 0, balusters: 0, landingPosts: 0 };
  const stringer = prof("stairStringer");
  const w = st.width;

  lay.flights.forEach((f, fi) => {
    const cStart = f.start;
    // Zancas: a cada lado, metidas media sección hacia adentro, del arranque a la llegada del tramo
    f.sides.forEach((side) => {
      const inward = { x: (cStart.x - side.a.x) / (w / 2), y: (cStart.y - side.a.y) / (w / 2) };
      const off = stringer.b / 2;
      const a = { x: side.a.x + inward.x * off, y: side.a.y + inward.y * off };
      const b = { x: side.b.x + inward.x * off, y: side.b.y + inward.y * off };
      const zA = f.zStart + stringer.h / 2;
      const zB = f.zEnd - 0.02;
      add("stairStringer", "Zancas de escalera", [a.x, a.y, zA], [b.x, b.y, zB], Math.hypot(len(sub(b, a)), zB - zA), { ...lv, identity: `${id}:f${fi}:zanca:${side.side}` });
      stats.stringers += 1;
    });
    if (fi === 0) stats.basePlates += 2;
    stats.topPlates += 2;

    // Pasamanos y barandas a cada lado del tramo, siguiendo la línea de narices
    const open = f.sides.map((side) => !alongWall(side.a, side.b, walls));
    f.sides.forEach((side, si) => {
      const wallSide = !open[si];
      const needsHandrailOnWall = R.handrailBothSides || (!open[0] && !open[1] && si === 0);
      if (wallSide && !needsHandrailOnWall) return;
      const inward = { x: (cStart.x - side.a.x) / (w / 2), y: (cStart.y - side.a.y) / (w / 2) };
      const off = wallSide ? 0.06 : 0.03;
      const a = { x: side.a.x + inward.x * off, y: side.a.y + inward.y * off };
      const b = { x: side.b.x + inward.x * off, y: side.b.y + inward.y * off };
      const r = railAlong(add, {
        a, b, za: f.zStart + lay.solution.a, zb: f.zEnd, height: R.railHeight,
        kind: wallSide ? "pared" : "baranda", gap: R.balusterGap, identity: `${id}:f${fi}:lado:${side.side}`, prof, lv
      });
      if (wallSide) {
        stats.wallHandrail_m += r.handrail_m;
        stats.brackets += r.brackets;
      } else {
        stats.railing_m += r.handrail_m;
        stats.posts += r.posts;
        stats.balusters += r.balusters;
      }
    });

    // Escalones como superficies horizontales
    f.treads.forEach((t) => {
      surfaces.push({
        ...lv, layer: "escaleras", material: "escalon", tread: st.tread, face: `escalera:${id}:${t.index}`,
        points: t.poly.map((p) => [p.x, p.y, t.z]), holes: [], area: (t.x1 - t.x0) * (t.y1 - t.y0)
      });
    });
  });

  // Descansos: superficie, bastidor, apoyos y barandas en los bordes libres
  const frame = prof("landingFrame");
  const post = prof("landingPost");
  lay.landings.forEach((land, li) => {
    const area = (land.x1 - land.x0) * (land.y1 - land.y0);
    stats.landingArea += area;
    surfaces.push({
      ...lv, layer: "escaleras", material: "escalon", tread: st.tread, face: `escalera:${id}:descanso:${li}`,
      points: land.poly.map((p) => [p.x, p.y, land.z]), holes: [], area
    });
    const zf = land.z - 0.02 - frame.h / 2;
    const corners = [{ x: land.x0, y: land.y0 }, { x: land.x1, y: land.y0 }, { x: land.x1, y: land.y1 }, { x: land.x0, y: land.y1 }];
    corners.forEach((p, i) => {
      const q = corners[(i + 1) % 4];
      add("landingFrame", "Descansos", [p.x, p.y, zf], [q.x, q.y, zf], len(sub(q, p)), { ...lv, identity: `${id}:d${li}:marco:${i}` });
    });
    const longX = land.x1 - land.x0 >= land.y1 - land.y0;
    const mid = longX ? (land.x0 + land.x1) / 2 : (land.y0 + land.y1) / 2;
    const A = longX ? { x: mid, y: land.y0 } : { x: land.x0, y: mid };
    const B = longX ? { x: mid, y: land.y1 } : { x: land.x1, y: mid };
    add("landingFrame", "Descansos", [A.x, A.y, zf], [B.x, B.y, zf], len(sub(B, A)), { ...lv, identity: `${id}:d${li}:travesano` });
    // Apoyos: en las esquinas que no tocan un muro, hasta el piso de abajo
    corners.forEach((p, i) => {
      if (alongWall(p, p, walls, 0.2)) return;
      const zTopPost = land.z - 0.02 - frame.h;
      add("landingPost", "Descansos", [p.x, p.y, f0], [p.x, p.y, zTopPost], zTopPost - f0, { ...lv, identity: `${id}:d${li}:apoyo:${i}` });
      stats.landingPosts += 1;
      stats.basePlates += 1;
    });
    // Bordes libres del descanso (no conectan con un tramo ni van contra un muro)
    corners.forEach((p, i) => {
      const q = corners[(i + 1) % 4];
      const e = sub(q, p);
      const L = len(e);
      const n = { x: e.y / L, y: -e.x / L };
      const c = { x: (land.x0 + land.x1) / 2, y: (land.y0 + land.y1) / 2 };
      const m = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
      const outward = (m.x - c.x) * n.x + (m.y - c.y) * n.y > 0 ? n : { x: -n.x, y: -n.y };
      const connects = [0.2, 0.5, 0.8].some((t) => {
        const s = { x: p.x + e.x * t + outward.x * 0.05, y: p.y + e.y * t + outward.y * 0.05 };
        return lay.flights.some((f) => s.x > f.x0 && s.x < f.x1 && s.y > f.y0 && s.y < f.y1);
      });
      if (connects || alongWall(p, q, walls)) return;
      const inset = { x: -outward.x * 0.03, y: -outward.y * 0.03 };
      const r = railAlong(add, {
        a: { x: p.x + inset.x, y: p.y + inset.y }, b: { x: q.x + inset.x, y: q.y + inset.y }, za: land.z, zb: land.z,
        height: R.railHeight, kind: "baranda", gap: R.balusterGap, identity: `${id}:d${li}:baranda:${i}`, prof, lv
      });
      stats.railing_m += r.handrail_m;
      stats.posts += r.posts;
      stats.balusters += r.balusters;
    });
  });
  stats.flights = lay.flights.length;
  stats.length_m = round(lay.length, 3);
  return stats;
}
