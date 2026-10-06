# Panel de administración

Centro de control interno (no lo ven los compradores). Fase 0, paso 1: entrada
con contraseña + código del móvil y registro de actividad.

- Código: `src/main.ts` (TypeScript sin frameworks) + `@supabase/supabase-js`.
- Base de datos: los archivos de `supabase/` se ejecutan una vez, en orden, en Supabase → SQL Editor:
  - `001_panel.sql`: administradoras y registro de actividad;
  - `002_promociones.sql`: lista privada de promotoras y promociones;
  - `003_peticiones.sql`: peticiones de cambios y usuario robot de Claude;
  - `004_referencias.sql`: almacén privado de fotos de referencia;
  - `005_portal.sql`: portal de promotoras (miembros, requisitos, documentos, entregables, validaciones y sus almacenes privados);
  - `006_accesos.sql`: accesos de las promotoras (para la sección *Promotoras* y la función `invitar`);
  - `007_equipos.sql`: equipos por promoción (o acceso a todas las de la promotora), sin roles, y datos fiscales de promotoras y promociones.

  Ojo: volver a lanzar `002` después de `005` quita los permisos de escritura de la administradora; en ese caso, relanzar `005`.
- Prueba de aislamiento entre promotoras: `bash pruebas/lanzar.sh` (necesita Docker y psql). Levanta un Supabase local vacío, aplica estos archivos y hace las comprobaciones. En GitHub se lanza sola en cada propuesta (`.github/workflows/aislamiento.yml`).
- Función de Supabase `invitar` (`supabase/funciones/invitar/index.ts`): dar acceso al portal (receta 14). Crea la cuenta y Supabase envía el email de invitación; usa la clave de servicio que Supabase da a la función, que no sale de sus servidores.
- Textos de los emails del portal (invitación y contraseña nueva): `supabase/emails/`.
- Función de Supabase `ejecutar` (`supabase/funciones/ejecutar/index.ts`): botones Publicar y Volver, a través de `.github/workflows/publicar.yml`.
- Mapa completo del Panel y brazo ejecutor: `docs/panel.md`.
- Versiones: el Panel lee el `version.json` de cada promoción en producción y en la vista previa del escaparate. No existe ninguna lista pública de promociones.
- Publicación: Cloudflare Workers (`wrangler.jsonc`), solo archivos estáticos.

## Seguridad

- En el navegador solo hay datos públicos: la dirección del proyecto y la clave
  «publishable». Ninguna clave secreta vive aquí.
- Las reglas de la base de datos exigen sesión con doble verificación (`aal2`)
  y estar en la tabla `administradores`. La lista de administradores no se
  puede cambiar desde el Panel.
- El registro solo admite añadir apuntes; no se edita ni se borra.
- El alta de usuarios está cerrada en Supabase: solo se crean a mano.
- La sesión vive en la pestaña y caduca a los 30 minutos sin actividad.
- Cabeceras: sin indexar, sin iframes, CSP estricta (`public/_headers`).

## Desarrollo

```sh
cd panel
npm install
npm run dev
```

## Publicación

Cloudflare Workers Builds (almacén `taller`, directorio raíz `panel`):
`npm run build` y `npx wrangler deploy`. Cada propuesta de GitHub recibe su
vista previa; la versión definitiva sale al aprobar la propuesta en `main`.
