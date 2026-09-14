# 0009. Eje del semiarco y evidencia del conteo de globos

Estado: aceptada (2026-09-14). Eje implementado en Next y Python; λ y bandas sin cambios.

## Problema

1. El eje de un semiarco se calculaba como `largo || ancho` (`calcularEje` en `src/lib/medidas/geometria.ts`, `_eje` en `services/ai-api/app/plan.py`) e ignoraba `alto`. Un semiarco de 1,2 m × 2,2 m tenía 1,2 m de eje y 23 globos, menos que una columna de 1,8 m (35 globos). En el caso de la foto de referencia (semiarco alto a la derecha y columna baja a la izquierda) el plan quedaba invertido.
2. Los totales parecían bajos frente a lo que se ve en la referencia y en la imagen generada. λ por densidad (2,8 / 3,6 / 4,5) y `ANCHO_BANDA_POR_MEZCLA` están marcados como sin calibrar.

## Decisión

- El eje del semiarco es un cuarto del perímetro de la elipse de Ramanujan con a = ancho (alcance horizontal de la curva) y b = alto. Con ancho y alto, `largo_m` no cambia el eje: el chat lo manda como profundidad (en la prueba del 2026-09-14, un `largo_m` de 0,5 m dejó el semiarco en 9 globos). Solo sin ancho ni alto se usa el largo; si falta uno de los dos, la medida disponible. Es la misma aproximación que ya usaba el arco (media elipse con a = ancho/2).
- Medidas por defecto del semiarco: 1,2 × 2,2 m en interior y 1,5 × 2,4 m en exterior, antes 2,4 × 2,2 y 3 × 2,4. Con el eje nuevo dan 2,73 m y 3,10 m, casi los 2,4 m y 3 m de eje de los defaults anteriores, así que un semiarco sin medidas conserva su escala de globos. La proporción alcance/alto ≈ 0,5 es la que se ve en la referencia del caso (`images (13).jpg`: ~210 px de alcance por ~420 px de alto).
- λ y los anchos de banda no cambian. La evidencia de abajo apunta a que el modelo se queda corto, pero no alcanza para fijar un factor nuevo.
- Vector dorado nuevo `contracts/domain/v1/golden/plan-resolution/12-semiarco-alto.json`: semiarco 1,2 × 2,2 = 58 globos frente a columna de 1,8 m = 39 (mezcla clásica), variante asimétrica = 41 y con `largo_m` de 0,5 m (profundidad) = 58, igual que sin él. Paridad TS↔Python 12/12.

## Evidencia de conteo (2026-09-14, solo lectura)

Fuente: `C:\Users\davidt\Downloads\ordenes-decoracion`, 385 carpetas. Se excluyen 185 de blog o catálogo sin compra real; quedan 200 órdenes reales, 96 con foto y caption. Se cuentan globos de látex redondos comprados (paquetes × unidades) en órdenes con una sola estructura principal clara. Script reproducible: `analisis_globos.py`, en el scratchpad de la sesión; no está versionado.

| Tipo | n | Mediana comprada | p25–p75 | Mezcla R5/R9/R12/R18/R24 |
| --- | --- | --- | --- | --- |
| Arco | 16 | 174 | 122–265 | 21 / 26 / 44 / 9 / 0 % |
| Guirnalda | 21 | 191 | 68–350 | 31 / 27 / 41 / 1 / 0 % |
| Columna | 5 | 60 | 57–64 | 24 / 16 / 40 / 13 / 7 % |
| Semiarco | 1 | 180 | — | 47 / 47 / 7 / 0 / 0 % |
| Modelo `organica_fina` | | | | 21 / 18 / 54 / 5 / 2 % |

Conteo en fotos (visibles, con 20–40 % oculto por profundidad):

| Orden | Estructura | Medidas estimadas | Instalados estimados | Comprados | Modelo |
| --- | --- | --- | --- | --- | --- |
| 13223 | Arco orgánico | ~2,7 × 2,5 m | ~210–230 | 278 | ~120 |
| 9476 | Columna con remate | ~2,1 m | ~55–60 | 64 | ~41 |
| 12752 | Guirnalda de pared | ~3 m | ~70–75 | 118 | — |

Lectura:

- El modelo acierta el orden de magnitud y se queda corto entre 1,2× y 1,8× en arcos y columnas. Las órdenes reales llevan más R-9 y R-18 y menos R-12 que `organica_fina`.
- Sesgos: lo comprado incluye merma y sobrante de paquete cerrado; algunas órdenes usan globos de otra fuente; los captions a veces se equivocan de tipo; las medidas salen de la escala en la foto (±15–20 %); columna n=5 y semiarco n=1.

## Alternativas

- Subir λ un 40 % ya: se descarta. Con n tan pequeño y sin medidas reales, el factor sería inventado; además cambia todas las cotizaciones y los vectores dorados.
- Usar `alto` como eje del semiarco: se descarta porque ignora el alcance horizontal y cuenta igual un semiarco muy abierto que una columna.

## Consecuencias

- Los semiarcos con medidas explícitas altas llevan más globos y cuestan más que antes. Los semiarcos sin medidas quedan casi igual (+14 % en interior y +3 % en exterior).
- λ y banda siguen como supuestos visibles en `supuestos` y en el aviso de la tarjeta.
- Siguiente paso de calibración: registrar ancho, alto y globos instalados en 10–20 montajes reales por tipo, o pedir ese dato en el feedback de órdenes, y recalibrar λ por mezcla con un vector dorado por tipo.

## Reversión

Devolver `semiarco` a `largo || ancho` en `geometria.ts` y `plan.py`, restaurar los defaults anteriores en `medidas-defecto.ts` y `_DEFAULT_MEASURES`, retirar el vector `12-semiarco-alto.json` y regenerar `expected`/`expected_python`. No hay migración de datos: los planes aprobados guardan su `plan_hash`, y un plan viejo re-resuelto con otra geometría deja de coincidir con su token, igual que ante cualquier cambio del resolver.
