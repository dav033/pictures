/**
 * Imagen fiel a la foto en la vista guiada (2026-10-06, producción guiada-20261006-220821-ci54dg). Tres fallos:
 * 1. «Cambiar algo» / «Hazla más sencilla» / «Otros colores» rehacían el plan SIN la foto: el plan nuevo perdía la
 *    lectura (blueprint), la escenografía y las cajas, y la imagen salía inventada.
 * 2. Códigos hex partidos de su color en el texto de FLUX («satin pearlescent white, #F7F7F5 and …»). El hex pegado
 *    entre paréntesis a su color sí va («white (#F7F7F5)», pedido del dueño en 1043386); el suelto no.
 * 3. El orden de los colores en el texto no seguía la proporción del plan: un azul del 10 % abría la lista.
 *    Y `COLORES_REFERENCIA_OMITIDOS` exigía colores dudosos (luz morada leída como «azul pastel»).
 * Determinista, sin red ni coste. Run: npx tsx --conditions=react-server scripts/test/test-imagen-fiel-foto.ts
 */
import assert from "node:assert/strict";
import type { SceneSpec } from "../../src/lib/ia/escena/scene-spec";
import { buildVisualContext } from "../../src/lib/ia/escena/visual-context";
import { compileProductPrompt, sizeConfirmationsFromMaterialLines } from "../../src/lib/ia/kagutsuchi/producto-flux";
import { preflightFluxPrompt } from "../../src/lib/ia/kagutsuchi/preflight-flux";
import { limpiarTextoBase, palabrasSoloFlux } from "../../src/lib/ia/kagutsuchi/texto-base";
import { colorDeReferencia } from "../../src/lib/ia/kagutsuchi/vocabulario-base";
import { referenciaDelTitulo } from "../../src/lib/plan/referencia-sempertex";
import { cuerpoPlanGuiado, instruccionPlanGuiado, planActualDesdePlan, referenciaDelPlan } from "../../src/lib/ia/guiado/instruccion-plan";
import { normalizarPropuestaComposicion } from "../../src/lib/ia/guiado/propuesta-composicion";
import { extraerRestriccionesUsuario } from "../../src/lib/plan/restricciones";
import { extraerFiltrosDurosBusqueda } from "../../src/lib/rag/query-parser/hard-filters";
import { evidenciaColorFoto, PARTE_MINIMA_RECLAMO } from "../../src/lib/plan/reclamo-color-referencia";
import { CREATIVIDAD_POR_DEFECTO } from "../../src/lib/ia/escena/creatividad";

let fallos = 0;
function caso(nombre: string, prueba: () => void): void {
  try {
    prueba();
    console.log(`ok   ${nombre}`);
  } catch (error) {
    fallos += 1;
    console.error(`FALLA ${nombre}\n${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  }
}

/** Un hex que no va pegado entre paréntesis a su color («white (#F7F7F5)»): tras una coma, delante de «and» o solo. */
const HEX_SUELTO = /(?<![A-Za-z] \()#[0-9A-Fa-f]{6}\b|#[0-9A-Fa-f]{6}\b(?!\))/;

// ── 2. Hex solo pegado a su color ───────────────────────────────────────────────────────────────────────────────
// El dueño pidió el hex real del globo en el texto de FLUX (commit 1043386); lo que falló en producción fue el hex
// partido de su color («satin pearlescent white, #F7F7F5 and …»), que FLUX leía como otro globo.
caso("hex: el color de la referencia Sempertex son palabras con el hex pegado entre paréntesis (sin hex en cromados)", () => {
  for (const [titulo, acabado, esperado] of [
    ["B2b Globo Latex Redondo Satin Blanco", "satin pearlescent", "white (#F7F7F5)"],
    ["B2b Globo Latex Redondo Fashion Blanco", "matte", "white (#FFFFFF)"],
    ["B2b Globo Latex Redondo Cristal Transparente", "translucent", undefined],
    ["B2b Globo Latex Redondo Fashion Azul", "matte", "vivid cyan blue (#01B2E8)"],
    ["B2b Globo Latex Redondo Reflex Plata", "reflective chrome", "bright silver"],
  ] as const) {
    const referencia = referenciaDelTitulo(titulo, acabado);
    assert.ok(referencia, `sin referencia: ${titulo}`);
    const color = colorDeReferencia(referencia);
    assert.match(color, /^[a-z][a-z -]*[a-z](?: \(#[0-9A-F]{6}\))?$/, `${titulo} → ${color}: palabras y, si acaso, el hex pegado al final`);
    if (esperado) assert.equal(color, esperado, titulo);
    assert.doesNotMatch(color, HEX_SUELTO, `${titulo} → ${color}`);
  }
});

caso("hex: el limpiador deja el hex pegado y quita el suelto, sin dejar comas sueltas", () => {
  assert.equal(limpiarTextoBase("satin pearlescent white, #F7F7F5 and reflective chrome light pink latex balloons").texto, "satin pearlescent white and reflective chrome light pink latex balloons");
  assert.equal(limpiarTextoBase("made of #EEA5BE and silver balloons").texto, "made of silver balloons");
  assert.equal(limpiarTextoBase("pink #EEA5BE balloons").texto, "pink balloons");
  assert.equal(limpiarTextoBase("#EEA5BE").texto, "", "un hex solo");
  assert.equal(limpiarTextoBase("white, (#F7F7F5) and pink (#EEA5BE) balloons").texto, "white and pink (#EEA5BE) balloons", "entre paréntesis pero tras una coma: suelto");
  assert.deepEqual(palabrasSoloFlux("white #F7F7F5"), ["código de color hex suelto"], "el preflight lo ve como invariante");
  assert.deepEqual(palabrasSoloFlux(limpiarTextoBase("white (#F7F7F5), pink #EEA5BE").texto), []);
  // El pegado se queda tal cual y el preflight no lo cuenta.
  const pegado = "satin pearlescent white (#F7F7F5) and satin pearlescent light pink (#EEA5BE) latex balloons";
  assert.deepEqual(limpiarTextoBase(pegado), { texto: pegado, quitadas: [] });
  assert.deepEqual(palabrasSoloFlux(pegado), []);
  assert.equal(limpiarTextoBase("matte white (#FFFFFF) latex balloons").texto, "matte white (#FFFFFF) latex balloons");
  // Lo que no es un color hex se queda.
  assert.equal(limpiarTextoBase("two columns #1 and #2").texto, "two columns #1 and #2");
});

// ── 3. Orden y peso por la proporción del plan ──────────────────────────────────────────────────────────────────
// Ids elegidos para que el orden alfabético (el de antes) pusiera el azul primero.
const AZUL = "A_AZUL";
const BLANCO = "B_BLANCO";
const PLATA = "C_PLATA";
const titulos = new Map([
  [AZUL, "B2b Globo Latex Redondo Reflex Azul"],
  [BLANCO, "B2b Globo Latex Redondo Satin Blanco"],
  [PLATA, "B2b Globo Latex Redondo Reflex Plata"],
]);
function escenaColumna(): SceneSpec {
  return {
    schema_version: "1.0", generation_mode: "text_to_image",
    canvas: { aspect_ratio: "3:2", content_rect: { x: 0, y: 0, width: 1, height: 1 } },
    venue: { preserve: [], protected_regions: [], editable_regions: [] },
    elements: [{
      element_id: "COL", name: "Columna orgánica", category: "balloon_structure", source_type: "catalog_backed",
      catalog_product_id: PLATA, catalog_product_ids: [AZUL, BLANCO, PLATA], required: true,
      quantity: { mode: "exact", min: 1, max: 1 }, target_bbox: { x: 0.35, y: 0.1, width: 0.3, height: 0.8 }, depth_layer: 10,
      resolved_colors: ["azul", "blanco", "plateado"],
      visual_semantics: { structure_type: "columna", placement: "arco_central", design_role: "focal", repetition_group: "col", density: "media" },
      identity_constraints: [], relationships: [],
    }],
    positive_prompt: { required_elements: [], composition: [], venue_preservation: [], photorealistic_integration: [] },
    negative_prompt: { forbidden_elements: [], forbidden_venue_changes: [], forbidden_compositing_artifacts: [] },
    metadata: { created_by: "server_default", plan_hash: "imagen-fiel-foto" },
  } as SceneSpec;
}
const lineasPython = [
  { structure_id: "COL", product_id: PLATA, design_quantity: 48 },
  { structure_id: "COL", product_id: PLATA, variant_id: `${PLATA}-5`, design_quantity: 12 },
  { structure_id: "COL", product_id: BLANCO, design_quantity: 30 },
  { structure_id: "COL", product_id: AZUL, design_quantity: 10 },
];
const productos = [
  { id: PLATA, tamanoCodigo: "R-12", diamPulg: 12 },
  { id: `${PLATA}-5`, familiaId: PLATA, tamanoCodigo: "R-5", diamPulg: 5 },
  { id: BLANCO, tamanoCodigo: "R-12", diamPulg: 12 },
  { id: AZUL, tamanoCodigo: "R-12", diamPulg: 12 },
];

caso("orden: los colores van por la proporción de las líneas de Python y dicen su peso", () => {
  const escena = escenaColumna();
  const confirmaciones = sizeConfirmationsFromMaterialLines(lineasPython, productos);
  assert.ok(confirmaciones.every((item) => typeof item.units === "number"), "cada línea lleva sus globos");
  const compilado = compileProductPrompt({
    sceneSpec: escena,
    visualContext: buildVisualContext({ userRequest: "cumpleaños en salón" }),
    productCatalogTitles: titulos,
    sizeConfirmations: confirmaciones,
    officialStructures: new Map([["COL", "columna_asimetrica"]]),
  });
  const texto = compilado.prompt;
  const plata = texto.search(/silver/i);
  const blanco = texto.search(/white/i);
  const azul = texto.search(/blue/i);
  assert.ok(plata >= 0 && blanco >= 0 && azul >= 0, texto);
  assert.ok(plata < blanco && blanco < azul, `orden por proporción (60 % plata, 30 % blanco, 10 % azul): ${texto}`);
  assert.match(texto, /mostly [^,]*silver/i, texto);
  assert.match(texto, /accents of [^,]*blue/i, texto);
  assert.match(texto, /satin pearlescent white \(#F7F7F5\)/, `el blanco satinado lleva su hex pegado: ${texto}`);
  assert.doesNotMatch(texto, HEX_SUELTO, texto);
  assert.equal(preflightFluxPrompt({ sceneSpec: escena, clauses: compilado.clauses, prompt: texto }).ok, true, texto);
  console.log(`     ${texto.slice(0, 260)}…`);
});

caso("orden: sin unidades de Python el texto es el de siempre (sin «mostly»)", () => {
  const escena = escenaColumna();
  const compilado = compileProductPrompt({
    sceneSpec: escena,
    visualContext: buildVisualContext({ userRequest: "cumpleaños en salón" }),
    productCatalogTitles: titulos,
    sizeConfirmations: sizeConfirmationsFromMaterialLines(lineasPython.map(({ design_quantity: _cantidad, ...linea }) => linea), productos),
  });
  assert.doesNotMatch(compilado.prompt, /\bmostly\b|accents of/, compilado.prompt);
});

// ── 3b. COLORES_REFERENCIA_OMITIDOS no exige colores dudosos ni de poca proporción ─────────────────────────────
caso("reclamo: un color nombrado sin píxeles ni disposición (luz morada leída como azul pastel) no se exige", () => {
  const apariencia = {
    measured_colors: [{ color: "plateado", share: 0.62 }, { color: "rosado", share: 0.18 }, { color: "lila", share: 0.12 }],
    patron_color: { colores: ["rosado", "plateado", "blanco"], pesos: [30, 40, 30] },
  };
  const azul = evidenciaColorFoto(apariencia, "azul");
  assert.equal(azul.reclamable, false);
  assert.equal(azul.motivo, "sin_respaldo_en_la_foto");
  assert.equal(evidenciaColorFoto(apariencia, "rosado").reclamable, true, "medido 18 %");
  assert.equal(evidenciaColorFoto(apariencia, "blanco").reclamable, true, "la disposición lo pone en un tramo (30 %)");
  assert.equal(evidenciaColorFoto({ measured_colors: [{ color: "plateado", share: 0.9 }, { color: "dorado", share: 0.04 }] }, "dorado").motivo, "baja_proporcion");
  assert.equal(evidenciaColorFoto({ measured_colors: [{ color: "plateado", share: 0.9 }] }, "blanco").motivo, "neutro_confundible", "perla y plata no se separan en píxeles");
  assert.equal(evidenciaColorFoto({ measured_colors: [{ color: "plateado", share: 0.9 }] }, "transparente").reclamable, true, "un cristal no se mide en píxeles");
  assert.equal(evidenciaColorFoto({}, "azul").motivo, "sin_evidencia_medible", "sin medida ni disposición, la regla de siempre");
  assert.ok(PARTE_MINIMA_RECLAMO > 0 && PARTE_MINIMA_RECLAMO < 0.2);
});

// ── 1. Rehacer con foto conserva la referencia ──────────────────────────────────────────────────────────────────
const planFoto = {
  plan_hash: "h", approval_token: "t", compras: [],
  plan: {
    concepto: { titulo: "Plata y rosa", paleta: ["plateado", "rosado", "blanco", "transparente"] },
    estructuras: [
      { estructura_id: "EST_01_COLUMNA_ASIMETRICA", nombre: "Columna orgánica izquierda", tipo: "columna", estructura_oficial: "columna_asimetrica", repeticiones: 1, ubicacion: "lateral_izquierdo", referencia_element_id: "REF_01_E01", medidas: { alto_m: 2.4 } },
      { estructura_id: "EST_02_COLUMNA_ASIMETRICA", nombre: "Columna orgánica derecha", tipo: "columna", estructura_oficial: "columna_asimetrica", repeticiones: 1, ubicacion: "lateral_derecho", referencia_element_id: "REF_01_E02", medidas: { alto_m: 2.4 } },
    ],
    referencia_omitida: [
      { element_id: "REF_01_E03", motivo: "Es el fondo del salón.", motivo_tipo: "fuera_de_catalogo" },
      { element_id: "REF_01_E04", motivo: "Es la mesa.", motivo_tipo: "fuera_de_catalogo" },
    ],
  },
  estructuras: [
    { estructura_id: "EST_01_COLUMNA_ASIMETRICA", lineas: [{ color: "plateado", diam_pulg: 12, unidades: 40 }, { color: "rosado", diam_pulg: 5, unidades: 20 }, { color: "blanco", diam_pulg: 18, unidades: 20 }, { color: "transparente", diam_pulg: 12, unidades: 8 }] },
    { estructura_id: "EST_02_COLUMNA_ASIMETRICA", lineas: [{ color: "plateado", diam_pulg: 12, unidades: 40 }, { color: "rosado", diam_pulg: 5, unidades: 20 }, { color: "blanco", diam_pulg: 18, unidades: 20 }, { color: "transparente", diam_pulg: 12, unidades: 8 }] },
  ],
};
const referencia = referenciaDelPlan(planFoto)!;
const planAnterior = planActualDesdePlan(planFoto)!;
const mismosColores = ["plateado", "rosado", "blanco", "transparente"];
const sencilla = normalizarPropuestaComposicion({ frase: "Más sencilla", colores: mismosColores, piezas: [{ estructura: "columna_asimetrica", cantidad: 2 }] });

caso("rehacer: la referencia del plan trae cada pieza con su elemento y lo que el plan no arma", () => {
  assert.ok(referencia, "un plan de foto tiene referencia");
  assert.deepEqual(referencia.piezas.map((pieza) => [pieza.estructura, pieza.ubicacion, pieza.elemento]), [
    ["columna_asimetrica", "lateral_izquierdo", "REF_01_E01"],
    ["columna_asimetrica", "lateral_derecho", "REF_01_E02"],
  ]);
  assert.deepEqual(referencia.omitidos, [{ elemento: "REF_01_E03", motivoTipo: "fuera_de_catalogo" }, { elemento: "REF_01_E04", motivoTipo: "fuera_de_catalogo" }]);
  assert.equal(referenciaDelPlan({ plan: { estructuras: [{ estructura_oficial: "arco" }] } }), null, "un plan sin foto no la inventa");
});

caso("rehacer «Hazla más sencilla»: cada pieza conserva su elemento de la foto y la escenografía se declara igual", () => {
  const texto = instruccionPlanGuiado(sencilla, { planAnterior, referencia });
  assert.ok(/ubicacion: lateral_izquierdo; referencia_element_id: REF_01_E01;/.test(texto), texto);
  assert.ok(/ubicacion: lateral_derecho; referencia_element_id: REF_01_E02;/.test(texto), texto);
  assert.ok(texto.includes("ANALISIS_REFERENCIA_VISUAL") && texto.includes("conserva su composición"), texto);
  assert.ok(texto.includes("REF_01_E03 (fuera_de_catalogo), REF_01_E04 (fuera_de_catalogo)"), texto);
  assert.ok(!texto.includes("quitó") && !texto.includes("otros colores"), texto);
  assert.ok(!/columnas/.test(texto), "sin cantidades de piezas en palabras: /api/chat las leería como restricciones");
  // Las líneas de la foto no cambian lo que /api/chat lee como pedido del cliente.
  const sinFoto = instruccionPlanGuiado(sencilla, { planAnterior });
  const loQueLee = (instruccion: string) => JSON.parse(JSON.stringify(extraerRestriccionesUsuario(instruccion), (clave, valor: unknown) => (clave === "texto_original" ? undefined : valor))) as unknown;
  assert.deepEqual(loQueLee(texto), loQueLee(sinFoto));
  const filtros = extraerFiltrosDurosBusqueda(texto, { colores: mismosColores });
  const filtrosSinFoto = extraerFiltrosDurosBusqueda(sinFoto, { colores: mismosColores });
  assert.deepEqual([filtros.ocasiones, filtros.categorias, filtros.acabados, filtros.formas], [filtrosSinFoto.ocasiones, filtrosSinFoto.categorias, filtrosSinFoto.acabados, filtrosSinFoto.formas], JSON.stringify(filtros));
  assert.deepEqual([filtros.ocasiones, filtros.categorias], [[], []], JSON.stringify(filtros));
});

caso("rehacer: quitar una pieza la declara omitida; cambiar la oficial conserva el elemento por tipo y lado", () => {
  const una = normalizarPropuestaComposicion({ frase: "Solo una", colores: mismosColores, piezas: [{ estructura: "columna_asimetrica", cantidad: 1, ubicacion: "lateral_izquierdo" }] });
  const texto = instruccionPlanGuiado(una, { planAnterior, referencia });
  assert.ok(texto.includes("referencia_element_id: REF_01_E01"), texto);
  assert.ok(texto.includes("motivo_tipo decision_de_diseno: REF_01_E02."), texto);
  const clasicas = normalizarPropuestaComposicion({ frase: "Clásicas", colores: mismosColores, piezas: [{ estructura: "columna", cantidad: 2 }] });
  const otra = instruccionPlanGuiado(clasicas, { planAnterior, referencia });
  assert.ok(/ubicacion: lateral_izquierdo; referencia_element_id: REF_01_E01;/.test(otra) && /ubicacion: lateral_derecho; referencia_element_id: REF_01_E02;/.test(otra), otra);
  const conArco = normalizarPropuestaComposicion({ frase: "Con arco", colores: mismosColores, piezas: [{ estructura: "columna_asimetrica", cantidad: 2 }, { estructura: "arco_asimetrico", cantidad: 1 }] });
  const sumada = instruccionPlanGuiado(conArco, { planAnterior, referencia });
  assert.ok(/estructura_oficial: arco_asimetrico; estructura_id: EST_03_ARCO_ASIMETRICO; repeticiones: 1/.test(sumada), "la pieza nueva no materializa ningún elemento");
});

caso("rehacer «Otros colores»: los colores nuevos mandan, la composición de la foto se conserva", () => {
  const otros = normalizarPropuestaComposicion({ frase: "Azul y dorado", colores: ["azul", "dorado"], piezas: [{ estructura: "columna_asimetrica", cantidad: 2 }] });
  const texto = instruccionPlanGuiado(otros, { planAnterior, referencia });
  assert.ok(texto.includes("El cliente pidió otros colores: los colores de esta lista mandan sobre los de la foto"), texto);
  assert.ok(texto.includes("referencia_element_id: REF_01_E01") && texto.includes("usa EXACTAMENTE estos colores: azul, dorado"), texto);
});

caso("rehacer: el cuerpo de /api/chat lleva la foto, la lectura y la creatividad, como la clásica", () => {
  const blueprint = { schema_version: "2.0", elements: [{ element_id: "REF_01_E01" }] };
  const imagen = { base64: "Zm90bw==", mime: "image/jpeg" };
  const conFoto = cuerpoPlanGuiado(sencilla, { reintento: false, planAnterior, foto: { blueprint, imagen, referencia } });
  assert.equal(conFoto.referenceBlueprint, blueprint, "conserva el blueprint");
  assert.deepEqual(conFoto.imagenesReferencia, [imagen]);
  assert.equal(conFoto.creatividad, CREATIVIDAD_POR_DEFECTO);
  assert.equal(conFoto.piezasIndividuales, true);
  assert.ok(conFoto.messages[0]!.content.includes("referencia_element_id: REF_01_E01"));
  // Sin la foto en memoria (tras recargar) viaja la lectura sola.
  const sinImagen = cuerpoPlanGuiado(sencilla, { reintento: false, planAnterior, foto: { blueprint, referencia } });
  assert.equal(sinImagen.referenceBlueprint, blueprint);
  assert.equal("imagenesReferencia" in sinImagen, false);
  // Un plan sin foto: el cuerpo de siempre.
  const sinFoto = cuerpoPlanGuiado(sencilla, { reintento: false, planAnterior, foto: null });
  assert.deepEqual(Object.keys(sinFoto).sort(), ["brief", "messages", "piezasIndividuales", "schema_version"]);
});

if (fallos) {
  console.error(`test-imagen-fiel-foto: ${fallos} fallo(s)`);
  process.exit(1);
}
console.log("test-imagen-fiel-foto: ok");
