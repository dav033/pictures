# Seguimiento: la columna clásica, armada y dibujada

Que una columna deje de estimarse con una fórmula y de dibujarse con el motor de
las guirnaldas: que se arme en capas, como se arma de verdad.

Es la segunda migración del motor del clasificador, después del arco
(`SEGUIMIENTO-arco-clasico.md`). Misma forma, y por eso vale la pena decir de
entrada en qué se **diferencia**: en el arco el motor ya estaba porteado y se le
pasaban perillas imposibles; aquí **no había motor**.

## 0. Estado (2026-10-01)

| Archivo | Qué es |
|---|---|
| `services/ai-api/app/columna_clasica.py` | **Nuevo.** El motor: capas, anillo, escalonado, profundidad y total |
| `src/lib/plan/mezclas.ts` | `ARMADO_COLUMNA_CLASICA`: qué anillo le toca a cada densidad |
| `services/ai-api/app/plan.py` | `_es_columna_clasica` enruta, `_capa_de_columna_clasica` da la unidad del patrón |
| `services/ai-api/app/silueta_patron.py` | `_croquis_de_columna`: una posición por globo cotizado |
| `services/ai-api/app/patron_color.py` | La columna entra en los tipos de armado exacto; el giro del patrón es suyo |
| `src/lib/plan/estructuras-oficiales.ts` | `columna` pasa a ser la **Columna clásica**, también para el modelo de imagen |

## 1. Qué estaba mal

**Una columna no tenía motor.** `plan._total_globos` la contaba con la fórmula
λ y `silueta_patron` la dibujaba con el motor de silueta **orgánico** —el de las
guirnaldas—, que siembra los racimos y los relaja. De ahí salía una columna
torcida y despareja en vez de una pila de anillos. Comprobado dibujándola: el
croquis llegaba (no era un respaldo), pero era el croquis equivocado.

**Y el conteo no miraba el diámetro de la pieza.** `_eje` de una columna es su
altura (`plan.py`), y el «ancho» del área es `_BAND_WIDTH[mezcla]` por el
diámetro **del globo**, no el de la columna. Medido ejecutándolo: una columna de
0,25 m, una de 0,45 y una de 1,80 devuelven los mismos globos. La densidad era
lo único que movía la cifra, y solo multiplicaba por λ (2,8 / 3,6 / 4,5).

## 2. El modelo: capas, no una banda

Una columna clásica es una pila de **capas**, y cada capa es un **anillo** de
``n`` globos alrededor del eje vertical —cuatro es el cuarteto de toda la vida—.
Cada capa va girada **medio paso** respecto a la de abajo, que es lo que las
encaja. El total es ``capas × n``: un entero que se cuenta.

Las dos fórmulas, porteadas de `src/lib/columna/motor.ts`:

- radio del anillo: ``d / 1,14 / 2 / sen(π/n)`` — dos vecinos se tocan;
- alto de una capa: ``compresión × d``, con **0,80** por defecto. El deslizador
  del original la llama «la fórmula profesional» en ese valor y la acota a
  0,7–1,0.

Y una que no es una fórmula sino una decisión: el número de capas es **el que
menos se desvía** del alto pedido, no el que cabe por debajo. Con un globo
grande, una capa de más o de menos se nota, y el original lo resuelve así.

**El diámetro no entra: sale.** ``2 · radio + d``, que con R-12 es 0,56 m un
trío, 0,63 un cuarteto, 0,70 un quinteto y 0,77 un sexteto. Pedirlo además sería
un segundo dueño de la misma medida.

## 3. La densidad es el anillo

| densidad | anillo | compresión |
|---|---|---|
| `sencilla` | **cuarteto** (4) | 0,80 |
| `media` | **quinteto** (5) | 0,80 |
| `lujosa` | **sexteto** (6) | 0,80 |

**No hubo que inventar el vocabulario: ya estaba.** `NOMBRE_DEL_RACIMO` de
`mezclas.ts` ya llamaba cuarteto, quinteto y sexteto a 4, 5 y 6 globos, y
`RACIMO_DE_LA_FOTO` ya mapeaba esas tres a sencilla, media y lujosa al leerlas de
una foto. Esto no hace más que usarlo para armarlas.

La compresión se queda en 0,80 en las tres porque **no es la perilla de la
densidad**: apretarla o soltarla cambia hasta dónde llega la pieza, no lo llena
que se ve. Está en la tabla porque es la otra mitad del armado.

### El precio casi no se mueve, y eso es un hallazgo

Contra la fórmula λ, sobre seis alturas de catálogo:

| alto | sencilla | media | lujosa |
|---|---|---|---|
| 1,2 m | 20 (λ 20) **+0 %** | 25 (λ 26) −4 % | 30 (λ 32) −6 % |
| 1,6 m | 28 (λ 27) +4 % | 35 (λ 34) +3 % | 42 (λ 43) −2 % |
| 2,0 m | 36 (λ 34) +6 % | 45 (λ 43) +5 % | 54 (λ 54) **+0 %** |
| 2,2 m | 40 (λ 37) +8 % | 50 (λ 47) +6 % | 60 (λ 59) +2 % |
| 2,5 m | 44 (λ 42) +5 % | 55 (λ 54) +2 % | 66 (λ 67) −1 % |
| 3,0 m | 52 (λ 50) +4 % | 65 (λ 64) +2 % | 78 (λ 80) −2 % |

Todo entre −6 % y +8 %. **La λ de las columnas sí estaba bien calibrada**, y lo
que faltaba era el motor que las dibuja. Por eso esta migración, al revés que la
del arco, **no es una decisión de precio**.

## 4. Qué pieza va al motor

`_es_columna_clasica` enruta cuando la pieza es `tipo: "columna"` con mezcla
`clasica`, y **una guarda la devuelve a la fórmula**: un solo diámetro. Con
varios tamaños la pieza es una columna orgánica y la cuenta la fórmula, igual que
antes. Las dos oficiales que no son esta pieza —`columna_asimetrica` (la
orgánica) y `columna_no_densa` (la ligera, de globos separados)— se quedan fuera
por nombre.

**No hay guarda de ancho**, al contrario que en el arco: una columna no tiene
medida libre a lo ancho, así que no hay nada que pueda no caber.

## 5. El color sobre las capas

La rejilla del patrón **es** el armado: `_capa_de_columna_clasica` le impone el
anillo como `racimo_armado`, así que `filas = total / n` da exactamente las capas
—una fila por capa, una posición por puesto del anillo—. Y aquí, al revés que en
el arco, **no hay celdas de sobra**: una columna gira sus capas medio paso en
ángulo, no quitando un globo, así que todas van llenas.

La columna entra en `_TIPOS_ARMADOS_EXACTOS` junto al arco, con lo que arrastra:
un patrón con otro racimo se rechaza (`racimo_no_es_el_del_anillo`) y el modo
`flor` tampoco se arma, por la misma razón de siempre —cuelga un globo sin
posición y el conteo volvería a salir de la rejilla en vez de la pieza—.

### El giro del patrón: una capa sí y otra no

`_gira_con_el_anillo` pasó a ser `_giro_por_armado`, que devuelve **cada cuántas
filas** se corre el racimo un puesto: **1 en un arco, 2 en una columna**, 0 en
todo lo demás.

Dos no es un ajuste a ojo. En una columna la geometría ya aporta medio puesto por
capa (el `escalonado`), así que para que un color trace una hélice continua el
patrón solo tiene que aportar el otro medio — un puesto entero cada dos capas. Es
lo mismo que dice el motor de referencia, donde la espiral de una columna se
evalúa en `q − 0,5 · i` con `q` ya corrida (`columna/patrones.ts`). Correrla un
puesto por capa, como el arco, la giraría al doble de velocidad.

## 6. Lo que arrastra

- **Contrato**: solo `x-reglas-mezclas.armado_columna_clasica`, por el camino de
  siempre (zod en `mezclas.ts` → `contracts:export:domain` → `generate_models`).
  No añade campos a `estructuras`, así que **ningún `plan_hash` se movió**.
- **`columna` pasa a llamarse «Columna clásica»** y su `sustantivoEn` deja de ser
  `organic balloon column` —que era falso— para nombrar lo que es. Es el mismo
  arreglo que necesitó `arco` en su rebanada 5.
- **El croquis** emite `prof` (profundidad continua) y `giro: 0`. El giro va en
  cero a propósito: los globos de una columna no siguen ninguna línea, su óvalo
  se queda vertical, que es como se ven de verdad.

## 7. El remate: porteado, y todavía sin puerta de entrada

`Remate` y `armar_remate` están en el motor, con los **cinco** tipos del original
(`ninguno`, `globo`, `racimo`, `estrella`, `corazon`) y sus mismos factores de
alto (`d · 0,8`, `d · 2,1`, `foil · 0,9`).

Lo importante del modelo, y es del original, no una decisión de aquí: **el remate
no toca el cuerpo**. Medido contra el motor de referencia y contra este, en los
cinco tipos, el cuerpo da los mismos globos:

| remate | cuerpo | alto cuerpo | alto remate | alto total | globos del remate |
|---|---|---|---|---|---|
| `ninguno` | 36 | 2,075 | 0,000 | 2,075 | — |
| `globo` | 36 | 2,075 | 0,449 | 2,524 | 1 × R-24 |
| `racimo` | 36 | 2,075 | 1,178 | 3,253 | 5 × R-24 |
| `estrella` | 36 | 2,075 | 0,630 | 2,705 | — (es foil) |
| `corazon` | 36 | 2,075 | 0,630 | 2,705 | — (es foil) |

Sus globos salen en `RemateArmado.globos`, **aparte** de `total`, igual que allá
`remate.globos` va aparte de `conteo`. Por eso quitarlo no mueve nada: un remate
es otra cosa que se compra, no un globo más de la pila.

**Lo que falta es la puerta de entrada y la de salida**, y las dos son contrato:

- **Entrada**: una columna del plan no tiene dónde declararlo. El concepto sí
  existe en este repositorio —`armado_bouquet.remate`, que se lee de la foto en
  `app/amaterasu/estructuras/bouquet.py` con las clases `metalizado`, `burbuja` y
  `latex`, se dibuja en `components/plan/bouquet/geometria-bouquet.ts` y se edita
  en `borrador-armado.ts`—, pero vive dentro del armado del bouquet, y una
  estructura de tipo `columna` no lo lleva. Hay vocabulario que reusar, no que
  inventar. Un campo opcional no mueve el `plan_hash` de ningún plan ya firmado.
- **Salida**: el remate pide globos de **otro diámetro** que el cuerpo, y una
  columna se enruta a este motor justo por tener **un solo diámetro**. Si entrara
  en la mezcla de la pieza, la columna dejaría de ser clásica y volvería a la
  fórmula. Tiene que ser una línea propia del despiece, fuera de la mezcla, que
  es exactamente como lo tiene el original.

## 8. Lo que NO se trajo, y por qué

- **Los dos tamaños de globo** de abajo hacia arriba. Una columna clásica aquí es
  de un solo diámetro. Si alguna vez se trae, **hay que portar entera** la
  convergencia de `crearCapas`: en el original el bloque `elegir`/`d`/`centro`
  está escrito dos veces a propósito, y es una iteración, no un copiar y pegar.
- **El azar** (variación de tamaño, de tono, desorden). Una columna clásica es
  regular y el conteo no puede depender de una semilla.
- **El diámetro inflado.** Aquí es `0,92` lineal y allá la tabla `INFLADO_PULG`:
  un 5,2 % de diferencia, que se ve en que las columnas de demo salen un pelo más
  gordas que las de la referencia. **Afecta a todas las piezas**, no solo a esta,
  así que se decide aparte (lo mismo dice `SEGUIMIENTO-arco-clasico.md` §12.5).
- **Que el ancho declarado elija el tamaño del globo.** Los planes declaran la
  columna en 0,45 m, que es el diámetro de un cuarteto de **R-9**, no de R-12
  (0,63 m). Si el ancho tuviera que mandar, un cuarteto de 2,2 m pasaría de 40 a
  unos 52 globos: **eso cambia el precio** y es decisión del usuario.

## 9. Qué se comprobó, y qué no

Comprobado ejecutando el camino real (`_total_globos` → `_capa_de_columna_clasica`
→ `validar_y_expandir` → `pieza_desde_estructura` → `croquis_de_patron`) para una
columna de 2,0 m en las tres densidades: 36 / 45 / 54 globos, 9 capas, **una
posición por globo cotizado y `motivo: None`** en las tres. Y mirando el dibujo,
no solo los números.

**No se corrió ninguna suite** (`pytest`, `plan:test`, `lint`, `tsc`): el usuario
pidió que no se corrieran. Queda pendiente, y hay que contar con que las pruebas
que fijan el conteo de una columna con λ se muevan, igual que se movieron las del
arco.
