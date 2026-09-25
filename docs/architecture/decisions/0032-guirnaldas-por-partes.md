# ADR-0032 — Guirnaldas por partes

Date: 2026-09-25
Status: accepted (entrega E3 sin UI, detrás de una bandera apagada)
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
   `prompt_gemini` / `prompt_lora` (inglés; LoRA en ASCII, sin cifras). Las
   frases no se insertan todavía en Uzume ni Kagutsuchi (E5).
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
  con E5, la redacción de frases es lo primero que se separa.

## Entregas

- **E3 (esta, hecha):** contrato, `armado_guirnalda.py`, geometría, completar
  al confirmar, vista previa, edición, bandera y cableado en Next, pruebas.
- **E4 (pendiente):** lectura de la guirnalda en la foto (Amaterasu,
  `GUIRNALDA_REFERENCIA_PYTHON_ENABLED`), `pistas` en `plan-resolution.v1` y
  `placementFor`. El punto de entrada ya existe: `sugerir_armado(estructura,
  lectura)` acepta la forma de la lectura de §2.2 y cae en la receta si no se
  puede armar.
- **E5 (pendiente):** frases en Uzume/Kagutsuchi, patrón por racimo (preset
  espiral/anillos con varios tamaños) y espejo en `u_invertida`.
- **E6 (pendiente):** UI (bloque, gráfica sobre la forma, editor, hoja) y la
  ruta de Next de la vista previa.

## Rollback

Apagar `GUIRNALDAS_ARMADO_V1`. Para quitar el código: revertir los commits; los
planes que ya traen `armado_guirnalda` los rechazaría la revisión anterior
(`additionalProperties: false`), como en ADR-0028 y ADR-0030: app y `ai-api`
se despliegan juntos.
