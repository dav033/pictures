# Modelo de amenazas — generación de imágenes LoRA

Estado: borrador. No sustituye revisión legal o de seguridad.

| Amenaza | Control requerido | Estado |
|---|---|---|
| API key en frontend/logs | Secret manager, variables por entorno, redacción y escaneo CI | pendiente |
| Dataset con PII o derechos ausentes | Raw/quarantine/sanitized, licencia por archivo, revisión humana | validador local listo |
| URL de imagen pública | Bucket privado y signed URL con expiración | pendiente de proveedor/storage |
| Prompt injection | JSON estricto, catálogo server-side, prompt compiler | parcial en app actual |
| Coste descontrolado | idempotencia, límites, presupuesto diario y aprobación de billing | pendiente |
| Modelo/LoRA defectuoso | eval congelada, hash, aprobación y rollback | pendiente |
| Webhook falso | firma, timestamp, replay protection e idempotencia | pendiente |
| Logs sensibles | hashes de prompt/imagen; no base64, PII, tokens ni imágenes | contrato documentado |
| Cambio de licencia | registrar base, LoRA, dataset y fuente; revisión por release | pendiente |

## Separación de entornos

`dev`, `staging` y `prod` usan claves, buckets, límites y prefijos distintos. Producción no se
activa por defecto. CAPTCHA, MFA, pago, bloqueo o incertidumbre legal detienen el flujo.
