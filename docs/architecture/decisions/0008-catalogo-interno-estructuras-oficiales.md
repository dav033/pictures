# 0008. Catálogo interno de estructuras oficiales

Estado: aceptada (2026-09-14). Implementada en Next y Python.

## Problema

El producto necesita soportar oficialmente: arco, semiarco, columna, semiarco asimétrico, arco asimétrico, columna asimétrica, pared de globos densa y no densa, arco no denso, columna no densa, guirnalda, centro de mesa con globos, bouquet y figura con globos. El plan solo tenía tipos primitivos (arco, semiarco, columna, pared…), sin asimetría y sin bouquet ni figura. El plan lo validan y resuelven Next y el servicio Python. Al cliente se le mostraban enums crudos ("semiarco · lateral_izquierdo").

## Decisión

- `src/lib/plan/estructuras-oficiales.ts` es el único dueño del catálogo: 16 estructuras (las 14 pedidas más aro circular y techo de globos). Cada una fija sus tipos admitidos, densidades admitidas, ubicación implícita, forma, nombre y descripción para el cliente y sustantivo para el prompt.
- Contrato `plan-decoracion.v1` (1.0 y 1.1): campo opcional y aditivo `estructura_oficial` por estructura. `tipo` sigue siendo la primitiva que mide la geometría y resuelve precios en ambos backends, por eso la variante no cambia la cotización.
- Coherencia (tipo, densidad, ubicación): Next la valida con `incoherenciasEstructuraOficial` en el `superRefine` del schema. El export de contratos inyecta la misma tabla como reglas `allOf`/`if`/`then` en el JSON Schema, y el servicio Python la aplica a través de `generated_models.py`. No hay una segunda tabla escrita a mano en Python.
- `estructura_oficial` entra al `plan_hash` en ambos backends; el vector dorado `10-estructura-oficial` fija la paridad.
- El chat recibe la guía de estructuras oficiales y la herramienta `confirmar_plan_decoracion` expone el campo. El análisis de referencias detecta contorno, densidad, bouquet y aro, y el chat recibe la estructura oficial detectada.
- El compilador LoRA lee el campo (con fallback por nombre para planes anteriores), usa el sustantivo oficial y nunca empareja variantes distintas.
- La tarjeta del plan muestra, solo informativo, silueta, nombre oficial y ubicación en palabras del cliente.

## Consecuencias

- Cálculo de globos por variante (tabla `geometria` del catálogo, exportada como `x-geometria-estructuras-oficiales` en `plan-decoracion.v1` y leída por `geometria.ts` y `plan.py`; vector dorado `11-geometria-estructuras-oficiales`):
  - Aro circular: el eje es la circunferencia inscrita en ancho × alto (π × el menor de los dos).
  - Arco y semiarco asimétricos: la banda se afina linealmente hasta el 40 % en un extremo, así que el volumen es ×0,7. Es un supuesto de diseño sin calibrar, como λ, y se muestra en `supuestos`.
  - No denso y pared densa: ya los cubre la densidad obligatoria (λ de `sencilla`, `media` o `lujosa`).
  - Columna asimétrica: contorno irregular con el mismo volumen.
  - Bouquet y figura (Plan 1.0): `unidades_declaradas`; en Plan 1.1 la figura también admite `escultura`.
- Orden de despliegue: el servicio Python con los modelos regenerados debe estar antes que el Next que envía `estructura_oficial`; un Python anterior rechaza el campo (`additionalProperties: false`).

## Reversión

El campo es opcional: dejar de enviarlo (quitarlo de la herramienta y de la guía del chat) devuelve el comportamiento anterior sin migración. Revertir el campo del schema exige regenerar los contratos y `generated_models.py` y retirar el vector `10-estructura-oficial`.
