// Catálogo de perfiles, placas y sistemas constructivos del diseñador.
// Las secciones son de predimensionado: deben verificarse con cálculo estructural.

const STEEL_DENSITY = 7850; // kg/m³

/**
 * Perfiles lineales. b = ancho (m), h = alto (m), t = espesor (m).
 * shape: "rhs" tubo rectangular, "c" perfil C, "u" perfil U.
 */
export const PROFILES = {
  tubo_100x100x3_2: { label: "Tubo estructural AC 100×100×3.2 mm", shape: "rhs", b: 0.1, h: 0.1, t: 0.0032, stock: 6 },
  tubo_80x80x3_2: { label: "Tubo estructural AC 80×80×3.2 mm", shape: "rhs", b: 0.08, h: 0.08, t: 0.0032, stock: 6 },
  tubo_100x50x3_2: { label: "Tubo rectangular AC 100×50×3.2 mm", shape: "rhs", b: 0.05, h: 0.1, t: 0.0032, stock: 6 },
  tubo_100x50x2: { label: "Tubo rectangular AC 100×50×2 mm", shape: "rhs", b: 0.05, h: 0.1, t: 0.002, stock: 6 },
  tubo_120x60x3_2: { label: "Tubo rectangular AC 120×60×3.2 mm", shape: "rhs", b: 0.06, h: 0.12, t: 0.0032, stock: 6 },
  perfil_c_100x50x2: { label: "Perfil C AC 100×50×2 mm", shape: "c", b: 0.05, h: 0.1, t: 0.002, stock: 6 }
};

/** Peso aproximado por metro (sin radios de plegado). */
export function profileKgPerMeter(profile, density_kg_m3 = STEEL_DENSITY) {
  const { b, h, t, shape } = profile;
  let area;
  if (shape === "rhs") area = 2 * (b + h) * t - 4 * t * t;
  else if (shape === "c") area = (h + 2 * b + 0.03) * t; // alma + alas + labios 15 mm
  else area = (h + 2 * b) * t;
  return area * density_kg_m3;
}

/** Superficie exterior a pintar por metro lineal. */
export function profilePaintAreaPerMeter(profile) {
  return 2 * (profile.b + profile.h);
}

export const SHEETS = {
  osb_11: { label: "Placa OSB estructural 11 mm", w: 1.22, h: 2.44 },
  osb_18: { label: "Placa OSB / fenólico 18 mm (piso)", w: 1.22, h: 2.44 },
  chapa_sinusoidal: { label: "Chapa sinusoidal galvanizada N°25 prepintada", w: 1.1, h: 2.4, coverFactor: 0.88 },
  chapa_trapezoidal: { label: "Chapa trapezoidal T101 galvanizada prepintada", w: 1.1, h: 2.4, coverFactor: 0.91 },
  panel_sandwich: { label: "Panel sándwich EPS 50 mm c/chapa prepintada", w: 1.0, h: 2.4 },
  cementicia: { label: "Placa cementicia 10 mm", w: 1.2, h: 2.4 },
  durlock: { label: "Placa de yeso estándar 12.5 mm", w: 1.2, h: 2.4 },
  durlock_verde: { label: "Placa de yeso hidrófuga 12.5 mm", w: 1.2, h: 2.4 },
  frp: { label: "Panel FRP fibra de vidrio liso 3 mm", w: 1.22, h: 2.44 }
};

export function sheetCoverage(sheetId) {
  const sheet = SHEETS[sheetId];
  return sheet.w * sheet.h * (sheet.coverFactor ?? 1);
}

export const EXTERIOR_CLADDINGS = ["chapa_sinusoidal", "chapa_trapezoidal", "cementicia", "panel_sandwich"];
export const INTERIOR_LININGS = ["durlock", "durlock_verde", "cementicia", "frp"];
export const ROOF_CLADDINGS = ["chapa_sinusoidal", "chapa_trapezoidal", "panel_sandwich"];

export const AREA_MATERIALS = {
  aislacion_muro: "Lana de roca 100 mm",
  aislacion_techo: "Lana de roca 150 mm",
  aislacion_piso: "Lana de roca alta densidad 100 mm",
  barrera_viento: "Fieltro hidrófugo barrera de viento",
  membrana_techo: "Membrana hidrófuga bajo cubierta",
  film: "Film de polietileno 200 µm",
  pintura: "Esmalte antióxido (2 manos)"
};

export const REBAR_KG_PER_M = { 6: 0.222, 8: 0.395, 10: 0.617, 12: 0.888 };
export const REBAR_STOCK = 12; // barras de 12 m

/**
 * Sistemas constructivos. Cada rol estructural se resuelve con un perfil del catálogo.
 * El generador es común: un sistema nuevo (steel frame, madera, container) se agrega
 * definiendo sus roles y reglas.
 */
export const SYSTEMS = {
  steel_tube: {
    label: "Estructura de tubo estructural",
    welded: true,
    hasMainFrame: true,
    roles: {
      column: "tubo_100x100x3_2",
      ringBeam: "tubo_100x100x3_2",
      floorJoist: "tubo_100x50x3_2",
      stud: "tubo_100x50x2",
      track: "tubo_100x50x2",
      openingFrame: "perfil_c_100x50x2",
      rafter: "tubo_100x50x3_2",
      roofEdge: "tubo_100x50x3_2",
      ridge: "tubo_120x60x3_2"
    },
    mainFrameOptions: ["tubo_100x100x3_2", "tubo_80x80x3_2"],
    defaults: {
      maxColumnSpacing: 3,
      maxJoistSpan: 3.6
    },
    sheets: {
      wallSheathing: "osb_11",
      roofSheathing: "osb_11",
      floorDeck: "osb_18"
    }
  }
};

export const FOUNDATIONS = {
  dados: {
    label: "Dados de hormigón bajo columnas",
    defaults: { padSize: 0.4, padDepth: 0.6, elevation: 0.2 }
  },
  vigas_pilotines: {
    label: "Viga de fundación con pilotines",
    defaults: { beamWidth: 0.2, beamHeight: 0.3, pileDiameter: 0.25, pileDepth: 1.5, pileSpacing: 2, elevation: 0.2 }
  },
  platea: {
    label: "Platea de hormigón armado",
    defaults: { slabThickness: 0.12, edgeBeamWidth: 0.2, edgeBeamHeight: 0.3, margin: 0.1, elevation: 0.12 }
  }
};

export const ROOF_TYPES = {
  plano: { label: "Plano (pendiente mínima)", defaultSlope: 2 },
  una_agua: { label: "Una agua", defaultSlope: 10 },
  dos_aguas: { label: "Dos aguas", defaultSlope: 30 }
};
