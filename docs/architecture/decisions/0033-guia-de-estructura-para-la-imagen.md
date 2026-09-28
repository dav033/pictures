# ADR-0033 — Guía de estructura para la imagen

Date: 2026-09-28
Status: accepted detrás de `GUIA_ESTRUCTURA_V1` (apagada). Se enciende o no con la
corrida comparativa de `scripts/ops/generar-guia-estructura.ts`, que nadie ha corrido.
Supersedes: nothing. Relacionado: ADR-0025 (QA visual retirado), ADR-0028 (patrones),
ADR-0032 (guirnaldas por partes, decisiones 26 a 28).

## Problema

El LoRA solo recibe la estructura como texto. Con una guirnalda en la pared, la
forma, la caída, el arqueo y el desnivel no caben en palabras (el LoRA no admite
cifras) y el modelo vuelve al sesgo de su corpus: una espiral de cuartetos salió
como cintas retorcidas y la guirnalda arqueada del usuario, como un arco
rectangular con dos patas al piso (`SEGUIMIENTO-guirnaldas.md` §8). Arreglar la
redacción ayudó, pero sigue sin medirse y no puede describir una silueta.

Además había un defecto latente: `REFERENCIA_EN_ETAPA1_V1=true` no cambiaba nada.
La ruta pasaba las referencias de la etapa 1 del híbrido, pero
`generarConSempertexLora` las volvía a filtrar con `referenciasParaLoraEdit`, que
devuelve `[]` sin foto del espacio ni resultado previo. Una guía que pasara por
ahí se perdía igual.

`clasificador-decoraciones` (mismo dueño) ya había probado mandar a
`fal-ai/flux-2/lora/edit` el dibujo de la estructura como **mapa de color plano**
con un caption: salió una foto, no el dibujo retocado. Es **una** imagen, no una
medición, y midió el color, nunca la silueta.

## Decisión

1. **Guía plana** (`src/lib/ia/kagutsuchi/guia-estructura.ts`, pura y
   determinista). Un disco plano por globo, con su color y su tamaño relativo, en
   la posición y el orden de pintura de la gráfica del plan: `dibujarGuirnalda`
   (`armados_guirnalda[].racimos`, con relleno, remates y sueltos) y
   `dibujarPatron` (arco, columna y semiarco con `patrones_color` aplicado de
   racimos), importadas tal cual de `src/components/plan/*`. El color de cada
   globo es el de la leyenda de la gráfica (`leyendaGuirnalda`, `leyendaPatron`
   con el `conteo` de Python). Sin sombras, brillos, números, texto, cuerdas,
   anclajes ni bases (una cuerda se lee como cinta y una base como pata). Fondo
   neutro liso `#f4f4f2`, el del origen: la pared es ese fondo; solo lo que se
   apoya en el piso (arco, columna, semiarco, guirnalda en el piso) lleva un plano
   de piso. Contorno fino en los colores claros, porque sin él el blanco
   desaparece (lección del origen). La figura se encaja en el aspecto de salida
   (`imageSizeFor`) con el lado mayor en 1024 px.
2. **Cuándo hay guía.** Solo con UNA estructura en la escena (una pieza, sin
   repeticiones ni props de catálogo): una guirnalda con armado, o un arco,
   columna o semiarco con patrón aplicado. Varias piezas exigirían repartirlas por
   `target_bbox`: otro trabajo. Y solo en la generación con LoRA directo, sin foto
   del espacio, sin resultado previo (esas ya son la base de `/edit`), con `/edit`
   disponible y caption de texto (`generacionAdmiteGuia`).
3. **Carta de color muda** (port de `carta.ts`): franjas verticales planas con los
   colores de la guía, en el orden en que se pintan, sin una letra.
4. **Rasterizado en el servidor** (`rasterizar-guia.ts`, `server-only`): `sharp`,
   ya dependencia, pasa los dos SVG a PNG y comprueba el tamaño y un máximo de
   1,5 MB (la guía pesa decenas de KB). A registros y telemetría solo llega su
   sha256.
5. **La guía en la generación.** La ruta pasa `[guía, carta]` por la opción nueva
   `imagenesEdit` y el LoRA va a `/edit` con la guía como `image_urls[0]`. Prompt:
   `trigger, <nota de la guía>\n\n<caption>\n\n<nota de la carta>`, como el origen
   (la nota delante es la que evita el dibujo retocado). Las notas se adaptaron al
   registro de los captions: la del modo plano pasa de ~330 a ~240 caracteres sin
   perder sus tres ideas (no es una foto; cada disco es un globo; rehazla como foto
   real con ese contorno, disposición y colores, luz y sombras reales), y la de la
   carta de ~390 a ~100 (solo es una carta; iguala los colores; no pintes sus
   franjas).
6. **El largo: cómo se compacta.** Las notas cuentan contra el presupuesto del
   caption (`LORA_PROMPT_MAX_LENGTH`, 750), igual que la instrucción de
   presentación del híbrido: el prompt entero sigue en el registro del LoRA. El
   compilador compacta el caption con sus pasos de siempre (tamaños, entorno,
   cola, etiquetas; nunca estructuras, colores ni el patrón). Si ni así cabe, sale
   la carta con su nota (la guía es la que manda la estructura); si tampoco, la
   generación sigue **sin guía**, como con la bandera apagada, y lo registra
   (`usada: false`). El preflight corre sobre el prompt final con las notas, y
   siguen el control de idioma, el de fugas de producto y
   `LORA_EDIT_PROMPT_MAX_LENGTH`. Medido con los dos casos: el arco con patrón
   cabe con carta (741); la guirnalda del usuario, cuya frase de Python es larga,
   solo sin carta (715; con carta daría 774). Descartado: dejar las notas fuera
   del presupuesto, como el bloque `INPUT IMAGES` del venue; el caption quedaría
   igual, pero el prompt pasaría de mil caracteres, y pasar de 406 a 1567 ya sacó
   al LoRA de su registro (`sempertex-lora.ts`).
7. **El filtro, arreglado.** `imagenesEdit` es una selección explícita que el
   adaptador no vuelve a filtrar: solo `SEMPERTEX_LORA_EDIT=false` la apaga, y se
   acota a cuatro imágenes. La ruta la usa para la guía y para las referencias de
   la etapa 1 con `REFERENCIA_EN_ETAPA1_V1`, y su preflight final las ve. Sin
   ninguna de las dos banderas no se pasa y la llamada es la de antes: prueba de
   regresión contra una instantánea capturada **sobre 90da1ef, antes del cambio**
   (`scripts/fixtures/guia-estructura/peticiones-base.json`), por los dos
   caminos: directo a fal y por Python.
8. **Python no cambia.** `app/kagutsuchi/lora.py` ya acepta `mode: "edit"` con
   hasta cuatro `image_data_urls`, bajo el tope de 11 MB de la ruta; la prueba
   `test-guia-estructura-python.ts` fija lo que TypeScript le manda.
9. **Coste y registro.** Cada imagen de entrada cuenta como un megapíxel a
   US$ 0,021 (precio del origen, sin verificar hoy contra fal: **estimado**). Una
   1536×1024 pasa de US$ 0,042 a 0,063 con guía y a 0,084 con guía y carta. La
   ruta registra `[generate] guía de estructura` con el hash, los bytes, las
   entradas extra y `coste_entradas_extra_usd_estimado`, y lo devuelve en
   `guiaEstructura`. La telemetría marca la llamada con
   `promptVersion: "guia-estructura.v1"` y ya contaba `bytesImagenEntrada`. En el
   origen, una imagen por `/edit` tardó 48,7 s.
10. **Medida gratis, fuera de producción** (`scripts/lib/medir-guia.ts`): la IoU de
    silueta contra la guía (recortada a su caja y en el encuadre entero), la razón
    alto/ancho de cada una (un arco con patas sale más alto) y la presencia de cada
    color, con tono y croma de la banda media de claridad (port de `fidelidad.ts`,
    sin promedios; los neutros no se juzgan). La máscara es aproximada: el fondo
    de cada fila es la mediana de sus bordes. Solo la usa el script de
    evaluación: ADR-0025 retiró el QA visual con reintento, y convertir esto en
    una puerta lo decide una persona, con su ADR.
11. **Corrida pagada, preparada y sin correr.** `scripts/ops/generar-guia-estructura.ts`
    sobre `scripts/lora/exp-fal-lib.ts` (que ahora admite `/edit` con `image_urls`,
    nunca imprime ni guarda un base64 y estima el coste). `v007-1000`, dos planes
    (la guirnalda en pared del usuario, `pared-arqueada-desnivel`, y un arco con
    patrón de flores), semillas 101, 202 y 303, brazos `sin` (hoy) y `con`
    (bandera encendida): 12 imágenes, **US$ 0,693 estimados**. Vista previa por
    defecto; gasta solo con `--confirm-spend --max-usd`; salidas fuera del repo;
    cierra con `medidas.json` y `hoja-comparativa.png` (guía | sin | con).

## Alternativas descartadas o medidas por el origen

- **ControlNet (canny, depth).** En fal solo existe para FLUX.1 [dev] y el LoRA
  es FLUX.2: hay que elegir entre control y estilo entrenado. Revisar si aparece
  un FLUX.2 con control y LoRA: reemplazaría esta decisión.
- **`strength`.** No existe ni en `flux-2/lora` ni en `/edit`.
- **Fotos de producto como referencia de color** (`edicion-plano-muestras`):
  copiaban el objeto y el fondo. La carta muda las reemplazó, y nunca se midió.
- **Los otros modos del origen.** El dibujo con sombreado se arriesga a volver
  retocado; la silueta negra pierde los colores. El mapa plano lleva forma y color.
- **Compensar el croma, medir promedios, códigos o PMS en el prompt:**
  descartados en el origen (§17, §21, §24).
- **Mover la geometría a `src/lib/plan/dibujo/`** (la propuesta del análisis):
  no ahora, porque `fix/guirnalda-curvatura` cambiaba esos archivos en paralelo.
  La guía los importa tal cual: si la gráfica cambia, la guía la sigue.

## Consecuencias

- Bandera apagada: la petición a fal (y a Python) es byte a byte la de 90da1ef;
  el caption, el preflight y la respuesta no cambian.
- Bandera encendida: dos entradas más por imagen (estimado), más latencia y un
  régimen que `v007` nunca vio: puede volver plano o copiar el fondo gris. Por
  eso se mide antes.
- `REFERENCIA_EN_ETAPA1_V1` ya tiene efecto si se enciende: la etapa 1 del híbrido
  va a `/edit` con hasta dos referencias y el bloque `INPUT IMAGES` ("No venue
  base; create venue from prompt."). Sigue apagada; su evaluación (fase 4) sigue
  pendiente.
- `src/lib/ia/kagutsuchi/guia-estructura.ts` depende de `src/components/plan/*`
  (módulos puros, sin React). Es la primera dependencia `lib → components`;
  queda como deuda acotada hasta mover la geometría.
- Límites de esta entrega: una estructura; solo el caption de texto (el JSON, el
  formato por defecto de `v004`, queda fuera); sin foto del espacio; paredes de
  rejilla, centros de mesa y bouquets no se dibujan.
- Licencias sin verificar: los pesos de FLUX.2 [dev] tienen licencia no
  comercial; el uso por API depende de los términos de fal y de BFL.

## Pendientes

- La corrida comparativa y la decisión de encender la bandera (una persona).
- Con foto del espacio: la guía en la etapa 1 del híbrido, o como tercera imagen
  de Gemini (riesgo: que pegue el diagrama).
- El texto genérico de Gemini ("physical supports", "strings, hooks, frames") con
  una guirnalda de pared con armado: la decisión 28 de ADR-0032 ya añade al
  candado del híbrido que los extremos quedan libres y sin patas; el resto de
  `build-image-prompt.ts` y del hard lock queda como lo dejó esa rama (cambiarlo
  movería la instantánea sin armado).
- El formato JSON y `v004`; varias estructuras por `target_bbox`.
- Si la generación migra a Python (ADR-0026), la guía migra con ella, y Python no
  tiene rasterizador SVG.

## Coste

| Petición (1536×1024) | Entradas | US$ estimados |
|---|---|---|
| Texto (hoy, sin foto) | 0 | 0,042 |
| `/edit` con guía | 1 | 0,063 |
| `/edit` con guía y carta | 2 | 0,084 |
| Corrida comparativa (12 imágenes) | — | 0,693 (tope sugerido 0,90) |

## Rollback

Apagar `GUIA_ESTRUCTURA_V1` (o `SEMPERTEX_LORA_EDIT=false`, que apaga todo `/edit`).
Para quitar el código, revertir los commits: no cambian contratos, `plan_hash`,
Python ni datos guardados, así que la app se revierte sola.
