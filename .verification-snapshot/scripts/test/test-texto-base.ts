/**
 * FLUX base no entiende líneas comerciales ni triggers de LoRA (2026-10-06): el compilador los quita del texto
 * en vez de que el preflight rechace la imagen. Determinista y sin red.
 * Run: npx tsx --conditions=react-server scripts/test/test-texto-base.ts
 */
import assert from "node:assert/strict";
import { limpiarTextoBase, palabrasSoloFlux } from "@/lib/ia/kagutsuchi/texto-base";

// Título de producto con su línea comercial: se va la línea, queda el color.
const titulo = limpiarTextoBase("A column of Reflex Dorado and Fashion Coral Tropical balloons, natural depth.");
assert.equal(titulo.texto, "A column of Dorado and Coral Tropical balloons, natural depth.");
assert.deepEqual(titulo.quitadas, ["Reflex", "Fashion"]);

// Los adjetivos en minúscula que usa el texto base no son líneas comerciales.
const adjetivos = "soft pastel matte pink and crystal clear balloons. Pastel pink at the base.";
assert.deepEqual(limpiarTextoBase(adjetivos), { texto: adjetivos, quitadas: [] });
assert.deepEqual(palabrasSoloFlux(adjetivos), []);

// Trigger, marcas registradas y Link-O-Loon; sin espacios dobles ni coma suelta.
const marcas = limpiarTextoBase("eventdecor_style_v3, an arch of Link-O-Loon® links , Sempertex™ balloons");
assert.equal(marcas.texto, "an arch of linking links, Sempertex balloons");
assert.deepEqual(new Set(marcas.quitadas), new Set(["eventdecor_style_v3", "Link-O-Loon", "®", "™"]));

// El invariante del preflight ve lo mismo que limpia el compilador, y nada tras limpiar.
assert.deepEqual(palabrasSoloFlux("Reflex Plata garland eventdecor_style_v2"), ["trigger de LoRA", "nombre de línea comercial"]);
assert.deepEqual(palabrasSoloFlux(limpiarTextoBase("Reflex Plata garland eventdecor_style_v2 ®").texto), []);

console.log("test-texto-base: ok");
