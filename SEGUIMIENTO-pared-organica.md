# Seguimiento: la pared orgánica, los colores de la foto y el croquis

**Escrito el 2026-09-29 a las 17:14.** Documento de traspaso de una sola sesión.
Quien lo retome debe leer `AGENTS.md` y, de los ADR, el 0034, 0035 y 0036, que
son los que nacieron aquí.

`main` local está en **`f9cd78e`, 54 commits por delante de `origin/main`, sin
subir**. El contrato cambió, así que la app y `ai-api` se despliegan **juntas**.

---

## 0. Lo primero al retomar: hay trabajo sin commitear

Al cerrar la sesión quedaron cambios **en el árbol de trabajo, sin commit y sin
verificación completa**:

```
 M services/ai-api/app/patron_color.py
 M services/ai-api/tests/test_patron_color.py
 M contracts/domain/v1/golden/plan-resolution/32-pared-organica-zonas-tres-colores.json
```

Qué son: el arreglo de `zonas_lora`, que decía `"over a {color} base"` y ahora
dice `"among {color} balloons"` (§4.3), su test, y el vector dorado regenerado
por el cambio de frase.

**Lo que falta antes de commitearlo**: la verificación completa quedó a medias.
Correr y comprobar la salida real de:

```
uv run --system-certs --directory services/ai-api --extra test pytest -q
npx tsc --noEmit && npm run -s lint && npm run -s plan:test
git status contracts/domain/v1/golden/    # solo el 32 debe salir
```

Aviso de una trampa ya vista dos veces: al regenerar vectores, git marca
`18-colores-foto-paleta.json` como modificado por **finales de línea**, sin
diferencia de contenido. Se restaura con `git checkout --` y no es un cambio real.

---

## 1. De dónde salió todo esto

El usuario subió **una foto** (sin texto) de una pared de globos "Mr & Mrs":
blush rosa perlado dominante, dorado cromado agrupado en cuatro zonas, flores
blancas, sobre pared de ladrillo. La propuesta salía mal de tres formas:

1. **Bicolor o monocolor** — llegó a salir con un solo color (Reflex Dorado).
2. **Patrón "Confeti"** — colores salteados uniformes, cuando la foto tiene racimos.
3. **Imagen de un muro plano** y, más tarde, de un panel liso con globos al borde.

Resultaron ser **una cadena de siete causas distintas**, no tres problemas.

---

## 2. Las causas encontradas, en orden de descubrimiento

Cada una está verificada en el código, con su arreglo y su commit.

### 2.1 La pared no podía ser orgánica (`b7be2c9`)

`identificarEstructuraOficial` consulta la variable `asimetrica` para elegir la
variante de arco, semiarco y columna. **La pared era el único tipo que no la
miraba**: decidía solo por densidad. Una pared densa *y* orgánica caía
forzosamente en `pared_densa`, que es `forma: "simetrica"` y manda
`"dense balloon wall installation"` al prompt.

Se añadió `pared_organica` como variante, con `forma: "asimetrica"` igual que
`arco_asimetrico` y `columna_asimetrica`.

### 2.2 El embudo: la palabra del modelo se volvía exigencia del cliente (`91b7fa8`)

**La causa más grave de todas.** `filtrosDurosDeBusqueda` guarda las
restricciones del cliente (colores, ocasión, categoría, **acabado**, precio) en
la solicitud original y el brief, justamente para que un enriquecimiento del
modelo no acabe siendo un predicado SQL. Tenía un `||` de más:

```js
const solicitud = input.solicitudOriginal.trim() || input.mensaje;
```

`input.mensaje` es lo que **escribe el modelo** en su búsqueda. Cuando el cliente
manda **solo una foto**, `solicitudOriginal` viene vacía y el candado se abre: el
modelo lee "chrome gold", busca `"globo latex redondo reflex dorado"`, y `reflex`
queda como **filtro duro del turno**. En el pool no hay Reflex blanco, así que el
blanco y el blush eran inalcanzables; y como `tieneFiltrosNoRelajables` cuenta los
acabados, también **apagaba el rescate del catálogo**. De ahí la pared monocolor.

Todos los demás arreglos estaban aguas abajo de éste y no podían hacer nada
mientras el filtro vaciara la búsqueda.

### 2.3 El fondo del local exigía colores a la pieza (`d61350b`)

`aplicarColoresReferencia` añade a la primera estructura los colores que la foto
muestra y ninguna pieza compra, para reportarlos en vez de perderlos (E2E
2026-09-15: el rosado de unas sillas desaparecía sin aviso). Esa lista salía de
`coloresFotoCliente`, que lee `palette.observed`, **y ahí entra el local**: la
pared de ladrillo puso "terracotta red" en la paleta y el cliente recibió un aviso
de sustitución por el muro del sitio.

Ahora queda fuera solo el color que aporta **únicamente** un elemento `backdrop`.
Un color que además está en un elemento decorativo —las sillas— sigue avisando.

### 2.4 El acabado se perdía y se reinventaba una vez por pieza (`b4b6175`, `7d8cbc7`)

Al traducir la etiqueta al color de catálogo, `"pearl blush pink"` se volvía
`"rosado"` a secas: el acabado se tiraba. La regla para recuperarlo vivía **solo
en el prompt** ("chrome/metallic = reflex, pearl = satin"), o sea era una
inferencia que el modelo hacía **una vez para toda la estructura**. Por eso el
cromado del dorado se contagiaba al blush.

- `coloresConAcabadoReferencia` lo resuelve **en código, uno por color**, y el
  prompt lo entrega ya resuelto. Un color cuya etiqueta no dice nada del acabado
  viaja **sin** acabado: el silencio no es "mate".
- Y después se **cumple**, no solo se pide: si el producto elegido no trae ese
  acabado y la búsqueda tiene el mismo color en él, se compra ése. Si el catálogo
  no lo ofrece, se avisa. **Un acabado nunca quita un color.**

### 2.5 La auditoría de color miraba en un solo sentido (`c225b58`, ADR-0034)

Había maquinaria entera para detectar colores de la foto que el plan **no**
compra, y **nada** para el caso inverso. El modelo metió un `Reflex Fucsia` al
15 % que la foto no tiene y nadie lo paró.

Ahora se poda en la frontera. Invención y sustitución se separan con el ΔE que el
repo ya usaba: *oro rosa* está a 23 del rosado observado y se queda; el *fucsia*,
a 48, se va.

### 2.6 El confeti no es un fallo: es el único patrón que una pared podía tener

`_TIPOS_ESPIRAL_SUGERIDA = {columna, arco, semiarco, guirnalda}` — **`pared` no
está**, así que su preset cae siempre a `aleatorio`. Y una pista de la foto con
modo `aleatorio` produce la **misma base byte a byte** que el preset, porque
ignora los colores y los pesos leídos. Dos caminos, el mismo confeti; sólo los
separa el campo `origen`, que la propuesta no mostraba (arreglado en `05966ae`).

Más de fondo: los modos de una pared (`anillos, bloques, degradado, aleatorio,
damero`) son **todos periódicos o a lo largo de un eje**. "Racimos agrupados en
zonas" no se podía decir. Eso llevó al modo `zonas` (§3.3).

### 2.7 Las frases del patrón le pedían al generador lo contrario (`8586da2`, ADR-0035)

El prompt de imagen **no estaba callado**: sin frase de patrón caía en
`ORGANIC_COLOR_DISTRIBUTION`, que pide *"intentional organic **clusters**"* y
prohíbe *"random speckles"*. Al confeti se le estaba pidiendo agrupar cada color
en racimos y se le prohibía el salpicado. **Las franjas verticales no fueron
silencio del prompt, fueron obediencia.**

---

## 3. Lo que se construyó

### 3.1 Hoja de cotización editable (`0ed361e`)

La plantilla real del negocio, con las cuatro secciones que el sistema no
manejaba: materias primas, mano de obra, equipos y transporte, costos indirectos,
más utilidad editable (30 % por defecto) y total.

**El sistema es un wrapper**: esos valores los escribe el usuario. Solo las
materias primas se precargan de los globos que el plan ya calcula. Comprobado
contra la cotización real nº 128: `206.750 × 30 % = 62.025`, total `268.775`.

Quedó fuera: exportar a CSV/PDF, y la persistencia es en memoria como el borrador
que ya existía (se pierde al recargar).

### 3.2 Motor de silueta y croquis (`890eca8`, `060ec43`, `b6ce525`)

`services/ai-api/app/silueta.py` genera la **silueta real** de una pieza: espina
con tangente y normal para arco, semiarco, columna y guirnalda; contorno con
borde vivo para la pared orgánica; globos colocados por capas de profundidad,
determinista por semilla. Inspirado en el motor de `clasificador-decoraciones`
(`src/lib/organico/`), adaptando el modelo, no copiando el código.

`silueta_patron.py` lo conecta al plan: los cupos salen del **despiece que ya se
compra**, así que las posiciones son tantas como globos cotizados y **`plan_hash`
no se mueve** (`patrones_color` vive fuera del snapshot).

El editor dibuja la misma pieza que la propuesta: como las posiciones no dependen
del color, el croquis se recuerda por petición y repintar bajó de **135–878 ms a
1–2 ms**.

### 3.3 El modo `zonas` (`6e472cc`, ADR-0036)

El octavo modo, y el primero cuyo dibujo no es periódico ni va a lo largo de un
eje: **fondo + hasta 8 manchas** de `{material, ancla, extension}`. Las nueve
anclas son los sitios en que un decorador parte una pared al describirla
(`superior_izquierda` … `inferior_derecha`). Varias manchas pueden repetir color:
así se dice "el dorado va en cuatro zonas".

La pista de la foto las declara **por nombre de color**, no por índice — quien
mira la foto no conoce los materiales de la pieza — y Python los resuelve con la
misma tabla de tonos. TypeScript solo guarda la lista de anclas admitidas.

**Consecuencias medidas**: `plan_hash` **se mueve**; participaciones, globos por
color, compras y total **no**. `PROMPT_VERSION` de `patron-referencia` pasa a
`5cbba9bd04d02884`, lo que invalida cualquier medición previa de esa lectura. El
prompt v16 del análisis sigue congelado (ADR-0029 intacto).

---

## 4. Estado real de la imagen, que es lo que sigue fallando

### 4.1 Lo que ya funciona en pantalla

Verificado por el usuario en la app:

- "Pared orgánica contra la pared del fondo" — la clasificación.
- **"Rosado perlado"**, no "rosado" — el acabado llega a la tarjeta.
- Tres colores correctos, sin inventados.
- "Patrón de color **Zonas**", con su descripción y el croquis dibujando el fondo
  y las manchas.
- La imagen **respetó las posiciones**: dorado arriba-derecha, blanco abajo-izquierda.

### 4.2 Lo que sigue mal

La imagen sale como un **panel liso de color con los globos por el borde**, en vez
de una pared de globos. Empeoró justo cuando entró `zonas`, y la razón es §4.3.

### 4.3 La causa, y un error de método que costó tres iteraciones

**El LoRA es el único que genera la imagen. Gemini solo compone prompts.** El
usuario lo aclaró al final de la sesión, y explica por qué dos arreglos seguidos
no cambiaron nada:

| frase | quién la usa | estado |
|---|---|---|
| `prompt_gemini` (`zonas_gemini`) | Gemini | corregida en `e70d5c3`, **no afecta a la imagen** |
| `prompt_lora` (`zonas_lora`) | **el LoRA — genera la imagen** | corregida **sin commitear** (§0) |

`zonas_lora` decía `"…over a {color} base"`. El caption real que recibía el LoRA
era:

```
a large asymmetrical balloon wall in pink, gold and white … with gold clustered
at the upper right corner, plus white clustered at the lower left corner
over a pink base installed against the rear wall.
```

**"over a pink base"** le pide una base rosa: eso es el panel. El arreglo sin
commitear lo cambia a `"among pink balloons"`.

**Lección para quien siga**: antes de tocar una redacción, comprobar **cuál de
las dos frases** llega al generador. Se hace sin gastar un céntimo:

```ts
import { captionLegacyDePlan, textoLora } from "./scripts/lib/escenas-armado-bouquet";
import { frasesDeEstructuras } from "./src/lib/ia/uzume/mezcla-color-escena";
// OJO: hay que pasar `frases` como tercer argumento; sin él el caption sale
// sin la frase del patrón y parece que no llega (me pasó).
textoLora(captionLegacyDePlan(fijado, "product_v007", frasesDeEstructuras(plan)));
```

### 4.4 Sospecha pendiente, sin confirmar

El caption también dice **`"installed against the rear wall"`**, que puede estar
reforzando la idea de un panel trasero. **No está verificado.** Y en el
`scene-spec` de Gemini hay *"Build a complete installed event scene with a rear
backdrop/support"* y *"Place curtain, drape, backdrop, and panel elements as rear
background surfaces"* — pero eso es Gemini, así que **no afecta a la imagen** y no
hay que perseguirlo.

---

## 5. Pendiente, en orden

1. **Commitear y verificar el arreglo de `zonas_lora`** (§0). Es el primer paso.
2. **Prueba pagada, tope acordado US$ 0,50.** El usuario la autorizó y no llegó a
   correrse. La herramienta existe: `scripts/ops/comparar-pared-organica.ts`,
   escrita para esta pared, con vista previa por defecto, `--confirm-spend
   --max-usd`, salidas fuera del repo y LoRA `v004-1000` (el aprobado; `v007-1000`
   está rechazado). Hay que cambiarle la variable única: los dos captions LoRA
   (con `base` contra `among balloons`), misma semilla.
   Lectura: ¿la pared sale llena de globos o sigue siendo un panel?
3. **Por qué el preset puso una zona de dorado y la foto tiene cuatro.** La
   etiqueta decía "Zonas · **sugerido**", o sea salió del preset, no de la lectura.
   Falta saber si el modelo no las detectó o si se reusó un análisis en caché.
   Cuesta céntimos (una lectura de visión).
4. **Decidir el despliegue.** 54 commits sin subir, contrato cambiado: app y
   `ai-api` **juntas**, canario, `readyz`, `prev-<fecha>`. Y decidir qué banderas
   se encienden en producción.
5. **Reaprobar los planes en vuelo**: `zonas` mueve `plan_hash`, así que toda
   pared aprobada con el patrón por defecto deja de validar.

### Decisiones de negocio que quedaron abiertas

- Perlado y cromado pueden tener **precio distinto**: el cambio de producto por
  acabado es a igual color y categoría, pero nadie decidió si necesita aviso o tope.
- `Silk`, `Pastel Dusk`: no están mapeados en `ACABADOS_QUE_CUMPLEN`.
- Si una pieza entera va en el acabado equivocado, hoy se avisa **material por
  material**; se puede agrupar, pero cambia el texto que ve el cliente.
- Que un color de tres sin material descarte el patrón **entero** en vez de
  degradar sigue siendo el comportamiento (`patron_desde_pista`).

---

## 6. Higiene y trampas de esta sesión

- **El lint recorría los worktrees.** Con cuatro abiertos pasaba de 25 avisos a
  **685 problemas / 181 errores** ajenos, que tapan los propios. Arreglado
  excluyendo `.claude/worktrees/**` en `eslint.config.mjs`.
- **Dos supervisores de `ai-api` peleando por el puerto 8000** dejaron el servicio
  cayéndose en bucle, y el síntoma fue *"No pude mirar bien tu foto"*. Revisar con
  `Get-NetTCPConnection -LocalPort 8000` que solo haya **uno**.
- **El HMR de Next no recompila tras un merge grande**: dejó
  `/api/references/analyze` en 404 mientras el resto de rutas seguían vivas. Se
  arregla con un `touch` al fichero de la ruta, o reiniciando `next dev`. Si
  `tsc` se queja de `.next/dev/types/routes.d.ts`, es el mismo síntoma.
- **Un oráculo no se rebasa sin demostrar qué lo movió.** `ui:test-armado-guirnalda`
  llevaba horas en rojo y dos agentes lo atribuyeron al croquis. Era la etiqueta
  "· de tu foto", 75 bytes: quitando *solo* ese `<span>` el HTML volvía byte a
  byte al sha256 congelado. La prueba quedó escrita en el propio fixture.
- **Cuidado al escribir regex con Python**: `\b` dentro de una cadena normal se
  convierte en un carácter de control invisible y el patrón deja de casar. Pasó
  dos veces.
- **Se imprimió la `GEMINI_API_KEY`** en la transcripción por un `sed -n` con un
  rango de líneas demasiado amplio. **Conviene rotarla.**

---

## 7. Gasto

**~US$ 0,05 en total**: una lectura de visión para el diagnóstico (~US$ 0,01) y
dos imágenes de comparación en fal (US$ 0,042, medido contra el saldo real). Todo
lo demás se hizo con pruebas locales y deterministas.

La prueba pendiente (§5.2) tiene tope acordado de **US$ 0,50**.
