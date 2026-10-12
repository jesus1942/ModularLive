// Datos separados de los algoritmos. Valores SI salvo indicación expresa.
// Se consultaron los originales INTI-CIRSOC el 11/10/2026; adopción local a confirmar.
export const SOURCES = {
  loads2025: { label: "CIRSOC 101-2025", url: "https://www.inti.gob.ar/assets/uploads/files/cirsoc/02-Reglamento-tramite-de-aprobacion/Reglamento-CIRSOC-101-25.pdf" },
  loads2005: { label: "CIRSOC 101-2005", url: "https://www.inti.gob.ar/assets/uploads/files/cirsoc/vigencia-2013/area100/Reglamento-cirsoc101-completo.pdf" },
  wind2025: { label: "CIRSOC 102-2025", url: "https://www.inti.gob.ar/assets/uploads/files/cirsoc/02-Reglamento-tramite-de-aprobacion/Reglamento-CIRSOC-102-25.pdf" },
  wind2005: { label: "CIRSOC 102-2005", url: "https://www.inti.gob.ar/assets/uploads/files/cirsoc/vigencia-2013/area100/Reglamentos_CIRSOC_INPRES.pdf" },
  steel2005: { label: "CIRSOC 301-2005", url: "https://www.inti.gob.ar/assets/uploads/files/cirsoc/vigencia-2013/area300/reglamento_301.pdf" },
  snow: { label: "CIRSOC 104-2005", url: "https://www.inti.gob.ar/assets/uploads/files/cirsoc/vigencia-2013/area100/2021/14-%20CIRSOC%20104-Reglamento.pdf" },
  seismic: { label: "INPRES-CIRSOC 103, Parte I-2018", url: "https://www.inti.gob.ar/assets/uploads/files/cirsoc/06-reglamentos-2da-generacion/area100/06_Area100_INPRES-CIRSOC-103-Parte-1-Reglamento-2018.pdf" }
};

// Tabla 4.1 de ambas ediciones: áreas generales de vivienda (no sólo dormitorios).
export const USES = {
  vivienda: { label: "Vivienda", L0_Pa: 2000, concentrated_N: 0, seismicParticipation: 0.25, reducible: true, row: "Viviendas: todas las demás áreas excepto escaleras" },
  oficina: { label: "Oficina", L0_Pa: 2500, concentrated_N: 9000, seismicParticipation: 0.25, reducible: true, row: "Edificios para oficinas: oficinas" },
  deposito: { label: "Depósito liviano", L0_Pa: 6000, concentrated_N: 0, seismicParticipation: 0.75, reducible: false, row: "Almacenamiento: liviano" },
  terraza: { label: "Terraza privada", L0_Pa: 3000, concentrated_N: 0, seismicParticipation: 0.25, reducible: false, row: "Azoteas accesibles privadamente" },
  terraza_publica: { label: "Terraza pública", L0_Pa: 5000, concentrated_N: 0, seismicParticipation: 0.5, reducible: false, publicAssembly: true, row: "Azoteas accesibles al público" },
  balcon: { label: "Balcón de vivienda", L0_Pa: 5000, concentrated_N: 0, seismicParticipation: 0.25, reducible: false, row: "Balcones: 5 kPa; 3 kPa en vivienda hasta 10 m²" },
  escalera: { label: "Escaleras y salidas", L0_Pa: 5000, concentrated_N: 1350, seismicParticipation: 0.5, reducible: false, publicAssembly: true, row: "Escaleras y caminos de salida (criterio general)" }
};

// 102-2025, Tabla 1.13-1; 102-2005, Tabla 5, Caso 2 (método direccional).
// Para C&R de 2005 la exposición B tiene piso 0,72 (Caso 1).
export const KZ_TABLES = {
  "2025": [[5, .59, .87, 1.05], [10, .71, 1, 1.19], [15, .79, 1.08, 1.27], [20, .85, 1.15, 1.34]],
  "2005": [[5, .59, .87, 1.05], [6, .62, .90, 1.08], [7.5, .66, .94, 1.12], [10, .72, 1, 1.18], [12.5, .77, 1.05, 1.23], [15, .81, 1.09, 1.27], [17.5, .84, 1.13, 1.30], [20, .88, 1.16, 1.33]]
};
export const WIND_IMPORTANCE_2005 = { I: .87, II: 1, III: 1.15, IV: 1.15 }; // Tabla 1
export const SNOW_IMPORTANCE = { I: .8, II: 1, III: 1.1, IV: 1.2 }; // 104, Tabla 4
export const SEISMIC_RISK = { Ao: 1.5, A: 1.3, B: 1, C: .8 }; // 103-I, §2.4

// 102-2025 Fig.2.4-1 / 102-2005 Fig.3. Filas h/L=0,25;0,5;1.
// Datos para techo con viento perpendicular a la cumbrera, θ ≥10°.
export const ROOF_CP = {
  angles_deg: [10, 15, 20, 25, 30, 35, 45, 60], ratios: [.25, .5, 1],
  windwardNegative: [[-.7, -.5, -.3, -.2, -.2, 0, 0, .6], [-.9, -.7, -.4, -.3, -.2, -.2, 0, .6], [-1.3, -1, -.7, -.5, -.3, -.2, 0, .6]],
  windwardPositive: [[-.18, 0, .2, .3, .3, .4, .4, .6], [-.18, -.18, 0, .2, .2, .3, .4, .6], [-.18, -.18, -.18, 0, .2, .2, .3, .6]],
  leeward: [[-.3, -.5, -.6, -.6, -.6, -.6, -.6, -.6], [-.5, -.5, -.6, -.6, -.6, -.6, -.6, -.6], [-.7, -.6, -.6, -.6, -.6, -.6, -.6, -.6]]
};

// Curvas GCp: [área efectiva m², coeficiente]. Interpolación logarítmica en A.
// 2025, Fig.5.3-1 y Tablas C5.3-1 a C5.3-5 (ec. de los gráficos).
export const CC_WALL = { positive: [[1, 1], [50, .7]], "4": [[1, -1.1], [50, -.8]], "5": [[1, -1.4], [50, -.8]] };
export const CC_ROOF_2025 = {
  flat: { positive: [[1, .3], [10, .2]], "1p": [[10, -.9], [100, -.4]], "1": [[1, -1.7], [50, -1]], "2": [[1, -2.3], [50, -1.4]], "3": [[1, -3.2], [50, -1.4]],
    eave: { "1p": [[1, -1.7], [10, -1.6], [50, -1]], "1": [[1, -1.7], [10, -1.6], [50, -1]], "2": [[1, -2.3], [50, -1.1]], "3": [[1, -3.2], [50, -1.1]] } },
  // El extremo A=50 de zona 2 alero se toma del gráfico; C5.3-2 imprime A>5 (errata).
  gable20: { positive: [[1, .6], [20, .3]], "1": [[2, -2], [30, -.5]], "2": [[1, -2.7], [20, -1]], "3": [[1, -3.6], [10, -1.8]] },
  gable27: { positive: [[1, .6], [20, .3]], "1": [[1, -1.5], [20, -.8]], "2": [[1, -2.5], [10, -1.2]], "3": [[1, -3], [10, -1.4]] },
  gable45: { positive: [[1, .9], [20, .5]], "1": [[1, -1.8], [10, -.8]], "2": [[1, -2], [20, -1]], "3": [[1, -2.5], [20, -1]] },
  // Fig.5.3-5A/B: transcripción de puntos extremos del gráfico (sin coeficientes de dos aguas).
  mono10: { positive: [[1, .3], [10, .2]], "1": [[1, -1.1], [10, -1.1]], "2": [[1, -1.3], [10, -1.2]], "2p": [[1, -1.6], [10, -1.5]], "3": [[1, -1.8], [10, -1.2]], "3p": [[1, -2.6], [10, -1.6]] },
  mono30: { positive: [[1, .4], [10, .3]], "1": [[1, -1.1], [10, -1.1]], "2": [[1, -1.6], [10, -1.2]], "3": [[1, -2.9], [10, -2]] }
};

// 103-I-2018, Tablas 3.1/3.2: valores base; Na=1, Nv=1,2 sólo donde figura el producto.
export const SEISMIC_SPECTRA = {
  SA: [[.09, .13], [.18, .25], [.29, .39 * 1.2], [.37, .51 * 1.2]],
  SD: [[.12, .18], [.22, .32], [.32, .47 * 1.2], [.40, .59 * 1.2]],
  SE: [[.19, .26], [.30, .50], [.35, .74 * 1.2], [.36, .90 * 1.2]]
};
export const SEISMIC_AS = [.08, .15, .25, .35];
export const SEISMIC_T3_s = [3, 5, 8, 13];

// Plantillas ELU. roof significa alternativas Lr/S, nunca ambas sumadas.
// L usa 1 conservador en 2025; en 2005 f1 depende del uso. No se incluyen acciones F,T,H,R.
export const STRENGTH_COMBINATIONS = {
  "2025": [
    { id: "U1", D: 1.4, reference: "101-25 §2.3.2(1)" },
    { id: "U2", D: 1.2, L: 1.6, roof: .5, reference: "101-25 §2.3.2(2)" },
    { id: "U3L", D: 1.2, L: 1, roof: 1.6, reference: "101-25 §2.3.2(3)" },
    { id: "U3W", D: 1.2, W: .5, roof: 1.6, reference: "101-25 §2.3.2(3)" },
    { id: "U4", D: 1.2, L: 1, W: 1, roof: .5, reference: "101-25 §2.3.2(4);102-25 B.3.2" },
    { id: "U5", D: 1.2, L: 1, S: .2, E: 1, reference: "101-25 §2.3.2(5)" },
    { id: "U6", D: .9, W: 1, reference: "101-25 §2.3.2(6);102-25 B.3.2" },
    { id: "U7", D: .9, E: 1, reference: "101-25 §2.3.2(7)" }
  ],
  "2005": [
    { id: "U1", D: 1.4, reference: "301-05 A.4.1" },
    { id: "U2", D: 1.2, L: 1.6, roof: "f1r", reference: "301-05 A.4.2" },
    { id: "U3L", D: 1.2, L: "f1", roof: 1.6, reference: "301-05 A.4.3" },
    { id: "U3W", D: 1.2, W: .8, roof: 1.6, reference: "301-05 A.4.3" },
    { id: "U4", D: 1.2, L: "f1", W: 1.6, roof: "f1r", reference: "301-05 A.4.4 (1,6 conservador; nota permite 1,5)" },
    { id: "U5", D: 1.2, L: "f1", Lr: "f1", S: "f2", E: 1, reference: "301-05 A.4.5" },
    { id: "U6", D: .9, W: 1.6, reference: "301-05 A.4.6 (1,6 conservador; nota permite 1,5)" },
    { id: "U7", D: .9, E: 1, reference: "301-05 A.4.6" },
    { id: "U8", D: 1.2, L: 1.6, W: .8, roof: "f1r", reference: "301-05 A.4.7: pórticos hasta cuatro plantas" }
  ]
};
// Servicio: Wa se calcula por Vserv²/V²; la velocidad de servicio necesita dato propio.
export const SERVICE_COMBINATIONS = {
  "2025": [{ id: "SW1", D: 1, Wa: 1 }, { id: "SW2", D: 1, L: .5, Wa: 1 }, { id: "SW3", D: .6, W: .6 }, { id: "SW4", D: 1, L: .75, W: .45, roof: .75 }],
  "2005": [{ id: "SW1", D: 1, W: 1 }, { id: "SW2", D: 1, L: .5, W: 1 }, { id: "SW3", D: .6, W: 1 }, { id: "SW4", D: 1, L: .75, W: .75, roof: .75 }]
};

export const CC_ROOF_2005 = {
  flat: { positive: [[1, .3], [10, .2]], "1": [[1, -1], [10, -.9]], "2": [[1, -1.8], [10, -1.1]], "3": [[1, -2.8], [10, -1.1]], eave: { "1": [[1, -1.7], [10, -1.6], [50, -1.1]], "2": [[1, -1.7], [10, -1.6], [50, -1.1]], "3": [[1, -2.8], [10, -.8]] } },
  gable30: { positive: [[1, .5], [10, .3]], "1": [[1, -.9], [10, -.8]], "2": [[1, -2.1], [10, -1.4]], "3": [[1, -2.1], [10, -1.4]], eave: { "1": [[1, -2.2], [10, -2.2]], "2": [[1, -2.2], [10, -2.2]], "3": [[1, -3.7], [10, -2.5]] } },
  gable45: { positive: [[1, .9], [10, .8]], "1": [[1, -1], [10, -.8]], "2": [[1, -1.2], [10, -1]], "3": [[1, -1.2], [10, -1]], eave: { "1": [[1, -2], [10, -1.8]], "2": [[1, -2], [10, -1.8]], "3": [[1, -2], [10, -1.8]] } }
}; // 102-2005, Fig.5B: puntos leídos del gráfico, alero = neto superior+inferior.
