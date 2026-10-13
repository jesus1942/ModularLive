// Utilidades geométricas en planta (metros). Eje X / Y en planta, Z hacia arriba.

export const EPS = 1e-6;

export const round = (value, digits = 3) => {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
};

export const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
export const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
export const scale = (a, k) => ({ x: a.x * k, y: a.y * k });
export const dot = (a, b) => a.x * b.x + a.y * b.y;
export const cross = (a, b) => a.x * b.y - a.y * b.x;
export const length = (a) => Math.hypot(a.x, a.y);
export const dist = (a, b) => length(sub(a, b));
export const normalize = (a) => {
  const l = length(a);
  return l < EPS ? { x: 0, y: 0 } : { x: a.x / l, y: a.y / l };
};

export const wallLength = (wall) => dist(wall.a, wall.b);
export const wallDir = (wall) => normalize(sub(wall.b, wall.a));
export const pointOnWall = (wall, s) => add(wall.a, scale(wallDir(wall), s));

export const pointKey = (p) => `${Math.round(p.x * 1000)}:${Math.round(p.y * 1000)}`;

export function polygonArea(poly) {
  let sum = 0;
  for (let i = 0; i < poly.length; i += 1) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    sum += p.x * q.y - q.x * p.y;
  }
  return sum / 2;
}

export function polygonPerimeter(poly) {
  let sum = 0;
  for (let i = 0; i < poly.length; i += 1) {
    sum += dist(poly[i], poly[(i + 1) % poly.length]);
  }
  return sum;
}

export function bbox(points) {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys)
  };
}

export function pointInPolygon(point, poly) {
  // Varios contornos cerrados: pertenecer a cualquiera de ellos alcanza.
  if (Array.isArray(poly?.[0])) return poly.some(loop => pointInPolygon(point, loop));
  if (!poly?.length) return false;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const a = poly[i];
    const b = poly[j];
    if (
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
    ) {
      inside = !inside;
    }
  }
  return inside;
}

/** Quita vértices repetidos y colineales. */
export function simplifyPolygon(poly) {
  let pts = poly.filter((p, i) => dist(p, poly[(i + 1) % poly.length]) > 1e-4);
  let changed = true;
  while (changed && pts.length > 3) {
    changed = false;
    for (let i = 0; i < pts.length; i += 1) {
      const prev = pts[(i - 1 + pts.length) % pts.length];
      const cur = pts[i];
      const next = pts[(i + 1) % pts.length];
      if (Math.abs(cross(sub(cur, prev), sub(next, cur))) < 1e-6) {
        pts = pts.filter((_, k) => k !== i);
        changed = true;
        break;
      }
    }
  }
  return pts;
}

export function ensureCCW(poly) {
  return polygonArea(poly) < 0 ? [...poly].reverse() : poly;
}

/** Desplaza un polígono antihorario hacia afuera una distancia d. */
export function offsetPolygon(poly, d) {
  if (Math.abs(d) < EPS) return poly.map((p) => ({ ...p }));
  const n = poly.length;
  const lines = [];
  for (let i = 0; i < n; i += 1) {
    const p = poly[i];
    const q = poly[(i + 1) % n];
    const dir = normalize(sub(q, p));
    const normal = { x: dir.y, y: -dir.x }; // exterior en polígono antihorario
    lines.push({ p: add(p, scale(normal, d)), dir });
  }
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const l1 = lines[(i - 1 + n) % n];
    const l2 = lines[i];
    const denom = cross(l1.dir, l2.dir);
    if (Math.abs(denom) < EPS) {
      out.push(l2.p);
    } else {
      const t = cross(sub(l2.p, l1.p), l2.dir) / denom;
      out.push(add(l1.p, scale(l1.dir, t)));
    }
  }
  return out;
}

/**
 * Intervalos interiores del polígono sobre la recta "eje = c".
 * axis = "x": recta vertical x = c, devuelve intervalos en y.
 * axis = "y": recta horizontal y = c, devuelve intervalos en x.
 */
function scanRaw(poly, axis, c) {
  const hits = [];
  const n = poly.length;
  for (let i = 0; i < n; i += 1) {
    const p = poly[i];
    const q = poly[(i + 1) % n];
    const pc = axis === "x" ? p.x : p.y;
    const qc = axis === "x" ? q.x : q.y;
    if (Math.abs(pc - qc) < EPS) continue;
    const lo = Math.min(pc, qc);
    const hi = Math.max(pc, qc);
    if (c < lo || c >= hi) continue;
    const t = (c - pc) / (qc - pc);
    const other = axis === "x" ? p.y + t * (q.y - p.y) : p.x + t * (q.x - p.x);
    hits.push(other);
  }
  hits.sort((a, b) => a - b);
  const intervals = [];
  for (let i = 0; i + 1 < hits.length; i += 2) {
    if (hits[i + 1] - hits[i] > EPS) intervals.push([hits[i], hits[i + 1]]);
  }
  return intervals;
}

const totalLength = (intervals) => intervals.reduce((s, [a, b]) => s + b - a, 0);

/** Igual que scanRaw pero robusto cuando la recta pasa justo por un vértice o borde. */
export function scanPolygon(poly, axis, c) {
  const before = scanRaw(poly, axis, c - 1e-5);
  const after = scanRaw(poly, axis, c + 1e-5);
  return totalLength(before) >= totalLength(after) ? before : after;
}

/**
 * Posiciones a lo largo de un eje entre min y max, con separación máxima "spacing",
 * incluyendo siempre los extremos y las coordenadas obligatorias (quiebres del polígono).
 */
export function distributePositions(min, max, spacing, required = []) {
  const anchors = [...new Set([min, max, ...required].map((v) => round(v, 4)))]
    .filter((v) => v >= min - EPS && v <= max + EPS)
    .sort((a, b) => a - b);
  const positions = [];
  for (let i = 0; i < anchors.length; i += 1) {
    positions.push(anchors[i]);
    if (i + 1 < anchors.length) {
      const span = anchors[i + 1] - anchors[i];
      const count = Math.ceil(span / spacing - 1e-9);
      for (let k = 1; k < count; k += 1) positions.push(anchors[i] + (span * k) / count);
    }
  }
  return positions;
}

/** Superficie de un polígono 3D plano (con agujeros) usando el método de Newell. */
export function area3D(points) {
  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (let i = 0; i < points.length; i += 1) {
    const [x1, y1, z1] = points[i];
    const [x2, y2, z2] = points[(i + 1) % points.length];
    nx += (y1 - y2) * (z1 + z2);
    ny += (z1 - z2) * (x1 + x2);
    nz += (x1 - x2) * (y1 + y2);
  }
  return Math.hypot(nx, ny, nz) / 2;
}

/** Recorta un polígono con el semiplano coordenada(axis) <= c (keep="below") o >= c. */
export function clipPolygonHalfPlane(poly, axis, c, keep) {
  const val = (p) => (axis === "x" ? p.x : p.y);
  const inside = (p) => (keep === "below" ? val(p) <= c + EPS : val(p) >= c - EPS);
  const out = [];
  for (let i = 0; i < poly.length; i += 1) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const pin = inside(p);
    const qin = inside(q);
    if (pin) out.push(p);
    if (pin !== qin) {
      const t = (c - val(p)) / (val(q) - val(p));
      out.push(add(p, scale(sub(q, p), t)));
    }
  }
  return out.length >= 3 ? simplifyPolygon(out) : [];
}

/**
 * Parte de A que no queda cubierta por B, como lista de rectángulos {x0, x1, y0, y1}.
 * Exacto para polígonos ortogonales; aproximado (por celdas) si hay lados inclinados.
 */
export function differenceRects(A, B) {
  const upperPoints = Array.isArray(B?.[0]) ? B.flat() : B ?? [];
  const xs = [...new Set([...A, ...upperPoints].map((p) => round(p.x, 4)))].sort((a, b) => a - b);
  const ys = [...new Set([...A, ...upperPoints].map((p) => round(p.y, 4)))].sort((a, b) => a - b);
  // tiras por fila
  const rows = [];
  for (let j = 0; j + 1 < ys.length; j += 1) {
    const strips = [];
    let open = null;
    for (let i = 0; i + 1 < xs.length; i += 1) {
      const c = { x: (xs[i] + xs[i + 1]) / 2, y: (ys[j] + ys[j + 1]) / 2 };
      const exposed = pointInPolygon(c, A) && !(B && pointInPolygon(c, B));
      if (exposed && !open) open = { x0: xs[i], x1: xs[i + 1] };
      else if (exposed) open.x1 = xs[i + 1];
      else if (open) {
        strips.push(open);
        open = null;
      }
    }
    if (open) strips.push(open);
    rows.push({ y0: ys[j], y1: ys[j + 1], strips });
  }
  // unir tiras idénticas de filas contiguas
  const rects = [];
  let active = [];
  rows.forEach((row) => {
    const next = [];
    row.strips.forEach((st) => {
      const match = active.find((r) => Math.abs(r.x0 - st.x0) < EPS && Math.abs(r.x1 - st.x1) < EPS && Math.abs(r.y1 - row.y0) < EPS);
      if (match) {
        match.y1 = row.y1;
        next.push(match);
      } else {
        const r = { x0: st.x0, x1: st.x1, y0: row.y0, y1: row.y1 };
        rects.push(r);
        next.push(r);
      }
    });
    active = next;
  });
  return rects.filter((r) => r.x1 - r.x0 > 0.05 && r.y1 - r.y0 > 0.05);
}

export const isOrthogonal = (poly) =>
  Array.isArray(poly?.[0]) ? poly.every(isOrthogonal) : poly.every((p, i) => {
    const q = poly[(i + 1) % poly.length];
    return Math.abs(p.x - q.x) < 1e-6 || Math.abs(p.y - q.y) < 1e-6;
  });

/**
 * Contorno de la unión de rectángulos alineados a los ejes {x0, x1, y0, y1}.
 * Devuelve una lista de polígonos (uno por cada región conexa), en sentido antihorario.
 */
export function unionOutline(rects) {
  if (!rects.length) return [];
  const xs = [...new Set(rects.flatMap((r) => [round(r.x0, 4), round(r.x1, 4)]))].sort((a, b) => a - b);
  const ys = [...new Set(rects.flatMap((r) => [round(r.y0, 4), round(r.y1, 4)]))].sort((a, b) => a - b);
  const inside = (i, j) => {
    if (i < 0 || j < 0 || i >= xs.length - 1 || j >= ys.length - 1) return false;
    const cx = (xs[i] + xs[i + 1]) / 2;
    const cy = (ys[j] + ys[j + 1]) / 2;
    return rects.some((r) => cx > Math.min(r.x0, r.x1) && cx < Math.max(r.x0, r.x1) && cy > Math.min(r.y0, r.y1) && cy < Math.max(r.y0, r.y1));
  };
  const edges = new Map();
  const push = (a, b) => {
    const k = `${a[0]}:${a[1]}`;
    if (!edges.has(k)) edges.set(k, []);
    edges.get(k).push(b);
  };
  for (let i = 0; i < xs.length - 1; i += 1) {
    for (let j = 0; j < ys.length - 1; j += 1) {
      if (!inside(i, j)) continue;
      const [x0, x1, y0, y1] = [xs[i], xs[i + 1], ys[j], ys[j + 1]];
      if (!inside(i, j - 1)) push([x0, y0], [x1, y0]);
      if (!inside(i + 1, j)) push([x1, y0], [x1, y1]);
      if (!inside(i, j + 1)) push([x1, y1], [x0, y1]);
      if (!inside(i - 1, j)) push([x0, y1], [x0, y0]);
    }
  }
  const loops = [];
  const take = () => {
    for (const [k, list] of edges) {
      if (list.length) return [k, list];
    }
    return null;
  };
  let start = take();
  while (start) {
    const [k0] = start;
    const loop = [];
    let k = k0;
    let guard = 0;
    do {
      const [x, y] = k.split(":").map(Number);
      loop.push({ x, y });
      const list = edges.get(k);
      const next = list.pop();
      k = `${next[0]}:${next[1]}`;
      guard += 1;
    } while (k !== k0 && guard < 10000);
    const simple = simplifyPolygon(loop);
    if (simple.length >= 3) loops.push(ensureCCW(simple));
    start = take();
  }
  return loops;
}

/** ¿El segmento AB atraviesa el interior del rectángulo (achicado en tol)? */
export function segmentCrossesRect(a, b, r, tol = 0.02) {
  const x0 = Math.min(r.x0, r.x1) + tol;
  const x1 = Math.max(r.x0, r.x1) - tol;
  const y0 = Math.min(r.y0, r.y1) + tol;
  const y1 = Math.max(r.y0, r.y1) - tol;
  if (x1 <= x0 || y1 <= y0) return false;
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const clip = (p, q) => {
    if (Math.abs(p) < 1e-12) return q >= 0;
    const t = q / p;
    if (p < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
    return true;
  };
  if (clip(-dx, a.x - x0) && clip(dx, x1 - a.x) && clip(-dy, a.y - y0) && clip(dy, y1 - a.y)) {
    return (t1 - t0) * Math.hypot(dx, dy) > tol;
  }
  return false;
}
