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
  puerta: { label: "Hoja de puerta", basis: "area", value: 15, unit: "kg/m²", source: "SUPUESTO 15 kg/m² de hoja; confirmar material y peso del fabricante", url: BRIEF },
  escalon_chapa: { label: "Escalón de chapa plegada 3,2 mm", basis: "area", value: 28, unit: "kg/m²", source: "SUPUESTO: 3,2 mm × 7.850 kg/m³ = 25,1 kg/m² más el plegado de nariz y apoyo; confirmar desarrollo", url: BRIEF },
  escalon_madera: { label: "Escalón de madera dura 38 mm", basis: "area", value: 25, unit: "kg/m²", source: "SUPUESTO: 0,038 m × ≈ 650 kg/m³; confirmar especie y espesor", url: BRIEF },
  fenolico_18: { label: "Multilaminado fenólico 18 mm", basis: "area", value: 11, unit: "kg/m²", source: "SUPUESTO: 0,018 m × ≈ 600 kg/m³; confirmar ficha del tablero", url: BRIEF },
  membrana_terraza: { label: "Membrana asfáltica 4 mm con geotextil", basis: "area", value: 4.5, unit: "kg/m²", source: "SUPUESTO ≈ 4,5 kg/m² (rollo de 10 m² ≈ 45 kg); confirmar producto", url: BRIEF },
  deck_exterior: { label: "Deck de madera dura sobre tirantes", basis: "area", value: 22, unit: "kg/m²", source: "SUPUESTO: tabla 19 mm + tirantes 2\" × 1\" c/0,40 m en madera dura; confirmar especie o WPC", url: BRIEF }
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
    case "cubierta": return surface.access === "terraza"
      ? [layer("fenolico_18"), layer("membrana_terraza"), layer("deck_exterior"), layer("aislacion_techo", surface.coveredArea_m2)]
      : [
        layer("osb_11"), layer("membrana_techo"), layer(s.roofCladding),
        layer("aislacion_techo", surface.coveredArea_m2)
      ];
    case "piso": return surface.level === 0
      ? [layer("osb_18"), layer("aislacion_piso")]
      // bajo un volado no hay cielorraso interior: lo reemplaza el cierre inferior ("volado")
      : [layer("osb_18"), layer("aislacion_entrepiso"), layer("durlock", surface.area - (surface.overhangArea_m2 ?? 0))];
    case "balcon": return [layer("fenolico_18"), layer("membrana_terraza"), layer("deck_exterior")];
    case "volado": return [layer("osb_11"), layer(s.wallExteriorCladding), layer("aislacion_piso")];
    case "vidrio": return [layer("vidrio")];
    case "cielorraso": return [layer("durlock")];
    case "escalon": return [layer(surface.tread === "madera" ? "escalon_madera" : "escalon_chapa")];
    case "puerta": return [layer("puerta")];
    // La platea se pesa como sólido, no como superficie: evita contar hormigón dos veces.
    case "platea": return [];
    default: return null;
  }
}
