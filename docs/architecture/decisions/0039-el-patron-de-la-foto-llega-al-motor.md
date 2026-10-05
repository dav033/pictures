# 0039 — El patrón que la foto leyó llega al motor, con sus particularidades

Fecha: 2026-10-02
Estado: en ejecución (dentro de `ARMADO_ARCO_COLUMNA_V1`, encendida fuera de producción)
Sucede a: ADR-0028 (patrones de color por estructura) y ADR-0034 (el motor arma las tres estructuras)

## Problema

Había dos lecturas del mismo hecho y no se cruzaban.

**Lo que la foto dice.** Desde ADR-0028 §11 una llamada de visión aparte lee cómo están **dispuestos** los
colores de cada pieza de la foto del cliente y devuelve uno de ocho modos —`espiral`, `anillos`, `bloques`,
`degradado`, `aleatorio`, `flor`, `damero`, `zonas`—, los colores por nombre de catálogo en orden de
dominancia, los globos de un racimo y su confianza. Esa lectura alimenta `patron_color`.

**Lo que el motor sabe armar.** Desde ADR-0034 el motor del diseñador arma el arco con catorce patrones, la
columna con nueve y la guirnalda orgánica con tres repartos, cada uno con sus mandos. Es otro vocabulario.

**Lo que elegía la receta.** Al confirmar un plan, cada arco y cada columna sale con armado: el que el modelo
armó si se sostiene contra la pieza, y si no la **receta** del motor
(`app/armado_estructura.py`). Y la receta elegía el patrón por el **número de colores de la pieza**:

```
1 color  -> solido
2 a 4    -> la espiral con la que arranca el disenador
5 o mas  -> arcoiris (arco) u ombre (columna)
```

Nada mira la foto. La llamada desde Next (`registro-herramientas.ts`) mandaba el plan y lo que el modelo
armó, y ninguna pista. **Una columna que en la foto es un apilado de anillos salía en espiral**, con el mismo
precio y un croquis que no es la foto.

**Y el globo grande, peor.** `config_inicial()` de la columna trae `remate = {tipo: "globo", tamano: 24,
cantidad: 5}`, que es con lo que arranca un diseño nuevo en el editor del clasificador. Como la receta no
pasaba remate, **toda columna completada salía coronada con un globo de 24"**, lo hubiera en la foto o no, y
nada podía decir «esta columna no lleva nada arriba»: el `RematePedido` existía para el chat, pero ninguna
lectura lo rellenaba y el blueprint de referencia no tenía un solo campo del remate. El prompt de conteo de la
columna ya nombra *"the topper balloon or foil"*, pero solo para sumarlo al total.

## Decisión

**La lectura de la foto decide el armado de la receta, y lo que la foto no dice lo sigue poniendo el motor.**

### 1. Un solo sitio donde los dos vocabularios se cruzan

`app/patron_de_la_foto.py`. No valida armados (eso es la puerta del motor), no acota mandos (eso es
`_opciones_del_patron` con los controles que publica el motor) y no resuelve colores (eso es
`patron_color.material_de_color`, que ya los casa por nombre y, si no, por tono con ΔE CIE76 ≤ 25). Decide
**qué patrón del motor dice lo mismo que el modo leído**:

| foto | arco | columna | guirnalda (reparto) |
|---|---|---|---|
| `espiral` | `espiral` | `espiral` | — |
| `anillos` | `bloques`, `largo: 1` | `apilado`, `grosor: 1` | `racimos` |
| `bloques` | `bloques` | `apilado` | `tramos` |
| `degradado` | `ombre`, y `bloques` con dos colores | `ombre`, y `apilado` con dos | `tramos` |
| `aleatorio` | `punteado` | `aleatorio` | `azar` |
| `flor` | `floral`, y `punteado` con menos de cuatro colores | `punteado`, `sepCapas: 3` | — |
| `damero` | `diamante` | `diamante` | — |
| `zonas` | `bloques` | `apilado` | `tramos` |

Cada fila tiene su motivo escrito en el módulo. Las tres celdas vacías son reales: una guirnalda orgánica no
arma una espiral, una flor ni un damero, y forzar un reparto sería armar otra cosa.

Lo que también viaja (y en §4, el eje y la simetría):

- **El orden.** El primer color de la lectura es el dominante y es el que manda en el patrón del motor (el
  fondo del punteado, el primer tono del ombré, el primer tramo del bloque, el primer color de la paleta de
  la guirnalda).
- **Los globos de un racimo**, que es la banda del arco (`globosAncho`) y la capa de la columna
  (`globos_capa`). Lo que se salga del rango lo acota el motor con su aviso: una lectura de 8 por capa queda
  en 6, que es lo que una columna arma.

Lo que **no** viaja: los pesos. El reparto de la foto dice dónde va cada color; cuánto se compra de cada uno
lo dice la participación que el plan declara. Son dos dueños y ninguno pisa al otro.

### 2. Los mismos cortes que `patron_desde_pista`, por las mismas razones

Una confianza por debajo de 0,5 no se usa (y no avisa: su propio dueño tampoco la usaría). Un color de la
lectura que no es de ningún material de la pieza **tumba la lectura entera** —armar con los que sí casaron
sería armar otra pieza—. Un patrón que necesita más colores de los que la lectura nombra cae a la siguiente
preferencia, y si ninguna alcanza, a la receta de siempre. Todo eso **con su aviso**: degradar en silencio es
lo que no se hace.

### 3. El remate de la columna se lee, y ausente no es «ninguno»

La misma llamada que lee el patrón lee ahora, **solo en las columnas**, qué corona la pieza:
`remate.tipo` entre los cinco del motor (`ninguno`, `globo`, `racimo`, `estrella`, `corazon`) y su color de
catálogo. No lee el tamaño, ni los globos del racimo, ni el alto del foil: la foto no los mide y los pone el
motor.

**La distinción que es el motivo de todo esto:**

- **Campo ausente** = «no se ve la punta» (la corta el borde, la tapa algo, está borrosa) → el remate lo pone
  el motor, que sigue siendo su globo de 24". Es la decisión del 2026-10-02: paridad con el valor de partida
  del diseñador en `clasificador-decoraciones`, que es el repo dueño del armado.
- **`{tipo: "ninguno"}`** = «la punta no lleva nada», que es una lectura → la columna queda a ras de su último
  anillo.

Confundir las dos es coronar una columna que en la foto no está coronada, o al contrario. Por eso el remate va
en **su propio campo** del blueprint (`appearance.remate_columna`) y no dentro de `patron_color`: el remate no
es una disposición de color —una columna de un solo color lleva su globo igual, y por eso se lee aunque el
modo salga `ninguno`—, y `patron_color` viaja dentro del plan firmado, donde una lectura no tiene sitio.

### 4. El eje y la simetría también se leen

La lectura nació sin decir **por qué eje** recorre el patrón la pieza ni si sus **dos mitades** son iguales, y
las dos cosas ya existían en el patrón resuelto (`patron-color.v1` tiene `direccion` y `simetria`) y en el
motor (el ombré del arco tiene el mando «Dirección» con «A lo largo», «Simétrico» y «A lo ancho»; casi todos
sus patrones tienen el mando «Simetría (espejo)»). Nadie las rellenaba desde la foto, así que **un degradé que
en la foto baja de lado a lado salía siempre a lo largo** y un arco simétrico salía sin espejo.

`PistaPatronSchema` gana `direccion` (`longitudinal`, `transversal`, `diagonal`) y `simetria` (`espejo`), las
dos opcionales, y el prompt las pide para **cualquier** modo. La longitudinal no viaja: es el valor de partida
del patrón y del motor, y mandarla solo engordaría la pista.

**Quien las lee no sabe qué admite la pieza, y no tiene por qué.** Las reglas ya existen y tienen un dueño:

- En el patrón (`patron_color`), `modos_admitidos` publica por modo qué direcciones admite la estructura y si
  lleva espejo, que es la misma tabla que `_validar` aplica — solo una pared se arma de lado a lado o en
  diagonal, la diagonal solo con un degradé, y el espejo solo en un arco o en una guirnalda armada en U.
  `patron_desde_pista` pone cada una **solo si esa tabla la admite**, y **descarta en silencio** la que no:
  dejarla viajar haría que `validar_y_expandir` rechazara el patrón entero y la pieza perdería una lectura que
  sí servía, cayendo al preset.
- En el motor, `_mandos` las pone donde el mando existe. Una columna no se arma en espejo y su ombré no tiene
  dirección, así que allí la lectura no cambia nada. En el arco, `simetria: espejo` manda sobre el eje: un
  arco simétrico degrada desde los dos pies (`modo: 1`), no a lo largo.

Esto es lo que hace que el motor admita algo que el patrón no: el ombré **a lo ancho de la banda** de un arco
existe en el motor y `patron_color` solo lo admite en una pared. Los dos consumidores leen la misma pista y
cada uno aplica sus reglas.

### 5. La lectura alimenta la receta, no se cuela por delante del modelo

El orden de siempre no cambia: **lo que el plan trae**, luego **lo que el modelo armó** con
`armar_estructura`, y la receta como respaldo. La foto entra en la receta. Un armado que el modelo propuso y
se sostiene contra la pieza sigue ganando, porque ya pasó la puerta.

El armado que describe la foto se marca `origen: "referencia"`, que ya está en los tres contratos y es el
mismo valor que `patron_color` escribe cuando el patrón sale de una pista. La respuesta de la operación lo
refleja con un tercer valor de `origen` (`modelo`, `referencia`, `receta`) para poder medir cuántas piezas
salen de cada rama en el registro de la confirmación.

### 6. Contrato y camino

- `RemateLeidoSchema` y `PistaRemateSchema` en `src/lib/plan/armado-columna.ts`, que es el dueño del
  vocabulario del remate; `appearance.remate_columna` en `reference-blueprint.v2`. `direccion` y `simetria`
  en `PistaPatronSchema` (`src/lib/plan/patron-color.ts`), que es el dueño de la forma de la lectura. Camino
  de siempre: Zod → `npm run contracts:export` y `contracts:export:domain` → `generate_models.py`.
- **`direccion` y `simetria` van también en el modelo `PistaPatron` de `plan.py`**, que se mantiene a mano con
  `extra="forbid"`. Sin eso, la petición de plan entera habría devuelto 422 en cuanto el lector las mandara:
  es exactamente lo que pasó el 2026-09-30 con `zonas`. Y en `patronDePista` (`patron-referencia.ts`), que
  copia campo a campo — el otro sitio donde `zonas` se perdió.
- La operación `omoikane-armado-estructura.v1` gana `pistas` (el modelo `PistaPatron` de `plan.py`, el mismo
  que la resolución) y `remates`. No son contratos de dominio: es una operación interna.
- `pistasRemateDelPlan` en `registro-herramientas.ts`, con la misma regla que las otras cuatro lecturas: el
  elemento **aprobado** del blueprint del turno con ese `referencia_element_id`, una lectura por elemento.

### 7. Bandera

Ninguna nueva. Todo esto vive dentro de `ARMADO_ARCO_COLUMNA_V1` (encendida fuera de producción), que es la
que decide si un plan sale con armado del motor. **No lo gobierna `PATRONES_COLOR_V1`**: esa bandera decide si
Python escribe `patron_color` al confirmar, y aquí la lectura o está en el blueprint del turno o no está. Sin
lectura, la receta es exactamente la de antes.

## Alternativas descartadas

**Una llamada de visión nueva que devuelva el armado del motor ya hecho**, al estilo de `guirnalda_referencia`
(ADR-0032 E4). Sería más precisa y más fácil de evaluar, pero es una llamada paga más por foto para leer algo
que la llamada del patrón ya está mirando. Si la traducción resulta pobre en la evaluación, esta es la salida.

**Mapear en TypeScript.** Es la regla de la casa: la lógica de dominio vive en Python y el patrón del motor
decide cuántos globos lleva la pieza, o sea precio.

**Meter el remate dentro de `patron_color`.** Es lo que parecía más corto y es lo que habría roto la
resolución: `PistaPatronSchema` viaja en `pistas_patron` y el modelo `PistaPatron` de `plan.py` se mantiene a
mano con `extra="forbid"`. Añadir un campo solo a un lado es exactamente lo que el 2026-09-30 devolvió 422 en
producción con `zonas`.

**Que la receta deje de coronar la columna cuando no hay lectura.** Se evaluó y se descartó el 2026-10-02: el
criterio del armado se cambia primero en `clasificador-decoraciones`, y el globo de 24" es su valor de
partida. La foto puede decir «ninguno»; el silencio no.

## Consecuencias

- **Mueve el conteo y el precio de las piezas que la foto describe**, que es el punto: un apilado de anillos y
  una espiral no llevan los mismos globos. Solo afecta a planes nuevos con armado del motor, y
  `ARMADO_ARCO_COLUMNA_V1` está apagada en producción.
- Un armado leído de la foto cambia el `plan_hash` igual que cualquier otro: va dentro del plan firmado.
- La versión del prompt de `patron-referencia.v1` cambia (es un hash del texto y del esquema de salida), así
  que **la caché de detección por foto se invalida** y la primera lectura de cada foto se vuelve a pagar. Es
  lo que tiene que pasar: el prompt pide algo nuevo.
- Un remate `estrella` o `corazon` es foil y no se cuenta como látex: el motor ya lo separa en su compra.
- **Una pared leída con un degradé transversal o diagonal cambia** en la rama de `patron_color` (ADR-0028),
  que hasta ahora la armaba siempre a lo largo. Es la corrección de un defecto, no un efecto colateral, pero
  mueve el reparto de color de esas piezas y por tanto su conteo.
- El prompt de la lectura crece en tres párrafos. El de análisis de referencia de producción (v16, ADR-0029)
  **no se toca**: esta es una llamada aparte.

## Rollback

Apagar `ARMADO_ARCO_COLUMNA_V1` deja los planes nuevos sin armado del motor, que es el estado de producción
de hoy. Para quedarse con el armado y sin la lectura basta con no mandar `pistas` ni `remates` desde Next: la
receta vuelve a elegir por el número de colores sin tocar Python. Un plan que ya trae su armado lo conserva.

## Lo que no se pudo comprobar

- **Que el modelo lea bien el remate y el modo.** No se llamó a ningún proveedor: es calidad probabilística y
  necesita la evaluación con fotos reales. La traducción está probada caso por caso, la lectura no.
- **Si la tabla de equivalencias es la que un decorador elegiría.** Cada fila tiene su motivo y ninguna es
  arbitraria, pero tres son discutibles y conviene mirarlas con fotos delante: `damero → diamante`,
  `aleatorio → punteado` en el arco (el arco no tiene un «al azar») y `degradado → tramos` en la guirnalda.
- **El efecto en la imagen generada.** Las frases del armado ya entran al prompt de imagen en el arco; con la
  columna y la guirnalda no se midió con generación real.
- **Cuánto se parece el conteo resultante al de la foto.** No hay conteos reales etiquetados en el
  repositorio (ADR-0038, «Lo que no se pudo comprobar», dice lo mismo).
- **Que el modelo acierte el eje y la simetría.** Son las dos lecturas más fáciles de confundir desde una
  foto de frente: un arco en espiral y uno en espejo se parecen, y «a lo ancho de la banda» pide ver la
  profundidad. Como la longitudinal es el valor de partida y no viaja, un error cuesta poco; al revés —leer
  transversal donde era longitudinal— cambia la pieza entera. Es la primera cosa que debería mirar la
  evaluación con fotos reales.
- **Que `direccion` y `simetria` no le quiten pistas a `patron_color`.** Se descartan cuando la pieza no las
  admite y hay pruebas de eso, pero el camino de una pared con un degradé diagonal no se ha visto de punta a
  punta con una foto real.
