# Caso de prueba: análisis del plano y decisiones

## Fuentes

- **Plano comercial** V.00 de marzo de 2026 (`docs/plano-original.png`): planta baja, puerta A, 88,18 m² útiles interiores y 32,71 m² exteriores.
- **Memoria de calidades** de la promoción (texto): carpinterías, acabados, cocina, baños e instalaciones.
- **Confirmaciones de la propietaria del proyecto** sobre los elementos ambiguos del plano.

Ninguna de estas fuentes contiene cotas ni alturas. Todo lo que no aparece en ellas está marcado como `supuesto` en el JSON.

## Escala y fidelidad

La escala gráfica (0–3 m) da **63,4 px/m**. El origen está en la esquina exterior suroeste; `x` va hacia el este e `y` hacia el norte.

La verificación con la superficie **exterior** medida coincide con la tabla oficial:

| Estancia | Medida | Oficial | Diferencia |
|---|---|---|---|
| Terraza | 11,28 m² | 11,33 m² | −0,4 % |
| Porche | 21,38 m² | 21,38 m² | 0,0 % |

Las estancias **interiores** salen en torno a un 3 % por encima de la tabla oficial: salón +1,6 %, cocina +3,2 %, dormitorio 2 +3,3 %, dormitorio principal +3,0 %, baño principal +3,1 %. Se debe a que el plano dibuja el contorno de los muros con una línea de ~1 px que no se suma a su espesor.

El recibidor da +8,3 % porque su límite con el salón no está dibujado: es una línea virtual.

La tolerancia es de ±10 cm, y está dentro de lo esperable midiendo sobre una imagen.

## Elementos ambiguos del plano y cómo se resolvieron

| Elemento | Decisión | Origen |
|---|---|---|
| Pieza alargada entre salón y cocina | Mueble de TV; salón y cocina no se comunican directamente | usuario |
| Franja gris entre los dos baños | Muro macizo | usuario |
| Arco entre recibidor y distribuidor | Puerta | usuario |
| Dos piezas en el baño principal | Doble lavabo | usuario + memoria |
| Cuadrado del Espacio Homes | Lavadora | memoria |
| Huecos de fachada | Balconeras. Cocina y dormitorios, oscilobatientes (memoria). Salón, corredera (supuesto: la memoria dice "oscilobatientes o correderas según proyecto") | usuario + memoria + supuesto |
| Marcas del borde de la terraza | Postes de barandilla | usuario |
| Más allá del perímetro | Zonas comunes; no se añade jardín | usuario |
| Línea discontinua del porche | Proyección de la planta superior: el porche está cubierto y la terraza no | plano (interpretación) |
| Armario en el lado norte del dormitorio 2 | Dos armarios espalda con espalda: uno abre al distribuidor y otro al dormitorio (cuadra con la superficie del distribuidor) | plano (interpretación) |

## Valores supuestos (a sustituir en un proyecto real)

- **Alturas:** libre 2,50 m; forjado 0,30 m; puertas interiores 2,03 m; entrada 2,10 m; balconeras 2,20 m; barandilla 1,05 m.
- **Carpintería exterior:** gris antracita. La memoria no da color; se toma de los renders de la promoción.
- **Barandilla:** vidrio con perfilería oscura.
- **Tonos:** gres porcelánico beige claro de 90×90; alicatado de baños claro de 60×30; muebles de cocina blancos sin tirador con cuarzo oscuro; pintura en blanco roto.
- **Pantografiado de las puertas:** 4 ranuras horizontales. La memoria dice "pantografiadas" pero no da el diseño.
- **Mueble de lavabo:** madera clara con lavabo sobre encimera. La memoria dice "mueble con lavabo" sin más detalle.
- **Giro de las puertas:** el del plano, que el propio plano declara no vinculante. En los estados 3 y 4 se muestran abiertas a 78°.
- **Mobiliario suelto:** la distribución del plano, que el plano declara ilustrativa. No se ha añadido nada que no aparezca en él: ni atrezo, ni televisor, ni lámparas, ni plantas.

## Qué necesitaríamos del cliente en un proyecto real

1. Planos acotados, a ser posible en DWG, DXF o PDF vectorial. Con ellos el JSON se genera sin medir sobre una imagen.
2. Sección o alturas: altura libre, falsos techos, dinteles, alféizares y forjados.
3. Memoria de carpintería: tipo de apertura de cada hueco, persianas y barandillas.
4. Memoria de calidades con referencias de acabados (colores, formatos y modelos).
5. Orientación exacta, para colocar el sol.

## Limitaciones conocidas del prototipo

- **Iluminación global en espacio de pantalla (SSGI).** En interactivo tiene algo de grano, que desaparece al acumular fotogramas con la cámara quieta; el modo "Capturar imagen" ya lo hace. No es un trazado de rayos físico: no llega a la calidad de un render fotográfico de V-Ray o Corona, sobre todo en rebotes de luz complejos.
- **Vidrio y espejos:** reflejan el cielo, no la estancia.
- **Techo del porche:** se representa como el canto de un forjado. No se modela el edificio de encima porque no hay datos.
- **Probado en Chromium con WebGL 2** (renderizado por software). El backend WebGPU requiere un navegador actual (Chrome 13x o superior, Edge o Safari 26).
