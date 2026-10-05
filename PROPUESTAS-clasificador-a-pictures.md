# Propuestas: qué traer de `clasificador-decoraciones` a `pictures`

Revisión del 2026-09-30 de los dos repositorios, hecha leyendo el motor de croquis
y de color de cada uno, el camino del color hacia el prompt de imagen y los
documentos de estado. No se cambió código: esto es el catálogo de lo que vale la
pena traer, con lo que cuesta y lo que arrastra.

`clasificador-decoraciones` vive en `C:\Users\davidt\Downloads\clasificador-decoraciones`
(remoto `dav033/clasificador-decoraciones`). Este repositorio es `dav033/pictures`.

## La asimetría, porque decide cómo se trae cada cosa

`pictures` es el sistema comercial: contrato en una dirección, `plan.py` dueño de
los números, vectores dorados, `plan_hash`, ADRs. El clasificador es un
**laboratorio determinista sin contrato y sin una sola prueba** (no tiene ningún
archivo de test ni script `test` en su `package.json`).

De ahí la regla para todo lo que sigue: **se porta la regla, no se importa el
archivo**. Su propio `SEGUIMIENTO-fal-estructura-a-imagen.md` §3 ya lo dice
(«no se une todavía ni se importa código entre repos»), y traer un módulo suyo
tal cual metería en `pictures` un dueño de número sin contrato ni vector dorado.

## Las diferencias que importan

### 1. El modelo de datos del color, no la calidad del código

`pictures` decide color y tamaño por caminos separados y los reconcilia
sustituyendo en `_materiales` (`services/ai-api/app/silueta_patron.py:505`). De
ahí el 88 % que mide `test_cada_globo_de_una_pared_lleva_el_color_de_SU_sitio`.

El clasificador **no puede tener ese conflicto**: su unidad es una capa =
(tamaño, color) con su aporte (`src/lib/organico/capas.ts`), así que no hay dos
repartos que cruzar. El 12 % que queda aquí no es un parche pendiente: es la
consecuencia del modelo de datos.

### 2. El color que se le pide al modelo de imagen

La mejor convergencia de las dos revisiones:
`src/lib/lora/descriptor-perceptual.ts:31` dice que solo `spring pink` está
verificado contra la foto del producto y que el resto «debe revisarse cuando el
pipeline de visión entregue descriptores medidos sobre las fotos reales».

**Ese pipeline existe ya, en el otro repo.** `src/lib/colores/inflado.ts` tiene
70 de 88 referencias medidas sobre la foto de tienda, con el corte de 10.000
píxeles y las 18 neutras excluidas a propósito (un globo blanco o cristal no
tiene píxeles cromáticos que promediar). El Frambuesa de catálogo es `#a50050` y
el globo inflado `#e24065`: **ΔE 22 antes de que ningún modelo opine**, porque el
hex del catálogo es la conversión del PMS —el color de la tinta— y el látex
inflado se estira, es translúcido y le entra luz.

Hoy el caption de `pictures` no lleva hexadecimal en ninguna parte (comprobado en
`src/lib/ia/kagutsuchi/lora-caption-compiler.ts` y
`src/lib/lora/product-vocabulary.ts`): viaja prosa escrita a mano.

### 3. Cómo se reparte el color por la pieza

`services/ai-api/app/patron_color.py` tiene degradés, zonas, damero, flor… y
**no tiene racimos**: un racimo, un solo color, que es como se arma de verdad. El
clasificador sí (`src/lib/organico/motor.ts:670`), y además trata los **acentos
como globos sueltos que no se tocan entre sí** — una regla de vecindad que aquí
no se puede expresar.

### 4. El azar contra el ritmo

`_elegir_tamano` (`services/ai-api/app/silueta.py:1096`) hace un sorteo ponderado
por cupo restante. La distribución orgánica del clasificador son «tres tamaños en
**ritmo fijo**» (`src/app/distribuciones/page.tsx`, opción C). El sorteo produce
vecindades que en una foto real no aparecen.

### 5. Medir el resultado — y esto ya estaba, era yo el que no lo encontró

**Corrección del 2026-09-30.** La mejora 2 de la tabla no existía: la puerta de
fidelidad **ya está portada en este repositorio** desde ADR-0033, en
`scripts/lib/medir-guia.ts`, que lo dice en su propia cabecera («Color. Porta
`fidelidad.ts` de `clasificador-decoraciones`») con los mismos umbrales, la
misma banda media de claridad del 30 al 70 %, el mismo trato de los neutros y el
mismo recuento de intrusos. La usa la corrida comparativa de la guía de
estructura (`scripts/lib/corrida-guia-estructura.ts`), que además mide la
silueta por IoU, algo que el otro repositorio no tiene.

No la encontré porque busqué en `src/lib` y vive en `scripts/lib`. Llegué a
escribir un duplicado en `src/lib/lora/fidelidad-color.ts` con sus nueve pruebas
antes de dar con el original; lo borré, porque dos implementaciones de la misma
medida son exactamente el problema que el resto de esta revisión trata de
evitar. Lo que sigue describe lo que hay, no lo que falta.



El clasificador tiene una puerta pura (`src/lib/render-ia/fidelidad.ts`) que
mide por **tono / croma / presencia / intrusos**, y el porqué del error que se
cometió tres veces seguidas: promediar un mapa de color plano contra una foto con
sombras daba ΔE 33 en un Frambuesa correcto que estaba a 1,5° de tono. Una foto
de cien globos dándose sombra promedia más oscuro **por física**.

`pictures` retiró el QA visual, y encaja: esto no es una reja, es una métrica.

### 6. Un oráculo para mirarse

`/distribuciones` pone foto real contra gráfica generada en cuatro piezas (arco
en espiral, columna de cuartetos, arco orgánico, columna orgánica). Aquí no hay
con qué comparar el croquis.

## Las mejoras, por lo que se ve contra lo que cuesta

| | Qué | Toca | Riesgo |
|---|---|---|---|
| 1 | ~~Alimentar `descriptor-perceptual.ts` con los hex medidos~~ **Hecha, con el alcance corregido: ver abajo** | prompt de imagen | Bandera apagada; encenderla se mide con fal → **declarar tope** |
| 2 | ~~La puerta de fidelidad como telemetría~~ **Ya estaba hecha antes de esta revisión: `scripts/lib/medir-guia.ts`** | — | — |
| 3 | Modo `racimos` en `patron_color.py`, y los acentos que no se tocan | patrón → contrato → vectores dorados | El modo viaja en `estructuras`: **decisión de contrato**, cambia `plan_hash` de planes nuevos |
| 4 | ~~Ritmo fijo en lugar de sorteo en `_elegir_tamano`~~ **Probado y revertido: cuesta 9 puntos de fidelidad de color. Necesita la 6 antes** | silueta | — |
| 5 | La página oráculo: dibujar el croquis de `pictures` junto a la foto real | UI interna | **Bloqueada por una regla de la casa**: las fotos no entran al repositorio |
| 6 | La unidad = capa (tamaño, color) en la matriz del despiece, en vez de cruzar dos repartos | `plan.py` `_pattern_matrix` | El arreglo de fondo. La 4 lo demostró: **es el requisito de la 4, no al revés** |

### Por qué las tres que quedan no se hicieron solas

Ninguna está bloqueada por trabajo: las tres necesitan una decisión que no es mía.

- **La 3 cambia el contrato.** Un modo nuevo de patrón viaja dentro de
  `estructuras`, así que cambia el `plan_hash` de los planes nuevos y hay que
  regenerar contrato, modelos y vectores. Esa entrada va sola y con su commit.
- **La 5 no se puede construir aquí.** El oráculo compara la gráfica con una
  foto real, y las reglas de la casa dicen que ninguna imagen ni dato de cliente
  entra al repositorio: las entradas de evaluación viven fuera. Hacerlo en el
  otro repositorio —que ya tiene las fotos y la página— significa dibujar el
  croquis de `pictures` allí, o sea juntar los dos, que es precisamente lo que
  está decidido no hacer todavía.
- **La 6 cambia lo que se compra.** Decidir el tamaño y el color juntos rehace
  la matriz del despiece: mueve cantidades por color, y con ellas el precio y
  los vectores dorados. Es la misma conversación que la calibración del arco, y
  la 4 ya dejó medido lo que se gana (los 9 puntos de fidelidad, más el ritmo
  fijo gratis).

## La mejora 1, hecha — y lo que la medición corrigió de esta propuesta

Implementada el 2026-09-30 como `src/lib/lora/color-inflado-medido.ts` (la
tabla), `src/lib/lora/matiz-medido.ts` (el matiz) y la bandera
`COLOR_INFLADO_MEDIDO_V1`, **apagada**. Tres cosas salieron distintas de como
las había escrito aquí, y las tres importan:

**1. El hex medido no puede reemplazar la prosa escrita a mano.** La única
entrada de `descriptor-perceptual.ts` verificada contra la foto del producto es
`spring pink`, y esa referencia (`809` Rosa Primaveral) es justamente una de las
18 que **no se pudieron medir**: su foto tenía un píxel cromático. La tabla
medida no la reemplaza, la complementa; donde hay prosa a mano, el matiz medido
no se añade.

**2. Y el caption no lleva hexadecimales.** El prompt de `pictures` describe el
color con palabras, no con `#rrggbb` (el pipeline del otro repositorio sí manda
el hex, y por eso allí la medición entra directa). Así que lo que se porta no es
el hex: es lo que el hex **dice** del globo, como un calificativo delante del
nombre del catálogo («pale», «very pale muted», «deep»). El nombre no se toca —
renombrar por cuenta propia es lo que hacía que el vocabulario automático
llamara «dark grey» al Turquesa Profundo.

**3. Mi propio número estaba mal, y la verdad es mejor.** Escribí que el globo
inflado es «ΔE 22» más claro que la tinta y llegué a medir «+12,8 L\* de media»;
ese +12,8 era un error de índices en un script de un solo uso. Medido de verdad
con el `labDeRgb` del repositorio sobre las 71 referencias:

- la tinta está a **ΔE 18,7 del globo de media** (mediana 17,2), y **por encima
  de 10 en 59 de las 71**: la tinta no es el globo, eso sí se sostiene;
- pero **la claridad se mueve en las dos direcciones y casi se cancela** (ΔL\*
  medio +0,6; más claro en 39 de 71), con el Dorado aclarando 28 puntos y el
  Rosado oscureciendo 22;
- lo único sistemático es que el globo pierde algo de croma (ΔC\* medio −6,6).

Eso **refuerza** la propuesta en vez de debilitarla: si el globo fuera siempre
un poco más claro, bastaría con escribir «pale» en el prompt y no haría falta
medir nada. Como la corrección va en las dos direcciones y no se puede adivinar,
la tabla medida es lo único que la sabe.

**Un límite que encontró la prueba:** dos claves describen dos globos distintos
con el mismo nombre en inglés y la misma familia (`green|fashion` es el Verde
Trébol `029` y el Verde `030`; `purple|fashion` es el Violeta `051` y la
Orquídea Morada `056`). Esas cuatro filas se consultan como ambiguas y no se
usan: mejor el nombre del catálogo que describir el globo equivocado.

**Lo que falta, y es de negocio:** encender la bandera y medir contra fal si el
matiz mejora la foto. Es una corrida pagada, así que va con tope declarado y
esta bandera como única variable.

## La mejora 4, probada y revertida — y lo que eso enseña de la 6

Implementada el 2026-09-30 y **deshecha el mismo día**, con la medida que lo
justifica. El cambio era sustituir el sorteo ponderado de `_elegir_tamano` por
un **ritmo fijo**: un reparto por crédito, como el trazado de una línea, con los
dos sesgos del oficio metidos en la parte que a cada tamaño le toca *en ese
sitio* (así el ritmo es parejo dentro de cada zona y el gradiente sigue
existiendo entre zonas). Parecía la más segura de las seis, y con razón:
`silueta.py` **no decide cantidades** —los cupos le entran dados— y los vectores
dorados no congelan posiciones, así que no movía ni un precio.

Lo que sí movió, medido:

- `test_los_globos_grandes_tienden_a_la_base[pared_densa]`: el sesgo como
  empujón no reproducía el gradiente (un ritmo parejo sobre TODA la pieza es
  incompatible con «los grandes abajo»); metiéndolo en la parte local, sí.
- `test_dos_globos_de_la_misma_capa_no_quedan_uno_dentro_del_otro`: con los
  tamaños en ritmo fijo los racimos salen más parejos, y un racimo de cuatro
  R-5 llegaba a nacer con dos globos encimados. Se arregló reparto los miembros
  de cada racimo en **ángulo dorado** en vez de en un ángulo al azar, que es una
  mejora por sí sola.
- **`test_cada_globo_de_una_pared_lleva_el_color_de_SU_sitio`: 88 % → 79 %.**
  Ese es el que decidió. El ritmo fijo concentra los tamaños grandes abajo con
  más nitidez que el sorteo, y cada vez que a un sitio le toca un tamaño que a
  su color ya no le queda, `_materiales` sustituye el color. Es exactamente el
  techo que documenta `SEGUIMIENTO-pared-organica.md`: el 12 % que falta son
  conflictos reales entre el sitio y la matriz tamaño × material.

**La conclusión invierte el orden de la tabla:** la 4 no es independiente, es
posterior a la 6. Mientras el color y el tamaño se decidan por separado, hacer
el tamaño más ordenado empeora el color. Con la unidad = capa (tamaño, color)
el conflicto no puede existir, y entonces el ritmo fijo sale gratis.

El código revertido está en el historial de esta sesión; volver a ponerlo son
dos funciones de `silueta.py` (`_elegir_tamano` y el ángulo de los miembros en
`_sembrar`).

## Lo que no hay que hacer

- **Compensar el croma en el prompt.** Ya está medido y no funciona: 79,8 % de
  croma devuelto con y sin compensación. Los colores que más pierden son los que
  menos margen tienen en sRGB; ese 20 % es sombreado y oclusión, no
  interpretación. Está documentado en `src/lib/render-ia/compensacion.ts` del
  otro repo justo para que nadie repita el experimento.
- **Control estructural (canny/depth) con el croquis como imagen guía.**
  `src/lib/render-ia/enfoques.ts` lo verificó contra la documentación de fal: los
  endpoints de control corren sobre FLUX.1 [dev] y el LoRA de este sistema se
  entrenó sobre FLUX.2 [dev]. O hay control estructural, o hay estilo entrenado.
- **Juntar los repositorios.** El clasificador sirve precisamente porque puede
  moverse sin contrato ni vectores dorados.

## Lo que se empezó primero, y por qué no está en esta tabla

El arco armado por el motor (ADR-0034 y ADR-0035) no es una de estas seis: es la
otra mitad del problema. Las seis de arriba mejoran **cómo se ve** lo que ya se
cuenta; el motor cambia **de dónde sale el número** — de la fórmula de densidad a
una estructura armada de verdad, de la que el conteo se lee en vez de estimarse.
