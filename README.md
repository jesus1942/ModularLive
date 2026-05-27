# ModularLive

PWA estática para calcular materiales base de espacios modulares: viviendas, oficinas, baños y configuraciones personalizadas.

## Qué incluye

- Cálculo de piso, muros, techo, ventanas, puertas y fijaciones.
- Presets iniciales para `vivienda`, `oficina` y `baño`.
- Lista de materiales exportable a `CSV` y `JSON`.
- `manifest.webmanifest` y `service worker` para comportamiento PWA/offline.
- Pruebas del motor de cálculo con `node --test`.

## Uso local

```bash
npm test
npm start
```

Luego abrir `http://localhost:4173`.

## Criterio de cálculo

La app entrega una estimación de compra inicial con merma configurable. El cálculo incluye:

- Piso: vigas perimetrales, viguetas, placas, aislación y anclajes.
- Muros: soleras, montantes, placas, membrana y aislación.
- Techo: cabios, vigas perimetrales, placas, membrana e aislación.
- Aberturas: ventanas, puertas y marcos.
- Fijaciones: tornillos y sellador.

Antes de construir, los resultados deben validarse con el sistema estructural real, cargas, normativa local, instalaciones y detalles de fabricación.
