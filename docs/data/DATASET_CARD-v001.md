# Dataset card — dataset-decoration-v001

Estado: `in_progress`.

Fuente declarada: catálogo público de Sempertex. El usuario confirmó aprobación explícita para
entrenamiento LoRA. La confirmación debe conservarse también en el registro interno de aprobación
de Sempertex antes de enviar datos a un proveedor externo.

Ingesta 2026-08-13: 25 imágenes originales recibidas. 15 copias sanitizadas en PNG quedan activas
en `data/sanitized/sempertex-v01`; 10 imágenes menores a 1024 px fueron retiradas del dataset
activo y movidas a `data/quarantine/sempertex-v01-low-resolution/`. No hubo archivos corruptos ni
duplicados.

`data/raw/` también contiene un snapshot JSON de catálogo que no forma parte del dataset LoRA.

## Requisitos de ingreso

- Fuente autorizada y licencia por imagen.
- Sin GPS/EXIF innecesario, PII, documentos, conversaciones ni datos de clientes.
- PNG/JPEG/WebP válido, resolución mínima 1024 px en el lado menor.
- Nombre normalizado, hash SHA-256 y manifiesto JSONL.
- Caption con trigger `eventdecor_style_v1` y descripción verificable.
- Duplicados controlados; escenas casi idénticas no se separan entre train/validation/test.

Las imágenes de baja resolución no se agrandan automáticamente; requieren decisión humana o
reemplazo por fuente de mayor resolución.

## Splits

Asignación actual: `train` 9, `validation` 2, `test` 4. La familia `mini_mundo` completa quedó
en `test`, evitando fuga entre escenas parecidas. Captions y splits están en
`data/captions/dataset-v001.jsonl`; falta revisión humana de una muestra de captions.

## Evidencia

El validador local genera manifiestos y nunca sube, borra ni mueve imágenes automáticamente.
Los descartes quedan en estado `quarantine` para revisión.
