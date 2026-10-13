// No se trasladan 58 m/s de Telsen a Puerto Madryn ni a otra localidad.
// Los valores locales pendientes NO se rellenan con números presentados como confirmados.
// Fuentes a consultar: mapas CIRSOC 102 según edición, CIRSOC 104 e INPRES-CIRSOC 103.
export const LOCATION_SOURCE = "https://www.inti.gob.ar/areas/serviciosindustriales/construcciones-e-infraestructura/cirsoc/reglamentos";
const cities = [
  ["puerto-madryn", "Puerto Madryn · Chubut"], ["trelew", "Trelew · Chubut"],
  ["rawson", "Rawson · Chubut"], ["comodoro-rivadavia", "Comodoro Rivadavia · Chubut"],
  ["esquel", "Esquel · Chubut"], ["buenos-aires", "Ciudad Autónoma de Buenos Aires"],
  ["la-plata", "La Plata · Buenos Aires"], ["catamarca", "San Fernando del Valle de Catamarca"],
  ["resistencia", "Resistencia · Chaco"], ["cordoba", "Córdoba"], ["corrientes", "Corrientes"],
  ["parana", "Paraná · Entre Ríos"], ["formosa", "Formosa"], ["san-salvador-de-jujuy", "San Salvador de Jujuy"],
  ["santa-rosa", "Santa Rosa · La Pampa"], ["la-rioja", "La Rioja"], ["mendoza", "Mendoza"],
  ["posadas", "Posadas · Misiones"], ["neuquen", "Neuquén"], ["viedma", "Viedma · Río Negro"],
  ["salta", "Salta"], ["san-juan", "San Juan"], ["san-luis", "San Luis"],
  ["rio-gallegos", "Río Gallegos · Santa Cruz"], ["santa-fe", "Santa Fe"],
  ["santiago-del-estero", "Santiago del Estero"], ["ushuaia", "Ushuaia · Tierra del Fuego"],
  ["san-miguel-de-tucuman", "San Miguel de Tucumán"]
];

/** Presets de ubicación sin inventar parámetros del mapa: null significa a confirmar. */
export const LOCATIONS = Object.fromEntries(cities.map(([id, label]) => [id, {
  label, V: null, pg: null, seismicZone: null, frostDepth: null,
  status: "a confirmar", source: LOCATION_SOURCE
}]));

// CIRSOC 102-2025 Fig.1.5-1D, velocidades I / II / III-IV (m/s).
// Madryn, Trelew y Esquel no están en esa tabla. La escala del mapa consultado
// no permite una lectura local suficientemente precisa: quedan expresamente a confirmar.
const velocities2025 = {
  "comodoro-rivadavia": [77.1, 82.7, 88.7], rawson: [68.5, 73.5, 78.8],
  "buenos-aires": [51.4, 55.1, 59.1], "la-plata": [52.5, 56.3, 60.4], catamarca: [49.1, 52.7, 56.5],
  resistencia: [51.4, 55.1, 59.1], cordoba: [51.4, 55.1, 59.1], corrientes: [52.5, 56.3, 60.4],
  parana: [59.4, 63.7, 68.3], formosa: [51.4, 55.1, 59.1], "san-salvador-de-jujuy": [38.8, 41.6, 44.7],
  "santa-rosa": [57.1, 61.2, 65.7], "la-rioja": [50.3, 53.9, 57.8], mendoza: [44.6, 47.8, 51.2],
  posadas: [51.4, 55.1, 59.1], neuquen: [54.8, 58.8, 63], viedma: [68.5, 73.5, 78.8], salta: [40, 42.9, 46],
  "san-juan": [45.7, 49, 52.5], "san-luis": [51.4, 55.1, 59.1], "rio-gallegos": [68.5, 73.5, 78.8],
  "santa-fe": [58.3, 62.5, 67], "santiago-del-estero": [49.1, 52.7, 56.5], ushuaia: [68.5, 73.5, 78.8], "san-miguel-de-tucuman": [45.7, 49, 52.5]
};
for (const [id, values] of Object.entries(velocities2025)) {
  LOCATIONS[id].wind2025 = values;
  LOCATIONS[id].windSource = "CIRSOC 102-2025, Figura 1.5-1D (ciudades); confirmar emplazamiento, exposición y topografía";
}
// 104-2005, Tabla 1.4, Chubut. No se extrapolan los datos de Telsen a Madryn.
LOCATIONS["comodoro-rivadavia"].pg = .5;
LOCATIONS.esquel.pg = 1.2;
for (const id of ["comodoro-rivadavia", "esquel"]) LOCATIONS[id].snowSource = "CIRSOC 104-2005, Tabla 1.4 (Chubut)";

/** Valor de tabla por edición y riesgo; null obliga a confirmar la lectura local del mapa. */
export function locationWind_m_s(preset, edition, risk) {
  const values = LOCATIONS[preset]?.wind2025;
  return edition === "2025" && values ? values[risk === "I" ? 0 : risk === "II" ? 1 : 2] : null;
}
