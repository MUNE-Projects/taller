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

## Iteración 2: configurador comercial

### Cómo se ha integrado

- **La vivienda base no se toca.** Una distribución alternativa es un parche en `variantes.json` que solo nombra lo que cambia. `aplicarVariante()` genera la vivienda resultante y la escena se reconstruye dentro de contenedores persistentes. Estados, cámaras y render siguen apuntando a los mismos objetos, y todo lo que el parche no nombra conserva la misma geometría.
- **Acabados.** Suelo de madera, frentes de cocina, encimera y baños leen uniforms de TSL (`P` en `materiales.ts`). Cambiar una opción cambia valores y los funde en 450 ms, sin reconstruir geometría ni recompilar shaders.
- **Piscina.** Se construye una vez y aparece o desaparece con el equipamiento (estados 3 y 4). En planta se dibuja su contorno.
- **Cámaras maestras.** El objeto `VISTAS` está congelado.

### Variante "cocina abierta al salón" (+4.500 €)

- **Tabique:** el tabique salón-cocina se acorta. Se conserva el tramo norte, junto al pilar, y se abre un paso de 2,0 m junto a la fachada.
- **Puerta:** no hace falta modificar ninguna. La cocina conserva su puerta al recibidor, que sigue siendo el acceso directo desde la entrada.
- **Superficies:** el salón pasa de 24,77 a 24,87 m² (gana la franja del tabique retirado) y el útil interior de 88,18 a 88,28 m². La cocina pasa a llamarse "Cocina abierta" y mantiene 11,18 m².
- **Mobiliario:** el mueble de TV, que se apoyaba en ese tabique, se ajusta automáticamente al tramo que queda (de 3,63 m a 1,90 m). El resto del mobiliario no cambia.

### Suelo

Las opciones comerciales plantean tarima de roble como suelo de serie, lo que cambia lo que dice la memoria (gres porcelánico en toda la vivienda):

- **Tarima:** salón, recibidor, distribuidor y dormitorios, en lamas de 19 × 145 cm a junta trabada.
- **Gres porcelánico:** cocina y baños, como dice la memoria.
- **Cerámico:** Espacio Homes, como dice la memoria.

### Piscina (+18.000 €)

Es un vaso elevado de 2,20 × 1,10 m y 0,60 m de altura, con 0,52 m de lámina de agua. Va elevado porque bajo la planta baja hay garaje y no se puede excavar el forjado.

Se sitúa en la parte descubierta de la terraza:
- deja 1,0 m de paso frente a la fachada;
- no invade el porche cubierto;
- no ocupa la posición de la cámara maestra Terraza.

`validarPiscina()` comprueba estas condiciones al arrancar.

**Limitación:** es la única zona descubierta con sitio. Queda justo delante y debajo de la cámara maestra Terraza, así que en esa vista la piscina aparece en primer plano inferior. Para lucirla haría falta una cámara maestra adicional; la decisión es de la propietaria del proyecto.

### Sin cámara maestra

La opción de baños no tiene cámara maestra propia, así que mantiene la vista actual.

## Iteración 3: usabilidad y claridad comercial

### Problemas detectados

1. **Demasiados modos.** Cuatro estados técnicos (Plano, Volúmenes, Modelo, Vivienda), más un botón aparte para personalizar. El comprador no sabía dónde estaba lo importante.
2. **El baño no tenía vista.** Además, la vista Terraza solo enseñaba la piscina en el borde inferior.
3. **Panel demasiado grande.** Medía 360 px, estaba en el lado izquierdo, tenía todas las opciones desplegadas y el desglose de precio ocupaba mucho. Tapaba la composición.
4. **Cámara mareante.** Entre dos vistas interiores la cámara subía 4 m en arco y volvía a bajar. Además, repetía ese arco al elegir otra opción estando ya en la vista, porque no comprobaba si ya estaba allí.
5. **La distribución llevaba a la planta 2D,** que no transmite el efecto espacial de abrir la cocina.

### Correcciones

1. **Tres modos: Plano, Vivienda y Personalizar.** Vivienda es el modo de arranque: la vivienda se construye desde el plano y se muestra la vista general.
2. **Vistas.** Se añade la vista maestra **Baño**: desde la puerta del baño principal, con ducha, inodoro y doble lavabo en un solo encuadre. Se recoloca **Terraza**: desde el suroeste, por encima de la barandilla, con fachada, terraza y piscina. Aérea pasa a llamarse **Vista general**. Salón, Cocina y Dormitorio no cambian.
3. **Cajón de 320 px a la derecha,** con acordeón (una categoría abierta a la vez), elección y precio en la cabecera de cada categoría, total fijo y desglose plegable. Al desplegar una categoría, la cámara va a la estancia afectada. Así, al elegir una opción la cámara ya está allí y no se mueve.
4. **Cámara.** Se elimina el arco. Una sola transición por acción; no se mueve si ya está en la vista; fundido de unos 0,3 s entre vistas a la altura de los ojos; desplazamiento suave según la distancia en el resto.
5. **Distribución.** Cada variante lleva su propia vista explicativa. Para la cocina abierta es una vista interior desde el salón hacia la cocina, a través del paso, que muestra la apertura, la cocina y el cambio de pavimento. Un aviso resume el cambio y ofrece "Ver en plano" como complemento.
