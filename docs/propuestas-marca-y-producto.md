# Arquitectura de MUNE: propuesta técnica (versión 2)

**Fecha:** 10/10/2026. Sustituye a la versión 1 de este documento.

**Estado:** nada está aplicado. Esta propuesta espera el OK de la administradora antes de empezar.

**De dónde sale:** recoge las decisiones de la administradora sobre:

- la arquitectura Studio / Portal / Experience;
- el repositorio `taller`, que pasa a llamarse `studio`;
- la Experiencia 3D dentro de MUNE Portal;
- la autorización profesional sin límite de uso;
- los administradores de MUNE Portal;
- las capacidades;
- varios aprobadores por plano.

## Índice

1. Arquitectura final
2. GitHub y Cloudflare
3. Cambiar el nombre de taller a studio
4. MUNE Experience dentro de MUNE Portal
5. Acceso profesional desde MUNE Portal y Render HD
6. El primer administrador de una promotora
7. El administrador gestiona su equipo
8. Capacidades
9. Administrador: un nivel, no una capacidad
10. Varios aprobadores por plano
11. Base de datos y reglas de seguridad
12. Migración del estado actual
13. Riesgos
14. Orden de implementación
15. Pruebas manuales
16. Bloque C: datos privados

---

## 1. Arquitectura final

| Capa | Qué es | Quién la usa |
|---|---|---|
| **MUNE Projects** | La empresa | — |
| **MUNE** | La plataforma y la marca comercial | — |
| **MUNE Studio** | Todo el lado interno, donde MUNE se construye, produce, administra y opera | MUNE Projects y Claude |
| **MUNE Portal** | El espacio de trabajo de la empresa cliente | El equipo de cada promotora |
| **MUNE Experience** | La experiencia 3D, la misma para todos | Visitantes, compradores y equipo de la promotora |

### MUNE Studio

MUNE Studio reúne todo el lado interno:

- el repositorio privado `studio`;
- la **aplicación de MUNE Studio**, la interfaz operativa (antes «Panel»);
- el **Editor 3D**;
- las herramientas de producción y de publicación;
- las automatizaciones de GitHub;
- la base de datos (Supabase), con sus funciones;
- los datos de cada promoción;
- la documentación y las recetas;
- Claude.

### MUNE Experience

MUNE Experience es **una sola experiencia 3D** que se usa en tres contextos:

| Contexto | Cómo entra | Qué ve |
|---|---|---|
| Visitante | Dirección pública de la promoción | La experiencia pública |
| Comprador | La misma dirección, con su código | Además, su vivienda, su personalización, su histórico y su formalización |
| Equipo de la promotora | Desde MUNE Portal, sección *Experiencia 3D* | La misma experiencia, con las herramientas profesionales que le permitan sus capacidades |

**No hay un segundo visor 3D.** El Portal muestra exactamente la misma experiencia que verá el público.

---

## 2. GitHub y Cloudflare

### GitHub

| Repositorio | Hoy | Después | Contenido |
|---|---|---|---|
| Lado interno | `MUNE-Projects/taller` | **`MUNE-Projects/studio`** | Todo MUNE Studio, el código de MUNE Portal y el motor de MUNE Experience |
| Lo publicado | `MUNE-Projects/escaparate` | **`MUNE-Projects/experience`** | Solo la Experience construida de cada promoción. `main` = producción y `revision` = vista previa |

Carpetas del repositorio `studio`:

```
studio/
  app/           aplicación de MUNE Studio (antes panel/)          → Worker «studio»
  portal/        MUNE Portal                                       → Worker «portal»
  experience/    motor de MUNE Experience (antes en la raíz: src/, index.html…)
  editor/        Editor 3D (antes src/studio/); usa el motor de experience/
  supabase/      base de datos, funciones, plantillas de email y prueba de aislamiento
                 (antes panel/supabase y panel/pruebas: la usan las tres capas)
  herramientas/  preparar, publicar, planos, documentos, peticiones
  promociones/   datos de cada promoción
  biblioteca/    muebles y objetos 3D reutilizables
  docs/          arquitectura, recetas
  .github/       automatizaciones
```

Notas sobre las carpetas:

- `herramientas/`, `promociones/`, `biblioteca/` y `docs/` son palabras en castellano, no nombres de producto, así que no crean equivalencias que haya que recordar. Si prefieres `tools/`, el cambio es igual de sencillo.
- La carpeta de la aplicación se llama `app/`, y no `studio/`, para no tener `studio/studio/`. En pantalla y en la dirección se llama **MUNE Studio**.

### Cloudflare (3 Workers)

| Worker | Dirección | Se construye desde | Vista previa |
|---|---|---|---|
| `studio` | https://studio.mune-projects.workers.dev | repo `studio`, carpeta `app/` | https://revision-studio.mune-projects.workers.dev |
| `portal` | https://portal.mune-projects.workers.dev (sin cambio) | repo `studio`, carpeta `portal/` | https://revision-portal.mune-projects.workers.dev |
| `experience` | https://experience.mune-projects.workers.dev/<promoción>/ | repo `experience` | https://revision-experience.mune-projects.workers.dev/<promoción>/ |

Los Workers `panel` y `escaparate` se mantienen una semana sin tocar, por si hay que volver atrás, y después se borran. No hay redirecciones: hoy no hay clientes ni compradores reales.

### Supabase

- Mismo proyecto y misma dirección.
- Opcional: cambiar el nombre visible `mune-inmobiliarias` por `mune`. No afecta a nada.

---

## 3. Cambiar el nombre de taller a studio

**Recomendación: sí.** Se hace en la misma migración de nombres, sin una llave nueva, y el riesgo es bajo.

### Qué depende hoy de «taller»

| Conexión | Qué pasa al cambiar el nombre | Qué hay que hacer |
|---|---|---|
| Worker `panel` de Cloudflare | Se sustituye por el Worker nuevo `studio` | Crearlo conectado a `studio` |
| Worker `portal` de Cloudflare | Sigue sirviendo lo último publicado. Su conexión con GitHub puede necesitar reconectarse | Comprobarla. Si falla, *Settings → Build → Disconnect* y conectar `MUNE-Projects/studio` |
| Llave A (`GITHUB_EJECUTOR`, *Actions: read/write*) | **Sigue funcionando**: GitHub une las llaves al repositorio, no a su nombre | Nada. No hay que renovarla |
| Funciones `ejecutar`, `aviso-subida` y `avisar-promotora` | Llaman a `repos/MUNE-Projects/taller/...` | Cambiar la dirección a `studio` y pegarlas de nuevo |
| Secretos del repositorio (`ESCAPARATE_TOKEN`, `AVISOS_GMAIL_CLAVE`) | Se conservan: son del mismo repositorio | `ESCAPARATE_TOKEN` se sustituye por `EXPERIENCE_TOKEN` (ver abajo) |
| Procesos de GitHub (publicar, avisos, vigilancia, aislamiento) | Usan el repositorio actual automáticamente | Solo cambian nombres internos (`path: taller` pasa a `studio`) |
| `version.json` de cada versión publicada (campo `taller`) | Las versiones antiguas conservan el campo | Las nuevas usan `studio` y el código lee los dos |
| Sesiones de Claude | Las nuevas eligen `MUNE-Projects/studio` | Nada. El acceso de Claude sigue al repositorio |
| Copias locales, enlaces antiguos, avisos y emails de GitHub | GitHub redirige el nombre antiguo | Nada |
| Textos, comentarios y documentación (18 archivos con «taller») | — | Se cambian todos |

### Llaves

- **Llave A:** no se renueva.
- **Llave B:** sí se renueva, pero por el cambio de `escaparate` a `experience`, no por el de `taller`. GitHub no deja leer el valor de un secreto para guardarlo con otro nombre, así que hay que crear una llave nueva, `EXPERIENCE_TOKEN`, con *Contents: read/write* solo sobre `experience`.

### Riesgo real

El único punto delicado es la conexión del Worker `portal` con GitHub. Si se rompe, el Portal **sigue funcionando** con lo último publicado. Solo dejarían de llegar las actualizaciones hasta reconectarlo, lo que lleva un minuto.

### Lo que no cambia

Se queda como está lo que es registro histórico:

- el registro de versiones (`publicaciones.json`, campo `taller`);
- el registro de actividad;
- las etiquetas de Git;
- los avisos y emails antiguos.

---

## 4. MUNE Experience dentro de MUNE Portal

### Recomendación: integrada dentro del Portal

Cada promoción del Portal tendrá una sección nueva, **Experiencia 3D**, con la Experience integrada en la página. Sus controles:

- **Versión:** *Publicada (v7)* o *En revisión (v8)*, cuando exista.
- **Vivienda:** todas las tipologías, variantes y viviendas de la promoción.
- **Pantalla completa:** la Experience ocupa toda la pantalla sin salir del Portal. Se vuelve con *Esc*.

Dentro de la Experiencia funciona todo lo que tiene Experience: vistas guiadas (salón, comedor, dormitorios, baños, exteriores…), navegación libre, modo Plano y personalización. A eso se suman las **herramientas profesionales**:

- **Render HD**, sin límites;
- **plano comercial** en PDF A3 o PNG a 300 ppp.

La persona **no sale del Portal ni vuelve a identificarse.**

Los **planos validados** (los archivos oficiales de cada versión) siguen en la sección *Planos*. Allí se añade «Descargar PNG».

### Por qué integrada y no en otra pestaña

- Se siente como una función del Portal.
- El Portal habla directamente con la Experience que tiene dentro, sin pases en la dirección ni pestañas que se pierdan.
- La sesión de la persona nunca sale del Portal.

### Lo que hay que añadir para que sea seguro

- **La Experience solo se deja integrar en MUNE Portal y en MUNE Studio.** Se añade una cabecera de seguridad que lo impone (`frame-ancestors`). Así también se impide que otra web la meta dentro de la suya.
- **La Experience solo acepta mensajes de esas dos direcciones exactas.** Comprueba el origen de cada mensaje.

### MUNE Studio usa lo mismo

La aplicación de MUNE Studio usará el mismo mecanismo para que tú veas la Experiencia con las herramientas profesionales, como soporte.

### Si un equipo concreto diera problemas

Si un navegador o un equipo muy antiguo no pudiera con la Experiencia integrada, el Portal ofrece «Abrir en una pestaña nueva». Funciona igual: el Portal abre la pestaña y le habla de la misma forma.

---

## 5. Acceso profesional desde MUNE Portal y Render HD

### Cómo funciona

1. La persona entra en MUNE Portal como siempre y abre **Experiencia 3D**.
2. El Portal carga la Experience dentro de la página y le envía, mediante un mensaje directo entre las dos páginas, el **contexto profesional**:
   - promoción y versión;
   - viviendas que puede mostrar;
   - qué herramientas le permiten sus capacidades. Por ejemplo, Render HD si tiene `materiales`.
3. La Experience comprueba que el mensaje viene **exactamente** de MUNE Portal y activa las herramientas.
4. **Es ilimitado:** genera todos los renders que quiera y trabaja todo el tiempo que quiera.
5. **Cuándo termina:** al cerrar la Experiencia o al cerrarse la sesión del Portal, al salir o tras 60 minutos sin actividad, como hoy. El Portal retira la Experiencia y el modo profesional termina.
6. **Otro día:** entra en el Portal y vuelve a abrir Experiencia 3D. Todo se activa solo.

### Qué cambia respecto a la versión 1

**Ya no hace falta el pase de 2 minutos.** Al estar la Experience dentro del Portal, el propio Portal le pasa el contexto directamente. No hay nada en la dirección ni nada que caduque.

La persona:

- no ve ningún código;
- no escribe ningún código;
- no tiene ningún límite de tiempo ni de renders.

En la documentación se llamará **«acceso profesional desde MUNE Portal»**.

### Cuánto dura la autorización

La opción más segura y sencilla es que dure **mientras la Experiencia esté abierta dentro de una sesión de Portal**:

- No se guarda nada en el navegador.
- Si se retira a una persona del equipo, la próxima vez que entre ya no tendrá acceso.

### Qué está protegido de verdad

| Qué | Protección |
|---|---|
| Planos validados en PDF y PNG, y lo que en el futuro sea privado (catálogo con precios, entregables) | **Total.** Los entrega el Portal con la sesión de la persona y las reglas de la base de datos |
| Botón Render HD | Solo aparece en el Portal, para personas con la capacidad `materiales`, y cada uso queda registrado |
| Archivos públicos de la Experience | **Sin llaves ni huellas.** Desaparece el código de promotora |

Hay un límite que conviene que conozcas. Render HD se calcula en el navegador a partir de la escena 3D, que ya es pública. Una persona con conocimientos técnicos podría sacar una imagen parecida sin el botón. Impedirlo del todo exigiría generar las imágenes en un servidor con GPU, que tiene coste. No lo propongo.

### Registro

El Portal apunta en el registro de actividad:

- cuándo alguien abre la Experiencia profesional;
- cada Render HD descargado.

### Qué desaparece de la Experience pública

- el botón «Acceso profesional», su ventana y la etiqueta «Promotora · Salir»;
- los enlaces `#promotora-…` y `#studio-…`;
- las huellas `promotora.acceso` y `studio.acceso`;
- el código guardado en el navegador, que se borra al cargar.

Los códigos existentes son solo de la demo: dejan de funcionar y no hay nada que migrar.

El **Editor 3D** se abre directamente en la construcción interna de MUNE Studio, que nunca se publica, sin código.

---

## 6. El primer administrador de una promotora

**Alta en MUNE Studio** (*Promotoras → Nueva promotora*):

1. Datos de la empresa.
2. **Administradores de MUNE Portal:** uno o varios, con nombre y email.
3. *Dar de alta*.

Cada administrador recibe el email de invitación de siempre: «Tu acceso a MUNE Portal», con el botón «Elegir mi contraseña y entrar».

**Qué recibe el administrador al empezar:**

- acceso a todas las promociones de su empresa;
- todas las capacidades de trabajo.

Una empresa pequeña puede empezar a trabajar sin configurar nada. Él mismo puede reducirlas después.

**Las promociones** las sigue creando MUNE Projects desde Studio, como hoy (receta 1).

---

## 7. El administrador gestiona su equipo

En MUNE Portal, solo los administradores ven una sección nueva, **Equipo**:

- **Invitar** a una persona: nombre, email y cargo (opcional, solo informativo).
- **Acceso a promociones:** *Todas* (también las futuras) o las que elija.
- **Capacidades:** casillas por persona y acceso, con un botón «Todas».
- **Aprobadores de planos:** por promoción, quién tiene que aprobar (punto 10).
- **Nombrar administrador** a otra persona.
- **Retirar** a una persona, que pierde el acceso al momento, y devolver el acceso.
- **Reenviar la invitación.**
- Ver el estado de cada persona: invitación pendiente, aceptada y última entrada.

**Reglas que garantiza la base de datos** (no solo la pantalla):

- Un administrador solo gestiona personas de **su** empresa.
- Siempre queda **al menos un administrador activo**: no se puede retirar ni degradar al último.
- Una persona solo pertenece a una empresa, como hoy.
- Cada cambio queda en el registro: quién lo hizo, a quién y qué cambió.

**MUNE Studio conserva el control superior.** Desde Studio puedes hacer todo lo anterior en cualquier empresa, como soporte, y queda registrado como «MUNE». En el día a día no hace falta.

---

## 8. Capacidades

| Capacidad | Permite |
|---|---|
| `documentacion` | Ver los requisitos, subir documentos y descargarlos |
| `planos` | Ver los planos de cada versión. Aprobar o pedir cambios si es aprobador (o si no hay aprobadores definidos) |
| `compradores` | Ver, crear y cambiar los códigos de comprador |
| `personalizacion` | Contacto y datos bancarios de la formalización. En la Fase 2, también catálogo y packs |
| `materiales` | Herramientas profesionales de la Experiencia 3D (Render HD, plano en PDF o PNG) y descarga de materiales |
| `datos` | Ficha de la promoción y sus datos fiscales |
| `marca` | Reservada para la Fase 2. Hasta entonces no hace nada |

**Lo que ve cualquier persona con acceso a una promoción, sin capacidad específica:**

- el resumen;
- la Experiencia 3D, publicada y en revisión, en modo de visita.

Las herramientas profesionales de la Experiencia dependen de `materiales`.

**Reglas de alcance:**

- **Datos de la empresa** (razón social, CIF y domicilio): solo administradores.
- **Una persona con acceso a «todas» y además a una promoción concreta:** en esa promoción se suman sus capacidades.

---

## 9. Administrador: un nivel, no una capacidad

**Recomendación: «Administrador de MUNE Portal» es un nivel distinto, no una capacidad más.**

- **Actúa sobre otra cosa.** Las capacidades son trabajo dentro de una promoción. La administración es gobierno de la empresa entera: personas, accesos y aprobadores.
- **Su alcance es otro.** Una capacidad se da por promoción. El administrador lo es de toda la empresa.
- **Necesita sus propias protecciones.** Nunca quedarse sin administradores, y que nadie se dé a sí mismo más poder del que tiene.
- **Es fácil de identificar.** En Equipo se ve quién administra.

**Por tanto, «equipo» deja de ser una capacidad.** Un administrador puede tener además las capacidades de trabajo que quiera, y puede asignárselas.

---

## 10. Varios aprobadores por plano

### Dos conceptos separados

- **Capacidad `planos`:** quién puede acceder a los planos y revisarlos.
- **Aprobador requerido:** quién tiene que aprobar para que un plano se considere validado. Lo configura cada promotora en *Equipo → Aprobadores de planos*, por promoción. Solo pueden ser aprobadores personas con `planos` en esa promoción.

### Reglas

1. **Plano completamente aprobado:** cuando **todos** los aprobadores requeridos lo han aprobado.
2. **Si una promoción no tiene aprobadores definidos:** basta una aprobación de cualquier persona con `planos`, igual que hoy. La pantalla lo indica: «Sin aprobadores definidos: basta una aprobación».
3. **Quién pide cambios:** cualquier aprobador requerido puede pedir cambios, con comentario obligatorio. El plano queda en **«Cambios pedidos»**, y la versión no se puede publicar hasta que MUNE prepare una versión nueva con el plano corregido.
4. **Cambiar de opinión:** mientras el plano no esté completamente aprobado, un aprobador puede cambiar su decisión. Queda todo el historial.
5. **Si cambia la lista de aprobadores:** solo afecta a los planos pendientes. Un plano ya completamente aprobado sigue aprobado, porque se guarda una «foto» de quién lo aprobó y cuándo.
6. **Si un aprobador pierde el acceso o la capacidad:** deja de ser requerido en los planos pendientes. Sus decisiones anteriores se conservan en el historial.
7. **Publicar:** solo con **todos** los planos de la versión completamente aprobados (la regla actual).

### Lo que se ve

```
Validación de plano · Tipología A · v8

Ana García      ✓ Aprobado · 12/10/2026
Carlos Pérez    ○ Pendiente

1 de 2 aprobaciones
```

Con cambios pedidos:

```
Carlos Pérez    ✎ Pide cambios · 13/10/2026
                «La cota del dormitorio 2 no coincide con la memoria»
```

### Planos que no cambian entre versiones

La huella de los datos del dibujo ya existe: si el dibujo es idéntico, el plano no ha cambiado.

| Situación en la versión anterior | Plano igual en la versión nueva | Plano distinto |
|---|---|---|
| Completamente aprobado | **Sigue aprobado**: «Aprobado en v7, sin cambios», con la foto de quién lo aprobó | Todos vuelven a aprobar |
| Parcialmente aprobado | **Se conservan las decisiones** ya tomadas. Solo faltan los pendientes | Todos vuelven a aprobar |
| Con cambios pedidos | Sigue con cambios pedidos: el dibujo no se ha corregido | Todos vuelven a aprobar |

### Trazabilidad

Se guarda cada decisión con:

- persona;
- decisión (aprobado o cambios);
- comentario;
- fecha y hora;
- versión;
- huella del archivo exacto.

La foto de la aprobación completa guarda quién aprobó, cuándo y bajo qué lista de aprobadores. Nada se borra.

### Avisos por email

- **«Planos para validar»:** va a los aprobadores requeridos, o a quien tenga `planos` si no hay aprobadores definidos.
- **El aviso que te llega a ti:** muestra el avance, por ejemplo «1 de 2».

### Reutilizable en el futuro, sin construirlo ahora

- Los aprobadores se guardan por **tipo de elemento**. Hoy solo existe `plano`.
- Las decisiones se guardan sobre un **elemento** genérico. Hoy, los entregables de tipo plano.

Para aprobar en el futuro otro tipo de elemento (un catálogo, un documento…), se añade ese tipo y se reutilizan las mismas tablas y funciones. **Ahora solo se implementa para planos.**

---

## 11. Base de datos y reglas de seguridad

Todo va en un archivo, `018_equipos_y_aprobaciones.sql`.

### Tablas

| Tabla | Hoy | Después |
|---|---|---|
| `miembros` | Una fila por persona, empresa y promoción (o todas) | **Persona en su empresa**: una fila por persona, con `administrador` (sí/no), nombre, email, cargo y activo |
| `accesos` | — | **Nueva.** Persona + promoción (o *todas*) + `capacidades` |
| `aprobadores` | — | **Nueva.** Promoción + tipo (`plano`) + persona |
| `validaciones` | Una decisión por plano | **Varias por plano:** una por persona, con su historial |
| `aprobaciones` | — | **Nueva.** La «foto» de cada aprobación completa: elemento, fecha, quién aprobó y lista de aprobadores |

### Funciones de comprobación

- `es_admin_portal(promotora)`: el administrador de MUNE Portal de esa empresa.
- `puede(promocion, capacidad)`: la administradora de MUNE Studio, o una persona activa con esa capacidad en esa promoción o en todas.
- `ve_promocion(promocion)`: tiene algún acceso a la promoción o es administrador de su empresa.

### Reglas que cambian

| Área | Antes | Después |
|---|---|---|
| Documentación (requisitos, documentos, almacén) | Miembro | `puede(…, 'documentacion')` |
| Planos (entregables, almacén, `planos_de_version`) | Miembro | `puede(…, 'planos')` |
| Validar planos | Miembro, una sola decisión | Aprobador requerido, o cualquiera con `planos` si no hay aprobadores |
| Códigos de comprador y selecciones | Miembro | `puede(…, 'compradores')` |
| Formalización | Miembro | `puede(…, 'personalizacion')` |
| Ficha y datos fiscales de la promoción | Miembro | `puede(…, 'datos')` |
| Datos de la empresa | Cualquier miembro | Administrador de MUNE Portal |
| Equipo, accesos y aprobadores | Solo MUNE Studio | Administrador de MUNE Portal (su empresa) y MUNE Studio |
| Ver la promoción y la Experiencia 3D | Miembro | `ve_promocion` |

### Funciones nuevas (con todas sus comprobaciones dentro)

Para gestionar el equipo:

- `guardar_persona`;
- `cambiar_acceso`;
- `retirar_persona`;
- `nombrar_administrador`;
- `guardar_aprobadores`;
- `equipo_de_promotora`, que es lo que ve Equipo.

Otras:

- **`invitar`:** acepta llamadas de administradores desde el Portal, solo para su empresa.
- **`avisar-promotora`:** cada aviso va a quien corresponde según su capacidad o su papel de aprobador.
- **`planos_de_version` y `planos_listos`:** calculan el estado con varios aprobadores.

### Prueba de aislamiento

Casos nuevos:

- un administrador no gestiona otra empresa;
- no se puede retirar al último administrador;
- quien no es administrador no invita;
- sin `planos` no se valida;
- sin `compradores` no se ven los códigos;
- un aprobador no requerido no completa el plano;
- un plano con un aprobador pendiente no se puede publicar;
- un plano sin cambios conserva la aprobación;
- un plano que cambia vuelve a pedir todas las aprobaciones.

### Lo que no cambia

El robot de Claude no gana ningún permiso.

---

## 12. Migración del estado actual

Hoy solo hay datos de prueba, pero la migración se diseña como si hubiera clientes.

1. **Personas:** cada persona con acceso pasa a una fila de persona más sus filas de acceso, con las mismas promociones que tiene hoy.
2. **Capacidades:** cada acceso recibe **todas las capacidades de trabajo** salvo `marca`, que está reservada. Es exactamente lo que ya podían hacer. Nadie pierde nada.
3. **Administradores:** quien hoy tiene acceso a **todas** las promociones de su empresa pasa a ser **administrador**, porque ya lo veía todo. Si una empresa queda sin administrador, MUNE Studio la marca con «Sin administrador» para que nombres uno.
4. **Cambio intencionado:** los datos de la empresa pasan a ser solo de administradores. Quien solo tenía una promoción ya no puede cambiarlos.
5. **Aprobaciones:**
   - las decisiones actuales se conservan;
   - los planos aprobados siguen aprobados (se crea su foto);
   - sin aprobadores definidos, rige la regla de hoy («basta una aprobación»), así que nada cambia hasta que la promotora los defina.
6. **El Portal** pasa a leer correctamente a las personas con varios accesos. Hoy solo lee el primero.

---

## 13. Riesgos

| Riesgo | Cómo se controla |
|---|---|
| Cambio de nombres: algo queda apuntando al nombre antiguo | Búsqueda completa antes de proponer. Los Workers antiguos siguen una semana. Publicación de prueba (v8 de la demo y vuelta a v7) |
| La conexión del Worker `portal` con GitHub tras renombrar | El Portal sigue sirviendo lo último. Se reconecta en un minuto |
| Experience integrada: equipos antiguos sin WebGPU, o con poca memoria | Respaldo automático a WebGL 2 (ya existe) y opción «Abrir en una pestaña nueva». Se prueba en Chrome, Safari y Edge |
| Una regla de permisos queda sin cambiar | La prueba de aislamiento comprueba cada capacidad por separado. La seguridad real está en la base de datos |
| Una empresa se queda sin administrador | La base de datos no lo permite. MUNE Studio puede nombrar uno como soporte |
| Aprobadores mal configurados: un plano nunca llega a aprobarse | Solo pueden ser aprobadores personas con `planos`. Si alguien pierde el acceso, deja de ser requerido. El Studio muestra quién falta |
| Render HD: imagen reproducible con conocimientos técnicos | Límite conocido y aceptado. Ver punto 5 |
| Coste | Ninguno. Todo cabe en los planes gratuitos actuales |

---

## 14. Orden de implementación

| Paso | Qué | Tamaño |
|---|---|---|
| 0 | Aprobar la propuesta pendiente de la revisión de marca y textos y sus 3 pasos en Supabase | Ya preparada |
| 1 | **Nombres y estructura (A):** `taller` → `studio`, `escaparate` → `experience`, `panel/` → `app/`, Workers, carpetas, código del móvil y documentación | Una propuesta + un día de cambio guiado de unos 60–90 minutos |
| 2 | **Equipos (D):** administradores de MUNE Portal, capacidades, Equipo en el Portal, alta con administradores en Studio y varios aprobadores de planos | Una propuesta, `018`, prueba de aislamiento ampliada |
| 3 | **Experiencia 3D en el Portal (B):** acceso profesional desde MUNE Portal, Render HD, plano en PDF o PNG; se quita el acceso profesional público | Una propuesta |
| 4 | **Datos privados (C):** precios, opciones, packs y viviendas fuera de lo público | Una propuesta. Encaja después de B, porque el Portal ya pasa datos privados a la Experience integrada |

Cada paso es una propuesta con su vista previa y tu OK. El paso 1 va primero para que todo lo nuevo nazca ya con los nombres definitivos.

---

## 15. Pruebas manuales

### Paso 1: nombres

1. Entrar en https://studio.mune-projects.workers.dev con contraseña y código del móvil.
2. Actualizar el nombre en la app del móvil: aparece «MUNE Studio» y la entrada antigua deja de usarse.
3. Abrir la Experience publicada en https://experience.mune-projects.workers.dev/residencial-demo/ y la vista previa en https://revision-experience.mune-projects.workers.dev/residencial-demo/.
4. En el Studio, ver la versión publicada y la de revisión de la demo.
5. Publicar la v8 de la demo, comprobar el email y la web, y volver a la v7.
6. En el Portal: entrar, abrir una promoción y comprobar los enlaces a la Experience.
7. Invitar a una persona de prueba y recibir el email.

### Paso 2: equipos y aprobaciones

1. Dar de alta una promotora de prueba con dos administradores.
2. Como administrador:
   - invitar a dos personas con capacidades distintas;
   - comprobar que cada una ve solo sus secciones.
3. Intentar retirar al último administrador: no debe dejar.
4. Definir dos aprobadores de planos.
5. Enviar planos desde Studio y comprobar:
   - con una aprobación aparece «1 de 2» y Publicar sigue bloqueado;
   - con la segunda aprobación se puede publicar.
6. Pedir cambios con un comentario: el plano queda en «Cambios pedidos».
7. Preparar una versión nueva:
   - el plano que no cambia conserva la aprobación;
   - el que cambia pide todas las aprobaciones.

### Paso 3: Experiencia 3D

1. En el Portal, abrir Experiencia 3D y comprobar:
   - la versión publicada y la de revisión;
   - cambiar de vivienda;
   - las vistas guiadas, el modo Plano y la pantalla completa.
2. Con `materiales`:
   - generar varios Render HD seguidos;
   - descargar el plano en PDF y en PNG;
   - seguir trabajando más de una hora con actividad.
3. Sin `materiales`: no aparecen las herramientas.
4. Abrir la Experience pública: no hay «Acceso profesional».

### Paso 4: datos privados

1. Visitante sin código: la vivienda se ve igual que hoy.
2. Comprador con código:
   - catálogo, precios, packs, histórico y formalizado, igual que hoy;
   - el PDF se genera.
3. Comprobación automática: los archivos públicos no contienen precios, fechas de packs ni notas internas.

---

## 16. Bloque C: datos privados

La propuesta de la versión 1 se mantiene, con una mejora: el Portal pasará los datos privados a la Experience integrada usando la sesión de la persona.

**Viaja hoy en los archivos públicos y debe salir de ellos:**

- precios de las mejoras;
- opciones no incluidas;
- alternativas de distribución;
- packs y sus fechas;
- restricciones por vivienda;
- lista de viviendas;
- planos de todas las variantes;
- notas internas y procedencia de cada dato;
- versiones antiguas de la geometría;
- muebles no usados.

**Arquitectura:**

1. Sin código, la Experience lleva solo lo necesario para la visita: lo incluido de serie, sin precio.
2. El contenido del comprador de cada versión se guarda en Supabase.
3. `entrar_comprador` lo devuelve solo con un código válido y solo para esa vivienda.
4. Cómo llega a Supabase:
   - `preparar` lo guarda en el repositorio privado `studio`;
   - la función `ejecutar`, solo para la administradora, lo carga en Supabase;
   - la llave A gana *Contents: read* sobre `studio`, editando la llave existente, sin renovarla.

**La web pública:**

- sigue siendo estática;
- funciona aunque Supabase esté dormido.

**El flujo de packs no cambia:** disponible, próximamente, finalizado, histórico, formalizado bloqueado y PDF.

---

**Fuera de esta propuesta**, como pediste:

- exportación a Excel de las personalizaciones;
- nueva revisión de textos;
- Fase 2;
- copias de seguridad (etapa 7).
