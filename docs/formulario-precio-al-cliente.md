# El formulario «Precio al cliente»: qué está roto

Fecha: 2026-10-02 · Estado: **auditado y reproducido, sin arreglar**

El formulario que el sistema genera desde la propuesta es el de **«Precio al cliente»**
(`src/components/cotizacion/CotizacionProfesional.tsx`, montado en `src/app/page.tsx` dentro de la tarjeta de
la propuesta, con `src/lib/cotizacion/borrador-profesional.ts` y `/api/cotizacion-profesional` → Python).

Los trece hallazgos de abajo están **reproducidos ejecutando** la aplicación real —inyectando un plan en
`sessionStorage` y conduciéndola con un navegador—, no leyendo el código. Ninguno está arreglado todavía.

## Lo que miente con el dinero

**R1 + R2 — son la misma línea, no dos problemas.** Cuando un campo es ilegible o el servidor falla, la
pantalla sigue enseñando el resultado anterior (`calculo.previo`) **sin marca de ninguna clase**: el precio
grande, los chips y el resumen se presentan como vigentes. Y una sección aparece en `$ 0` no porque algo la
ponga a cero, sino porque **no existía en aquella respuesta**: es un cero que no es un cero.

> El diagnóstico inicial decía «un error pone a cero todas las secciones». No hay código que ponga nada a
> cero. Quien lo arregle buscaría una línea que no existe. Lo que hay que hacer es marcar el resultado
> anterior entero como no vigente, y que una sección ausente muestre «—» y no `$ 0`.

**R7 — vaciar el precio de un material no lo vacía.** El campo queda en blanco, el envío omite el precio y se
cobra el de catálogo, mientras la fila sigue diciendo «precio tuyo» y el botón de volver al catálogo sigue
ahí. El lector del borrador trata `""` como «no editado» y el componente cree que sí lo está.

**R6 — de la fila 51 en adelante se ignora en silencio.** 52 filas en pantalla, 50 enviadas, total calculado
con 50, cero avisos y el botón de agregar sigue habilitado.

## Lo que impide corregir un error

**R3 — se marcan en rojo campos correctos.** `aria-invalid` es una bandera **de fila**, no de celda: una fila
con el costo mal escrito marca también la cantidad, que está bien. La descripción sí lo hace bien.

**R4 — ningún mensaje dice qué pasa.** Los ocho campos tienen `aria-errormessage: null`; con lector de
pantalla se oye «no válido» y nada más. Casos reales en los que alguien razonable se atasca sin pista:

| Lo que escribe | Qué pasa | Por qué |
|---|---|---|
| Costo `40,000` | Error | La coma de millar no se limpia |
| Costo `12,5` | Error | El peso colombiano no lleva decimales (deliberado, nunca dicho) |
| Costo `12.500` | 12 500 ✓ | El punto es separador de **miles**… |
| Cantidad `1.25` | 1,25 ✓ | …pero en la celda de al lado es **decimal** |
| Utilidad `1500` | Error | El tope es 1000, nunca dicho |

## Lo que estorba

- **R5** — el panel se abre solo al recargar: se guarda un borrador vacío al montar, y en la carga siguiente
  ese objeto cuenta como «había algo».
- **R9** — sin materiales cotizables el bloque entero desaparece, sin decir si no existe, está roto o no aplica.
- **R10** — el aviso de «esta línea no se incluye» vive dentro de un desplegable cerrado: el precio sale con 3
  de 4 líneas y nadie lo nota.
- **R8** — en móvil el nombre del producto queda en **4 px** de ancho útil: se editan precios a ciegas.
- **R11** — las columnas pierden su etiqueta al rellenarse, porque son `placeholder` y no encabezados.
- **R12** — la papelera mide 28 × 28 px y los campos 34 px de alto, por debajo de los 44 recomendados.
- **R13** — el orden de tabulación no sigue al visual: «Tu utilidad» está al final del DOM y arriba a la derecha.

## Lo que funciona, para no romperlo al arreglar lo de arriba

El cálculo contra Python es correcto; hay `debounce` de 400 ms con cancelación; el estado «Calculando…» se ve;
los errores de 500 y de red tienen mensajes distintos; el botón de volver al precio de catálogo funciona; el
foco es visible y el contraste cumple AA; no hay errores de consola; y `plan:test-cotizacion-profesional`
pasa.

## Al arreglarlo

El orden por daño es: R1+R2 → R7 → R6 → el resto. Y una regla que no se negocia: **ningún total se recalcula
en TypeScript**. Python es el dueño de las reglas comerciales (`AGENTS.md`); aquí se decide qué se muestra y
cómo, nunca cuánto vale. `MAX_LINEAS_SECCION`, `MAX_COP`, `MAX_CANTIDAD` y `MAX_UTILIDAD_PORCENTAJE` son
espejo del modelo de Python: se explican al usuario, no se cambian.
