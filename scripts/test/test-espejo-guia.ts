/**
 * Auditoría de propiedades huérfanas (2026-10-05): el lado de un semiarco en la guía de escena.
 *
 * - Un semiarco apunta la punta hacia el centro de la escena según dónde está su caja, también si es uno solo.
 * - El dibujo de Python ya viene volteado si el plan dice `lateral_derecho`: la guía no lo voltea otra vez (un par
 *   así salía con las dos puntas hacia fuera).
 * - Las demás piezas, como siempre: solo la copia derecha de un grupo.
 *
 * Determinista y sin red. Run: npx tsx --conditions=react-server scripts/test/test-espejo-guia.ts
 */
import assert from "node:assert/strict";
import { instanciasDeEscena } from "@/lib/ia/kagutsuchi/guia-escena";

type Estructuras = Parameters<typeof instanciasDeEscena>[0];
const pieza = (tipo: string, ubicacion: string, repeticiones: number) =>
  [{ estructura_id: "EST_01", tipo, ubicacion, repeticiones, materiales: [], medidas: {} }] as unknown as Estructuras;
const espejos = (estructuras: Estructuras) => instanciasDeEscena(estructuras, undefined).map((i) => [Math.round(i.caja.x * 10) / 10 < 0.5 ? "izq" : "der", i.espejo]);

// Par de semiarcos declarado a la izquierda (Python no voltea): la copia derecha se voltea, la izquierda no.
for (const [lado, espejo] of espejos(pieza("semiarco", "lateral_izquierdo", 2))) assert.equal(espejo, lado === "der", `par izquierdo, copia ${lado}`);
// El mismo par declarado a la derecha (Python YA volteó): ahora es la copia izquierda la que se voltea.
for (const [lado, espejo] of espejos(pieza("semiarco", "lateral_derecho", 2))) assert.equal(espejo, lado === "izq", `par derecho, copia ${lado}`);
// Un semiarco solo a la derecha ya volteado por Python: no se toca; a la izquierda, tampoco.
assert.deepEqual(espejos(pieza("semiarco", "lateral_derecho", 1)).map(([, e]) => e), [false]);
assert.deepEqual(espejos(pieza("semiarco", "lateral_izquierdo", 1)).map(([, e]) => e), [false]);
// Una columna: solo la copia derecha de un grupo, como siempre.
for (const [lado, espejo] of espejos(pieza("columna", "lateral_izquierdo", 2))) assert.equal(espejo, lado === "der");
assert.deepEqual(espejos(pieza("columna", "lateral_derecho", 1)).map(([, e]) => e), [false]);

console.log("test-espejo-guia: OK");
