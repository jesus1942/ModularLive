# ModularLive

PWA estática para diseñar y computar materiales de espacios modulares: viviendas, oficinas, baños y configuraciones personalizadas.

Tiene dos herramientas:

- **Calculadora rápida** (`index.html`): un módulo rectangular por parámetros, con presets y cotización.
- **Diseñador en planta y 3D** (`cad.html`): dibujás la planta y la herramienta genera cada pieza de la estructura, la fundación y los cerramientos, con vista 3D, cómputo de materiales y lista de cortes.

## Diseñador en planta y 3D

### Cómo se usa

1. Dibujá el contorno con **Rectángulo** o con **Muro exterior** (tocás punto a punto; escribí un largo y `Enter` para medidas exactas; tocar el punto inicial cierra el contorno).
2. Agregá **tabiques** interiores: se enganchan a los muros existentes.
3. Ubicá **puertas y ventanas** tocando sobre un muro. Con **Seleccionar** se arrastran a lo largo del muro y se editan sus medidas en el panel derecho.
4. Elegí fundación, techo, revestimientos y separaciones en el panel izquierdo.
5. Revisá el 3D por capas, la tabla de materiales (con precios propios, compartidos con la calculadora) y la lista de cortes. Exportá CSV, guardá el diseño como `.json` o imprimilo.

Atajos: `V` seleccionar, `R` rectángulo, `E` muro, `I` tabique, `P` puerta, `N` ventana, `Ctrl+Z` / `Ctrl+Y`, `Esc` termina o cancela, `Supr` borra lo seleccionado. `Shift` libera el modo ortogonal.

### Cómo calcula

El diseño se guarda como un modelo de obra (muros en planta con sus aberturas, fundación, techo y parámetros). A partir de ese modelo, `cad/generator.js` produce **cada pieza real** con su posición 3D y su largo de corte. El visor 3D y el cómputo usan exactamente esas piezas, así que lo que se ve es lo que se computa.

- **Estructura (tubo estructural)**: columnas en esquinas y cada ≤ 3 m (corridas fuera de las aberturas), bastidor inferior y superior, montantes, jambas, dinteles, antepechos, marcos en perfil C, viguetas de piso, cabios, cumbrera, cenefas y relleno de hastiales.
- **Fundación**: dados bajo columnas, viga de fundación con pilotines, o platea con viga de borde. Calcula hormigón, excavación, acero por diámetro, malla, film, encofrado y anclajes.
- **Techo**: plano, una agua o dos aguas, con alero. La superficie se calcula en pendiente.
- **Cerramientos**: placas, aislación, barrera de viento y revestimientos por superficie neta (descontando aberturas e incluyendo hastiales).
- **Lista de cortes**: optimiza los cortes sobre la barra comercial (6 m por defecto, con espesor de corte) y marca los empalmes de piezas más largas que la barra.

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

Para sumar otro sistema constructivo (steel frame, wood frame, container) se agrega su definición en `SYSTEMS` de `cad/catalog.js` con los perfiles de cada rol, y las reglas propias en el generador.

## Uso local

```bash
npm test
npm start
```

Luego abrir `http://localhost:4173` (calculadora) o `http://localhost:4173/cad.html` (diseñador).

## Alcance

Las cantidades son un cómputo y predimensionado para compra. Las secciones y separaciones no se verifican por cálculo estructural: antes de construir, los resultados deben validarse con cargas, normativa local, instalaciones y detalles de fabricación.
