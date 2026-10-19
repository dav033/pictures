/**
 * El empaque orgánico guardado (`armarOrganico` no rehace el empaque si solo cambian los colores). Sin coste.
 * - con el empaque guardado sale exactamente lo mismo que armándolo desde cero (posiciones, colores, avisos, anclas);
 * - cambiar un color tarda una fracción de lo que tarda el empaque;
 * - lo que devuelve no comparte objetos con lo guardado (cambiarlo no daña la siguiente vez).
 */
import assert from "node:assert/strict";
import { armarOrganico, olvidarEmpaquesOrganicos } from "../../src/lib/globos3d/organico";
import { COLUMNA_QUINCE_AZUL } from "../../src/lib/globos3d/organico-presets";
import { opcionesArcoOrganico } from "../../src/lib/globos3d/formas-escena";
import { arcoOrganico } from "../../src/lib/globos3d/escenas-presets";

const pieza = arcoOrganico();
assert.equal(pieza.tipo, "arco_organico");
if (pieza.tipo !== "arco_organico") throw new Error("se esperaba un arco orgánico");
const arco = opcionesArcoOrganico(pieza.arco);
const recoloreado = { ...arco, colores: arco.colores.map((c, i) => (i === 0 ? { ...c, codigo: c.codigo === "005" ? "012" : "005" } : c)) };

for (const [nombre, a, b] of [["arco orgánico", arco, recoloreado], ["columna XV", COLUMNA_QUINCE_AZUL.opciones, { ...COLUMNA_QUINCE_AZUL.opciones, colores: [...COLUMNA_QUINCE_AZUL.opciones.colores].reverse() }]] as const) {
  // Desde cero, cada uno por su lado.
  olvidarEmpaquesOrganicos();
  const t0 = performance.now();
  const frescoA = JSON.stringify(armarOrganico(a));
  const msEmpaque = performance.now() - t0;
  olvidarEmpaquesOrganicos();
  const frescoB = JSON.stringify(armarOrganico(b));
  // Con el empaque guardado: primero A (empaca), luego B (solo colores) y A otra vez.
  olvidarEmpaquesOrganicos();
  const guardadoA = armarOrganico(a);
  const t1 = performance.now();
  const guardadoB = JSON.stringify(armarOrganico(b));
  const msColor = performance.now() - t1;
  assert.equal(guardadoB, frescoB, `${nombre}: recolorear con el empaque guardado da lo mismo que desde cero`);
  // Lo devuelto no comparte objetos con lo guardado.
  guardadoA.globos[0]!.centro.x += 1000;
  const ancla = guardadoA.anclas[0];
  if (ancla) ancla.posicion.x += 1000;
  assert.equal(JSON.stringify(armarOrganico(a)), frescoA, `${nombre}: lo guardado no cambia si se toca lo devuelto`);
  assert.ok(msColor < msEmpaque / 3, `${nombre}: cambiar un color (${msColor.toFixed(0)} ms) cuesta mucho menos que empacar (${msEmpaque.toFixed(0)} ms)`);
  console.log(`✓ ${nombre}: empacar ${msEmpaque.toFixed(0)} ms, cambiar un color ${msColor.toFixed(0)} ms`);
}
console.log("✓ test-organico-empaque");
