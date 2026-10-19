/**
 * Un pastel que la foto pone sobre un pedestal (o un cilindro) se arma sobre él, no falla con «no hay una mesa debajo»
 * (31 y 33 de la corrida 2026-10-10). Una pieza hecha solo de cilindros de piso (un pedestal de la foto) es una superficie de
 * apoyo como una mesa; una mesa sigue siendo lo que era; un sofá no es superficie. Sin coste: ninguna IA ni red.
 *
 * Run: npx tsx --conditions=react-server scripts/test/test-soporte-pedestal.ts
 */
import assert from "node:assert/strict";
import { armarEscena, SALA_INICIAL, type Escena, type NodoEscena } from "../../src/lib/globos3d/escena";
import { compilarLectura } from "../../src/lib/globos3d/compilar-lectura";
import { LecturaFotoSchema } from "../../src/lib/globos3d/lectura-foto";
import { superficieSuperior } from "../../src/lib/globos3d/mobiliario-superficie";
import { piezaDeEntrada } from "../../src/lib/globos3d/mobiliario-pieza";
import { FONDOS_CATALOGO } from "../../src/lib/globos3d/fondos-escenografia";

const color = (hex: string) => ({ nombre: "blanco", hex, peso: 100, acabado: "mate" as const });

const lectura = LecturaFotoSchema.parse({
  resumen: "pastel sobre un pedestal",
  aspecto: 1.5,
  escala: { altoImagenCm: 250, referencia: "pedestal de 70 cm" },
  pisoY: 0.9,
  sala: { pared: "#ffffff", piso: "#cccccc" },
  piezas: [
    { tipo: "fondo", id: "pedestales", x: 0.5, yBase: 0.8, ancho: 0.12, alto: 0.3, colores: [color("#f4f1ea")], cajas: [{ x: 0.5, yBase: 0.8, ancho: 0.12, alto: 0.3 }] },
    { tipo: "fondo", id: "pastel", x: 0.5, yBase: 0.5, ancho: 0.1, alto: 0.1, colores: [color("#ffffff")] },
  ],
});

const { escena, omitidas } = compilarLectura(lectura);
assert.deepEqual(omitidas, [], `ninguna pieza se queda fuera: ${omitidas.join(" | ")}`);
const pastel = escena.nodos.find((n) => n.id.startsWith("pastel"));
const pedestal = escena.nodos.find((n) => n.id.startsWith("pedestal"));
assert.ok(pedestal && pastel, "hay pedestal y pastel");
assert.equal(pastel!.colocacion.en, "sobre", "el pastel va sobre el pedestal");
assert.equal(pastel!.colocacion.en === "sobre" ? pastel!.colocacion.padreId : "", pedestal!.id, "apoyado en el pedestal, no en otra pieza");
console.log("  ✓ el pastel de la foto se apoya en el pedestal de la foto, sin omitidas");

const armada = armarEscena(escena);
const superficie = superficieSuperior(pedestal!, armada);
assert.ok(superficie && superficie.forma === "circulo", "el pedestal tiene cima");
assert.ok(superficie.altoCm > 60 && superficie.altoCm < 120, `cima a ${superficie.altoCm.toFixed(0)} cm`);
console.log("  ✓ la cima de un pedestal (cilindro de piso) es superficie de apoyo");

const sofa: NodoEscena = { id: "sofa-1", nombre: "Sofá", pieza: piezaDeEntrada(FONDOS_CATALOGO.find((f) => f.id === "sofa")!), colocacion: { en: "piso", xCm: 0, zCm: 0, giroGrados: 0 } };
const sala: Escena = { sala: { ...SALA_INICIAL }, nodos: [sofa] };
assert.equal(superficieSuperior(sofa, armarEscena(sala)), null, "un sofá no es superficie de apoyo");
console.log("  ✓ un sofá sigue sin ser superficie de apoyo");

console.log("test-soporte-pedestal: ok");
