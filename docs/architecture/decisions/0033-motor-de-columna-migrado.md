# ADR-0033 — El motor de columna se migra de `clasificador-decoraciones`, verificado con vectores de oro

Date: 2026-10-01
Status: accepted (primera entrega: motor y contrato, sin cableado con el plan ni gráfica)
Supersedes: nothing. Convive con ADR-0028 (patrones de color por estructura).

## Problema

Aquí una columna se arma como una **rejilla genérica**: `patron_color.py` la
trata igual que un arco, un semiarco o una guirnalda —filas por columnas con
siete modos (espiral, anillos, bloques, degradé, confeti, flores, damero)— y
`geometria-dibujo.ts` la dibuja. Eso no es una columna: una columna es una pila
de **anillos** de 3 a 6 globos, cada capa girada medio paso sobre la de abajo
para que los globos caigan en los huecos de la anterior, con un tamaño que
puede afinarse por tramos de la base a la punta (R18 → R12 → R9), un plato de
base, un remate (globo grande, racimo, estrella o corazón de foil) y nueve
patrones propios, entre ellos el diamante, el punteado y el ombré.

Ese motor ya existe, está probado y tiene dueño: el repo
`clasificador-decoraciones` (`src/lib/columna/`, ~1.240 líneas de TypeScript
puro y determinista, con su investigación en `docs/investigacion-columnas.md` y
sus reglas en `limites.ts`). El 2026-10-01 David fijó la regla:
**`clasificador-decoraciones` tiene prioridad absoluta sobre toda la lógica** y
sus motores se migran aquí uno por uno. La columna va completa; el arco clásico
queda a medio camino y se hará después.

## Decisión

1. **Un solo dueño del criterio: `clasificador-decoraciones`.** Lo que decide
   cuántas capas caben, dónde va cada globo, de qué color es y qué se ajusta
   cuando el diseño es imposible se define allá. Aquí no se mejora, no se
   interpreta y no se "corrige": se replica.

2. **El puerto vive en Python**, `services/ai-api/app/columna/`, como manda la
   regla de este repo (Python es el dueño de las reglas; TypeScript mapea,
   valida la frontera y dibuja). Hay **un módulo por archivo del motor y con su
   nombre** —`tipos.py`, `patrones.py`, `motor.py`, `limites.py`,
   `medidas.py`—, para que qué le corresponde a qué se vea de un golpe y una
   diferencia no se pueda esconder; `js.py` es el único sin gemelo, porque es el
   puente entre los dos lenguajes. `app/armado_columna.py` es la cara pública:
   la puerta de este repo (validar un armado y resolverlo) y los reexportes que
   usará `plan.py`.

   Es una transliteración, no una segunda versión: cada función tiene su gemela
   allá, con el nombre a la vista. Están
   replicadas a mano las diferencias entre lenguajes que de otro modo desvían el
   resultado sin avisar: el generador pseudoaleatorio de 32 bits (`mulberry32`
   con `Math.imul`), `Math.round` (el medio hacia arriba, no al par), el resto
   de una división con negativos (JavaScript conserva el signo del dividendo) y
   `toFixed`, que aparece dentro del texto de los avisos.

3. **Vectores de oro generados por el dueño.** `clasificador-decoraciones/scripts/migracion/vectores-columna.ts`
   corre el motor de TypeScript sobre 135 diseños —el inicial, uno por patrón,
   los cuatro anchos de capa, los afinados, los cinco remates, los extremos de
   alto e inflado, el modo por capas y cinco entradas de basura, más 90 al azar
   con semilla fija— y escribe
   `contracts/domain/v1/golden/columna/vectores-columna.json` (717 KB).
   `services/ai-api/tests/test_armado_columna.py` compara contra eso: la
   **huella** (SHA-256) de todos los globos de cada caso —posición, radio,
   profundidad, color del patrón, tono, tamaño, capa y puesto—, el detalle globo
   por globo en los 45 casos con nombre, las capas, los totales, el conteo, el
   remate, los avisos, las medidas y la compra; que `sanear` es **idempotente**;
   y que `normalizar_config` llega al mismo diseño desde la misma entrada cruda.
   Más la puerta: que un armado del plan da la misma columna que el diseño del
   motor globo por globo, que dos materiales del mismo tono no se confunden, y
   que un armado imposible se rechaza con su motivo. **740 pruebas.**

   Son un oráculo congelado, como los de `plan-resolution`: vienen de la *otra*
   implementación, no de la que se prueba, y no se regeneran para que una suite
   pase. Si un vector deja de cuadrar, o el puerto se desvió (se arregla aquí) o
   el criterio cambió allá (se cambia allá, se regeneran y el commit dice por qué).

   La puerta traduce con **colores testigo**: el motor trabaja con una lista de
   colores y recibe uno por material del armado (`#000001`, `#000002`…), así que
   el color de un globo vuelve a su índice sin ambigüedad aunque dos materiales
   distintos tengan el mismo tono. El tono de verdad lo pinta la gráfica.

4. **Contrato `armado-columna.v1`**, dueño Zod `src/lib/plan/armado-columna.ts`,
   solo forma y sin `.default()`: modo (`altura` o `capas`), patrón y sus
   opciones, cuerpo (alto, globos por capa, tamaño abajo y arriba, escalonado,
   base), inflado (inflado, separación, compresión, variaciones, desorden,
   semilla), remate, capas y los materiales por **índice**, como
   `armado_bouquet` y `armado_guirnalda`. Más `ColumnaResueltaSchema`: lo que
   Python devuelve y la gráfica pinta sin recalcular nada.

   Lo que **no** viaja: el brillo, la sombra, el contorno, el oscurecimiento por
   profundidad y la persona de 1,70 m de referencia, porque son pantalla; el
   desperdicio, el precio y cuántas columnas iguales se arman, porque son
   comerciales y los cuenta `plan.py`.

5. **Dirección del cambio**, en un solo sentido: criterio →
   `clasificador-decoraciones` → regenerar los vectores → replicar en
   `armado_columna.py` → correr la suite. Nunca al revés.

## Alternativas consideradas

- **Copiar los motores de TypeScript tal cual a este repo.** Es el 1 a 1 más
  literal y el más barato de verificar, pero pone a la interfaz a calcular lo
  que `plan.py` tiene que dominar, contra la regla de este repo, y deja sin
  resolver quién cuenta los globos que se compran. Descartada por David el
  2026-10-01 al elegir destino Python.
- **Ampliar `patron_color.py` con los nueve patrones de la columna.** Más
  pequeño en código, pero convierte a este repo en un **segundo dueño del
  criterio**: las dos definiciones del mismo patrón se separan con el tiempo, que
  es exactamente lo que ya costó aquí un diagnóstico de una mañana cuando
  `validateMaterialEstimate` recalculaba catorce totales.
- **Mixto: el motor en TypeScript para la geometría y Python contando.** Dos
  fuentes que tienen que cuadrar; mismo defecto que la anterior.

## Consecuencias

- El mismo motor existe en dos lenguajes, lo que la regla general de este repo
  evita. Se acepta porque el **dueño sigue siendo uno** y la igualdad no se
  confía a la buena fe: se mide en cada corrida de la suite. Esa suite es la
  única cosa que sostiene la decisión; si deja de correrse, la decisión deja de
  valer.
- Dos de los tres desvíos que se probaron a propósito (una inclinación de
  espiral del 0,49 en vez del 0,5; un redondeo de color quitado) los caza la
  suite con 4 y 178 fallos. El tercero (mover el corte del bucle de capas de
  `i >= 2` a `i >= 3`) no cambia ningún resultado: los candidatos posteriores al
  corte siempre quedan más lejos del alto pedido. Es un mutante equivalente, no
  un hueco de cobertura.
- `patron_color.py` sigue sirviendo a la columna hasta que el cableado del punto
  siguiente ocurra. Hoy nada del plan referencia `armado_columna`, así que no
  cambia ningún número ni ningún `plan_hash`.

## Lo que queda, y una decisión que no es técnica

- **Quién cuenta lo que se compra.** El motor de `clasificador-decoraciones`
  cuenta sus globos y arma la lista de compra (con desperdicio por celda); aquí
  esa es competencia de `plan.py`. Con "decoraciones manda sobre toda la lógica"
  leído al pie de la letra, el conteo de una columna pasaría a salir del motor, y
  eso **mueve números comerciales de planes en vuelo**. Mientras no se decida,
  `calcular_compra` existe en el puerto solo para la paridad y no la usa nadie.
- Cablear `armado_columna` con `plan.py` (sugerir, validar y resolver, como la
  guirnalda), publicar el esquema (`contracts:export:domain` y
  `generate_models.py`) y escribir la gráfica que dibuje los globos resueltos.
- El arco clásico, que es la otra mitad del encargo y está a medio migrar.

## Rollback

Borrar `services/ai-api/app/columna/`, `services/ai-api/app/armado_columna.py`,
`services/ai-api/tests/test_armado_columna.py`,
`src/lib/plan/armado-columna.ts` y
`contracts/domain/v1/golden/columna/`. Nada más los referencia: no hay contrato
publicado, ni campo en el plan, ni ruta, ni componente. El generador de vectores
vive en el otro repo y no estorba.
