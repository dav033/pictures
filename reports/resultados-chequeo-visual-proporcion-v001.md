# Resultados del chequeo visual de proporción — v001

Ejecutado el 2026-08-26 siguiendo `protocolo-chequeo-visual-proporcion-v001.md`, que se escribió
y se congeló **antes** de mirar la primera foto. Muestra congelada en
`muestra-chequeo-proporcion-v001.json` (semilla 20260826).

## Resultado

| etiqueta | n | % |
|---|---|---|
| CORRECTO | 14 | 46,7 % |
| IMPRECISO | 11 | 36,7 % |
| **INCORRECTO** | **5** | **16,7 %** |
| total | 30 | 100 % |

**Métrica primaria: 5 incorrectos sobre 30 → banda 🟡 AMARILLO** (pre-registrada como 4–7).

IC 95 % (Wilson) para la tasa de error: **[7,3 % – 33,6 %]**. La corrección por población finita
(30 de 107) lo estrecha algo, pero el intervalo sigue tocando tanto la banda VERDE como la ROJA.
Esto es exactamente lo que el protocolo anticipó: **n=30 no distingue 10 % de 25 %**. El punto
estimado cae con claridad dentro de AMARILLO y la decisión se toma sobre el conteo observado,
como estaba escrito.

## Decisión que dispara la banda AMARILLO (texto pre-registrado)

> No incluir `proporcion_relativa_descripcion` en el texto de entrenamiento, **o** revisar las
> 297 a mano antes de incluirlo. El `caption` base no se toca.

## Los 5 errores

| # | orden | sub-tipo | qué falla |
|---|---|---|---|
| 5 | 13309 | `direccion-invertida` | Dice "large gold chrome … smaller and medium pearl white". El pedido tiene REFLEX DORADO solo en R-9/R-5 y SATIN PERLA hasta R-12: los blancos son necesariamente los más grandes. |
| 25 | 8411 | `direccion-invertida` | Pone los chrome plata grandes en la base y los chicos arriba. La foto muestra lo contrario: base con rosados/lilas grandes, chrome plata a media altura y menores. |
| 28 | 12967 | `atribucion` | "large chocolate-toned balloons **of varying sizes**" anclando la guirnalda, pero CHOCOLATE se compró solo en R-5, el calibre más chico. |
| 4 | 950000181 | `atribucion` | "9-inch … roughly 1.8 times … 5-inch" como anclajes, cuando los anclajes visibles son globos rojos gigantes a ~3,5–4× los del racimo. |
| 9 | 20070 | `gradiente-inventado` | "large … anchor **the top** of each cluster": en ambos racimos los mayores están en la franja media-baja. |

### El patrón que importa más que el número

> **Corrección, en dos pasos.** La primera versión decía **3 de 5** detectables sin visión. Al
> implementar quedó en **2 de 5**: #25 (8411) NO es detectable, porque su pedido tiene plata
> hasta R-12 y rosado/lila hasta R-9 — "plata grande / rosados chicos" es *consistente* con el
> pedido, y el error era posicional. Después, al agregar la regla de ratio calculado, volvió a
> **3 de 5**: #4 (950000181) sí queda al alcance, por su plantilla aritmética. O sea que el "3"
> original era casualmente el número correcto **con el caso equivocado**.

**3 de los 5 errores quedan al alcance de una regla sin visión**, por tres mecanismos distintos:

- **#5 (13309) — inversión entre colores.** El texto llama grande a un color cuyo diámetro
  máximo comprado está *por debajo* del máximo de otro color al que llama chico. Cruzable
  mapeando color → diámetro máximo desde el `desglose.json`.
- **#28 (12967) — variación sin respaldo.** El texto afirma "varying sizes" cuando el pedido
  confirma un solo diámetro redondo. Es también la clase de error de #13599, donde la
  "diferencia de tamaño" descrita era en realidad distancia a la cámara.
- **#4 (950000181) — ratio calculado.** El texto cita un cociente exacto entre calibres del
  catálogo (1,8 = 9÷5), señal de que se dividió en vez de mirar. Ojo con la precisión de esta
  regla: marca una *construcción sospechosa*, no un error confirmado — en `950000178` el mismo
  patrón daba un ratio defendible. Las otras dos reglas marcan contradicciones duras.

Los otros 2 (#25 posición, #9 disposición vertical) requieren mirar la foto: no hay ninguna señal
textual ni en el pedido que los delate.

**Estado: implementado.** `scripts/lib/comparacion-tamanos.ts` + chequeo 2 de
`auditar-tamanos-captions.ts`, con `scripts/test-comparacion-tamanos.ts` como test de regresión
(12/12, incluidos 7 controles negativos verificados contra la foto).

> **Nota de diseño del test.** La primera versión leía los captions vivos de disco y empezó a
> "fallar" en cuanto se corrigieron los dos errores — justo cuando debía seguir pasando. Ahora
> los casos positivos usan **fixtures congelados** (el texto exacto que tenía cada caption al
> detectarse el error) y solo los controles negativos leen disco. Un test que se rompe porque
> arreglaste el bug no protege de nada.

## Hallazgos colaterales (verificados sobre el corpus completo, no solo la muestra)

1. **Meta-comentario del prompt filtrado al texto — 12 captions** (no 3).

   > **Corrección.** La primera versión decía 3. Ese conteo salió de un detector con patrones
   > demasiado estrechos. Al buscar el vocabulario de *procedencia* completo aparecieron **12**:
   > el delator es la palabra **"confirmed"**, que es vocabulario de la instrucción, no de la
   > imagen. Un caption que describe una foto no tiene por qué decir "confirmed" nunca.

   Iban desde un `(no confirmed inch sizes for this order)` pegado al final hasta cláusulas
   enteras como *"…the confirmed R-5 (5-inch) size applies to the round balloon product, while no
   separate size is confirmed for the larger balloons"* o *"…additional white, orange, and green
   balloons **not listed in the order**"* (esta última dentro del campo `caption`, que es el que
   seguro se exporta). **Ya corregidos** — ver sección de estado más abajo.

   Se excluyeron a propósito 2 casos que *parecen* fuga y no lo son: `16280` describe una captura
   de factura y `20412` un flat lay de catálogo — ahí "invoice"/"catalog" describen la imagen de
   verdad.

2. **Ratio calculado en vez de observado — 22 captions** (no 8).

   > **Corrección.** La primera versión decía 8, buscando la frase exacta *"roughly 1.8 times"*.
   > Con las variantes (*about*, *approximately*, y otros cocientes) son **22**.

   Los ratios que aparecen son **1.8**, **2.4** y **1.33** — que son exactamente 9÷5, 12÷5 y
   12÷9: los cocientes entre calibres del catálogo. No es una medición, es una división. Y las
   **22 son entradas del blog, sin una sola orden real** — correlación perfecta con la fuente
   cuyo desglose es inferido, probablemente porque esos desgloses traen conjuntos de tamaños más
   chicos y simples (a menudo exactamente R-9 + R-5), que invitan a calcular en vez de mirar.

   El problema no es solo que a veces sea falso (en `950000181` la foto muestra anclajes a
   ~3,5-4×, no 1,8×). Es que **la misma frase queda pegada a 22 imágenes distintas**: como texto
   de entrenamiento no aporta señal específica de ninguna, y repetida así puede actuar como
   constante espuria.

   **Impacto real acotado: solo 2 de las 22 estaban aptas para entrenamiento**
   (`950000178` y `950000181`) — justo las dos que ya habían salido en la muestra. Ambas
   corregidas. Las otras 20 no entran a entrenar; quedan marcadas por la auditoría para que la
   alerta aparezca si alguien las promueve.

3. **Fotos binariamente idénticas dentro de la misma orden — 2 grupos.**
   `15142/foto-1.jpg == foto-2.jpg` y `20070/foto-3.jpg == foto-4.jpg`. Duplicados exactos con
   captions distintos: duplican el peso efectivo de esa imagen en el entrenamiento. (El azar de
   la muestra puso las dos copias de 15142 en posiciones #2 y #30 — se evaluaron por separado,
   como manda el protocolo, y ambas dieron IMPRECISO.)

## Desviaciones y limitaciones honestas

- **Corrección de rúbrica a mitad de camino**: en #6 (11262) apliqué mal mi propio criterio y lo
  marqué CORRECTO cuando usaba lenguaje genérico teniendo R-18/R-12 confirmados. Lo corregí a
  IMPRECISO al detectarlo en #19, antes de cerrar el conteo. **No afecta la métrica primaria**
  (solo se cuentan los INCORRECTO), y por eso no había incentivo de resultado en el cambio.
- **Las 8 fotos de la revisión informal previa no se pudieron excluir del todo**: la sesión
  anterior solo dejó registro de 2 por número. Si alguna de las otras 6 cayó en esta muestra,
  la tasa está levemente sesgada hacia terreno ya visto.
- **El revisor no está ciego** a la descripción mientras mira la foto, y es el mismo tipo de
  sistema que generó los captions. Sesgo plausible hacia CORRECTO — es decir, **16,7 % es más
  probablemente un piso que un techo**.
- Varios desgloses están incompletos respecto de la decoración fotografiada (#13191 y #9018
  tienen *una sola línea* para instalaciones enormes; #16024 y #19773 son inscripciones a cursos,
  sin globos). Eso limita cuánto puede anclarse un caption contra el pedido.

## Estado de ejecución

| # | recomendación | estado |
|---|---|---|
| 1 | No incluir `proporcion_relativa_descripcion` en el `.txt` de la primera corrida | **decisión tomada** — no hay script de export todavía, queda anotado para cuando se escriba |
| 2 | Regla de comparación invertida en el script de auditoría | ✅ **hecho** |
| 3 | Arreglar meta-comentarios y fotos duplicadas | ✅ **hecho** |
| 4 | Tratar las entradas del blog como clase aparte | ✅ **hecho** — quedó como gate dentro de la propia regla |

### Lo que la regla encontró sobre las 401

**Cero hallazgos nuevos.** Marcó exactamente los 2 errores ya conocidos (#13309, #12967) y nada
más. Es un resultado honesto y algo deflacionario: la regla es precisa (2/2, sin falsos
positivos) pero **no descubrió nada que no supiéramos**. Su valor real es como *guarda de
regresión* para captions futuros, y como evidencia de que esta clase de error no está extendida
en el corpus.

### El gate por fuente, y por qué existe

La primera corrida sobre las 401 dio **5 hallazgos**. Verifiqué los 3 nuevos mirando la foto:

- `950000058` — la afirmación de tamaño es **correcta** (los rose gold sí superan claramente a
  los acentos plata). Falso positivo. *Pero* destapó una fuga de meta-comentario que el detector
  no había visto.
- `950000136` — variación de tamaño **clarísima y real** en la foto. Falso positivo.
- `950000006` — borderline; variación leve, un solo calibre confirmado. Queda para criterio humano.

Los tres son entradas del blog. Ambas reglas comparten una premisa —*el desglose enumera todos
los tamaños presentes*— que vale para una orden real de Shopify pero **no** para el carrusel
inferido de una nota del blog. Sin la premisa no hay inferencia, así que la regla ahora no opina
sobre esas entradas. El discriminador es `desglose.cliente`: **las 204 órdenes reales lo traen
siempre, las 183 del blog lo traen siempre en `null`** — separación perfecta, sin depender del
formato del número.

### Cambios aplicados al dataset

- **12 captions** limpiados de meta-comentario (`scripts/limpiar-meta-comentario-captions.ts`,
  journal reversible en `data/processed/`).
- **2 captions corregidos**: `13309` (comparación invertida) y `12967/foto-4` (variación sin
  respaldo). Se suman a `13223` y `13599` de antes. Los 4 quedan como `editado_manualmente`.
- **2 fotos duplicadas desactivadas**: `15142/foto-1` y `20070/foto-4` marcadas
  `aptoParaEntrenamiento: false` con nota explicativa. **No se borró ningún archivo** — es la
  marca reversible que ya gobierna el export. Se conservó `15142/foto-2` por estar ya promovida a
  `general`. La población entrenable con proporción bajó de **107 a 105**.
- **Fuente arreglada** en `src/lib/ordenes/generarCaption.ts`: el prompt ahora prohíbe
  explícitamente hablar del pedido dentro del texto.

- **2 captions del blog corregidos** (`950000178`, `950000181`): eran las únicas 2 aptas de las
  22 con ratio calculado.
- **Regla de omisión afinada.** Marcaba 5 casos; 4 eran fotos de *paquetes sin abrir y flat lays
  de producto*, donde no marcar proporción es lo correcto porque no hay nada instalado que
  comparar. `feedback.esDecoracion` los separa exactamente. Ahora marca **1** caso real
  (`17060`), que queda para criterio humano — es una mezcla de tamaños leve y el campo no se usa
  en la primera corrida.

### Higiene del dataset, verificada de paso

- **0 fotos aptas con `esDecoracion=false`** — ninguna captura de factura ni flat lay de catálogo
  se coló al set de entrenamiento.
- **0 captions aptos truncados** (<90 caracteres).
- **140 aptas de 401** con feedback. Ese 140 es el tamaño real del set entrenable, y conviene
  leerlo junto al hallazgo de literatura: los estudios donde un modelo aprendió una regla
  generalizable de tamaño usaron entre 500 y 15.000+ imágenes.

Auditoría final sobre las 401: **0 violaciones** salvo las 20 de ratio calculado en entradas del
blog no aptas, que quedan visibles a propósito.

## Recomendación

1. **No incluir `proporcion_relativa_descripcion` en el `.txt` de entrenamiento de la primera
   corrida.** Es la opción que la banda AMARILLO habilita sin gasto adicional, y el `caption`
   base —que es lo que de verdad lleva el estilo— queda intacto.
2. Antes de reconsiderarlo, **agregar la regla de comparación invertida al script de auditoría**
   y correrla sobre las 107. Es barata y atrapa la clase de error más frecuente (3 de 5).
3. Arreglar los 3 meta-comentarios filtrados y decidir qué hacer con los 2 pares de fotos
   duplicadas (quedarse con una).
4. Tratar las entradas `95xxxxxxx` (blog) como clase aparte para cualquier señal de proporción,
   hasta que su desglose inferido se valide.
