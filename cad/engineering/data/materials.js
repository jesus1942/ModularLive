import { G0_m_s2 } from "../units.js";

// Las fichas son referencias de producto, no certificaciones del material de una obra.
// CIRSOC 101-25, 3.1.2 exige pesos reales y especial cuidado con pesos estabilizantes.
const CIRSOC = "https://www.inti.gob.ar/assets/uploads/files/cirsoc/02-Reglamento-tramite-de-aprobacion/Reglamento-CIRSOC-101-25.pdf";
const BRIEF = "docs/PROMPT-ASTRA-motor-estructural.md";
const KN = "https://knauf.com/es-AR/p/producto/placa-de-yeso-st-12.5-10003_2001";
const OSB = "https://www.egger.com/en/building-products/range/products/osb3";

/** Catálogo de masas por m² o densidades por m³; todos los valores son editables. */
export const MATERIALS = {
  steel: { label: "Acero de los perfiles", basis: "volume", value: 7850, unit: "kg/m³", source: "Densidad nominal del catálogo existente; confirmar proveedor", url: BRIEF },
  concrete: { label: "Hormigón de fundación (armado)", basis: "volume", value: 24000 / G0_m_s2, unit: "kg/m³", source: "Encargo, §5.1: 24 kN/m³ SUPUESTOS; CIRSOC 101-2005 Tabla 3.1 indica 25 kN/m³ para armado", url: BRIEF },
  osb_11: { label: "OSB estructural 11 mm", basis: "area", value: 7, unit: "kg/m²", source: "Supuesto 7 kg/m². EGGER OSB 3 declara densidad mínima 600 kg/m³; el mínimo no fija el peso real", url: OSB },
  osb_18: { label: "OSB / fenólico 18 mm", basis: "area", value: 11.2, unit: "kg/m²", source: "Supuesto 11,2 kg/m²; confirmar OSB o fenólico y ficha del tablero", url: BRIEF },
  chapa_sinusoidal: { label: "Chapa sinusoidal N°25", basis: "area", value: 5.1, unit: "kg/m²", source: "Encargo, §5.1: aproximación con solapes incluidos; confirmar chapa y desarrollo", url: BRIEF },
  chapa_trapezoidal: { label: "Chapa trapezoidal T101", basis: "area", value: 5.1, unit: "kg/m²", source: "Encargo, §5.1: aproximación con solapes incluidos; confirmar chapa y desarrollo", url: BRIEF },
  panel_sandwich: { label: "Panel sándwich EPS 50 mm", basis: "area", value: 11.2, unit: "kg/m²", source: "Encargo, §5.1: aproximación; confirmar espesor de ambas chapas y núcleo", url: BRIEF },
  durlock: { label: "Placa de yeso estándar 12,5 mm", basis: "area", value: 8.15, unit: "kg/m²", source: "Referencia Knauf ST 12,5: 8,15 kg/m². Confirmar marca y producto instalado", url: KN },
  durlock_verde: { label: "Placa de yeso hidrófuga 12,5 mm", basis: "area", value: 10.2, unit: "kg/m²", source: "Encargo, §5.1: aproximación; no se adopta la ficha de placa estándar para la hidrófuga", url: BRIEF },
  cementicia: { label: "Placa cementicia 10 mm", basis: "area", value: 14.3, unit: "kg/m²", source: "Encargo, §5.1: aproximación; confirmar fabricante", url: BRIEF },
  frp: { label: "Panel FRP 3 mm", basis: "area", value: 5.4, unit: "kg/m²", source: "Supuesto: 1.800 kg/m³ × 0,003 m; confirmar ficha", url: BRIEF },
  aislacion_muro: { label: "Lana de roca 100 mm", basis: "area", value: 4, unit: "kg/m²", source: "Encargo, §5.1: densidad SUPUESTA 40 kg/m³ × 0,10 m", url: BRIEF },
  aislacion_techo: { label: "Lana de roca 150 mm", basis: "area", value: 6, unit: "kg/m²", source: "Densidad SUPUESTA 40 kg/m³ × espesor 0,15 m del cómputo actual", url: BRIEF },
  aislacion_piso: { label: "Lana de roca alta densidad 100 mm", basis: "area", value: 10, unit: "kg/m²", source: "Encargo, §5.1: densidad SUPUESTA 100 kg/m³ × 0,10 m", url: BRIEF },
  aislacion_entrepiso: { label: "Lana de roca acústica 50 mm", basis: "area", value: 2, unit: "kg/m²", source: "Densidad SUPUESTA 40 kg/m³ × espesor 0,05 m del cómputo actual", url: BRIEF },
  barrera_viento: { label: "Barrera de viento", basis: "area", value: 0.5, unit: "kg/m²", source: "Encargo, §5.1: aproximación; confirmar membrana instalada", url: BRIEF },
  membrana_techo: { label: "Membrana bajo cubierta", basis: "area", value: 0.5, unit: "kg/m²", source: "Encargo, §5.1: aproximación; confirmar membrana instalada", url: BRIEF },
  vidrio: { label: "Vidrio de ventanas", basis: "area", value: 15, unit: "kg/m²", source: "SUPUESTO vidrio simple de 6 mm a 2.500 kg/m³; no representa DVH ni carpintería completa", url: BRIEF },
  puerta: { label: "Hoja de puerta", basis: "area", value: 15, unit: "kg/m²", source: "SUPUESTO 15 kg/m² de hoja; confirmar material y peso del fabricante", url: BRIEF }
};

export const DEAD_LOAD_REFERENCE = {
  label: "CIRSOC 101-25, 3.1.1 y 3.1.2; antecedente CIRSOC 101-2005, 3.1",
  url: CIRSOC
};

/** Resuelve un dato editable; solo se marca aportado cuando incluye fuente y confirmación. */
export function resolveMaterial(id, overrides = {}) {
  const base = MATERIALS[id];
  if (!base) return null;
  const override = overrides[id];
  const valid = override && Number.isFinite(override.value) && override.value > 0;
  const source = valid && typeof override.source === "string" ? override.source.trim() : "";
  return {
    id, ...base,
    value: valid ? override.value : base.value,
    source: source || base.source,
    // El origen de un valor manual no tiene por qué ser la URL de la ficha de referencia.
    url: source ? null : base.url,
    assumed: !(valid && override.confirmed === true && source),
    invalid: override != null && !valid
  };
}

/** Capas instaladas en una superficie del modelo; sin merma de compra ni marcos duplicados. */
export function surfaceLayers(project, surface) {
  const s = project.settings;
  const layer = (materialId, area_m2 = surface.area) => ({ materialId, area_m2 });
  switch (surface.material) {
    case "exterior": return [layer("osb_11"), layer("barrera_viento"), layer(s.wallExteriorCladding)];
    case "interior": return [
      layer(s.wallInteriorLining),
      ...(surface.coreArea_m2 > 0 ? [layer("aislacion_muro", surface.coreArea_m2)] : [])
    ];
    case "cubierta": return [
      layer("osb_11"), layer("membrana_techo"), layer(s.roofCladding),
      layer("aislacion_techo", surface.coveredArea_m2)
    ];
    case "piso": return surface.level === 0
      ? [layer("osb_18"), layer("aislacion_piso")]
      : [layer("osb_18"), layer("aislacion_entrepiso"), layer("durlock")];
    case "vidrio": return [layer("vidrio")];
    case "puerta": return [layer("puerta")];
    // La platea se pesa como sólido, no como superficie: evita contar hormigón dos veces.
    case "platea": return [];
    default: return null;
  }
}
