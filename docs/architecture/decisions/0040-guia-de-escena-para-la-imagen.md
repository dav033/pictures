# ADR-0040 — Guía de escena para la imagen: FLUX ve el plan dibujado, nunca la foto

Date: 2026-10-04
Status: accepted detrás de `GUIA_ESCENA_V1` (encendida por defecto, decisión D2). Sin corrida pagada todavía.
Supersedes: nada. Amplía ADR-0033 (guía de estructura), que sigue para los planes sin foto de referencia.

## Problema

Las imágenes salen de FLUX.2 base en fal (modo `base`: `loras: []`, sin trigger), que solo lee texto. La
composición de una foto de referencia no cabe en el caption: dos columnas orgánicas a los lados de una mesa
salieron como dos medios arcos en un estudio. Mandar la foto como píxel a `/edit` no sirve: `/edit` conserva la
imagen que recibe y devolvía la misma foto con otros tonos (2026-09-24), y la foto del cliente no debe salir
hacia el proveedor.

## Decisión

1. **FLUX nunca ve la foto del cliente.** Con un plan que salió de una foto (alguna estructura tiene
   `referencia_element_id`), `/api/generate` manda a `/edit` UNA imagen: la guía de escena, y nada más.
2. **La guía es el plan dibujado por el motor.** Python es el único dueño de la geometría:
   `POST /internal/v1/plan/guia-escena` (`app/guia_escena.py`, contrato Zod `src/lib/plan/guia-escena.ts`)
   devuelve cada globo de cada pieza como disco `{x_m, y_m, r_m, hex}` en metros. Las piezas del motor salen
   de la misma puerta que la resolución (`plan.pieza_del_motor_resuelta`); las que no tienen motor, de su
   dibujo esquemático (`dibujo_estructura.globos_de`). El color es el `hexGlobo` de la referencia Sempertex que
   se compra. Sin persona, sin cotas, sin texto.
3. **TypeScript compone.** `src/lib/ia/kagutsuchi/guia-escena.ts` encaja cada instancia en la
   `reference_bbox` de su elemento en la foto (las repetidas toman las cajas de la foto de izquierda a derecha,
   la derecha en espejo; lo que falte, `cajasDeEstructuras`), sobre fondo liso y franja de piso, con círculos
   planos. `rasterizar-guia.ts` la pasa a PNG del encuadre de salida.
4. **El prompt:** el caption primero y la nota (`NOTA_GUIA_ESCENA`) después, descontada del presupuesto del
   caption. La guía de escena viaja sola: cualquier otra imagen junto a ella falla cerrada.
5. **Nunca en silencio:** si la guía no se puede construir o su nota no cabe, se genera solo con texto y la
   respuesta lo dice en `guiaEscena: { usada: false, motivo }`.
6. **Cada pieza, con lo que la resolución ya sabe de ella** (aditivo, 2026-10-04). El plan no dice qué globo
   es cada material ni dónde flota una pieza; la resolución y la foto sí, y viajan en `mezclas[]` de la
   petición, todo opcional y derivado:
   - `mezcla_real` (ya estaba), `lineas` (el catálogo de cada línea resuelta: título, forma, tamaño, color,
     acabado; sin unidades) y `leyenda` (la de `plan_resuelto.armados_bouquet`, que manda sobre las líneas).
     Python clasifica cada material con la regla de la hoja de armado (`plan.contexto_bouquet_de_globos` →
     `armado_bouquet.clasificar`): látex, metalizado, burbuja o número, sus pulgadas y su silueta (corazón,
     estrella). Los módulos de `app/guia_piezas` lo reciben como `ContextoPieza` (tercer parámetro opcional de
     `globos_de`; un módulo de dos parámetros sigue funcionando). Así un corazón metalizado de 18" se dibuja
     foil de 18" y no látex R-12, la figura es de foil por el tipo de su material y no por su nombre, y el
     látex de la figura y del bouquet toma los tamaños de la `mezcla_real`.
   - `aspecto_caja`: alto sobre ancho de la caja de la foto donde va la pieza, en píxeles de la guía (solo
     cajas de la foto). La figura sin silueta conocida (un animal, un personaje) dibuja su óvalo con esa
     proporción, acotada a 0,3–3,5; sin foto, el óvalo vertical de 1,4 de siempre. El blueprint no trae hoy
     una silueta más rica que la caja (`physical_form` describe partes, no geometría).
   - La respuesta suma por pieza `anclaje` (`piso | techo | flotante | pared`) y `elevacion_m` (solo con
     `flotante`: altura del globo más bajo sobre el piso). El bouquet de helio es `flotante` con la altura de
     su diseñador en el clasificador, el dueño (pesa más 0,35 m de cinta —0,5 m escalonado— con armado;
     `cintaM` de la forma lista sin armado: 1,1 m el clásico); la base de aire y el ramo a ras del suelo son
     `piso`. TypeScript respeta el `anclaje` sobre la ubicación del plan; una pieza flotante se encaja contando
     su elevación y sus globos quedan esa altura, a su escala, sobre el fondo de su caja, sin tocar la franja
     de piso. Las cintas y la pesa no son globos y no se dibujan.
   - La pared no densa sin forma elegida se dibuja cuadriculada (`FORMA_POR_OFICIAL`) porque `malla-links`
     pinta globos link que el plan puede no llevar. Si sus líneas compran globos link (forma de catálogo
     `link`), se dibuja en `malla-links`. Ni la lectura de la foto ni el blueprint traen hoy una forma de
     pared (link-o-loon, malla): cuando la traigan, se cablea aquí sin inventarla antes.

## Alternativas

- Mandar la foto como referencia de composición (`REFERENCIA_EN_ETAPA1_V1`): `/edit` la copia. Sigue apagada.
- Parsear los SVG de la interfaz: llevan silueta humana, cotas y degradados que el modelo copiaría.
- Una guía por pieza (ADR-0033): no transporta dónde va cada pieza ni su tamaño relativo.

## Consecuencias

- Una imagen de entrada más por generación (~US$ 0,021 estimados).
- Las piezas sin motor ni dibujo salen de `app/guia_piezas` (bouquet, figura, guirnalda clásica); lo que no
  reconoce ningún módulo se lista en `omitidas`.
- Sin `lineas`/`leyenda` (un cliente viejo), cada pieza se dibuja como antes: todo látex R-12 en el bouquet sin
  armado, foil solo si el nombre lo dice en la figura. Lo que se publica de más (`anclaje`, `elevacion_m`) es
  opcional en el contrato; un consumidor que no lo lee compone como siempre.
- Derivado: no toca el plan, el snapshot, `plan_hash`, cantidades ni precio.

## Rollback

`GUIA_ESCENA_V1=false` vuelve a la generación solo con texto. El endpoint de Python es aditivo.
