# Protocolo de chequeo visual de proporción — v001

**Pre-registrado el 2026-08-26, ANTES de mirar ninguna foto de la muestra.**

Este documento existe porque el consejo de 5 IAs y la investigación de literatura
(`council-tamanos-proporcion-lora-v001.md`, `literatura-tamanos-proporcion-lora-v001.md`)
coincidieron en lo mismo: la auditoría de texto que dio 0/401 tamaños inventados es cierta
*por construcción* y **no prueba que la comparación de tamaño sea visualmente correcta**. La
única forma de saberlo es mirar fotos contra su descripción.

El umbral se fija acá, por escrito, antes de ver resultados, para que la decisión de gastar
el presupuesto de entrenamiento no se acomode a lo que salga.

---

## 1. Población

Captions con `proporcion_relativa_presente = true` **y** `aptoParaEntrenamiento = true` en su
feedback. La segunda condición importa: un error en una foto que no se va a entrenar no
contamina nada.

**Exclusiones** (7 órdenes ya tocadas o ya usadas como ejemplo, para no re-muestrear terreno
conocido ni sesgar la tasa con casos que ya corregí):

- `13223`, `13599` — corregidas en la sesión 3; estaban dentro de la muestra informal de 8.
- `950000024`, `950000021`, `7953`, `950000192`, `950000116` — los 5 captions que se le
  pasaron como ejemplo al consejo.

> **Limitación conocida**: la sesión anterior revisó 8 fotos pero solo dejó registro de 2 por
> número. Las otras 6 no se pueden excluir con certeza. Si alguna cae en esta muestra, la tasa
> queda levemente sesgada hacia lo ya visto. Se asume el riesgo y se deja anotado.

## 2. Muestreo

`n = 30`, aleatorio simple sin reemplazo, con **semilla fija** (`PRNG mulberry32, seed 20260826`)
para que la muestra sea reproducible y no se pueda re-tirar hasta que dé bonito. La lista sale
de `scripts/muestrear-chequeo-proporcion.ts` y se congela en un JSON antes de mirar.

## 3. Qué se compara

Para cada orden: la foto real contra su `proporcion_relativa_descripcion`, con el
`desglose.json` a la vista como ground truth de qué tamaños se compraron de verdad.

## 4. Rúbrica (definida antes de mirar)

Cada foto recibe exactamente una etiqueta:

- **CORRECTO** — toda afirmación de tamaño de la descripción es consistente con la foto.
- **IMPRECISO** — ninguna afirmación queda contradicha, pero la descripción es vaga donde había
  una comparación específica disponible (dice "large/small" teniendo R-18 y R-5 confirmados),
  o menciona algo que no se distingue bien en la foto sin llegar a contradecirla.
- **INCORRECTO** — al menos una afirmación de tamaño está **contradicha** por la foto.

Sub-tipos de INCORRECTO, para tabular (derivados de los 2 errores ya encontrados):

| código | descripción |
|---|---|
| `direccion-invertida` | dice que X es más grande que Y cuando es al revés (caso #13599) |
| `gradiente-inventado` | afirma una progresión ordenada que la foto no muestra (caso #13223) |
| `perspectiva` | lee como diferencia de tamaño lo que es diferencia de distancia a cámara |
| `mezcla-inexistente` | describe varios tamaños donde el pedido y la foto tienen uno solo |
| `atribucion` | asigna un tamaño al elemento equivocado |

**Métrica primaria**: cantidad de INCORRECTO sobre 30. IMPRECISO **no** cuenta como error
(es ruido benigno: no le enseña nada falso al modelo, solo no le enseña nada).

## 5. Umbrales de decisión (pre-registrados)

| incorrectos / 30 | banda | decisión |
|---|---|---|
| 0–3 (≤10%) | 🟢 VERDE | La prosa de proporción es lo bastante confiable. Seguir al entrenamiento incluyendo el campo, sin más revisión. |
| 4–7 (13–23%) | 🟡 AMARILLO | No incluir `proporcion_relativa_descripcion` en el texto de entrenamiento, **o** revisar las 297 a mano antes de incluirlo. El `caption` base no se toca. |
| ≥8 (≥27%) | 🔴 ROJO | No usar la prosa de proporción. Re-captionar ese campo con un pase dedicado y evaluar el plan B (condicionamiento espacial / ControlNet, arxiv 2510.21763) antes de comprometer presupuesto. |

**Razonamiento del corte**: la literatura ya documenta que los modelos de difusión son débiles
en tamaño/posición relativa *incluso con datos limpios*. Con una señal que ya es difícil de
aprender, una descripción contradictoria no es ruido neutro — enseña activamente lo contrario.
Por eso el corte es más exigente que el que se toleraría en un atributo fácil (color, conteo).

**Honestidad estadística**: con n=30, observar 3 errores da un IC 95% de aproximadamente
[2%, 27%] — o sea que esta muestra **no distingue con nitidez un 10% real de un 25% real**.
Las bandas son gruesas a propósito. VERDE significa "no hay evidencia de un problema grande",
no "está probado que es ≤10%". Si el resultado cae justo en el borde (3 o 4), la respuesta
correcta es ampliar la muestra, no elegir la banda que convenga.

## 6. Reglas de conducta durante el chequeo

1. Se escribe el veredicto de cada foto **antes** de pasar a la siguiente.
2. No se revisan veredictos anteriores después de ver el agregado.
3. No se amplía ni se recorta la muestra a mitad de camino.
4. Los errores encontrados se corrigen **después** de cerrar el conteo, no durante.

**Limitación de método**: el revisor (Claude) es el mismo tipo de sistema que generó los
captions, y no está ciego a la descripción mientras mira la foto. Esto puede sesgar hacia
CORRECTO (sesgo de confirmación). Un chequeo humano sobre esta misma muestra congelada sería
la validación fuerte; esta corrida es el filtro barato previo.

## 7. Resultados

Se completan en `resultados-chequeo-visual-proporcion-v001.md` una vez cerrado el conteo.
