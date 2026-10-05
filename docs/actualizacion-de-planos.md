# Actualización de planos (anteproyecto → proyecto de ejecución)

La promoción tiene **una única base digital** por tipología. Todo lo que se entrega sale de ella:

```
promociones/<id>/tipologias/<tipología>/
  vivienda.json       geometría: muros, huecos, estancias, equipamiento   ← lo que cambia con un plano nuevo
  alternativas.json      distribuciones alternativas (parches sobre la geometría)
  tipologia.json      cámaras maestras, orientación (norte) y revisión del proyecto
  ambientacion.json   mobiliario y decoración
  versiones/          copias de las geometrías anteriores (para comparar)
```

A partir de estos datos se generan:
- el visor 3D;
- los renders HD;
- el plano comercial;
- las superficies de la ficha;
- la personalización por packs;
- los documentos de selección.

No hay un modelo distinto para cada uno.

## Procedimiento

1. **Guardar la versión vigente:** copiar `vivienda.json` a `versiones/`, por ejemplo `versiones/v1-anteproyecto.json`. La del anteproyecto ya está guardada.
2. **Traducir el plano nuevo a `vivienda.json`**, con `herramientas/extraer_plano.py` y revisión, o a mano desde el plano acotado.
   - **Clave: conservar los identificadores** (`id`) de los elementos que siguen existiendo. Si un muro «m-salon-cocina» sigue ahí, debe seguir llamándose así aunque se mueva. Los ids son lo que mantiene enlazadas las alternativas, las sustituciones de mobiliario y las cámaras.
3. **Actualizar `revision` en `tipologia.json`** (fase, versión, fecha, fuente) y, si el nuevo plano lo aclara, `norte`.
4. **Abrir el Studio → pestaña «Actualización»:**
   - *Cambios respecto a una versión anterior:* muros, huecos, estancias y equipamiento nuevos, eliminados o modificados.
   - *Revisión:* lo que hay que corregir (rojo) o repasar (ámbar) en superficies, huecos, equipamiento, cámaras, vistas obligatorias, decoración, alternativas y opciones del catálogo.
5. **Repasar lo señalado:**
   - cámaras y decoración, en el Studio;
   - parches de alternativas, en `alternativas.json`;
   - precios u opciones, en el Studio.
6. **Exportar el paquete** desde Publicación, integrarlo en `promociones/<id>/`, hacer el build y publicar.

## Qué se regenera solo y qué hay que repasar

| Se regenera solo | Hay que repasar |
|---|---|
| Muros, carpinterías, suelos, techos, rodapiés, interruptores, luz de ventana, paisaje | Cámaras compuestas a mano, si la estancia cambia |
| Superficies (ficha, plano comercial, documentos) | Decoración colocada (la revisión detecta la que invade muros o queda sin mueble debajo) |
| Plano comercial con los rótulos recolocados | Parches de las alternativas, si cambian los elementos que modifican |
| Renders HD (se generan desde las cámaras) | Opciones y precios afectados |
| Vistas automáticas de estancias nuevas sin vista | |
| Viviendas simétricas | |

## Prueba realizada (simulación)

Sobre la tipología A se aplicó un «plano de ejecución» ficticio con estos cambios:
- balconera del salón 17 cm más ancha;
- puerta del baño principal desplazada 20 cm;
- superficie del dormitorio 2 corregida (+0,07 m²);
- «Espacio Homes» pasa a llamarse «Lavadero»;
- se elimina la mesa auxiliar del salón;
- el tabique salón-cocina llega con otro id (como ocurriría al reextraer el plano sin conservar ids).

**Resultado:**
- **Cambios detectados:** los siete.
- **Revisión:** tres puntos a repasar:
  - un jarrón que quedaba flotando sin la mesa auxiliar;
  - el parche de la alternativa «Cocina abierta», roto por el cambio de id del muro;
  - una discrepancia de superficie del recibidor que ya existía en el plano de origen.
- **Resto:** geometría, superficies, plano comercial y renders se regeneran sin intervención.
- **Trabajo manual estimado para este caso:** mover un objeto, restablecer un id y confirmar la superficie del recibidor.
- **Lección:** conservar los ids al traducir el plano nuevo es lo que más trabajo ahorra.

## Limitaciones actuales

- **Traducción del plano:** pasar de un plano (DWG/PDF) a `vivienda.json` sigue siendo semiautomático y hay que revisarlo.
- **Superficies:** la revisión compara contornos con la superficie declarada (tolerancia del 5 %). La superficie oficial manda.
- **Ids:** no hay emparejamiento automático de elementos que cambian de id. Se verían como «eliminado» y «nuevo».
