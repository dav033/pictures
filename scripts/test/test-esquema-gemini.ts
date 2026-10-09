/**
 * El esquema que se manda a Gemini para leer una foto cabe en su presupuesto. Sin coste ni red.
 * Gemini rechaza con «invalid argument» el esquema entero cuando pasa de su tope de complejidad (comprobado contra la API real
 * el 2026-10-09). Antes de recortarlo llevaba 25,8 KB y 162 valores de enumeración, y agregar muebles y rótulos suma ~28 KB.
 * Aquí se fija el tope:
 * - tamaño del JSON después de adaptarlo a Gemini: 22 KB como máximo;
 * - valores de enumeración: los de hoy (162) más un pequeño margen; los ids de fondos y decoraciones que se agreguen suman aquí;
 * - lo que se repite en las 10 variantes de pieza (los colores) no lleva `describe`: se explica en el prompt, una vez;
 * - todo lo que el esquema dejó de explicar sigue dicho en el prompt (acabados, escalones, formatos, catálogo de fondos, el orden de los
 *   pesos de coloresPorEscalon, el dominante, las anclas, el ancho y el grosor de una columna, la caída de una guirnalda clásica).
 *
 * Run: npx tsx --conditions=react-server scripts/test/test-esquema-gemini.ts
 */
import assert from "node:assert/strict";
import { esquemaLecturaParaGemini } from "../../src/lib/globos3d/leer-foto-ia";
import { construirPromptLectura } from "../../src/lib/globos3d/prompt-lectura-foto";

const MAXIMO_BYTES = 22 * 1024;
const MAXIMO_ENUMS = 170;

let pruebas = 0;
const prueba = (nombre: string, fn: () => void) => { fn(); pruebas += 1; console.log(`  ✓ ${nombre}`); };

type Nodo = Record<string, unknown>;
const recorrer = (n: unknown, f: (x: Nodo) => void): void => {
  if (Array.isArray(n)) { n.forEach((x) => recorrer(x, f)); return; }
  if (n && typeof n === "object") { f(n as Nodo); Object.values(n as Nodo).forEach((x) => recorrer(x, f)); }
};

const esquema = esquemaLecturaParaGemini();
const texto = JSON.stringify(esquema);
let enums = 0, descripciones = 0, bytesDescripciones = 0;
recorrer(esquema, (n) => {
  if (Array.isArray(n.enum)) enums += n.enum.length;
  if (typeof n.description === "string") { descripciones++; bytesDescripciones += Buffer.byteLength(n.description); }
});

console.log(`esquema: ${Buffer.byteLength(texto)} B, ${enums} valores de enumeración, ${descripciones} descripciones (${bytesDescripciones} B)`);

prueba(`el esquema para Gemini pesa a lo más ${MAXIMO_BYTES / 1024} KB`, () => {
  assert.ok(Buffer.byteLength(texto) <= MAXIMO_BYTES, `${Buffer.byteLength(texto)} B`);
});

prueba(`y lleva a lo más ${MAXIMO_ENUMS} valores de enumeración`, () => {
  assert.ok(enums <= MAXIMO_ENUMS, `${enums} valores`);
});

prueba("los colores y las notas, que se repiten en cada variante de pieza, no cargan descripciones", () => {
  const colores: Nodo[] = [];
  recorrer(esquema, (n) => { const p = n.properties as Nodo | undefined; if (p && "acabado" in p && "hex" in p) colores.push(p); });
  assert.ok(colores.length >= 10, `${colores.length} variantes con colores`);
  for (const c of colores) for (const campo of ["nombre", "hex", "peso", "acabado"]) assert.equal((c[campo] as Nodo).description, undefined, campo);
  assert.ok(bytesDescripciones < 2000, `descripciones: ${bytesDescripciones} B`);
});

prueba("el prompt dice lo que el esquema ya no explica", () => {
  const prompt = construirPromptLectura();
  for (const frase of ["cromado = espejo", "perla = satinado", "confeti = transparente con confeti", "parte iluminada del globo", "formatoGigante", "diametroMediano", "FONDOS DEL CATÁLOGO", "DECORACIONES DEL CATÁLOGO", "panel_redondo", "racimos: 0 = cuerpo parejo", "centro de la BASE", "lo que ocupa la columna de lado a lado", "de abajo arriba", "la altura del eje del tubo", "cuánto baja su centro", "en el MISMO orden que colores", "el nombre del color que domina ese tramo, tal como va en colores", "los globos grandes y gigantes uno por uno"]) {
    assert.ok(prompt.includes(frase), `falta «${frase}» en el prompt`);
  }
});

console.log(`test-esquema-gemini: ${pruebas} pruebas ok`);
