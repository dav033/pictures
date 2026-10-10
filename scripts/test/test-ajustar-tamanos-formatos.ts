/**
 * `ajustar_tamanos` solo acepta los tamaños de la mezcla orgánica (R-36…R-5). Sin coste: no llama a ninguna IA.
 * - la declaración que ve el modelo (JSON schema) lista exactamente esos tamaños, igual que la validación;
 * - un T-260 o un LOL-12 (tubitos y link-o-loon no son tamaños de lo orgánico) se rechaza con un mensaje que dice
 *   cuáles sí valen, en `cambios` y en `colores_por_tamano`;
 * - un R-24 sigue aceptándose.
 *   npx tsx scripts/test/test-ajustar-tamanos-formatos.ts
 */
import assert from "node:assert/strict";
import { DECLARACIONES_ESCENA, aplicarHerramienta } from "../../src/lib/globos3d/herramientas-escena";
import { escenaPredefinida } from "../../src/lib/globos3d/escenas-presets";
import { FORMATOS_AJUSTABLES } from "../../src/lib/globos3d/herramientas-escena-tamanos";

let pruebas = 0;
const prueba = (nombre: string, fn: () => void) => { fn(); pruebas += 1; console.log(`  ✓ ${nombre}`); };

/** Todos los `enum` de un JSON schema, en cualquier nivel. */
function enumsDe(esquema: unknown): string[][] {
  if (Array.isArray(esquema)) return esquema.flatMap(enumsDe);
  if (esquema === null || typeof esquema !== "object") return [];
  const hallados: string[][] = [];
  for (const [clave, valor] of Object.entries(esquema)) {
    if (clave === "enum" && Array.isArray(valor)) hallados.push(valor as string[]);
    else hallados.push(...enumsDe(valor));
  }
  return hallados;
}

const declaracion = DECLARACIONES_ESCENA.find((d) => d.name === "ajustar_tamanos");
assert.ok(declaracion, "ajustar_tamanos debe estar declarada");
const escena = escenaPredefinida("arco");

prueba("la declaración del modelo lista solo los tamaños que valida (R-36…R-5), sin T- ni LOL-", () => {
  const formatos = enumsDe(declaracion.parametersJsonSchema).filter((valores) => valores.some((v) => v.startsWith("R-")));
  assert.equal(formatos.length, 2, "cambios.formato y colores_por_tamano.formatos deben ser enum");
  for (const valores of formatos) assert.deepEqual(valores, [...FORMATOS_AJUSTABLES]);
});

prueba("un T-260 en cambios se rechaza y el mensaje dice cuáles tamaños valen", () => {
  const r = aplicarHerramienta(escena, "ajustar_tamanos", { id: "arco", cambios: [{ formato: "T-260", accion: "mas" }] });
  assert.equal(r.ok, false);
  assert.match(r.error ?? "", /«T-260» no es un tamaño de lo orgánico: usa R-36, R-24, R-18, R-12, R-9, R-5/);
  assert.doesNotMatch(r.error ?? "", /Invalid option/);
});

prueba("un LOL-12 en colores_por_tamano se rechaza con el mismo mensaje", () => {
  const r = aplicarHerramienta(escena, "ajustar_tamanos", { id: "arco", colores_por_tamano: [{ formatos: ["LOL-12"], colores: ["rojo"] }] });
  assert.equal(r.ok, false);
  assert.match(r.error ?? "", /«LOL-12» no es un tamaño de lo orgánico: usa R-36, R-24, R-18, R-12, R-9, R-5/);
});

prueba("un R-24 sigue aceptándose", () => {
  const r = aplicarHerramienta(escena, "ajustar_tamanos", { id: "arco", cambios: [{ formato: "R-24", accion: "mas" }] });
  assert.equal(r.ok, true, r.ok ? "" : r.error);
});

console.log(`\n${pruebas} pruebas en test-ajustar-tamanos-formatos OK`);
