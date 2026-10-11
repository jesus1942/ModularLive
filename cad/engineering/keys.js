/** Canonicaliza coordenadas de identidad en metros a una tolerancia de 1 µm. */
const coordinate = (value) => String(Math.round(value * 1e6) / 1e6);
const xy = (point) => point.slice(0, 2).map(coordinate).join(",");

/**
 * Identifica una pieza por nivel, rol, muro, función y posición, sin usar el contador m1…
 * Las columnas y vigas conservan identidad al cambiar altura o sección del bastidor.
 * Una edición geométrica de la propia pieza puede cambiar su key; editar otros muros no.
 */
export function memberKey(member, level, levelGeometry) {
  const scope = `L${encodeURIComponent(level.id)}:${member.role}:${encodeURIComponent(member.wallId ?? "grid")}:${encodeURIComponent(member.group)}`;
  if (member.identity) return `${scope}:${encodeURIComponent(member.identity)}`;
  const vertical = Math.hypot(member.b[0] - member.a[0], member.b[1] - member.a[1]) < 1e-6;
  if (member.role === "column") return `${scope}:${xy(member.a)}`;
  if (vertical && member.role === "stud") return `${scope}:${xy(member.a)}`;
  if (vertical) {
    const z0 = levelGeometry.floorTop;
    return `${scope}:${xy(member.a)}:${coordinate(member.a[2] - z0)}..${coordinate(member.b[2] - z0)}`;
  }
  if (["floorJoist", "rafter"].includes(member.role)) {
    const middle = member.a.map((v, i) => (v + member.b[i]) / 2);
    return `${scope}:${xy(middle)}:${Math.abs(member.b[0] - member.a[0]) > Math.abs(member.b[1] - member.a[1]) ? "x" : "y"}`;
  }
  const ends = [xy(member.a), xy(member.b)].sort().join("..");
  return `${scope}:${ends}`;
}
