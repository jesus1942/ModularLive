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
5. Para subir de nivel, en la planta baja tocá **Escalera** (`S`): un toque donde arranca y otro hacia donde sube. Se calcula sola: cantidad de alzadas, alzada, pedada y regla de Blondel, tramos y descansos (recta, en L o en U), con reglas municipales típicas (a confirmar con el código local) o de accesibilidad (Decreto 914/97). Arrastrala para moverla: si queda cerca de un muro se pega a su cara. En el nivel de arriba aparece el hueco.
6. Elegí fundación, techo, revestimientos y separaciones en el panel izquierdo.
7. Revisá el 3D por capas (y por niveles), la tabla de materiales (con precios propios, compartidos con la calculadora) y la lista de cortes. Exportá CSV, guardá el diseño como `.json` o imprimilo.

Atajos: `V` seleccionar, `R` rectángulo, `E` muro, `I` tabique, `P` puerta, `N` ventana, `Ctrl+Z` / `Ctrl+Y`, `Esc` termina o cancela, `Supr` borra lo seleccionado. `Shift` libera el modo ortogonal.

### Cómo calcula

El diseño se guarda como un modelo de obra (muros en planta con sus aberturas, fundación, techo y parámetros). A partir de ese modelo, `cad/generator.js` produce **cada pieza real** con su posición 3D y su largo de corte. El visor 3D y el cómputo usan exactamente esas piezas, así que lo que se ve es lo que se computa.

- **Estructura (tubo estructural)**: columnas en esquinas y cada ≤ 3 m (corridas fuera de las aberturas), bastidor inferior y superior, montantes, jambas, dinteles, antepechos, marcos en perfil C, viguetas de piso, cabios, cumbrera, cenefas y relleno de hastiales.
- **Fundación**: dados bajo columnas, viga de fundación con pilotines, o platea con viga de borde. Calcula hormigón, excavación, acero por diámetro, malla, film, encofrado y anclajes.
- **Niveles**: cada nivel es un módulo completo que apoya sobre el bastidor superior del de abajo, con viguetas de entrepiso, placas de unión abulonadas entre niveles y columnas alineadas (si una esquina de arriba cae sobre un muro de abajo, abajo se agrega una columna que baja hasta la fundación). Avisa los voladizos y las columnas sin apoyo directo.
- **Techo**: plano, una agua o dos aguas, con alero, sobre el nivel superior. La superficie se calcula en pendiente.
- **Partes descubiertas** (`cad/exposed.js`, `cad/outdoor-build.js`): cuando el nivel de arriba es más chico, está girado o corrido, lo que queda al aire del nivel de abajo se cubre con **techo a un agua** (pendiente y alero editables) o con **terraza transitable**. El agua siempre corre hacia afuera, nunca contra el nivel de arriba; si la parte rodea al nivel de arriba se resuelve en paños.
  - Techo: cabios en pendiente, viga de apoyo contra el muro de arriba, cenefas, babeta, y los muros de abajo suben hasta el techo (relleno de hastial) para **cerrar el entretecho**. Avisa si el techo tapa una ventana de arriba o si una puerta da al techo.
  - Terraza: deck sobre membrana con 1,5 % hacia afuera, 2 cm bajo el piso interior, baranda de 1,00 m en los bordes libres, goterón, embudos y aviso si no hay puerta para salir.
  - En la planta se ve rayada con una flecha de desagüe; tocándola se elige qué lleva.
- **Balcones**: en un muro exterior, **+ Balcón**. Van en voladizo (vigas soldadas al bastidor con cartelas, recomendado hasta 1,20 m) o con columnas al terreno con su dado. Tienen piso de deck sobre membrana, baranda en los tres bordes libres y avisos si falta la puerta o si quedan sobre otro nivel. Se arrastran a lo largo del muro.
- **Volados**: si un nivel sobresale del de abajo, su piso se cierra por debajo (OSB, revestimiento y aislación de piso).
- **Puertas**: se computan por medida y mano (vista desde el lado hacia donde abre).
- **Escaleras** (`cad/stairs.js`, `cad/stair-build.js`, reglas en `cad/data/stair-rules.js`): todas las alzadas iguales para el desnivel real entre pisos terminados; el hueco del entrepiso se abre donde la pisada queda a menos de la altura de paso (2,00 m) de la cara inferior del entrepiso. El generador corta las viguetas, agrega brochales y vigas de borde, descuenta placa, aislación y cielorraso, y pone baranda en los bordes libres del hueco. La escalera lleva zancas, escalones, descansos con bastidor y apoyos, barandas en los lados libres y pasamanos amurado donde corresponde. Avisa si corta un muro, si una puerta la barre, si la llegada queda bloqueada o si no cumple alguna regla.
- **Cerramientos**: placas, aislación, barrera de viento y revestimientos por superficie neta (descontando aberturas e incluyendo hastiales).
- **Lista de cortes**: optimiza los cortes sobre la barra comercial (6 m por defecto, con espesor de corte) y marca los empalmes de piezas más largas que la barra.

### Ingeniería · fase 1 (cargas)

Proyecto, especificación y dirección: **Jesús Olguín · jesus.olguin**. Implementación asistida: **ingeniero Astra el Evangelista**. Los créditos se conservan en interfaz, impresión y commits; no constituyen firma profesional.

La pestaña **Ingeniería** calcula el material instalado y acciones preliminares. **Revisar** es el estado de esta fase: aún no hay análisis del pórtico, reacciones, dimensionado ni verificación de estabilidad. El selector bajo el 3D muestra los casos principales o la envolvente local de componentes y revestimientos. Oscuro indica succión, claro presión; las flechas indican el sentido. Al apuntar una zona se muestra su presión.

- Barras con `key` estable: peso por corte real y sección nominal. Las claves llegan al BOM y a la lista de cortes.
- Superficies con capas: pesos netos sin merma de compra. Aislación de tabique una sola vez, chapa sobre pendiente y alero, lana sobre planta cubierta.
- **Cielorraso bajo cubierta real:** placa de yeso de 12,5 mm, 16 tubos de 2,96 m y marco perimetral de 18 m en el módulo inicial. Tubo nominal 40×20×1,6 mm, separación ≤0,40 m; apoyos y secciones pendientes de cálculo. Se dibuja en su capa, se corta y se compra. Sólo se genera bajo techos; no duplica el paquete de cielorraso del entrepiso. Reduce la altura libre bajo techo a aproximadamente **2,4475 m** en el módulo inicial: la altura del formulario se mide hasta el bastidor superior.
- Fundación pesada desde sus sólidos, **separada de las cargas de la vivienda**. Los 24 kN/m³ de hormigón son un supuesto editable del encargo; no se acredita que los dados estén vinculados frente a levantamiento.
- Equipos permanentes: nivel, piso/cubierta, coordenadas, fuerza en kN, fuente y confirmación. Aparecen como flechas en 3D y cargas D; no se inventa material estructural en el BOM. Una carga fuera de la superficie deja un diagnóstico y no se aplica.
- Edición `engineering.codeEdition`: **2025 por defecto**, o 2005 según jurisdicción. El cambio invalida la confirmación y evita reutilizar una velocidad de otra edición. El riesgo selecciona el mapa 2025; en 2005 permanece el factor I. La adopción provincial/municipal es una entrada a confirmar.
- Localidades: velocidades 2025 de la tabla oficial de ciudades, por riesgo, y nieve tabulada de Comodoro/Esquel. **Puerto Madryn, Trelew y Esquel no tienen V local confirmada** en esta entrega: el mapa consultado no permitió lectura suficientemente precisa. El valor inicial **80,8 m/s es un escenario supuesto, no la velocidad de Puerto Madryn**. Los 58 m/s de Telsen se mantienen sólo como referencia 2005. Zona sísmica, helada, topografía, exposición y suelo requieren confirmación específica.
- Densidades y masas editables con fuente. Cambiar Fy/E/f'c no cambia masa. Las unidades internas son N, m, Pa, kg; se muestran kN, kgf/tf y kN/m².
- JSON: entradas, fórmulas, puntos de aplicación, fuerzas, momentos, presiones, combinaciones y supuestos. La impresión es un extracto de cargas; la memoria completa corresponde a fase 8.

**Módulo inicial 3 × 6 m, sin equipos adicionales:**

| Parte | Cantidad base | Peso modelado |
| --- | --- | --- |
| Barras instaladas | 150 piezas, incluyendo 20 del cielorraso | 18,808 kN |
| Capas y hojas de aberturas | incluye 18 m² de placa de cielorraso | 20,100 kN |
| Vivienda | suma instalada | **38,908 kN (3,967 tf)** |
| Fundación | 6 × 0,40 × 0,40 × 0,80 = 0,768 m³ | **18,432 kN (1,880 tf)** |
| Total modelado | vivienda + fundación | **57,340 kN (5,847 tf)** |

La fase 0 pesaba 54,987 kN en total. La diferencia intencional es **2,353171 kN**: 65,36 m de tubos nominales × 1,426816 kg/m × g₀ más 18 m² × 8,15 kg/m² × g₀. No cambian las cantidades originales de columnas, viguetas o cabios. La cuenta manual está en `base.test.js`. El snapshot histórico de fase 0 se conserva; `fixtures/default-phase-1.json` guarda el resultado completo, comprimido sin pérdida y con SHA-256, sólo para pruebas.

### Cómo calcula las acciones

| Acción | Reglamento y alcance implementado |
| --- | --- |
| D | CIRSOC 101-2025 §§3.1.1/3.1.2; antecedente 101-2005 §3.1. Masas reales modeladas y equipos aportados; no incluye equipos no cargados, acabados extra ni herrajes aún sin piezas. |
| L | Tabla 4.1 de 101-2025/2005: vivienda 2 kPa, oficina 2,5, depósito liviano 6, terraza privada 3/pública 5, balcón de vivienda 3 hasta 10 m²/5 después, escaleras 5 como criterio general. La función de reducción por elemento respeta KLL·At≥37 m², mínimos y prohibiciones; la carga global **no se reduce** antes del análisis tributario. |
| Lr | 101-2025 §4.8.1(a/b): distingue cubierta liviana ≤0,5 kPa incluyendo su estructura/placa, con R1/R2 de área y pendiente. Para el techo inicial al 2 %, **0,765 kPa**. 101-2005 §4.9.1 da 0,96 kPa sin reducción. At=1 m² en la acción global asegura R1=1; no se usa toda la cubierta como área de una fijación. |
| S | CIRSOC 104-2005 §§3/3.4/4: 0,7CeCtIpg, mínimo de baja pendiente y Cs=1 sin aprovechar evacuación. Ct=1,2 inicial es supuesto. Con pg=0,30 kPa resulta **S=0,30 kPa**, no 0,252. Acumulación triangular de §7.1 sobre cubierta inferior, superpuesta a balanceada y truncada en el borde; hd usa cotas superiores tabuladas de Fig.9, redondeo hacia arriba y siguiente intervalo, **no interpolación exacta**. Fuera de pg≤5 kPa/lu≤120 m se informa cálculo específico pendiente. Nieve no balanceada a dos aguas: §6.1, ambos sentidos; parciales por paño completo/resto a mitad, sin sustituir futuros patrones por tramo. |
| W 2025 | CIRSOC 102-2025: qz=0,613KzKztKdKeV² (§1.13.2), Kd=0,85, Kz de Tabla1.13-1, Ke=1 permitido en §1.12. G=0,85 supone rigidez pendiente. Método direccional §2.4.1/Fig.2.4-1, cuatro sentidos, GCpi±0,18/0,55 (Tabla1.11-1), alternativas de Cp y casos torsionales1–4 de Fig.2.4-8. Diagonales conservan la presión de cubierta más desfavorable, sin sumar dos techos. Mínimo horizontal §2.1.5; corrección del corte sin beneficio de techo (Fig.2.4-1 nota7). Alero: presión inferior+0,8, sin aplicar presión interna fuera del edificio. |
| W 2005 | 102-2005 §5.10 ec.(13), Tabla5, I de Tabla1; Fig.3 y Fig.5B/7A para techo. No se aplican los casos torsionales2/4 de Fig.9 a edificios≤20 m. Mínimos de §1.4. |
| C&R | 102-2025 §5.3.2/Fig.5.3-1,2A–D,5A/B y Tablas C5.3-1 a C5.3-5; 2005 Fig.5A/5B/7A. Curvas por área efectiva con interpolación logarítmica; zonas de esquinas, bordes, cumbrera y aleros. Mínimo local **0,80 kPa** en 2025 (§5.2.2), 0,50 en 2005 (§1.4.2). La envolvente local **no se suma** como viento global. |
| E | INPRES-CIRSOC103 ParteI-2018: sitio y grupo de riesgo propios (§2.4), espectros de Tablas3.1/3.2, C de §6.2.1 y período aproximado de otros sistemas ec.6.8, peso con participaciones de Tabla3.3, reparto Wi·hi y 10 % superior si corresponde. Ev± (ec.3.10) y excentricidad±5 %. En zona0 se informa exención condicionada hasta3 pisos y12 m; fuera de ella se genera mínimo horizontal1,5 %, sin acreditar requisitos de fundación. Ao en zona0 y sitio SF requieren estudio específico: E no se reemplaza por cero. |
| Combinaciones | ELU 101-2025 §2.3.2 y102-2025 B.3.2: **W=1,0**, frente a 301-2005 A.4 con W=1,6 conservador (nota permite1,5). E también se combina con103-I §3.7. Lr/S son alternativos; se generan omisiones de variables favorables. Servicio2025 B.4.2: Wa usa (Vserv/V)², con Vserv propia supuesta/confirmada. En2005 W nominal completo es un criterio de proyecto conservador declarado. |

Referencia numérica independiente: **Rawson II**, V=73,5 m/s de Fig.1.5-1D, C, z≤5 m, Kzt=Ke=1: q=0,613×0,87×0,85×73,5²=**2,448913 kPa**. Con V=58 m/s en2005 y Kz=0,87 de Tabla5, q=**1,524947 kPa**. El ejemplo orientativo del encargo usa Kz=0,85 y da1,489890 kPa; ambas cuentas están separadas en tests. No se fuerza la tabla para ajustar la cuenta ilustrativa.

### Fuentes y límites

Fuentes primarias y coeficientes versionados: `data/reglamentos.js`, `data/locations.js` y `data/materials.js`.

- [Catálogo oficial INTI-CIRSOC](https://www.inti.gob.ar/areas/serviciosindustriales/construcciones-e-infraestructura/cirsoc/reglamentos) y [Resolución SOP11/2026](https://www.inti.gob.ar/assets/uploads/files/cirsoc/resoluciones-legales/03/RESOL-2026-11-APN-SOP-MEC_CIRSOC.pdf): ediciones y adopción jurisdiccional.
- [CIRSOC101-2025](https://www.inti.gob.ar/assets/uploads/files/cirsoc/02-Reglamento-tramite-de-aprobacion/Reglamento-CIRSOC-101-25.pdf), [CIRSOC102-2025](https://www.inti.gob.ar/assets/uploads/files/cirsoc/02-Reglamento-tramite-de-aprobacion/Reglamento-CIRSOC-102-25.pdf), [CIRSOC104-2005](https://www.inti.gob.ar/assets/uploads/files/cirsoc/vigencia-2013/area100/2021/14-%20CIRSOC%20104-Reglamento.pdf) e [INPRES103-I-2018](https://www.inti.gob.ar/assets/uploads/files/cirsoc/06-reglamentos-2da-generacion/area100/06_Area100_INPRES-CIRSOC-103-Parte-1-Reglamento-2018.pdf).
- [CIRSOC301-2005](https://www.inti.gob.ar/assets/uploads/files/cirsoc/vigencia-2013/area300/reglamento_301.pdf), [101-2005](https://www.inti.gob.ar/assets/uploads/files/cirsoc/vigencia-2013/area100/Reglamento-cirsoc101-completo.pdf) y [102-2005](https://www.inti.gob.ar/assets/uploads/files/cirsoc/vigencia-2013/area100/Reglamentos_CIRSOC_INPRES.pdf): antecedentes seleccionables, no mezclados con viento2025.
- [Knauf ST12,5](https://knauf.com/es-AR/p/producto/placa-de-yeso-st-12.5-10003_2001): referencia8,15 kg/m² a confirmar para producto instalado. [EGGER OSB3](https://www.egger.com/en/building-products/range/products/osb3): densidad mínima600 kg/m³ no equivale a peso real. Chapas, lana, membranas, hormigón y perfiles mantienen supuestos editables. CIRSOC101-2005 Tabla3.1 indica25 kN/m³ para hormigón armado; los24 del encargo no se presentan como valor reglamentario.

**Alcance pendiente visible en resultados:** el viento es preliminar para edificio rectangular regular≤20 m; rigidez, protección de carpinterías y exposición no se acreditan. Se carga la fachada bruta (incluyendo carpinterías), como cota conservadora ante apertura potencial. Niveles escalonados no descuentan resguardo y requieren estudiar interferencias. La zonificación de plantas irregulares usa caja envolvente y deja diagnóstico. C&R de una agua>30° no se calcula; gables hasta45°. Aleros inclinados2025 sin curva neta implementada usan una envolvente adicional de techo+presión inferior, **a revisar antes de diseñar fijaciones**. La errata A>5 de TablaC5.3-2 zona2 alero se resuelve con el extremoA=50 del gráfico.

Faltan presiones bajo piso elevado (Fig.5.3-1A), edificios abiertos, parapetos, respuestas flexibles/dinámicas, lluvia/embalsamiento, hielo, caída de nieve desde cubiertas superiores y cargas de montaje. Centros de masa, concentración en diafragmas, regularidad sísmica y reparto por rigidez son preliminares. Las acciones y envolventes son **fuerzas y momentos de cargas, no reacciones ni chequeos de anclajes**. Las cargas concentradas de uso se registran para futuro análisis local; no se verifica aún la posición más desfavorable. Suelo100 kPa y resistencias requieren documentación. El estado permanece **Revisar**.

La próxima entrega es **fase2 · Análisis**, según `docs/PROMPT-ASTRA-motor-estructural.md`. El cálculo y planos para construir requieren revisión y firma de un profesional matriculado.

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
| `cad/engineering/loads.js`, `engine.js` | D, L, Lr y orquestación de casos y combinaciones |
| `cad/engineering/wind.js`, `snow.js`, `seismic.js` | Acciones climáticas/sísmicas y supuestos |
| `cad/engineering/combinations.js` | Combinaciones y envolventes de cargas, sin reacciones |
| `cad/engineering/load-geometry.js` | Recortes 3D, centros y resultantes |
| `cad/engineering/panel.js` | Panel, cargas puntuales, pesos editables y extracto imprimible |

Para sumar otro sistema constructivo (steel frame, wood frame, container) se agrega su definición en `SYSTEMS` de `cad/catalog.js` con los perfiles de cada rol, y las reglas propias en el generador.

## Uso local

```bash
npm test
npm start
```

Luego abrir `http://localhost:4173` (calculadora) o `http://localhost:4173/cad.html` (diseñador).

`npm test` corre 63 pruebas: las 19 originales, 18 de base y 26 de cargas. GitHub Actions las corre en cada PR y agrega una prueba de navegador con Playwright en el entorno de CI (no agrega dependencias a la PWA): edición/guardado/deshacer, 3D, escritorio, celular de 390 px y carga del cálculo sin conexión. Conserva capturas y resultados como artefactos del workflow. Las tipografías externas se reemplazan por la fuente de sistema solo durante esa prueba.

## Alcance

Las cantidades son un cómputo y predimensionado para compra. Las secciones y separaciones no se verifican por cálculo estructural: antes de construir, los resultados deben validarse con cargas, normativa local, instalaciones y detalles de fabricación.
