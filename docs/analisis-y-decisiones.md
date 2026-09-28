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

## Iteración 4: producto comercial

### Cambios

- **Estructura:** Promoción → Tipologías → Viviendas → Opciones. La geometría, las variantes y las cámaras maestras van por tipología. Bajo B (ejemplo) es la tipología A espejada, con otro precio base y sin piscina.
- **Acceso sin base de datos:** enlace privado por vivienda (`#c-…`). Solo se guarda su hash. La parte pública no muestra personalización ni precios.
- **Carrito:** quitar mejoras desde el resumen, restablecer con confirmación, y total, número de mejoras y extras siempre visibles.
- **Documento de selección en PDF**, que sustituye a "Guardar configuración". Se genera con jsPDF en el navegador.
- **Marca blanca** en `promocion.json`, aplicada a la interfaz y al PDF.
- **Cámaras maestras revisadas con criterio comercial:**
  - Baño: diagonal desde la puerta; ducha, inodoro y doble lavabo protagonistas; sin tabique en primer plano; 60°.
  - Salón: desde la esquina noroeste hacia la balconera.
  - Dormitorio: cama y balconera, sin armario en primer plano.
  - Cocina: campo más cerrado.
  - Terraza y Vista general: sin cambios.
- **Vibración en Plano:** no venía de la cámara (posición, fov y etiquetas medidos sin variación) ni de superficies coplanares. La causaba el vaivén de subpíxel del antialiasing temporal sobre los bordes finos del poché, más el ruido temporal de la oclusión ambiental. Se corrige así:
  - oclusión anulada en planta;
  - plano de recorte cercano adaptado a la distancia;
  - líneas del plano algo más separadas;
  - render bajo demanda: con todo quieto se acumulan unos fotogramas y la imagen se congela. Verificado: 0 píxeles distintos entre fotogramas en Plano.
- **Encuadre con el cajón abierto:** se descubrió que el antialiasing temporal reescribe `setViewOffset` en cada fotograma, así que el desplazamiento anterior no llegaba a aplicarse. Ahora se usa `filmOffset` junto con el zoom de proyección, sin mover la cámara.

### Decisiones

- **Marca de ejemplo ficticia** (Promotora Demo, Residencial Demo). No se usa la marca de la promotora del plano de prueba porque no tenemos su permiso. Se cambia en `promocion.json`.
- **Tipografía del PDF:** Helvetica. Incrustar la tipografía de la promotora requiere su fichero de fuente (TTF); se puede añadir cuando la promotora lo facilite.
- **Distribución:** al cambiarla, la cámara va a la vista explicativa de la variante (interior salón-cocina) y el aviso ofrece "Ver en plano".

## Iteración 5: navegación, calidad visual, ambientación y Studio

### Cambios

- **Vibración del Plano, corrección definitiva.**
  - El modo Plano usa su propia cadena de render con FXAA (espacial y determinista). Ya no pasa por el antialiasing temporal (TRAA) ni por la iluminación global, que son temporales.
  - Verificado con render continuo, sin congelar la imagen: 0 píxeles distintos entre fotogramas.
- **Navegación libre para no expertos** (`navegacion.ts`), con tres modos:
  - planta: solo desplazar y acercar;
  - exterior: órbita limitada, sin entrar en la maqueta;
  - interior: mirar alrededor con el pivote justo delante de la cámara y caminar con la rueda.

  Colisiones con muros (margen de 30 cm) y con muebles y decoración (18 cm), comprobadas paso a paso contra muro, fachada, sofá, cama y tabique. Botón «Recentrar vista».
- **Vistas guiadas:**
  - se añade Dormitorio 2 y se revisan todas las cámaras a 1,45-1,5 m de altura de ojos con 48-58° de campo;
  - el Baño va en diagonal desde la puerta;
  - al llegar a una vista interior ya no hay retroceso: se liberaban tarde los límites de la órbita exterior.
- **Puertas interiores** abiertas del todo (89,5°).
- **Ambientación** con biblioteca de activos procedurales (54 activos, 15 categorías):
  - salón: sofás con cojines y manta, alfombra, lámpara de arco, planta, cuadros, televisor, libros y velas;
  - comedor: colgante de fibra y frutero;
  - dormitorios: camas vestidas con cojines y plaid, lámparas de mesilla, cuadros, alfombras y butaca de lectura;
  - cocina: botes, tabla y frutero;
  - baños: toalleros, dispensadores y alfombrillas;
  - terraza: sillones de teca, mesa baja, jardineras y olivo.
- **Materiales nuevos (TSL):** bouclé, mármol con vetas, follaje, emisivos para luminarias y lienzos abstractos.
- **Detalles constructivos y exterior:**
  - rodapiés lacados (solo con muro macizo detrás; se cortan en los huecos);
  - downlights en techo;
  - césped con paseo, seto bajo junto a la barandilla y árboles mediterráneos.
- **Studio de producción:** ver [`arquitectura-studio.md`](arquitectura-studio.md).

### Decisiones

- **Muebles del plano:** en el Studio se sustituyen, pero no se mueven. Su posición es dato del plano (lo que dibujó el arquitecto). La decoración sí se mueve libremente.
- **IA solo en el Studio,** vía capability `sample`, con la cuenta de quien lo usa. Sin IA disponible, la misma propuesta se calcula en local. La web publicada nunca llama a la IA.
- **Referencias de marca** (Maison du Monde, Kave Home…): son un universo de estilo interno del Studio. No se muestran al comprador, no se integra catálogo y no se reproducen productos.
- **Luminarias:** son emisivas, sin luces reales, para no penalizar el rendimiento. La iluminación global recoge parte de su aporte.

## Iteración 6: navegación, vistas por estancia, render y plano

### Cambios

- **Giro en interior:**
  - *Antes:* la cámara orbitaba un punto 30 cm por delante, así que al girar se desplazaba. Junto a una pared ese desplazamiento se rechazaba y solo se podía mirar en algunas direcciones (el caso del Dormitorio 2).
  - *Ahora:* gira sobre sí misma y se puede mirar en cualquier dirección. Verificado: 360° sin mover la posición en la vista del Dormitorio 2.
- **Caminar:**
  - contra un muro, la cámara se desliza a lo largo de él;
  - las puertas interiores abiertas se pueden cruzar (verificado: del Dormitorio 2 al pasillo);
  - la puerta de entrada queda cerrada y actúa como muro;
  - también se camina con las flechas del teclado y con el pellizco.
- **Vistas por estancia:**
  - nuevas: Recibidor y Baño secundario;
  - el salón-comedor (24,8 m²) pasa a dos vistas, Salón · Estar y Comedor;
  - la regla de vistas obligatorias y las vistas automáticas de reserva están en `src/escena/vistas.ts`.
- **Render:**
  - reflejos en pantalla ponderados por el brillo de cada material;
  - sol de tarde más bajo, que entra bajo el porche;
  - nubes y perfil lejano de colinas;
  - resplandor suave y gradación con viñeteado;
  - pintura con leve textura de rodillo, aluminio anodizado y pavimentos exteriores con más contraste;
  - exposición exterior ajustada.
- **Plano:**
  - encuadre automático en el hueco libre de la pantalla;
  - rótulos editoriales con halo, colocados por búsqueda dentro de cada estancia para no pisar muros, muebles ni otros rótulos;
  - formatos compactos y abreviados para pantallas pequeñas.
- **Studio:** botón visible («Studio», abajo a la derecha), que recuerda el acceso en ese navegador.

## Iteración 7: entregables del producto

### Qué se ha hecho

- **Packs de personalización temporales:**
  - datos en `promocion.json`, con estado deducido de las fechas;
  - el panel se agrupa por packs;
  - el histórico formalizado viene de `viviendas[].selecciones`, porque la promotora lo registra al recibir la firma y el pago;
  - los packs y los datos de pago se editan desde el Studio.
- **Documento por pack:** dos páginas.
  - Página 1: selección e importe.
  - Página 2: formalización y pago, con procedimiento en cuatro pasos, datos de transferencia, datos del comprador, DNI/NIE y firma.
- **Plano comercial vectorial** (`src/documento/plano.ts`):
  - un solo dibujo con dos salidas, jsPDF y Canvas;
  - rótulos colocados con la tipografía real del documento, sin pisar muros, muebles, barridos de puertas ni otros rótulos.
- **Render HD** (`src/escena/renderHD.ts`), separado del visor.
- **Calidad del visor:**
  - luz de ventana con sombras;
  - cantos biselados en mobiliario;
  - barniz en la tarima;
  - interruptores;
  - algo más de oclusión de contacto;
  - reducción suave de la luz de cielo dentro de la vivienda.
- **Actualización de planos:**
  - versiones guardadas;
  - comparador por ids;
  - revisión de impactos (`src/promocion/revision.ts`) y pestaña «Actualización» del Studio;
  - procedimiento en `docs/actualizacion-de-planos.md`.

### Pruebas y hallazgos

- **Tonos AgX frente a Neutral:** AgX apagaba el color y el contraste de los interiores. Se mantiene Neutral (`?tono=agx` para comparar).
- **Menos luz de cielo en interior:** reducirla mucho no dio más contraste, sino interiores grises. La iluminación global en pantalla no aporta el rebote suficiente. Se deja en un 20 %.
- **Render HD por mosaicos:**
  - el bloom creaba juntas entre mosaicos (su halo depende del contenido de cada uno), así que se quitó del render HD;
  - el primer mosaico salía sin sombras porque los mapas de sombra recién creados no estaban listos, así que se añadieron fotogramas de calentamiento.

### Límites reales de la calidad

La cadena actual es rasterización en tiempo real con iluminación global y reflejos en espacio de pantalla. Tiene un techo claro:
- **Luz indirecta:** solo rebota lo que se ve en pantalla. Por eso la luz indirecta de fuera de cuadro y las esquinas no se comportan como en una fotografía.
- **Materiales:** son procedurales (TSL), sin fotografías de texturas. Cuesta el detalle fino de telas, piedra y madera reales.
- **Luces:** las luminarias son emisivas, sin luz real.

**Para acercarse al fotorrealismo en las imágenes HD, harían falta otros enfoques técnicos:**
1. **Trazado de rutas** (path tracing) para el render HD, por ejemplo con three-gpu-pathtracer. Es gratuito y se ejecuta en el navegador, pero trabaja con materiales estándar de Three.js. Habría que «hornear» los materiales procedurales a texturas.
2. **Texturas PBR fotográficas** (madera, piedra, tejidos) con licencia comercial, en lugar de o junto a los materiales procedurales.
3. **Iluminación precalculada** (lightmaps) para el visor.
