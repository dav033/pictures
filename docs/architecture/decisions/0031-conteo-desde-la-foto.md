# ADR-0031 — Conteo de globos desde la foto de referencia

Date: 2026-09-25
Status: accepted para E1 (lectura, contrato y blueprint, detrás de una bandera apagada); E2 pendiente
Supersedes: nothing. Extiende ADR-0030 (decisión 4 enmendada, "la foto manda").

## Problema

La cantidad de globos de una estructura sale del modelo del chat (que escribe
medidas, densidad o `unidades_declaradas` sin ver el número de globos de la foto)
o de los valores por defecto de `plan.py`. Solo el bouquet toma su cantidad de la
foto, y solo desde la lectura de su armado (ADR-0030). El resto de las piezas
(arcos, semiarcos, columnas, guirnaldas, paredes, centros de mesa, techos,
figuras y kits) no tiene ninguna lectura de cuántos globos se ven: una guirnalda
de 60 globos en la foto puede salir de 48 o de 12 sin que nada lo note
(`SEGUIMIENTO.md` §D, `SEGUIMIENTO-guirnaldas.md` §1.4).

## Decisión

El trabajo se parte en dos entregas reversibles por separado
(`SEGUIMIENTO-guirnaldas.md` §3).

### E1 (hecha): la lectura, sin cambiar planes

1. **Principio.** Amaterasu describe lo que ve; Python decide la cantidad. La
   lectura no compra nada: entrega una cuenta y una confianza. En E1 ningún plan
   la usa.
2. **Una lectura más de la foto** (`POST /internal/v1/ia/conteo-referencia`,
   scope `ia.conteo_referencia`, cuerpo de 11 MB como las demás lecturas): una
   llamada de visión por foto con **todas** las estructuras de globos aprobadas
   (hasta 12), en paralelo con las lecturas del patrón y del armado del bouquet y
   con el mismo vencimiento. Prompt, esquema de salida y validación en
   `services/ai-api/app/amaterasu/conteo_referencia.py`; la llamada es la misma
   `vision_estructurada.leer_foto` (temperatura 0, sin razonamiento, sin
   reintentos). Versión propia del prompt, fijada en la prueba:
   `conteo-referencia.v1:bfd6604c6192ab95`.
3. **Cómo se cuenta cada tipo vive en el registro** (ADR-0030): campo nuevo
   `como_contar` en `DefinicionEstructura`, uno por submódulo
   (`estructuras/<tipo>.py`). Entran dos submódulos: `techo_globos` (estructura
   oficial sobre `guirnalda` con ubicación `techo`) y `figura` (sobre `kit` o
   `escultura`), al final de `DEFINICIONES` y sin `inicio_de_pieza`: el prompt del
   patrón sigue byte a byte (`patron-referencia.v1:0d8c93d34d672014`). Next manda el
   tipo de cada pieza y la estructura oficial que le daría el chat
   (`identificarEstructuraOficial`); Python elige la regla con
   `definicion_de_pieza` (la oficial si el registro la describe, si no el tipo; una
   variante como `arco_asimetrico` cae en `arco`; un kit sin estructura oficial
   usa la regla genérica "cuenta cada globo").
4. **El prompt no trae cifras del plan.** Ni globos por metro ni por densidad: son
   de `plan.py` (AGENTS.md, "Python owns the commercial rules"). Darlas al modelo
   haría que la lectura repitiera el modelo del plan en lugar de medir la foto, y
   la comparación de E2 sería circular. Una prueba lo vigila.
5. **Contrato `conteo-referencia.v1`** (dueño Zod `src/lib/plan/conteo-referencia.ts`,
   `LecturaConteoSchema`), exportado dentro de `reference-blueprint.v2`
   (`appearance.conteo`) y, por el blueprint, dentro de la petición del chat
   (`contracts/chat/v1/request.schema.json`). Flujo: Zod →
   `contracts:export:domain` y `contracts:export` → `generate_models.py`. Por pieza:
   - `globos_visibles` (entero): los que se ven y se distinguen uno a uno;
   - `exacto`: la cuenta es el total. Solo con 1–40 globos visibles y nada oculto;
     Python lo fuerza a `false` por encima de 40, diga lo que diga el modelo;
   - `estimado_total` (entero o `null`): en piezas densas, el total con los ocultos
     (racimos × globos por racimo, o tramo × tramos). `null` con `exacto` y cuando
     sería menor que lo visible (incoherente: se descarta, no se corrige);
   - `racimos`, `globos_por_racimo` (1–8) (enteros o `null`);
   - `por_tamano`: `[{clase: chico | mediano | grande | gigante, proporcion}]`
     (5"/9" · 12" · 18"/24" · 36"). Cada clase una vez; si la suma del modelo está
     en 1 ± 0,1 se normaliza a 1, si no el reparto queda vacío;
   - `largo_relativo`, `alto_relativo`: `{referencia: persona | puerta | mesa, veces}`
     o `null`; `veces` es el largo o el alto de la pieza dividido por la **altura**
     de la referencia (una persona de pie, una puerta, una mesa);
   - `confianza` 0–1.
   Python lee las clases, las referencias y los topes del contrato exportado (un
   solo dueño) y comprueba cada lectura contra ese esquema antes de devolverla;
   una que no cabe se descarta con un aviso en el registro. Lo que el esquema no
   expresa (la coherencia de arriba) es de `validar_lecturas`. TypeScript solo
   comprueba, además de la forma, que el reparto por tamaño tenga cada clase una vez
   y sume 1.
6. **Orden de la salida.** El SDK de Gemini manda `property_ordering` en el orden
   del esquema, y el modelo escribe en ese orden: primero lo visible, luego los
   racimos y al final el estimado que sale de ellos. Por eso la versión del prompt
   de esta lectura se calcula con el esquema **sin** ordenar las claves (las otras
   lecturas las ordenan).
7. **Piezas repetidas.** Si el elemento representa varias piezas iguales
   (`quantity_semantics: physical_instances`, "2 columnas"), Next manda `piezas` y el
   modelo cuenta **una**. E2 multiplicará por `repeticiones` como el bouquet.
8. **Next** (`src/lib/ia/amaterasu/conteo-referencia.ts`): arma la petición por
   foto, comparte caché y llamadas en vuelo con las otras lecturas
   (`deteccion-compartida.ts`), guarda cada lectura en `appearance.conteo` y nunca
   rompe el análisis. `src/lib/ia/amaterasu/lecturas-foto.ts` junta las tres
   lecturas por elemento; la ruta `/api/references/analyze` lo llama con las tres
   banderas.
9. **Bandera `CONTEO_REFERENCIA_PYTHON_ENABLED`** (default OFF, en
   `feature-flags.ts`, como `BOUQUET_REFERENCIA_PYTHON_ENABLED`). Apagada, no hay
   llamada y el blueprint, el registro de la ruta y los prompts son byte a byte los
   de antes. Un fallo (Python caído, vencimiento, respuesta fuera de contrato) deja
   el blueprint sin lectura y queda en el registro con `request_id`,
   `correlation_id` y el código; nunca se fabrica una lectura.
10. **`pistas_conteo` se deja para E2.** El campo de entrada en
    `plan-resolution.v1` no se agrega todavía: en E1 nadie lo consumiría (el
    registro exige un consumidor por campo), Python lo aceptaría y lo ignoraría en
    silencio, y su forma depende de lo que decida E2 (`completar_conteos`,
    `completar_conteos_de`). Agregarlo junto con su consumidor deja E2 como una
    rebanada que se enciende y se revierte entera, y evita tocar ahora
    `plan-resolution.v1` y `plan-decoracion.v1`, que la rama de guirnaldas también
    cambia. Nada entra en `estructuras`/`compras` del snapshot: `plan_hash` no cambia.

### E2 (pendiente): usar la lectura al confirmar

- `pistas_conteo[]` y `completar_conteos` en `plan-resolution.v1`
  (`PistaConteoSchema = LecturaConteoSchema + referencia_element_id`, como
  `pistas_armado`), y `conteos_referencia[]` fuera del hash en `plan-resuelto.v1`
  con lo que Python decidió y por qué.
- `_aplicar_conteos` en `plan.py`, antes de `_build_resolved`, con el catálogo
  leído, detrás de `CONTEO_REFERENCIA_V1` (default OFF): kits con `exacto` y
  confianza ≥ 0,5 → `unidades_declaradas`; geométricas → la combinación de
  densidad y eje (±35 %, o el largo relativo) cuyo `_total_globos` quede más cerca
  del estimado, con tolerancia ±15 % y sin salir de la puerta física; la mezcla
  solo si `por_tamano` la contradice claramente; un supuesto por cambio.
- Texto para el modelo del chat en `serializeReferenceBlueprint` ("conteo leído en
  la foto: unos N globos…"), como el armado leído del bouquet. Hoy el prompt del
  chat es el mismo con y sin conteo (lo vigila `ia:test-conteo-referencia`).
- Evaluación: 30 fotos con conteo humano (`sha256, globos, exacto`) fuera del
  repo; error relativo mediano por familia; primero sin costo, después pagada con
  tope declarado y telemetría apagada.

## Alternativas descartadas

- **Pedir el conteo dentro de la lectura del patrón o del bouquet.** Cambiaría
  `PROMPT_VERSION` del patrón (fijado) y del armado, y mezclaría dos preguntas en un
  esquema que el modelo ya llena al límite. Una llamada aparte cuesta
  ~US$0,002–0,01 por foto y se apaga sola.
- **Contar en el prompt congelado del reconocedor (v16).** ADR-0029 lo congela
  byte a byte y su caché y su línea base dependen de ese hash.
- **Dar al modelo globos por metro por densidad para que "estime".** Segundo dueño
  de las reglas de `plan.py` (ver decisión 4).
- **Un esquema de contrato aparte (`conteo-referencia.schema.json`).** Agregaría un
  archivo y un modelo generado sin consumidor en Python más allá de esta lectura;
  el blueprint ya lo exporta y Python lo lee de ahí.
- **Recortar valores fuera de rango** (p. ej. `globos_por_racimo: 9 → 8`). Una
  cuenta recortada es una cuenta inventada: fuera de rango se descarta.
- **Agregar `pistas_conteo` ya en E1.** Ver decisión 10.

## Consecuencias

- Con la bandera apagada no cambia nada: ni llamadas, ni blueprint, ni prompts; los
  31 vectores dorados siguen iguales.
- Encendida, cada foto con estructuras de globos suma una llamada de visión
  (~US$0,002–0,01), en paralelo con las otras lecturas (no alarga la ruta más que la
  lectura más lenta). El blueprint gana `appearance.conteo`, que viaja al chat y a
  la generación sin que ninguno lo use; `scene-spec` lo incluye en su hash del
  blueprint, como el patrón y el armado.
- El contrato del blueprint cambió: App y `ai-api` se despliegan juntos (un
  blueprint con `conteo` lo rechazaría el `ReferenceBlueprint`/`Request` generado
  de la revisión anterior, `additionalProperties: false`).
- Depende de que v16 reconozca bien las piezas: si llama arco a una guirnalda
  colgada, la cuenta cae en la regla del arco. Se mide en E7.

## Rollback

Apagar `CONTEO_REFERENCIA_PYTHON_ENABLED`. Para quitar el código: revertir los
commits de E1 y desplegar app y `ai-api` juntos. No hay datos en el servidor que
migrar (las lecturas viven en la caché del proceso, que el despliegue vacía); un
blueprint con `appearance.conteo` que una sesión del navegador conserve
(`sessionStorage`) lo rechazaría la revisión anterior, y se resuelve volviendo a
analizar la foto.
