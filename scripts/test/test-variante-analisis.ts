/**
 * Invariantes de las variantes del prompt de análisis (UI-3, 2026-10-05).
 *
 * - v16 y v17 no cambian byte a byte: sus hashes son los que midieron ADR-0029 y la línea base de images-judge.
 * - v18 es v17 con sus reglas DETRÁS: el texto de v17 es prefijo exacto del de v18, así que todo lo que v17
 *   pedía se sigue pidiendo igual.
 * - La variante de la ruta pide las cuatro lecturas (sin eso el validador de Python no recibe `lecturas`).
 *
 * Determinista y sin red. Run: npx tsx --conditions=react-server scripts/test/test-variante-analisis.ts
 */
import assert from "node:assert/strict";
import { configurarPersistenciaTelemetria } from "@sempertex/agente-core";
import { sistemaAnalisis } from "@/lib/ia/amaterasu/analizar-referencias-v2";
import {
  STRUCTURE_RULES_V18_CANDIDATE,
  STRUCTURE_RULES_V19_CANDIDATE,
  STRUCTURE_RULES_V20_COLORES,
  VARIANTE_V20_COLORES,
  VARIANTE_LECTURA_UNICA,
  VARIANTE_RUTA_ANALISIS,
  VARIANTE_V18_CANDIDATA,
  VARIANTE_V19_CANDIDATA,
  varianteConLecturas,
} from "@/lib/ia/referencia/reference-structure";

configurarPersistenciaTelemetria(undefined);

// Hashes medidos (entorno de la línea base del 2026-10-05). Si uno cambia, la línea base deja de valer.
assert.equal(sistemaAnalisis([], "perceptual", VARIANTE_LECTURA_UNICA).systemPromptHash, "3dcce143a3daa378e2babac90cb87b0b5e7bb4d373e4d2135accacbc6b2d66f5", "v17 sigue byte a byte");
assert.equal(sistemaAnalisis([], "perceptual", VARIANTE_V18_CANDIDATA).systemPromptHash, "1c49084386ec4a303051247c6a466fc8a99b57b3a5936c1b819e0b1ef37336a5", "v18 es la medida en INFORME-v18-y-etiquetas");

const v17 = sistemaAnalisis([], "perceptual", VARIANTE_LECTURA_UNICA).inventorySystem;
const v18 = sistemaAnalisis([], "perceptual", VARIANTE_V18_CANDIDATA).inventorySystem;
assert.ok(v18.startsWith(v17), "el texto de v17 es prefijo exacto del de v18");
assert.equal(v18.slice(v17.length), `\n${STRUCTURE_RULES_V18_CANDIDATE}`, "v18 solo añade sus reglas detrás");
const v19 = sistemaAnalisis([], "perceptual", VARIANTE_V19_CANDIDATA).inventorySystem;
assert.ok(v19.startsWith(v18), "el texto de v18 es prefijo exacto del de v19");
assert.equal(v19.slice(v18.length), `\n${STRUCTURE_RULES_V19_CANDIDATE}`, "v19 solo añade sus reglas detrás");
assert.ok(varianteConLecturas(VARIANTE_V19_CANDIDATA), "v19 pide las cuatro lecturas");
// v20 (la de la ruta desde el 2026-10-06): v18 byte a byte y las reglas de color detrás.
const v20 = sistemaAnalisis([], "perceptual", VARIANTE_V20_COLORES).inventorySystem;
assert.ok(v20.startsWith(v18), "el texto de v18 es prefijo exacto del de v20");
assert.equal(v20.slice(v18.length), `\n${STRUCTURE_RULES_V20_COLORES}`, "v20 solo añade sus reglas de color detrás");
assert.equal(VARIANTE_RUTA_ANALISIS, VARIANTE_V20_COLORES, "la ruta lee con v20");
assert.ok(varianteConLecturas(VARIANTE_V20_COLORES), "v20 pide las cuatro lecturas");

assert.ok(varianteConLecturas(VARIANTE_RUTA_ANALISIS), "la ruta pide las cuatro lecturas");
assert.ok(varianteConLecturas(VARIANTE_LECTURA_UNICA) && varianteConLecturas(VARIANTE_V18_CANDIDATA));
assert.ok(!varianteConLecturas("v16"), "v16 no lleva lecturas");

console.log("test-variante-analisis: OK");
