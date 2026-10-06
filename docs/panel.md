# Panel de administración: mapa completo

El Panel es el cuadro de mandos de la administradora. Las promotoras tienen su propio portal (Fase 1) para subir documentación, validar planos y ver sus versiones. En el Panel se ve todo, se decide todo y se lanza el trabajo.

Cada botón dispara una de dos cosas:

- **Una acción automática**, sin Claude: publicar, volver atrás, cambiar mobiliario del catálogo, regenerar planos…
- **Una petición a Claude**, para lo que requiere criterio: interpretar documentación, interiorismo libre, resolver incoherencias…

Este documento es la referencia: todo lo que se construya en el Panel sigue este mapa.

## Secciones

### 1. Inicio: «qué necesita tu atención»

Bandeja con lo pendiente de todas las promociones:

- versiones esperando revisión;
- documentación nueva subida por promotoras;
- planos validados o rechazados por la promotora;
- peticiones a Claude terminadas;
- avisos del sistema: copias, cuotas, Supabase a punto de dormirse, accesos sin uso.

### 2. Promotoras

- Lista, datos y contacto.
- Personas con acceso y su rol (gestor o aprobador). Dar y quitar acceso al instante (receta 14).
- Activar o desactivar.

### 3. Ficha de cada promoción

| Pestaña | Contenido y acciones |
|---|---|
| **Resumen** | Estado, versión publicada, versión pendiente, enlaces a la visita y a la vista previa |
| **Documentación** | Lista de lo que tiene que entregar la promotora, con lo recibido, versiones y estado (nuevo, vigente, rechazado). Descargar. «Revisar lo nuevo» → Claude (receta 2) |
| **Tipologías y viviendas** | Tipología → Variante → Unidad, superficies. Códigos de comprador: generar, regenerar y revocar (Fase 1, receta 24) |
| **Mobiliario y acabados** | Por tipología y estancia, estilos y piezas del catálogo (por ejemplo «Nórdico claro» o «Contemporáneo»; sofá A o sofá B; suelo roble o gris) con vista previa automática, sin Claude (receta 21). **«Estilo a partir de una foto»**: se adjuntan fotos de referencia y llega a Claude como petición de interiorismo |
| **Personalización** | Packs y alternativas del comprador, con fechas y precios. Selecciones registradas (recetas 6 y 12) |
| **Versiones** | Historial (vN, fecha, quién aprobó, qué cambió), vista previa, **Publicar** y **Volver a una anterior** desde el Panel (recetas 10 y 11) |
| **Entregables** | Planos PDF/PNG, renders y PDF de muestra: descargar y regenerar (receta 7) |
| **Validación de planos** | Qué ha aprobado o rechazado la promotora, con sus comentarios |
| **Marca e información** | Logo, colores, contacto y textos legales de la promotora (receta 16) |
| **Peticiones a Claude** | Las peticiones de esta promoción y su estado |

### 4. Peticiones a Claude

- Cola completa con su estado: pendiente → en curso → lista para revisar (con enlace), o descartada.
- Texto y **fotos de referencia** (JPG, PNG o WebP; hasta 5 por petición, 10 MB cada una).
- Claude las atiende **cuando la administradora se lo pide**. Cuando haya clientes, se valorará una revisión automática periódica, que consume plan de Claude.

### 5. Biblioteca

Muebles, materiales y texturas disponibles, con la **licencia registrada** de cada uno. Es la fuente de las opciones de «Mobiliario y acabados».

### 6. Sistema

- Registro de actividad completo.
- Copias de seguridad y simulacro de recuperación (receta 18).
- Informe: cuotas, costes y caducidad de credenciales (receta 19).
- Robots y llaves: qué existe, con qué permisos, y botón para revocar.

## Orden de construcción

| Cuándo | Qué | Qué necesita |
|---|---|---|
| **Hecho** | Entrada con doble verificación, promociones con estado, pedir cambios con fotos de referencia, registro, **Publicar** y **Volver a una anterior** desde el Panel | Brazo ejecutor (ver abajo) |
| **Fase 1** | Inicio, Promotoras y accesos, Documentación, Validación de planos, códigos de comprador, copias de seguridad | Portal de promotoras, almacén de archivos en Supabase. Copias en R2: puede pedir tarjeta, se consulta antes |
| **Fase 2** | Mobiliario y acabados (catálogo y estilo a partir de foto), Personalización, Entregables, Marca, Biblioteca | Catálogo de estilos y recetas automáticas |
| **Fase 3** | Renders premium bajo demanda | Prueba piloto y decisión sobre costes |

## Piezas técnicas

- Código: `panel/` (TypeScript sin frameworks + `@supabase/supabase-js`). Web estática en Cloudflare Workers (`panel`), con vista previa por cada propuesta desde la rama `revision`.
- Base de datos y reglas: `panel/supabase/00N_*.sql`, ejecutados en orden en el SQL Editor de Supabase.
- Herramienta del robot: `herramientas/peticiones.mjs` (`listar`, `fotos <id>`, `estado <id> …`), con credenciales en las variables del entorno de Claude (`ROBOT_EMAIL`, `ROBOT_CLAVE`).

## Brazo ejecutor (Publicar y Volver)

```
Panel (botón) → función «ejecutar» de Supabase → GitHub Actions «publicar.yml» del taller → escaparate (main) → Cloudflare
```

| Pieza | Dónde | Qué comprueba o permite |
|---|---|---|
| Función `ejecutar` | `panel/supabase/funciones/ejecutar/index.ts`, en Supabase → Edge Functions | Que quien pulsa es administradora con doble verificación (`es_admin()`); valida la orden; anota en el registro |
| Llave A `GITHUB_EJECUTOR` | Secreto de Supabase (Edge Functions → Secrets) | Solo arrancar procesos del almacén `taller` (Actions: lectura y escritura). Caduca a los 90 días |
| Proceso `publicar.yml` | `.github/workflows/publicar.yml` | Ejecuta `herramientas/publicacion.mjs aprobar` o `volver`; uno detrás de otro, nunca dos a la vez |
| Llave B `ESCAPARATE_TOKEN` | Secreto del almacén `taller` (Settings → Secrets → Actions) | Solo escribir en `escaparate` (Contents: lectura y escritura). Caduca a los 90 días |
| `GITHUB_TOKEN` | Automática de GitHub | Guardar el registro de versiones en el taller; solo dura ese proceso |

Flujo de versiones:

1. Claude **prepara** una versión (`publicacion.mjs preparar`) en la rama `revision` del escaparate, que es la vista previa.
2. Claude lanza el proceso `avisar.yml`. GitHub abre un aviso «<promoción> vN · lista para revisar» con los enlaces a la vista previa y al Panel, y **envía el email**. Lo crea github-actions, no la propia cuenta, porque GitHub no avisa de lo que hace uno mismo.
3. La administradora revisa la vista previa y pulsa **Publicar vN** en el Panel. **Solo se publica la versión revisada:** si la vista previa ha cambiado entretanto, el ejecutor se niega.
4. El ejecutor pasa la versión a `main`, guarda el registro y cierra el aviso.

El registro `promociones/<id>/publicaciones.json` solo lo escribe el ejecutor, en `main`.

Para recibir los emails, la cuenta de la administradora debe **vigilar** el almacén `taller` (botón *Watch* → *All Activity*, o al menos *Issues*), con el email activado en las notificaciones de GitHub.
