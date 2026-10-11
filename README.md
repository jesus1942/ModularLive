# ModularLive

PWA estática para diseñar y computar materiales de espacios modulares: viviendas, oficinas, baños y configuraciones personalizadas.

Tiene dos herramientas:

- **Calculadora rápida** (`index.html`): un módulo rectangular por parámetros, con presets y cotización.
- **Diseñador en planta y 3D** (`cad.html`): dibujás la planta y la herramienta genera cada pieza de la estructura, la fundación y los cerramientos, con vista 3D, cómputo de materiales y lista de cortes.

## Diseñador en planta y 3D

### Cómo se usa

1. Dibujá el contorno con **Rectángulo** o con **Muro exterior** (tocás punto a punto; escribí un largo y `Enter` para medidas exactas; tocar el punto inicial cierra el contorno).
2. Agregá **tabiques** interiores: se enganchan a los muros existentes.
3. Ubicá **puertas y ventanas** tocando sobre un muro. Con **Seleccionar** se arrastran a lo largo del muro y se editan sus medidas en el panel derecho. En las puertas se elige de qué lado va la bisagra y hacia qué lado abre (botones del panel, o doble clic / doble toque sobre la puerta para recorrer las cuatro opciones).
4. Para **apilar niveles**, tocá `+` en la barra de niveles: se agrega un nivel encima con el contorno del de abajo, que se puede editar libremente. El nivel inferior se ve punteado como referencia y los extremos se enganchan a él. Cada nivel tiene su propia altura.
5. Elegí fundación, techo, revestimientos y separaciones en el panel izquierdo.
6. Revisá el 3D por capas (y por niveles), la tabla de materiales (con precios propios, compartidos con la calculadora) y la lista de cortes. Exportá CSV, guardá el diseño como `.json` o imprimilo.

Atajos: `V` seleccionar, `R` rectángulo, `E` muro, `I` tabique, `P` puerta, `N` ventana, `Ctrl+Z` / `Ctrl+Y`, `Esc` termina o cancela, `Supr` borra lo seleccionado. `Shift` libera el modo ortogonal.

### Cómo calcula

El diseño se guarda como un modelo de obra (muros en planta con sus aberturas, fundación, techo y parámetros). A partir de ese modelo, `cad/generator.js` produce **cada pieza real** con su posición 3D y su largo de corte. El visor 3D y el cómputo usan exactamente esas piezas, así que lo que se ve es lo que se computa.

- **Estructura (tubo estructural)**: columnas en esquinas y cada ≤ 3 m (corridas fuera de las aberturas), bastidor inferior y superior, montantes, jambas, dinteles, antepechos, marcos en perfil C, viguetas de piso, cabios, cumbrera, cenefas y relleno de hastiales.
- **Fundación**: dados bajo columnas, viga de fundación con pilotines, o platea con viga de borde. Calcula hormigón, excavación, acero por diámetro, malla, film, encofrado y anclajes.
- **Niveles**: cada nivel es un módulo completo que apoya sobre el bastidor superior del de abajo, con viguetas de entrepiso, placas de unión abulonadas entre niveles y columnas alineadas (si una esquina de arriba cae sobre un muro de abajo, abajo se agrega una columna que baja hasta la fundación). Avisa los voladizos y las columnas sin apoyo directo.
- **Techo**: plano, una agua o dos aguas, con alero, sobre el nivel superior. La superficie se calcula en pendiente. Las partes de niveles inferiores que quedan descubiertas llevan cubierta plana con sus cabios.
- **Puertas**: se computan por medida y mano (vista desde el lado hacia donde abre).
- **Cerramientos**: placas, aislación, barrera de viento y revestimientos por superficie neta (descontando aberturas e incluyendo hastiales).
- **Lista de cortes**: optimiza los cortes sobre la barra comercial (6 m por defecto, con espesor de corte) y marca los empalmes de piezas más largas que la barra.

### Ingeniería · fase 0 (base)

ActivaModular es un proyecto de **Jesús Olguín · jesus.olguin**. La especificación y dirección del proyecto son suyas; la implementación asistida de esta fase se identifica como **Astra el Evangelista**. Es asistencia de desarrollo, no una firma de responsabilidad profesional.

La pestaña **Ingeniería** pesa el material **instalado** del mismo modelo que se dibuja. Las barras comerciales sobrantes y la merma de compra no son cargas de la vivienda. Por eso el resumen de compra y el peso propio pueden tener valores distintos.

- Cada barra conserva `id` para compatibilidad y agrega `key`, basada en nivel, rol, muro, función y posición. Editar otros muros o reordenar aberturas no desplaza sus claves. Una modificación de su propia posición puede cambiar su identidad. Las claves llegan a la lista de cortes.
- Cada superficie identifica sus capas y áreas netas. Un tabique tiene dos caras de revestimiento y una sola aislación. En cubierta, placas y chapa siguen la pendiente con alero; la aislación usa la planta cubierta, igual que el cómputo actual.
- `cad/engineering/loads.js` registra cada contribución: entrada → fórmula → masa en kg → peso en N. La interfaz muestra kN y también kgf/tf, con gravedad normal `g₀ = 9,80665 m/s²`.
- La fundación se pesa desde sus sólidos geométricos y se informa **separada**. El peso unitario equivalente del hormigón armado ya representa el conjunto; no se vuelve a sumar la armadura. Esto no comprueba que los dados estén vinculados ni que puedan retener levantamiento.
- Podés editar masas y densidades de los materiales usados. Un dato permanece como supuesto hasta que cargues su fuente y confirmación. Cambiar resistencia `Fy`, `E` o `f'c` no cambia la masa; cambiar densidad sí.
- Ubicación, escenario climático, suelo, acero y hormigón se guardan en `project.engineering`, incluido al abrir diseños anteriores, deshacer/rehacer y exportar JSON. Los presets locales no inventan valores del mapa: sus datos están **a confirmar**. El escenario de 58 m/s proviene de la referencia de Telsen del encargo y **no es una velocidad confirmada para Puerto Madryn**.
- El detalle JSON incluye todas las entradas, contribuciones y supuestos. La impresión incluye un extracto del peso modelado, alcance pendiente y supuestos. La memoria estructural completa corresponde a la fase 8.

**Ejemplo reproducible, módulo por defecto 3 × 6 m:**

| Parte | Cantidad base | Peso modelado |
| --- | --- | --- |
| Barras instaladas | 130 piezas, con sus cortes reales | 17,893 kN |
| Capas y hojas de aberturas | áreas netas del generador | 18,662 kN |
| Vivienda (sin fundación) | suma de las dos filas anteriores | **36,555 kN (3,727 tf)** |
| Fundación | 6 × 0,40 × 0,40 × 0,80 = 0,768 m³, a 24 kN/m³ **supuestos** | **18,432 kN (1,880 tf)** |
| Total modelado | vivienda + fundación | **54,987 kN (5,607 tf)** |

La suma manual de largos, áreas y pesos unitarios está documentada en `cad/engineering/base.test.js`. El resultado completo, determinista y sin fechas variables está fijado en `cad/engineering/fixtures/default-phase-0.json`.

### Fuentes, supuestos y reglamentos

El método de peso por superficies/volúmenes sigue **CIRSOC 101-25, 3.1.1 y 3.1.2**, con el antecedente CIRSOC 101-2005, 3.1. Los valores de referencia y sus fuentes viven en `cad/engineering/data/materials.js`; no certifican los productos de una obra.

- [CIRSOC 101-25, INTI](https://www.inti.gob.ar/assets/uploads/files/cirsoc/02-Reglamento-tramite-de-aprobacion/Reglamento-CIRSOC-101-25.pdf): definición de carga permanente y uso de pesos reales. Los pesos estabilizantes requieren especial cuidado para no sobreestimarlos.
- [Resolución SOP 11/2026, artículos 1 y 2](https://www.inti.gob.ar/assets/uploads/files/cirsoc/resoluciones-legales/03/RESOL-2026-11-APN-SOP-MEC_CIRSOC.pdf): puso en vigencia nacional CIRSOC 101-25, 102-25, 200-24 y 201-25 e invitó a las jurisdicciones a adherir. Su aplicación provincial y municipal debe confirmarse para cada obra. La mención del proyecto de viento 102-24 en el encargo no se trata como estado vigente.
- [Knauf ST 12,5](https://knauf.com/es-AR/p/producto/placa-de-yeso-st-12.5-10003_2001): referencia de 8,15 kg/m². Sigue siendo supuesto hasta confirmar marca y placa instalada.
- [EGGER OSB 3](https://www.egger.com/en/building-products/range/products/osb3): densidad mínima declarada de 600 kg/m³; un mínimo no fija el peso real del tablero. Se adoptan pesos nominales editables, identificados como supuestos.
- Las chapas, panel sándwich, aislaciones, membranas y hojas de aberturas usan referencias **supuestas** del encargo o hipótesis explícitas; requieren fichas de producto. Los tubos usan la fórmula nominal actual, sin radios ni tolerancias; el catálogo ampliado con datos de fabricante corresponde a la fase 3.
- Los 24 kN/m³ del hormigón se conservan como **supuesto del encargo**, no como valor reglamentario de hormigón armado: [CIRSOC 101-2005, Tabla 3.1](https://www.inti.gob.ar/assets/uploads/files/cirsoc/vigencia-2013/area100/Reglamento-cirsoc101-completo.pdf) indica 25 kN/m³ para armado. Se puede cargar el peso unitario especificado para el caso real.
- Suelo inicial `qadm = 100 kPa` es un supuesto hasta contar con estudio de suelos. Resistencias de acero y hormigón también quedan a confirmar. Ninguna de estas entradas genera, por ahora, un diseño de fundaciones o una verificación de barras.

**Alcance pendiente:** este peso es parcial, no la carga D completa para construir. Faltan instalaciones, equipamiento fijo, acabados adicionales y herrajes que no son piezas del modelo. El cielorraso bajo cubierta tampoco está en el modelo ni en el cómputo actual y se declara pendiente; el cielorraso de entrepiso sí se pesa. No se agregan cargas ficticias para ocultar esas faltas.

Todavía no están implementados viento, nieve, sismo, sobrecargas, combinaciones, bajada de cargas, análisis del pórtico, resistencia, deformaciones, anclajes, estabilidad ni dimensionado de fundaciones. El estado permanece **«Revisar»**. El modo automático se reserva para la fase 3 y no cambia secciones en la fase 0. La siguiente entrega es **fase 1 · Cargas**, según `docs/PROMPT-ASTRA-motor-estructural.md`.

### Estructura del código

| Archivo | Qué hace |
| --- | --- |
| `cad/model.js` | Modelo de obra, proyecto por defecto, detección del contorno exterior |
| `cad/catalog.js` | Perfiles, placas, sistemas constructivos, fundaciones y techos |
| `cad/geometry.js` | Utilidades geométricas en planta |
| `cad/generator.js` | Generador de piezas, sólidos y superficies |
| `cad/bom.js` | Cómputo de materiales y optimización de cortes |
| `cad/plan-editor.js` | Editor de planta en SVG |
| `cad/viewer3d.js` | Visor 3D por capas (three.js incluido en `vendor/`, funciona sin conexión) |
| `cad/app.js` | Interfaz del diseñador |
| `cad/engineering/units.js` | Unidades SI y presentación en unidades de obra |
| `cad/engineering/data/` | Materiales con fuentes y localidades con datos pendientes |
| `cad/engineering/settings.js` | Entradas de ingeniería, migración y diagnóstico de datos inválidos |
| `cad/engineering/keys.js` | Identidad estable de cada pieza |
| `cad/engineering/loads.js`, `engine.js` | Peso propio trazable, supuestos y alcance del motor base |
| `cad/engineering/panel.js` | Panel, pesos editables y extracto imprimible |

Para sumar otro sistema constructivo (steel frame, wood frame, container) se agrega su definición en `SYSTEMS` de `cad/catalog.js` con los perfiles de cada rol, y las reglas propias en el generador.

## Uso local

```bash
npm test
npm start
```

Luego abrir `http://localhost:4173` (calculadora) o `http://localhost:4173/cad.html` (diseñador).

`npm test` corre 37 pruebas: las 19 originales y 18 de ingeniería base. GitHub Actions las corre en cada PR y agrega una prueba de navegador con Playwright en el entorno de CI (no agrega dependencias a la PWA): edición/guardado/deshacer, 3D, escritorio, celular de 390 px y carga del cálculo sin conexión. Conserva capturas y resultados como artefactos del workflow. Las tipografías externas se reemplazan por la fuente de sistema solo durante esa prueba.

## Alcance

Las cantidades son un cómputo y predimensionado para compra. Las secciones y separaciones no se verifican por cálculo estructural: antes de construir, los resultados deben validarse con cargas, normativa local, instalaciones y detalles de fabricación.
