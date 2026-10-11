# Prompt para Astra · Motor de ingeniería estructural de ActivaModular

> Autor del encargo: jesus.olguin (ActivaQR · ActivaControl · ActivaModular)
> Repositorio: `jesus1942/ModularLive` · rama base `master` · se publica en GitHub Pages
> Idioma de la interfaz y de los textos: español rioplatense (voseo), sin anglicismos innecesarios.

---

## 0. Tu rol y el objetivo

Sos el equipo de desarrollo de **ActivaModular**, un diseñador de viviendas modulares (tubo estructural hoy; steel frame, wood frame y container después). La app ya dibuja la planta, genera cada pieza de la estructura, muestra el 3D y computa materiales.

Lo que falta es **ingeniería**: hoy las secciones, las separaciones y la fundación son fijas o salen de reglas simples, y nada verifica si la estructura resiste. Tu trabajo es construir un **motor de cálculo estructural** que:

1. Calcule las **cargas reales**: peso propio a partir de los materiales que se usan, sobrecargas de uso, nieve, viento y sismo según la ubicación.
2. Haga la **bajada de cargas** completa, nivel por nivel, hasta el suelo, incluyendo niveles superiores más grandes, más chicos, desplazados o en voladizo.
3. **Analice** la estructura principal como pórtico espacial y los elementos secundarios por área tributaria.
4. **Verifique y dimensione** cada barra (columnas, vigas, viguetas, cabios, montantes, arriostramientos) y elija el **tipo de viga** adecuado.
5. Diseñe **uniones y anclajes** según las solicitaciones: placas base, bulones, uniones entre niveles y fijación del techo contra el levantamiento.
6. Verifique la **estabilidad global**: vuelco, levantamiento y deslizamiento.
7. **Recalcule la fundación** a partir de las reacciones reales de cada columna: dados, zapatas, vigas con pilotes o platea.
8. Proponga la **distribución de columnas** que mejor resuelve el camino de cargas.
9. Diseñe las **escaleras** entre niveles: geometría según reglamento, hueco en el entrepiso con sus vigas, estructura, barandas y cómputo.
10. Verifique las **reglas de edificación y habitabilidad**: alturas de locales, iluminación, ventilación, puertas, aislación térmica y condensación.
11. Entregue una **memoria de cálculo** trazable, y vuelque todo al 3D y al cómputo de materiales.

La regla de oro del proyecto se mantiene: **lo que se ve en 3D es lo que se computa y lo que se calcula**. Una sola fuente de verdad, el modelo de obra, de la que salen piezas, análisis, verificaciones, fundación y cómputo.

### Por qué esto es urgente (caso real)

Módulo por defecto de la app: 3 × 6 m, techo plano liviano con alero de 0,25 m, sobre 6 dados de 0,40 × 0,40 × 0,80 m. Ubicación tipo: costa de Chubut.

- La Guía de aplicación del CIRSOC 102-2005 usa para Telsen (Chubut) una velocidad básica de **V = 58 m/s**.
- Presión dinámica: qz = 0,613 · Kz · Kzt · Kd · V² · I = 0,613 · 0,85 · 1 · 0,85 · 58² · 1 ≈ **1,49 kPa**. Valores usados: exposición C, z ≤ 4,5 m, Kd = 0,85 e I = 1.
- Peso propio de la cubierta: aproximadamente 0,36 kPa (chapa, OSB, aislación, cabios y cielorraso).
- Combinación 0,9D + 1,6W con GCp neto ≈ −1,08: **−2,25 kPa**. Sobre 22,75 m² de techo son **≈ 51 kN de levantamiento** factorizado.
- Los 6 dados pesan en total **≈ 18 kN**.

Hoy la app dibuja una fundación que, con viento patagónico, probablemente no alcanza para retener la estructura. Estos números son un orden de magnitud ilustrativo; el motor tiene que calcularlo bien. **El viento manda en estas construcciones livianas**, y es lo primero que el motor debe resolver.

---

## 1. Contexto del repositorio (estado actual)

PWA estática, **sin build**: HTML más módulos ES nativos. Se publica tal cual en GitHub Pages con `.github/workflows/pages.yml` cuando se hace push a `master`. Los tests se corren con `node --test` (hoy hay 19 que pasan).

| Archivo | Qué hace hoy |
| --- | --- |
| `cad.html`, `cad/app.js`, `cad/cad.css` | Interfaz del diseñador: planta, 3D, paneles, cómputo, lista de cortes |
| `cad/model.js` | Modelo de obra: `project.levels[] = { id, name, height, walls[] }`; muros `{ id, type: "exterior"\|"interior", a:{x,y}, b:{x,y}, openings[] }`; aberturas `{ kind: "door"\|"window", offset, width, height, sill, hinge, swing }`; `findFootprint`, `doorLeaf`, migración de diseños viejos |
| `cad/catalog.js` | `PROFILES` (perfiles con b, h, t en metros), `SHEETS`, `SYSTEMS` (roles → perfil), `FOUNDATIONS`, `ROOF_TYPES` |
| `cad/geometry.js` | Utilidades de planta: polígonos, offset, barridos, `differenceRects` |
| `cad/generator.js` | Genera las piezas `members[]` `{ id, role, group, layer, profileId, w, h, a:[x,y,z], b:[x,y,z], cut, level, wallId, nrm }`, los `solids[]` (fundación) y las `surfaces[]`. Devuelve también `levels[]` `{ elev, floorTop, zTop, footprint, columns[] }`, `totals` y `warnings` |
| `cad/bom.js` | Cómputo de materiales y optimización de cortes |
| `cad/plan-editor.js` | Editor de planta en SVG |
| `cad/viewer3d.js` | Visor three.js r170, incluido en `vendor/three/` |
| `cad/store.js` | Estado con deshacer y rehacer; guarda en `localStorage` |
| `index.html`, `app.js`, `calculator.js` | Calculadora rápida anterior (no tocar salvo lo indicado) |
| `sw.js` | Service worker: lista explícita de assets offline. **Agregá cada archivo nuevo ahí** |

Convenciones:

- **Unidades**: metros. Eje z hacia arriba. En planta, y crece hacia abajo en pantalla. En three.js se mapea `(x, y, z) → (x, z, y)`.
- **Roles de pieza**: `column`, `ringBeam`, `floorJoist`, `stud`, `track`, `openingFrame`, `rafter`, `roofEdge`, `ridge`.
- **Niveles**: cada nivel es un módulo completo (bastidor inferior, piso, muros y bastidor superior) que apoya sobre el bastidor superior del nivel de abajo. Arriba las columnas siguen los vanos de abajo. Si una esquina de arriba cae sobre un muro de abajo, se genera una columna abajo.
- **Marca**: logo de Jesús Olguín (infinito) y footer brutalista blanco y negro "ActivaModular". **No uses naranja en elementos nuevos**: la paleta nueva es blanco, negro y grises. El verde y el naranja de la interfaz actual pueden migrar a esa paleta si tocás esos componentes.

---

## 2. Principios no negociables

1. **Honestidad de resultados.** Esto es predimensionado y verificación preliminar. En Argentina el cálculo estructural lo firma un profesional matriculado. Nunca muestres "APROBADO". Mostrá "Cumple los chequeos implementados", "No cumple" o "Revisar", y explicá qué no se verificó. En la memoria va una leyenda visible sobre alcance y responsabilidad profesional.
2. **Nada falla en silencio.** Si un dato falta (suelo, viento, zona) se usa un valor conservador marcado como *supuesto*, y la interfaz lo muestra en todos los resultados que dependen de él.
3. **Trazabilidad.** Cada número de la memoria se puede rastrear: entrada → fórmula → resultado, con la referencia al reglamento (por ejemplo "CIRSOC 301-2005, E.2"). Las tablas de coeficientes van en archivos de datos, con la fuente citada en un comentario.
4. **Unidades SI internas** (N, m, Pa, kg). La interfaz muestra kN, kN/m², MPa, y **también kgf/tf entre paréntesis**, porque en obra se habla en kilos y toneladas.
5. **Reglamentos vigentes en Argentina** (familia CIRSOC/INPRES). Si una parte del motor se apoya en la norma de origen (AISC, ACI, ASCE, AISI), citala y respetá las diferencias. Los coeficientes tienen que poder actualizarse sin tocar la lógica. Está en discusión pública el proyecto CIRSOC 102-24 y hay mapas sísmicos nuevos en revisión: **dejá todo parametrizado**.
6. **Determinismo.** El mismo proyecto da siempre el mismo resultado, sin aleatoriedad en el dimensionado.
7. **No romper lo existente.** Los 19 tests actuales siguen pasando. Las cantidades del módulo 3 × 6 por defecto, verificadas a mano, solo cambian si cambia el dimensionado, y en ese caso se documenta en el test por qué.

---

## 3. Arquitectura propuesta

Nueva carpeta `cad/engineering/`, módulos ES puros sin DOM, testeables con `node --test`:

```
cad/engineering/
  units.js            conversiones y formateo (kN↔tf, MPa↔kgf/cm², etc.)
  data/
    materials.js      pesos y densidades de materiales y capas (sección 5.1)
    locations.js      localidades: V viento, nieve pg, zona sísmica, helada (sección 4)
    sections.js       catálogo ampliado de secciones con propiedades (sección 7.1)
    reglamentos.js    coeficientes tabulados (Kz, GCp, Cs, factores φ, límites de flecha)
  loads.js            casos de carga D, L, Lr, S, W, E y combinaciones
  wind.js             CIRSOC 102 (método para edificios bajos + componentes y revestimientos)
  seismic.js          INPRES-CIRSOC 103, método estático equivalente
  tributary.js        elementos secundarios por área tributaria → cargas sobre la estructura principal
  analytical-model.js de `members[]` a nodos y barras analíticas (ejes, uniones, apoyos)
  frame3d.js          solver de rigidez directa 3D (6 GDL/nodo), skyline/banda + RCM
  steel-design.js     verificaciones CIRSOC 301/302 (y 303 para conformados en frío)
  sizing.js           dimensionado iterativo por grupos de diseño + elección de tipo de viga
  bracing.js          ubicación automática de arriostramientos
  connections.js      placas base, bulones, uniones entre niveles, techo-muro, soldaduras
  stability.js        vuelco, levantamiento, deslizamiento
  foundations.js      dados/zapatas, viga + pilotes, platea; tipificación
  column-layout.js    optimización de la distribución de columnas
  stairs.js           escaleras: geometría reglamentaria, hueco, estructura, barandas
  building-code.js    reglas de edificación y habitabilidad por jurisdicción
  data/codes/         reglas por jurisdicción (municipal, accesibilidad Ley 24.314)
  report.js           memoria de cálculo (HTML imprimible)
  engine.js           orquestador: proyecto → análisis completo → resultados
  worker.js           Web Worker que corre engine.js fuera del hilo de la interfaz
```

Flujo de datos:

```
project ──► generator (piezas con perfiles elegidos) ──► analytical-model ──► loads/tributary
   ▲                                                                           │
   │                                                                           ▼
   └──── sizing (secciones por grupo) ◄── steel-design ◄── frame3d (esfuerzos, reacciones, deformaciones)
                                                   │
                                                   ├──► connections / stability / foundations
                                                   └──► report · 3D (utilización, deformada) · BOM
```

- `engine.js` corre en **Web Worker** (`worker.js`) con debounce de unos 300 ms tras cada edición. La interfaz muestra "Calculando…" y nunca se bloquea. El generador y el cómputo de materiales siguen siendo instantáneos. El análisis llega después y actualiza el 3D, los paneles y el cómputo.
- El **generador acepta asignaciones de sección por grupo de diseño** (sección 7.4) en vez de un perfil fijo por rol. Así el 3D, la lista de cortes y el cómputo reflejan las secciones dimensionadas.
- **Claves estables de piezas.** Hoy `id` es secuencial (`m1`, `m2`…) y cambia con cualquier edición. Agregá una `key` estable del tipo `L{nivel}:{rol}:{wallId|grid}:{índice ordenado}`. Hace falta para fijar secciones a mano, comparar corridas y seleccionar desde la memoria.

---

## 4. Datos de entrada nuevos (`project.engineering`)

```js
engineering: {
  mode: "auto" | "verify",          // auto: dimensiona; verify: verifica las secciones elegidas
  location: {
    preset: "puerto-madryn",        // o "manual"
    V: 58,                          // m/s, velocidad básica CIRSOC 102 (ver nota)
    exposure: "C",                  // B, C o D (costa abierta frente al mar: evaluar D)
    Kzt: 1.0,                       // topografía (colinas, escarpas)
    pg: 0.30,                       // kN/m², nieve a nivel del terreno (CIRSOC 104)
    seismicZone: 0,                 // INPRES-CIRSOC 103 (verificar zonificación vigente)
    frostDepth: 0.60,               // m, profundidad de helada / mínima de fundación
    altitude: 0
  },
  importance: "II",                 // categoría de la construcción (vivienda: II)
  usage: [{ level: 0, use: "vivienda" }, ...],  // define sobrecarga L por nivel
  roofAccess: "inaccesible" | "terraza",
  soil: {
    qadm: 100,                      // kPa (≈1 kgf/cm²) SUPUESTO hasta estudio de suelos
    gamma: 17,                      // kN/m³
    phi: 28,                        // grados, para empuje y cono de arrancamiento
    mu: 0.45,                       // fricción base-suelo para deslizamiento
    pileSkinFriction: 20,           // kPa (fuste), pileTip: 400 kPa (punta) — SUPUESTOS
    subgradeModulus: 30000          // kN/m³ (Winkler) para platea
  },
  steel: { grade: "F-24", Fy: 235e6, Fu: 370e6, E: 200e9 },
  concrete: { grade: "H-21", fc: 21e6, rebarFy: 420e6 },
  limits: { floorTotal: 300, floorLive: 360, roof: 200, cantilever: 150, drift: 400 }, // L/x y H/x
  options: { bracing: "auto", baseFixity: "pinned", useSheathingAsShearWall: false }
}
```

- **Tabla de localidades** (`data/locations.js`): arrancar por Chubut (Puerto Madryn, Trelew, Rawson, Comodoro Rivadavia, Esquel) y las capitales, con V tomada del **mapa de la Figura 1.A del CIRSOC 102-2005**, nieve del CIRSOC 104 y zona del INPRES-CIRSOC 103. Cada valor con su fuente en comentario. Si un valor no se pudo confirmar, el preset lo marca como `"a confirmar"` y la interfaz lo muestra. Referencia confirmada: la Guía CIRSOC 102-2005 usa **58 m/s para Telsen (Chubut)**. Para Puerto Madryn leé el valor del mapa; no lo inventes.
- **Valores por defecto conservadores**: si el usuario no carga suelo, usar 100 kPa como *supuesto* y advertir "Requiere estudio de suelos".

---

## 5. Modelo de cargas (`loads.js`, `wind.js`, `seismic.js`)

### 5.1 Peso propio desde los materiales (D)

El peso propio **se calcula del modelo**, no se supone:

- **Barras**: kg/m de la sección real × largo de cada pieza, que sale del generador.
- **Superficies**: suma de capas por m² según el paquete constructivo elegido. Valores por defecto en `data/materials.js`, con fuente; verificalos contra fichas técnicas y dejalos editables:

| Capa | Peso aprox. |
| --- | --- |
| Chapa sinusoidal/trapezoidal N°25 prepintada (con solapes) | 0,05 kN/m² |
| Panel sándwich EPS 50 mm | 0,11 kN/m² |
| Placa OSB 11 mm | 0,07 kN/m² |
| Placa OSB/fenólico 18 mm | 0,11 kN/m² |
| Placa de yeso 12,5 mm | 0,10 kN/m² |
| Placa cementicia 10 mm | 0,14 kN/m² |
| Lana de vidrio 100 mm | 0,015 kN/m² |
| Lana de roca 100 mm (40 kg/m³) / alta densidad (100 kg/m³) | 0,04 / 0,10 kN/m² |
| Membrana / barrera de viento | 0,005 kN/m² |
| Piso terminado (cerámico + adhesivo) — opcional por nivel | 0,40–0,60 kN/m² |
| Tabiquería interior (si no se modela pieza por pieza) | 0,50 kN/m² equiv. |

- **Hormigón armado**: 24 kN/m³. **Acero**: 78,5 kN/m³.
- **Instalaciones y cargas permanentes extra** (tanque de agua, termotanque, equipos): el usuario puede ubicar **cargas puntuales en planta**, por ejemplo un tanque de 1000 l sobre el techo ≈ 10,5 kN.

### 5.2 Sobrecargas de uso (L, Lr) — CIRSOC 101-2005

- Tabla por uso en `data/reglamentos.js`: vivienda, oficina, depósito liviano, balcón/terraza accesible, escaleras. Sacala del CIRSOC 101-2005 (Tabla 4.1) y citá la fila.
- Techos inaccesibles: Lr con las reducciones por área tributaria y pendiente del CIRSOC 101.
- Reducción de sobrecarga por área tributaria para columnas y vigas grandes, solo donde el reglamento la permite.

### 5.3 Nieve (S) — CIRSOC 104-2005

- S = 0,7 · Ce · Ct · I · pg, con el factor de pendiente Cs para techos inclinados y la acumulación junto a muros de niveles superiores. Esto último es importante: **la terraza de un nivel más bajo pegada al muro del nivel de arriba junta nieve**.

### 5.4 Viento (W) — CIRSOC 102-2005

Implementá el **procedimiento analítico** con estos pasos:

1. qz = 0,613 · Kz · Kzt · Kd · V² · I (N/m²); Kd = 0,85 para edificios; I según la categoría (II → 1,00); Kz según la tabla de exposición y la altura.
2. **Sistema principal (SPRFV)**: coeficientes de edificio bajo para presiones externas por zonas de fachada y cubierta. Incluí presión interna GCpi = ±0,18 para edificios cerrados, o ±0,55 si una fachada tiene aberturas dominantes; evaluá esto a partir de las ventanas y puertas del modelo. Evaluá **dos direcciones ortogonales × dos sentidos** y los casos de torsión del reglamento.
3. **Componentes y revestimientos**: presiones locales en esquinas, bordes y aleros, para fijaciones de chapa, cabios, clips y anclajes del alero.
4. Las presiones se aplican **sobre las superficies que genera el modelo**, que ya existen como `surfaces[]` con normal y área. Después se convierten en cargas sobre cabios, montantes y vigas por área tributaria.
5. Niveles apilados: altura z real de cada superficie, y efecto de sombra o resguardo **no** considerado (conservador).

### 5.5 Sismo (E) — INPRES-CIRSOC 103

- Zona sísmica por localidad, parametrizada y verificable contra la zonificación vigente.
- **Método estático equivalente**: corte basal V0 = C · W, distribuido en altura proporcional a W·h. Con diafragma rígido se reparte según rigideces. Incluí la excentricidad accidental.
- En zona 0 el motor lo informa y aplica lo mínimo que exija el reglamento para esa zona.

### 5.6 Combinaciones — CIRSOC 301-2005 (estados límite)

Resistencia:

```
1,4 D
1,2 D + 1,6 L + 0,5 (Lr ó S)
1,2 D + 1,6 (Lr ó S) + (0,5 L ó 0,8 W)
1,2 D + 1,6 W + 0,5 L + 0,5 (Lr ó S)
1,2 D ± 1,0 E + 0,5 L + 0,2 S
0,9 D ± 1,6 W        ← levantamiento, vuelco y tracción en anclajes
0,9 D ± 1,0 E
```

Servicio (flechas y desplazamientos): D + L, L sola, D + 0,7 W (o el criterio que adopte el reglamento para servicio).

Generá cada combinación para **cada dirección y sentido de viento**. Guardá la envolvente y **la combinación que gobierna** cada verificación, porque la memoria la tiene que mostrar.

---

## 6. Bajada de cargas y modelo estructural

### 6.1 Elementos secundarios por área tributaria (`tributary.js`)

Viguetas, cabios, montantes, dinteles, antepechos y correas se verifican **como barras individuales**: simplemente apoyadas, continuas o en voladizo, según cómo las arma el generador. Sus reacciones pasan como cargas a la estructura principal. Ejemplos:

- **Vigueta de piso**: w = (D_piso + L) × separación → reacción wL/2 sobre cada bastidor.
- **Montante de muro exterior**: compresión por lo que descarga el bastidor superior entre montantes, más flexión por viento perpendicular (w = p × separación). Se verifica a flexo-compresión.
- **Dintel**: carga del muro y entrepiso sobre la abertura → reacciones en las jambas.
- **Cabio**: gravitatorias y viento en dirección perpendicular a la cubierta. Contemplá succión (levantamiento) y la reacción de anclaje en cada apoyo.

### 6.2 Estructura principal: pórtico espacial (`analytical-model.js`, `frame3d.js`)

- **Modelo analítico**: nodos en los ejes, en las intersecciones columna-viga de cada nivel, más nodos donde caen columnas de niveles superiores o cargas puntuales. Barras: columnas, bastidores (vigas de borde), vigas de transferencia, arriostramientos y la viga de fundación si existe.
- El generador desplaza ejes por practicidad visual. Por ejemplo, los bastidores están a `elev + h/2`. **El modelo analítico debe colapsar esos desfases a nodos comunes**, con una tolerancia de 1–2 cm; o bien modelar offsets rígidos, si lo justificás.
- **Elemento**: viga 3D de Euler-Bernoulli de 12 GDL (E, G, A, Iy, Iz, J), con la matriz de transformación construida a partir de `nrm`, la normal del muro que ya viene en cada pieza, para orientar el eje fuerte. Liberaciones de extremos para uniones articuladas. Barras de solo tracción para tensores: iteración activando y desactivando, máximo 10 pasadas.
- **Apoyos**: articulados por defecto (placa base con 4 bulones = articulación conservadora). Empotramiento opcional, solo si la placa y los anclajes se diseñan para momento (sección 8.1).
- **Unión entre niveles**: columna superior sobre columna inferior a través de las placas abulonadas. Modelá continuidad axial y de corte, con momento liberado salvo que la unión se diseñe para momento.
- **Solver**: ensamble en almacenamiento **skyline o de banda**, con renumeración **Reverse Cuthill-McKee**; factorización LDLᵀ o Cholesky. Si el sistema crece mucho, gradiente conjugado precondicionado (Jacobi). Detectá **mecanismos** (pivote ≈ 0) e informá qué nodo o grado de libertad está inestable, en lenguaje claro: "Falta arriostrar el muro del eje B".
- **Resultados por combinación**: desplazamientos, esfuerzos en los extremos de cada barra (N, Vy, Vz, T, My, Mz), reacciones y diagramas en 5–11 puntos por barra para encontrar los máximos.
- **Chequeo de equilibrio obligatorio**: la suma de reacciones es igual a la suma de cargas para cada combinación (error relativo < 1e-6). Si no cierra, el motor lo reporta como error interno.
- **Efectos de segundo orden**: amplificación B1/B2 del CIRSOC 301 (o análisis P-Δ iterativo), activada cuando el desplazamiento lateral lo justifique.

### 6.3 Sistema lateral, diafragmas y arriostramientos (`bracing.js`)

- Las columnas con bases articuladas y uniones soldadas livianas **no alcanzan** para resistir el viento patagónico con desplazamientos aceptables. Hace falta un sistema lateral explícito.
- **Arriostramiento automático**: cruces de San Andrés (barra redonda con tensor o planchuela) en paños de muro **sin aberturas**, como mínimo 2 por dirección y por nivel. Ubicalas lo más simétricas posible para acercar el centro de rigidez al centro de masa. Sumá arriostramiento horizontal en el plano del techo y del entrepiso si el diafragma no se considera rígido.
- Calculá el centro de masa y el centro de rigidez por nivel, y la **torsión**. Si la excentricidad supera el 10 % de la dimensión en planta, avisá y proponé dónde agregar otro paño arriostrado.
- Diafragma: OSB atornillado más bastidor, que se puede asumir rígido en su plano si la relación de aspecto es ≤ 3:1. Si no, modelá el diafragma flexible repartiendo por área tributaria.
- Opción avanzada `useSheathingAsShearWall`: placas como muros de corte. Queda desactivada por defecto; si se implementa, citá la fuente de los valores de resistencia.

### 6.4 Niveles apilados: más grande, más chico, desplazado, en voladizo

Esto es lo que más le falta hoy al software. Hay que tratar cada caso:

1. **Nivel superior más chico**: las cargas de sus columnas bajan por columnas coincidentes de abajo; esa es la opción preferida, porque la carga va directa. Si una columna de arriba cae a mitad de un bastidor de abajo, ese tramo pasa a ser **viga de transferencia** con carga puntual: se verifica a flexión, corte y flecha, y probablemente necesite otra sección o tipo de viga. La terraza descubierta de abajo recibe sobrecarga de terraza si es accesible, y nieve con acumulación junto al muro.
2. **Nivel superior más grande, con voladizo**: las viguetas o vigas del entrepiso deben ser **continuas sobre el apoyo**, con un tramo de contrapeso. Verificá:
   - el momento en el apoyo, M = wL²/2 + P·L para la carga del muro del borde;
   - el corte;
   - la flecha en la punta, con límite L/150 por defecto;
   - el **levantamiento en el apoyo trasero**, que se ancla.
   - Regla de diseño: voladizo ≤ 1/3 del tramo trasero y ≤ 1,20 m resuelto con vigas; más que eso, el motor propone **columnas hasta el suelo** con su fundación o una **viga reticulada**, y el usuario elige.
3. **Nivel desplazado o girado**: cargas excéntricas, flexión en columnas y torsión del conjunto. Se resuelve igual con el pórtico 3D; la clave es que el modelo analítico genere los nodos donde corresponde.
4. **Fundación**: siempre se recalcula con las reacciones de **todos** los niveles (sección 10). Nunca se dimensiona por área en planta.

### 6.5 Distribución de columnas (`column-layout.js`)

- **Candidatos**: esquinas, encuentros en T, bordes de aberturas (a ± una media sección), esquinas y columnas de niveles superiores, y una grilla modular sobre los muros (paso de 0,60 m).
- **Objetivo**: minimizar el costo total, que es peso de acero × precio más volumen de hormigón y excavación × precio (usar los precios que cargó el usuario si existen, y si no pesos relativos). Restricciones: todas las verificaciones cumplen, separación ≤ máxima, ninguna columna dentro de un vano, y continuidad vertical preferida (penalizar transferencias).
- **Algoritmo**: arranque con la regla actual y búsqueda local determinística (agregar, quitar o mover una columna a un candidato vecino; re-dimensionar; aceptar si baja el costo). Tope de iteraciones y tiempo, por ejemplo 2 s en el Worker.
- Alternativa que conviene implementar como métrica de comparación: la **energía de deformación** (compliance ½ uᵀKu) para la combinación gravitatoria más la de viento. Entre dos distribuciones de costo similar, preferir la de menor energía, es decir, la que "descarga" más directo. Mostrar el camino de cargas en 3D: flechas proporcionales a la carga axial de cada columna, en toneladas.
- El usuario puede **fijar** columnas (candado) y bloquear la optimización.

---

## 7. Diseño de barras (`sections.js`, `steel-design.js`, `sizing.js`)

### 7.1 Catálogo de secciones con propiedades

- **Tubos cuadrados y rectangulares** de las series comerciales argentinas: 40×40 a 200×200 y rectangulares 60×40 a 200×100, con espesores 1,6 / 2,0 / 2,5 / 3,2 / 4,0 / 4,75 / 6,35 mm. Usá los que publiquen los fabricantes locales y citá la fuente.
- **Perfiles C y U conformados** (PGC/PGU de steel frame: 100/150/200/250 × 0,89/1,24/1,60/2,00 mm) y perfiles C de carpintería metálica.
- **Laminados** para vigas de transferencia: IPN 100–300, UPN, IPE.
- **Barras redondas y planchuelas** para tensores.
- Propiedades: A, Ix, Iy, Sx, Sy, Zx, Zy, rx, ry, J, Cw cuando aplique, y peso por metro. Para tubos usá las fórmulas con radios de esquina de EN 10219 (radio exterior 2t, interior t para t ≤ 6 mm), o la tabla del fabricante si existe. Referencia para los tests: tubo 100×50×3,2 sin radios, A = 9,19 cm² e Ix = 118,7 cm⁴; con radios, A ≈ 8,93 cm² y 7,01 kg/m.
- **Acero**: F-24 por defecto (Fy 235 MPa), editable. Si el proveedor certifica ASTM A500 grado B para tubos de sección no circular (Fy ≈ 315 MPa), el usuario lo elige. **Nunca supongas un acero mejor que el certificado.**

### 7.2 Verificaciones (CIRSOC 301/302-2005; 303 para conformados en frío)

- **Clasificación de sección**: esbeltez local de paredes (b/t con ancho plano ≈ B − 3t) contra λp y λr de CIRSOC 302 para tubos. Si la sección es esbelta, hay que reducir su resistencia (ancho efectivo).
- **Tracción**: fluencia en sección bruta (φ = 0,90) y rotura en sección neta (φ = 0,75).
- **Compresión**: φc = 0,85; λc = (KL/rπ)·√(Fy/E). Si λc ≤ 1,5, Fcr = 0,658^(λc²)·Fy; si no, Fcr = (0,877/λc²)·Fy. Longitudes de pandeo K según si el pórtico está arriostrado o no. Para pandeo flexional de columnas con arriostramiento, K = 1.
  - Test de referencia: tubo 100×100×3,2 (sin radios), L = 2,60 m, articulado, F-24 → λc ≈ 0,717, Fcr ≈ 189 MPa, φPn ≈ 200 kN, Pcr de Euler ≈ 566 kN.
- **Flexión**: φb = 0,90, con plastificación y pandeo local según la clasificación. En tubos no hay pandeo lateral-torsional relevante; en C, U e IPN sí: verificalo con la longitud no arriostrada real.
- **Corte**: φv = 0,90 en almas.
- **Interacción** (H1-1): si Pu/φPn ≥ 0,2, Pu/φPn + 8/9·(Mux/φMnx + Muy/φMny) ≤ 1; si no, Pu/(2φPn) + (Mux/φMnx + Muy/φMny) ≤ 1.
- **Flechas** (servicio), límites editables: piso L/300 total y L/360 sobrecarga; techo L/200; voladizo L/150; desplazamiento lateral por viento H/400 por nivel, que hace falta para que no se fisuren la placa de yeso ni las juntas.
- **Vibraciones de entrepiso**: frecuencia fundamental aproximada f ≈ 18/√δ (δ en mm, flecha por peso propio más 10 % de la sobrecarga) ≥ 8 Hz en vivienda; si no cumple, avisar.
- Factor de utilización por verificación, para colorear y para la memoria: **η = solicitación / resistencia**.

### 7.3 Tipo de viga (reglas de selección)

| Situación | Tipo propuesto |
| --- | --- |
| Bastidor y vigueta con luz ≤ 4 m, carga distribuida | Tubo rectangular (eje fuerte vertical) |
| Luz 4–6 m o transferencia de una columna | Tubo rectangular más alto, tubo doble o IPN; comparar el peso |
| Luz > 6 m en cubierta | Viga reticulada o cercha de tubos (generar sus barras como piezas) |
| Voladizo | Viga continua sobre apoyo con tramo de contrapeso ≥ 2× voladizo, o columna |
| Arriostramiento | Barra redonda con tensor (solo tracción) o planchuela |
| Dintel con luz > 1,5 m o con carga de entrepiso | Dintel doble o tubo rectangular, con jambas dobles |

El criterio es elegir **la opción de menor peso que cumpla**, con preferencia por secciones repetidas para simplificar el corte y la compra.

### 7.4 Dimensionado iterativo por grupos de diseño

- **Grupos de diseño**, no pieza por pieza, porque se construye en serie. Grupos sugeridos: columnas por nivel (esquina e intermedias), bastidor inferior y superior por nivel, vigas de transferencia, viguetas por nivel, cabios, montantes exteriores e interiores, dinteles por rango de luz, y arriostramientos. El usuario puede **separar un grupo** o **fijar una sección**.
- **Iteración**: analizar → verificar → asignar a cada grupo la sección más liviana que cumple → re-analizar, porque cambia la rigidez. Termina cuando no cambian las secciones (máximo 6 iteraciones). Si no converge, mostrar el estado y el motivo.
- Modo `verify`: no cambia secciones, solo informa.

---

## 8. Uniones y anclajes (`connections.js`)

El anclaje correcto **depende de las solicitaciones reales y de la posición de cada columna**. No es lo mismo una esquina a barlovento, con levantamiento máximo, que una columna intermedia. El motor diseña cada apoyo con su envolvente (máxima compresión, máxima tracción, corte y momento si la base es empotrada) y después **tipifica** (A1, A2…) para la obra.

### 8.1 Placa base

- **Aplastamiento del hormigón**: φPp = 0,65 · 0,85 · f'c · A1 · √(A2/A1), con √(A2/A1) ≤ 2.
- **Espesor de placa** por voladizo a flexión: t ≥ ℓ · √(2Pu / (0,9 · Fy · B · N)), con ℓ el voladizo crítico (método de la Guía de Diseño 1 del AISC). Para tracción, verificar también la flexión de la placa por la fuerza de los bulones.
- **Soldadura columna-placa**: filete, φRn = 0,75 · 0,60 · FEXX · 0,707 · w · L, con el espesor mínimo según el espesor de la placa.

### 8.2 Bulones de anclaje

- Tracción, corte e interacción en el acero del bulón.
- **Hormigón (CIRSOC 201-2005, Apéndice D / ACI 318 Cap. 17)**:
  - arrancamiento del cono: Nb = kc·√f'c·hef^1,5 (kc = 10 colado in situ, 7 post-instalado, unidades N-mm-MPa), afectado por ANc/ANco, que se reduce por **distancia al borde del dado**;
  - extracción por deslizamiento (pullout);
  - descascaramiento lateral;
  - corte con rotura de borde y desprendimiento del hormigón.
  - En dados chicos, **la distancia al borde manda**: el motor puede tener que **agrandar el dado o aumentar la profundidad de empotramiento** para que el anclaje funcione.
- **Elección del tipo de anclaje** según la solicitación:
  - compresión pura → bulón con gancho, mínimo constructivo;
  - tracción moderada → bulón con arandela o tuerca embebida;
  - tracción alta → barra roscada con placa de anclaje embebida, o anclaje químico con la resistencia del fabricante cargada como dato;
  - corte alto → llave de corte o tope soldado bajo la placa.
- Agregá al cómputo: placas con su espesor, bulones con diámetro × largo, tuercas, arandelas, tensores y grout de nivelación.

### 8.3 Unión entre niveles (módulo sobre módulo)

- Placas abulonadas columna-columna: tracción (levantamiento del nivel de arriba con 0,9D − 1,6W) y corte (corte de piso por viento). Bulones grado 8.8, con diámetro y cantidad calculados.
- Si hay transferencia sobre viga, se suman cartelas o rigidizadores donde la columna apoya sobre el bastidor, y se verifica el aplastamiento y el pandeo local de la pared del tubo bajo la carga concentrada.

### 8.4 Techo-muro y alero

- Levantamiento de cada cabio con la presión de componentes y revestimientos (mayor en esquinas, bordes y aleros) → **clip o fleje** por cabio con su capacidad, o soldadura verificada.
- Fijaciones de chapa: cantidad de tornillos por m² según la presión local, contra la resistencia al arrancamiento del tornillo cargada como dato. Esto reemplaza el "15 por m²" fijo del cómputo actual.

---

## 9. Estabilidad global (`stability.js`)

Para cada dirección de viento (y sismo):

- **Levantamiento**: suma de tracciones de los anclajes ≤ capacidad de anclajes **y** peso de la fundación vinculada × 0,9.
- **Vuelco**: momento estabilizante (0,9 D, incluida la fundación vinculada) ≥ momento volcador × factor de seguridad (1,5 por defecto, editable).
- **Deslizamiento**: μ · N ≥ corte basal × 1,5, o llaves de corte / empotramiento lateral.
- Si no cumple, el motor propone en este orden:
  1. dados o zapatas más pesados (contrapeso), con el volumen calculado;
  2. viga de fundación que una los dados, para movilizar más peso;
  3. pilotes trabajando a tracción;
  4. anclajes a tierra (como último recurso, con advertencia).

---

## 10. Fundaciones (`foundations.js`)

**Siempre** con las reacciones reales por columna, de todos los niveles, por combinación. Profundidad mínima = máx(profundidad de helada, profundidad requerida por anclaje y por suelo firme).

### 10.1 Dados y zapatas aisladas

- **Área por tensión admisible** (cargas de servicio): A ≥ (N + peso propio + suelo encima) / qadm. Con momento, tensión trapecial y **sin tracción** bajo la base: e ≤ B/6, o redistribución triangular verificada.
- **Peso para levantamiento**: W_dado + W_suelo encima (prisma vertical, conservador; cono con ángulo φ/2 opcional) ≥ T / 0,9.
- **Hormigón**: punzonado alrededor de la placa base, corte en una dirección, flexión con armadura mínima 0,0018·b·h y profundidad para el anclaje de los bulones.
- **Tipificación**: agrupar en hasta 3–4 tipos (D1, D2, D3) redondeando hacia arriba en pasos de 5 cm. El cómputo y el plano usan los tipos.

### 10.2 Viga de fundación con pilotes (pilotines)

- La viga se analiza como continua sobre pilotes con las cargas de columnas y muros. Hay que verificar la flexión, el corte y la armadura longitudinal y transversal (estribos).
- **Pilote a compresión**: Q = fs·π·D·L + qp·π·D²/4 con factores de seguridad. **A tracción**: Qt = 0,7·fs·π·D·L + peso del pilote. Estos son los que resuelven el levantamiento patagónico con menos hormigón.
- Separación y cantidad de pilotes **calculadas**, no fijas cada 2 m.

### 10.3 Platea

- Presión de contacto con la resultante y sus excentricidades (platea rígida). Si la relación de rigidez lo exige, modelo de Winkler con el módulo de balasto como dato.
- Espesor por punzonado bajo columnas, con engrosamientos (capiteles invertidos) si hace falta. Armadura superior e inferior en dos direcciones por flexión, viga de borde y anclajes químicos o embebidos según la sección 8.

### 10.4 Plano de fundaciones

- Vista en planta en el editor y en la memoria: ejes, tipos de dado o zapata, cotas, profundidad, armaduras resumidas y tabla de anclajes por columna.

---

## 11. Escaleras y huecos de entrepiso (`stairs.js`)

En cuanto hay dos niveles, la escalera es obligatoria y condiciona todo: el hueco corta viguetas, cambia el camino de cargas y define si la casa es habitable y segura. Tratala como un elemento de primera clase del modelo, no como un adorno.

### 11.1 Modelo de datos

```js
level.stairs = [{
  id, kind: "recta" | "L" | "U" | "compensada" | "caracol",
  origin: {x, y}, direction: 0 | 90 | 180 | 270,   // arranque en el nivel de abajo
  width: 0.90,                                      // ancho libre entre zócalos o pasamanos
  turn: "izquierda" | "derecha",                    // para L y U
  landingDepth: null,                               // null = igual al ancho
  structure: "zancas_laterales" | "zanca_central" | "autoportante_chapa" | "hormigon",
  treadMaterial: "chapa_plegada" | "madera" | "hormigon" | "fenolico",
  railing: { left: "baranda"|"pasamanos"|"muro", right: ... },
  ruleSet: "municipal" | "accesible"
}]
```

- La escalera pertenece al nivel de **abajo** y llega al `floorTop` del nivel de arriba. El desnivel a salvar es **H = floorTop(n+1) − floorTop(n)**; incluye el bastidor y el entrepiso, no solo la altura del muro.
- Herramienta **"Escalera"** en la barra de la planta: se arrastra un rectángulo o se toca el arranque y la dirección. El motor calcula la cantidad de escalones y el largo, y avisa si no entra.
- En el nivel de arriba se dibuja automáticamente el **hueco** y la baranda perimetral del lado abierto.

### 11.2 Geometría y reglas (con dos juegos de reglas por jurisdicción)

Para salvar H, el motor calcula la cantidad de alzadas n = ⌈H / alzada_máx⌉ y la alzada real a = H / n (todas iguales). La pedada p se elige para cumplir Blondel, y se completan el largo de cada tramo, los descansos y la altura de paso. Si no hay ninguna combinación que cumpla en el espacio dibujado, lo dice y propone el largo mínimo o el cambio de tipo (recta → L → U).

Las reglas viven en `data/codes/` y se eligen por proyecto. **Para vivienda unifamiliar manda el Código de Edificación del municipio** (Puerto Madryn u otro); para edificios de uso público o si el usuario lo pide, **las de accesibilidad**.

| Regla | Municipal típica (vivienda) — **confirmar con el código vigente** | Accesible — Decreto 914/97 (Ley 24.314), Art. 21 A.1.4.2.1 |
| --- | --- | --- |
| Alzada a | ≤ 0,18 m | 0,14–0,16 m |
| Pedada p (sin nariz) | ≥ 0,26 m | 0,28–0,30 m |
| Relación de Blondel 2a + p | 0,60–0,66 m | 0,60–0,63 m |
| Alzadas corridas por tramo | máx. según código (valor editable) | máx. 12 entre descansos |
| Ancho libre | mín. según código para vivienda (editable; típico 0,80–1,00 m) | mín. 1,20 m entre zócalos |
| Escalones compensados / caracol | permitidos con pedada mínima medida a 0,30–0,50 m del limón interior (editable) | **no permitidos** (escalones iguales) |
| Nariz | saliente ≤ 0,035 m | saliente ≤ 0,035 m, unión a ≥ 60° |
| Descanso | profundidad ≥ ancho de la escalera | profundidad ≥ ancho; giros con círculo libre según decreto |
| Altura de paso libre | ≥ 2,00 m medida en vertical desde la línea de narices (editable) | idem, más señalización bajo escalera |
| Pasamanos | al menos uno en lado abierto, a 0,85–0,95 m | ambos lados, 0,90 ± 0,05 m, Ø 0,04–0,05 m, separado ≥ 0,04 m, prolongación 0,15–0,40 m |
| Baranda en lado abierto | altura ≥ 0,90 m; huecos que no dejen pasar una esfera de 0,10 m (editable) | idem, más zócalo de 0,10 m en lado libre |
| Banda táctil | — | 0,60 m al inicio y fin de cada tramo |

Verificaciones geométricas que el motor tiene que hacer sí o sí:

- **Altura de paso**: barrer la línea de narices y comprobar que en toda la proyección del hueco la distancia vertical al borde inferior de la estructura del nivel de arriba (vigueta, viga de borde del hueco, cielorraso) sea ≥ el mínimo. Si no cumple, el hueco se alarga, no la escalera.
- **Llegada**: espacio libre al pie y en la llegada de al menos el ancho de la escalera, sin barrido de puertas encima. Usá `doorLeaf()`, que ya existe, para detectar choques con puertas.
- **Interferencias**: la escalera no puede cortar muros, ventanas (antepechos), columnas ni arriostramientos. Si una cruz de San Andrés queda en el muro donde apoya la escalera, el motor la mueve a otro paño.
- **Uniformidad**: tolerancia de ±5 mm entre alzadas en el despiece.

### 11.3 Estructura de la escalera

- **Cargas**: peso propio por materiales y sobrecarga de escaleras de CIRSOC 101-2005 (Tabla 4.1, fila de escaleras para el uso del edificio). Barandas y pasamanos con las cargas horizontales del CIRSOC 101 (carga lineal y concentrada en la parte superior; leer los valores del reglamento).
- **Zancas**: vigas inclinadas apoyadas abajo (en la platea o en el bastidor y entrepiso del nivel inferior) y arriba (en la viga de borde del hueco). Tubo rectangular, UPN o planchuela, según la luz y la carga. Se verifican a flexión y corte con la luz horizontal proyectada y carga por m² de planta, y a flecha L/300.
- **Escalones**: chapa plegada (espesor por flexión entre zancas), madera (CIRSOC 601) o fenólico. Fijación con ángulos soldados o abulonados.
- **Descansos**: losa liviana sobre bastidor de tubos, apoyada en muro o en columnas propias. Si apoya en un muro, ese muro recibe la reacción (camino de cargas).
- **Vibración**: frecuencia ≥ 8 Hz (escaleras metálicas livianas vibran). Si no cumple, aumentar la sección de la zanca.
- **Autoportante o en voladizo desde muro** (escalones empotrados): solo si el muro tiene un montante o columna capaz de tomar el momento. Verificar ese montante a flexión.

### 11.4 Hueco en el entrepiso

- El generador **corta las viguetas** que cruzan el hueco y crea:
  - **brochales**: vigas que reciben las viguetas cortadas;
  - **vigas de borde del hueco** (trimmers dobles), que toman los brochales y la reacción superior de la escalera.
- Todo entra al pórtico 3D con sus cargas y se dimensiona como el resto.
- Baranda perimetral en los lados abiertos del hueco, con la misma regla de altura y huecos.
- El cielorraso, la placa de entrepiso y la aislación descuentan el área del hueco en el cómputo.

### 11.5 Cómputo de la escalera

Zancas, escalones, ángulos y fijaciones, pasamanos (con prolongaciones), barandas (parantes, travesaños, barrotes o malla), placas de anclaje de la zanca y terminación (pintura, nariz antideslizante). También van a la lista de cortes, con los cortes a inglete de las zancas indicados.

### 11.6 Representación

- **Planta**: escalera con el número de escalones, flecha de subida ("SUBE"), línea de corte a 1,20 m sobre el piso y línea punteada de la parte superior. En el nivel de arriba, el hueco con baranda.
- **3D**: escalones, zancas y barandas reales (capa "Escaleras").
- **Memoria**: tabla de verificación geométrica (a, p, 2a + p, n, ancho, altura de paso), con cumple / no cumple y la regla citada.

## 12. Reglas de edificación y habitabilidad (`building-code.js`)

Además de resistir, la casa tiene que poder habilitarse. Un verificador por jurisdicción, con reglas en datos (`data/codes/`) y valores editables, que avise en la planta y en la memoria. **Todas estas reglas dependen del código municipal**: cargá valores típicos marcados "a confirmar" y dejá que el usuario los ajuste o cargue los de su municipio.

- **Locales**: el usuario nombra cada ambiente (dormitorio, estar, cocina, baño, lavadero); el motor detecta los recintos cerrados entre muros y tabiques. Por tipo de local se verifica:
  - superficie mínima;
  - lado mínimo;
  - **altura mínima** de local (el muro de 2,60 m da menos de altura libre si hay cielorraso suspendido: calcular la libre real);
  - **iluminación** (área vidriada ≥ fracción de la superficie del local);
  - **ventilación** (área practicable ≥ fracción de la iluminación);
  - en baños sin ventana, conducto de ventilación.
  - Usar las ventanas que ya están en el modelo.
- **Puertas**: ancho libre mínimo por local (0,80 m de paso libre en el criterio accesible del Decreto 914/97, A.1.3.1) y altura de paso.
- **Aislación térmica** (IRAM 11601 para el cálculo, IRAM 11603 para la zona bioambiental, IRAM 11605 para los valores máximos de transmitancia K por nivel A/B/C y temperatura exterior de diseño): calcular K de cada paquete (muro, techo, piso, entrepiso sobre exterior) a partir de las capas reales del modelo, incluidos los **puentes térmicos de los perfiles de acero**, que en steel y tubo son importantes. Comparar con el máximo de la zona.
- **Condensación** (IRAM 11625): verificación superficial e intersticial de cada paquete con barrera de vapor; indicar en qué cara va. En la costa patagónica, con viento y frío, esto define si la casa se moja por dentro.
- **Seguridad**: barandas en balcones y terrazas (altura y huecos, igual que en escaleras), y altura de antepechos de ventanas en niveles altos.

Todo lo que el verificador no cumpla se lista con el artículo o la regla, la ubicación en la planta y una sugerencia concreta, por ejemplo: "Agrandá la ventana del dormitorio 2 a 1,20 × 1,10 m".

## 13. Integración con lo existente

- **Generador**: acepta `sections` por grupo de diseño. Genera las **piezas nuevas** que surjan del cálculo: arriostramientos (con tensores), cartelas, placas base, placas de unión, vigas de transferencia, vigas reticuladas y columnas agregadas por el optimizador. Todas pasan al 3D, al cómputo y a la lista de cortes.
- **Fundación**: `solids[]` refleja los tamaños calculados por columna; ya no dados iguales.
- **Cómputo (`bom.js`)**: secciones dimensionadas, anclajes y bulones reales, tornillos de chapa por presión de viento, y hormigón y acero de fundaciones calculados. Mantené el formato de filas actual y la optimización de cortes.
- **3D (`viewer3d.js`)**:
  - modo **"Utilización"**, que colorea cada pieza por η en escala de grises a negro, con rayado o contorno para η > 1. Respetá la paleta blanco y negro; si hace falta un color de alerta, que sea uno solo y sobrio;
  - **deformada** amplificada para la combinación elegida;
  - **flechas de reacciones** en la base;
  - **camino de cargas**, con el grosor proporcional a N.
- **Planta**: columnas con su tipo, arriostramientos marcados en los muros y candado para fijar columnas.
- **Panel "Ingeniería"** nuevo en la interfaz:
  - ubicación (preset o manual), exposición, uso por nivel, suelo, acero, hormigón, límites y modo `auto`/`verify`;
  - el estado global con chips: "Cumple los chequeos implementados", "No cumple (n)" y "Supuestos (n)";
  - una lista de problemas clickeable, que selecciona la pieza en el 3D y en la planta.

---

## 14. Memoria de cálculo (`report.js`)

HTML imprimible (A4, con CSS `@media print`, sin dependencias nuevas). Contenido:

1. Carátula: proyecto, ubicación, fecha, versión del motor, autor "ActivaModular · jesus.olguin" y leyenda de alcance y responsabilidad profesional.
2. Datos de entrada y **supuestos** resaltados.
3. Reglamentos y versiones aplicadas.
4. Análisis de cargas: tablas de peso propio por paquete, sobrecargas, nieve y viento (qz, coeficientes y presiones por zona), sismo.
5. Combinaciones.
6. Modelo estructural: esquema 3D, apoyos, uniones y sistema lateral.
7. Resultados: reacciones por columna y por combinación, desplazamientos y verificación de desplazamiento entre niveles.
8. Verificación de barras: tabla por grupo de diseño con sección, η máximo, combinación y artículo del reglamento que gobierna. Detalle completo (fórmulas con números) de la barra más exigida de cada grupo.
9. Uniones y anclajes: tabla por tipo con detalle de cálculo.
10. Estabilidad global.
11. Fundaciones: tabla y plano.
12. Advertencias y lo que **no** se verificó.

---

## 15. Verificación y tests

Tests en `cad/engineering/*.test.js` con `node --test`, cada uno comparando contra solución cerrada o ejemplo publicado. Tolerancia 0,5 % salvo indicación.

| Caso | Resultado esperado |
| --- | --- |
| Viga simple L = 4 m, w = 2 kN/m, tubo 100×50×3,2 (Ix = 118,7 cm⁴), E = 200 GPa | M = 4,00 kNm; flecha = 5wL⁴/384EI = 28,08 mm |
| Voladizo L = 1,20 m, P = 5 kN en la punta, misma sección | M = 6,00 kNm; flecha = PL³/3EI = 12,13 mm |
| Viga continua de 2 tramos iguales, w uniforme | Reacciones 0,375wL / 1,25wL / 0,375wL; M apoyo = −wL²/8 |
| Columna 100×100×3,2, L = 2,60 m, articulada, F-24 | λc = 0,717; Fcr ≈ 189 MPa; φPn ≈ 200 kN; Pcr ≈ 566 kN |
| Pórtico plano empotrado de un vano con carga lateral | Comparar con solución por rigidez a mano (documentada en el test) |
| Solver 3D: misma estructura rotada 90° en planta | Mismos esfuerzos y desplazamientos rotados |
| Equilibrio, cualquier modelo y combinación | Σ reacciones = Σ cargas (error relativo < 1e-6) |
| Barras de solo tracción en cruz | El tensor comprimido queda inactivo; la estructura queda estable |
| Viento: V = 58 m/s, exposición C, z ≤ 4,5 m, Kd = 0,85, I = 1 | qz = 1490 Pa ± 1 % |
| Levantamiento del módulo 3 × 6 por defecto con V = 58 m/s | Tracción neta en anclajes > 0, y el motor agranda la fundación o propone pilotes hasta cumplir |
| Nivel superior en voladizo de 1,0 m | Aparece tracción en el apoyo trasero y se diseña su anclaje |
| Columna de arriba a mitad de un bastidor | El bastidor pasa a viga de transferencia; si no cumple, se redimensiona o cambia de tipo |
| Placa base y bulones | Casos de la Guía de Diseño 1 del AISC y de los ejemplos del CIRSOC 201 para anclajes (citar el ejemplo en el test) |
| Dimensionado | Determinista: dos corridas iguales dan secciones idénticas |
| Escalera del módulo por defecto: H = 2,718 m (2,60 de muro + 0,10 de bastidor + 0,018 de placa), alzada máx. 0,18 m | n = 16 alzadas, a = 0,1699 m; con p = 0,28 m, 2a + p = 0,620 m (cumple 0,60–0,66) |
| Misma H con reglas accesibles (a 0,14–0,16 m, p 0,28–0,30 m, 2a + p 0,60–0,63 m, máx. 12 por tramo) | n = 17 alzadas, a = 0,1599 m; p = 0,29 m → 2a + p = 0,610 m (con 0,28 m daría 0,5998: no cumple, y el motor tiene que detectarlo); 2 tramos (9 + 8) con descanso |
| Altura de paso | Hueco corto que deja < 2,00 m: el motor alarga el hueco, no la escalera |
| Hueco en entrepiso | Viguetas cortadas + brochales + vigas de borde; equilibrio y verificación de las vigas de borde |

Además:

- Mantener verdes los 19 tests actuales.
- Agregar un test de regresión con el proyecto por defecto que fije el resultado completo del motor (snapshot JSON), para detectar cambios no intencionales.

---

## 16. Rendimiento y robustez

- Proyecto típico (2 niveles, 80–150 m², unas 300 barras analíticas): análisis completo con dimensionado en **< 1,5 s** en un celular de gama media, dentro del Worker.
- Proyecto chico (1 módulo): **< 300 ms**.
- Sin bloqueos de interfaz.
- Cancelar el cálculo en curso si el usuario sigue editando.
- Si el contorno de un nivel no cierra, el motor calcula lo que puede y lo informa; nunca rompe la página.
- Sin dependencias nuevas salvo que se vendoricen en `vendor/` con licencia. Preferí implementar el solver propio.

---

## 17. Plan por fases (entregá por PR, una fase por vez)

Cada fase deja la app publicable y con tests verdes.

| Fase | Contenido | Criterio de aceptación |
| --- | --- | --- |
| **0 · Base** | `units.js`, `data/materials.js`, claves estables de piezas, peso propio desde el modelo, panel "Ingeniería" con ubicación, suelo y materiales | Peso propio total del módulo por defecto mostrado y reproducible a mano |
| **1 · Cargas** | L, Lr, S, W (CIRSOC 102), E (INPRES-CIRSOC 103) y combinaciones | Test de qz; presiones por zona visibles en el 3D sobre las superficies |
| **2 · Análisis** | Modelo analítico, `frame3d.js`, cargas tributarias, Worker | Benchmarks de la sección 15 y equilibrio en todas las combinaciones |
| **3 · Barras** | Verificaciones, grupos, dimensionado iterativo, tipo de viga, arriostramientos automáticos | Módulo por defecto dimensionado, con modo "Utilización" en el 3D |
| **4 · Uniones y estabilidad** | Placas base, bulones con hormigón, uniones entre niveles, techo-muro, vuelco, levantamiento y deslizamiento | El caso patagónico de la sección 0 queda resuelto y explicado en la memoria |
| **5 · Fundaciones** | Dados y zapatas por columna, viga con pilotes (compresión y tracción), platea, tipificación y plano | Las fundaciones cambian al agregar un nivel o mover columnas; cómputo actualizado |
| **6 · Niveles complejos** | Transferencias, voladizos, niveles desplazados; opción de columnas al suelo o reticulado | Los tres tests de niveles de la sección 15 |
| **7 · Optimización de columnas** | `column-layout.js` y visualización del camino de cargas | Menor costo que la regla actual en al menos 3 casos de prueba documentados, sin romper verificaciones |
| **8 · Memoria** | `report.js` completo e impresión | Memoria del caso por defecto revisable por un profesional |
| **9 · Escaleras** | `stairs.js`, herramienta de planta, hueco con brochales y vigas de borde, zancas, barandas, cómputo, verificación con los dos juegos de reglas | Escalera recta y en L entre dos niveles de 2,60 m: n, a y p correctos, Blondel, altura de paso verificada, hueco dimensionado y cómputo completo |
| **10 · Habitabilidad** | `building-code.js`, locales, iluminación y ventilación, puertas, transmitancia térmica y condensación | Proyecto por defecto con informe de habitabilidad y K de cada paquete reproducible a mano |
| **11 · Otros sistemas** | Steel frame (CIRSOC 303, PGC/PGU con ancho efectivo), wood frame (CIRSOC 601) y container (esquineros ISO, cargas de apilado) sobre el mismo motor | Cada sistema con sus benchmarks |

---

## 18. Fuera de alcance (por ahora) y límites a declarar

- Instalaciones (sanitarias, eléctricas, gas), salvo como cargas.
- Análisis dinámico modal o espectral (el método estático equivalente alcanza para esta escala; dejá el hook).
- Fatiga, incendio y corrosión. Para corrosión, dejá como dato el espesor de sacrificio o la protección, y avisá en zona costera.
- Ascensores y plataformas elevadoras (dejar el hueco y las cargas como dato si el usuario los ubica).

---

## 19. Definición de terminado (por PR)

- Código en `cad/engineering/` con JSDoc en cada función pública (unidades en el nombre o en el doc: `qz_Pa`, `L_m`).
- Tests nuevos verdes, más los existentes.
- `README.md` actualizado: sección "Cómo calcula", supuestos y reglamentos.
- `sw.js` con los archivos nuevos en la lista offline y la versión de caché incrementada.
- Probado en escritorio y en celular (390 px de ancho), sin desborde horizontal.
- Sin errores en consola.
- Mensaje de commit en español, explicando el **por qué** de las decisiones de ingeniería.
- En la descripción del PR: qué reglamento y artículo se implementó, qué supuestos quedan y cómo se verificó (con los números).

---

### Referencias de partida

- CIRSOC 101-2005 (cargas permanentes y sobrecargas), CIRSOC 102-2005 y su Guía de aplicación (viento; proyecto CIRSOC 102-24 en discusión pública), CIRSOC 104-2005 (nieve y hielo), INPRES-CIRSOC 103 (sismo), CIRSOC 301-2005 (acero), CIRSOC 302-2005 (tubos), CIRSOC 303 (conformados en frío), CIRSOC 201-2005 (hormigón, Apéndice D anclajes), CIRSOC 601 (madera). Publicados por INTI-CIRSOC.
- AISC Design Guide 1 (placas base) y AISC 360 como respaldo de las fórmulas de CIRSOC 301/302.
- Ley 24.314 y Decreto 914/97 (accesibilidad; escaleras Art. 21 A.1.4.2.1, rampas A.1.4.2.2, puertas A.1.3).
- Código de Edificación del municipio donde se construye (Puerto Madryn u otro): escaleras, locales, iluminación, ventilación, barandas.
- IRAM 11601, 11603, 11605 y 11625 (aislación térmica, zonas bioambientales, transmitancia máxima, condensación).
- ASTM A500 para la fluencia de tubos estructurales cuando el proveedor lo certifique.
