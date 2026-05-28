const STRUCTURE_SYSTEMS = {
  steel_tube: {
    label: "Estructura metálica",
    frameMaterial: "Perfil estructural de acero al carbono",
    mainFrameOptions: ["100x100x3.2", "80x80x3.2"],
    defaultMainFrameSection: "100x100x3.2",
    floorJoist: "Tubo rectangular acero al carbono 100×50×3.2 mm",
    perimeterBeam: "Tubo rectangular acero al carbono 100×50×3.2 mm",
    wallStud: "Tubo rectangular acero al carbono 100×50×2 mm",
    roofRafter: "Tubo rectangular acero al carbono 100×50×3.2 mm",
    openingFrame: "Perfil C/U acero al carbono 100×50×2 mm",
    structuralPanel: "Placa OSB estructural 11 mm",
    floorInsulation: "Lana de roca alta densidad 100 mm",
    wallInsulation: "Lana de roca 100 mm",
    roofInsulation: "Lana de roca 150 mm",
    roofMembrane: "Membrana hidrófuga bajo cubierta",
    windBarrier: "Fieltro hidrófugo barrera de viento",
    fastener: 'Tornillo autoperforante cab. hex. 3/8" × 1 1/2"',
    anchor: "Bulón expansivo M10 + taco Fischer para bastidor",
    sealant: "Espuma de poliuretano expansiva + sellador MS",
    notes:
      "Bastidor principal y estructura secundaria resueltos con perfiles estructurales de acero al carbono."
  },
  light_steel: {
    label: "Steel frame liviano",
    frameMaterial: "Perfiles C/U galvanizados",
    mainFrameOptions: [],
    defaultMainFrameSection: "Perfil C 200x70x2 mm",
    floorJoist: "Perfil C 200×70×2 mm galvanizado",
    perimeterBeam: "Perfil C 200×70×2 mm galvanizado",
    wallStud: "Montante C 100×50×0.9 mm galvanizado",
    roofRafter: "Correa C 150×50×1.25 mm galvanizado",
    openingFrame: "Perfil C/U 100×50×0.9 mm galvanizado",
    structuralPanel: "Placa OSB estructural 11 mm",
    floorInsulation: "Lana de vidrio 100 mm",
    wallInsulation: "Lana de vidrio 100 mm",
    roofInsulation: "Lana de vidrio 150 mm",
    roofMembrane: "Membrana bajo cubierta impermeable",
    windBarrier: "Housewrap hidrófugo transpirable",
    fastener: 'Tornillo punta mecha 3/8" × 1" autoperforante',
    anchor: "Bulón galvanizado M8 para perfil galvanizado",
    sealant: "Cinta selladora + sellador MS para encuentros",
    notes:
      "Sistema liviano en perfiles conformados en frío, orientado a obra seca y panelización seriada."
  },
  wood: {
    label: "Madera estructural",
    frameMaterial: "Madera seca cepillada tratada",
    mainFrameOptions: [],
    defaultMainFrameSection: "Tirante laminado 3x8 pulgadas",
    floorJoist: 'Tirante pino cepillado seco 2"×8" (5×20 cm)',
    perimeterBeam: 'Tirante pino laminado 3"×8" (8×20 cm)',
    wallStud: 'Tirante pino cepillado seco 2"×4" (5×10 cm)',
    roofRafter: 'Tirante pino cepillado seco 2"×6" (5×15 cm)',
    openingFrame: 'Tirante pino cepillado seco 2"×4" (5×10 cm)',
    structuralPanel: "Placa OSB estructural 11 mm",
    floorInsulation: "Lana de vidrio 100 mm",
    wallInsulation: "Lana de vidrio 100 mm",
    roofInsulation: "Lana de vidrio 150 mm",
    roofMembrane: "Membrana hidrófuga bajo chapa",
    windBarrier: "Membrana transpirable hidrófuga",
    fastener: 'Tornillo para madera 4" cabeza plana + clavo tachuela 2 1/2"',
    anchor: "Escuadra metálica galvanizada + anclaje mecánico",
    sealant: "Espuma poliuretano expansiva + sellador elástico",
    notes:
      "Sistema de entramado liviano en madera tratada, con buen desempeño térmico y fabricación simple."
  }
};

const PRESETS = {
  vivienda: {
    calculationMode: "mixed",
    interiorUseType: "dry",
    structureType: "steel_tube",
    mainFrameSection: "100x100x3.2",
    wallExteriorCladding: "corrugated_sheet",
    wallInteriorLining: "drywall",
    roofCladding: "corrugated_sheet",
    stockLength: 6,
    laborRate: 60000,
    width: 3,
    length: 6,
    height: 2.6,
    quantity: 1,
    floorSpacing: 0.4,
    wallSpacing: 0.4,
    roofSpacing: 0.4,
    roofOverhang: 0.25,
    panelArea: 2.98,
    wasteFactor: 8,
    windowCount: 4,
    windowWidth: 1.2,
    windowHeight: 1,
    doorCount: 1,
    doorWidth: 0.9,
    doorHeight: 2.1
  },
  oficina: {
    calculationMode: "mixed",
    interiorUseType: "dry",
    structureType: "steel_tube",
    mainFrameSection: "100x100x3.2",
    wallExteriorCladding: "corrugated_sheet",
    wallInteriorLining: "drywall",
    roofCladding: "trapezoidal_sheet",
    stockLength: 6,
    laborRate: 60000,
    width: 3,
    length: 7.2,
    height: 2.7,
    quantity: 1,
    floorSpacing: 0.4,
    wallSpacing: 0.4,
    roofSpacing: 0.4,
    roofOverhang: 0.2,
    panelArea: 2.98,
    wasteFactor: 8,
    windowCount: 5,
    windowWidth: 1.2,
    windowHeight: 1,
    doorCount: 1,
    doorWidth: 0.9,
    doorHeight: 2.1
  },
  bano: {
    calculationMode: "mixed",
    interiorUseType: "wet",
    structureType: "steel_tube",
    mainFrameSection: "80x80x3.2",
    wallExteriorCladding: "cement_board",
    wallInteriorLining: "cement_board",
    roofCladding: "trapezoidal_sheet",
    stockLength: 6,
    laborRate: 60000,
    width: 2.4,
    length: 3,
    height: 2.5,
    quantity: 1,
    floorSpacing: 0.4,
    wallSpacing: 0.4,
    roofSpacing: 0.4,
    roofOverhang: 0.15,
    panelArea: 2.98,
    wasteFactor: 10,
    windowCount: 1,
    windowWidth: 0.6,
    windowHeight: 0.6,
    doorCount: 1,
    doorWidth: 0.8,
    doorHeight: 2
  }
};

const CLADDING_SYSTEMS = {
  corrugated_sheet: {
    label: "Chapa sinusoidal galvanizada N°25 prepintada",
    unit: "u",
    coverageArea: 2.64,
    detail: "Hoja comercial 1,10 x 2,40 m aprox."
  },
  trapezoidal_sheet: {
    label: "Chapa trapezoidal T101 galvanizada prepintada",
    unit: "u",
    coverageArea: 2.64,
    detail: "Hoja comercial 1,10 x 2,40 m aprox."
  },
  cement_board: {
    label: "Placa cementicia Superboard 10 mm",
    unit: "u",
    coverageArea: 2.88,
    detail: "Placa comercial 1,20 x 2,40 m"
  },
  sandwich_panel: {
    label: "Panel sándwich EPS 50 mm c/chapa prepintada",
    unit: "u",
    coverageArea: 2.4,
    detail: "Panel modular 1,00 x 2,40 m"
  },
  drywall: {
    label: "Placa Durlock estándar 12.5 mm",
    unit: "u",
    coverageArea: 2.88,
    detail: "Placa comercial 1,20 x 2,40 m"
  },
  moisture_drywall: {
    label: "Placa Durlock Hidrofugada (verde) 12.5 mm",
    unit: "u",
    coverageArea: 2.88,
    detail: "Placa comercial 1,20 x 2,40 m"
  },
  frp_panel: {
    label: "Panel FRP fibra de vidrio liso 3 mm",
    unit: "u",
    coverageArea: 2.98,
    detail: "Panel comercial 1,22 x 2,44 m"
  }
};

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function ceil(value, digits = 0) {
  const factor = 10 ** digits;
  return Math.ceil(value * factor) / factor;
}

function ensurePositive(value, minimum) {
  return Math.max(toNumber(value, minimum), minimum);
}

function applyWaste(value, wasteRate) {
  return value * (1 + wasteRate);
}

function createItem(scope, category, material, unit, quantity, detail, stockLength = 6) {
  const normalizedQuantity = unit === "u" ? Math.ceil(quantity) : ceil(quantity, 2);
  return {
    scope,
    category,
    material,
    unit,
    quantity: normalizedQuantity,
    profileCount: unit === "ml" ? Math.ceil(normalizedQuantity / stockLength) : null,
    detail
  };
}

export function getPreset(spaceType) {
  return PRESETS[spaceType] ?? PRESETS.vivienda;
}

export function getStructureSystem(structureType) {
  return STRUCTURE_SYSTEMS[structureType] ?? STRUCTURE_SYSTEMS.steel_tube;
}

function getCladdingSystem(claddingType) {
  return CLADDING_SYSTEMS[claddingType] ?? CLADDING_SYSTEMS.corrugated_sheet;
}

function normalizeMainFrameSection(rawSection, system) {
  if (system.mainFrameOptions.includes(rawSection)) {
    return rawSection;
  }
  return system.defaultMainFrameSection;
}

export function normalizeInput(rawInput) {
  const preliminarySystem = getStructureSystem(rawInput.structureType || "steel_tube");
  const quantity = ensurePositive(rawInput.quantity, 1);
  const width = ensurePositive(rawInput.width, 1.2);
  const length = ensurePositive(rawInput.length, 1.2);
  const height = ensurePositive(rawInput.height, 2);
  const floorSpacing = ensurePositive(rawInput.floorSpacing, 0.3);
  const wallSpacing = ensurePositive(rawInput.wallSpacing, 0.3);
  const roofSpacing = ensurePositive(rawInput.roofSpacing, 0.3);
  const roofOverhang = Math.max(toNumber(rawInput.roofOverhang, 0), 0);
  const panelArea = ensurePositive(rawInput.panelArea, 1);
  const stockLength = ensurePositive(rawInput.stockLength, 3);
  const laborRate = Math.max(toNumber(rawInput.laborRate, 60000), 0);
  const wasteFactor = Math.max(toNumber(rawInput.wasteFactor, 0), 0) / 100;
  const windowCount = Math.max(Math.round(toNumber(rawInput.windowCount, 0)), 0);
  const windowWidth = Math.max(toNumber(rawInput.windowWidth, 0), 0);
  const windowHeight = Math.max(toNumber(rawInput.windowHeight, 0), 0);
  const doorCount = Math.max(Math.round(toNumber(rawInput.doorCount, 0)), 0);
  const doorWidth = Math.max(toNumber(rawInput.doorWidth, 0), 0);
  const doorHeight = Math.max(toNumber(rawInput.doorHeight, 0), 0);

  return {
    projectName: rawInput.projectName?.trim() || "Proyecto modular",
    spaceType: rawInput.spaceType || "vivienda",
    interiorUseType: rawInput.interiorUseType || "dry",
    structureType: rawInput.structureType || "steel_tube",
    mainFrameSection: normalizeMainFrameSection(
      rawInput.mainFrameSection,
      preliminarySystem
    ),
    calculationMode: rawInput.calculationMode || "mixed",
    wallExteriorCladding: rawInput.wallExteriorCladding || "corrugated_sheet",
    wallInteriorLining: rawInput.wallInteriorLining || "drywall",
    roofCladding: rawInput.roofCladding || "corrugated_sheet",
    quantity,
    width,
    length,
    height,
    floorSpacing,
    wallSpacing,
    roofSpacing,
    roofOverhang,
    panelArea,
    stockLength,
    laborRate,
    wasteFactor,
    windowCount,
    windowWidth,
    windowHeight,
    doorCount,
    doorWidth,
    doorHeight
  };
}

export function calculateProject(rawInput) {
  const input = normalizeInput(rawInput);
  const system = getStructureSystem(input.structureType);
  const wallExteriorCladding = getCladdingSystem(input.wallExteriorCladding);
  const wallInteriorLining = getCladdingSystem(input.wallInteriorLining);
  const roofCladding = getCladdingSystem(input.roofCladding);
  const moduleArea = input.width * input.length;
  const modulePerimeter = 2 * (input.width + input.length);
  const mainFrameSection = normalizeMainFrameSection(input.mainFrameSection, system);
  const roofWidth = input.width + input.roofOverhang * 2;
  const roofLength = input.length + input.roofOverhang * 2;
  const roofArea = roofWidth * roofLength;

  const windowAreaEach = input.windowWidth * input.windowHeight;
  const doorAreaEach = input.doorWidth * input.doorHeight;
  const totalWindowArea = windowAreaEach * input.windowCount;
  const totalDoorArea = doorAreaEach * input.doorCount;
  const openingArea = totalWindowArea + totalDoorArea;

  const grossWallArea = modulePerimeter * input.height;
  const netWallArea = Math.max(grossWallArea - openingArea, grossWallArea * 0.35);

  const floorJoistsPerModule = Math.ceil(input.length / input.floorSpacing) + 1;
  const floorJoistSpan = input.width;
  const wallStudsWidthWall = Math.ceil(input.width / input.wallSpacing) + 1;
  const wallStudsLengthWall = Math.ceil(input.length / input.wallSpacing) + 1;
  const baseWallStudsPerModule =
    wallStudsWidthWall * 2 + wallStudsLengthWall * 2;
  const cornerReinforcementStuds = 8;
  const openingSideStuds =
    input.windowCount * 4 + input.doorCount * 4;
  const wallStudsPerModule =
    baseWallStudsPerModule + cornerReinforcementStuds + openingSideStuds;
  const roofRaftersPerModule = Math.ceil(roofLength / input.roofSpacing) + 1;
  const roofRafterSpan = roofWidth;

  const windowFrameLength =
    input.windowCount * 2 * (input.windowWidth + input.windowHeight);
  const doorFrameLength =
    input.doorCount * 2 * (input.doorWidth + input.doorHeight);
  const windowHeadersLength = input.windowCount * input.windowWidth;
  const windowSillsLength = input.windowCount * input.windowWidth;
  const doorHeadersLength = input.doorCount * input.doorWidth;
  const openingReinforcementLength =
    windowFrameLength + doorFrameLength + windowHeadersLength + windowSillsLength + doorHeadersLength;
  const cornerPostsPerModule = 4;
  const cornerPostsLength = cornerPostsPerModule * input.height;
  const upperCubeFrameLength = modulePerimeter;
  const lowerCubeFrameLength = modulePerimeter;
  const mainCubeFrameLength =
    cornerPostsLength + upperCubeFrameLength + lowerCubeFrameLength;

  const qty = input.quantity;
  const wastedFloorArea = applyWaste(moduleArea * qty, input.wasteFactor);
  const wastedWallArea = applyWaste(netWallArea * qty, input.wasteFactor);
  const wastedRoofArea = applyWaste(roofArea * qty, input.wasteFactor);
  const interiorWallArea = wastedWallArea;
  const laborCostPerModule = moduleArea * input.laborRate;
  const laborCostTotal = laborCostPerModule * qty;

  const allMaterials = [
    createItem(
      "Despiece estructural",
      "Bastidor principal",
      `Bastidor principal ${mainFrameSection}`,
      "ml",
      applyWaste(mainCubeFrameLength * qty, input.wasteFactor),
      `${cornerPostsPerModule} columnas + marco superior e inferior del cubo`,
      input.stockLength
    ),
    createItem(
      "Despiece estructural",
      "Piso",
      `Perfil estructural para vigas perimetrales ${system.perimeterBeam}`,
      "ml",
      applyWaste(modulePerimeter * qty, input.wasteFactor),
      "Travesaños y rigidización secundaria del piso",
      input.stockLength
    ),
    createItem(
      "Despiece estructural",
      "Piso",
      `Perfil estructural para viguetas ${system.floorJoist}`,
      "ml",
      applyWaste(floorJoistsPerModule * floorJoistSpan * qty, input.wasteFactor),
      `${floorJoistsPerModule} viguetas por módulo, luz estimada ${round(floorJoistSpan)} m`,
      input.stockLength
    ),
    createItem(
      "Despiece estructural",
      "Piso",
      `${system.structuralPanel} para piso`,
      "u",
      wastedFloorArea / input.panelArea,
      `Cobertura estimada ${round(wastedFloorArea)} m²`
    ),
    createItem(
      "Estimación complementaria",
      "Piso",
      system.floorInsulation,
      "m²",
      wastedFloorArea,
      "Superficie útil con merma incluida"
    ),
    createItem(
      "Despiece estructural",
      "Piso",
      system.anchor,
      "u",
      modulePerimeter * qty / 1.2,
      "Un anclaje cada 1,2 m lineales"
    ),
    createItem(
      "Despiece estructural",
      "Paredes",
      `Perfil estructural para soleras y dinteles ${system.wallStud}`,
      "ml",
      applyWaste(modulePerimeter * 3 * qty, input.wasteFactor),
      "Solera inferior y doble solera superior",
      input.stockLength
    ),
    createItem(
      "Despiece estructural",
      "Paredes",
      `Perfil estructural para montantes ${system.wallStud}`,
      "ml",
      applyWaste(wallStudsPerModule * input.height * qty, input.wasteFactor),
      `${wallStudsPerModule} montantes por módulo incluyendo esquinas y laterales de aberturas`,
      input.stockLength
    ),
    createItem(
      "Despiece estructural",
      "Paredes",
      `Perfil estructural para refuerzos de aberturas ${system.openingFrame}`,
      "ml",
      applyWaste(openingReinforcementLength * qty, input.wasteFactor),
      "Dinteles, antepechos, jambas y refuerzos extra",
      input.stockLength
    ),
    createItem(
      "Despiece estructural",
      "Paredes",
      `${system.structuralPanel} para muros`,
      "u",
      wastedWallArea / input.panelArea,
      `Cobertura estimada ${round(wastedWallArea)} m²`
    ),
    createItem(
      "Cerramiento",
      "Paredes exteriores",
      wallExteriorCladding.label,
      wallExteriorCladding.unit,
      wastedWallArea / wallExteriorCladding.coverageArea,
      `${wallExteriorCladding.detail} | cobertura ${round(wastedWallArea)} m²`
    ),
    createItem(
      "Cerramiento",
      "Paredes interiores",
      wallInteriorLining.label,
      wallInteriorLining.unit,
      interiorWallArea / wallInteriorLining.coverageArea,
      `${wallInteriorLining.detail} | uso interior ${input.interiorUseType === "dry" ? "seco" : input.interiorUseType === "kitchen" ? "cocina/lavadero" : "baño/ducha"}`
    ),
    createItem(
      "Estimación complementaria",
      "Paredes",
      system.windBarrier,
      "m²",
      wastedWallArea,
      "Aplicación sobre caras exteriores"
    ),
    createItem(
      "Estimación complementaria",
      "Paredes",
      system.wallInsulation,
      "m²",
      wastedWallArea,
      "Superficie neta de muros"
    ),
    createItem(
      "Despiece estructural",
      "Techo",
      `Perfil estructural para cabios ${system.roofRafter}`,
      "ml",
      applyWaste(roofRaftersPerModule * roofRafterSpan * qty, input.wasteFactor),
      `${roofRaftersPerModule} cabios por módulo, luz estimada ${round(roofRafterSpan)} m`,
      input.stockLength
    ),
    createItem(
      "Despiece estructural",
      "Techo",
      `Perfil estructural para vigas perimetrales ${system.perimeterBeam}`,
      "ml",
      applyWaste((2 * roofWidth + 2 * roofLength) * qty, input.wasteFactor),
      "Perímetro secundario de apoyo para la cubierta",
      input.stockLength
    ),
    createItem(
      "Despiece estructural",
      "Techo",
      `${system.structuralPanel} para techo`,
      "u",
      wastedRoofArea / input.panelArea,
      `Cobertura estimada ${round(wastedRoofArea)} m²`
    ),
    createItem(
      "Cerramiento",
      "Cubierta",
      roofCladding.label,
      roofCladding.unit,
      wastedRoofArea / roofCladding.coverageArea,
      `${roofCladding.detail} | cobertura ${round(wastedRoofArea)} m²`
    ),
    createItem(
      "Estimación complementaria",
      "Techo",
      system.roofMembrane,
      "m²",
      wastedRoofArea,
      "Cobertura total del techo"
    ),
    createItem(
      "Estimación complementaria",
      "Techo",
      system.roofInsulation,
      "m²",
      wastedRoofArea,
      "Bajo cubierta"
    ),
    createItem(
      "Estimación complementaria",
      "Aberturas",
      "Ventanas",
      "u",
      input.windowCount * qty,
      `${input.windowWidth} x ${input.windowHeight} m`
    ),
    createItem(
      "Estimación complementaria",
      "Aberturas",
      "Puertas",
      "u",
      input.doorCount * qty,
      `${input.doorWidth} x ${input.doorHeight} m`
    ),
    createItem(
      "Estimación complementaria",
      "Fijaciones",
      system.fastener,
      "u",
      (wastedFloorArea + wastedWallArea + wastedRoofArea) * 22,
      "Estimación global de fijaciones"
    ),
    createItem(
      "Estimación complementaria",
      "Fijaciones",
      system.sealant,
      "u",
      (input.windowCount + input.doorCount) * qty * 2,
      "Dos unidades por abertura"
    )
  ];

  const materials = allMaterials.filter((item) => {
    if (input.calculationMode === "structural") {
      return item.scope === "Despiece estructural";
    }
    if (input.calculationMode === "estimate") {
      return item.scope === "Estimación complementaria";
    }
    return true;
  });

  const totals = {
    modules: qty,
    area: round(moduleArea * qty),
    wallArea: round(netWallArea * qty),
    roofArea: round(roofArea * qty),
    openingsArea: round(openingArea * qty),
    panelUnits: materials
      .filter((item) => item.material.includes(system.structuralPanel))
      .reduce((sum, item) => sum + item.quantity, 0),
    linealMeters: materials
      .filter((item) => item.unit === "ml")
      .reduce((sum, item) => sum + item.quantity, 0),
    profileUnits: materials
      .filter((item) => item.profileCount !== null)
      .reduce((sum, item) => sum + item.profileCount, 0),
    claddingUnits: materials
      .filter((item) => item.scope === "Cerramiento" && item.unit === "u")
      .reduce((sum, item) => sum + item.quantity, 0),
    structuralItems: materials.filter(
      (item) => item.scope === "Despiece estructural"
    ).length,
    claddingItems: materials.filter(
      (item) => item.scope === "Cerramiento"
    ).length,
    estimateItems: materials.filter(
      (item) => item.scope === "Estimación complementaria"
    ).length,
    items: materials.length
  };

  return {
    input,
    system: {
      ...system,
      mainFrameSection
    },
    cladding: {
      wallExteriorCladding,
      wallInteriorLining,
      roofCladding
    },
    costs: {
      laborRate: input.laborRate,
      laborCostPerModule: round(laborCostPerModule),
      laborCostTotal: round(laborCostTotal)
    },
    commercial: {
      laborIncluded: true,
      materialsPricingStatus: "subject_to_approval",
      materialsPricingLabel: "Materiales sujetos a aprobación del proyecto",
      quoteValidityDays: 7,
      notes:
        "Las cantidades son estimativas para cómputo preliminar. La definición final depende de aprobación comercial, validación técnica, disponibilidad y detalles ejecutivos."
    },
    totals,
    derived: {
      moduleArea: round(moduleArea),
      modulePerimeter: round(modulePerimeter),
      mainCubeFrameLength: round(mainCubeFrameLength),
      floorJoistSpan: round(floorJoistSpan),
      floorJoistsPerModule,
      wallStudsWidthWall,
      wallStudsLengthWall,
      openingReinforcementLength: round(openingReinforcementLength),
      roofRafterSpan: round(roofRafterSpan),
      wallStudsPerModule,
      roofRaftersPerModule
    },
    materials
  };
}

export function buildSummaryCards(result) {
  return [
    {
      label: "Superficie construida",
      value: `${result.totals.area} m²`,
      note: `${result.totals.modules} módulo(s)`
    },
    {
      label: "Muros netos",
      value: `${result.totals.wallArea} m²`,
      note: "Descontando aberturas"
    },
    {
      label: "Cubierta",
      value: `${result.totals.roofArea} m²`,
      note: "Incluye voladizos"
    },
    {
      label: "Paneles estructurales",
      value: `${Math.ceil(result.totals.panelUnits)} u`,
      note: "Placas base estructurales"
    },
    {
      label: "Sistema",
      value: result.system.label,
      note: `${result.system.frameMaterial} / bastidor ${result.system.mainFrameSection}`
    },
    {
      label: "Perfilería / tirantería",
      value: `${round(result.totals.linealMeters)} ml`,
      note: "Perfilería y marcos"
    },
    {
      label: "Perfiles comerciales",
      value: `${result.totals.profileUnits} u`,
      note: `Barras de ${result.input.stockLength} m`
    },
    {
      label: "Cerramientos",
      value: `${Math.ceil(result.totals.claddingUnits)} u`,
      note: "Exterior, interior y cubierta"
    },
    {
      label: "Bastidor del cubo",
      value: `${result.derived.mainCubeFrameLength} ml`,
      note: `${result.system.mainFrameSection} antes de merma`
    },
    {
      label: "Aberturas",
      value: `${result.input.windowCount * result.input.quantity + result.input.doorCount * result.input.quantity} u`,
      note: "Ventanas + puertas"
    },
    {
      label: "Área de aberturas",
      value: `${result.totals.openingsArea} m²`,
      note: "Para descontar cerramientos"
    },
    {
      label: "Renglones de compra",
      value: `${result.totals.items}`,
      note: `${result.totals.structuralItems} estructural / ${result.totals.claddingItems} cerramiento / ${result.totals.estimateItems} complementario`
    },
    {
      label: "Estado comercial",
      value: "MO cotizable",
      note: result.commercial.materialsPricingLabel
    }
  ];
}

export function consolidateMaterials(result) {
  const grouped = new Map();

  result.materials.forEach((item) => {
    const key = [item.scope, item.material, item.unit].join("|");
    const current = grouped.get(key) ?? {
      scope: item.scope,
      categories: [],
      material: item.material,
      unit: item.unit,
      quantity: 0,
      profileCount: 0,
      detailParts: []
    };

    current.quantity += item.quantity;
    current.profileCount += item.profileCount ?? 0;
    if (!current.categories.includes(item.category)) {
      current.categories.push(item.category);
    }
    if (!current.detailParts.includes(item.detail)) {
      current.detailParts.push(item.detail);
    }
    grouped.set(key, current);
  });

  return [...grouped.values()].map((item) => ({
    scope: item.scope,
    category: item.categories.join(" + "),
    material: item.material,
    unit: item.unit,
    quantity: item.unit === "u" ? Math.ceil(item.quantity) : ceil(item.quantity, 2),
    profileCount: item.profileCount > 0 ? Math.ceil(item.profileCount) : null,
    detail: item.detailParts.join(" | ")
  }));
}

function rowsToCsv(rows, header) {
  return [header, ...rows]
    .map((row) =>
      row
        .map((cell) => `"${String(cell).replaceAll('"', '""')}"`)
        .join(",")
    )
    .join("\n");
}

export function materialsToCsv(result) {
  const header = ["Tipo", "Rubro", "Material", "Unidad", "Cantidad", "Perfiles", "Detalle"];
  const rows = result.materials.map((item) => [
    item.scope,
    item.category,
    item.material,
    item.unit,
    String(item.quantity),
    item.profileCount === null ? "" : String(item.profileCount),
    item.detail
  ]);

  return rowsToCsv(rows, header);
}

export function consolidatedMaterialsToCsv(result) {
  const header = ["Tipo", "Rubro base", "Material", "Unidad", "Total", "Perfiles", "Detalle"];
  const rows = consolidateMaterials(result).map((item) => [
    item.scope,
    item.category,
    item.material,
    item.unit,
    String(item.quantity),
    item.profileCount === null ? "" : String(item.profileCount),
    item.detail
  ]);

  return rowsToCsv(rows, header);
}
