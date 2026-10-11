// Unidades SI internas. kg es masa; kgf y tf son unidades de fuerza de uso en obra.
export const G0_m_s2 = 9.80665; // gravedad normal, definición del kilogramo-fuerza

/** Convierte masa en kg a peso en N con gravedad normal. */
export const kgToN = (mass_kg) => mass_kg * G0_m_s2;
/** Convierte fuerza en N a kgf. */
export const NToKgf = (force_N) => force_N / G0_m_s2;
/** Convierte fuerza en kN a toneladas-fuerza. */
export const kNToTf = (force_kN) => force_kN * 1000 / (1000 * G0_m_s2);
/** Convierte toneladas-fuerza a kN. */
export const tfToKN = (force_tf) => force_tf * G0_m_s2;
/** Convierte presión en MPa a kgf/cm² (1 cm² = 10⁻⁴ m²). */
export const MPaToKgfCm2 = (stress_MPa) => stress_MPa * 100 / G0_m_s2;
/** Convierte presión en kgf/cm² a MPa. */
export const kgfCm2ToMPa = (stress_kgf_cm2) => stress_kgf_cm2 * G0_m_s2 / 100;

/** Formatea un número sin cambiar el valor SI que conserva el cálculo. */
export function formatNumber(value, digits = 2) {
  return Number.isFinite(value)
    ? value.toLocaleString("es-AR", { maximumFractionDigits: digits })
    : "—";
}

/** Muestra N como kN y, entre paréntesis, kgf o tf; conserva el signo. */
export function formatForce(force_N) {
  const kgf = NToKgf(force_N);
  const site = Math.abs(kgf) >= 1000 ? `${formatNumber(kgf / 1000)} tf` : `${formatNumber(kgf)} kgf`;
  return `${formatNumber(force_N / 1000)} kN (${site})`;
}

/** Muestra presión en Pa como kN/m² y kgf/m². */
export function formatPressure(pressure_Pa) {
  return `${formatNumber(pressure_Pa / 1000, 3)} kN/m² (${formatNumber(NToKgf(pressure_Pa))} kgf/m²)`;
}

/** Muestra tensión en Pa como MPa y kgf/cm². */
export function formatStress(stress_Pa) {
  return `${formatNumber(stress_Pa / 1e6)} MPa (${formatNumber(MPaToKgfCm2(stress_Pa / 1e6))} kgf/cm²)`;
}
