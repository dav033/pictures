/**
 * CASE-002 is a mirrored pair of inclined organic columns. Each default column must stay in the
 * measured dense band of 20–26 balloons per metre; the legacy official golden protects one column,
 * while this checks the two-piece guided proposal independently.
 *
 * Run: npx tsx --conditions=react-server scripts/test/test-columna-asimetrica-densidad.ts
 */
import assert from "node:assert/strict";
import { armarDesdeEspec, especDesdePropuesta } from "../../src/lib/globos3d/motor/v1";
import { MEDIDAS_POR_DEFECTO } from "../../src/lib/globos3d/motor/medidas-espec";

const BAND_BALLOONS_PER_METRE: readonly [number, number] = [20, 26];
const { espec, avisos } = especDesdePropuesta({
  frase: "Par de columnas orgánicas inclinadas.",
  colores: ["rosado", "plateado"],
  piezas: [{ estructura: "columna_asimetrica", cantidad: 2 }],
});

assert.deepEqual(avisos, [], "CASE-002 proposal needs no fallback or warning");
assert.equal(espec.piezas.length, 2, "the pair remains two individual columns");
assert.deepEqual(espec.piezas.map((pieza) => pieza.lugar), ["izquierda", "derecha"], "the columns incline from opposite sides");

const resultado = armarDesdeEspec(espec);
assert.deepEqual(resultado.noRepresentable, [], "both CASE-002 columns are represented");

const medidas = espec.piezas.map((pieza) => {
  const lineas = resultado.bom.porPieza[pieza.id];
  assert.ok(lineas, `${pieza.id} has its own bill of materials`);
  const balloons = lineas.reduce((total, linea) => total + linea.cantidad, 0);
  const heightMetres = pieza.medidas.altoM ?? MEDIDAS_POR_DEFECTO.columna_asimetrica.altoM ?? 0;
  assert.ok(heightMetres > 0, `${pieza.id} has a positive height`);
  const perMetre = balloons / heightMetres;
  assert.ok(
    perMetre >= BAND_BALLOONS_PER_METRE[0] && perMetre <= BAND_BALLOONS_PER_METRE[1],
    `${pieza.id} has ${balloons} balloons in ${heightMetres} m (${perMetre.toFixed(1)}/m); CASE-002 band is ${BAND_BALLOONS_PER_METRE[0]}–${BAND_BALLOONS_PER_METRE[1]}/m`,
  );
  return `${balloons} in ${heightMetres} m (${perMetre.toFixed(1)}/m)`;
});

console.log(`test-columna-asimetrica-densidad: ok (${medidas.join("; ")})`);
