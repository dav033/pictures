import assert from "node:assert/strict";
import { extraerRestriccionesUsuario, MAX_TEXTO_ORIGINAL } from "../src/lib/plan/restricciones";
import { PlanDecoracionSchema, RestriccionesUsuarioSchema } from "../src/lib/plan/tipos";
import { evaluateSceneQa } from "../src/lib/ia/image-qa";
import type { SceneSpec } from "../src/lib/ia/scene-spec";
import { cajasDeEstructuras } from "../src/lib/plan/ubicaciones";

/**
 * Restricciones del cliente, contrato del plan, ubicaciones y QA de escena.
 *
 * Lo que este script probaba y ya no tiene sujeto (ADR-0023, paso 5): la
 * búsqueda global de paquetes (`optimizarCobertura`) y el reparto de la reserva
 * de merma entre grupos compatibles (`distribuirReservaProyecto`), los dos de
 * `src/lib/plan/optimizar-materiales.ts`. Son reglas de compra y su único dueño
 * es Python (`_optimizar_cobertura` y el reparto dentro de `_consolidate`, en
 * `services/ai-api/app/plan.py`). Con ellas se fue el contrato financiero del
 * incidente original, que era aritmética sobre tres literales y no ejercitaba
 * ningún módulo.
 *
 * Sin red ni proveedores.
 * Run: npx tsx --conditions=react-server scripts/test-plan-presupuesto.ts
 */

const restricciones = extraerRestriccionesUsuario("Necesito 2 arcos y 2 columnas, máximo $300.000, en dorado R-12.", {});
assert.deepEqual(restricciones.estructuras, [
  { tipo: "arco", repeticiones: 2, procedencia: "explicito", texto_original: "Necesito 2 arcos y 2 columnas, máximo $300.000, en dorado R-12.", polaridad: "obligatorio" },
  { tipo: "columna", repeticiones: 2, procedencia: "explicito", texto_original: "Necesito 2 arcos y 2 columnas, máximo $300.000, en dorado R-12.", polaridad: "obligatorio" },
]);
assert.equal(extraerRestriccionesUsuario("glamour en salón", {}).acabados.length, 0, "glamour no inventa un acabado duro");
// Regression: latex is the globo_latex material category, not a finish; as a
// finish restriction no material.acabado could satisfy it.
assert.deepEqual(extraerRestriccionesUsuario("Quiero un arco de globos látex rosados y blancos", {}).acabados, [], "látex no es acabado");
assert.deepEqual(extraerRestriccionesUsuario("globos latex reflex dorados y satin", {}).acabados.map((item) => item.valor).sort(), ["reflex", "satin"], "los acabados reales siguen siendo obligatorios");
assert.equal(restricciones.presupuesto?.techo_cop, 300000);
assert.equal(restricciones.tamanos[0]?.valor, "R-12");
assert.equal(extraerRestriccionesUsuario("Quiero 1 arco pequeño.", {}).estructuras[0]?.repeticiones, 1);
assert.equal(extraerRestriccionesUsuario("$50.000 a $100.000", {}).presupuesto?.techo_cop, 100000);
assert.deepEqual(extraerRestriccionesUsuario("dorado, sin negro y rosado", {}).colores.map((item) => item.valor), ["dorado", "rosa"]);

// Regression: the chat joins every user turn into one request. texto_original
// is bounded evidence (≤ MAX_TEXTO_ORIGINAL) around the fragment that justified
// each restriction, so a long multi-turn chat still confirms a plan and
// restrictions stated in an early turn are still extracted.
const todasLasEvidencias = (r: ReturnType<typeof extraerRestriccionesUsuario>): string[] => [
  ...(r.presupuesto ? [r.presupuesto.texto_original] : []),
  ...r.estructuras.map((item) => item.texto_original),
  ...r.colores.map((item) => item.texto_original),
  ...r.tamanos.map((item) => item.texto_original),
  ...r.acabados.map((item) => item.texto_original),
];
const turnosLargos = [
  "Hola, quiero decorar el salón comunal del edificio para una reunión familiar el sábado en la tarde. Necesito 2 columnas en dorado R-12 acabado satin.",
  "El salón tiene paredes claras, piso de madera y ventanales grandes hacia el jardín; llegan unos cuarenta invitados entre adultos y niños pequeños.",
  "No tengo medidas exactas del lugar, usa las medidas por defecto que manejan ustedes, y mi presupuesto es de 250 mil. Gracias por la ayuda con todo.",
];
const solicitudLarga = turnosLargos.join(" ");
assert.ok(solicitudLarga.length > 300, "el fixture debe superar el límite del contrato");
const largas = extraerRestriccionesUsuario(solicitudLarga, {});
assert.deepEqual(largas.estructuras.map((item) => [item.tipo, item.repeticiones]), [["columna", 2]], "estructura del primer turno");
assert.deepEqual(largas.colores.map((item) => item.valor), ["dorado"]);
assert.deepEqual(largas.tamanos.map((item) => item.valor), ["R-12"]);
assert.deepEqual(largas.acabados.map((item) => item.valor), ["satin"]);
assert.equal(largas.presupuesto?.techo_cop, 250000, "presupuesto del último turno");
for (const evidencia of todasLasEvidencias(largas)) {
  assert.ok(evidencia.length <= MAX_TEXTO_ORIGINAL, `evidencia acotada: ${evidencia.length}`);
  assert.equal(evidencia, evidencia.trim());
}
assert.match(largas.estructuras[0]!.texto_original, /2 columnas/, "la evidencia contiene el fragmento que justifica la estructura");
assert.match(largas.estructuras[0]!.texto_original, /…$/, "recorte explícito al final");
assert.doesNotMatch(largas.estructuras[0]!.texto_original, /^…/, "sin recorte inicial: el fragmento está al comienzo");
assert.match(largas.presupuesto!.texto_original, /presupuesto es de 250 mil/);
assert.match(largas.presupuesto!.texto_original, /^…/, "recorte explícito al inicio");
assert.doesNotMatch(largas.presupuesto!.texto_original, /…$/, "sin recorte final: el fragmento está al cierre");
assert.match(largas.acabados[0]!.texto_original, /satin/);
const planLargo = PlanDecoracionSchema.safeParse({
  plan_version: "1.0",
  plan_id: "11111111-1111-4111-8111-111111111111",
  concepto: { titulo: "Reunión", descripcion: "Columnas doradas.", paleta: ["dorado"] },
  espacio: { tipo: "salón", fuente: "supuesto" },
  estructuras: [{
    estructura_id: "EST_01_COLUMNA", nombre: "Columnas", tipo: "columna", rol_escena: "focal", ubicacion: "entrada",
    medidas: { ancho_m: 0.5, alto_m: 2 }, repeticiones: 2, densidad: "media", mezcla: "clasica",
    materiales: [{ product_id: "P", color: "dorado", acabado: "satin", participacion: 1, rol_material: "principal" }], porque: "Entrada",
  }],
  supuestos: [],
  restricciones: largas,
});
assert.equal(planLargo.success, true, `plan con conversación larga debe validar: ${planLargo.success ? "" : planLargo.error.issues.map((issue) => issue.message).join(" | ")}`);
assert.equal(RestriccionesUsuarioSchema.parse(largas).estructuras[0]?.texto_original, largas.estructuras[0]!.texto_original, "el schema no altera la evidencia");

// Boundaries: 240 chars stays verbatim; 241 chars gets a marker and ≤ 240.
const exacto = `Necesito 2 arcos. ${"x".repeat(MAX_TEXTO_ORIGINAL - "Necesito 2 arcos. ".length)}`;
assert.equal(exacto.length, MAX_TEXTO_ORIGINAL);
assert.equal(extraerRestriccionesUsuario(exacto, {}).estructuras[0]?.texto_original, exacto);
assert.equal(extraerRestriccionesUsuario(`  ${exacto}  `, {}).estructuras[0]?.texto_original, exacto, "espacios exteriores no cuentan");
const excedido = `${exacto}y`;
const evidenciaExcedida = extraerRestriccionesUsuario(excedido, {}).estructuras[0]!.texto_original;
// Two chars are reserved for markers even when only one side is cut.
assert.equal(evidenciaExcedida.length, MAX_TEXTO_ORIGINAL - 1);
assert.ok(evidenciaExcedida.startsWith("Necesito 2 arcos.") && evidenciaExcedida.endsWith("…"));
// A fragment in the middle is centered and cut on both sides.
const medio = `${"a".repeat(400)} quiero 3 guirnaldas ${"b".repeat(400)}`;
const evidenciaMedio = extraerRestriccionesUsuario(medio, {}).estructuras[0]!;
assert.equal(evidenciaMedio.repeticiones, 3);
assert.ok(evidenciaMedio.texto_original.startsWith("…") && evidenciaMedio.texto_original.endsWith("…"));
assert.match(evidenciaMedio.texto_original, /quiero 3 guirnaldas/);
assert.equal(evidenciaMedio.texto_original.length, MAX_TEXTO_ORIGINAL);
// Decomposed accents (NFD) shift normalized offsets; evidence still maps back.
const nfd = `${"Decoración para el salón ".normalize("NFD").repeat(12)}con 4 columnas`;
const evidenciaNfd = extraerRestriccionesUsuario(nfd, {}).estructuras[0]!.texto_original;
assert.match(evidenciaNfd, /4 columnas$/);
assert.ok(evidenciaNfd.length <= MAX_TEXTO_ORIGINAL);
// Emoji at a cut edge is never split into a lone surrogate.
const emoji = `${"🎈".repeat(200)} 2 arcos ${"🎈".repeat(200)}`;
const evidenciaEmoji = extraerRestriccionesUsuario(emoji, {}).estructuras[0]!.texto_original;
assert.ok(evidenciaEmoji.length <= MAX_TEXTO_ORIGINAL);
assert.doesNotMatch(evidenciaEmoji, /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/, "sin surrogates sueltos");
// Budget inferred from the brief on a long text uses the leading excerpt.
const inferido = extraerRestriccionesUsuario(`${"Quiero algo bonito para el salón. ".repeat(10)}`, { presupuesto: 90000 }).presupuesto!;
assert.equal(inferido.procedencia, "inferido");
assert.ok(inferido.texto_original.startsWith("Quiero algo bonito") && inferido.texto_original.endsWith("…"));
assert.ok(inferido.texto_original.length <= MAX_TEXTO_ORIGINAL);
assert.equal(extraerRestriccionesUsuario("   ", { presupuesto: 90000 }).presupuesto?.texto_original, "solicitud del cliente");
const cajas = cajasDeEstructuras([{
  estructura_id: "EST_01_ARCO",
  nombre: "Arcos",
  tipo: "arco",
  rol_escena: "focal",
  ubicacion: "arco_central",
  medidas: { ancho_m: 3, alto_m: 2 },
  repeticiones: 2,
  densidad: "media",
  mezcla: "clasica",
  materiales: [{ product_id: "P", color: "dorado", participacion: 1, rol_material: "principal" }],
  porque: "Foco",
}]);
assert.ok(cajas["EST_01_ARCO#1"] && cajas["EST_01_ARCO#2"]);
assert.notEqual(cajas["EST_01_ARCO#1"]!.bbox.x, cajas["EST_01_ARCO#2"]!.bbox.x);

// La QA no acepta el blueprint como evidencia: si falta una instancia física,
// el resultado debe fallar aunque la otra instancia sí esté presente.
const escena = {
  elements: [
    { element_id: "EST_01_ARCO#1" },
    { element_id: "EST_01_ARCO#2" },
  ],
} as SceneSpec;
const qa = evaluateSceneQa(escena, { presentElementIds: ["EST_01_ARCO#1"] });
assert.equal(qa.pass, false);
assert.deepEqual(qa.required_elements.map((item) => item.present), [true, false]);
assert.match(qa.retry_reasons.join(" | "), /EST_01_ARCO#2/);
const qaConExtra = evaluateSceneQa(escena, { presentElementIds: ["EST_01_ARCO#1", "EST_01_ARCO#2", "INVENTADA"] });
assert.equal(qaConExtra.pass, false);
assert.match(qaConExtra.retry_reasons.join(" | "), /INVENTADA/);

console.log("[PASS] restricciones del cliente, contrato del plan, ubicaciones repetidas y QA de escena");
