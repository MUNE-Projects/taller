# Propuesta técnica: nombres, acceso profesional, datos privados y permisos

Revisión de arquitectura del 10/10/2026. Sustituye a la versión anterior de este documento.

**Nada de lo que hay aquí está aplicado todavía.** La única excepción es el texto de bienvenida del comprador (punto 5 de la petición). Cada bloque espera el OK de la administradora.

**Nombres definitivos:**

- **MUNE Projects:** la empresa.
- **MUNE:** la plataforma y la marca comercial.
- **MUNE Portal:** el espacio de trabajo de la promotora.
- **MUNE Studio:** el entorno interno de producción y gestión. Hoy se llama «Panel».
- **MUNE Experience:** la experiencia pública de cada promoción, en marca blanca. Hoy se llama «escaparate».

**Orden recomendado:**

1. Aprobar la propuesta pendiente de la revisión de marca y textos, con sus 3 pasos en Supabase.
2. **A**, el renombrado.
3. **D**, los permisos por capacidad.
4. **B**, el acceso profesional, que usa la capacidad `materiales` de D.
5. **C**, los datos privados.

C y B tocan el mismo código de la experiencia y pueden ir juntos en una misma propuesta.

---

## A · Renombrado completo: Panel → Studio y escaparate → Experience

### Conclusión

**Es seguro, con una condición:** hacerlo de forma coordinada, en un orden concreto y sin publicar nada durante el cambio, que dura aproximadamente una hora.

No hay ningún bloqueo técnico real. Lo que no se puede «renombrar» se renueva:

- en Cloudflare no se renombra un Worker que publica desde GitHub: se **crea uno nuevo** con el nombre nuevo y el antiguo se borra después;
- en GitHub no se puede leer el valor de un secreto para guardarlo con otro nombre: se **crea una llave nueva**.

### Estado actual: inventario completo

| Elemento | Hoy | Pasa a ser | De qué depende | Qué podría romperse |
|---|---|---|---|---|
| Worker de Cloudflare del Panel | `panel` → `panel.mune-projects.workers.dev`, vista previa `revision-panel…` | Worker nuevo `studio` → `studio.mune-projects.workers.dev`, vista previa `revision-studio…` | Se construye desde la carpeta `panel/` del taller (configuración en el panel de Cloudflare y en `wrangler.jsonc`) | Si se borra antes de tener `studio` funcionando, te quedas sin Studio. Por eso se crea primero el nuevo |
| Worker de la experiencia | `escaparate` → `escaparate.mune-projects.workers.dev/<promoción>/`, vista previa `revision-escaparate…` | Worker nuevo `experience` → `experience.mune-projects.workers.dev/<promoción>/`, vista previa `revision-experience…` | Se construye desde el almacén `escaparate` (ramas `main` y `revision`) | Los enlaces antiguos dejan de funcionar al borrar el Worker antiguo (ver «URLs») |
| Worker del Portal | `portal` | Sin cambio | — | — |
| Almacén de GitHub | `MUNE-Projects/escaparate` | `MUNE-Projects/experience` | `publicar.yml` lo descarga y escribe en él. Cloudflare lo lee. Tus copias locales | GitHub redirige el nombre antiguo, pero se actualiza todo igualmente |
| Llave B | Secreto `ESCAPARATE_TOKEN` | Llave nueva y secreto `EXPERIENCE_TOKEN` | `publicar.yml` | Si se borra la antigua antes de crear la nueva, no se puede publicar |
| Llave B en el sistema | «Llave B · ESCAPARATE_TOKEN», caduca el 7/10/2027 | «Llave B · EXPERIENCE_TOKEN», con la fecha nueva | Inicio y Sistema de MUNE Studio, vigilancia | Solo afecta al aviso de caducidad |
| Funciones de Supabase | `ejecutar`, `invitar` y `avisar-promotora` solo aceptan llamadas desde `panel…`; usan las direcciones `escaparate…` | Aceptan `studio…`, y durante la transición también `panel…`. Usan `experience…` | Hay que volver a pegar las 3 funciones en Supabase | Si no se actualizan, el Studio nuevo no puede publicar, invitar ni avisar |
| Cabeceras de seguridad de Studio y Portal | Solo permiten leer de `escaparate…` | Permiten leer de `experience…` | `public/_headers` | Si faltan, el Studio no ve las versiones |
| Avisos por email | Enlaces a `panel…` y a `escaparate…` | `studio…` y `experience…` | Procesos de GitHub | Los emails antiguos ya enviados conservan sus enlaces |
| Carpeta del taller | `panel/` | `studio/` | Cloudflare (carpeta raíz), `aislamiento.yml`, documentación | Se hace a la vez que se crea el Worker `studio` |
| Carpeta de la experiencia | En la raíz del taller (`src/`, `index.html`, `vite.config.ts`) | `experience/` | `publicacion.mjs`, `planos.mjs`, procesos, documentación | Se prueba de principio a fin antes de proponerlo |
| Base de datos (SQL) | `panel/supabase/` | `supabase/`, en la raíz, porque la usan las tres capas | `aislamiento.yml`, documentación | Nada en Supabase: solo cambia dónde se guardan los archivos |
| «Studio de producción» (el editor 3D interno de la experiencia) | `src/studio/` y «Studio» | **Editor de MUNE Studio**, en `experience/src/editor/` | Solo construcción interna | Nada público. Evita tener dos cosas llamadas «Studio» |
| Herramientas | `publicacion.mjs --escaparate`, `../escaparate`, textos «escaparate» | `--experience`, `../experience` | Recetas 9 y 10, `publicar.yml` | Se cambia todo junto |
| Procesos de GitHub | «Publicar desde el Panel», variables `PANEL`, pasos «Escaparate» | «Publicar desde MUNE Studio», `STUDIO`, «Experience» | — | — |
| Código | `ESCAPARATE`, `VITE_ESCAPARATE`, `REVISION_ESCAPARATE`, `ESCAPARATE_URL`, la clase `Panel` del cajón *Personalizar* | `EXPERIENCE`, `VITE_EXPERIENCE`, `EXPERIENCE_REVISION`, `EXPERIENCE_URL`, `Cajon` | — | — |
| Memoria del navegador | Claves `inmobiliarias:…` (nombre antiguo del producto) | `mune:…` | Experiencia | Se pierde lo guardado en el navegador. Hoy no hay compradores reales |
| Código del móvil (2FA) | Emisor «MUNE Panel» | «MUNE Studio» | Tu app de verificación | Ver más abajo: **no se cambia a ciegas** |
| Textos visibles | «MUNE Panel» en la entrada con el móvil | «MUNE Studio» | — | Ver 2FA |
| Documentación | `CLAUDE.md`, `README`, `docs/`, recetas y comentarios | Todo con los nombres nuevos | — | — |
| Nombre del proyecto en Supabase | `mune-inmobiliarias` | Opcional: `mune`. Es solo un nombre visible; la dirección no cambia | — | Nada |

**Lo que no se puede cambiar, y por qué:**

- **Lo que ya ha pasado queda como está:**
  - el registro de versiones (`publicaciones.json`, que solo escribe el ejecutor);
  - el registro de actividad de la base de datos (no se puede editar, por diseño);
  - los avisos de GitHub ya cerrados;
  - los emails ya enviados;
  - el historial de Git y sus etiquetas.

  Son registros: cambiarlos sería falsear la historia.
- **«Panel tapizado de pared»** en la biblioteca de muebles es el nombre real de un mueble. No es el producto.
- **El almacén `taller`** no está en la lista de nombres. Recomiendo dejarlo así: renombrarlo obligaría a rehacer la llave A y a cambiar la conexión de Cloudflare y de Claude sin ganar claridad. Si quieres, se puede hacer en otro momento.
- **Las direcciones `*.workers.dev`** son temporales hasta que haya dominio propio. Con dominio (decisión con coste, más adelante) serían `studio.`, `portal.` y una dirección por promoción.

### Cambios de URLs

| Hoy | Después |
|---|---|
| https://panel.mune-projects.workers.dev | https://studio.mune-projects.workers.dev |
| https://revision-panel.mune-projects.workers.dev | https://revision-studio.mune-projects.workers.dev |
| https://escaparate.mune-projects.workers.dev/residencial-demo/ | https://experience.mune-projects.workers.dev/residencial-demo/ |
| https://revision-escaparate.mune-projects.workers.dev/residencial-demo/ | https://revision-experience.mune-projects.workers.dev/residencial-demo/ |
| https://portal.mune-projects.workers.dev | Sin cambio |

**Redirecciones:** recomiendo **no** hacerlas. Los Workers antiguos se mantienen una semana sin tocar (siguen funcionando, por si hay que volver atrás) y después se borran.

Hoy no hay clientes ni compradores reales: los únicos enlaces antiguos están en tus favoritos, en emails de prueba y en la demo. Si prefieres redirecciones, se pueden dejar en los Workers antiguos durante un tiempo, pero hay que mantener dos Workers más.

### Código del móvil (2FA): qué pasa al cambiar «MUNE Panel»

- El emisor es solo **la etiqueta** que tu app del móvil guarda al escanear el código QR. **No cambia el código** ni la seguridad.
- Si solo se cambia en el programa, tu app seguirá mostrando «MUNE Panel» (seguiría funcionando) y la pantalla diría «MUNE Studio»: sería confuso.

**Migración segura:**

1. En *Sistema* de MUNE Studio aparece el botón **«Actualizar el nombre en la app del móvil»**.
2. Muestra un código QR nuevo, con el nombre «MUNE Studio».
3. Lo escaneas y escribes el código de 6 cifras que aparece en la entrada nueva.
4. Solo si ese código es correcto, MUNE Studio activa la entrada nueva y retira la antigua.
5. Borras «MUNE Panel» de tu app.

Si algo falla a mitad, la entrada antigua sigue funcionando, así que no hay riesgo de quedarte fuera. Hasta que lo hagas, la pantalla de entrada dirá «MUNE Studio (antes MUNE Panel)».

### Orden de ejecución

Primero se prepara todo sin que cambie nada visible (propuesta del taller y cambio preparado en el almacén de la experiencia). Después, el día del cambio:

1. **GitHub:** renombras el almacén `escaparate` a `experience` (Settings → Repository name).
2. Subo al almacén `experience` el cambio de nombre de su configuración (`wrangler.jsonc`: `experience`) en `main` y en `revision`.
3. **Cloudflare:** creas el Worker `experience` conectado a ese almacén. Comprobamos la dirección nueva y su vista previa.
4. **GitHub:** apruebas la propuesta del taller con todo el renombrado.
5. **Cloudflare:** creas el Worker `studio`, conectado al taller y con carpeta raíz `studio`.
6. **Supabase:**
   - pegas las 3 funciones nuevas (`ejecutar`, `invitar` y `avisar-promotora`);
   - pegas el SQL `017_nombres.sql`, que actualiza la llave B y los textos de sistema.
7. **GitHub:** creas la llave B nueva (*Contents: read/write* solo sobre `experience`), la guardas como `EXPERIENCE_TOKEN`, borras `ESCAPARATE_TOKEN` y revocas la llave antigua. La fecha nueva se apunta en *Sistema → Ya la he renovado*.
8. **2FA:** en el Studio nuevo pulsas «Actualizar el nombre en la app del móvil».
9. **Prueba real:** publicas de nuevo la v8 de la demo, que es idéntica, y vuelves a la v7. Así se comprueba todo el circuito: Studio, `ejecutar`, GitHub, `experience` y Cloudflare.
10. **Una semana después:** se borran los Workers `panel` y `escaparate`, y una propuesta pequeña quita las direcciones antiguas de las funciones.

Si algo falla en los pasos 3 a 9, la vuelta atrás es inmediata: los Workers antiguos siguen funcionando.

### Cómo se prueba antes de proponerlo

- Compilar el Studio, el Portal y la experiencia con las carpetas nuevas.
- Prueba de aislamiento completa en GitHub.
- `preparar` sobre una copia, con el almacén `experience` local, y generación de planos.
- El Studio con datos simulados en Playwright: versiones, compradores y enlaces.
- Buscar en todo el taller «panel» y «escaparate»: solo deben quedar los registros históricos y el mueble.

---

## B · Quitar el acceso profesional y llevar sus funciones a MUNE Portal

### Estado actual

- **El acceso profesional abre dos cosas:**
  - **Render HD**: imágenes de alta calidad generadas en el navegador, con la escena en 3D;
  - el **selector de plano**: PDF A3 o PNG a 300 ppp.
- **Cómo se comprueba el código:** la experiencia compara la huella del código de la promotora con `promotora.acceso`, que va **dentro de los archivos públicos**.
  - No hay límite de intentos: alguien con conocimientos podría probar códigos sin parar.
  - La comprobación ocurre solo en el navegador: se puede saltar sin código.
- **Dónde se guarda:** el código queda en la memoria del navegador indefinidamente.
- **El mismo botón abre también el editor interno.** Solo en la construcción interna, que nunca se publica.

### Arquitectura propuesta

**Planos (PDF y PNG a 300 ppp): directamente desde MUNE Portal.**

- `herramientas/planos.mjs` ya genera el PDF de cada plano al preparar cada versión. Generará también el PNG a 300 ppp.
- Los dos se suben al almacén privado `entregables` al pulsar *Enviar los planos a la promotora*.
- En el Portal, en *Planos*, aparecen «Descargar PDF» y «Descargar PNG».
- No necesita la experiencia.

**Render HD: desde MUNE Portal, con un pase de un solo uso.**

1. En el Portal, la pestaña *Materiales* tiene el botón «Abrir la experiencia para crear imágenes», con la versión publicada o la de revisión.
2. Al pulsarlo, el Portal pide a Supabase un **pase** con la función nueva `crear_pase(promocion)`. Solo funciona si la persona tiene sesión y la capacidad `materiales` en esa promoción.
3. El pase cumple estas condiciones:
   - es un número aleatorio largo;
   - caduca a los 2 minutos;
   - sirve una sola vez;
   - está ligado a esa persona y a esa promoción;
   - en la base de datos se guarda solo su huella.
4. El Portal abre la experiencia con el pase en la parte de la dirección que nunca viaja a ningún servidor (tras `#`).
5. La experiencia lo canjea al momento con `canjear_pase`, que tiene límite de intentos como los códigos de comprador, y lo borra de la dirección.
6. Si es válido, activa Render HD en esa pestaña y durante esa sesión. No se guarda en la memoria permanente del navegador.
7. Cada pase queda en el registro, con quién lo pidió y cuándo.

**Por qué un pase y no la sesión del Portal:** la sesión de la persona nunca sale del Portal. El pase solo permite activar Render HD en esa promoción, durante esa sesión. No da acceso a la cuenta, a los documentos ni a los compradores.

### Cómo se garantiza que solo lo use quien debe

- **El plano en PNG queda realmente protegido:** está en un almacén privado de Supabase y solo se descarga con sesión y capacidad.
  - De todas formas, es el mismo plano que cualquier visitante puede descargar en PDF.
- **Render HD:** el botón solo aparece con un pase válido emitido a una persona autorizada, y cada uso queda registrado.
  - **Seré claro con el límite:** Render HD se calcula en el navegador a partir de la escena 3D, que es pública. Una persona con conocimientos técnicos podría reproducir una imagen parecida sin el botón.
  - Lo que se protege es el acceso cómodo, el registro de quién lo usa y que no haya ninguna llave en los archivos públicos.
  - La única forma de impedirlo del todo sería generar las imágenes en un servidor con GPU, que tiene coste y queda fuera de esta propuesta.

### Qué pasa con lo actual

- **Se quitan de la experiencia pública:**
  - el botón «Acceso profesional», su ventana y la etiqueta «Promotora · Salir»;
  - los enlaces `#promotora-…` y `#studio-…`.
- **Se quitan de los datos:**
  - la huella `promotora.acceso`;
  - la huella `studio.acceso`, que ya no hace falta.
- **Al cargar, la experiencia borra** el código que pudiera quedar guardado en el navegador.
- **El editor interno** se abre directamente en la construcción interna (`npm run studio`), sin código: esa construcción nunca se publica.
- **Códigos y huellas existentes:** solo existen los de la demo. Dejan de funcionar y no hay nada que migrar. También se borran los códigos de demo escritos en `docs/arquitectura-studio.md`.

### Archivos y sistemas afectados

- **Experiencia:** `index.html`, `src/main.ts`, `src/promocion/promocion.ts` y `src/estilos.css`.
- **Datos y herramientas:** `promocion.json`, `src/documento/lote.ts` y `herramientas/planos.mjs` (PNG a 300 ppp).
- **Studio:** `studio/src/planos.ts` (subir también el PNG).
- **Portal:** `portal/src/planos.ts` (descargar PNG) y la pestaña nueva *Materiales*.
- **SQL nuevo:**
  - tabla `pases` (huella, persona, promoción, caducidad, usado);
  - funciones `crear_pase` y `canjear_pase`;
  - límite de intentos.
- **Cloudflare:** ninguno. **GitHub:** ninguno.
- **Coste:** ninguno. Espacio: un PNG A3 de un plano ocupa unos 1–3 MB. Con el plan gratuito de Supabase (1 GB) caben cientos de planos. El Studio ya avisa al acercarse al límite.

### Riesgos y pruebas

- **Riesgos:**
  - un pase podría interceptarse en los 2 minutos de vida, pero sirve una sola vez y solo para Render HD;
  - si se bloquean las ventanas emergentes, el Portal muestra el enlace para abrirlo a mano.
- **Pruebas:**
  - **Aislamiento:**
    - sin capacidad no se obtiene un pase;
    - un pase de otra promoción no sirve;
    - un pase usado o caducado no sirve;
    - hay límite de intentos.
  - **Playwright:** el circuito Portal → experiencia → Render HD.
  - Que en los archivos públicos no quede «Acceso profesional» ni ninguna huella. La herramienta de publicación lo comprobará en cada versión.

---

## C · Separar los datos públicos de los privados de personalización

### Qué viaja hoy en los archivos públicos

Todo va dentro del archivo principal de la experiencia. Cualquier visitante lo descarga, aunque no lo vea en pantalla.

| Dato | Hoy | Debe ser |
|---|---|---|
| Marca: colores, logos, tipografía, contacto de la oficina comercial, pie legal, texto legal de imágenes y del plano | Público | **Público** |
| Nombre y ubicación de la promoción | Público | **Público** |
| Geometría de cada tipología y variante, vistas y cámaras, mobiliario usado | Público | **Público** (hace falta para dibujar) |
| Acabados incluidos de serie (solo sus colores y materiales, para pintar la vivienda) | Público | **Público** (sin precio) |
| Plano comercial PDF de la vivienda pública | Público | **Público** |
| Precios de todas las mejoras | Público (oculto) | **Solo comprador** |
| Opciones de personalización no incluidas (nombres, detalles, materiales) | Público (oculto) | **Solo comprador** |
| Alternativas de distribución (cambios de geometría) | Público (oculto) | **Solo comprador** |
| Packs: títulos, descripciones, categorías y fechas de apertura y cierre | Público (oculto) | **Solo comprador** |
| Qué opciones admite cada tipología y cada vivienda | Público (oculto) | **Solo comprador** |
| Texto legal sobre precios | Público | **Solo comprador** |
| Lista de viviendas: referencias, portal, planta, superficies y orientación (también en `viviendas.json`) | Público | **Solo comprador** (cada uno, la suya) y equipo |
| Planos de todas las variantes y alternativas (`planos/`) y sus huellas | Público | **Equipo** (Portal y Studio); el comprador, solo los de su vivienda |
| Datos bancarios y contacto de formalización | Ya no son públicos | Solo comprador ✔ |
| Lo formalizado por cada comprador | Ya no es público | Solo comprador ✔ |
| Huella del código de promotora | Público | **Se elimina** (bloque B) |
| Versiones antiguas de la geometría (`versiones/`) | Público | **Interno** |
| Notas internas, procedencia de cada dato (`origen`, `fuente`), dirección de trabajo (`urlBase`) | Público | **Interno** |
| Biblioteca completa de muebles (54, también los no usados, con notas) | Público | **Público** solo lo usado; el resto, **interno** |
| Dirección de Supabase y clave *publishable* | Público | **Público**: es así por diseño, y las reglas de la base de datos la protegen |

### Arquitectura propuesta

1. **Sin código, la experiencia lleva solo lo público.** Al construirla, cada categoría queda solo con lo incluido de serie, sin precio. Desaparecen packs, opciones, alternativas, lista de viviendas, notas, procedencia, versiones antiguas y muebles no usados.
2. **Contenido del comprador, por versión, en Supabase.**
   - Tabla nueva `contenido_comprador (promocion, version, datos)`, sin acceso directo para nadie.
   - Guarda el catálogo con precios, los packs y sus fechas, las alternativas, las restricciones y las fichas de las viviendas.
3. **Al entrar con un código válido,** `entrar_comprador` devuelve, además de lo que ya devuelve, el contenido de **esa versión**, solo para **su vivienda**:
   - su ficha;
   - las opciones que le corresponden, con precios;
   - sus packs;
   - sus alternativas.
4. **Cómo llega ese contenido a Supabase sin claves nuevas:**
   1. `preparar` genera el archivo del comprador de la versión y lo guarda en el **taller** (privado), con la etiqueta de la versión. No va nunca a la experiencia, ni siquiera a la vista previa.
   2. La función `ejecutar` (la de Publicar) gana una acción, «cargar contenido». Solo la puede usar la administradora con el código del móvil. Lee ese archivo del taller con la llave A y lo guarda en Supabase.
   3. MUNE Studio la lanza solo al ver una versión nueva en revisión, y otra vez al publicar o al volver a una anterior.
   - **Único cambio de permisos:** la llave A gana *Contents: read* sobre el taller. Se edita la llave existente en GitHub: no cambia su valor ni su fecha.
5. **Planos:** se quitan de la experiencia publicada.
   - Durante la revisión, el Studio los recoge y los sube al almacén privado, como ahora.
   - El comprador descarga el plano de su vivienda, que la experiencia genera en su navegador como hoy.
6. **Studio y Portal** dejan de leer `viviendas.json` público: la lista de viviendas la sacan de Supabase.

### Cambios técnicos

- **Experiencia** (`vite.config.ts`, `promocion.ts`, `packs.ts`, `configurador.ts`, `main.ts`, `pdf.ts`):
  - aplicar los acabados de serie sin catálogo completo;
  - recibir catálogo, packs y alternativas tras el código, y reconstruir la vivienda;
  - el PDF usa los datos recibidos.
- **SQL nuevo:** tabla `contenido_comprador`, `entrar_comprador` ampliada y función de carga (solo administradora).
- **Función `ejecutar`:** acción «cargar contenido».
- **Herramientas:** `publicacion.mjs` (archivo del comprador y comprobación automática de que ningún precio, pack ni fecha llega a los archivos públicos) y `planos.mjs`.
- **Studio y Portal:** lista de viviendas desde Supabase.
- **Cloudflare:** ninguno.
- **GitHub:** ampliar la llave A con lectura del taller.

### Efecto en rendimiento, funcionamiento estático y arquitectura

- **Rendimiento:**
  - la experiencia pública pesa algo menos;
  - el comprador hace la misma llamada a Supabase que ya hace al entrar, con unos KB más.
- **Funcionamiento estático:** la experiencia pública sigue siendo solo archivos estáticos y **funciona aunque Supabase esté dormido**. La parte del comprador ya dependía de Supabase (por el código), así que no se añade ninguna dependencia nueva.
- **Volver a una versión anterior:** el contenido de cada versión se conserva en Supabase y se vuelve a cargar si faltara.

### Riesgos y pruebas

- **Riesgos:**
  - Si se publica una versión sin su contenido cargado, el comprador no puede personalizar. Por eso `ejecutar` no publica sin cargarlo antes.
  - La experiencia de la vista previa necesita el contenido de su versión: se carga al prepararla.
- **Pruebas:**
  - buscar precios, fechas, títulos de packs, notas y procedencia en los archivos publicados (prueba automática en cada `preparar`);
  - Playwright:
    - visitante sin código: vivienda con acabados de serie, idéntica a hoy;
    - comprador: catálogo, precios, packs, alternativas, histórico, formalizado y PDF, igual que hoy;
  - aislamiento: el contenido de una promoción no se obtiene con un código de otra, ni sin código.

**Se mantiene todo el flujo actual:**

- packs con sus estados: disponible, próximamente y finalizado;
- histórico de selección y lo formalizado, bloqueado;
- personalizar → PDF → descargar → firmar → transferir → enviar al comercial;
- MUNE no envía nada automáticamente.

---

## D · Permisos por capacidad en MUNE Portal

### Estado actual

- Cada persona tiene una o varias filas en `miembros`, con una promoción concreta o con todas las de su promotora (`promocion_id` vacío).
- **Quien tiene acceso puede hacerlo todo** en esa promoción. Además, cualquier miembro puede cambiar los datos fiscales de la empresa.
- Solo la administradora gestiona los equipos, desde MUNE Studio.
- Los avisos por email van a todo el equipo.

### Capacidades propuestas (lista mínima)

| Capacidad | Permite |
|---|---|
| `documentacion` | Ver los requisitos y subir y descargar documentos |
| `planos` | Ver y validar los planos de cada versión |
| `compradores` | Ver, crear y cambiar códigos de comprador |
| `personalizacion` | Contacto y datos bancarios de la formalización. En la Fase 2, también catálogo y packs |
| `materiales` | Descargar planos (PDF y PNG) y crear imágenes con Render HD (bloque B) |
| `datos` | Ficha de la promoción y sus datos fiscales |
| `equipo` | Invitar, cambiar y quitar personas de su equipo |
| `marca` | Se reserva para la Fase 2, cuando exista la pantalla de marca. Hasta entonces no hace nada |

- **Datos de la empresa** (razón social, CIF y domicilio): exigen `datos` **y** acceso a todas las promociones.
- **Lo que ve todo el equipo:** el nombre y el estado de la promoción y el resumen. El resto de pestañas solo aparecen con su capacidad.

### Pantallas

- **MUNE Studio, al invitar o editar a una persona** (*Equipo* de la promoción y *Acceso a todas las promociones* de la promotora):
  - casillas con las capacidades;
  - botón «Todas»;
  - en la lista, las capacidades de cada persona.
- **MUNE Portal, pestaña nueva *Equipo*** (solo con `equipo`): invitar, cambiar las capacidades y quitar personas.
- **Límites para quien gestiona el equipo:**
  - solo actúa dentro de su propio alcance;
  - **no puede dar capacidades que no tiene;**
  - solo da acceso a todas las promociones si él mismo lo tiene;
  - no puede tocarse a sí mismo.

### Acceso global frente a acceso a una promoción

- **Una fila con todas las promociones** se aplica a todas las de la promotora, también a las futuras, con sus capacidades.
- **Una fila con una promoción concreta** se aplica solo a esa.
- Si una persona tiene las dos, en esa promoción **se suman** sus capacidades.

### Base de datos y reglas de seguridad (RLS)

- **`miembros`:** columna nueva `capacidades text[]`, que solo admite las de la lista.
- **Funciones nuevas:**
  - `puede(promocion, capacidad)`: administradora, o miembro activo con esa capacidad en esa promoción o en todas;
  - `puede_en_promotora(promotora, capacidad)`, para los datos de la empresa.
- **Cambian a `puede(…)`:**
  - **Documentación:** las reglas de leer y subir documentos y requisitos, y su almacén privado.
  - **Planos:**
    - validaciones;
    - entregables y su almacén;
    - `planos_de_version`;
    - avisos de subida y validación.
  - **Compradores:** los códigos de comprador (crear, generar y listar) y las selecciones.
  - **Datos:** `guardar_ficha_promocion`, `guardar_datos_promocion` y `guardar_formalizacion`; y `guardar_datos_promotora`, con `puede_en_promotora`.
- **Ver la promoción** sigue con la regla actual (`es_miembro_de_promocion`).
- **Equipo:**
  - funciones nuevas para que un miembro con `equipo` gestione el suyo;
  - `invitar` acepta llamadas desde el Portal, con estos límites.
- **Avisos por email:**
  - planos para validar: a quien tiene `planos`;
  - documento por corregir: a quien tiene `documentacion`;
  - versión publicada: a todo el equipo.
- **Registro:** cada cambio de capacidades queda apuntado.
- **Prueba de aislamiento:** personas nuevas con capacidades parciales. Por ejemplo:
  - sin `planos` no valida;
  - sin `compradores` no ve códigos;
  - con `equipo` no puede darse más de lo que tiene.

### Migración sin romper nada

- **Las personas que ya tienen acceso reciben todas las capacidades que equivalen a lo que ya podían hacer:** documentación, planos, compradores, personalización, materiales y datos.
- **No reciben `equipo`**, porque hoy nadie de la promotora gestiona equipos: sería darles un poder nuevo sin decidirlo.
- `marca` se reserva hasta la Fase 2.
- **Una excepción, para corregirla:** los datos de la empresa pasan a exigir acceso a todas las promociones. Quien solo tenga una promoción dejará de poder cambiarlos.
- Hoy solo hay personas de prueba, pero la migración está pensada como si hubiera clientes. Después, en el alta de cada cliente, decides las capacidades de cada persona.
- **Si te lo preguntas:** sí, durante la transición todo el que tiene acceso conserva todo lo que ya podía hacer, y nada más.

### Archivos y sistemas

- **SQL:** `018_capacidades.sql`.
- **Funciones:**
  - `invitar` (capacidades y llamada desde el Portal);
  - `avisar-promotora` (destinatarios por capacidad).
- **MUNE Studio:** `promotoras.ts`.
- **MUNE Portal:**
  - `main.ts`: pestañas según capacidades, pestaña *Equipo* y lectura de varias filas de acceso;
  - `planos.ts` y `compradores.ts`.
- **Prueba de aislamiento.**
- **Cloudflare:** ninguno. **GitHub:** ninguno. **Coste:** ninguno.

### Riesgos

- **Que una regla quede sin cambiar:** una persona sin capacidad podría seguir haciendo algo. La prueba de aislamiento comprueba cada capacidad por separado.
- **Que el Portal oculte una pestaña pero la regla lo permita, o al revés:** la seguridad real está en la base de datos; el Portal solo refleja lo que permite.

---

## 5 · Texto del comprador (ya aplicado)

- **Bienvenida:** «Te damos la bienvenida. Estás viendo tu vivienda {ref}. Pulsa Personalizar para ver las opciones disponibles para tu vivienda.»
- **Descripción de la página** (la que muestran los buscadores y al compartir el enlace) por el mismo motivo: «…y, con tu código, las opciones de personalización de tu vivienda.»

## 8 · Packs

Sin cambios. La evolución hacia fases o grupos configurables se revisará aparte.
