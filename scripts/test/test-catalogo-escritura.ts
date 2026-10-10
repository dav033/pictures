/**
 * Lo que se guarda en `pieza.mueble.id` es siempre el id corto (REQ-013, SPEC §5.2): el motor (FLUX, salón, telones colgados)
 * compara ids cortos, así que un id calificado se normaliza donde se escribe la escena y uno de otro repositorio no entra. Sin
 * coste: ninguna IA ni red.
 * - `agregar_mobiliario` con `mobiliario:silla_tiffany` guarda `silla_tiffany` y la silla sale en la descripción para FLUX;
 *   con `escenografia:silla_tiffany` falla;
 * - `EscenaSchema` (lo que llega del navegador) guarda corto el id calificado y rechaza el de otro repositorio;
 * - el motor solo busca ids cortos (`entradaDeCatalogo`, `muebleDe`).
 *
 * Run: NODE_OPTIONS=--use-system-ca npx tsx --conditions=react-server scripts/test/test-catalogo-escritura.ts
 */
import assert from "node:assert/strict";
import { armarEscena, escenaEnIngles, SALA_INICIAL, type Escena } from "../../src/lib/globos3d/escena";
import { EscenaSchema } from "../../src/lib/globos3d/esquema-escena";
import { entradaDeCatalogo } from "../../src/lib/globos3d/fondos-escenografia";
import { HERRAMIENTAS_MOBILIARIO } from "../../src/lib/globos3d/herramientas-escena-mobiliario";
import { muebleDe } from "../../src/lib/globos3d/mobiliario-catalogo";

let pruebas = 0;
const prueba = (nombre: string, fn: () => void) => { fn(); pruebas += 1; console.log(`  ✓ ${nombre}`); };

const vacia: Escena = { sala: structuredClone(SALA_INICIAL), nodos: [] };
const agregar = (argumentos: Record<string, unknown>) => HERRAMIENTAS_MOBILIARIO.agregar_mobiliario!.aplicar(vacia, argumentos).escena;
const idsGuardados = (escena: Escena) => escena.nodos.flatMap((n) => (n.pieza.tipo === "escenografia" && n.pieza.mueble ? [n.pieza.mueble.id] : []));

prueba("agregar_mobiliario con un id calificado guarda el corto y la silla sale en la descripción para FLUX", () => {
  const corta = agregar({ id: "silla_tiffany" }), calificada = agregar({ id: "mobiliario:silla_tiffany" });
  assert.deepEqual(idsGuardados(calificada), ["silla_tiffany"]);
  const flux = escenaEnIngles(calificada, armarEscena(calificada));
  assert.match(flux, /Tiffany/i, flux);
  assert.equal(flux, escenaEnIngles(corta, armarEscena(corta)));
  assert.deepEqual(idsGuardados(agregar({ id: "escenografia:panel_redondo" })), ["panel_redondo"]);
});

prueba("agregar_mobiliario con un id calificado con otro repositorio falla", () => {
  assert.throws(() => agregar({ id: "escenografia:silla_tiffany" }), /no es de ese repositorio/);
  assert.throws(() => agregar({ id: "sempertex:silla_tiffany" }), /no es de ese repositorio/);
});

prueba("la escena que llega del navegador guarda el id corto y no deja pasar el de otro repositorio", () => {
  const conMueble = (id: string): Escena => ({ ...vacia, nodos: [{ id: "n1", nombre: "Silla", pieza: { tipo: "escenografia", elementos: [], mueble: { id } }, colocacion: { en: "piso", xCm: 0, zCm: 0, giroGrados: 0 } }] });
  assert.deepEqual(idsGuardados(EscenaSchema.parse(conMueble("mobiliario:silla_tiffany"))), ["silla_tiffany"]);
  assert.deepEqual(EscenaSchema.parse(conMueble("mobiliario:silla_tiffany")), EscenaSchema.parse(conMueble("silla_tiffany")));
  assert.deepEqual(idsGuardados(EscenaSchema.parse(conMueble("ya_no_existe"))), ["ya_no_existe"], "un corto viejo pasa tal cual (caja roja)");
  assert.ok(!EscenaSchema.safeParse(conMueble("escenografia:silla_tiffany")).success);
});

prueba("el motor solo busca ids cortos", () => {
  assert.ok(entradaDeCatalogo("silla_tiffany") && muebleDe("silla_tiffany"));
  assert.equal(entradaDeCatalogo("mobiliario:silla_tiffany"), undefined);
  assert.equal(muebleDe("mobiliario:silla_tiffany"), undefined);
});

console.log(`test-catalogo-escritura: ${pruebas} pruebas ok`);
