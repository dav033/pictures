/**
 * El globo de arriba de las columnas (remate), sin modelo y sin coste:
 *   npx tsx scripts/test/test-remate-columnas.ts
 * - poner_remate sin ids = todas las columnas; amarrado sobre la punta, nudo abajo, centrado y apenas hundido;
 * - cotiza con la columna (parte «remate»), sale en ver_pieza y editar_globos lo cambia solo a él;
 * - columna orgánica (trazo): centrado sobre su punta aunque esté corrida; quitar; errores claros;
 * - la IA lo conoce: herramienta declarada y regla en el prompt («nunca un globo suelto + poner_sobre»).
 */
import assert from "node:assert/strict";
import { DECLARACIONES_ESCENA, aplicarHerramienta, type ResultadoHerramienta } from "../../src/lib/globos3d/herramientas-escena";
import { escenaPredefinida } from "../../src/lib/globos3d/escenas-presets";
import { SALA_INICIAL, type Escena, type NodoEscena } from "../../src/lib/globos3d/escena";
import { REGLAS_AGENTE } from "../../src/lib/globos3d/escena-ia-agente";
import { armarPieza, type GloboDePieza } from "../../src/lib/globos3d/piezas";
import { PARTE_REMATE } from "../../src/lib/globos3d/remate";

let pruebas = 0;
const prueba = (nombre: string, fn: () => void) => { fn(); pruebas += 1; console.log(`  ✓ ${nombre}`); };
const ok = (r: ResultadoHerramienta) => { if (!r.ok) assert.fail(`se esperaba éxito: ${r.error}`); return r; };
const error = (r: ResultadoHerramienta, re: RegExp) => { if (r.ok) assert.fail(`se esperaba error: ${r.resumen}`); assert.match(r.error, re); };
const nodo = (e: Escena, id: string): NodoEscena => e.nodos.find((n) => n.id === id) ?? assert.fail(`falta ${id}`);
const remateDe = (n: NodoEscena): GloboDePieza => armarPieza(n.pieza).globos.find((g) => g.parte === PARTE_REMATE) ?? assert.fail(`«${n.nombre}» sin remate`);
const centro = (g: GloboDePieza) => ({ x: g.nudo.x + g.direccion.x * (g.infladoCm / 2), y: g.nudo.y + g.direccion.y * (g.infladoCm / 2), z: g.nudo.z + g.direccion.z * (g.infladoCm / 2) });

const base = escenaPredefinida("arco_organico_columnas_guirnalda");

console.log("Columnas clásicas");
const conR36 = ok(aplicarHerramienta(base, "poner_remate", { formato: "R-36", color: "dorado" })).escena;
prueba("sin ids pone un R-36 arriba de CADA columna y no toca lo demás", () => {
  for (const id of ["columna-izq", "columna-der"]) {
    const r = remateDe(nodo(conR36, id));
    assert.equal(r.formatoId, "R-36");
    assert.ok(r.infladoCm > 80, `R-36 de ${r.infladoCm} cm`);
  }
  for (const id of ["arco", "guirnalda"]) assert.deepEqual(nodo(conR36, id), nodo(base, id));
});
prueba("amarrado sobre la punta: nudo abajo, centrado sobre el eje, apoyado sobre el último cuarteto", () => {
  const sin = armarPieza(nodo(base, "columna-izq").pieza);
  const g = remateDe(nodo(conR36, "columna-izq"));
  assert.deepEqual(g.direccion, { x: 0, y: 1, z: 0 });
  assert.ok(Math.hypot(g.nudo.x, g.nudo.z) < 3, `centrado (${g.nudo.x.toFixed(1)}, ${g.nudo.z.toFixed(1)})`);
  const hundido = sin.caja.max.y - g.nudo.y;
  assert.ok(hundido > 0 && hundido < 15, `el nudo se amarra hundido entre 0 y 15 cm (${hundido.toFixed(1)})`);
  assert.ok(armarPieza(nodo(conR36, "columna-izq").pieza).caja.max.y > sin.caja.max.y + 80, "la columna crece con el R-36");
});
prueba("cotiza con la columna: un R-36 dorado más en sus materiales", () => {
  const n = nodo(conR36, "columna-izq");
  const r36 = armarPieza(n.pieza).materiales.filter((m) => m.formatoId === "R-36");
  assert.equal(r36.reduce((s, m) => s + m.cantidad, 0), 1);
  assert.equal(r36[0]!.codigo, remateDe(n).codigo);
});
prueba("ver_pieza lo lista como parte «remate»", () => {
  const r = ok(aplicarHerramienta(conR36, "ver_pieza", { id: "columna-izq" }));
  assert.match(r.resumen, /^- remate: R-36 ×1/m);
});
prueba("editar_globos por la parte «remate» cambia solo el globo de arriba", () => {
  const e = ok(aplicarHerramienta(conR36, "editar_globos", { id: "columna-izq", partes: ["remate"], cambio: { color: "rojo" } })).escena;
  const antes = armarPieza(nodo(conR36, "columna-izq").pieza).globos.filter((g) => g.parte !== PARTE_REMATE).map((g) => g.codigo);
  const despues = armarPieza(nodo(e, "columna-izq").pieza).globos.filter((g) => g.parte !== PARTE_REMATE).map((g) => g.codigo);
  assert.deepEqual(despues, antes);
  assert.notEqual(remateDe(nodo(e, "columna-izq")).codigo, remateDe(nodo(conR36, "columna-izq")).codigo);
});
prueba("con ids y sin color: solo esa, del color principal de la columna; luego cambiar formato conserva el color", () => {
  const e = ok(aplicarHerramienta(base, "poner_remate", { ids: ["columna-der"], formato: "R-18" })).escena;
  assert.ok(!armarPieza(nodo(e, "columna-izq").pieza).globos.some((g) => g.parte === PARTE_REMATE));
  const g = remateDe(nodo(e, "columna-der"));
  assert.ok(nodo(base, "columna-der").pieza.tipo === "columna");
  const p = nodo(base, "columna-der").pieza;
  if (p.tipo !== "columna") throw new Error("columna");
  assert.ok(p.colores.includes(g.codigo), `color de la columna (${g.codigo})`);
  const e2 = ok(aplicarHerramienta(e, "poner_remate", { ids: ["columna-der"], formato: "R-24" })).escena;
  assert.equal(remateDe(nodo(e2, "columna-der")).codigo, g.codigo);
});
prueba("quitar lo quita; formato que no es redondo o id inexistente → error claro", () => {
  const e = ok(aplicarHerramienta(conR36, "poner_remate", { quitar: true })).escena;
  for (const id of ["columna-izq", "columna-der"]) assert.equal(nodo(e, id).pieza.remate, undefined);
  error(aplicarHerramienta(base, "poner_remate", { formato: "LOL-12" }), /redondo/);
  error(aplicarHerramienta(base, "poner_remate", { ids: ["no-existe"] }), /No hay pieza con id/);
});

console.log("Columna orgánica (trazo)");
prueba("una columna inclinada lleva el remate sobre su punta corrida", () => {
  const vacia: Escena = { sala: structuredClone(SALA_INICIAL), nodos: [] };
  const conCol = ok(aplicarHerramienta(vacia, "agregar_pieza", { tipo: "trazo_organico", silueta: "columna_inclinada", alto_cm: 200, colores: ["blanco", "dorado"], nombre: "Columna inclinada" })).escena;
  const n = conCol.nodos[0]!;
  const e = ok(aplicarHerramienta(conCol, "poner_remate", { formato: "R-24", color: "blanco" })).escena;
  const sin = armarPieza(n.pieza);
  const arriba = sin.globos.map((g) => ({ g, c: centro(g) })).sort((a, b) => b.c.y + b.g.infladoCm / 2 - (a.c.y + a.g.infladoCm / 2)).slice(0, 6);
  const xTope = arriba.reduce((s, x) => s + x.c.x, 0) / arriba.length;
  const g = remateDe(nodo(e, n.id));
  assert.ok(Math.abs(g.nudo.x - xTope) < 12, `sobre la punta (x ${g.nudo.x.toFixed(0)} vs ${xTope.toFixed(0)})`);
  assert.ok(g.nudo.y > sin.caja.max.y - 25 && g.nudo.y < sin.caja.max.y, "amarrado en la punta del cuerpo");
});

console.log("La IA lo conoce");
prueba("poner_remate declarada y la regla en el prompt", () => {
  assert.ok(DECLARACIONES_ESCENA.some((d) => d.name === "poner_remate"));
  assert.match(REGLAS_AGENTE, /poner_remate/);
  assert.match(REGLAS_AGENTE, /NUNCA agregar un globo suelto ni poner_sobre/);
});

console.log(`\n${pruebas} pruebas OK`);
