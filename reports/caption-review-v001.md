# Caption review — dataset-decoration-v001

Estado: `draft_visual_review`.
Fecha: 2026-08-13.

Se revisaron las 15 imágenes activas en una hoja de contacto. Captions están en inglés, usan el
trigger único `eventdecor_style_v1` y describen solo elementos visibles: sujeto, colores,
composición, iluminación, fondo, estilo y cámara. No se inventaron nombres de productos del
catálogo.

## Partición

- `train`: 9 imágenes.
- `validation`: 2 imágenes.
- `test`: 4 imágenes.
- La familia `mini_mundo_family` queda completa en `test` para evitar fuga entre escenas parecidas.

## Revisión pendiente

Antes de entrenar, una persona debe revisar una muestra de captions contra las imágenes y corregir
colores, textos visibles o elementos que no correspondan. No se inicia entrenamiento hasta cerrar
esta revisión.
