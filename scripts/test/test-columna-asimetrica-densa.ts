/**
 * La columna orgánica (`columna_asimetrica`) que la vista guiada arma por defecto, cuando el cliente no dice su densidad,
 * tiene que ser una columna densa: entre 20 y 26 globos por metro. Esa es la banda de la paridad con Python
 * (`PARIDAD-2026-10-09.md`: la columna orgánica de Python cuenta 23,7 por metro), la de la columna orgánica calibrada del
 * motor 1.2.0 (23,8 por metro) y la de «estándar» de la industria (20 a 26 por metro). Antes salía 30 globos en 1,8 m
 * (16,7 por metro): media densidad con un tubo de 60 cm, la más ligera de las orgánicas y la que el cliente ve como vacía.
 * Sin coste: ninguna IA ni red.
 *
 *   NODE_OPTIONS=--use-system-ca npx tsx --conditions=react-server scripts/test/test-columna-asimetrica-densa.ts
 */
import assert from "node:assert/strict";
import { armarDesdeEspec, especDesdePropuesta } from "../../src/lib/globos3d/motor/v1";
import { MEDIDAS_POR_DEFECTO } from "../../src/lib/globos3d/motor/medidas-espec";

/** La altura por defecto de la columna orgánica: la misma que usa el armado, no una copia. */
const ALTO_M = MEDIDAS_POR_DEFECTO.columna_asimetrica.altoM ?? 0;
assert.ok(ALTO_M > 0, "la columna orgánica tiene altura por defecto");
const BANDA_GLOBOS_POR_METRO: readonly [number, number] = [20, 26];
const TOPE_R5 = 0.3;

const { espec, avisos } = especDesdePropuesta({ frase: "Te propongo una columna orgánica.", colores: ["azul", "blanco", "dorado"], piezas: [{ estructura: "columna_asimetrica", cantidad: 1 }] });
assert.deepEqual(avisos, [], "la propuesta por defecto no trae avisos");

const resultado = armarDesdeEspec(espec);
assert.deepEqual(resultado.noRepresentable, [], "la columna por defecto se representa");
const lineas = resultado.bom.total;
const globos = lineas.reduce((suma, l) => suma + l.cantidad, 0);
const r5 = lineas.filter((l) => l.formatoId === "R-5").reduce((suma, l) => suma + l.cantidad, 0);
const porMetro = globos / ALTO_M;

assert.ok(
  porMetro >= BANDA_GLOBOS_POR_METRO[0] && porMetro <= BANDA_GLOBOS_POR_METRO[1],
  `la columna orgánica por defecto lleva ${globos} globos en ${ALTO_M} m (${porMetro.toFixed(1)} por metro); la banda densa es de ${BANDA_GLOBOS_POR_METRO[0]} a ${BANDA_GLOBOS_POR_METRO[1]}`,
);
assert.ok(r5 / globos <= TOPE_R5, `el relleno chico (R-5) pasa de ${TOPE_R5 * 100} %: ${r5} de ${globos} (la calibración deja ~26 %)`);

console.log(`test-columna-asimetrica-densa: ok (${globos} globos en ${ALTO_M} m, ${porMetro.toFixed(1)} por metro; banda ${BANDA_GLOBOS_POR_METRO[0]} a ${BANDA_GLOBOS_POR_METRO[1]})`);
