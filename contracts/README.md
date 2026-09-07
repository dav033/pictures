# Contratos versionados

Esta carpeta contiene contratos de frontera para la migración gradual a Python.

Reglas vigentes:

- `chat/v1` congela request, SSE, transcript, llamadas de herramientas y errores.
- `domain/v1` congela selección validada, plan 1.0/resuelto, materiales, cotización y schemas activos de catálogo/escena/LoRA.
- TypeScript/Zod sigue siendo la fuente ejecutable durante la Etapa 2.
- Los JSON Schema exportados son artefactos versionados para generar modelos Pydantic después.
- PostgreSQL conserva autoridad comercial sobre catálogo, disponibilidad, inventario, precios y procedencia.
- TypeScript conserva temporalmente resolver de plan, materiales, cotización, aprobación y vocabulario LoRA.
- Python no debe decidir precios, stock, cantidades, identidad canónica ni aprobación.
- Requests sin `schema_version` siguen siendo responsabilidad de un adaptador legacy; el contrato nuevo exige versión explícita.

## Comandos

```powershell
rtk npm run contracts:export
rtk npm run contracts:export:domain
rtk npm run contracts:test
rtk npm run contracts:test:domain
rtk npm run contracts:test:operational
rtk npm run contracts:check
```

La UI actual conserva compatibilidad porque los eventos SSE versionados mantienen campos legacy (`delta`, `reply`, `error` como texto). La Etapa 3 podrá generar modelos Python desde ambos árboles JSON Schema cuando exista el servicio FastAPI. No se crea ese servicio en esta fase.
