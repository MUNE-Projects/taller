# Inmobiliarias — visualización 3D a partir de planos

Prototipo para comprobar si podemos producir visualizaciones arquitectónicas
de calidad comercial partiendo solo del plano de una vivienda. Todo se genera
por código con **Three.js + TSL**. No hay modelos 3D, texturas, HDRI ni
librerías externas aparte de `three`.

La visualización tiene cuatro estados, con transiciones animadas en ambos sentidos:

| Estado | Qué muestra |
|---|---|
| 01 Plano | Planta en papel: muros en poché, giros de puertas, carpinterías, mobiliario y superficies |
| 02 Volúmenes | Cada estancia como un volumen coloreado según su uso |
| 03 Modelo | Arquitectura en maqueta blanca: muros con huecos, carpinterías, barandilla y equipamiento fijo |
| 04 Vivienda | Acabados de la memoria de calidades, mobiliario, sol y cielo |

| | |
|---|---|
| ![Plano](docs/capturas/01-plano.png) | ![Volúmenes](docs/capturas/02-volumenes.png) |
| ![Modelo](docs/capturas/03-modelo.png) | ![Vivienda](docs/capturas/04-vivienda-aerea.png) |
| ![Salón](docs/capturas/04-vivienda-salon.png) | ![Cocina](docs/capturas/04-vivienda-cocina.png) |

## Personalizar vivienda (configurador)

En el estado **04 Vivienda**, el botón **Personalizar vivienda** abre un panel con las opciones comerciales de la promoción, cada una con su precio:

| Categoría | Opciones |
|---|---|
| Distribución | base / alternativa (cocina abierta al salón) |
| Suelo | roble natural / roble claro / nogal |
| Cocina | blanco / nogal / gris antracita |
| Encimera | blanca / negro granito / piedra clara |
| Baños | acabado claro / oscuro |
| Exterior | sin mejora / piscina rectangular pequeña |

- **Resumen de precio:** siempre visible (base, extras elegidos, total de extras y precio total).
- **Guardar configuración:** muestra el resumen completo y lo recuerda en este navegador.
- **Vistas al cambiar una opción:**
  - Cocina y encimera llevan a la vista Cocina.
  - La piscina lleva a Terraza.
  - La distribución lleva a Planta.
  - Suelo y baños mantienen la vista actual.

| | |
|---|---|
| ![Distribución alternativa](docs/capturas/05-personalizar-distribucion.png) | ![Cocina nogal y granito](docs/capturas/05-personalizar-cocina.png) |
| ![Vista aérea personalizada](docs/capturas/05-personalizar-aerea.png) | ![Resumen guardado](docs/capturas/05-personalizar-resumen.png) |

Todo se define como datos:
- `src/modelo/configuracion.json`: categorías, opciones, precios, parámetros de cada acabado, vista asociada y datos de la piscina.
- `src/modelo/variantes.json`: variantes de distribución, generadas por `herramientas/extraer_plano.py`.

Añadir una opción nueva es añadir una entrada.

Las vistas de `src/escena/camaras.ts` son **cámaras maestras**: están congeladas y el configurador no las modifica. Con el panel abierto, la imagen se desplaza lateralmente sin mover la cámara. Las capturas usan siempre el encuadre maestro.

## Uso

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # salida estática en dist/
```

- **Estados:** botones inferiores, teclas `1`–`4` o flechas `←` `→`.
- **Vistas:** Planta, Aérea, Salón, Cocina, Dormitorio y Terraza. También se puede orbitar libremente.
- **Capturar imagen:** renderiza la vista actual a ~2400 px con iluminación global de alta calidad, acumula 72 fotogramas y descarga un PNG.
- **Motor:** WebGPU cuando el navegador lo soporta, con respaldo automático a WebGL 2. `?webgl` fuerza WebGL 2.

## Cómo funciona

```
plano (imagen o DWG) ──► src/modelo/vivienda.json ──► generadores ──► 4 estados + imágenes
```

1. **Datos** (`src/modelo/vivienda.json`, tipos en `src/modelo/tipos.ts`). La vivienda se describe en metros:
   - muros como rectángulos,
   - huecos anclados a un muro,
   - estancias como polígonos,
   - equipamiento con su rectángulo y orientación.

   Cada dato lleva su `origen` (`plano`, `usuario`, `memoria` o `supuesto`) para saber qué es fiable y qué falta confirmar.
2. **Extracción** (`herramientas/extraer_plano.py`, `npm run plano`). Para este caso de prueba las medidas se tomaron analizando los píxeles del plano. La escala se calibró con la escala gráfica y se verificó con las superficies oficiales. En un proyecto real, este paso se sustituye por los planos acotados del cliente.
3. **Generadores** (`src/escena/`):
   - `muros.ts`: trocea cada muro en macizos y dinteles y clasifica cada cara según la estancia a la que mira (pintura, alicatado de baño o fachada). Descarta las caras ocultas.
   - `suelos.ts`: suelos, umbrales, techos (visibles desde dentro e invisibles en la vista de maqueta), volúmenes y entorno.
   - `carpinterias.ts`: puertas con cerco, tapajuntas, hoja pantografiada y manillas; balconeras correderas u oscilobatientes con guías de persiana; barandilla de vidrio.
   - `equipamiento.ts`: cocina, sanitarios, armarios y mobiliario, modelados por código.
   - `materiales.ts`: materiales procedurales en TSL (gres con juntas, alicatado, madera con veta, cuarzo con árido, textiles, SATE, lacados) y los uniforms que gobiernan los estados.
   - `lineas.ts`: el grafismo de planta.
   - `luz.ts`: cielo, sol e iluminación de entorno.
   - `estados.ts`: la máquina de estados y sus transiciones.
   - `camaras.ts`: las vistas predefinidas y el paso de una a otra.
4. **Configurador** (`src/configurador/`):
   - `variantes.ts` aplica un parche de distribución sobre la vivienda base. Recalcula las superficies por diferencia de área y recoloca el equipamiento apoyado en un muro que cambia: lo ajusta al tramo que queda o lo retira, e informa de ello.
   - `configurador.ts` guarda la selección y los precios, y lleva los parámetros de cada acabado a los uniforms de los materiales con un fundido.
   - `panel.ts` genera el panel a partir del catálogo.
5. **Render** (`src/main.ts`): iluminación global en espacio de pantalla (SSGI), oclusión ambiental y antialiasing temporal (TRAA), mapeo tonal Neutral y exposición automática al entrar en la vivienda.

## Estado del caso de prueba

La fidelidad al plano, las decisiones tomadas y lo que falta confirmar están en
[`docs/analisis-y-decisiones.md`](docs/analisis-y-decisiones.md).
