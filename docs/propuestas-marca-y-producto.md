# Propuestas pendientes de decisión (revisión de marca y producto, 10/10/2026)

Estas propuestas salen de la revisión de marca y producto. No están implementadas: cada una cambia algo de la arquitectura y necesita el OK de la administradora. Lo que sí se ha aplicado está en la decisión 39 de `docs/arquitectura.md`.

## 1. Permisos por capacidad en MUNE Portal

**Hoy.** Una persona tiene una fila en `miembros` (promotora + una promoción, o todas). Todas las comprobaciones usan `es_miembro_de_promocion(promocion)`: quien tiene acceso puede hacerlo todo dentro de la promoción.

**Propuesta (la más simple y segura):**

1. Añadir a `miembros` una columna `capacidades text[]`, con las capacidades permitidas: `documentacion`, `planos`, `compradores`, `personalizacion`, `marca`, `materiales` y `datos`.
2. **Las filas que ya existen reciben todas las capacidades** (valor por defecto), así que nada se rompe ni cambia para nadie.
3. Una función nueva, `puede(promocion, capacidad)`: es la administradora, o es miembro activo de esa promoción (o de todas las de su promotora) con esa capacidad.
4. Las reglas y funciones de escritura pasan a usarla, cada una con su capacidad:
   - subir documentos: `documentacion`;
   - validar planos: `planos`;
   - generar y cambiar códigos: `compradores`;
   - ficha y datos fiscales: `datos`;
   - formalización: `personalizacion`;
   - más adelante, marca, catálogo y materiales.
5. Las lecturas de cada apartado se limitan igual. Por ejemplo, sin `documentacion` no se ven los documentos. Los datos básicos de la promoción (nombre, estado) los ve todo el equipo.
6. **MUNE Portal** oculta las pestañas para las que la persona no tiene capacidad. La seguridad real la ponen las reglas de la base de datos, no la interfaz.
7. **MUNE Studio**: en *Equipo* y en *Acceso a todas las promociones*, casillas de capacidades por persona, al invitar y después. La función `invitar` acepta las capacidades.
8. **Avisos por email**: cada aviso va solo a quien tiene la capacidad relacionada:
   - planos para validar: a quien tiene `planos`;
   - documento por corregir: a quien tiene `documentacion`;
   - versión publicada: a todo el equipo.
9. **Prueba de aislamiento**: comprobaciones nuevas por capacidad. Por ejemplo, quien no tiene `planos` no puede validar.

**Sin roles fijos:** cada persona tiene una lista de capacidades que se decide en el onboarding con cada cliente.

**Esfuerzo y coste.** Una etapa propia, con un archivo SQL (`017_capacidades.sql`), cambios en el Portal, en Studio y en `invitar`, y pruebas. Coste: ninguno.

## 2. Quitar el «Acceso profesional» de la experiencia pública

**Dependencia encontrada.** El «Acceso profesional» es hoy la **única** forma de que la promotora obtenga los **renders HD** y el **plano comercial en PNG**. Si se quita sin más, esa función desaparece.

**Riesgo de seguridad.** La experiencia pública incluye la «huella» del código de promotora (`promotora.acceso`). Si el código es corto, se puede intentar adivinar sin límite de intentos.

**Propuesta:**

1. **Planos en PNG desde MUNE Portal.** Al preparar cada versión, `herramientas/planos.mjs` ya genera el PDF y una miniatura. Generaría también el PNG a 300 ppp, y el Portal lo ofrecería junto al PDF en *Planos*. Ninguno de los dos necesita la experiencia pública.
2. **Renders HD desde MUNE Portal.** Botón «Abrir la experiencia para descargar imágenes» (publicada o en revisión):
   - el Portal abre la experiencia en otra pestaña y le pasa la sesión de la persona de forma segura (mensaje directo entre las dos páginas, sin ponerla en la dirección);
   - la experiencia comprueba en Supabase que esa persona es del equipo de esa promoción (función nueva `soy_equipo`);
   - si lo es, activa *Render HD* solo en esa pestaña.

   Sin otro código ni otra contraseña.
3. Después, **quitar el botón «Acceso profesional»** y la huella del código de promotora de la experiencia pública. El acceso al Studio de producción (código propio) solo existe en la construcción interna y no cambia.

**Esfuerzo y coste.** Medio. Coste: ninguno. Recomiendo hacerlo junto con la capacidad `materiales` del punto 1.

## 3. Contenido público frente a contenido solo para compradores

**Qué contiene hoy la experiencia pública** (lo que descarga cualquier visitante):

| Contenido | ¿Necesario sin código? | Estado |
|---|---|---|
| Geometría de las tipologías, viviendas (referencia, portal, planta, orientación, superficies), vistas | Sí | Se queda |
| Marca, contacto de la oficina comercial y textos legales | Sí | Se queda |
| Códigos, lo formalizado por cada comprador y precio de la vivienda | No | Ya no se publican (etapa 5) |
| Contacto de formalización y datos bancarios | No | **Ya no se publican**: llegan solo con un código válido (decisión 39) |
| Huella del código de promotora | No | Se quita con el punto 2 |
| Catálogo de personalización completo (opciones, **precios**) y packs (títulos, fechas) | Solo lo incluido de serie, que se usa para dibujar la vivienda | **Pendiente**: propuesta abajo |

**Propuesta para el catálogo y los packs:**

1. Al construir la experiencia pública, dejar solo **lo incluido de serie** de cada categoría, sin precios. Es lo que hace falta para pintar la vivienda tal como se entrega.
2. Las opciones, los precios, las alternativas y los packs de cada versión se guardan en Supabase (tabla nueva, por promoción y versión). `entrar_comprador` los devuelve junto con la vivienda, solo con un código válido.
3. **Cómo llegan a Supabase sin claves nuevas:**
   - `preparar` deja ese contenido en la vista previa, en una ruta imposible de adivinar;
   - al pulsar *Publicar* en MUNE Studio, el Studio (con la sesión de la administradora) lo copia a Supabase;
   - la ruta se borra de la vista previa.

   Es el mismo mecanismo que hoy usan los planos al enviarlos a la promotora.
4. Opcional, por pack: «mostrar a interesados». Así, una promotora que quiera enseñar un pack con precios a todo el mundo puede hacerlo.

**Esfuerzo y coste.** Medio-alto: toca la construcción, la publicación y el configurador. Coste: ninguno. Encaja con la Fase 2 (catálogo y packs gestionados desde MUNE Portal), porque esos datos pasarían a vivir en Supabase de todas formas.

## 4. Nombres técnicos que quedarían por cambiar (sin prisa)

En las pantallas ya se usan **MUNE Studio** y **MUNE Portal**. Las piezas técnicas conservan su nombre para no romper nada:

| Pieza | Nombre actual | Cambio posible | Qué habría que tocar |
|---|---|---|---|
| Worker de Cloudflare del Panel | `panel` (`panel.mune-projects.workers.dev`) | `studio` | Crear el Worker nuevo, `ORIGENES` de las funciones `invitar`, `ejecutar` y `avisar-promotora`, enlaces de los avisos de GitHub y la documentación. Mantener el antiguo un tiempo |
| Worker del portal | `portal` | Sin cambio (ya es MUNE Portal) | — |
| Escaparate | almacén `escaparate` y Worker `escaparate` | Sin cambio: es interno | Solo cuando haya dominio propio (por ejemplo `promocion.mune…`) |
| Carpeta del Panel | `panel/` | `studio/`, más adelante | Rutas de Cloudflare, procesos de GitHub y la documentación |
| Emisor del código del móvil | «MUNE Panel» en la app del móvil | «MUNE Studio» | Solo afecta a altas nuevas del móvil |

Con un dominio propio, lo natural sería `studio.` y `portal.` sobre el dominio de MUNE, y una dirección por promoción para la experiencia pública. Es una decisión con coste (dominio) que se tomará más adelante.

## 5. Vídeo y realidad virtual

- **Realidad virtual:** sigue en desarrollo. No aparece como función en las pantallas ni en los textos hasta que funcione.
- **Vídeo:** decisión abierta. No se promete ni se descarta.
