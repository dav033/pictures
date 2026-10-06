/**
 * El orden de los colores de una pieza vertical, del pie a la punta, medido en píxeles (2026-10-06).
 *
 * CASE-002: rosa arriba y plata abajo; el modelo listó [rosado, plateado] y el motor pone el primero en el pie,
 * así que la imagen salía al revés. Determinista y sin red.
 * Run: npx tsx --conditions=react-server scripts/test/test-orden-color-pie.ts
 */
import assert from "node:assert/strict";
import { ordenDesdeElPie } from "@/lib/ia/amaterasu/orden-color-pie";

const p = (color: string, participacion: number) => ({ color, participacion });

// La plata domina abajo y el rosa arriba: la plata va primero (pie).
assert.deepEqual(ordenDesdeElPie(["rosado", "plateado"], [p("plateado", 0.6), p("rosado", 0.2)], [p("rosado", 0.7), p("plateado", 0.1)]), [1, 0]);

// Ya está en orden: nada que cambiar.
assert.equal(ordenDesdeElPie(["plateado", "rosado"], [p("plateado", 0.6), p("rosado", 0.2)], [p("rosado", 0.7), p("plateado", 0.1)]), null);

// Bajo luz lila el rosa se mide «dorado rosa» y el gris «lila»: cuentan para el color del patrón más cercano.
assert.deepEqual(ordenDesdeElPie(["rosado", "plateado"], [p("gris", 0.5), p("dorado rosa", 0.1)], [p("dorado rosa", 0.6), p("gris", 0.1)]), [1, 0]);

// Sin señal clara (los dos colores repartidos igual arriba y abajo): manda lo que dijo el modelo.
assert.equal(ordenDesdeElPie(["rosado", "plateado"], [p("rosado", 0.5), p("plateado", 0.5)], [p("rosado", 0.45), p("plateado", 0.55)]), null);

// Un color que no está cerca de ninguno del patrón (el fondo, un mueble) no cuenta.
assert.equal(ordenDesdeElPie(["rosado", "plateado"], [p("verde", 0.9)], [p("verde", 0.9)]), null);

// Tres colores: el de en medio (presente igual en las dos franjas) queda en medio.
assert.deepEqual(ordenDesdeElPie(["azul", "blanco", "dorado"], [p("dorado", 0.6), p("blanco", 0.2)], [p("azul", 0.6), p("blanco", 0.2)]), [2, 1, 0]);

// Un solo color: nada que ordenar.
assert.equal(ordenDesdeElPie(["rosado"], [p("rosado", 1)], [p("rosado", 1)]), null);

console.log("test-orden-color-pie: OK");
