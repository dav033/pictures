# ADR-0032 — Guirnaldas por partes

Date: 2026-09-25 (E5: 2026-09-28)
Status: accepted (entrega E3 sin UI, detrás de una bandera apagada; E5 —
prompts, patrón por racimo y espejo— hecha, sin bandera: sin armado todo es
byte a byte lo de antes)
Supersedes: nothing.

## Problema

Una guirnalda se contaba solo por su largo (`plan._eje`: `largo_m`, o `ancho_m`
si falta) con el modelo de banda de arcos y columnas. El plan no sabía sobre
qué va (pared, colgada, piso, mesa u otra pieza), qué forma toma, de qué
racimos se arma, qué globos chicos van de relleno ni qué globos grandes van de
remate. Sin eso no hay hoja de armado, ni insumos, ni frase fiel para el prompt
de imagen, y una guirnalda colgada con caída se cotizaba con su largo recto:
la cuerda real es más larga y la puerta física no lo veía
(`SEGUIMIENTO-guirnaldas.md` §1).

## Decisión

1. **Contrato `armado-guirnalda.v1`** (dueño Zod: `src/lib/plan/armado-guirnalda.ts`;
   solo forma, sin `.default()`): campo opcional `armado_guirnalda` en la
   estructura (Plan 1.0 y 1.1). `origen`; `soporte` (`pared`, `colgada`, `piso`,
   `mesa`, `sobre_estructura` con `estructura_id` de la anfitriona); `forma`
   (`recta`, `curva`, `ondulada`, `u_invertida`, `arco_caido`); `caida_m`
   opcional; `puntos_de_anclaje` 2..6 opcional; `racimo` (`trio`, `cuarteto`,
   `quinteto` y tamaño base 9, 11 o 12"); `relleno` (`material` y `proporcion`
   0..0,5, o `null`); `remates` (hasta 6, cada uno `material` y `posicion`:
   `extremo_izq`, `extremo_der`, `centro`, `cada_n`). No lleva cantidades: los
   globos los cuenta el resolutor. Ausente, la resolución es byte a byte la de
   siempre: los 31 vectores dorados no cambian.
2. **Un solo dueño:** `services/ai-api/app/armado_guirnalda.py`, junto a
   `armado_bouquet.py` y `patron_color.py`. Reglas cruzadas (`validar`): la
   anfitriona existe, no es la propia pieza ni otra guirnalda; `colgada` exige
   anclajes; `caida_m` solo en formas que cuelgan y esas formas solo en pared o
   colgada; el relleno sale de globos de 9" o menos (y menores que el racimo)
   y no pide más de los que se compran; cada remate tiene un globo más grande
   que el racimo de su color; con patrón de color, la unidad del racimo es la
   `k` de su rejilla.
3. **El armado reparte la compra, nunca la cambia.** Python recibe por
   instancia lo que la resolución compra, material × tamaño
   (`_despiece_with_plan_sizes`), y cada globo queda en un solo lugar: un
   racimo, el relleno, un remate o suelto (`_repartir`, que lo comprueba). Los
   racimos van numerados de izquierda a derecha y son las filas de la rejilla
   del patrón: con patrón, el racimo `i` toma los colores de su fila (la `i`
   cuando hay tantos racimos como filas); si un color ya se usó en el relleno
   o los remates, la posición toma el color que más quede y lo avisa.
4. **La caída es geometría, no armado.** Con `forma: u_invertida | arco_caido`
   y `caida_m`, el eje de la guirnalda (`plan._garland_cord`) es la cuerda que
   cuelga: un arco de parábola por tramo entre anclajes (`arco_caido` colgado de
   `n` puntos hace `n − 1` tramos), de largo
   `√(a² + 4h²) + a²/(2h) · asinh(2h/a)` con `a` la mitad del tramo y `h` la
   caída. El conteo, la compra y `eje_m` la siguen, así que la puerta física
   mide los globos por metro sobre la cuerda real. Cuáles formas cuelgan y su
   `factorPerfil` (hoy 1 en todas: banda completa, sin calibrar, como λ) viven
   en `x-geometria-estructuras-oficiales`, cuyo dueño es
   `estructuras-oficiales.ts` (entrada `guirnalda`, `eje: "largo"`).
   **Por qué la parábola exacta y no la serie `largo + 8/3 · caída² / largo`:**
   la serie es su primer término y solo vale con caída pequeña (2,5 m con
   0,3 m de caída: 2,596 m la serie, a menos del 0,5 % de la exacta), pero se
   dispara en una U alta: una U invertida de 1,5 m de ancho y 2,2 m de caída
   (el marco de una puerta) da 10,1 m con la serie y 4,78 m con la fórmula
   cerrada, y la compra se duplicaría. Aprobado por el orquestador el
   2026-09-25; lo fija `test_la_cuerda_es_un_arco_de_parabola_por_tramo`.
5. **Completar al confirmar** (`completar_armados_guirnalda` en
   `plan-resolution.v1`, bandera `GUIRNALDAS_ARMADO_V1` en Next, default OFF):
   cada guirnalda sin armado recibe la receta. Es un campo propio y no una
   generalización de `completar_armados`: las dos banderas se encienden por
   separado y una no debe completar lo de la otra. `completar_armados_de`
   (ADR-0030) limita las dos completitudes a las piezas editadas. Ocurre en
   `_resolution_result`, junto a la de bouquets y antes de `_build_resolved`,
   aunque no necesita catálogo, para que otra completitud que cambie medidas o
   densidad (el conteo desde la foto, E2) vaya antes. Una guirnalda de techo
   (`techo_globos`) no es una guirnalda por partes y no recibe armado.
6. **La receta nunca declara caída**, así que completar no cambia la compra:
   mismo total en COP con y sin bandera. Una caída entra solo cuando la declara
   el decorador (edición) o, desde E4, la foto; entonces la compra sigue a la
   cuerda (decisión 4).
7. **Salida derivada** `plan_resuelto.armados_guirnalda[]`, fuera del snapshot
   y del hash; presente, `armado_guirnalda` entra en `plan_hash` (es parte del
   plan firmado). Leyenda con **un código por material y tamaño comprado**
   (nombrado por la línea que lo compra, leída en orden de demanda como la
   vista previa del patrón: `_runs_by_demand`), racimos, relleno, remates (con
   el racimo junto al que va cada globo), sueltos, largo declarado y de cuerda,
   insumos no cotizados, duración estimada (marcada estimada), pasos, avisos y
   `prompt_gemini` / `prompt_lora` (inglés; LoRA en ASCII, sin cifras). Desde
   E5 llegan a Uzume y a Kagutsuchi (decisiones 10 a 12).
8. **Vista previa sin catálogo** (`POST /internal/v1/plan/armado-guirnalda`,
   scope `plan.armado_guirnalda`, contrato local `plan-armado-guirnalda.v1`):
   resuelve el armado del editor o, con `null`, la receta, con la misma función
   que la resolución; las líneas del navegador solo nombran. Devuelve además
   `opciones` (soportes, anfitrionas, unidades, tamaños base, colores de
   relleno y de remate), decididas en Python.
9. **Edición** (`plan-edit.v1`): acción `armado_guirnalda` que fija o quita el
   armado, validado entero sin catálogo. Como el armado no lleva cantidades,
   una edición de colores, reparto, mezcla o patrón lo **conserva mientras
   quepa** en los globos nuevos; si no, lo quita con aviso. Quitar un color lo
   quita siempre (los índices de `materiales` se corren). Con la bandera, Next
   re-resuelve con `completar_armados_de: [pieza]` y avisa si no volvió.

### Entrega E5: prompts, patrón por racimo y espejo (2026-09-28)

10. **Las frases del armado entran por la misma puerta que el patrón y el
    bouquet** (`frasesDeEstructuras`, `src/lib/ia/uzume/mezcla-color-escena.ts`):
    Uzume las pone en la línea de color y en el `color_pattern` de la
    guirnalda, y Kagutsuchi detrás de sus materiales, tal cual. Una guirnalda
    con armado y patrón da **una sola frase**: la del armado y detrás la del
    patrón (espacio en Gemini, coma en el caption LoRA). TypeScript no redacta
    ni cuenta nada del armado: solo lee lo que Python decidió (`soporte`,
    `forma`, `puntos_de_anclaje`, la anfitriona) para elegir sus propias frases
    fijas. Sin `armados_guirnalda` (o con la lista vacía) cada prompt es byte a
    byte el de antes; lo fija una instantánea capturada con los constructores
    anteriores a E5.
11. **La frase LoRA del armado es un modificador de la guirnalda**, no otra
    guirnalda: "mounted flat against the wall in clusters of four with small
    pink filler balloons and large white accent balloons". Empezaba por
    "organic balloon garland" y el caption nombraba dos guirnaldas seguidas,
    el mismo fallo que tuvo el bouquet (ADR-0030). No repite los colores de
    los racimos (la cláusula ya los nombra); sí los del relleno y los remates,
    que dicen cuál es chico y cuál grande. El descriptor se especializa por
    soporte justo detrás de los materiales: "mounted flat against the wall",
    "draped between two anchor points" (o "across three anchor points"),
    "resting on the floor along the front", "running along the table edge",
    "wrapped around the balloon arch". ASCII, sin cifras, dentro de
    `LORA_PROMPT_MAX_LENGTH` (también en el presupuesto del híbrido) y sin
    fugas de español.
12. **Gemini**: cada `soporte` y `forma` lleva su frase de soporte en el
    INSTANCE CONTRACT (`fraseSoporteGuirnalda`); antes solo la pared tenía
    una, y sin armado sigue siendo la única. Sin patrón, la línea de color
    conserva el reparto orgánico y el armado va detrás (el armado dice cómo
    se arma, no dónde va cada color); con patrón, la frase del patrón lo
    reemplaza, como sin armado. Una guirnalda `sobre_estructura` abre una
    excepción en el contrato de cardinalidad (las dos piezas se tocan) y una
    `mesa` cuenta en la excepción de mesa aunque su ubicación no sea una mesa.
    En el híbrido, `GEMINI_COMPOSITION_GARLAND_LOCK` se añade al hard lock solo
    cuando el caption llevó un armado de guirnalda; un armado sin patrón no
    pide el candado del patrón.
13. **Patrón por racimo** (`patron_color.py`). `EstructuraPatron` trae del
    armado sus globos por racimo y su forma (`racimo_y_forma`). Con armado,
    `sugerir_patron` va por los racimos del armado: espiral si los colores
    caben en un racimo, anillos (un color por racimo, por participación) si
    no, confeti de esos racimos si ninguno se arma; siempre con
    `globos_por_racimo` = la unidad del armado. Antes una mezcla de varios
    tamaños caía siempre en confeti. La unidad del armado también manda sobre
    la de la foto y sobre el punto de partida del editor. **Cómo convive el
    relleno**: el patrón colorea los racimos; el relleno y los remates toman
    el color de su material (`_tomar_relleno`, `_tomar_remates`) y no ocupan
    posiciones del patrón. El racimo `i` toma la fila `i` del patrón
    **expandido sobre los racimos que de verdad se arman**
    (`filas_de_racimos`), no una fila de la rejilla tomada a lo largo: con
    T/k filas y menos racimos, unos anillos de tres colores perdían uno y el
    espejo se rompía. La compra no cambia: el conteo por color sigue saliendo
    de la rejilla completa (T/k filas). Si lo comprado de un color no alcanza
    para sus racimos, esas posiciones toman el color que más quede y se avisa
    (`fuera_de_patron`, de E3). Un patrón con globos pintados a mano conserva
    la correspondencia de E3. Sin armado, `sugerir_patron` da exactamente lo
    de antes y los planes sin armado se resuelven byte a byte iguales.
14. **Espejo en una guirnalda armada en `u_invertida`**, simétrica desde el
    centro (`_admite_espejo`, `modos_admitidos`), con su redacción: "desde
    cada extremo hasta el centro", "from both ends up to the center, mirrored
    on each side". En cualquier otra forma, o sin armado, `simetria_no_permitida`
    con su propio mensaje. El espejo vive en `patron_color.py` (Python), no en
    el contrato: el Zod de `patron-color.v1` ya admitía `simetria: "espejo"`,
    así que no hubo cambio de contrato. Una edición que saca la guirnalda de
    la U (otro armado, quitarlo, o una edición que lo quita porque ya no cabe)
    deja el patrón sin espejo, con aviso, en vez de dejar un plan que la
    resolución rechazaría. `PROMPT_VERSION` del patrón de Amaterasu no cambia.
15. **Al confirmar el orden no cambia**: el patrón se completa en
    `_complete_plan`, antes que la receta del armado (`_resolution_result`),
    así que una guirnalda nueva recibe el preset de siempre (confeti con
    varios tamaños) y la receta toma la unidad de ese patrón (cuarteto). El
    preset por racimo aplica cuando el armado ya existe: el del decorador,
    una re-resolución que completa patrones, la sugerencia del editor y la
    pista de la foto. Invertir el orden no es seguro sin más: sincronizar las
    participaciones con el patrón nuevo puede dejar sin globo grande a un
    remate de la receta (422 al confirmar). Queda pendiente (receta → patrón
    → receta otra vez) para la fusión con E2 y E4, que también tocan
    `_resolution_result`.

## Reglas y sus fuentes

| Regla | Fuente | Efecto |
|---|---|---|
| Globos por unidad (trío 3, cuarteto 4, quinteto 5) | Sempertex, "Conceptos y técnicas – redondos" | tamaño del racimo |
| Relleno de globos de 9" o menos | `SEGUIMIENTO-guirnaldas.md` §2.2 | `relleno_sin_globos_chicos` |
| Largo de una cuerda colgada | Geometría (parábola como aproximación de la catenaria) | eje, conteo y puerta física |

## Supuestos del oficio (a validar con el negocio)

Propuestos como en ADR-0030; ninguno tiene fuente escrita del oficio en el repo
(`SEGUIMIENTO-guirnaldas.md` §1.9).

- Unidad: cuarteto de 12" por defecto; trío en `sencilla`, quinteto en
  `lujosa`; con patrón, la unidad de su rejilla.
- Relleno de 5" solo en mezclas orgánicas: la receta toma todos los 5" de la
  compra (`proporcion` = su parte, con el color que más lleva).
- Los globos de más de 12" van de remate repartido a lo largo (`cada_n`).
- Soporte por ubicación: pared en `fondo_pared`; piso en `piso_frontal` y
  `recorrido_suelo`; mesa en `sobre_mesa_principal`; pared en el resto.
- Insumos: tira perforada del largo de la cuerda más 10 %; ganchos uno cada
  50 cm en pared (o uno por anclaje); cuerda = largo + 1,5 m por anclaje;
  pesas una cada 1,5 m en piso (mínimo 2); amarres cada 50 cm sobre otra
  pieza; un punto de pegante por globo de relleno, remate o suelto; tijeras y
  bomba.
- Ritmo: 12 a 20 racimos por hora, 40 a 60 globos pegados por hora, más la
  instalación por soporte; se muestra siempre como estimado.

## Consecuencias

- Sin la bandera no cambia nada: los 31 vectores dorados siguen iguales
  (`expected_python` incluido) y las peticiones viajan byte a byte.
- Con `GUIRNALDAS_ARMADO_V1`, los planes confirmados con guirnaldas cambian su
  `plan_hash` (llevan el armado) pero no su compra ni su total (E2E local
  contra el catálogo real: 48 globos, 50.436 COP con y sin armado).
- Una caída declarada sí cambia la compra (E2E: 0,6 m sobre 2,5 m da 2,84 m de
  cuerda y 55 globos en vez de 48).
- `armado_guirnalda.py` pasa de 400 líneas (1.250, como las 1.152 de
  `armado_bouquet.py`): es un solo conjunto de reglas con un dueño; si crece
  con E5, la redacción de frases es lo primero que se separa. (E5 solo movió
  la frase LoRA a `_frase_lora`: 1.327 líneas.)
- E5: sin armado ningún prompt cambia (instantánea de 16 prompts) y ningún
  plan sin armado cambia (los mismos cinco planes resueltos antes y después).
  Con armado cambian los prompts de imagen, y con armado y sin patrón la
  confirmación o el editor sugieren el patrón por racimo, que cambia
  `participacion` y, con ella, el reparto por color de la compra (no el
  total).
- **No se sabe si los LoRA aprendieron guirnaldas por soporte.** Ni v007 ni
  v004 se han medido con estas frases: se mide en E7, con pago y tope
  (`scripts/ops/generar-guirnalda-armado.ts`, vista previa por defecto).

## Entregas

- **E3 (esta, hecha):** contrato, `armado_guirnalda.py`, geometría, completar
  al confirmar, vista previa, edición, bandera y cableado en Next, pruebas.
- **E4 (pendiente):** lectura de la guirnalda en la foto (Amaterasu,
  `GUIRNALDA_REFERENCIA_PYTHON_ENABLED`), `pistas` en `plan-resolution.v1` y
  `placementFor`. El punto de entrada ya existe: `sugerir_armado(estructura,
  lectura)` acepta la forma de la lectura de §2.2 y cae en la receta si no se
  puede armar.
- **E5 (hecha, 2026-09-28, rama `feat/guirnaldas-e5`):** frases en
  Uzume/Kagutsuchi y en el candado del híbrido, patrón por racimo (preset
  espiral/anillos con la unidad del armado, `filas_de_racimos`) y espejo en
  `u_invertida` (decisiones 10 a 15).
- **E6 (pendiente):** UI (bloque, gráfica sobre la forma, editor, hoja) y la
  ruta de Next de la vista previa.

## Rollback

E5 no tiene bandera propia: todo depende de que la guirnalda traiga armado.
Apagar `GUIRNALDAS_ARMADO_V1` deja de completar armados al confirmar; un
armado puesto a mano en el editor sigue llegando a los prompts. Revertir los
commits de E5 la quita del todo (un patrón con espejo sobre una guirnalda en U
lo rechazaría la revisión anterior: se despliegan juntos app y `ai-api`).

Apagar `GUIRNALDAS_ARMADO_V1`. Para quitar el código: revertir los commits; los
planes que ya traen `armado_guirnalda` los rechazaría la revisión anterior
(`additionalProperties: false`), como en ADR-0028 y ADR-0030: app y `ai-api`
se despliegan juntos.
