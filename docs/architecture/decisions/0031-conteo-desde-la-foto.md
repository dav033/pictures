# ADR-0031 — Conteo de globos desde la foto de referencia

Date: 2026-09-25
Status: accepted. E1 (lectura, contrato y blueprint) y E2 (usar la lectura al confirmar), las dos detrás de banderas apagadas. Falta la evaluación pagada.
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

### E2 (hecha): usar la lectura al confirmar

11. **La regla de kits del plan original queda reemplazada.** En
    `SEGUIMIENTO-guirnaldas.md` §2.1 la regla era "en kits manda la lectura del
    armado si existe; si no, el conteo". Un caso real la descartó: un bouquet de
    más de 30 globos salió con 11. La lectura del armado describe una unidad por
    nivel (`SEGUIMIENTO-bouquets.md` §14; la rama `fix/bouquet-conteo-niveles` le
    agrega `cantidad` por nivel). Ahora **el conteo da la cantidad y el armado la
    distribución**.
    - F = piezas fijas del armado leído (remate × grupos + dígitos).
    - A = látex del armado.
    - C = cuenta usable del conteo: con confianza de al menos 0,5, los globos
      visibles si la cuenta es exacta; si no, el estimado; si no, racimos × globos
      por racimo. C incluye metalizados y números, porque el prompt de E1 los
      cuenta.

    Reglas:
    - Si |C − (A+F)| ≤ max(2; 15 % de C), se queda el armado.
    - Si no, total = C cuando la cuenta es exacta, y max(A+F, C) cuando no lo es.
      Un estimado puede subir la cifra, nunca bajarla, y un bouquet apilado casi
      nunca es exacto.
    - Los niveles leídos se reescalan a total − F por restos mayores; cada nivel
      conserva su unidad y sus colores, y en un empate va primero la base. El
      sobrante menor que una unidad va como sueltos de acento.
    - Queda un solo supuesto: "la foto muestra unos N globos; el armado leído
      tenía M: la cantidad quedó en T (el plan decía X)".

    Si la lectura del armado no existe o no se puede reescalar, se descarta:
    manda C si es exacta y max(declarado, C) si no, con la misma tolerancia. Un
    kit que ya trae armado no se toca, y uno que no se compra por globos sueltos
    tampoco.

    **Codificación.** Una lectura reescalada repite n veces un nivel de n
    unidades. `armado_bouquet._niveles_leidos` de hoy junta esas copias como n
    unidades, y con `cantidad` por nivel (la otra rama) cada copia contará 1.
    Por eso no hizo falta tocar `armado_bouquet.py`.
12. **Geométricas, en este orden.**
    1. La mezcla, solo si `por_tamano` la contradice claramente. Umbral: una
       variación total de al menos 0,3 frente a la mezcla del plan, y otra mezcla
       del contrato al menos 0,15 más cerca. Además, el catálogo del turno tiene
       que cubrir cada tamaño para cada material y el cliente no puede haber
       fijado tamaños.
    2. La densidad (sencilla, media, lujosa) con las medidas fijas.
    3. Solo si no alcanza, el eje (todas sus medidas por un mismo factor) dentro
       de ±35 %. La ventana se centra en las medidas del plan o, si la foto trae
       escala, en veces × la altura de la referencia: persona 1,7 m, puerta 2 m,
       mesa 0,75 m.

    Se elige la opción dentro de ±15 % que menos cambia el plan: medidas más
    cercanas, luego la densidad más cercana, luego la cuenta más cercana. Nunca
    fuera de la puerta física (`_physical_warnings`, sin tocarla). Las medidas
    nuevas se dicen "equivalentes a la foto (no medidos)". Con
    `espacio.fuente: cliente` las medidas no se tocan. Una pieza con patrón
    re-sincroniza sus participaciones; si el patrón ya no cabe, no se ajusta. Sin
    opción válida: `sin_ajuste_posible`, y el plan queda igual.
13. **Dónde corre.** Las reglas están en `services/ai-api/app/conteo_foto.py`, que
    no importa `plan.py`: lo que necesita le llega en `PuertoPlan` (contar, puerta
    física, cobertura de mezcla, contexto del kit, re-sincronizar el patrón).
    `plan._aplicar_conteos` corre al inicio de `_resolution_result`, con el
    catálogo leído y **antes de toda completitud de armados**: los bouquets aquí
    y, en `feat/guirnaldas`, `completar_armados_guirnalda`. El conteo decide
    cuántos globos hay y los armados solo los acomodan. Al fusionar, esa línea
    va primero.
14. **Contrato** (`src/lib/plan/conteo-referencia.ts` → `domain-v1.ts` → export →
    `generate_models.py`):
    - en `plan-resolution.v1`: `completar_conteos`, `pistas_conteo[]`
      (`PistaConteoSchema`, validada en Python contra el esquema exportado) y
      `completar_conteos_de`;
    - en `plan-resuelto.v1`, **fuera del hash**: `conteos_referencia[]` con la
      lectura, la decisión (`ajustado`, `coincide`, `sin_ajuste_posible`,
      `no_confiable`, `sin_aplicar`), los globos de la foto, antes y después, los
      cambios y el motivo.

    Lo que cambia del plan (unidades, densidad, mezcla, medidas, armado) sí entra
    en `plan_hash`, solo al confirmar. Sin `completar_conteos`, la resolución es
    byte a byte la de siempre (31 vectores dorados sin cambios), y el plan firmado
    es punto fijo.
15. **Next.**
    - `CONTEO_REFERENCIA_V1` (default OFF): al confirmar,
      `pistasConteoDelPlan` manda los conteos del blueprint (uno por elemento),
      solo si hay alguno.
    - Al editar (`aplicar-edicion.ts`, `conteosDeLaEdicion`), los conteos de
      `base.conteos_referencia` vuelven a viajar para no perderse. Solo una
      edición de mezcla pide ajustar la pieza editada (`completar_conteos_de`),
      con la mezcla que eligió el decorador; las demás piezas quedan
      `sin_aplicar`.
    - El chat (`serializeReferenceBlueprint`) recibe "conteo leído en la foto:
      unos N globos (aproximado; V visibles), R racimos de K" con la regla de
      declarar la cantidad en kits y no calcular globos en geométricas. Solo con
      la bandera y confianza de al menos 0,5; sin eso la línea es la de siempre.
      No se toca `armadoLeido`: lo cambia la rama del bouquet, y mientras tanto
      el texto dice que esta cuenta manda sobre el total de un armado leído.
16. **Evaluación sin costo por defecto** (`src/lib/eval/estructuras/conteo.ts`,
    `cli-conteo.ts`, `npm run eval:conteo`). Reutiliza la suite y el esqueleto
    del runner de reconocimiento: vista previa por defecto, tope de gasto con
    reserva de la cota, concurrencia, plazo, reanudación y telemetría durable
    apagada. Los crudos, las imágenes y la verdad humana
    (`sha256,globos,exacto[,familia]`) quedan fuera del repo.
    - Métricas: error relativo mediano por familia y en piezas densas (meta
      ≤ 25 %), y la parte a ±1 en fotos de hasta 15 globos contadas una a una.
    - Los tokens de la lectura de conteo no están medidos
      (`tokens-conteo-2026-09-28.json`, `medido: false`), y así se declara.
    - Solo se probó en vista previa y con un analizador simulado.

Supuestos a validar con el negocio:
- la tolerancia de ±15 % (mínimo 2);
- la ventana de ±35 %;
- las alturas de referencia;
- el umbral de contradicción de la mezcla;
- que un estimado nunca baje la cantidad de un kit.

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
- **"En kits manda la lectura del armado"** (plan original). Subcuenta los
  bouquets grandes (decisión 11).
- **Cambiar el largo antes que la densidad.** Un largo "equivalente" es una
  estimación, y la densidad no inventa medidas: el largo solo se mueve cuando la
  densidad no alcanza.
- **Tocar `armado_bouquet.py` para leer `cantidad`.** Es de la rama
  `fix/bouquet-conteo-niveles`. La lectura reescalada se codifica repitiendo
  niveles y funciona antes y después de esa rama.

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
- Con `CONTEO_REFERENCIA_V1`, los planes confirmados con conteos cambian su
  `plan_hash`: llevan las unidades, la densidad, la mezcla o las medidas
  ajustadas y su supuesto. Las re-resoluciones no, salvo la de una edición de
  mezcla.
- Pendiente de la fusión con `fix/bouquet-conteo-niveles`: donde un nivel leído
  no traiga tamaño, repartir con `por_tamano` del conteo. Hoy
  `_material_del_color` elige el primer látex del color, y el tamaño lo decide
  esa rama.

## Rollback

Apagar `CONTEO_REFERENCIA_V1` (los planes dejan de ajustarse) y
`CONTEO_REFERENCIA_PYTHON_ENABLED` (no hay lectura). Para quitar el código:
revertir los commits de E2 y E1, y desplegar app y `ai-api` juntos. Un plan ya
confirmado con ajustes los conserva: son parte del plan firmado, como un patrón
o un armado. No hay datos en el servidor que
migrar (las lecturas viven en la caché del proceso, que el despliegue vacía); un
blueprint con `appearance.conteo` que una sesión del navegador conserve
(`sessionStorage`) lo rechazaría la revisión anterior, y se resuelve volviendo a
analizar la foto.
