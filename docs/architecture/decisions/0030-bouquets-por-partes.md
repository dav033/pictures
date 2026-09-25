# ADR-0030 — Bouquets por partes y registro de estructuras en Amaterasu

Date: 2026-09-25
Status: accepted (primera entrega sin UI, detrás de banderas apagadas)
Supersedes: nothing.

## Problema

Hasta aquí un bouquet era un `kit` con `unidades_declaradas` repartidas por
proporción de color (`plan._distribute_units`). El plan no sabía qué globo va en
la base y cuál es el remate, ni dónde van los globos número, así que no podía
haber gráfica numerada, hoja de armado ni pesas; el sistema de patrones de
ADR-0028 rechaza `kit` a propósito (trabaja con rejillas, y un bouquet se arma
por partes). Además, lo que Amaterasu sabe de cada tipo de estructura estaba
repartido entre prompts y módulos sin un lugar por tipo.

## Decisión

1. **Registro de estructuras en Amaterasu** (`services/ai-api/app/amaterasu/estructuras/`):
   un submódulo por tipo (`columna`, `arco`, `semiarco`, `guirnalda`, `pared`,
   `centro_mesa`, `bouquet`) con lo que las lecturas de la foto necesitan saber de
   él. La clave es el tipo del plan, o la estructura oficial cuando varias comparten
   tipo (un bouquet es un `kit`). Lo que ya vivía en Python se mudó sin cambiar un
   byte: la frase "dónde empieza la pieza" del prompt de patrones sale del registro
   y `PROMPT_VERSION` de `patron-referencia.v1` sigue en `0d8c93d34d672014`
   (fijado en `tests/test_estructuras_registro.py`). Los modos de patrón del
   detector pasan a leerse del contrato (un solo dueño). Las reglas del prompt
   congelado del reconocedor (TypeScript, ADR-0029) quedan donde están hasta su
   propia migración.
2. **Frontera detectar / armar.** Amaterasu solo describe lo que ve. El armado, el
   conteo, las pesas y las recetas son reglas comerciales y su único dueño es
   `services/ai-api/app/armado_bouquet.py`, junto a `patron_color.py`.
3. **Contrato `armado-bouquet.v1`** (dueño Zod: `src/lib/plan/armado-bouquet.ts`;
   solo forma, sin `.default()`): campo opcional `armado_bouquet` en la estructura
   (Plan 1.0 y 1.1). Variante (`base_aire`, `helio_apilado`, `helio_escalonado`),
   niveles de abajo hacia arriba en unidades Sempertex (suelto, pareja, trío,
   cuarteto, quinteto, sexteto) con el color de cada posición por índice de
   material, remate y números (dígitos y disposición: centro, lados o arriba). Con
   `lados` hay un grupo por dígito. Ausente, la resolución es byte a byte la de
   siempre.
4. **El armado nunca cambia lo que se compra.** Las cantidades por material siguen
   saliendo de `_distribute_units`; validar exige que el armado cuente exactamente
   esas unidades y la receta reparte esas mismas (el sobrante queda como globos
   sueltos). El total en COP es idéntico con y sin armado. Presente, el armado
   entra en `plan_hash` (es parte del plan firmado).
5. **Completar al confirmar** (`completar_armados` + `pistas_armado` en
   `plan-resolution.v1`, bandera `BOUQUETS_ARMADO_V1`, default OFF): cada estructura
   con `estructura_oficial: "bouquet"` sin armado recibe el de la lectura de la foto
   (confianza ≥ 0,5) o su receta. Ocurre en `_resolution_result`, con el catálogo ya
   leído (el tipo y el tamaño de cada globo salen de la forma y el título de la
   variante: no hizo falta tocar la consulta). Si no se puede acomodar sin cambiar la
   compra, la estructura queda como hoy.
6. **Salida derivada** `plan_resuelto.armados_bouquet[]`, fuera del snapshot y del
   hash: leyenda con **un código por material comprado** (cambia con el producto, su
   tamaño, su color y, en un número, su dígito), niveles en códigos, insumos que el
   catálogo no vende (pesa, cintas, helio estimado, varilla, base), duración
   estimada, pasos y avisos.
7. **Lectura en la foto** (`POST /internal/v1/ia/bouquet-referencia`, scope
   `ia.bouquet_referencia`, bandera `BOUQUET_REFERENCIA_PYTHON_ENABLED`, default
   OFF): una llamada de visión por foto con bouquets, **en paralelo** con la lectura
   del patrón y con el mismo vencimiento. Prompt, esquema y validación en
   `estructuras/bouquet.py`; la llamada común vive en `vision_estructurada.py` (la
   usan las dos lecturas). En Next, `bouquet-referencia.ts` elige los bouquets con la
   misma `identificarEstructuraOficial` que usa el chat y guarda cada lectura en
   `appearance.armado_bouquet`; la caché y las llamadas compartidas son las mismas
   de la lectura del patrón (`deteccion-compartida.ts`). Nunca rompe el análisis.
8. **Editar quita el armado.** Una edición que cambia los globos o el reparto de un
   bouquet con armado lo quita con un aviso (`plan_edicion._quitar_armado`): tras la
   edición ya no coincidiría con la compra.

## Reglas y sus fuentes

| Regla | Fuente | Efecto |
|---|---|---|
| Globos por unidad (pareja 2 … sexteto 6) | Sempertex, "Conceptos y técnicas – redondos" | valida niveles |
| Látex de menos de 9" no va con helio; R-5 no flota | Anagram Balloon Guide; tabla de helio de Sempertex | error `latex_pequeno_con_helio`; la receta usa base de aire |
| Cantidad impar en bouquets de helio (5 o 7) | Anagram Balloon Guide | aviso, no bloquea |
| Pesa = suma del peso de cada globo | "Helium & Weight Chart", Balloons Are Everywhere (2014) | insumo `pesa` |
| Sustentación, gas y horas de flotación por tamaño | Tabla de helio de Sempertex (2022) | helio estimado y duración |
| Apilado: capas de 3 y un remate encima | Qualatex, "Balloon Basics" | receta `helio_apilado` |
| Escalonado: pieza central y globos alrededor (5 piezas) | Anagram, paquete P75 | receta `helio_escalonado` |

Donde la tabla del distribuidor no tiene fila (látex de 9", 18", 24", 36"; números de
25" y 34"), el peso sale de la sustentación de Sempertex o de la fila más cercana y se
marca como **estimado** (aviso visible).

## Reglas del negocio (propuestas como supuestos; validadas el 2026-09-25)

- Números de 16" o menos van con aire en varilla.
- Qué variante sugiere la receta sin foto: base de aire si hay látex chico o números
  chicos; helio apilado con 6 o más látex grandes en múltiplos de 3; si no, escalonado.
- Las recetas con base (los dos primeros cuartetos son la base, el resto el cuerpo;
  el sobrante va suelto).
- Los pesos sin fila en la tabla del distribuidor se marcan como estimados, con aviso.
- Una cantidad par en un bouquet de helio solo avisa, no bloquea.

## Consecuencias

- Sin las banderas no cambia nada: los 31 vectores dorados siguen iguales y las
  peticiones de siempre viajan byte a byte.
- Con `BOUQUETS_ARMADO_V1`, los planes confirmados con bouquets cambian su
  `plan_hash` (llevan el armado) pero no su compra ni su total.
- `BOUQUET_REFERENCIA_PYTHON_ENABLED` agrega una llamada a Gemini por foto con
  bouquets. Depende de que el reconocedor llame bouquet a los bouquets (v16,
  ADR-0029).
- Una edición de globos o reparto quita el armado; hoy no se vuelve a sugerir hasta
  un plan confirmado de nuevo.

## Segunda entrega (2026-09-25): vista previa, edición, prompt de imagen y UI

Sigue la frontera de la primera: Python arma y redacta; TypeScript transporta y
dibuja.

9. **Vista previa sin catálogo** (`POST /internal/v1/plan/armado-bouquet`, scope
   `plan.armado_bouquet`, contrato local `plan-armado-bouquet.v1`): resuelve el
   armado que manda el editor o, con `armado_bouquet: null`, sugiere la receta,
   con `variante` (estilo) y `disposicion` (dónde van los números) cuando el
   decorador los eligió. El catálogo no se consulta: el navegador manda `globos`,
   lo que ya tiene de cada globo de la pieza en sus líneas resueltas (título,
   forma, diámetro, código de tamaño, color, acabado; `GloboNavegador`), y
   Python clasifica con ellos como clasifica con el catálogo al resolver
   (`contexto_bouquet_de_globos`). Los globos solo clasifican: las cantidades
   son las del plan (`_distribute_units`), nunca las unidades de las líneas. La
   respuesta trae el mismo `ArmadoBouquetResuelto` que `armados_bouquet` y las
   opciones que la compra admite (`variantes_admitidas`,
   `disposiciones_admitidas`, decididas en Python: sin helio con látex chico o
   números chicos; `lados` solo con dos dígitos y reparto par). Un rechazo
   `armado_invalido` de la pieza trae esas opciones también, para que el editor
   las siga ofreciendo sin sugerencia (`sin_armado_posible`).
10. **Acción `armado`** en `plan-edit.v1`: fija o quita (`null`) el armado de un
    bouquet. Sin catálogo, la edición valida forma y conteo contra el plan
    (`validar_armado_sin_catalogo`); la regla del helio con látex chico la
    vuelve a comprobar la resolución, que es la puerta final (`armado_invalido`
    422 con `motivo` y `mensaje`). Next la expone en `/api/plan-editar`.
11. **Re-sugerir tras una edición.** Una edición que cambia los globos o el
    reparto sigue quitando el armado, pero con `BOUQUETS_ARMADO_V1` Next pide la
    re-resolución con `completar_armados` y `completar_armados_de:
    [estructura_id]` (campo nuevo de `plan-resolution.v1`): solo la pieza editada
    recibe su receta de nuevo; un bouquet cuyo armado el decorador quitó a
    propósito no lo recupera. Python avisa "se vuelve a sugerir" cuando la
    edición lleva `completar_armados`; si la re-resolución no pudo armarlo, Next
    añade "queda sin armado". Sin la bandera, el aviso es el de antes.
12. **Frase del armado en el prompt de imagen.** `armado_resuelto` escribe
    `prompt_gemini` (inglés, imperativo: "BOUQUET ASSEMBLY — …", niveles de abajo
    hacia arriba, remate, números y su disposición, con tamaños) y `prompt_lora`
    (inglés ASCII, sin cifras: los dígitos van deletreados, "foil number five
    balloon"). Los nombres de color salen de `x-colores-en` por las mismas
    funciones que el patrón (`nombre_color_en`, `color_con_acabado_en`). En Next,
    `frasesDeEstructuras` junta `patrones_color` y `armados_bouquet` en una sola
    lista y los constructores (Uzume, Kagutsuchi) insertan la frase de cada
    estructura por la misma puerta que el patrón (ADR-0028 §12), sin redactar.
    Sin patrones ni armados la petición es byte a byte la de siempre
    (`scripts/test/test-patron-color-prompt.ts`, caso bouquet, con una frase
    real de Python fijada a mano en `scripts/fixtures/patron-color-prompt/armados.json`).
13. **UI** (`src/components/plan/bouquet/`): bloque "Armado del bouquet" en la
    tarjeta (dibujo, nombre, insumos, avisos, "Editar armado" y "Hoja de
    armado"; "Crear armado" sin él), gráfica numerada por niveles (de abajo hacia
    arriba, remate, números al centro, a los lados —un grupo por dígito— o
    arriba; cintas y pesa en helio, base y varillas con aire), editor con
    autoguardado (estilo y disposición entre las opciones que devuelve Python;
    intercambiar dos globos, que nunca cambia el conteo; deshacer; quitar) y hoja
    de armado imprimible con las mismas reglas de impresión que la del patrón.
    TypeScript no tiene reglas: dibuja lo que Python devuelve y una permutación
    la valida la vista previa.

Consecuencias añadidas: `plan-resuelto.v1` gana dos campos en cada armado
(`prompt_gemini`, `prompt_lora`) y `plan-resolution.v1` uno opcional en la
petición (`completar_armados_de`); ningún vector dorado cambia. Queda para una
entrega posterior el conjunto de evaluación de la lectura en fotos reales con
tope de gasto declarado.

## Rollback

Apagar las dos banderas. Para quitar el código: revertir el commit; los planes que ya
traen `armado_bouquet` los rechazaría la revisión anterior (`additionalProperties:
false`), como en ADR-0028: App y `ai-api` se despliegan juntos.
