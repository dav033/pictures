# ADR-001 — proveedor y modelo base para LoRA

Estado: `dev seleccionado / producción pendiente`  
Fecha: 2026-08-13  
Checkpoint: CP-01 pendiente

## Contexto

El demo actual usa Gemini/OpenAI para chat y generación de referencia. El plan LoRA necesita
un flujo separado para dataset privado, entrenamiento, artefacto versionado e inferencia con
fallback. No hay todavía aprobación de proveedor, cuenta, facturación ni modelo base.

## Opciones

1. `fal.ai` + FLUX LoRA trainer/inference. Menor trabajo inicial y coste de entrenamiento
   publicado, pero faltan verificaciones de datos, retención y modelo base.
2. `Replicate` + trainer compatible. API y webhooks maduros; coste de modelos privados puede
   incluir tiempo inactivo.
3. `Hugging Face Jobs + Inference Endpoints`. Máximo control y endpoints privados; más trabajo
   de operación y coste fijo por GPU activa.

## Decisión provisional

Usar `fal.ai` en entorno dev con `fal-ai/flux-2-trainer-v2` sobre `FLUX.2 [dev]`, máximo 300
pasos y presupuesto de training de USD 2. La tarifa publicada implica USD 1.92 para 300 pasos.
La selección fue autorizada para dev por el usuario; términos, región, retención y producción
siguen pendientes.

La configuración central mantiene producción desactivada. El preflight no sube datos ni lanza job
hasta tener clave dev y verificar crédito suficiente.

## Arquitectura provisional

```text
Frontend -> POST /api/chat
Backend -> LLM + RAG + prompt compiler
Backend -> POST /internal/image-jobs
Image service -> provider LoRA (server-side secret)
Storage privado -> signed URL
Observability -> request_id, job_id, coste, latencia, hashes sin PII
Fallback -> modelo aprobado anterior o generación sin LoRA
```

## Consecuencias

- El frontend no conoce proveedor, LoRA ID ni API key.
- Entrenamiento e inferencia quedan fuera del flujo textual hasta CP-09.
- `reference_only` no puede convertirse en producto cotizable.
- Cada artefacto requiere hash, licencia y rollback.

## Aprobación requerida

Responsable humano debe aprobar: proveedor, modelo base, términos, licencia, región, retención,
presupuesto, permisos y dataset. Sin esa aprobación, no abrir cuentas ni lanzar jobs.
