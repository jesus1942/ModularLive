// Reglas de escaleras por jurisdicción. Todas las medidas en metros.
// Para vivienda manda el Código de Edificación del municipio donde se construye:
// los valores "municipal" son típicos de los códigos argentinos y están A CONFIRMAR.
// Los valores "accesible" son los del Decreto 914/97 (reglamentario de la Ley 24.314),
// Art. 21, A.1.4.2.1 (escaleras) y A.1.4.2.1.2 (pasamanos).

export const STAIR_RULES = {
  municipal: {
    label: "Código municipal (vivienda) · valores típicos a confirmar",
    source: "Valores típicos de códigos de edificación municipales. Confirmar con el Código de Edificación vigente de la localidad.",
    confirmed: false,
    aMin: 0.12, // alzada mínima
    aMax: 0.18, // alzada máxima
    pMin: 0.26, // pedada mínima (sin nariz)
    pMax: 0.32,
    blondel: [0.6, 0.66], // 2a + p
    maxRisers: 18, // alzadas corridas por tramo sin descanso
    minWidth: 0.8, // ancho libre
    headroom: 2.0, // altura de paso libre sobre la línea de narices
    railHeight: 0.9, // baranda de escalera, sobre la nariz
    guardHeight: 1.0, // baranda en el borde del hueco (como balcón)
    balusterGap: 0.1, // hueco máximo entre barrotes
    handrailBothSides: false,
    tactileStrip: false
  },
  accesible: {
    label: "Accesible · Decreto 914/97 (Ley 24.314)",
    source: "Decreto 914/97, Art. 21, A.1.4.2.1 y A.1.4.2.1.2.",
    confirmed: true,
    aMin: 0.14,
    aMax: 0.16,
    pMin: 0.28,
    pMax: 0.3,
    blondel: [0.6, 0.63],
    maxRisers: 12,
    minWidth: 1.2,
    headroom: 2.0, // el decreto no fija valor: se adopta el municipal, a confirmar
    railHeight: 0.9, // 0,90 ± 0,05 m, ambos lados
    guardHeight: 1.0,
    balusterGap: 0.1,
    handrailBothSides: true,
    tactileStrip: true // banda de 0,60 m al inicio y fin de cada tramo
  }
};
