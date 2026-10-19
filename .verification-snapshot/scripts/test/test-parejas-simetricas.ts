/**
 * Parejas simétricas (piezas-individuales.ts): «2 × Columna» son la izquierda y la derecha de una misma pieza y van
 * iguales. Verificador (2026-10-06, guiada-20261006-231824-v43qux, solicitud 1467f2ba): la propuesta solo traía los
 * colores del plan entero y el modelo puso la columna izquierda en dorado y fucsia y la derecha en rosado y oro rosa.
 *
 * - La instrucción declara la pareja (ids, sin nombres numerados) y le da a las dos todos los colores del plan.
 * - `igualarParejas` sobre el plan REAL de ese registro deja las dos columnas con los mismos materiales, sin quitar
 *   ningún color del plan, y el plan sigue pasando el esquema.
 * - No toca una pareja de la foto ni dos piezas sueltas que el cliente pidió distintas (sin línea de pareja).
 *
 * Determinista, sin red y sin coste. Run: npx tsx scripts/test/test-parejas-simetricas.ts
 */
import assert from "node:assert/strict";
import { instruccionPlanGuiado } from "@/lib/ia/guiado/instruccion-plan";
import { normalizarPropuestaComposicion } from "@/lib/ia/guiado/propuesta-composicion";
import { igualarParejas, parejasDeInstruccion } from "@/lib/plan/piezas-individuales";
import { extraerRestriccionesUsuario } from "@/lib/plan/restricciones";
import { PlanDecoracionSchema, type PlanDecoracion } from "@/lib/plan/tipos";

const COLORES = ["dorado", "fucsia", "rosado", "dorado rosa"];

// --- La instrucción -----------------------------------------------------------------------------------------------
const propuesta = normalizarPropuestaComposicion({ frase: "x", colores: COLORES, piezas: [{ estructura: "guirnalda", cantidad: 1 }, { estructura: "columna", cantidad: 2 }] });
assert.ok(propuesta);
const instruccion = instruccionPlanGuiado(propuesta);
assert.deepEqual(parejasDeInstruccion(instruccion), [["EST_02_COLUMNA", "EST_03_COLUMNA"]], "la pareja va declarada por id");
const lineasColumna = instruccion.split("\n").filter((linea) => linea.startsWith("- Columna"));
assert.equal(lineasColumna.length, 2);
for (const linea of lineasColumna) assert.match(linea, /colores de esta pieza: dorado, fucsia, rosado, dorado rosa/, "cada columna de la pareja lleva todos los colores");
assert.doesNotMatch(instruccion.split("\n").find((linea) => linea.startsWith("- Guirnalda")) ?? "", /colores de esta pieza/, "la guirnalda sigue libre");
// La línea de la pareja no crea restricciones nuevas (la trampa de «Columna 1» → «pidió una columna»).
const restricciones = extraerRestriccionesUsuario(instruccion);
assert.ok(!restricciones.estructuras.some((estructura) => estructura.tipo === "columna" && estructura.repeticiones === 1), JSON.stringify(restricciones.estructuras));
// Dos piezas sueltas con su propio lado (el cliente las pidió por separado) no son una pareja declarada.
const sueltas = normalizarPropuestaComposicion({ frase: "x", colores: ["azul", "blanco"], piezas: [
  { estructura: "columna", cantidad: 1, ubicacion: "lateral_izquierdo", colores: ["azul"] },
  { estructura: "columna", cantidad: 1, ubicacion: "lateral_derecho", colores: ["blanco"] },
] });
assert.ok(sueltas);
assert.deepEqual(parejasDeInstruccion(instruccionPlanGuiado(sueltas)), []);

// --- El plan real del registro --------------------------------------------------------------------------------------
const material = (color: string, product_id: string, participacion: number, rol_material: "principal" | "secundario" | "acento") => ({ color, product_id, participacion, rol_material });
const plan: PlanDecoracion = PlanDecoracionSchema.parse({
  plan_version: "1.0",
  plan_id: "00000000-0000-4000-8000-000000000001",
  concepto: { titulo: "Guirnalda y columnas", descripcion: "Prueba", paleta: COLORES },
  espacio: { tipo: "salón", fuente: "supuesto" },
  supuestos: [],
  estructuras: [
    { estructura_id: "EST_01_GUIRNALDA", nombre: "Guirnalda", tipo: "guirnalda", estructura_oficial: "guirnalda", rol_escena: "focal", ubicacion: "fondo_pared", medidas: { largo_m: 2.4 }, repeticiones: 1, densidad: "media", mezcla: "organica_fina", porque: "x",
      materiales: [material("dorado", "8634255638823", 0.26, "principal"), material("fucsia", "8634248167719", 0.25, "secundario"), material("rosado", "8634278183207", 0.25, "secundario"), material("dorado rosa", "8634249838887", 0.24, "acento")] },
    { estructura_id: "EST_02_COLUMNA", nombre: "Columna izquierda", tipo: "columna", estructura_oficial: "columna", rol_escena: "soporte", ubicacion: "lateral_izquierdo", medidas: { alto_m: 2 }, repeticiones: 1, densidad: "media", mezcla: "clasica", porque: "x",
      materiales: [material("dorado", "8634255638823", 0.5, "principal"), material("fucsia", "8634248167719", 0.5, "secundario")] },
    { estructura_id: "EST_03_COLUMNA", nombre: "Columna derecha", tipo: "columna", estructura_oficial: "columna", rol_escena: "soporte", ubicacion: "lateral_derecho", medidas: { alto_m: 2 }, repeticiones: 1, densidad: "media", mezcla: "clasica", porque: "x",
      materiales: [material("rosado", "8634278183207", 0.5, "principal"), material("dorado rosa", "8634249838887", 0.5, "secundario")] },
  ],
});
const igualado = igualarParejas(plan, [["EST_02_COLUMNA", "EST_03_COLUMNA"]]);
assert.equal(igualado.igualadas.length, 1);
assert.equal(igualado.igualadas[0]!.modo, "union", "colores repartidos: las dos llevan todos");
const [izquierda, derecha] = [igualado.plan.estructuras[1]!, igualado.plan.estructuras[2]!];
assert.deepEqual(izquierda.materiales, derecha.materiales, "las dos columnas, iguales");
assert.deepEqual(izquierda.materiales.map((item) => [item.color, item.participacion]), [["dorado", 0.25], ["fucsia", 0.25], ["rosado", 0.25], ["dorado rosa", 0.25]]);
assert.equal(izquierda.materiales.filter((item) => item.rol_material === "principal").length, 1);
assert.deepEqual([izquierda.nombre, derecha.nombre, izquierda.ubicacion, derecha.ubicacion], ["Columna izquierda", "Columna derecha", "lateral_izquierdo", "lateral_derecho"], "nombres y lados intactos");
assert.deepEqual(igualado.plan.estructuras[0], plan.estructuras[0], "la guirnalda no se toca");
assert.ok(PlanDecoracionSchema.safeParse(igualado.plan).success, "el plan igualado pasa el esquema");
assert.equal(igualarParejas(igualado.plan, [["EST_02_COLUMNA", "EST_03_COLUMNA"]]).igualadas.length, 0, "idempotente");

// Una contiene a la otra (el modelo obedeció a medias): la que tiene todos presta sus materiales y medidas.
const aMedias = PlanDecoracionSchema.parse({ ...plan, estructuras: [plan.estructuras[0], { ...plan.estructuras[1]!, materiales: plan.estructuras[0]!.materiales, medidas: { alto_m: 2.2 } }, plan.estructuras[2]] });
const copia = igualarParejas(aMedias, [["EST_02_COLUMNA", "EST_03_COLUMNA"]]);
assert.equal(copia.igualadas[0]!.modo, "copia");
assert.equal(copia.igualadas[0]!.desde, "EST_02_COLUMNA");
assert.deepEqual(copia.plan.estructuras[2]!.materiales, plan.estructuras[0]!.materiales);
assert.deepEqual(copia.plan.estructuras[2]!.medidas, { alto_m: 2.2 });

// Una pareja de la foto conserva los colores de su elemento.
const deFoto = { ...plan, estructuras: plan.estructuras.map((estructura, indice) => (indice > 0 ? { ...estructura, referencia_element_id: `REF_01_E0${indice}` } : estructura)) };
const intacta = igualarParejas(deFoto, [["EST_02_COLUMNA", "EST_03_COLUMNA"]]);
assert.equal(intacta.igualadas.length, 0);
assert.equal(intacta.noIgualadas[0]!.motivo, "pieza de la foto");
assert.equal(intacta.plan, deFoto);

console.log("test-parejas-simetricas: OK — dos columnas de una misma línea salen iguales y con todos los colores");
