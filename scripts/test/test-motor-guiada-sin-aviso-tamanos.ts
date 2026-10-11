/**
 * El motor guiado NO usa el aviso de «Pediste R-24, pero ningún color de la paleta se fabrica en ese tamaño»: ese aviso es de las herramientas del Taller.
 * Los presets de tamaños (`organica_gruesa`, `solo_grandes`) piden R-24 por su cuenta y los avisos del motor van tal cual al cliente, que nunca pidió
 * ese tamaño. Los goldens no comparan avisos: aquí se arma cada idea guardada y cada estructura oficial con cada preset y en un verde Fashion
 * (que no se fabrica en R-24), y ningún aviso puede decir lo que el cliente no pidió.
 *   npx tsx --conditions=react-server scripts/test/test-motor-guiada-sin-aviso-tamanos.ts
 */
import assert from "node:assert/strict";
import { todosLosCasos } from "../lib/casos-motor-guiada";
import { TAMANOS_ESPEC } from "../../src/lib/globos3d/motor/espec-cliente-v1";
import { armarDesdeEspec, type EspecClienteV1 } from "../../src/lib/globos3d/motor/v1";

const AVISO_DEL_TALLER = /Pediste .*ningún color de la paleta/;
const VERDE_FASHION = [{ codigo: "030", nombre: "verde", peso: 1 }] as const;

let armadas = 0;
for (const caso of todosLosCasos()) {
  for (const tamanos of TAMANOS_ESPEC) {
    const espec: EspecClienteV1 = {
      ...caso.espec,
      piezas: caso.espec.piezas.map((p) => (p.declarada ? p : { ...p, tamanos, colores: [...VERDE_FASHION] })),
    };
    const resultado = armarDesdeEspec(espec);
    armadas += 1;
    for (const aviso of resultado.avisos) assert.doesNotMatch(aviso, AVISO_DEL_TALLER, `${caso.id} con ${tamanos}: el cliente recibe un aviso del Taller: ${aviso}`);
  }
}
assert.ok(armadas >= 46 * 4, `se armaron ${armadas} combinaciones`);
console.log(`test-motor-guiada-sin-aviso-tamanos: ${armadas} combinaciones (idea u oficial × preset) sin avisos del Taller.`);
