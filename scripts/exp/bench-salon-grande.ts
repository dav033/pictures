/**
 * Banco de rendimiento de un salón de eventos (REQ-008): arma la escena de una boda de 120 invitados con ~2 500 globos y mide
 * `armarEscena` (lo que hace la app cada vez que cambia la escena) en frío y en caliente. Sin red ni GPU.
 *   NODE_OPTIONS=--use-system-ca npx tsx --conditions=react-server scripts/exp/bench-salon-grande.ts [globos_objetivo] [invitados]
 * El evento ya trae un centro en cada mesa y el techo de la pista (planificar_evento), así que esos globos cuentan. Con globos_objetivo 0 mide el evento tal cual.
 * Presupuesto: armarEscena en frío <= 1 500 ms y en caliente <= 600 ms con ~2 500 globos y ~60 piezas.
 */
import assert from "node:assert/strict";
import { armarEscena, SALA_INICIAL, type Escena } from "../../src/lib/globos3d/escena";
import { aplicarHerramienta } from "../../src/lib/globos3d/herramientas-escena";

const objetivo = Number(process.argv[2] ?? 2500);
const invitados = Number(process.argv[3] ?? 120);
const aplicar = (e: Escena, nombre: string, args: Record<string, unknown>): Escena => {
  const r = aplicarHerramienta(e, nombre, args);
  if (!r.ok) throw new Error(`${nombre}: ${r.error}`);
  return r.escena;
};

let escena = aplicar({ sala: { ...SALA_INICIAL }, nodos: [] }, "planificar_evento", { tipo_evento: "boda", invitados, colores: ["blanco", "dorado"] });
const globosDelEvento = armarEscena(escena).globos.length;
// Columnas orgánicas a lo largo de las paredes laterales hasta llegar a los globos pedidos.
let k = 0;
while (armarEscena(escena).globos.length < objetivo && k < 60) {
  const lado = k % 2 === 0 ? -1 : 1;
  escena = aplicar(escena, "agregar_pieza", { tipo: "columna_organica", alto_cm: 250, colores: ["blanco", "dorado"], donde: { en: "piso", x_cm: lado * (escena.sala.anchoCm / 2 - 60), z_cm: -escena.sala.fondoCm / 2 + 300 + Math.floor(k / 2) * 150 } });
  k++;
}

const tiempo = (f: () => unknown) => { const t = performance.now(); f(); return performance.now() - t; };
const frio = tiempo(() => armarEscena(escena));
const calientes = Array.from({ length: 5 }, () => tiempo(() => armarEscena(escena))).sort((a, b) => a - b);
const armada = armarEscena(escena);
const resultado = {
  invitados, globosDelEvento, globos: armada.globos.length, piezas: escena.nodos.length, salaM: `${escena.sala.anchoCm / 100} x ${escena.sala.fondoCm / 100} x ${escena.sala.altoCm / 100}`,
  armarEscenaFrioMs: Math.round(frio), armarEscenaCalienteMedianaMs: Math.round(calientes[2]!), solidos: armada.solidos.length,
};
console.log(JSON.stringify(resultado, null, 2));
assert.ok(resultado.globos >= objetivo * 0.9, `solo ${resultado.globos} globos`);
assert.ok(frio <= 1500, `armarEscena en frío ${Math.round(frio)} ms pasa el presupuesto de 1 500`);
assert.ok(calientes[2]! <= 600, `armarEscena en caliente ${Math.round(calientes[2]!)} ms pasa el presupuesto de 600`);
console.log("dentro del presupuesto");
