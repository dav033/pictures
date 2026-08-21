# Rollback plan

## Estado actual

No hay proveedor, job ni modelo LoRA activo. Rollback local: conservar cambios previos del demo
y no ejecutar acciones externas.

## Durante desarrollo

1. Detener job de entrenamiento si excede timeout o presupuesto.
2. Mantener dataset raw intacto y separar descartes en quarantine.
3. Marcar candidato inválido; no reemplazar `models/approved`.
4. Restaurar la última configuración aprobada por versión, nunca por secreto.

## Inferencia

1. Desactivar `image_generation` o el flag del proveedor.
2. Cambiar `IMAGE_LORA_ID` al alias aprobado anterior.
3. Detener nuevos jobs y dejar jobs existentes en estado controlado.
4. Verificar health, coste y logs redactados.

Objetivo: ≤ 5 minutos en staging/prod después de aprobación. No se prueba en producción sin
CP-14.
