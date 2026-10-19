/**
 * Plan T24 pedía `033_*.sql`, pero 033 ya es `033_proveedor_anthropic.sql`: la migración de la columna `repositorio` es la 034.
 * Este archivo existe para que el verify del plan (`test-migracion-033.ts`) pase y delega en la prueba estática de la migración real.
 *
 * Run: npx tsx scripts/test/test-migracion-033.ts
 */
import "./test-migracion-repositorio";
