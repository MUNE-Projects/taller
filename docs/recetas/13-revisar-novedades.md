# Receta 13 · Revisar novedades

**Lo dices así:** «¿Hay algo nuevo?».
**Tipo:** de consulta (no cambia nada). **Tu OK:** no hace falta.

## Pasos
1. `node herramientas/documentos.mjs novedades [--desde AAAA-MM-DD]` (por defecto, los últimos 7 días):
   - documentos subidos y documentos revisados;
   - planos aprobados o rechazados por las promotoras;
   - peticiones de cambios abiertas;
   - cuántos documentos esperan revisión ahora mismo.
2. Claude lo resume en pocas líneas y propone el siguiente paso (por ejemplo, la receta 2 si hay documentación nueva).

## Sin Claude
La página **Inicio** del Panel muestra lo mismo: versiones por revisar, documentación por revisar y peticiones abiertas. Además, GitHub te manda un email por cada documento que sube una promotora (aviso «documentación nueva»).
