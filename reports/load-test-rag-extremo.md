# Carga RAG: turnos concurrentes contra el pool real — Fase 7.1

Generado: 2026-09-09T16:31:24.092Z
Proveedor: **falso** (sin `GEMINI_API_KEY`, `RAG_USE_VECTOR=false`) — cero gasto real, misma ruta de código que producción sin llave.
Pool bajo prueba: el real de `src/lib/rag/db.ts` (`getRagPool()`), sin modificar.
Duración por nivel: 12s. Niveles de concurrencia: 120, 180, 250.

**Este documento mide, no fija un umbral.** La Fase 7.2 (presupuesto de latencia) queda pendiente de un requisito de negocio explícito — no hay uno documentado al momento de esta corrida.

## Resultados por nivel

| Flujo | Concurrencia | Turnos | OK | Error % | p50 ms | p95 ms | p99 ms | max ms | pool.waiting max | pool.waiting avg | pool.total max |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| presupuesto | 120 | 359 | 359 | 0.00% | 4701 | 6503 | 7204 | 7237 | 1180 | 566.0 | 20 |
| presupuesto | 180 | 368 | 368 | 0.00% | 8105 | 11490 | 11980 | 12167 | 1780 | 886.3 | 20 |
| presupuesto | 250 | 321 | 321 | 0.00% | 12491 | 14369 | 14540 | 14578 | 2480 | 1235.4 | 20 |

## Errores observados (muestra, hasta 5 por nivel)

- Ningún error en ningún nivel.

## Cómo leer esto

- **pool.total max** vs el `max: 20` configurado en `src/lib/rag/db.ts`: si llega a 20, el pool está saturado en ese nivel.
- **pool.waiting** > 0 significa que hubo turnos esperando una conexión libre; si el error % sube junto con esto, la saturación se está traduciendo en fallos, no solo en cola.
- El flujo `presupuesto` dispara 5 roles en paralelo por turno (`ROLES_PRESUPUESTO`), cada uno con sus propias ramas léxicas concurrentes — es el que más agresivamente demanda el pool, tal como anticipa la Fase 7 del plan.

## Reproducción

```powershell
$env:DATABASE_URL="postgresql://demo:demo@127.0.0.1:5432/demo_rag"
npx tsx --conditions=react-server scripts/load-test-rag.ts --concurrency 120,180,250 --duration 12 --flow presupuesto
```
