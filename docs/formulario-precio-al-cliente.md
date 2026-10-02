# El formulario «Precio al cliente»: qué estaba roto y qué se arregló

Fecha: 2026-10-02 · Estado: **R1–R13 arreglados y verificados en la aplicación real; auditoría de usabilidad aplicada; quedan decisiones de producto abiertas (abajo)**

El formulario que el sistema genera desde la propuesta es el de **«Precio al cliente»**
(`src/components/cotizacion/`, montado en `src/app/page.tsx` dentro de la tarjeta de la propuesta; lógica pura en
`src/lib/cotizacion/` y `/api/cotizacion-profesional` → Python). Python sigue siendo el único dueño de los
números: aquí se decide qué se muestra y cómo, nunca cuánto vale.

## Decisiones de producto (2026-10-02)

Decididas por el usuario el 2026-10-02 (siempre la opción recomendada):

- **R7, precio de un material vaciado: se queda como está.** Un campo en blanco es un precio a medio escribir; no
  se envía nada, la fila dice «falta el precio», el precio anterior se marca no vigente y ↺ vuelve al catálogo.
- **Vocabulario: se queda como está.** *ganancia* (antes «utilidad»), *gastos* (antes «costos»), *Tu trabajo y
  ayudantes*, *Transporte y equipos*, *Otros gastos*, *paquete* (antes «bolsa»), *producto* (antes «línea»),
  *Valor por unidad*, *Lo que te cuesta todo*, *Ajustar mi precio*. Solo cambia el texto visible, no el contrato.
- **Ganancia: campo vacío + fichas «20 % · 30 % · 40 %».** Sin valor por defecto: las fichas rellenan el campo al
  tocarlas y la activa se marca cuando el valor coincide (también si se escribe a mano «30»). Son botones de 44 px
  con `aria-pressed`, alcanzables con teclado, en la misma fila que el campo (en 360 px pasan a la línea de abajo).
  Mientras el campo esté vacío el precio dice «Todavía no incluye tu ganancia.».
- **Punto decimal en pesos: se muestra lo que se entendió, sin cambiar ninguna regla de lectura.** Bajo el campo
  de costo y el de precio de material, una línea pequeña («= $ 125», `aria-live="polite"` y enlazada con
  `aria-describedby`) aparece 700 ms después de la última tecla y solo cuando el valor es legible y lo tecleado
  tenía un punto o una coma que no coincide con lo que quedó («12.5» → «= $ 125», «40,000» → «= $ 40.000»). Con
  «13», «12.500», «1000» o «$ 40.000» no sale nada, y mientras se escribe «12.500» tecla a tecla no parpadea. Si
  el valor es ilegible («12,5») habla el mensaje de error, no el eco. `leerPesos`, `leerCantidad` y
  `leerPorcentaje` no cambiaron: el eco solo refleja su resultado (`ecoDePesos` en `lectura-numeros.ts`).

Siguen en la opción actual (el usuario las dejó así):

4. «Tu ganancia» vive dentro de «Ajustar mi precio» (lo primero del panel), no en la cabecera.
5. Solo «Tus materiales» va plegado (se abre solo si hay un precio malo).
6. Aviso «n de 50» desde 40 filas; con 50 el botón se deshabilita con motivo; con más de 50 no se calcula hasta
   quitar las que sobran. El tope es el de Python.
8. Una lista de gastos sin filas completas no aparece en el resumen ni en las fichas (antes «$ 0»).
9. Deshacer al quitar un gasto: 10 s y solo si la fila tenía datos.
10. Objetivos de 44 px en todos los anchos, escritorio incluido.

## Estado por hallazgo

| # | Hallazgo | Estado | Evidencia |
|---|---|---|---|
| R1 | Resultado anterior sin marca tras error/campo ilegible | **Arreglado** | Navegador: tras escribir un campo ilegible o forzar un 500, precio, fichas, resumen y subtotales atenuados + «Este precio es el anterior y no se actualizó: revisa lo que está en rojo» / con «Reintentar» para fallos; el lector oye «(precio anterior, no actualizado)». Prueba: `vigencia.ts`, render de cabecera y resumen |
| R2 | Sección ausente aparece en `$ 0` | **Arreglado** (diagnóstico confirmado: no hay línea que ponga a cero) | Navegador: lista con una fila nueva que no entró en el cálculo muestra «Total: —»; fichas y resumen ya no listan listas sin filas. Prueba `totalDeLista` |
| R3 | `aria-invalid` por fila, no por celda | **Arreglado** | DOM: solo la celda mala lleva `aria-invalid="true"`. Prueba de render y de `leerBorrador` |
| R4 | Sin mensajes de error por campo | **Arreglado, con un diagnóstico distinto** (ver nota; el «12.5» con punto se aclara con el eco «= $ 125») | Cada celda mala lleva `aria-errormessage` + `aria-describedby` a un mensaje que dice qué escribir (decimales, miles, tope de ganancia, máximos) |
| R5 | El panel se abre solo al recargar | **Arreglado** | Navegador: antes `aperturaTrasRecargar: true`; ahora `false`. Un borrador vacío ya no se guarda |
| R6 | Fila 51 en adelante ignorada en silencio | **Arreglado** | Antes: 52 visibles, 50 enviadas, botón activo. Ahora: contador «n de 50 gastos», botón deshabilitado con motivo, y con >50 no se calcula y se dice cuántas quitar |
| R7 | Vaciar el precio no lo vaciaba | **Arreglado** (decisión 1) | Antes: campo en blanco, «precio tuyo», se enviaba el de catálogo. Ahora: «falta el precio», nada se envía, ↺ vuelve al catálogo y la fila dice «precio de catálogo» |
| R8 | Móvil: nombre del producto a 4 px | **Arreglado** | A 360 px el nombre mide 0 px antes (medido) y 234 px ahora; fila en dos renglones |
| R9 | Sin materiales: el bloque desaparecía | **Arreglado** | Antes `bloque: 0`; ahora una tarjeta explica por qué y qué hacer |
| R10 | Aviso «línea no incluida» en un desplegable cerrado | **Arreglado** | Antes `avisoVisibleConDesplegableCerrado: false`; ahora `true`, en la cabecera |
| R11 | Etiquetas solo como placeholder | **Arreglado** | Etiqueta flotante siempre visible; además los materiales se distinguen por tamaño |
| R12 | Objetivos de 28/34 px | **Arreglado** | Medido: campos 44 px, papelera 44×44, «Agregar» 44, botón principal 44 |
| R13 | Orden de tabulación ≠ orden visual | **Arreglado** | «Tu ganancia» es lo primero del panel en el DOM y en pantalla; a 360 y a 1280 px el foco solo avanza hacia abajo |

**Nota R4 (el documento original no coincidía con lo que se reproduce al teclear).** La tabla original decía que
«40,000» da error y «12,5» da error. Tecleando en la aplicación real: «40,000» se formateaba a «40.000» (válido) y
**«12,5» se convertía en silencio en «125»**, diez veces más de lo escrito. Eso era peor que un error. Ahora la
coma decimal se deja a la vista y el campo explica: «El peso no lleva decimales: escribe 13, no 12,5. El punto
separa los miles (12.500).» «40,000» sigue formateándose a «40.000». «12.500» (valor) y «1.25» (cantidad) siguen
valiendo lo mismo; «1500» de ganancia sigue dando error y ahora dice «No puede pasar de 1.000 %». Las reglas de
lectura (`leerPesos`, `leerCantidad`, `leerPorcentaje`) **no cambiaron**.

## Auditoría de usabilidad

| # | Qué había | Por qué estorba | Qué se cambió |
|---|---|---|---|
| U1 | «utilidad», «costos», «mano de obra», «indirectos», «margen real», «línea», «bolsa», «cotización profesional» (en un error) | Vocabulario de contabilidad y de desarrollo; dos palabras para lo mismo | Una palabra por concepto (decisión 2). Prueba: el formulario abierto y cerrado no contiene la jerga retirada |
| U2 | Orden: cabecera, tres listas vacías, materiales, y al final la utilidad | La decisión más común (la ganancia) quedaba al fondo | Precio grande con su estado → qué incluye en una frase (IVA, gastos, ganancia) → fichas → «Ajustar mi precio»: ganancia, gastos, materiales plegados, resumen |
| U3 | El campo de utilidad medía 619 px a 800 px | Un porcentaje no necesita una pista de carreras | 112 px |
| U4 | Con un error largo la cabecera a 800 px apretaba la descripción a una palabra por línea | Texto ilegible justo cuando algo falla | La leyenda del estado vive bajo el precio y puede ocupar su ancho |
| U5 | Coma decimal tragada (12,5 → 125) | Dinero equivocado sin aviso | Ver nota R4 |
| U6 | Cuatro campos de material con el mismo nombre accesible | No se sabe cuál es cuál con lector de pantalla | «… de 5 pulgadas», «… de 9 pulgadas» |
| U7 | Un precio malo dentro del desplegable cerrado | El error no se ve | El desplegable se abre solo con un precio malo o a medias |
| U8 | Quitar una fila con datos era irreversible | Un toque de más pierde lo escrito | «Quitaste «Montaje». Deshacer» durante 10 s |
| U9 | Al agregar un gasto el foco se quedaba en el botón | Hay que buscar la fila nueva | El foco va a la descripción nueva |
| U10 | Ninguna frase decía si el precio ya incluye la ganancia o el IVA, ni si se guarda | Dudas típicas | «Incluye tu ganancia: el 23,08 % del precio es tuyo.» / «Todavía no incluye tu ganancia.» / «Materiales (con IVA) + tus gastos + tu ganancia.» / «Tus cambios se guardan solos mientras esta pestaña siga abierta.» |
| U11 | La ficha «Tus costos» sumaba tres totales de Python en TypeScript | Un total calculado fuera de Python (contra `AGENTS.md`) | Cada lista tiene su ficha con el total de Python; nada se suma en TS |
| U12 | El estado se anunciaba dos veces con `aria-live` (cabecera y resumen) | Ruido para lector de pantalla | Solo la cabecera es `aria-live` |
| U13 | El botón de agregar era un enlace de 16 px de alto | Difícil de tocar | Botón de 44 px con el nombre de la lista («Agregar a Transporte y equipos») |
| U14 | «Quitar fila de mano de obra» | Dice «fila», no qué se quita | «Quitar Montaje» |

Fichas de ganancia y eco de pesos (decisiones 3 y 7 del 2026-10-02): verificados en Chrome a 360 y 800 px, claro y oscuro (84 comprobaciones, sin fallos).

Teclado numérico: valor y precio usan `inputMode="numeric"`; cantidad y ganancia, `decimal` (como antes).
Estados con una frase y una acción: calculando («Calculando…»), error de servicio («Reintentar»), error de red
(mensaje propio, se conserva), campo malo («revisa lo que está en rojo» + mensaje bajo el campo), vacío («—»),
sin materiales (explicación y qué hacer), 50 filas (contador y motivo).

### Capturas descritas (no se versionan imágenes)

Hechas con Playwright sobre la aplicación real (:3010 + Python local), inyectando un plan en `sessionStorage`.
Antes: 360 px claro y 800 px oscuro. Después: 360 y 800 px, claro y oscuro. Por hallazgo: R1 (campo ilegible y 500),
R2, R3/R4, R5, R6, R7, R8/R11/R12/R13, R9, R10, y flujos U (camino feliz, tope de 50, escritorio 1280).
Lo visible: precio y fichas atenuados con la leyenda en ámbar o rojo; celdas con borde rojo solo en la mala y su
mensaje debajo; etiquetas flotantes dentro de campos de 44 px; materiales en dos renglones.

## Lo que sigue funcionando (verificado, no se tocó)

`debounce` de 400 ms con cancelación; «Calculando…»; mensajes distintos para 500 y para red; volver al precio de
catálogo; foco visible; contraste (etiqueta 16–18:1, ayuda y leyenda ≥ 5,8:1, aviso 5,5:1 claro / 11:1 oscuro,
error 5,9:1 claro / 8,6:1 oscuro); sin errores de consola; sin scroll horizontal a 360 px;
`plan:test-cotizacion-profesional` verde.

## Cómo está organizado

Lógica pura con pruebas (`scripts/test/test-cotizacion-profesional-formulario.ts`): `vigencia.ts` (qué es vigente y
la leyenda), `lectura-numeros.ts` (lectura de pesos/cantidad/ganancia y sus mensajes), `limites-filas.ts` (tope),
`deshacer-fila.ts`, y `borrador-profesional.ts` (lectura del borrador, estado del precio de un material, avisos).
Los componentes (`CotizacionProfesional`, `EncabezadoPrecio`, `CampoGanancia`, `SeccionGastos`, `PreciosMateriales`,
`ResumenPrecio`, `Campo`) solo pintan y coordinan.

## Pendiente / límites

- No hay un servidor que devuelva secciones ausentes: Python siempre responde las tres listas; el «—» cubre las
  listas que no entraron en el cálculo. Si algún día se omiten, no hace falta tocar el contrato.
- Capturas «antes» solo a 360 px claro y 800 px oscuro (el código anterior ya no corre).
- No se probó con un lector de pantalla real, ni con una mano en un teléfono real: se verificó el DOM (atributos
  ARIA, tamaños, orden de foco) y el comportamiento con teclado en Chrome.
- El contraste del texto atenuado (resultado no vigente) no se exige: es información secundaria, y el aviso que lo
  explica va a contraste pleno.
