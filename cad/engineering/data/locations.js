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
