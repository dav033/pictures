# Seguimiento: el arco clásico, armado y editable

Que el arco aburrido deje de estimarse y se arme: una gráfica con sentido de la
que el conteo se **lee** en vez de calcularse con una fórmula de densidad, y que
la IA pueda editar con herramientas igual que edita el resto del plan.

## 0. Estado

Hechas las **cinco rebanadas**. **Un arco clásico ya no se estima: se arma, la
gráfica lleva exactamente los globos que se cobran, y la IA puede cambiar cómo
se arma y cómo se pinta con herramientas.** Seis vectores dorados se movieron,
de −2,5 % a −5,2 %, y eso es todo lo que se movió: el contrato no cambió y
ningún `plan_hash` se movió.

| Archivo | Qué es |
|---|---|
| `services/ai-api/app/arco_clasico.py` | El motor: anillos, posiciones, vano y total |
| `services/ai-api/scripts/calibrar_arco_clasico.py` | Compara el armado contra la fórmula; imprime la tabla, no cambia nada |
| `services/ai-api/tests/test_arco_clasico.py` | El motor: la que importa es que haya una posición por globo contado |
| `services/ai-api/app/plan.py` | `_es_arco_clasico` enruta, `_structure_count` traduce el fallo |
| `services/ai-api/tests/test_geometry.py` | Qué pieza va al motor y qué pieza se queda con la fórmula |
| `services/ai-api/app/patron_color.py` | El anillo del armado es la unidad del patrón |
| `services/ai-api/app/silueta_patron.py` | `_croquis_de_anillos`: el color de cada anillo, en su sitio |
| `tests/test_patron_color.py`, `tests/test_silueta_patron.py` | La rejilla es el armado, y el 100 % de fidelidad |
| `src/lib/plan/edicion-esquemas.ts` | `densidad` y `patron_modo`: lo que el chat puede pedir |
| `src/lib/ia/herramientas/herramientas.ts` | El modelo ve las dos acciones y el vocabulario del anillo |
| `services/ai-api/app/plan_edicion.py` | Las aplica; `plan.py` arma el patrón del estilo pedido |
| `src/lib/plan/estructuras-oficiales.ts` | `arco` es el Arco clásico, también para el modelo de imagen |

Comprobado el 2026-09-30: `pytest -q` 1254 pasan y 4 se omiten (las de base de
datos, que ya se omitían), `ruff check app tests scripts` limpio, `mypy app` sin
incidencias. TypeScript no se tocó.

## 1. Lo que se decidió (2026-09-30)

**`arco` pasa a ser el arco clásico.** Sin clase nueva: la taxonomía se queda en
12. Queda coherente con lo que ya había —`arco_asimetrico` es «Arco orgánico» y
`arco_no_denso` el ligero—, así que `arco` era el único hueco para el simétrico
de cuartetos. Arrastra una cosa que hay que hacer en la rebanada 5: hoy `arco` se
le describe al modelo de imagen como `organic balloon garland arch`
(`src/lib/plan/estructuras-oficiales.ts:99`), y eso deja de ser cierto.

**El motor es el dueño del conteo, y la densidad se calibra para no mover el
precio.** Cambiar de dueño y cambiar de precio en el mismo commit es no poder
saber cuál de los dos rompió algo. La densidad comercial declarada se traduce a
las dos perillas del armado, elegidas para caer sobre lo que ya se cotiza.

## 2. El modelo de armado: anillos, no una rejilla

Un arco clásico se arma en **anillos**: ``k`` globos repartidos alrededor del
eje —un cuarteto son cuatro a 90°— y el anillo siguiente girado medio paso, que
es lo que los hace encajar y da el aspecto trenzado. El total es
``anillos × k``: un entero que se cuenta.

Esto **no** es el motor plano de `clasificador-decoraciones`
(`src/lib/arco/motor.ts`). Ese empaqueta globos en una banda de dos dimensiones y
es bueno para diseñar patrones, pero no cuenta un arco: no tiene la mitad de
atrás del anillo. El modelo de anillos está en el otro motor del mismo repo,
`ilustraciones/lib/estructuras.mjs`, que es el que dibuja «capas de 4 globos
alrededor del eje, cada capa girada 45°». La geometría se rescribió desde la
regla (dos globos vecinos del anillo se tocan: `2·A·sen(π/k) = d`), no se copió;
para el cuarteto da `A = 0,707 d` contra el `A = 1,35 r` medido allí, y una banda
de `2,41 d` contra `2,35 d`.

Por qué un módulo aparte de `app/silueta.py`: esa es la banda orgánica, donde los
globos se siembran y se relajan, y **no decide cantidades** (los `cupos` le
entran ya decididos). Aquí la cantidad es la salida. Son dos modelos de armado,
no dos ajustes del mismo.

## 3. La calibración

Salida de `scripts/calibrar_arco_clasico.py` el 2026-09-30, sobre cinco arcos de
catálogo con R-12. La fórmula de hoy es `ceil(λ · área / área_del_globo)` con
λ 2,8 / 3,6 / 4,5 y una banda de 1,3 diámetros (`plan.py:1294`).

| Densidad | Armado | Banda | Desvío contra la fórmula |
|---|---|---|---|
| `sencilla` | **cuarteto**: 4 por anillo, paso 0,75 d | 0,68 m | +1,9 % de media (0,0 % … +4,3 %) |
| `media` | **quinteto**: 5 por anillo, paso 0,75 d | 0,76 m | −2,0 % de media (−4,0 % … −0,5 %) |
| `lujosa` | **sexteto**: 6 por anillo, paso 0,70 d | 0,84 m | −1,8 % de media (−6,1 % … +0,4 %) |

Dos cosas que vale la pena mirar de esa tabla:

- La fórmula de hoy, en densidad media, equivale a un anillo de **cinco a seis
  globos**. Un cuarteto puro cotiza un 25 % menos: λ estaba calibrada para
  guirnaldas orgánicas, que llevan racimos, no anillos.
- Las tres densidades pasan a tener un nombre del oficio. «Cuarteto, quinteto,
  sexteto» es lo que dice un decorador, y `globos_por_anillo` es una perilla que
  un cliente entiende cuando se le explica.

Los totales del arco estándar de 4 × 2,5 m —120, 145 y 186— están congelados en
`test_la_calibracion_de_cada_densidad_esta_congelada`. Si se mueven, el precio de
un arco clásico se movió, y eso se decide, no se descubre.

## 4. Qué pieza va al motor (rebanada 2, hecha)

`_total_globos` enruta a `arco_clasico` cuando la pieza es `tipo: "arco"` con
`mezcla: "clasica"`, y **dos guardas la devuelven a la fórmula**. Las dos dicen
lo mismo: el motor de anillos solo cuenta lo que sabe describir.

- **Un solo diámetro.** Si el cliente fija dos tamaños y la mezcla efectiva
  queda con dos, la pieza no es un arco de anillos. (Un solo tamaño obligatorio
  *reemplaza* al R-12 y sigue siendo de un diámetro: ese sí se arma.)
- **Que quede vano.** El hueco entre las patas es `ancho − 2 × grosor`, así que
  cuando la banda llega a la mitad del ancho el arco se cierra. Cinco globos
  R-36 hacen una banda de 2,27 m: en un arco de 3 m no queda vano, y esa pieza
  la sigue contando la fórmula. `cabe_como_anillos()` es la pregunta; quien arma
  sin preguntar recibe `arco_sin_vano`.

No es un segundo dueño del número: el motor de anillos es dueño de los arcos de
anillos y la fórmula de todo lo demás, igual que ya lo era de las guirnaldas
orgánicas. Y no hay fórmula «de respaldo» para un arco que sí es de anillos: si
no se puede armar, la resolución falla con `arco_invalido` (422, con `motivo` y
`mensaje`, como `armado_invalido`) en vez de cotizarlo con un número inventado.

También se quitó una conducta que la regla del vano vuelve falsa: el motor ya
**no ensancha por su cuenta** un arco más angosto que su banda. Pedir 0,40 m y
recibir 1,81 m no es resolver la medida del cliente, es cambiarla.

### Los seis vectores que se movieron

Regenerado con `REGRESION_ACTUALIZAR=1 pytest tests/test_plan_regresion.py` y
revisado caso por caso. Solo cambian los arcos clásicos:

| Vector | Arco | Antes | Ahora | |
|---|---|---|---|---|
| `11-geometria-estructuras-oficiales` | 2,4 × 2,2 | 116 | **110** | −5,2 % |
| `15`, `18`, `19`, `25`, `26` | 2,5 × 2,2 | 118 | **115** | −2,5 % |

Comprobado a mano, sin pasar por el motor: en el de 2,4 m la banda del quinteto
mide 0,757 m, el radio queda en 0,821, la pata en 1,00 y la espina en 4,580 m;
entre 0,2103 de paso son 22 anillos de 5 globos, 110. En los de 2,5 m la espina
es 4,637 m, 23 anillos, 115.

En el vector 11 conviven las tres cosas, y es la prueba de que las guardas
funcionan: `EST_01_ARCO` (`arco`) baja a 110, mientras `EST_02_ARCO`
(`arco_asimetrico`) se queda en 82 y `EST_03_ARCO` (`aro_circular`) en 147.

El bloque `expected` de esos vectores **no se tocó, a propósito**: es el
registro histórico del resolutor TypeScript retirado (ADR-0023 paso 5), nadie lo
lee ni lo regenera. Desde este cambio diverge de `expected_python` en los seis
casos, y esa divergencia es correcta: dice que la cifra cambió después de que
aquella implementación existiera.

## 5. El color sobre los anillos (rebanada 3, hecha)

Un arco de anillos solo admite dos cosas pintadas, y son exactamente las dos que
tiene el oficio: el **anillo** (un color por capa: bandas de color) y el **hilo**
(el puesto `p` de todos los anillos, que forma una hebra continua a lo largo del
arco: la espiral trenzada).

**No hubo que inventar el vocabulario: ya estaba.** `patron_color.py` tenía los
modos `anillos` y `espiral` para el tipo `arco`, y su rejilla ya era
`filas × racimo`. Y `_UNIDADES` ya nombraba 4, 5 y 6 globos como **cuarteto,
quinteto y sexteto**, las mismas palabras a las que salió la calibración. Lo que
faltaba era una sola cosa: que ese racimo **fuera** el anillo real del armado en
vez de uno que el patrón elegía.

Se hizo con el mecanismo que ya existía para la guirnalda por partes (ADR-0032):
`EstructuraPatron.racimo_armado`, la unidad que un motor de armado impone al
patrón. Con el anillo ahí, `filas = round(total / k)` da **exactamente**
`anillos`, porque el total ES `anillos × k`: la rejilla deja de aproximar la
pieza y pasa a ser la pieza, una fila por anillo y una posición por hilo.

### La fidelidad es exacta, no alta

`_croquis_de_anillos` lee la rejilla por el sitio real de cada globo: la celda
`(anillo, hilo)` es la del globo de ese anillo y ese hilo. En la pared el mismo
control mide un 88 %, porque ahí el sitio y la matriz tamaño × material pueden
chocar y el color se sustituye; aquí no pueden chocar —cada celda tiene su globo,
cada globo su celda, y hay un solo tamaño—, así que la primera pasada de
`_materiales` cumple **todas** las preferencias. Lo mide
`test_cada_globo_de_un_arco_clasico_lleva_el_color_de_SU_anillo`, y exige el
100 %, no un umbral.

Se sigue pasando por `_materiales` de todos modos: él es quien garantiza que las
cantidades sean las de la matriz del despiece. Si alguna vez la matriz y la
rejilla dejaran de cuadrar, el croquis degrada como el resto en vez de dibujar un
color que nadie compró.

### Lo que un arco de anillos no admite

> Escrito en la rebanada 3. Las dos frases siguientes se quedaron viejas el
> 2026-10-01: ver §14.2 (la guarda del racimo) y §14.3 (la redacción por bandas).

- ~~**Un patrón con otro racimo.**~~ El anillo es el conteo, así que un patrón en
  racimos de cuatro sobre un arco de quintetos pintaría una rejilla que no es la
  pieza cotizada: `racimo_no_es_el_del_anillo`. En una guirnalda no se exige,
  porque allí el conteo lo sigue dando la fórmula y la rejilla lo aproxima.
  **Retirada** (§14.2): desde §12 la rejilla toma la banda del armado, así que la
  guarda ya no protegía el conteo y sí rechazaba cada toque del editor con 422.
- **El modo `flor`.** Cuelga un globo de su fila **sin darle posición**
  (`extras`), y el conteo del patrón es la rejilla más los extras: en un arco de
  anillos eso añadiría globos por encima del armado y el número volvería a salir
  de la rejilla en vez de la pieza. Además, en un anillo no hay dónde colgarlo:
  todos sus globos tienen sitio.

~~Y una que sí se dejó como estaba: la redacción por racimos de la guirnalda
(`guirnalda_por_racimos`) **no** se activa para el arco. Su razón era que el
modelo dibujaba cintas al leer «bands»; el anillo de un arco sí es una banda que
envuelve la pieza, y «stacked bands» es justo lo que hay que pedirle.~~

**Era falso, y costó una imagen.** El modelo dibujó las cintas igual en un arco
(§14.3): «bands» le vale tanto para un anillo que cruza la pieza como para una
franja que corre a lo largo, y elige la segunda. La excepción se retiró.

## 6. Las herramientas de la IA (rebanada 4, hecha)

Lo que esta rebanada iba a hacer, según el plan de la rebanada 1, era **añadir
campos al contrato**: `globos_por_anillo`, `paso_anillo_diametros`, el modo del
patrón. No hizo falta ninguno, y no añadirlos es mejor:

- **El anillo no es un campo, es la densidad.** `densidad` ya viaja en el plan y
  ya significa «qué tan llena va la pieza»; en un arco clásico eso es el anillo.
  Un `globos_por_anillo` aparte habría creado **dos dueños** de la densidad de un
  arco, que es justo lo que llevamos tres rebanadas quitando. Y las tres
  densidades tienen nombre de oficio, así que el vocabulario ya existía.
- **El patrón no lo compone el modelo.** Pedirle un documento
  `patron-color.v1` entero en una llamada de herramienta es invitarlo a producir
  patrones inválidos. En vez de eso nombra el **estilo** y Python arma el punto
  de partida (`sugerir_patron_modo`, el mismo que usa el editor cuando un
  decorador elige un estilo).

Así que el contrato no cambió, `plan_hash` no cambió de forma y no hubo que
regenerar modelos ni vectores. Las dos acciones nuevas de
`ajustar_plan_decoracion` son:

| Acción | Qué pide | Qué hace |
|---|---|---|
| `densidad` | `sencilla` \| `media` \| `lujosa` | En un arco clásico, cambia el anillo: cuarteto, quinteto o sexteto. Cambia el precio. Una estructura oficial que no admite esa densidad la rechaza con `densidad_no_admitida` y la lista de las que sí |
| `patron_modo` | el nombre del estilo | Arma ese estilo sobre el anillo real de la pieza, conservando lo que admita del patrón anterior. Un estilo que la pieza no arma vuelve como `patron_invalido` nombrando los que sí |

Ninguna de las dos trae variante, así que ninguna pasa por la allowlist del
turno: no hay nada que buscar en el catálogo, cambian cómo se arma o cómo se
pinta lo que ya se eligió. Las acciones del editor (`repartir`, `patron` con el
documento completo, los armados) **no** se le abrieron al chat: esas vienen de
una persona moviendo un control.

Y lo que no cambió: **el modelo sigue sin poder mandar cantidades**. Edita el
diseño; el motor cuenta.

## 7. El arco clásico para el modelo de imagen (rebanada 5, hecha)

`arco` pasa a llamarse **Arco clásico** y su `sustantivoEn` deja de ser «organic
balloon garland arch» —que era falso desde la primera rebanada— para nombrar lo
que es: un arco armado con anillos parejos de cuatro globos del mismo tamaño
alrededor del bastidor, simétrico.

La guía de estructuras oficiales que lee el modelo del chat dice además cuándo
NO es esta pieza: si el cliente pide una guirnalda orgánica —varios tamaños,
contorno irregular— eso es `arco_asimetrico` con mezcla `organica_fina`.

## 8. Lo que arrastra

- **Contrato**: **no cambió**, y por eso ningún `plan_hash` se movió de forma.
  El anillo se deriva de la densidad que el plan ya declaraba y las posiciones
  viven en `patrones_color[].posiciones`, fuera del snapshot. Comprobado
  volviendo a correr `npm run contracts:export:domain`: no movió ningún esquema.
- **Dirección única**: zod en `src/lib/ia/contracts/domain-v1.ts` →
  `npm run contracts:export:domain` → `generate_models.py` → vectores dorados.
  Nunca al revés. Las ediciones son otra cosa: son forma operacional, y su zod
  (`edicion-esquemas.ts`) y su pydantic (`plan_edicion.py`) se espejan a mano,
  como ya se espejaban las cinco acciones anteriores.
- **Vectores dorados**: `expected_python` se regenera solo cuando el cambio de
  cifras ES el resultado buscado, se revisa el diff caso por caso y el commit
  dice por qué. Nunca para poner verde una suite roja: eso congela la regresión
  en el oráculo y ya nada la encuentra.
- **Un solo dueño**: λ ya no cuenta un arco clásico de anillos. Lo que sigue
  contando es lo que el motor no describe (dos diámetros, un globo sin vano), y
  eso no es un respaldo: es otra pieza.

## 9. Cómo se revierte

Revertir el commit devuelve λ, la conducta de ensanchar el arco angosto, el
racimo que el patrón elegía y los seis vectores dorados anteriores. Lo persistido no cambia de forma —el arco
clásico no añade campos al snapshot hasta la rebanada 4—, así que los planes ya
firmados siguen resolviendo igual y ningún `plan_hash` se movió.

Lo que sí queda hecho y no se revierte solo: los planes cotizados entre este
cambio y una reversión llevan el conteo del armado. La diferencia es de un 2 % a
un 5 % del arco, no del plan.

## 10. El dibujo, porteado del clasificador (2026-10-01)

El conteo estaba bien y la colocación estaba mal. La tarjeta mostraba un
amontonamiento y no un arco, y la suite entera pasaba: **nada probaba la
geometría**, solo el total. Dos defectos, los dos del mismo sitio:

### 10.1 La normal de la espina estaba torcida

`_Espina.punto` devolvía la normal con la `y` cambiada de signo en los dos
tramos curvos. En las patas rectas daba igual. En la curva se iba separando de
la perpendicular hasta quedar, en la cima, **paralela** a la línea guía
(`|t·n| = 1`, medido): ahí la banda se tendía a lo LARGO del arco en vez de a lo
ancho. Como el anillo se repartía simétrico alrededor del eje, el conteo no se
enteraba y el dibujo parecía solo «apretado».

### 10.2 El anillo se proyectaba sobre sí mismo

Los `k` globos se colocaban por ángulo: `lado = A·sen θ`, `profundidad = cos θ`.
Dos ángulos con el mismo seno dan el **mismo sitio del dibujo**, así que los
globos iban de a pares, uno tapando al otro. De un sexteto se veían tres; los
otros tres estaban debajo, cotizados y escondidos.

Ahora los `k` globos se reparten **a lo ancho de la banda**, una columna cada
uno, con lo que trae `src/lib/arco/motor.ts` del clasificador:

- **anillos alternos corridos** ±1/4 de columna (el medio paso de giro del
  armado real, visto de frente): cada anillo cae en los huecos del anterior;
- **compensación de la curva**: a `v` metros hacia adentro, ese tramo mide
  `1 − κ·v` de lo que mide la línea guía, así que el globo de afuera crece y el
  de adentro se achica y la banda se toca pareja en la curva. κ es analítica
  (0 en la pata, `1/radio` en el semicírculo, la de la elipse en las otras
  formas), no sacada de dos puntos cercanos;
- **profundidad por columna**: la banda es un tubo, el centro de cara al
  espectador y los bordes al fondo, que es de donde salen las dos capas del
  croquis;
- **anillos parejos**: el sobrante de la línea guía se reparte entre todos
  (`largo / anillos`) en vez de dejárselo al último, que quedaba pegado al
  anterior.

Lo que **no** se trajo del clasificador es su modelo de conteo: allí el número
de globos sale del dibujo, y aquí el dibujo sale del número de globos. El paso
entre columnas se ata a eso: sale de exigir que la banda dibujada mida
`grosor_m`, que es la que se midió y con la que se calcularon el radio de la
espina y el vano. Con un paso más suelto el arco se dibujaba un 29 % más gordo
del que se cotizó, y se habría comido el hueco entre las patas.

### 10.3 El precio no se movió

`contar` es `anillos × k` y no lo tocó nada de esto: `TOTALES_ESTANDAR`
(120 / 145 / 186) sigue clavado y los vectores dorados no se movieron. En el
arco de la captura del usuario: 104 / 130 / 162 globos, con 104 / 130 / 162
posiciones, resueltos de punta a punta por `resolve_plan`.

### 10.4 Lo que ahora sí está probado

24 comprobaciones nuevas en `tests/test_arco_clasico.py`, todas sobre el dibujo:

- la banda va **de través** del arco y no a lo largo (la regresión de 10.1);
- **todos** los globos de un anillo se ven, en los seis tamaños de anillo (10.2);
- de borde a borde el dibujo mide `grosor_m`, medido en la pata recta;
- los anillos alternos van corridos media columna;
- en la curva el de afuera es más grande, y en la recta dos anillos de la misma
  paridad miden exactamente igual;
- el centro de la banda va delante y hay fondo y frente;
- nada se sale del ancho ni del alto declarados.

### 10.5 Lo que sigue pendiente

- **La densidad la sigue eligiendo el ajuste de ADR-0031**, que cuadra el total
  con los globos contados en la foto **con las medidas fijas**, aunque esas
  medidas sean supuestas. Por eso el arco de la captura salió en sextetos
  (31 globos/m) con una foto de cuartetos (19 globos/m): con 3 m de ancho no hay
  otra forma de meter 162 globos. Que los racimos de la foto fijen la densidad y
  sean las medidas supuestas las que se muevan **cambia precios** y es decisión
  del usuario.
- **Los patrones del clasificador que aquí no existen**: zigzag/chevron,
  diamante, punteado, franjas, dos lados, arcoíris y apilado. Aquí hay ocho
  modos (espiral, anillos, bloques, degradado, confeti, flores, damero, zonas) y
  la IA ya los mueve con `ajustar_plan_decoracion`. Añadir los otros es tocar el
  contrato, así que va aparte.

## 11. Los patrones porteados, y las perillas para el chat (2026-10-01)

Portear el dibujo dejó a la vista que el catálogo de patrones también estaba a
medias: el diseñador de arcos del clasificador tiene catorce y aquí había ocho,
y ninguno de los que faltaban se podía pedir ni desde la tarjeta ni desde el
chat.

### 11.1 La espiral se había roto, y la rompí yo

Con el reparto nuevo, cada hilo es una **columna fija** del dibujo. Una espiral
—que repite el mismo racimo en todos los anillos— salía entonces como rayas
paralelas al arco, no trenzada. En el motor viejo no pasaba porque el hilo era
un ángulo y cada anillo giraba medio paso, así que un hilo trazaba una hélice
de verdad.

El giro tiene que estar, y ahora está en el color: en un arco clásico la rejilla
se corre **un puesto por anillo** (`_gira_con_el_anillo`). En una guirnalda no,
porque ahí el racimo se gira al armarlo y correrlo además lo giraría dos veces.
Rotar una fila no cambia cuántos globos de cada color lleva, así que el conteo y
el precio son los mismos con giro y sin él, y hay una prueba que lo exige.

### 11.2 `intercalado`: el patrón de la foto

El arco de cuartetos alternados —dos tonos, cada globo rodeado de los del otro—
no se podía pedir. No es la espiral (que mantiene cada color en su puesto) ni el
damero (que pinta cuadros de `n × n` sobre una pared): se turna globo a globo
sobre el armado de la pieza y corre `paso` puestos por fila. Con `paso: 1` y dos
colores sale exactamente la foto.

### 11.3 Los ocho del clasificador

`franjas`, `zigzag`, `chevron`, `diamante`, `punteado`, `apilado`, `arcoiris` y
`doslados`, porteados de `src/lib/arco/patrones.ts` con sus perillas y sus
valores de arranque. Por dentro son tres familias y no ocho casos:

* **rayas** (`franjas`, `zigzag`, `chevron`): el color sale de
  `(fila + desplazamiento(columna)) / ancho`, y lo único que cambia entre ellos
  es el desplazamiento —recto, triangular o en V—;
* **por columna** (`apilado`, `arcoiris`, `doslados`): el color lo decide la
  posición a lo ancho de la banda;
* **motivos** (`diamante`, `punteado`): una distancia y un calendario.

`doslados` no se ofrece en una pared: una pared no tiene lado de afuera ni de
adentro, y llamarle «exterior» a su mitad izquierda sería mentir.

El `diamante` tiene un límite que conviene saber: en una banda de cuatro globos
un rombo de radio 1,8 ya ocupa todo el ancho y el patrón degenera en franjas.
Por eso su prueba lo mide sobre una pared, que es donde dice algo.

### 11.4 Las perillas, para el chat

Hasta ahora el chat solo podía pedir el estilo. Ahora `patron_modo` acepta
`ajustes` con cuatro perillas por su **nombre común** —`ancho`, `separacion`,
`inclinacion`, `invertir`— y Python las traduce al campo que lleva cada estilo
(`ajustar_perillas`): «separación» es `largo` en anillos, `paso` en intercalado
y `separacion` en la flor; «invertir» es `alternar` en dos lados.

Los topes **se leen del esquema exportado**, no se copian: si mañana una franja
admite ocho globos de ancho, esto lo admite el mismo día. Una perilla que el
estilo no tiene devuelve un aviso y no un error, que es lo que deja al chat
mandarla sin saber de antemano cuál lleva cuál.

Lo que **no** promete: que toda combinación valga. Un rombo cada dos filas en
una banda angosta no deja una sola celda de fondo, y ese color se quedaría sin
comprar; eso se rechaza con `material_sin_uso` nombrando el color, y
`patron_de_modo_para_estructura` lo convierte en un `patron_invalido` con su
frase para que el chat se corrija solo. Lo destapó la prueba que recorre las
cuatro perillas contra los nueve estilos en sus dos extremos, y quedó fijado a
propósito.

### 11.5 Lo que arrastró

* **Contrato**: nueve modos nuevos en `base`, por el camino de siempre (zod →
  `contracts:export:domain` → `generate_models.py`). Añadir variantes a una
  unión no mueve el `plan_hash` de ningún plan ya firmado: su JSON canónico no
  cambia.
* **El prompt que lee el patrón de una foto** (`patron_referencia`) describe los
  nueve, así que una foto con un arco de cuartetos alternados o con franjas se
  lee como lo que es. Su `PROMPT_VERSION` cambió a propósito y los dos tests que
  lo fijan dicen por qué.
* **El editor** muestra los diecisiete estilos con sus controles, y `Contador`
  aprendió a moverse de medio en medio para los anchos e inclinaciones.
* **La herramienta del chat** los describe todos y acepta las perillas.

Verificado: Python **1333 pruebas**, `ruff` y `mypy` limpios; `tsc` limpio,
`lint` sin errores, `plan:test` **313 comprobaciones, exit 0**.

### 11.6 La puerta de entrada, por tercera vez no

Con los modos nuevos puestos, la app devolvió «el servicio no está disponible».
El log del `ai-api` lo decía exacto:

```
contract validation rejected PlanResolutionRequest: pistas_patron.0.modo: literal_error
POST /internal/v1/plan/resolve -> 422
```

La lectura de la foto ya conocía `intercalado` y lo devolvió; el modelo de
entrada `PistaPatron` llevaba los ocho modos viejos **escritos a mano**, y con
`extra="forbid"` esa pista tumbaba la petición de plan ENTERA. El contrato
estaba bien y `patron_color` sabía armar el patrón: lo único que faltaba era
dejarlo entrar.

Ya había pasado igual con `zonas` el 2026-09-29/30, y el comentario que lo
contaba estaba tres líneas más arriba del defecto.

Por eso no se arregló añadiendo nueve cadenas a cada lista: **las dos listas se
retiraron**. `app/operational_models.py` expone `ModoPatronColor`, que valida
contra los `MODOS` que salen del contrato exportado, y lo usan tanto
`plan.PistaPatron` como `plan_edicion.PlanPatronRequest`. Añadir un modo al zod
y reexportar el contrato vuelve a bastar.

`tests/test_puerta_modos.py` lo vigila: recorre **todos** los modos del contrato
por las dos puertas y, además, barre `app/*.py` buscando cualquier `Literal[...]`
que vuelva a nombrar dos modos a la vez. Si alguien reescribe la lista a mano,
salta el mismo día.

### 11.7 La espiral no era una espiral

Con todo lo anterior puesto, la tarjeta mostraba «Espiral» y dibujaba cintas
paralelas al arco. No era el dibujo: era el **racimo**.

`_racimo_sugerido` intercalaba los colores a propósito (`A, B, A, B`), que es lo
razonable si uno piensa en «repartir los colores dentro del racimo». Pero en un
anillo que gira medio paso en cada capa, un racimo alternado vuelve a ser él
mismo cada **dos** anillos: lo que sale es el tejido de cuadros, no una banda
que avanza. Para que haya espiral, un color tiene que ocupar un **sector
seguido** del anillo (`A, A, B, B`); entonces ese sector avanza capa a capa y
dibuja la cinta continua del pie izquierdo, por la clave, al pie derecho.

Dicho de otro modo: el racimo que sugería la espiral era exactamente el del
patrón que ahora se llama `intercalado`. Los dos estilos dibujaban lo mismo.

El reparto no cambió —cuántos puestos lleva cada color lo sigue decidiendo la
participación por mayor resto—, solo el orden dentro del racimo, así que el
conteo y el precio son los mismos. Lo que sí se movieron son los racimos que
fijaban nueve pruebas de preset, todas con el mismo cambio: `[0,1,0,2]` pasa a
`[0,0,1,2]`, `[0,1,0,1]` a `[0,0,1,1]`.

Por qué no se vio antes: había pruebas del racimo y pruebas del giro, y por
separado las dos pasaban. Faltaba la que mira el resultado. Ahora está, y mide
lo que de verdad define una espiral:

* algún globo tiene al lado a otro de su mismo color (en un damero, ninguno);
* el dibujo no se repite cada dos anillos;
* la banda corre un puesto por anillo y cierra la vuelta en `k` anillos;
* cada color ocupa puestos seguidos del racimo, sin partirse en dos sectores;
* y `espiral` e `intercalado` no dibujan lo mismo.

Verificado: Python **1373 pruebas**, `ruff` y `mypy` limpios; `tsc` limpio,
`plan:test` **313 comprobaciones, exit 0**.

## 12. El motor igual al del clasificador, perillas incluidas (2026-10-01, tarde)

El dibujo seguía saliendo amontonado después del porteo de §10 y §11. **El
porteo no era el problema**: la geometría de `arco_clasico.py` es la de
`motor.ts` casi línea a línea. Lo que estaba mal eran los números que se le
metían y lo que se tiraba de su salida.

### 12.1 Las perillas estaban fuera del rango del propio motor

`separacion_filas` valía de 0,485 a 0,5975. En el diseñador del clasificador esa
misma perilla va de **0,7 a 1,4** y trae 1 por defecto: 1 es el empaquetado
hexagonal, donde dos filas vecinas se tocan. Con 0,485 y R-12 quedan **0,10 m
entre centros de fila para un globo de 0,28 m**: un 63 % de solape. Ese arco no
se puede armar —dos anillos no caben uno dentro de otro—, así que el dibujo
estaba enseñando la verdad.

Los valores viejos venían de §3: se habían elegido para que el **conteo** no se
desviara más de un 3,1 % de la fórmula λ anterior. Mientras ese número mandara,
el arco no podía verse bien; no era un arreglo pendiente, era una contradicción.

Lo decidió el usuario el 2026-10-01: **manda el motor**. La tabla pasa a

| densidad | banda | separación |
|---|---|---|
| `sencilla` | 3 | 1,10 |
| `media` | 4 | 1,00 |
| `lujosa` | 5 | 0,90 |

y el ancho del arco recorta la banda que no quepa (§12.2). Contra λ eso baja el
conteo de un **31 % a un 46 %** según la medida, medido sobre ocho tamaños de
catálogo. **Baja el precio del arco en esa proporción**, y es el cambio buscado:
λ estaba calibrada para guirnaldas orgánicas, que llevan racimos, y pedía para un
arco clásico más globos de los que caben en la pieza.

### 12.2 La banda la limita el arco, no la tabla

Se portó `RAZON_GROSOR_MAX` de `limites.ts`: la banda no pasa del **36 % del
ancho del arco**, o tapa la abertura. `globos_ancho_que_cabe` recorta lo que pide
la densidad, y así en un arco de 2,4 m las tres densidades caen a 3 a lo ancho y
lo que las separa es la separación entre filas.

Antes no existía y el motor fallaba con `arco_sin_vano` en vez de armar la banda
más gorda que sí entra. **Dos consecuencias que hay que mirar**: arcos que antes
se rechazaban ahora se arman (`test_un_arco_imposible_de_armar_se_rechaza_con_su_motivo`
ya no ve su error), y con globos grandes la banda se estrecha tanto que el conteo
se sale de la tolerancia de la puerta física (razón 0,48 contra el 0,6 mínimo, en
`clasica [18]`). Las dos son de la rebanada, no accidentes.

`_ancho_de_arco_clasico` devuelve la banda **recortada**, no la que pide la
tabla: con la otra, la rejilla del patrón habría sido más ancha que el arco y
`_croquis_de_arco` habría tirado el dibujo entero con `despiece_incoherente`,
en silencio, de vuelta a la rejilla genérica.

### 12.3 Lo que el motor calculaba y nadie leía

`posiciones` viajaba como `{x, y, r, capa, material}` y se perdía el relieve:

- **la profundidad continua** se aplastaba a `capa 0/1` con un umbral que dejaba
  en el fondo solo los bordes de las filas pares. Todos esos globos recibían el
  mismo velo negro plano de 0,34 y salían de color sucio. Ahora `capa` lleva los
  dieciséis escalones que el contrato ya admitía y la profundidad sin escalonar
  viaja en **`prof`**, con la que el dibujo aplica el velo del original
  (`0,34 · −prof · 0,8`, y **solo** en la mitad de atrás);
- **el orden de pintado** era `(capa, indice)`: dentro de una capa, el carril
  central de una fila se pintaba antes que los carriles de la siguiente y el
  relieve del tubo salía invertido a trozos. Ahora es el `z` del motor
  (profundidad, y a igual profundidad el sitio en el arco);
- **el giro** (`GloboArco.giro_grados`, nuevo) hace que el óvalo del globo siga
  la línea del arco en vez de quedarse vertical en la clave. Viaja en **`giro`**,
  cuantizado a 15° como allá. El reflejo **no** gira con él: la luz de la escena
  no se mueve con cada globo, así que se desgira por dentro;
- el dibujo **volvía a achicar** el globo del fondo un 12 % (`PERSPECTIVA_CAPA`)
  encima del `0,92 + 0,08 · frente` que el motor ya había aplicado. Con `prof` ya
  no lo hace;
- y ahora todo globo del motor lleva **contorno**, que es lo que separa uno de
  otro en una banda apretada (`contorno: 1` allá).

`prof` y `giro` son opcionales: el motor de silueta orgánico no los manda y su
dibujo sigue deduciéndolos de `capa`, como siempre. Viven en
`patrones_color[].posiciones`, **fuera del snapshot**, así que ningún `plan_hash`
se movió.

### 12.4 El color, en la columna real del globo

La diferencia de fondo con el original: allá el color es función de la **columna
fraccionaria** del globo (`patrones.ts`, evaluado una vez por globo); aquí salía
de una rejilla de celdas con el carril **entero**. Al redondear se perdía el medio
paso de las filas pares, que es justo de lo que vive la diagonal: la espiral se
dibujaba como rayas quebradas.

`app/banda_escalonada.py` (nuevo) es ahora el dueño del empaquetado —`carril_de`,
`columna_de`, `carril_sin_globo`—, puro y sin dependencias. Vive aparte de
`arco_clasico` porque este importa `app.silueta`, que acaba importando
`app.patron_color`: el patrón no podía preguntarle al motor sin cerrar un ciclo.
`arco_clasico` lo reexporta, así que `plan.py` sigue igual.

Con eso, en un arco clásico:

- **la espiral** usa `floor((fila + 2·c) / 2) % len(racimo)`, que es la
  inclinación y el ancho de franja por defecto del original. Cada medio paso de
  `c` adelanta un puesto, así que la franja mide un globo y avanza en diagonal;
- **franjas, zigzag y chevron** se evalúan en `c` en vez de en el carril, y el
  centro de la banda del chevron pasa a ser `n/2` como allá (en una rejilla llena
  sigue siendo `(columnas − 1)/2`: ahí las columnas son enteras).

**Qué color va en cada puesto lo sigue decidiendo el racimo**, que es quien
reparte la participación: esto cambia dónde cae cada puesto, no cuántos puestos
lleva cada color. El total no se mueve; el reparto por color sí se empareja (en
el arco de 3,0 × 2,5 m con cuatro colores, de 24/18/24/18 a 21/21/21/21).

### 12.5 Lo que queda

- **Las pruebas no se corrieron en esta pasada** (el usuario pidió no correrlas).
  Antes de esa petición, `pytest` sobre los cinco ficheros del área daba **23
  fallos de 384**, todos en lo que se movió a propósito: la calibración
  congelada de §3 (120/145/186), `FILAS_ARCO`/`ANCHO_ARCO` de las pruebas de
  croquis, las dos capas de profundidad, la espiral que se corría un puesto por
  anillo, y las dos conductas de §12.2. Hay que repasarlas **una a una** y
  decidir cada expectativa, no regenerarlas.
- **Sin tocar**: los vectores dorados (`expected_python` de los arcos se moverá
  cuando se decida), el diámetro inflado (aquí `0,92` lineal contra la tabla
  `INFLADO_PULG` de allá: un 5,2 % de diferencia, y afecta a **todas** las
  piezas, no solo al arco), el espejo (allá fuerza filas impares y escalona sobre
  la fila espejada; aquí no), y `MiniPatron`, que es un segundo dibujo propio y
  no sabe nada de la silueta.

## 13. La frase decía anillos y el croquis dibujaba una banda (2026-10-01, noche)

Reporte: un arco leído de una foto («CLASS 22», azul y dorado) salía en la
tarjeta con `12 pulgadas · 58`, participación `38 / 20` y esta frase:

> Tríos iguales de azul (1), azul (1) y dorado (2) que se encajan girando 1/6 de
> vuelta en cada capa: los colores forman espirales continuas del pie izquierdo,
> por la clave, al pie derecho.

### 13.1 Reproducido contra el código de hoy, no contra el `ai-api` viejo

`sencilla`, 2,6 × 2,5 m, R-12: el motor da **23 filas × 3 a lo ancho = 58
globos**, la pista de la foto da el racimo `[0, 0, 1]` y el reparto sale
**38 / 20 (66 % / 34 %)**. Los tres números de la cabecera y la frase entera
coinciden carácter por carácter, por el resolutor completo
(`resolve_plan`, no por las funciones sueltas).

### 13.2 La sospecha del `despiece_incoherente` queda descartada

Por el resolutor completo, ese patrón sale con `sin_silueta: null` y **58
posiciones**: el croquis lo dibuja `_croquis_de_arco`, no la rejilla genérica.
La rejilla y el armado no pueden discrepar, y no es casualidad: el total de la
estructura sale de `contar_arco_clasico` (`plan._total_globos`) y
`_filas_escalonadas` es la inversa exacta de ese conteo, así que
`len(celdas) == armado.filas` por construcción.

El dibujo tampoco está mal armado. Pintado con el mismo pintor, el croquis de
`arco_clasico.py` y el del motor de referencia (`motor.ts`, 2,6 × 2,5 m, banda 3,
separación 1,1) salen iguales salvo una fila, que es el 5,2 % del diámetro
inflado que §12.5 dejó sin tocar (60 globos allá, 58 aquí). Y el color de cada
globo coincide **sin una sola discrepancia** con evaluar a mano la fórmula del
original, `racimo[floor((fila + 2·c) / 2) % k]`, sobre la columna fraccionaria de
los 58 globos; ninguno de los 20 dorados queda suelto.

Lo que el usuario leyó como «ralo y con las patas finas» es un arco de **3**
globos a lo ancho, que es lo que `RAZON_GROSOR_MAX` deja entrar en 2,6 m con
R-12. Es la conducta de §12.2, no un defecto nuevo. (Con el diámetro inflado del
clasificador —0,2667 m contra 0,2804 m— ese mismo arco admitiría 4 a lo ancho:
`floor(0,36 · 2,6 / paso)` da 4 allá y 3 aquí. Sigue sin tocarse: mueve el
conteo y por tanto el precio de todas las piezas.)

### 13.3 La causa: la redacción se quedó en el modelo de anillos

`patron_color._Redactor` nombra la unidad con `_UNIDADES[k]` —«trío»,
«cuarteto»— y `_espiral` escribe «se encajan girando `1/(2k)` de vuelta en cada
capa». Eso describe un anillo de `k` globos enhebrado y girado, que es el modelo
que se retiró hoy. Un arco clásico es una banda escalonada: no hay nada que
girar, y la hoja de armado pedía montar una pieza distinta de la que enseña la
gráfica.

Lo que cambió, todo en `services/ai-api/app/patron_color.py`:

- **`_HILERA_DE_BANDA`**, la unidad de un arco clásico: `hilera`/`hileras`,
  femenina, `row` en inglés. `_Redactor` la usa en `unidad` y en `linea` cuando
  `_es_banda_escalonada`, así que **todos** los modos dejan de llamar «trío» a
  una fila de la banda (la espiral, el intercalado, los anillos, los bloques, el
  degradé y los acentos). Una columna, una guirnalda por racimos y un arco
  orgánico siguen byte por byte como estaban: su racimo sí se gira al armarlo.
- **`armado()`**: en una banda, «arma la banda hilera por hilera, alternando una
  de `n` globos y la siguiente de `n−1` corrida medio puesto».
- **`_espiral_de_banda`**: la frase y los dos pasos de la espiral dichos sobre la
  banda. No lee `trazo`, y está escrito por qué: en una banda escalonada la
  expansión tampoco lo lee —la rejilla sale siempre con la diagonal del motor—,
  así que anunciar un zigzag o unas franjas rectas describiría otra gráfica. El
  trazo sigue valiendo donde significa algo (columna, guirnalda).
- La concordancia del **intercalado** sale ahora de `unidad.femenina`, no de si
  la geometría es de racimos («la siguiente va corrida», no «el siguiente va
  corrido»).
- Dos mensajes de error que decían «arco de anillos»
  (`racimo_no_es_el_del_anillo` y la flor). El `motivo` **no** se tocó: es un
  valor estable del contrato.

El fragmento LoRA de la espiral no cambió —ya hablaba de franjas, no de
racimos—. La frase Gemini sí: pedía «clusters rotated one sixth of a turn per
layer», que es la misma pieza retirada. Va al prompt de imagen, que vive fuera
del snapshot, así que **ningún `plan_hash` se movió**.

### 13.4 Lo que no se tocó

- **El conteo y el precio**: `58`, `38 / 20` y las posiciones del croquis salen
  idénticos antes y después (comparados campo por campo). Esto es redacción.
- **El contrato**: ni zod, ni el esquema, ni los modelos generados.
- Comentarios con el vocabulario de anillos que quedan en `plan.py`
  (`_pattern_context`, «the ring: one row per ring, one position per thread») y
  en `silueta_patron.pieza_desde_estructura` (nombra un
  `plan._anillo_de_arco_clasico` que ya no existe). No cambian conducta; vale la
  pena pasarles una mano cuando se repasen las pruebas de §12.5.
- Los *fixtures* `scripts/fixtures/patron-color-ui/*.json` traen un arco clásico
  resuelto con la frase vieja. Son entradas congeladas de las pruebas de
  interfaz y ya estaban viejas desde §12; hay que regenerarlas en la misma
  pasada que las pruebas.
- **Las pruebas no se corrieron** (el usuario pidió no correrlas). Ninguna de las
  del área afirma sobre estos textos: las de arco clásico de
  `test_patron_color.py` miran rejilla, conteo y `motivo`, y la única aserción de
  interfaz sobre una frase de espiral (`test-ui-propuesta.ts`) es de la columna.

## 14. La foto no sabe distinguir anillos de nada parecido (2026-10-01, noche)

La tarjeta salió **Confeti**, con el croquis de un arco morado y lila salteado al
azar, sobre una foto que es claramente de anillos. No es el motor ni el croquis:
los dos hicieron lo que el patrón decía. Es la lectura de la foto.

### 14.1 Lo que de verdad llegó de la foto

Del log de la app, sobre la MISMA imagen de referencia y en dos corridas
distintas del mismo día:

```
{"modo":"espiral",  "confianza":0.95, "colores":["lila","morado","lila","morado"]}
{"modo":"aleatorio","confianza":0.95, "colores":["morado","lila","violeta"]}
```

Dos modos incompatibles, los dos con 0,95, y el segundo nombrando **tres** tonos
en una pieza de **dos**. La confianza no informa de nada aquí: no sirve de filtro
y no se usa como tal.

Y tiene explicación. De frente, un arco clásico de dos tonos se ve igual armado
en anillos, en espiral o con los racimos salteados: en los tres, la mitad que
mira al espectador va cambiando de color al avanzar. Lo que los separa —si un
racimo mezcla colores, y en qué orden van los macizos— es justo lo que la foto no
enseña. Reescribir el prompt para separarlos ya se midió en §12 y no movió nada
(dos corridas pagas, `espiral` 0,95 las dos veces).

### 14.2 El arreglo: la lectura se enmienda, no se obedece

`_espiral_de_foto_a_anillos` pasó a `_lectura_de_arco_a_anillos` y cubre los dos
modos indistinguibles, `_MODOS_COMO_ANILLOS_EN_ARCO = {espiral, aleatorio}`. Un
`doslados`, unos `bloques` o un `degradado` **sí** se distinguen a simple vista
desde la foto, y se respetan tal cual.

El alcance no se tocó: solo arcos **clásicos** (los que tienen banda de armado),
y solo con 2–3 colores. Con cuatro o más, la cinta de cada color se ve avanzar y
la lectura vale. Una columna, una guirnalda o un arco orgánico no tienen este
parecido y quedan fuera.

Lo nuevo es que la secuencia sale de los **materiales**, no de los nombres que
trajo la foto. Con `["morado","lila","violeta"]` —dos nombres del mismo material—
convertir a anillos tal cual daba `[0,1,0]`: dos anillos de uno por cada uno del
otro, **84/42** en una pieza que pide 63/63. Ahora se guarda el primer nombre de
cada material, en el orden en que la foto los nombró.

Medido de punta a punta sobre la pista real (arco clásico 3,0 × 2,4, lujosa,
violeta y lila al 50 %):

| | antes | después |
|---|---|---|
| patrón | `aleatorio` (confeti) | `anillos`, secuencia `[0, 1]` |
| total que cotiza | 126 | 144 |
| reparto | 63 / 63 | 72 / 72 |
| participación | 50 / 50 | 50 / 50 |

El total sube porque un arco en anillos **no va escalonado**: todas las hileras
llevan los cuatro globos, y las impares dejan de llevar tres. Es el mismo +14 %
que ya se midió en §12 para los arcos de anillos, no un cambio de calibración.

### 14.3 Y la frase del prompt de imagen, que decía lo contrario

La imagen generada salía con los colores corriendo **a lo largo** del arco —una
franja lila por dentro y morada por fuera—, que es el patrón contrario al pedido.
El croquis de esa misma tarjeta estaba bien (144, 36 anillos de 4, 72/72,
verificado posición por posición); lo que estaba mal era el fragmento LoRA:

```
antes:    built with stacked bands of violet and lilac repeating along the arch
después:  each cluster of balloons a single solid color across the piece,
          violet and lilac in turn from the left base over the top to the right base
```

«bands» le vale al modelo tanto para un anillo que cruza la pieza como para una
franja que corre a lo largo, y elige la segunda. En la guirnalda por racimos ya
se evitaba por eso mismo; §5 había dejado el arco fuera **con un argumento que
era falso** y que esta imagen desmintió. Ahora `anillos_lora` describe por su
unidad toda pieza cuya unidad la impone el armado —arco clásico, columna clásica,
guirnalda por racimos—; lo que no tiene armado conserva las bandas apiladas, que
ahí no se confunden con nada. La frase Gemini ya decía «each cluster is a single
color» y no se tocó.

Las dos frases viven **fuera** del snapshot, así que ningún `plan_hash` se movió.

### 14.4 Lo que se comprobó, y lo que no

Comprobado:

- La pista real del log, de punta a punta por `_complete_plan` → `_structure_count`
  → `validar_y_expandir`: `anillos [0,1]`, 144, 72/72, participaciones 50/50.
- El croquis dibujado: 144 posiciones, `motivo` nulo, anillos macizos alternando.
- Los 30 vectores dorados resuelven sin excepción. Ninguno trae `pistas_patron`,
  así que el cambio no los toca.
- Las guardas: confeti de 4 colores, `doslados`, `bloques`, `degradado`, arco
  orgánico, columna clásica y pared se quedan **exactamente** como estaban; una
  pista con un color que la pieza no tiene se sigue descartando entera.

No comprobado:

- **Las pruebas no se corrieron** (el usuario pidió no correrlas). `test_patron_color.py`
  no tiene ningún caso de pista `aleatorio` sobre un arco clásico; si se añade
  uno, este es el sitio.
- **La imagen no se volvió a generar**: confirmar §14.3 de verdad es una llamada
  paga al proveedor, y eso lo decide una persona.

### 14.5 Lo que sigue abierto

La lectura de la foto sigue fallando el modo en origen. Lo que hay es una
enmienda en el borde, no un arreglo: elige la pieza común entre lecturas que la
foto no puede separar, y el decorador recupera la otra en un clic desde «Editar
patrón». Al revés —ver una mezcla donde hay anillos— no hay quien lo note en la
tarjeta hasta que la pieza está armada, y eso es lo que acaba de pasar dos veces.
