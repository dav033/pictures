# Carga RAG: turnos concurrentes contra el pool real — Fase 7.1

Generado: 2026-09-09T16:30:10.766Z
Proveedor: **falso** (sin `GEMINI_API_KEY`, `RAG_USE_VECTOR=false`) — cero gasto real, misma ruta de código que producción sin llave.
Pool bajo prueba: el real de `src/lib/rag/db.ts` (`getRagPool()`), sin modificar.
Duración por nivel: 8s. Niveles de concurrencia: 1, 5, 10, 15, 20, 30, 50, 80.

**Este documento mide, no fija un umbral.** La Fase 7.2 (presupuesto de latencia) queda pendiente de un requisito de negocio explícito — no hay uno documentado al momento de esta corrida.

## Resultados por nivel

| Flujo | Concurrencia | Turnos | OK | Error % | p50 ms | p95 ms | p99 ms | max ms | pool.waiting max | pool.waiting avg | pool.total max |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| chat | 1 | 172 | 172 | 0.00% | 35 | 108 | 132 | 134 | 0 | 0.0 | 2 |
| chat | 5 | 576 | 576 | 0.00% | 55 | 151 | 238 | 262 | 0 | 0.0 | 10 |
| chat | 10 | 1066 | 1066 | 0.00% | 59 | 171 | 209 | 251 | 0 | 0.0 | 20 |
| chat | 15 | 1044 | 1044 | 0.00% | 90 | 283 | 335 | 475 | 0 | 0.0 | 20 |
| chat | 20 | 1034 | 1034 | 0.00% | 124 | 366 | 452 | 527 | 7 | 1.8 | 20 |
| chat | 30 | 1003 | 1003 | 0.00% | 194 | 459 | 553 | 667 | 22 | 13.9 | 20 |
| chat | 50 | 1046 | 1046 | 0.00% | 323 | 649 | 741 | 825 | 70 | 37.7 | 20 |
| chat | 80 | 1077 | 1077 | 0.00% | 529 | 955 | 1054 | 1123 | 136 | 73.9 | 20 |
| presupuesto | 1 | 128 | 128 | 0.00% | 53 | 104 | 125 | 135 | 0 | 0.0 | 20 |
| presupuesto | 5 | 162 | 162 | 0.00% | 218 | 472 | 544 | 627 | 17 | 3.1 | 20 |
| presupuesto | 10 | 156 | 156 | 0.00% | 447 | 1114 | 1639 | 1732 | 59 | 25.3 | 20 |
| presupuesto | 15 | 190 | 190 | 0.00% | 636 | 939 | 993 | 997 | 117 | 50.2 | 20 |
| presupuesto | 20 | 188 | 188 | 0.00% | 884 | 1263 | 1338 | 1368 | 160 | 73.8 | 20 |
| presupuesto | 30 | 190 | 190 | 0.00% | 1394 | 1884 | 2049 | 2073 | 265 | 124.8 | 20 |
| presupuesto | 50 | 196 | 196 | 0.00% | 2370 | 3173 | 3395 | 3415 | 471 | 223.6 | 20 |
| presupuesto | 80 | 209 | 209 | 0.00% | 3684 | 4963 | 5254 | 5309 | 780 | 376.2 | 20 |

## Errores observados (muestra, hasta 5 por nivel)

- Ningún error en ningún nivel.

## Cómo leer esto

- **pool.total max** vs el `max: 20` configurado en `src/lib/rag/db.ts`: si llega a 20, el pool está saturado en ese nivel.
- **pool.waiting** > 0 significa que hubo turnos esperando una conexión libre; si el error % sube junto con esto, la saturación se está traduciendo en fallos, no solo en cola.
- El flujo `presupuesto` dispara 5 roles en paralelo por turno (`ROLES_PRESUPUESTO`), cada uno con sus propias ramas léxicas concurrentes — es el que más agresivamente demanda el pool, tal como anticipa la Fase 7 del plan.

## Reproducción

```powershell
$env:DATABASE_URL="postgresql://demo:demo@127.0.0.1:5432/demo_rag"
npx tsx --conditions=react-server scripts/load-test-rag.ts --concurrency 1,5,10,15,20,30,50,80 --duration 8 --flow both
```
