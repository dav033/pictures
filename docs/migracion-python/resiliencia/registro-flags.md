# Registro de flags operativos

Última actualización: 2026-09-10.

Este documento registra únicamente controles que existen en el código vigente.
Los flags de proveedor, secretos y selección de backend no se mezclan con las
capacidades de IA.

## Capacidades de IA

La fuente única es `src/lib/ia/feature-flags.ts`.

| Flag | Default si falta | Efecto de `false` |
|---|---:|---|
| `RAG_ENABLED` | `true` | El chat falla cerrado con `RAG_UNAVAILABLE`; no usa catálogo alternativo. |
| `RAG_FRANJAS_ENABLED` | `true` | Desactiva la resolución automática de franjas de presupuesto. |
| `RAG_USE_VECTOR` | `true` | Desactiva la rama vectorial. |
| `RAG_USE_FULLTEXT` | `true` | Desactiva la rama full-text. |
| `RAG_USE_TRIGRAM` | `true` | Desactiva la rama trigram. |
| `RAG_RERANK_ENABLED` | `false` | Mantiene desactivado el reranking Python. |
| `RAG_PYTHON_QUERY_EMBEDDINGS_ENABLED` | `false` | Mantiene embeddings de consulta fuera de Python. |
| `PLAN_DECORACION_ENABLED` | `true` | Desactiva el registro de herramientas de plan. |
| `IMAGE_QA_ENABLED` | `false` | No se solicita QA visual salvo que el request lo pida explícitamente. |
| `PLAN_COST_OPTIMIZER_V2` | `true` | Detiene la optimización de costos del plan. |
| `PLAN_BUDGET_GATE_V2` | `true` | Desactiva únicamente el gate experimental asociado; no elimina validaciones server-side. |
| `SCENE_PLAN_V2_SHADOW` | `false` | No ejecuta la evaluación de escena en sombra. |
| `IMAGE_DEBUG` | `false` fuera de desarrollo | Desactiva metadatos y trazas de depuración de imagen. |

Los flags RAG usan `false` literal como apagado. Los flags booleanos de
`featureEnabled()` aceptan `1`, `true` u `on`, sin distinguir mayúsculas.

## QA visual

`IMAGE_QA_ENABLED=false` es el default operativo. `/api/generate` acepta
`imageQaRequested: true` como solicitud explícita del flujo y registra esa
decisión en el snapshot. Un plan aprobado que requiera QA no puede avanzar sin
una observación válida; un resultado `unknown` no se convierte en aprobación.

La implementación está en `src/lib/ia/image-qa.ts` y el gate en
`src/app/api/generate/route.ts`. No existen aliases de configuración para QA.

## Selector Next/Python

`PYTHON_BACKEND_ENABLED` y `PYTHON_BACKEND_KILL_SWITCH` pertenecen únicamente a
`seleccionarBackendMigracion` en
`src/lib/ia/contracts/operational-v1.ts`. El kill switch tiene precedencia
absoluta sobre `enabled` y no debe normalizarse junto con los flags de IA.

## Rollback

1. Registrar el snapshot de flags y el `request_id` del incidente.
2. Apagar la capacidad afectada con su flag explícito, sin cambiar catálogo ni
   borrar auditoría.
3. Verificar `/api/chat`, `/api/generate` o el flujo afectado con pruebas sin
   proveedor pagado.
4. Reactivar solo después de confirmar la causa y conservar la telemetría.

No se documentan aquí flags eliminados, rutas debug borradas ni aliases de
versiones anteriores.
