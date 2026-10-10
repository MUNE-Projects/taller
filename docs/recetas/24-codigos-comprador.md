# Receta 24 · Códigos de comprador

**Lo dices así:** «Dame un código para el 2ºB de Residencial X» (o lo hace la promotora desde su portal).
**Tipo:** sin Claude: Panel o portal, pestaña **Compradores** de la promoción.

## Cómo funciona
- **Un código por vivienda** (`c-` y 12 cifras). Lo genera la promotora (portal) o la administradora (Panel). Solo se ve **al generarlo**: en Supabase queda su huella, nunca el código. Si se pierde, se cambia.
- Se lo da la promotora o el comercial al comprador. Con él entra en la web pública: «¿Ya eres comprador? Accede para personalizar tu vivienda», o directamente con el enlace `…/<promoción>/#c-…`.
- **Cambiar código** pregunta para quién es:
  - **mismo comprador** (lo ha perdido): conserva lo que tenía formalizado;
  - **comprador nuevo** (venta cancelada y vendida a otra persona): empieza de cero; lo del anterior queda en el historial (solo MUNE y la promotora).
  El código anterior deja de valer al momento.
- **No caducan:** valen hasta que se cambian o se borra la promoción.
- **Límite de intentos:** 10 fallos en 15 minutos desde la misma dirección (o 300 en una hora en la promoción) bloquean un rato.
- La pestaña muestra si el comprador ya ha entrado, cuándo fue la última vez y cuántas veces.

## Piezas
- `panel/supabase/014_codigos_comprador.sql`: códigos (huella), selecciones formalizadas de cada comprador, intentos, `generar_codigo_comprador`, `codigos_de_promocion`, `entrar_comprador` (la llama la web pública, sin sesión).
- La web pública ya no lleva códigos ni selecciones (`vite.config.ts` los quita siempre). Lista pública de viviendas: `viviendas.json`, que genera `publicacion.mjs` en cada versión.
- Lo formalizado por cada comprador vive en `selecciones_comprador` (por ahora lo registra la administradora; su pantalla llegará con las personalizaciones, Fase 2).

## Errores
- «No se ha podido comprobar el código ahora mismo»: Supabase no responde (por ejemplo, dormido tras 7 días sin uso). Despertarlo desde su panel.
