# Panel de administración

Centro de control interno (no lo ven los compradores). Fase 0, paso 1: entrada
con contraseña + código del móvil y registro de actividad.

- Código: `src/main.ts` (TypeScript sin frameworks) + `@supabase/supabase-js`.
- Base de datos: los archivos de `supabase/` se ejecutan una vez, en orden, en Supabase → SQL Editor:
  - `001_panel.sql`: administradoras y registro de actividad;
  - `002_promociones.sql`: lista privada de promotoras y promociones.
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
