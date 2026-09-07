# Etapa 2 — contratos y frontera operativa

Estado: **cerrada**.

## Resultado

- Contratos Zod versionados para chat, SSE, transcript, herramientas, errores,
  catálogo, plan, materiales, cotización, LoRA y Happie.
- Happie valida entrada y salida en sus endpoints; el catálogo remoto se valida
  en runtime antes de entrar al recomendador.
- JSON Schema Draft 7 exportado de forma determinista; `contracts:check`
  detecta drift.
- SSE conserva los campos legacy de la UI, pero exige versión, request ID,
  correlation ID, terminal único y error estable.
- Cancelación llega a `ChatPort`, Gemini, reintentos y handlers de herramienta.
  El stream tiene cancelación, deadline absoluto y límite de payload.
- Frontera operativa versionada: contexto, HMAC interno, scopes, idempotencia,
  selección de backend y kill switch.
- Auth directa en endpoints Happie internos; producción falla cerrado si falta
  `APP_PASSWORD`.

## Decisiones

- Next sigue siendo la fachada y autoridad durante esta etapa.
- `PYTHON_BACKEND_ENABLED` habilita Python; `PYTHON_BACKEND_KILL_SWITCH` gana
  siempre y devuelve la selección a Next. El valor por defecto es Next.
- La política de idempotencia ya está definida y probada (`new`, `replay`,
  `conflict`), pero el store durable y la replay cache quedan para Etapa 3,
  antes de ejecutar efectos duplicables en Python.
- La firma interna usa HMAC-SHA256 sobre timestamp, nonce, método, ruta,
  hash del body y scopes. El receptor debe persistir/consumir el nonce.
- Plan 1.1, SceneSpec V2 y catálogo V3 permanecen `deferred`: no se cambia
  autoridad ni se inventa compatibilidad hasta tener consumidores y fixtures.
- No se enruta tráfico a Python ni se crea FastAPI en esta etapa.

## Criterio de salida

`contracts:test`, `contracts:test:domain`, `contracts:test:operational`,
`contracts:test:cancel`, `contracts:check`, build de workspaces, TypeScript, build Next y lint deben
ejecutarse antes de abrir Etapa 3. Warnings heredados de lint se reportan; no
se silencian.
