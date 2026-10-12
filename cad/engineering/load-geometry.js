import { area3D } from "../geometry.js";

/** Centro de área de un polígono plano 3D (m), por triángulos orientados, admite concavidad. */
export function areaCenter_m(points) {
  if (points.length < 3) return [0, 0, 0];
  const n = normal3D(points);
  let total = 0;
  const sums = [0, 0, 0];
  for (let i = 1; i < points.length - 1; i += 1) {
    const a = points[0], b = points[i], c = points[i + 1];
    const u = b.map((v, j) => v - a[j]), v = c.map((w, j) => w - a[j]);
    const cross = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const area = cross.reduce((s, w, j) => s + w * n[j], 0) / 2;
    total += area;
    sums.forEach((_, j) => { sums[j] += area * (a[j] + b[j] + c[j]) / 3; });
  }
  return Math.abs(total) > 1e-10 ? sums.map((s) => s / total) : points[0].slice();
}

/** Normal unitaria de Newell; devuelve cero para geometría degenerada. */
export function normal3D(points) {
  const n = [0, 0, 0];
  points.forEach((p, i) => {
    const q = points[(i + 1) % points.length];
    n[0] += (p[1] - q[1]) * (p[2] + q[2]);
    n[1] += (p[2] - q[2]) * (p[0] + q[0]);
    n[2] += (p[0] - q[0]) * (p[1] + q[1]);
  });
  const length = Math.hypot(...n);
  return length > 1e-10 ? n.map((v) => v / length) : [0, 0, 0];
}

/** Recorta un polígono plano por un plano coordenado; conserva z e interpolación exacta. */
export function clip3D(points, axis, value, above) {
  const out = [];
  if (!points.length) return out;
  const inside = (p) => above ? p[axis] >= value - 1e-9 : p[axis] <= value + 1e-9;
  points.forEach((b, i) => {
    const a = points[(i + points.length - 1) % points.length];
    if (inside(a) !== inside(b)) {
      const t = (value - a[axis]) / (b[axis] - a[axis]);
      out.push(a.map((v, j) => v + t * (b[j] - v)));
    }
    if (inside(b)) out.push(b);
  });
  return out;
}

/** Divide un polígono por coordenadas de corte; cada parche retiene la superficie real. */
export function split3D(points, cutsByAxis) {
  let polygons = [points];
  cutsByAxis.forEach((cuts, axis) => {
    for (const value of [...new Set(cuts)].sort((a, b) => a - b)) {
      polygons = polygons.flatMap((poly) => Math.min(...poly.map((p) => p[axis])) >= value - 1e-9 || Math.max(...poly.map((p) => p[axis])) <= value + 1e-9
        ? [poly] : [clip3D(poly, axis, value, false), clip3D(poly, axis, value, true)])
        .filter((poly) => poly.length >= 3 && area3D(poly) > 1e-8);
    }
  });
  return polygons;
}

/** Suma fuerzas N y momentos N·m respecto del origen global, incluyendo pares libres. */
export function actionResultant(entries) {
  const force_N = [0, 0, 0], moment_Nm = [0, 0, 0];
  for (const e of entries) {
    const f = e.force_N, p = e.point_m ?? [0, 0, 0];
    const m = [p[1] * f[2] - p[2] * f[1], p[2] * f[0] - p[0] * f[2], p[0] * f[1] - p[1] * f[0]];
    for (let j = 0; j < 3; j += 1) { force_N[j] += f[j]; moment_Nm[j] += m[j] + (e.couple_Nm?.[j] ?? 0); }
  }
  return { force_N, moment_Nm };
}
