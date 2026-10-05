# 0035 — Editar las estructuras desde el motor

Fecha: 2026-10-02
Estado: **en ejecución, paso 1 (el arco) hecho en parte**: controles de patrón, forma, tamaño y globo; faltan capas y secciones
(ver «Estado del paso 1»). Los pasos 2 a 4 siguen propuestos.
Continúa: ADR-0034 (el motor del diseñador arma las tres estructuras)

## Dónde estamos

ADR-0034 puso el motor del diseñador a armar el arco, la columna y la guirnalda: coloca cada globo, cuenta lo
que se compra y emite el dibujo. Lo que hay hoy, funcionando y probado:

| Pieza | Qué existe |
|---|---|
| Motor | `app/arco/`, `app/columna/`, `app/guirnalda/`, `app/organico/`, con sus oráculos congelados (531 vectores, 93 494 globos) |
| Puerta | `armado_arco.py`, `armado_columna.py`, `armado_guirnalda_organica.py` |
| Contrato | `armado-arco.v1`, `armado-columna.v1`, `armado-guirnalda-organica.v1` dentro del plan |
| Conteo | `plan.py` cuenta con el motor cuando la pieza trae su armado |
| Vista previa | `/api/plan-armado-arco` y `/api/plan-armado-guirnalda-organica`, que devuelven el SVG |
| Pantalla | `BloqueArco` muestra el dibujo del motor, el conteo, la compra, las medidas y los avisos |
| IA | `consultar_opciones_armado` y `armar_estructura` |

**Lo que no hay es edición.** El armado se compone una vez —lo arma el modelo o lo completa la receta— y a
partir de ahí la pieza es de solo lectura. Cambiar un arco de espiral a chevron, subirlo diez centímetros o
pasar de globos R12 a R18 no se puede hacer desde la propuesta.

Y el motor ya publica todo lo que haría falta para hacerlo:

- `opciones_admitidas()` devuelve los **catorce patrones** con su nombre, su descripción, sus roles, cuántos
  colores admite cada uno y **cada mando con su clave, etiqueta, rango, paso, valor por defecto y ayuda**.
- `limites_de(armado, pieza)` devuelve los rangos **vivos**: con globos R36 el arco no puede ser tan angosto
  como con R12, y el motor lo sabe.
- La ruta de vista previa ya recalcula y devuelve el dibujo nuevo con cada cambio.

O sea: la pieza que falta es la edición, no el motor.

## Decisión

**El decorador y el modelo editan la misma estructura por el mismo sitio: el armado.** No habrá dos caminos.

Cambiar una pieza es cambiar su `armado_*` y volver a pedir el dibujo; guardar es escribir ese armado en el
plan y volver a resolver. La gráfica no se recalcula nunca en el navegador: la emite el mismo motor que colocó
y contó los globos.

### Qué se puede cambiar, por pieza

Lo que sigue **ya lo admite el contrato y lo valida la puerta**; lo que falta es ofrecerlo.

**Arco** — el patrón (`solido`, `bloques`, `apilado`, `espiral`, `espiralPunteada`, `zigzag`, `chevron`,
`diamante`, `punteado`, `franjas`, `floral`, `ombre`, `arcoiris`, `doslados`) con los mandos propios de cada
uno; la forma (alto, semicírculo, herradura), el ancho, el alto y los globos a lo ancho; el tamaño de globo y
cómo se infla; las capas a lo ancho y las secciones por altura, que es pintar racimo por racimo.

**Columna** — el patrón, el remate (ninguno, globo, racimo, estrella o corazón de foil), los globos por capa,
la altura, la base y el escalonado.

**Guirnalda** — no tiene patrón: tiene forma (largo, altura, pendiente, ondulación, colgado, festones, de qué
lado carga), volumen (grosor en los extremos y en el centro, irregularidad, relleno, racimo, salientes), la
mezcla de tamaños, la paleta con el acabado y el papel de cada color, y los adornos.

### Cómo se edita

1. **Vista previa en vivo.** El navegador manda el armado en borrador a la ruta de vista previa y pinta lo que
   vuelve. El gemelo ya escrito es el editor de guirnalda de ADR-0032: `debounce`, cancelación con
   `AbortController`, gana la última respuesta, y los cuatro estados (cargando, vacío, error, listo) explícitos.
   Nada se guarda todavía.
2. **Guardar.** Va por `/api/plan-editar`, que escribe el armado en el plan, vuelve a resolver y vuelve a
   firmar. Es lo que mueve dinero, así que pasa por donde ya pasa todo lo que lo mueve.
3. **El modelo usa lo mismo.** `armar_estructura` ya compone un armado y lo valida contra la pieza; editar es
   armar otra vez con los cambios. Lo único que le falta es poder partir del armado que la pieza ya tiene en
   vez de empezar de cero.

### Lo que los controles tienen que respetar

- **Los rangos salen de `limites_de`, no de la interfaz.** Subir el tamaño del globo cambia el ancho mínimo
  del arco; el control tiene que enterarse. Una lista de rangos escrita en el cliente se desincroniza el día
  que el motor cambie uno.
- **Los mandos salen de `opciones_admitidas`.** Cada patrón tiene los suyos, con su etiqueta y su ayuda ya
  escritas. Un cambio de rango, de texto o de ayuda se ve aquí sin tocar nada. Un patrón nuevo, no del todo: además
  tiene que estar en el contrato `armado-arco.v1` (`PATRONES_ARCO`: Zod, exportación y modelos), que es lo único que
  deja guardarlo; mientras no esté, la vista previa lo ignora en vez de romperse.
- **Lo que el motor corrige se dice.** Un alto imposible se ajusta y el motor lo explica en español; esos
  avisos son del cliente, no del registro técnico.
- **El cliente no calcula.** Ni medidas, ni conteo, ni totales, ni geometría. Lo único que la pantalla hace con
  un número es darle formato.

## Alternativas descartadas

**Un editor por pieza, escrito a mano.** Es lo que obligaría a copiar los rangos y los mandos al cliente, que
es justo la duplicación que ADR-0034 vino a quitar.

**Editar el plan directamente y que el motor se entere después.** Deja un momento en el que lo que se ve y lo
que se cobra no coinciden, que es el problema del que se partía.

**Dos caminos, uno para el decorador y otro para el modelo.** Dos sitios donde validar lo mismo, y uno de los
dos se queda atrás.

## Por dónde empezar

1. **El arco, que es el que más mandos tiene** y el que ya tiene bloque en la tarjeta: añadirle los controles
   contra `opciones_admitidas` y `limites_de`, con la vista previa en vivo.
2. **Pintar racimo por racimo**: el SVG del motor ya marca cada globo con su sección, su capa, su fila y su
   color (`data-b`, `data-c`, `data-f`, `data-k`), y `VistaMotor` ya resuelve el clic. Falta escribirlo en
   `capas` y `secciones`.
3. **La columna y la guirnalda**, con el mismo molde.
4. **Que el modelo parta del armado existente** en `armar_estructura`.

## Estado del paso 1 (2026-10-02): editar el arco

**Hecho.** `BloqueArco` ofrece «Editar arco», plegado por defecto. Al abrirlo, el dibujo del bloque es el que el
motor hace del borrador y debajo van tres apartados plegables:

- **Diseño de color**: los patrones que el motor publica, con sus mandos (etiqueta, ayuda, rango, paso y valor por
  defecto de `opciones_admitidas`); **qué color de la pieza cumple cada papel del patrón** (un selector por posición;
  en los patrones de lista, agregar o quitar posiciones dentro del rango del motor).
- **Forma y tamaño**: forma, ancho, alto (un semicírculo no lo tiene) y globos a lo ancho, con los rangos de
  `limites_de`, que llegan con cada dibujo y cambian con el armado puesto (R36 sube el ancho mínimo de 1,3 a 3,8 m).
- **Globo**: tamaño (`opciones.tamanos`) e inflado.

Lo que el motor corrige se dice en sus avisos, en español, junto al dibujo (región viva: se anuncia). Lo único escrito a
mano: los nombres de las tres formas (el motor publica la clave), los textos de los apartados y el paso de dos
deslizadores (0,1 m y 5 %). El rango del inflado se lee del contrato porque `opciones_admitidas` no lo publica.

**La edición `armado_arco` no existía** y se añadió con el molde de `armado_guirnalda`: `EdicionArmadoArcoSchema`
(`edicion-esquemas.ts`), la acción en `/api/plan-editar` y en `plan_edicion.py`. No toca `plan.py`, `main.py` ni
`domain-v1.ts`. Guardar cambia el `plan_hash` y el token: lo firma de nuevo la ruta de siempre, la tarjeta publica el plan
nuevo, avisa «es otra decoración» con el nuevo total y ofrece «Deshacer»; con la propuesta aprobada, «Regenerar visual».

### Correcciones tras la revisión adversaria (mismo día)

- **Un arco que el contrato no admite ya no es un 500.** R5 de 10 por 6 m son 1.613 globos y el contrato publica 1.200.
  `armado_arco.armado_resuelto` (la puerta que usan la vista previa, la edición y la resolución) lanza
  `demasiados_globos` con su frase en español («…usa un globo más grande o reduce el ancho o el alto»), calculada por
  Python. Se sondearon 1.200 armados al azar y las 1.929 esquinas de rangos (14 patrones × formas × extremos de ancho,
  alto, globos a lo ancho y los 6 tamaños): ningún otro límite del contrato falla.
- **Cambiar los colores de la pieza revalida el armado** (`plan_edicion._revisar_armado_arco`). Al quitar un color, los
  índices se corren y las posiciones que lo usaban se descartan; si el patrón ya no cabe, el arco baja a sólido y se dice.
  Al agregar uno, el armado vale y se avisa que no lo usa. Nunca queda un índice inexistente. En el editor, si los colores
  cambian bajo el borrador: «Los colores de la pieza cambiaron: revisa el patrón», el dibujo se vuelve a pedir con los
  colores de ahora, Guardar espera y el decorador elige «Seguir con mi borrador» o «Usar el arco de la propuesta».
- **El armado manda en la pieza.** Guardar escribe `medidas` (ancho y alto) con lo que el motor dice que mide el arco, así
  la tarjeta, el cálculo y el blueprint hablan del mismo arco y de lo mismo que se cobra.
- **Un color de la pieza que el arco no toma se avisa antes de guardar** (en la vista previa y en el aviso del guardado):
  no se compraría. No se rechaza, porque un arco sólido sobre una pieza de dos colores puede ser lo que se pide.
- **Reparto y mezcla** ya no se ofrecen en un arco armado (la tarjeta lo explica en una línea) y Python los rechaza
  (`armado_arco_activo`, 409): solo movían el `plan_hash` con el mismo total.
- **Sin cobertura de catálogo no se firma.** Si el armado nuevo deja sin variante de catálogo un globo que antes sí
  estaba (R36 en el catálogo de prueba), `aplicar-edicion.ts` rechaza con 422 y la frase, antes de firmar. «Listo para
  guardar» ya no promete «así queda»: dice que la compra se recalcula con el catálogo.
- **Salida**: «Volver a la receta» (confirmación con lo que se pierde) en el editor y también cuando el armado del plan
  no se dibuja (ahí guarda la receta del motor).
- Cambiar de patrón quita las capas y las secciones (nombran posiciones de `materiales`); foco al encabezado del editor
  al abrir; botones de reintento de 44 px; tope de 4 dibujos en vuelo por proceso en `/api/plan-armado-arco` (429 con
  frase y `Retry-After`); la vista previa usa `MERMA` de `plan.py` y no una copia; la lista de patrones tolera uno que el
  contrato aún no conoce.

### La imagen lee el armado del arco (2026-10-02)

Python describe el armado resuelto y TypeScript solo lo inserta, por la misma puerta que el patrón, el bouquet y la
guirnalda:

- `app/armado_arco_prompt.frases_arco` escribe dos frases: `prompt_gemini` (inglés, con las medidas ya armadas, el
  tamaño del globo y cada color en su papel) y `prompt_lora` (inglés ASCII, **sin cifras ni medidas**, el LoRA no
  aprendió números). Cubre los catorce patrones; la de Gemini cierra con «solo globos: sin cintas, serpentinas ni
  tela» (lección de ADR-0032) y la del LoRA no lleva negaciones.
- Viajan en `plan_resuelto.armados_arco[]` junto a `estructura_id`: campos **derivados y opcionales** del contrato
  (`ArcoResueltoSchema`: Zod, exportación, modelos), fuera del snapshot y de `plan_hash`. La vista previa del editor
  devuelve los mismos tres campos. Los vectores dorados no cambian.
- `frasesDeEstructuras` añade cada arco que trae su frase y **reemplaza** la del patrón de esa pieza (el armado ya dice qué
  patrón lleva). Un plan sin `armados_arco`, con la lista vacía o con arcos sin frase (resueltos antes de esto) da
  exactamente las frases de antes: los prompts siguen siendo byte a byte los de siempre.
- Pruebas: `test_armado_arco_prompt.py` (catorce patrones, ASCII y sin cifras en el caption, medidas ya armadas, orden de
  `invertir`) y `test-armado-arco-prompt.ts` (sin armado, igual que antes; con armado, la frase entra en la línea de color
  del arco de Gemini y en el caption LoRA, que cabe y pasa el control de idioma; coherencia pasa).
- **No se midió** cómo responden Gemini ni el LoRA a estas frases: no hay generación de imagen sin pagar. La redacción
  sigue la de las otras piezas y no se ha evaluado; queda para una medición con tope de gasto.

### La imagen lee también el armado de la guirnalda orgánica (2026-10-04)

Lo mismo para la pieza del paso 3, por la misma puerta y con el mismo contrato. Lo motivó un fallo visible: una
guirnalda contra la pared del fondo salía de la LoRA como **un arco de pie con dos patas en el piso**, una y otra
vez.

La causa no era el motor, que la dibujaba bien: era que el caption no tenía nada que decir de ella. Sin frase, la
cláusula quedaba en «an organic balloon garland ... against the rear wall», y en el vocabulario de v004 un arco de
verdad es «organic balloon garland arch» (regla 4 de `scripts/lora/recaption-v004.ts`): la frase del arco **a una
palabra**, sin nada que dijera que es una tira. La decisión 28 de ADR-0032 ya había anotado exactamente este fallo y
su cura, pero su frase solo viaja con el armado de ADR-0032, detrás de `GUIRNALDAS_ARMADO_V1`, apagada por defecto.
La guirnalda que se arma de verdad hoy es la del motor orgánico, y no producía ninguna.

- `app/armado_guirnalda_organica_prompt.frases_guirnalda_organica` escribe las dos frases desde la **línea** del
  motor: `alturaM` dice si va montada en alto (y entonces «both ends free», que es lo que impide las patas) o
  apoyada en el piso; `colgadoM` si cuelga en festones, arquea hacia arriba o va tensa; `ondaM`/`ondas` la
  ondulación; `pendienteM` qué extremo va más alto. El vocabulario es el de ADR-0032 a propósito: se midió contra
  este corpus y ya está probado. Ninguna frase nombra un arco, patas, bases ni soportes.
- Viajan en `plan_resuelto.armados_guirnalda_organica[]` con `estructura_id`, igual que el arco: derivados,
  opcionales, fuera del snapshot y de `plan_hash`. Un plan resuelto antes de esto no los trae y da las frases de
  siempre.
- `frasesDeEstructuras` las añade y **reemplaza** la del patrón de esa pieza. La entrada lleva además
  `guirnaldaOrganica: { enAlto }`, el único dato que el prompt decide por su cuenta: con la pieza en alto la cola
  deja de pedir «grounded supports», que era la otra mitad de lo que la decisión 28 había diagnosticado.
- Cuando no hay armado, la **ubicación** dice al menos la forma: `fondo_pared` pasa de «against the rear wall» a
  «running along the rear wall» en el dialecto de v004 (`SCENE_V004_GARLAND_PLACEMENTS`), el mismo recurso que el
  semiarco ya usaba. Con armado no se aplica: la frase del motor ya la posiciona y mejor.
- Pruebas: `test_plan_armado_motor.py` (la frase llega, dice la línea, es ASCII y sin cifras, no nombra arcos ni
  patas, y vive fuera de la estructura), `test-lora-caption-compiler.ts` (la ubicación da la forma sin armado, la
  frase del motor manda con armado, y la cola no promete apoyos) y `test-armado-guirnalda-prompt.ts`.
- **Tampoco se midió** con el LoRA, por lo mismo. Lo que respalda la redacción es la observación anotada en la
  decisión 28, no una medición nueva.

**Latencia medida** (navegador a Next a Python y vuelta, servidor de desarrollo, Windows; varias pasadas): mínimo 211 ms,
mediana ~290 ms, p90 ~900 ms, máximo 2.806 ms. Solo el motor en proceso: 40 a 154 ms. Pasa de ~250 ms: los deslizadores
**aplican al soltar** y los demás mandos esperan 300 ms.

**Quedó fuera o pendiente.**
- Capas a lo ancho y secciones por altura (paso 2).
- Un arco sin `armado_arco` no se puede editar (el bloque solo se monta con armado).
- A 360 px el dibujo queda fuera de vista al bajar a los mandos: dejarlo pegajoso no es simple porque la tarjeta tiene
  `overflow-hidden` y un `sticky` dentro no pega al viewport.
- La edición de color no pasa por un selector del catálogo: solo reordena los colores que la pieza ya lleva.

**No se probó.** El guardado real de punta a punta (token firmado, re-resolución contra el catálogo, auditoría): requiere
pagar al chat. Cubierto por pytest (acción, endpoint, resolución del plan editado con hash, conteo, medidas, color sin uso
y R36 sin cobertura), por la ruta de Next (unión del cuerpo, cobertura, tope) y por Playwright con `/api/plan-editar`
simulado. Tampoco un `next build` (pisaría el servidor de desarrollo) ni un lector de pantalla real.

**Preexistente, sin tocar.** `/api/plan-editar` no llama a `isAuthenticatedRequest` (solo la guarda el proxy); «Deshacer»
no limpia `editadoTrasAprobar`.

## Estado del paso 3, la guirnalda del motor (2026-10-02): vista, editor y reglas

**Hecho.** La guirnalda llega al mismo punto de cableado que el arco, con su editor:

- `BloqueGuirnaldaOrganica` (`src/components/plan/guirnalda-organica/`) toma el sitio del dibujo del patrón cuando la
  pieza trae `armado_guirnalda_organica`: el SVG del motor (lienzo apaisado de 760 por 440, así que el dibujo va arriba
  a todo el ancho), las medidas reales, lo que lleva de cada color y de cada tamaño, lo que hay que comprar, los
  adornos que no son globos, los globos sueltos y los avisos. No calcula nada. Es el gemelo de `BloqueArco`, con
  `peticion-armado-guirnalda-organica.ts`, `vista-guirnalda-organica.ts` y `usarVistaGuirnaldaOrganica.ts`. Cuando una
  pieza trae también el armado por partes (ADR-0032) manda el del motor y `BloqueGuirnalda` no se pinta.
- **La vista previa compraba con otro margen que el plan.** `plan_armado_guirnalda_organica` usaba el desperdicio del
  diseñador (12 %) y la resolución compra con `MERMA` (8 %): el editor habría enseñado una lista de compra que el plan
  nunca iba a cobrar (43 globos contra 42 en la receta de prueba). Ahora usa `MERMA`, como ya hacía el arco, y una
  prueba compara la vista con `plan._resolver_con_el_motor`.
- **Un color de la pieza que la paleta no toma se avisa** antes de guardar (`avisos_colores_sin_uso`), igual que en el
  arco.
- **Con guirnalda armada, el reparto y la mezcla no se editan** (`armado_guirnalda_organica_activo`, 409, y la tarjeta
  no los ofrece) y **cambiar los colores de la pieza revalida la paleta** (`plan_edicion_guirnalda_organica.py`): al
  quitar un color los índices se corren y se avisa; si la paleta se queda vacía pasa al primer color; si lo que queda
  no se sostiene, el cambio se rechaza con la frase del motor. Antes quitar un color dejaba índices que apuntaban a
  otro color o a ninguno.
- `/api/plan-armado-guirnalda-organica` limita los dibujos en vuelo a 4 (429 con frase y `Retry-After`), como el arco: el
  motor de la guirnalda es el más caro. Y tiene por fin una prueba de ruta.
- El camino viejo de la rejilla (`patron_color`) ya no cuenta ni dibuja una guirnalda con armado: la resolución la
  cuenta el motor (`_conteo_del_motor`) y la tarjeta enseña el bloque del motor. Sigue vivo para una guirnalda sin
  armado, para la pared y para el centro de mesa.

- **El editor** (`EditorGuirnaldaOrganica`, plegado tras «Editar guirnalda»): cinco apartados contra
  `opciones_admitidas` y `limites_de` (forma, volumen, tamaños de globo con su peso, colores con acabado y papel
  —con el reparto y la mezcla— y adornos). Los deslizadores aplican al soltar, la vista previa tiene pausa de 300 ms,
  cancelación y «gana la última», Guardar solo se ofrece con un dibujo que el motor ya hizo, y los colores de la
  pieza que cambian bajo el borrador se dicen. Los rangos que el motor no publica se leen del contrato Zod, no se
  escriben aparte. Reutiliza los mandos genéricos (`DeslizadorArco`, `SeleccionArco`, `GrupoOpcionesArco`) y
  `RecetaArco` del editor del arco: si allá cambian de sitio, aquí hay que seguirlos.
- **Guardar** es la acción `armado_guirnalda_organica` de `/api/plan-editar` (`edicion-esquemas.ts`,
  `aplicar-edicion.ts`, `plan_edicion_guirnalda_organica.py`): Python valida contra la pieza sin catálogo con la
  misma puerta de la vista previa y de la resolución, **pone el largo de la pieza con el del motor**, avisa de un color
  de la pieza que la paleta no toma, y una guirnalda sin cobertura de catálogo no se firma.

**Falta.** Que el armado de la guirnalda entre a los prompts de imagen (exige un campo nuevo en `domain-v1.ts`, fuera
de este paso), y la edición por clic de un racimo (paso 2, solo existe para el arco). No se probó el guardado real de
punta a punta (token firmado, re-resolución contra el catálogo): requiere pagar al chat; está cubierto por pytest
(`test_plan_edicion_guirnalda_organica.py`), por la ruta de Next (la acción llega a la comprobación de la aprobación y
un cuerpo mal formado es 400) y por Playwright con `/api/plan-editar` simulado.

## Estado del paso 3, la columna (2026-10-02): vista, editor y reglas

La columna tenía motor (`app/columna/`, 135 vectores de geometría y 60 de dibujo), puerta (`armado_columna.py`) y
conteo en `plan.py`, pero **ni vista previa ni editor ni acción de guardado**: era de solo lectura y la tarjeta seguía
dibujándola con la rejilla de `patron_color`. Ahora tiene el mismo molde que el arco:

- **Puerta**: `armado_columna.py` suma `grafica_de` (el SVG con los tonos de la pieza, del mismo motor que colocó los
  globos), `limites_de` (alto, foil y qué globo o racimo cabe como remate, que cambian con el armado puesto),
  `avisos_colores_sin_uso` e `indices_usados`. `armado_resuelto` no dibuja: la resolución del plan no paga un SVG.
- **Vista previa**: `plan_armado_columna.py` y `POST /internal/v1/plan/armado-columna` (scope `plan.armado_columna`),
  `/api/plan-armado-columna` (tope de 4 dibujos en vuelo, 429 con frase y `Retry-After`) y `peticion-armado-columna.ts`.
  Sin armado devuelve la receta del motor con el alto de la pieza; con él, la columna resuelta, el SVG, el armado de
  vuelta, las herramientas (`opciones`, los nueve patrones) y los rangos vivos (`limites`).
- **Edición**: la acción `armado_columna` de `/api/plan-editar` (`EdicionArmadoColumna`, `plan_edicion_columna.py`):
  valida el armado contra la pieza sin catálogo, **pone las medidas de la pieza con las del motor** (alto total y
  diámetro), rechaza el reparto y la mezcla en una columna armada (`armado_columna_activo`, 409), revalida el armado al
  cambiar los colores de la pieza (índices corridos, remate que sigue a su color, capas que se quedan sin colores,
  baja a sólido y lo dice) y avisa del color de la pieza que el armado no toma. Un tamaño de globo sin cobertura en el
  catálogo se rechaza antes de firmar (`faltaCoberturaPorElArmado`, ahora también para columnas).
- **Pantalla**: `components/plan/columna/` (`BloqueColumna`, `EditorColumna`, `ControlesColumna`, hooks y
  controladores de vista y borrador), gemelo del arco. Toma el sitio del dibujo del patrón cuando la pieza trae
  `armado_columna`. Cuatro apartados plegables: diseño de color, forma y tamaño, remate y globos. No muestra «lo que
  hay que comprar»: la compra de la pieza la cuenta `plan.py` y la columna resuelta no la publica (no se tocó el
  contrato).

**Dos hallazgos del barrido** (1.500 armados al azar dentro del contrato; el primer barrido de 240 ya encontró armados que no cumplían
`plan-resuelto.v1`): el motor calcula la profundidad de un globo como `z / rho_max` y con desorden y variación de
tamaño en sus extremos pasa de 1 (hasta 1,06), pero el contrato la publica en [-1, 1]; y una columna sin remate sale
con la descripción vacía y el contrato exige una frase. Ambos son latentes en la resolución del plan (cualquier
`armado_columna` con esos mandos habría fallado la validación). La puerta publica la profundidad acotada y «Sin
remate» como descripción; el motor, su dibujo y sus vectores de oro no se tocaron.

**El motor antiguo de la columna (rejilla de `patron_color`).** Una columna con `armado_columna` ya no se cuenta ni se
dibuja con la rejilla, igual que el arco y la guirnalda. **Sigue vivo** para una columna sin armado (los planes ya
firmados, que no llevan armado y cuyo `plan_hash` no puede moverse) y no se borra: `ui:test-armado-guirnalda`
fija byte a byte la tarjeta sin armado, y la tarjeta ofrece «Crear patrón» a toda pieza geométrica. Retirarlo del
todo exige dos decisiones que no son de este paso: encender `ARMADO_ARCO_COLUMNA_V1` en producción (hoy solo fuera de
producción, porque cambia el `plan_hash` de los planes nuevos) y dar a una columna ya aprobada una salida a la
receta del motor (un botón «Armar con el motor» con confirmación, que cambia total y firma).

**Quedó fuera o pendiente.**
- El armado de la columna no entra todavía a los prompts de imagen (el del arco tampoco: `armado_arco_prompt.py`).
- «Armar con el motor» para una columna sin armado (arriba).
- Pintar capa por capa en el dibujo (el SVG de la columna no marca cada globo con `data-`; el arco sí).
- La compra y el desperdicio de la columna resuelta (decisión de contrato, ADR-0033 «Quién cuenta lo que se compra»).
- No se probó el guardado de punta a punta (token firmado y re-resolución contra el catálogo): requiere pagar al
  chat. Cubierto por pytest (acción, endpoint, resolución con hash, conteo, medidas, color sin uso, cobertura), por la
  ruta de Next y por Playwright sobre la vista previa real.

## Estado del paso 3, la columna orgánica (2026-10-02): motor, vista, editor y reglas

La columna orgánica es la columna irregular del diseñador del repo `clasificador-decoraciones` (`src/lib/columnaorg/`,
sobre el motor compartido `src/lib/organico/`): globos de varios tamaños, más ancha abajo que arriba, racimos que se
solapan, follaje, flores y un globo grande opcional sobre la punta. **Convive con la columna clásica de anillos y
patrones** (`armado_columna`, arriba) y no la reemplaza: cuando una pieza trae los dos armados, manda el clásico, que
es el que ya existía (`plan.py`, la tarjeta y la ruta de edición lo respetan).

**El motor.** Port 1 a 1 a `services/ai-api/app/columnaorg/` (reutiliza `app/organico/`). Su oráculo es dorado y lo
genera el repo dueño (`clasificador-decoraciones/scripts/migracion/vectores-columnaorg.ts` →
`contracts/domain/v1/golden/columnaorg/vectores-columnaorg.json`, 216 vectores con cada globo y el sha256 de cada
SVG); `tests/test_columnaorg.py` pasa los 1084 casos. Nunca se regeneró desde la implementación en prueba.

**Contrato y puerta.** `armado-columna-organica.v1` (Zod en `src/lib/plan/armado-columna-organica.ts`, exportado a
`plan-decoracion.v1` y `plan-resuelto.v1` como `armado_columna_organica` y `armados_columna_organica[]`). La puerta es
`app/armado_columna_organica.py`: valida contra el contrato y contra la pieza, traduce entre índices de material y la
paleta del motor, publica `opciones_admitidas` (8 formas listas, 4 estilos, acabados, repartos) y `limites_de` (rangos
vivos y qué globos caben sobre la punta). El globo grande de la punta es el índice `−1` del motor y se traduce al
material de `corona.material`. `plan.py` cuenta con el motor cuando la pieza lo trae (tabla `_ARMADOS_DEL_MOTOR`,
clase `columna_organica`, con la misma `MERMA` que el resto del plan); la lista publicada queda fuera del snapshot y del
`plan_hash`.

**Vista previa, edición y pantalla.** `POST /internal/v1/plan/armado-columna-organica` (scope
`plan.armado_columna_organica`) y `/api/plan-armado-columna-organica` (tope de 4 dibujos en vuelo, 429 con
`Retry-After`). La edición `armado_columna_organica` entra por `/api/plan-editar` con las mismas reglas del arco:
valida sin catálogo, el alto lo pone el motor, reparto y mezcla se rechazan con 409
(`armado_columna_organica_activo`), cambiar los colores de la pieza revalida el armado (el índice del globo grande
sigue a su color) y un tamaño sin cobertura de catálogo no se firma. La pantalla (`components/plan/columna-organica/`)
tiene el bloque con el dibujo del motor y el editor: el interruptor «Globo grande arriba» va primero (con su tamaño,
solo los que el motor admite, y su color), formas listas y estilos copiados de `opciones`, y los rangos vivos.

**Hallazgos.**
- El motor publica la compra y el conteo por posición de paleta; el globo grande y un color de la paleta pueden ser el
  mismo material y salían en dos filas. La puerta los une (el total es la suma de lo comprado por fila y no cambia).
- El aviso del original «Ningún globo queda bien sobre una punta tan delgada» sale también cuando la punta es
  demasiado **gruesa** (no hay globo tan grande). Se conserva tal cual por paridad con el oráculo; la ayuda del
  interruptor de la pantalla sí dice «gruesa». Conviene corregirlo en el repo dueño.
- La salida del modelo no escribe `armado_columna_organica`: `sinArmadosDeMotor` lo descarta con la bandera apagada y
  `sinColumnaOrganicaDelModelo` con ella encendida, porque ninguna herramienta lo completa.

**Quedó fuera o pendiente.**
- Cómo obtiene una columna su `armado_columna_organica`: hoy solo por la edición del plan (editor, chat o API) o porque
  el plan ya lo trae. Un botón «Armar con el motor» sobre una columna sin armado **no se pudo añadir**: cambia la
  tarjeta sin armado y `ui:test-armado-guirnalda` la fija byte a byte (sha256); lo intenté y lo retiré. Hace falta
  decidir si se actualiza ese oráculo (a mano, con el motivo) y si la IA debe armar columnas orgánicas en vez de
  clásicas, lo que cambia el `plan_hash` y el precio de todo plan nuevo.
- El armado no entra a los prompts de imagen y el SVG de la columna no marca cada globo (no hay pintado por capas).
- No se probó el guardado de punta a punta (token firmado y re-resolución con el catálogo real): requiere pagar al chat.
  Cubierto por pytest, por la ruta de Next y por Playwright con `/api/plan-editar` simulado.

## Estado del paso 3, el arco orgánico (2026-10-02): contrato y puerta

El motor orgánico (`app/organico/`) **es** el del arco orgánico —su diseñador en el repo dueño es
`/arcos-organicos`, sobre `src/lib/organico/`, y el encabezado de `formas.ts` dice «Formas listas: la disposición
de un arco orgánico»—, pero en `pictures` solo estaba expuesto como guirnalda y como columna orgánica: las
`FORMAS_LISTAS` del arco (`puerta`, `medio-pila`, `medio-corto`, `medio-aireado` y las demás) no estaban
disponibles para ningún arco. **Un medio arco es este armado con `forma.corte < 1`**, que es lo que queda de
`semiarco` desde que la taxonomía lo retiró.

**Hecho: la puerta y el contrato, nada más.**

- **Contrato** `armado-arco-organico.v1` (`src/lib/plan/armado-arco-organico.ts`), con el molde de la columna
  orgánica: reutiliza los esquemas de tamaños, paleta, adornos y aspecto de `armado-guirnalda-organica.ts` —es
  el mismo motor compartido— y añade los suyos (`FormaArcoOrganicoSchema`, `VolumenArcoOrganicoSchema`,
  `ArcoOrganicoResueltoSchema`) y la lista de ids de las once formas listas que publica el original.
  `armado_arco_organico` entra en las dos estructuras del plan (`EstructuraPlanSchema` y
  `EstructuraPlan1_1Schema`, en `src/lib/plan/tipos.ts`), exportado y con los modelos regenerados.
- **Puerta** `app/armado_arco_organico.py`: valida contra el contrato (el esquema exportado, no una lista a
  mano) y contra la pieza, resuelve con `app.organico.generar`, une el conteo y la compra por material
  (`app.organico.unir`), publica `opciones_admitidas()` —acabados, repartos, papeles, tamaños, rangos
  absolutos, las **once formas listas** y los cuatro estilos, con sus valores— y `limites_de()` con los rangos
  vivos y los tamaños que caben en el grosor de ahora.
- `app/organico/config.py` gana `normalizar_config_con_cambios`, la gemela de las de
  `app.guirnalda.limites` y `app.columnaorg.limites`: sin ella los avisos del saneado se perdían dentro de
  `normalizar_config` y el cliente no se enteraba de que se le quitó un tamaño de la mezcla.

**Tope de globos.** 500 estimados, no 300 como en la columna y la guirnalda: «Arco de entrada lleno» estima
485, y una forma lista que la puerta rechaza no sería una forma lista. Medido en esta máquina (una hebra,
Python 3.11): 113 globos reales en 0,3 s, 273 en 1,0 s, 589 en 3,4 s, 900 en 7,0–9,7 s. Por encima del tope se
responde `demasiado_grande` con su frase en español en vez de ocupar el hilo ~10 s detrás de una petición que
ya venció.

**Barrido.** 60 armados al azar dentro del contrato, resueltos por la puerta y validados contra el Zod del
armado y del resuelto: los 60 pasan (8 más se rechazaron por `demasiado_grande`, que es la respuesta correcta).
No apareció ningún límite del contrato que el motor incumpla, a diferencia de lo que pasó con la columna.

**Quedó fuera, a propósito.** El conteo en `plan.py` (la clase `arco_organico` en `_ARMADOS_DEL_MOTOR` y
`_TIPO_DE_CLASE`), `armados_arco_organico[]` en `plan-resuelto.v1` (vive en `src/lib/ia/contracts/domain-v1.ts`),
la ruta de vista previa, la acción de edición, la pantalla, los prompts de imagen y las pruebas. **Sin eso un
arco orgánico todavía no se cuenta ni se cobra**: hoy solo se puede validar y resolver por la puerta.

**Quién manda cuando hay dos armados.** Con `armado_arco` (el clásico) y `armado_arco_organico` en la misma
pieza debe mandar el clásico, como la columna clásica sobre la orgánica: es el que ya existía y el que ya
cuenta. Lo decide la tabla de `plan.py`, así que la regla no está escrita todavía en ningún sitio ejecutable
—solo en los dos contratos—. Y nada impide que una pieza traiga a la vez `armado_guirnalda_organica` y
`armado_arco_organico`: cada puerta rechaza la pieza que no es suya (`es_arco`, `es_guirnalda`) y la tabla de
`plan.py` lee solo el armado del tipo de la pieza, así que el otro queda dentro del plan firmado sin que nadie
lo use. Conviene decidir si el contrato debe rechazar esa pareja (un `superRefine` cruzado en `tipos.ts`) antes
de que la IA o el editor puedan escribir los dos.

## Consecuencias

- Un armado editado cambia el `plan_hash`, porque el armado va dentro del plan firmado. Es correcto: es otra
  decoración.
- La vista previa pide el dibujo a Python en cada cambio. El motor orgánico es el más caro de los tres (~230 ms
  por pieza); el `debounce` y el `lru_cache` que ya existen lo cubren, pero conviene medirlo antes de dar por
  bueno un deslizador continuo.
- Lo que hoy no se puede editar seguirá sin poder editarse: pared, centro de mesa, aro, semiarco y escultura no
  tienen motor migrado y se quedan con el camino de siempre.
