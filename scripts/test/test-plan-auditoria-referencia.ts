/**
 * Findings of the reference-image audit (2026-09-14) on the plan builder:
 *
 * - Alta #1: figures, bouquets and kits quoted with 1 balloon. `unidades_declaradas`
 *   are catalog units for the whole piece; every declared material is bought and
 *   an official structure has a realistic minimum.
 * - Alta #3: dominant colors of the photo silently lost. The plan carries the
 *   colors of the referenced element and the resolver records the substitution.
 * - Media #4: a photo without balloons at a faithful creativity level: the tool
 *   refuses to build and the assistant asks which pieces the customer wants.
 *
 * No network, no database, no providers. El plan lo resuelve Python desde el
 * paso 5 del ADR-0023: esa llamada la responde un doble de transporte
 * (scripts/lib/resolutor-python-falso.ts). El sujeto de este fichero son las
 * reglas de referencia que aplica Next antes y después de resolver.
 * Run: npx tsx --conditions=react-server scripts/test/test-plan-auditoria-referencia.ts
 */
import assert from "node:assert/strict";
import type { Pool } from "pg";
import { colorCatalogoMasCercano } from "../../src/lib/rag/catalog/similitud-color";
import { instalarResolutorPythonFalso, prepararEntornoPythonFalso, veredictoColoresReferencia, SNAPSHOT_FALSO } from "../lib/resolutor-python-falso";

prepararEntornoPythonFalso();

let casos = 0;
function ok(nombre: string): void {
  casos += 1;
  console.log(`ok ${casos} - ${nombre}`);
}

async function main(): Promise<void> {
  const { crearEstadoConversacion, crearRegistroHerramientas } = await import("../../src/lib/ia/herramientas/registro-herramientas");
  const { detectarJergaInterna } = await import("../../src/lib/ia/omoikane/jerga-interna");
  const { construirSistema } = await import("../../src/lib/ia/omoikane/prompt-sistema");
  const { HERRAMIENTAS_PLAN } = await import("../../src/lib/ia/herramientas/herramientas");
  const restricciones = await import("../../src/lib/plan/restricciones");
  const { ReferenceBlueprintV2Schema } = await import("../../src/lib/ia/referencia/reference-blueprint");
  const { PlanDecoracionSchema } = await import("../../src/lib/plan/tipos");
  type ProductoCandidato = import("../../src/lib/rag/chat/buscar").ProductoCandidato;
  type Blueprint = import("../../src/lib/ia/referencia/reference-blueprint").ReferenceBlueprintV2;

  const elemento = (id: string, imagen: string, name: string, category: string, colores: string[], extra: Record<string, unknown> = {}) => ({
    element_id: id, source_image_id: imagen, name, category,
    scene_role: "midground", detection_confidence: 0.9, visible_evidence: name,
    reference_bbox: { x: 0.1, y: 0.1, width: 0.3, height: 0.8 }, depth_layer: 1,
    include_policy: "include", approved: true, source_type: "reference_only",
    quantity: { mode: "exact", min: 1, max: 1 },
    appearance: { observed_colors: colores, resolved_colors: [], color_policy: "match_reference", material: "latex", shape: name, composition: "mixed" },
    relationships: [], uncertainties: [],
    ...extra,
  });
  const blueprintDe = (imagenes: string[], elementos: unknown[]): Blueprint => ReferenceBlueprintV2Schema.parse({
    schema_version: "2.0",
    source_images: imagenes.map((image_id) => ({ image_id, approved_roles: ["composition_reference"] })),
    elements: elementos,
    composition: { focal_point: "mesa", density: "moderate", symmetry: "unknown", negative_space: [] },
    palette: { observed: [], priority: [] },
    unresolved_decisions: [],
  });

  // ---------------------------------------------------------------------------
  // Media #4: photo without balloon structures.
  const soloFlores = blueprintDe(["REF_01"], [elemento("REF_01_E01", "REF_01", "White flower arrangement", "floral", ["white", "green"])]);
  const pedidoFlores = "Quiero algo así para mi boda";
  const sinGlobos = restricciones.validarReferenciaSinGlobos(soloFlores, pedidoFlores, 0);
  assert.equal(sinGlobos.length, 1, "fiel + foto sin globos + sin piezas nombradas → preguntar");
  assert.deepEqual(restricciones.validarReferenciaSinGlobos(soloFlores, "Quiero algo así para mi boda, con un arco y dos columnas", 0), [], "the customer named the pieces");
  assert.deepEqual(restricciones.validarReferenciaSinGlobos(soloFlores, "Algo así con un bouquet de globos por mesa", 0), [], "a bouquet is a named piece");
  assert.deepEqual(restricciones.validarReferenciaSinGlobos(soloFlores, pedidoFlores, 1), [], "a level with extra pieces may propose them");
  assert.deepEqual(restricciones.validarReferenciaSinGlobos(undefined, pedidoFlores, 0), [], "no photo, no rule");
  const soloEspacio = ReferenceBlueprintV2Schema.parse({ ...soloFlores, source_images: [{ image_id: "REF_01", approved_roles: ["venue_base"] }] });
  assert.deepEqual(restricciones.validarReferenciaSinGlobos(soloEspacio, pedidoFlores, 0), [], "a photo of the venue is not a design to copy");
  const conGlobos = blueprintDe(["REF_01"], [elemento("REF_01_E01", "REF_01", "Balloon column", "balloon_structure", ["gold"])]);
  assert.deepEqual(restricciones.validarReferenciaSinGlobos(conGlobos, pedidoFlores, 0), [], "a photo with balloons defines the composition");
  assert.deepEqual(detectarJergaInterna(restricciones.MENSAJE_CLIENTE_REFERENCIA_SIN_GLOBOS), [], restricciones.MENSAJE_CLIENTE_REFERENCIA_SIN_GLOBOS);
  assert.match(restricciones.MENSAJE_CLIENTE_REFERENCIA_SIN_GLOBOS, /\?/, "the customer message asks");
  assert.match(restricciones.MENSAJE_CLIENTE_REFERENCIA_SIN_GLOBOS, /fotos de ejemplo/);
  ok("foto sin globos: regla pura (nivel sin extras, piezas no nombradas)");

  const pool = { query: async () => ({ rows: [] }) } as unknown as Pool;
  const candidato = (productId: string, categoria: string | null, color: string, variantes: Array<{ variantId: string; diamPulg: number | null }>): ProductoCandidato => ({
    productId, titulo: productId, categoria, colores: [color], acabados: [], ocasiones: [], disponible: true, imagen: null,
    variantes: variantes.map((variante) => ({ variantId: variante.variantId, sku: null, titulo: null, precio: 5000, disponible: true, codigoTamano: variante.diamPulg ? `R-${variante.diamPulg}` : null, diamPulg: variante.diamPulg, forma: variante.diamPulg ? "redondo" : null, colores: [color] })),
  });
  const herramienta = (solicitud: string, candidatos: ProductoCandidato[], blueprint: Blueprint | undefined, creatividad: 0 | 1 | 2 | 3 | 4 | 5 = 0, filas: unknown[] = [], imagenes: Record<string, string> = {}) => {
    instalarResolutorPythonFalso({ veredicto: veredictoColoresReferencia, imagenes });
    const estado = crearEstadoConversacion({}, solicitud, blueprint);
    estado.ragCatalogSnapshotId = SNAPSHOT_FALSO;
    estado.ragCandidatos = candidatos;
    for (const c of candidatos) {
      estado.ragIdsRecuperados.add(c.productId);
      estado.ragVariantIdsRecuperados.set(c.productId, new Set(c.variantes.map((v) => v.variantId)));
    }
    const poolConFilas = { query: async () => ({ rows: filas }) } as unknown as Pool;
    return { estado, confirmar: crearRegistroHerramientas(estado, { pool: filas.length ? poolConFilas : pool, creatividad }).confirmar_plan_decoracion! };
  };
  const llamada = { nombre: "confirmar_plan_decoracion", args: {} };
  const arcoBlanco = {
    estructura_id: "EST_01_ARCO", nombre: "Arco blanco", tipo: "arco", rol_escena: "focal", ubicacion: "arco_central",
    medidas: { ancho_m: 2.5, alto_m: 2.2 }, repeticiones: 1, densidad: "media", mezcla: "clasica",
    materiales: [{ product_id: "P-BLANCO", participacion: 1, rol_material: "principal", color: "blanco" }], porque: "Prueba",
  };
  const argsArco = { concepto: { titulo: "Boda", descripcion: "Arco blanco", paleta: ["blanco"] }, espacio: { tipo: "salón", fuente: "supuesto" }, estructuras: [arcoBlanco] };
  const blancos = [candidato("P-BLANCO", "globo_latex", "blanco", [{ variantId: "V-BLANCO-12", diamPulg: 12 }])];
  const pregunta = await herramienta(pedidoFlores, blancos, soloFlores, 0).confirmar(argsArco, llamada) as Record<string, unknown>;
  assert.equal(pregunta.ok, false, JSON.stringify(pregunta).slice(0, 300));
  assert.equal(pregunta.status, "REFERENCIA_SIN_GLOBOS", JSON.stringify(pregunta).slice(0, 300));
  assert.match(String(pregunta.accion_requerida), /preg[uú]nta/i);
  assert.match(String(pregunta.accion_requerida), /foto de ejemplo/);
  assert.equal(pregunta.mensaje_cliente, restricciones.MENSAJE_CLIENTE_REFERENCIA_SIN_GLOBOS);
  const nombrado = await herramienta(`${pedidoFlores}. Quiero un arco blanco`, blancos, soloFlores, 0).confirmar(argsArco, llamada) as Record<string, unknown>;
  assert.notEqual(nombrado.status, "REFERENCIA_SIN_GLOBOS", "after the customer names the pieces the plan goes on");
  // Deadlock regression: once the assistant said the photo has no balloons, the
  // customer's reply is the answer even without naming a piece ("lo que recomiendes").
  const historialRespondido = [
    { rol: "usuario" as const, texto: pedidoFlores },
    { rol: "asistente" as const, texto: "Tu foto no tiene decoración con globos. ¿Qué piezas te gustaría?" },
    { rol: "usuario" as const, texto: "No sé, lo que tú me recomiendes en blanco" },
  ];
  assert.equal(restricciones.referenciaSinGlobosYaPreguntada(historialRespondido), true);
  assert.equal(restricciones.referenciaSinGlobosYaPreguntada(historialRespondido.slice(0, 2)), false, "asked but not answered yet");
  assert.equal(restricciones.referenciaSinGlobosYaPreguntada([{ rol: "usuario", texto: pedidoFlores }, { rol: "asistente", texto: "Claro, ¿para cuántas personas es?" }, { rol: "usuario", texto: "50" }]), false, "an unrelated question does not count");
  assert.equal(restricciones.referenciaSinGlobosYaPreguntada([{ rol: "usuario", texto: pedidoFlores }, { rol: "asistente", texto: "No veo globos en tu foto, ¿qué piezas quieres?" }, { rol: "usuario", texto: "sorpréndeme" }]), true, "paraphrase");
  assert.deepEqual(restricciones.validarReferenciaSinGlobos(soloFlores, `${pedidoFlores} No sé, lo que tú me recomiendes en blanco`, 0, true), [], "answered: the plan goes on");
  const { estado: estadoRespondido, confirmar: confirmarRespondido } = herramienta(`${pedidoFlores} No sé, lo que tú me recomiendes en blanco`, blancos, soloFlores, 0);
  estadoRespondido.referenciaSinGlobosPreguntada = true;
  const respondido = await confirmarRespondido(argsArco, llamada) as Record<string, unknown>;
  assert.notEqual(respondido.status, "REFERENCIA_SIN_GLOBOS", "the tool does not ask twice");
  assert.match(construirSistema({ ragEnabled: true }), /FOTO SIN GLOBOS/, "the system prompt states the rule");
  assert.match(construirSistema({ ragEnabled: true }), /piezas iguales en la foto" [\s\S]*repeticiones[\s\S]*nunca un número de globos/, "blueprint quantity is pieces, never balloons");
  const repeticionesSchema = (HERRAMIENTAS_PLAN[0]!.esquema as { properties: { estructuras: { items: { properties: { repeticiones: { description?: string } } } } } }).properties.estructuras.items.properties.repeticiones;
  assert.match(repeticionesSchema.description ?? "", /No es un número de globos/);
  ok("foto sin globos: confirmar_plan_decoracion pide aclaración y el prompt lo refleja");

  // ---------------------------------------------------------------------------
  // Alta #1: declared units.
  const unidades = HERRAMIENTAS_PLAN[0]!.esquema as { properties: { estructuras: { items: { properties: { unidades_declaradas: { description?: string } } } } } };
  const descripcion = unidades.properties.estructuras.items.properties.unidades_declaradas.description ?? "";
  assert.match(descripcion, /globos/, "the tool schema says what a unit is");
  assert.match(descripcion, /no el número de figuras/);
  const { ESTRUCTURAS_OFICIALES } = await import("../../src/lib/plan/estructuras-oficiales");
  assert.ok((ESTRUCTURAS_OFICIALES.figura.unidadesMinimasPorInstancia ?? 0) >= 20, "a figure needs a realistic minimum");
  assert.ok((ESTRUCTURAS_OFICIALES.bouquet.unidadesMinimasPorInstancia ?? 0) >= 5, "a bouquet needs a realistic minimum");

  const figura = (unidadesDeclaradas: number, repeticiones = 1, materiales = 4) => ({
    estructura_id: "EST_02_FIGURA", nombre: "Figura con globos jirafa", tipo: "kit", rol_escena: "soporte", ubicacion: "lateral_derecho",
    medidas: {}, repeticiones, densidad: "media", mezcla: "clasica", estructura_oficial: "figura", unidades_declaradas: unidadesDeclaradas, porque: "Prueba",
    materiales: ["negro", "amarillo", "naranja", "blanco"].slice(0, materiales).map((color, index) => ({ product_id: `P-${color.toUpperCase()}`, variant_id: `V-${color.toUpperCase()}-9`, participacion: 1 / materiales, rol_material: index === 0 ? "principal" : "secundario", color })),
  });
  const planFigura = (estructura: ReturnType<typeof figura>) => PlanDecoracionSchema.parse({
    plan_version: "1.0", plan_id: "13131313-1313-4131-8131-131313131313",
    concepto: { titulo: "Safari", descripcion: "Figuras", paleta: ["negro", "amarillo"] },
    espacio: { tipo: "salón", fuente: "supuesto" }, estructuras: [arcoBlanco, estructura], supuestos: [],
  });
  const categoriasFigura = new Map<string, string | null>(["NEGRO", "AMARILLO", "NARANJA", "BLANCO"].map((color) => [`P-${color}`, "globo_latex"]));
  const f13 = restricciones.validarUnidadesDeclaradas(planFigura(figura(1, 2)), categoriasFigura);
  assert.ok(f13.length >= 1, "F13: two figures with 4 materials and 1 unit are rejected");
  assert.match(f13.join(" "), /Figura con globos/);
  for (const error of f13) assert.deepEqual(detectarJergaInterna(error), [], error);
  assert.match(restricciones.validarUnidadesDeclaradas(planFigura(figura(30, 2)), categoriasFigura).join(" "), /40/, "the minimum counts every repetition");
  assert.deepEqual(restricciones.validarUnidadesDeclaradas(planFigura(figura(48, 2)), categoriasFigura), [], "48 balloons for two figures are enough");
  const kitEmpaquetado = new Map<string, string | null>(["NEGRO", "AMARILLO", "NARANJA", "BLANCO"].map((color) => [`P-${color}`, "kit"]));
  assert.deepEqual(restricciones.validarUnidadesDeclaradas(planFigura(figura(4, 1)), kitEmpaquetado), [], "a packaged kit counts kits, not balloons");
  assert.equal(restricciones.validarUnidadesDeclaradas(planFigura(figura(3, 1)), kitEmpaquetado).length, 1, "but every declared material must be bought");
  assert.deepEqual(restricciones.validarUnidadesDeclaradas(planFigura(figura(4, 1)), new Map()), [], "an unknown category does not block the minimum");
  ok("unidades declaradas: significado documentado, mínimo por estructura oficial y ≥ nº de materiales");

  const filasFigura = ["NEGRO", "AMARILLO", "NARANJA", "BLANCO"].map((color) => ({
    product_id: `P-${color}`, variant_id: `V-${color}-9`, sku: null, sku_original: null, source_snapshot_id: null, source_variant_id: null, inventory_quantity: null, unidades_inferidas: null,
    producto_titulo: `Globo ${color}`, variante_titulo: "R-9", precio: 1000, unidades_paq: 50, disponible: true, producto_disponible: true,
    codigo_tamano: "R-9", forma: "redondo", diam_pulg: 9, colores_producto: [color.toLowerCase()], colores_variante: [color.toLowerCase()], acabados_producto: [], descripcion: null, imagen: null,
  }));
  const candidatosFigura = [
    ...blancos,
    ...["NEGRO", "AMARILLO", "NARANJA"].map((color) => candidato(`P-${color}`, "globo_latex", color.toLowerCase(), [{ variantId: `V-${color}-9`, diamPulg: 9 }])),
  ];
  candidatosFigura[0] = candidato("P-BLANCO", "globo_latex", "blanco", [{ variantId: "V-BLANCO-12", diamPulg: 12 }, { variantId: "V-BLANCO-9", diamPulg: 9 }]);
  const argsFigura = { ...argsArco, estructuras: [arcoBlanco, figura(1, 2)] };
  const rechazoFigura = await herramienta("Fiesta safari con un arco blanco y dos figuras de jirafa", candidatosFigura, undefined, 2, filasFigura).confirmar(argsFigura, llamada) as Record<string, unknown>;
  assert.equal(rechazoFigura.ok, false, JSON.stringify(rechazoFigura).slice(0, 400));
  assert.equal(rechazoFigura.status, "UNIDADES_INSUFICIENTES", JSON.stringify(rechazoFigura).slice(0, 400));
  assert.match(String(rechazoFigura.accion_requerida), /unidades_declaradas/);
  assert.deepEqual(detectarJergaInterna(String(rechazoFigura.mensaje_cliente)), [], String(rechazoFigura.mensaje_cliente));
  ok("confirmar_plan_decoracion rechaza la figura cotizada con 1 globo (F13)");

  // Plan de una sola figura, reutilizado más abajo por las medidas del espacio.
  const planSoloFigura = PlanDecoracionSchema.parse({
    plan_version: "1.0", plan_id: "14141414-1414-4141-8141-141414141414",
    concepto: { titulo: "Safari", descripcion: "Figura", paleta: ["negro"] }, espacio: { tipo: "salón", fuente: "supuesto" },
    estructuras: [{ ...figura(1, 2), rol_escena: "focal" }], supuestos: [],
  });

  // Aquí vivían dos bloques sobre el REPARTO de unidades entre los materiales de
  // una figura: que ningún material declarado se quede en 0 y que el reparto por
  // resto mayor (0,55/0,45 → 6/4; 0,9/0,05/0,05 → 8/1/1) no cambie, porque entra
  // en `plan_hash`. Los dos llamaban al resolutor TypeScript, que el paso 5 del
  // ADR-0023 borró. El reparto es una regla de conteo y su único dueño es Python:
  // lo fijan los vectores dorados 14-figura-cuatro-materiales y
  // 28-figura-repetida-reparto-inexacto, que recorre `test_plan_parity.py`.
  // Rehacerlos aquí contra un doble sería afirmar la aritmética del propio doble.

  // ---------------------------------------------------------------------------
  // Alta #3: dominant colors of the photo.
  const f03 = elemento("REF_01_E01", "REF_01", "Lilac balloon arch", "balloon_structure", ["lilac", "white", "silver"]);
  const f06 = elemento("REF_02_E01", "REF_02", "Brown balloon column", "balloon_structure", ["brown", "royal blue", "silver", "gold"]);
  const dosFotos = blueprintDe(["REF_01", "REF_02"], [f03, f06]);
  const planDosFotos = PlanDecoracionSchema.parse({
    plan_version: "1.0", plan_id: "06060606-0606-4060-8060-060606060606",
    concepto: { titulo: "Dos fotos", descripcion: "Arco y columna", paleta: ["lila"] },
    espacio: { tipo: "salón", fuente: "foto" },
    estructuras: [
      { ...arcoBlanco, materiales: [{ product_id: "P-LILA", participacion: 1, rol_material: "principal", color: "lila" }], referencia_element_id: "REF_01_E01", colores_referencia: ["morado"] },
      { ...arcoBlanco, estructura_id: "EST_02_COLUMNA", nombre: "Columna", tipo: "columna", rol_escena: "soporte", ubicacion: "lateral_izquierdo", medidas: { alto_m: 1.8 }, materiales: [{ product_id: "P-LILA", participacion: 1, rol_material: "principal", color: "lila" }], referencia_element_id: "REF_02_E01" },
    ],
    supuestos: [],
  });
  const conColores = restricciones.aplicarColoresReferencia(planDosFotos, dosFotos);
  assert.deepEqual(conColores.estructuras[0]!.colores_referencia, ["lila", "blanco", "plateado"], "the arch uses the palette of its own photo (and the server overwrites the model)");
  assert.deepEqual(conColores.estructuras[1]!.colores_referencia, ["cafe", "azul", "plateado"], "the column uses the palette of the second photo, first three known colors");
  assert.equal(restricciones.aplicarColoresReferencia({ ...planDosFotos, estructuras: [{ ...planDosFotos.estructuras[0]!, referencia_element_id: undefined }] }, dosFotos).estructuras[0]!.colores_referencia, undefined, "no reference, no colors");
  assert.equal(restricciones.aplicarColoresReferencia(planDosFotos, undefined).estructuras[0]!.colores_referencia, undefined, "no blueprint, no colors");
  ok("colores de la foto: cada estructura toma la paleta de la foto de su referencia");

  const { coloresDominantesReferencia, sustitucionesColorReferencia, acabadoDeEtiqueta, coloresConAcabadoReferencia } = await import("../../src/lib/plan/colores-referencia");
  // One observed label is one color: a shade named with two color words must not
  // become two photo colors (false "the photo shows green" notices for mint).
  assert.deepEqual(coloresDominantesReferencia(["mint green"]), ["menta"]);
  assert.deepEqual(coloresDominantesReferencia(["wine red", "silver grey"]), ["burdeos", "plateado"]);
  assert.deepEqual(coloresDominantesReferencia(["salmon pink", "champagne gold", "ivory white"]), ["coral", "champagne", "crema"]);
  assert.deepEqual(coloresDominantesReferencia(["white and gold", "royal blue/silver"]), ["blanco", "dorado", "azul"], "a label that joins colors keeps each of them");
  assert.deepEqual(coloresDominantesReferencia(["transparent with gold confetti"]), ["transparente", "dorado"]);
  assert.deepEqual(coloresDominantesReferencia(["charcoal grey", "rose gold"]), ["gris", "dorado rosa"]);
  assert.deepEqual(sustitucionesColorReferencia("EST_01", coloresDominantesReferencia(["mint green"]), ["menta"]), [], "a mint photo quoted in mint loses nothing");
  const faltantes = sustitucionesColorReferencia("EST_02_COLUMNA", ["cafe", "azul", "plateado"], ["lila", "lila", "Plateado"]);
  assert.deepEqual(faltantes.map((item) => item.pedido), ["cafe", "azul"], "silver is covered, brown and blue are lost");
  assert.equal(faltantes[0]!.entregado, "lila, plateado");
  assert.match(faltantes[0]!.motivo, /foto/);
  for (const item of faltantes) assert.deepEqual(detectarJergaInterna(item.motivo), [], item.motivo);
  assert.deepEqual(sustitucionesColorReferencia("EST_01_ARCO", ["lila", "blanco"], ["blanco", "lila"]), [], "every photo color is in the plan");
  assert.deepEqual(sustitucionesColorReferencia("EST_01_ARCO", ["lila"], []), [], "an uncovered structure is reported as uncovered, not as a color change");
  ok("colores de la foto: comprobación determinista contra las líneas compradas");

  // 2026-09-29: el acabado viaja con SU color. La pared "Mr & Mrs" (blush
  // perlado + dorado cromado + blanco mate) se compró entera en Reflex porque
  // el acabado era una inferencia del modelo para toda la pieza.
  assert.equal(acabadoDeEtiqueta("chrome gold"), "reflex");
  assert.equal(acabadoDeEtiqueta("pearl blush pink"), "satin");
  assert.equal(acabadoDeEtiqueta("matte white"), "mate");
  assert.equal(acabadoDeEtiqueta("light pink"), undefined, "silence about finish is not 'mate'");
  assert.deepEqual(
    coloresConAcabadoReferencia(["pearl blush pink", "chrome gold", "matte white"]).map((item) => [item.color, item.acabado]),
    [["rosado", "satin"], ["dorado", "reflex"], ["blanco", "mate"]],
    "cada color se lleva el acabado de su propia etiqueta, no el del vecino",
  );
  ok("colores de la foto: el acabado viaja pegado a su color");

  const filasColumna = [{
    product_id: "P-LILA", variant_id: "V-LILA-12", sku: null, sku_original: null, source_snapshot_id: null, source_variant_id: null, inventory_quantity: null, unidades_inferidas: null,
    producto_titulo: "Globo lila", variante_titulo: "R-12", precio: 1000, unidades_paq: 50, disponible: true, producto_disponible: true,
    codigo_tamano: "R-12", forma: "redondo", diam_pulg: 12, colores_producto: ["lila"], colores_variante: ["lila"], acabados_producto: [], descripcion: null, imagen: null,
  }];
  const columnaSola = blueprintDe(["REF_02"], [f06]);
  const argsColumna = {
    concepto: { titulo: "Columna", descripcion: "Columna de la foto", paleta: ["lila"] }, espacio: { tipo: "salón", fuente: "foto" },
    estructuras: [{ ...arcoBlanco, estructura_id: "EST_01_COLUMNA", nombre: "Columna", tipo: "columna", ubicacion: "lateral_izquierdo", medidas: { alto_m: 1.8 }, materiales: [{ product_id: "P-LILA", participacion: 1, rol_material: "principal", color: "lila" }], referencia_element_id: "REF_02_E01", colores_referencia: ["lila"] }],
  };
  const { estado: estadoColumna, confirmar: confirmarColumna } = herramienta("Quiero la columna de la foto", [candidato("P-LILA", "globo_latex", "lila", [{ variantId: "V-LILA-12", diamPulg: 12 }])], columnaSola, 2, filasColumna);
  const confirmada = await confirmarColumna(argsColumna, llamada) as Record<string, unknown>;
  assert.equal(confirmada.ok, true, JSON.stringify(confirmada).slice(0, 500));
  const sustituciones = confirmada.sustituciones as Array<{ pedido: string }>;
  // The 4th color of the column (gold) is shown to the customer as a photo color
  // too, so it is a notice as well (E2E 2026-09-15 D5: no silent loss past the 3 dominant ones).
  assert.deepEqual(sustituciones.map((item) => item.pedido), ["cafe", "azul", "plateado", "dorado"], "the lost photo colors are recorded as substitutions");
  assert.deepEqual(estadoColumna.planResuelto?.plan.estructuras[0]?.colores_referencia, ["cafe", "azul", "plateado", "dorado"], "the signed plan carries the photo colors, not the model's");
  const avisos = confirmada.avisos_cliente as string[];
  assert.equal(avisos.length, 4, "the chat receives one notice per lost color");
  assert.match(String(confirmada.accion_requerida ?? ""), /avisos_cliente/, "the model is told it must tell the customer");
  ok("confirmar_plan_decoracion registra los colores perdidos y obliga a avisar");

  // ---------------------------------------------------------------------------
  // E2E 2026-09-14 (D1): "Semiarcos rosa y plata" quoted 100 % transparent with
  // three color notices while the catalog had pink and silver balloons.
  const { coloresReferenciaOmitidos, productosGloboPorColor } = await import("../../src/lib/plan/colores-referencia");
  const { ACCION_COLORES_REFERENCIA_OMITIDOS, MENSAJE_CLIENTE_COLORES_REFERENCIA } = await import("../../src/lib/ia/herramientas/registro-herramientas");
  // Palette as the analyzer reported it for that photo (it does not list the clear accents).
  const semiarcosFoto = ReferenceBlueprintV2Schema.parse({
    ...blueprintDe(["REF_01"], [
      elemento("REF_01_E03", "REF_01", "left balloon garland", "balloon_structure", ["light pink", "chrome silver", "light grey", "clear"]),
    ]),
    palette: { observed: ["light pink", "chrome silver", "light grey"], priority: ["light pink", "chrome silver", "light grey"] },
  });
  assert.deepEqual(restricciones.aplicarColoresReferencia(PlanDecoracionSchema.parse({
    plan_version: "1.0", plan_id: "01010101-0101-4010-8010-010101010101", concepto: { titulo: "x", descripcion: "x", paleta: [] },
    espacio: { tipo: "salón", fuente: "foto" }, supuestos: [],
    estructuras: [{ ...arcoBlanco, referencia_element_id: "REF_01_E03" }],
  }), semiarcosFoto).estructuras[0]!.colores_referencia, ["rosado", "plateado", "gris", "transparente"], "the clear accents are claimed on top of the three hues (2026-09-24)");

  // 2026-09-29: a brick wall behind the piece ("terracotta red") reached
  // `palette.observed`, and from there the colors the wall was asked to cover;
  // the customer got a "cafe -> rosado, dorado" substitution for the venue.
  const paredConLadrillo = ReferenceBlueprintV2Schema.parse({
    ...blueprintDe(["REF_01"], [
      elemento("REF_01_E01", "REF_01", "balloon wall", "balloon_structure", ["pearl blush pink", "chrome gold", "matte white"]),
      elemento("REF_01_E02", "REF_01", "brick wall", "backdrop", ["terracotta red", "brown"]),
    ]),
    palette: { observed: ["pearl blush pink", "chrome gold", "matte white", "terracotta red"], priority: ["pearl blush pink", "chrome gold", "matte white", "terracotta red"] },
  });
  assert.deepEqual(restricciones.aplicarColoresReferencia(PlanDecoracionSchema.parse({
    plan_version: "1.0", plan_id: "01010101-0101-4010-8010-010101010102", concepto: { titulo: "x", descripcion: "x", paleta: [] },
    espacio: { tipo: "salón", fuente: "foto" }, supuestos: [],
    estructuras: [{ ...arcoBlanco, referencia_element_id: "REF_01_E01" }],
  }), paredConLadrillo).estructuras[0]!.colores_referencia, ["rosado", "dorado", "blanco"], "the venue's brick does not ask the piece for a color (2026-09-29)");
  const filaGlobo = (productId: string, variantId: string, color: string) => ({
    product_id: productId, variant_id: variantId, sku: null, sku_original: null, source_snapshot_id: null, source_variant_id: null, inventory_quantity: null, unidades_inferidas: null,
    producto_titulo: `Globo ${color}`, variante_titulo: "R-12", precio: 4000, unidades_paq: 12, disponible: true, producto_disponible: true,
    codigo_tamano: "R-12", forma: "redondo", diam_pulg: 12, colores_producto: [color], colores_variante: [color], acabados_producto: [], descripcion: null, imagen: null,
  });
  const filasSemiarco = [filaGlobo("P-TRANSP", "V-TRANSP-12", "transparente"), filaGlobo("P-ROSADO", "V-ROSADO-12", "rosado"), filaGlobo("P-PLATA", "V-PLATA-12", "plateado")];
  const columnaFoto = (colores: string[]) => ({
    ...arcoBlanco, estructura_id: "EST_01_COLUMNA_IZQ", nombre: "Columna asimétrica izquierda", tipo: "columna", ubicacion: "lateral_izquierdo", medidas: { alto_m: 2.2 },
    referencia_element_id: "REF_01_E03",
    materiales: colores.map((color, index) => ({ product_id: color === "transparente" ? "P-TRANSP" : color === "rosado" ? "P-ROSADO" : "P-PLATA", color, participacion: 1 / colores.length, rol_material: index === 0 ? "principal" : "secundario" })),
  });
  const argsSemiarco = (colores: string[]) => ({ concepto: { titulo: "Cumpleaños", descripcion: "Columna de la foto", paleta: colores }, espacio: { tipo: "salón", fuente: "foto" }, estructuras: [columnaFoto(colores)] });
  const transparentes = [candidato("P-TRANSP", "globo_latex", "transparente", [{ variantId: "V-TRANSP-12", diamPulg: 12 }])];
  const rosaYPlata = [candidato("P-ROSADO", "globo_latex", "rosado", [{ variantId: "V-ROSADO-12", diamPulg: 12 }]), candidato("P-PLATA", "globo_latex", "plateado", [{ variantId: "V-PLATA-12", diamPulg: 12 }])];
  const confirmarSemiarco = (solicitud: string, candidatos: ProductoCandidato[], filasColor: Array<{ color: string; product_id: string; titulo: string }>) => {
    // consultasPresencia: buscarGlobosPorColor's first query, "which colors does
    // the pool truly have" (fixture: the distinct colors of filasColor).
    // consultasColor: its second query, for products of the colors it resolved
    // requested colors to -- the literal requested word only when it is itself
    // present; the nearest present one otherwise (colorCatalogoMasCercano).
    const consultasPresencia: unknown[][] = [];
    const consultasColor: unknown[][] = [];
    const poolColores = { query: async (sql: string, params: unknown[] = []) => {
      if (/SELECT DISTINCT color/.test(sql)) {
        consultasPresencia.push(params);
        return { rows: [...new Set(filasColor.map((fila) => fila.color))].map((color) => ({ color })) };
      }
      if (/unnest\(\$1::text\[\]\) AS color/.test(sql)) {
        consultasColor.push(params);
        const resueltos = params[0] as string[];
        return { rows: filasColor.filter((fila) => resueltos.includes(fila.color)) };
      }
      return { rows: filasSemiarco };
    } } as unknown as Pool;
    instalarResolutorPythonFalso({ veredicto: veredictoColoresReferencia });
    const estado = crearEstadoConversacion({}, solicitud, semiarcosFoto);
    estado.ragCatalogSnapshotId = SNAPSHOT_FALSO;
    estado.ragCandidatos = candidatos;
    for (const c of candidatos) {
      estado.ragIdsRecuperados.add(c.productId);
      estado.ragVariantIdsRecuperados.set(c.productId, new Set(c.variantes.map((v) => v.variantId)));
    }
    const registro = crearRegistroHerramientas(estado, { pool: poolColores, creatividad: 0 });
    return { estado, consultasPresencia, consultasColor, confirmar: (colores: string[]) => registro.confirmar_plan_decoracion!(argsSemiarco(colores), llamada) as Promise<Record<string, unknown>> };
  };

  // Pure rule.
  const disponiblesTurno = productosGloboPorColor([...transparentes, ...rosaYPlata], ["rosado", "plateado", "gris"]);
  assert.deepEqual([...disponiblesTurno.keys()].sort(), ["plateado", "rosado"], "grey is not a catalog color");
  assert.deepEqual(productosGloboPorColor([candidato("P-SERP", "complemento", "rosado", [{ variantId: "V-SERP", diamPulg: null }])], ["rosado"]).size, 0, "a streamer never covers a balloon color");
  const omitidosPuros = coloresReferenciaOmitidos([{ ...columnaFoto(["transparente"]), colores_referencia: ["rosado", "plateado", "gris"] }], disponiblesTurno);
  assert.deepEqual(omitidosPuros.map((item) => item.color), ["rosado", "plateado"]);
  assert.deepEqual(coloresReferenciaOmitidos([{ ...columnaFoto(["rosado", "plateado"]), colores_referencia: ["rosado", "plateado", "gris"] }], disponiblesTurno), [], "the plan uses the photo colors");
  assert.deepEqual(detectarJergaInterna(MENSAJE_CLIENTE_COLORES_REFERENCIA), [], MENSAJE_CLIENTE_COLORES_REFERENCIA);
  ok("colores de la foto: regla pura de colores omitidos con catálogo disponible");

  // The turn search returned pink and silver: an all-transparent plan is sent back once.
  const turno = confirmarSemiarco("Quiero algo así para un cumpleaños", [...transparentes, ...rosaYPlata], []);
  const rechazoTurno = await turno.confirmar(["transparente"]);
  assert.equal(rechazoTurno.ok, false, JSON.stringify(rechazoTurno).slice(0, 400));
  assert.equal(rechazoTurno.status, "COLORES_REFERENCIA_OMITIDOS");
  const omitidosTurno = rechazoTurno.colores_omitidos as Array<{ color: string; productos: Array<{ product_id: string; en_busqueda: boolean }> }>;
  assert.deepEqual(omitidosTurno.map((item) => item.color), ["rosado", "plateado"]);
  assert.deepEqual(omitidosTurno[0]!.productos, [{ product_id: "P-ROSADO", titulo: "P-ROSADO", en_busqueda: true }]);
  assert.equal(turno.consultasPresencia.length, 1, "the catalog is only asked for the colors the turn search did not return");
  assert.deepEqual(turno.consultasColor, [], "grey has no exact or nearby stocked color in this catalog, so no product query runs");
  assert.equal(rechazoTurno.accion_requerida, ACCION_COLORES_REFERENCIA_OMITIDOS);
  assert.match(String(rechazoTurno.accion_requerida), /un solo color/);
  assert.equal(rechazoTurno.mensaje_cliente, MENSAJE_CLIENTE_COLORES_REFERENCIA);
  const conColoresFoto = await turno.confirmar(["rosado", "plateado"]);
  assert.equal(conColoresFoto.ok, true, JSON.stringify(conColoresFoto).slice(0, 400));
  // Grey is reported as the silver it is bought as; the clear accents, now
  // claimed on top of the three hues, are a real loss of this plan (the refusal
  // is sent once per turn, so the second plan goes on with the notice).
  assert.deepEqual(
    (conColoresFoto.avisos_cliente as string[]).map((aviso) => /muestra (\S+)/.exec(aviso)?.[1]?.replace(/,$/, "")),
    ["gris", "transparente"],
    (conColoresFoto.avisos_cliente as string[]).join(" | "),
  );
  const insiste = await turno.confirmar(["transparente"]);
  assert.equal(insiste.ok, true, "each color is sent back once per turn: no loop");
  assert.equal((insiste.avisos_cliente as string[]).length, 3);
  ok("confirmar_plan_decoracion devuelve un plan que descarta colores de la foto que el catálogo del turno tiene");

  // La búsqueda del turno no los encontró; la consulta del catálogo publicado sí.
  const lora = confirmarSemiarco("Quiero algo así para un cumpleaños", transparentes, [
    { color: "rosado", product_id: "P-ROSADO", titulo: "Globo Latex Redondo Fashion Rosado" },
    { color: "plateado", product_id: "P-PLATA", titulo: "Globo Latex Redondo Reflex Plata" },
  ]);
  const rechazoLora = await lora.confirmar(["transparente"]);
  assert.equal(rechazoLora.status, "COLORES_REFERENCIA_OMITIDOS", JSON.stringify(rechazoLora).slice(0, 400));
  const omitidosLora = rechazoLora.colores_omitidos as Array<{ color: string; productos: Array<{ product_id: string; en_busqueda: boolean }> }>;
  assert.deepEqual(omitidosLora[0]!.productos.map((item) => item.en_busqueda), [false]);
  // Bug fix: grey ("gris") has no exact catalog product, but the pool has
  // silver ("plateado") -- same neutral family in similitud-color.ts -- so it
  // now borrows it by chromatic distance instead of disappearing.
  assert.deepEqual(omitidosLora.map((item) => item.color), ["rosado", "plateado", "gris"], "grey resolves to the nearest stocked color instead of being dropped");
  assert.deepEqual(omitidosLora.find((item) => item.color === "gris")?.productos.map((item) => item.product_id), ["P-PLATA"], "grey borrows silver's real products, not a synonym table");
  assert.equal(lora.consultasPresencia.length, 1);
  assert.equal(lora.consultasColor.length, 1);
  // The literal word "gris" is never queried: it resolved to "plateado" before the product lookup.
  assert.deepEqual(lora.consultasColor[0]![0], ["rosado", "plateado"]);

  // The catalog really lacks them: the plan goes on with the notices.
  const sinColores = confirmarSemiarco("Quiero algo así para un cumpleaños", transparentes, []);
  const aceptado = await sinColores.confirmar(["transparente"]);
  assert.equal(aceptado.ok, true, JSON.stringify(aceptado).slice(0, 400));
  assert.equal((aceptado.avisos_cliente as string[]).length, 3);
  // An explicit customer color overrides the photo.
  const explicito = await confirmarSemiarco("Quiero algo así para un cumpleaños pero en blanco", [...transparentes, ...rosaYPlata], []).confirmar(["transparente"]);
  assert.notEqual(explicito.status, "COLORES_REFERENCIA_OMITIDOS", "the customer chose the palette");
  ok("colores de la foto: búsqueda en catálogo completo, catálogo sin el color y color explícito del cliente");

  // ---------------------------------------------------------------------------
  // 2026-09-29: la mitad que le faltaba a la auditoría de color. Toda la
  // maquinaria miraba un solo sentido —los colores de la foto que el plan NO
  // compra— y nada el inverso. La pared "Mr & Mrs" se leyó bien (blush perlado,
  // dorado cromado, blanco mate) y el modelo compró además un "Reflex Fucsia"
  // que la foto no tiene; en cadena, la pista de patrón de la foto no encontró
  // material para su rosado y el armado cayó al preset de confeti.
  const { materialesDeColorInventado, coloresObservadosElemento } = await import("../../src/lib/plan/colores-referencia");
  const { aplicarAcabadoReferencia, avisosClienteAjustes, quitarMaterialesDeColorInventado } = await import("../../src/lib/plan/cobertura-materiales");
  const etiquetasPared = ["pearl blush pink", "chrome gold", "matte white"];
  const paredFoto = blueprintDe(["REF_01"], [elemento("REF_01_E01", "REF_01", "Mr & Mrs organic balloon wall", "balloon_structure", etiquetasPared)]);
  // Lo observado NO se acota a los tres dominantes: acotarlo acusaría de
  // invención al cuarto color de una foto que sí lo tiene.
  assert.deepEqual(coloresObservadosElemento({ observed_colors: etiquetasPared }), ["rosado", "dorado", "blanco"]);
  assert.deepEqual(coloresObservadosElemento({ observed_colors: ["white, gold, silver, pink"] }), ["blanco", "dorado", "plateado", "rosado"], "los cuatro, aunque solo tres sean dominantes");
  assert.deepEqual(coloresObservadosElemento({ observed_colors: ["chrome gold"], measured_colors: [{ color: "rosado", share: 0.4 }] }), ["dorado"], "una medida sin etiqueta no habilita compra de otro tono");

  const materialPared = (productId: string, color: string, participacion: number, rol: "principal" | "secundario") => ({ product_id: productId, color, participacion, rol_material: rol });
  const pared = (materiales: ReturnType<typeof materialPared>[], elementId: string | null = "REF_01_E01") => ({
    ...arcoBlanco, estructura_id: "EST_01_PARED", nombre: "Pared orgánica de globos", tipo: "pared", ubicacion: "fondo_pared",
    medidas: { ancho_m: 3, alto_m: 2.4 }, materiales, ...(elementId ? { referencia_element_id: elementId } : {}),
  });
  const planDe = (estructura: ReturnType<typeof pared>) => PlanDecoracionSchema.parse({
    plan_version: "1.0", plan_id: "09090909-0909-4090-8090-090909090909",
    concepto: { titulo: "Mr & Mrs", descripcion: "Pared orgánica de globos", paleta: ["rosado", "dorado", "blanco"] },
    espacio: { tipo: "salón", fuente: "foto" }, supuestos: [], estructuras: [estructura],
  });
  // Lo que el modelo compró de verdad ese día.
  const materialesReales = [
    materialPared("P-ORO-ROSA", "dorado rosa", 0.5, "principal"),
    materialPared("P-ORO", "dorado", 0.2, "secundario"),
    materialPared("P-BLANCO-MATE", "blanco", 0.15, "secundario"),
    materialPared("P-FUCSIA", "fucsia", 0.15, "secundario"),
  ];
  const inventados = materialesDeColorInventado([pared(materialesReales)], paredFoto);
  assert.deepEqual(
    inventados,
    [{ estructura_id: "EST_01_PARED", product_id: "P-FUCSIA", color: "fucsia" }],
    "el oro rosa es sustitución del blush (ΔE 23 del rosado observado) y el fucsia invención (48 del rosado, 88 del blanco, 97 del dorado)",
  );
  assert.deepEqual(materialesDeColorInventado([pared(materialesReales)], undefined), [], "sin foto no hay nada contra lo que medir");
  assert.deepEqual(materialesDeColorInventado([pared(materialesReales, null)], paredFoto), [], "una pieza que no materializa un elemento no sigue su paleta");
  // Una etiqueta que la taxonomía no alias a propósito es color de la foto que
  // no vemos: sin verlo no se puede afirmar que un material no le corresponda.
  const paredConCobre = blueprintDe(["REF_01"], [elemento("REF_01_E01", "REF_01", "Copper and blush wall", "balloon_structure", ["copper", ...etiquetasPared])]);
  assert.deepEqual(materialesDeColorInventado([pared(materialesReales)], paredConCobre), [], "paleta que no se supo leer completa: no se juzga");
  // Transparente es acabado y multicolor no es un tono; un color que la tabla de
  // tonos no conoce no tiene distancia que sostenga la acusación.
  assert.deepEqual(materialesDeColorInventado([pared([
    materialPared("P-CRISTAL", "transparente", 0.4, "principal"),
    materialPared("P-CONFETI", "multicolor", 0.3, "secundario"),
    materialPared("P-RARO", "frambuesa", 0.3, "secundario"),
  ])], paredFoto), []);
  ok("simetría del color: un material cuyo color la foto no tiene se distingue de una sustitución por ΔE");

  const podado = quitarMaterialesDeColorInventado(planDe(pared(materialesReales)), inventados);
  const materialesPodados = podado.plan.estructuras[0]!.materiales;
  assert.deepEqual(materialesPodados.map((material) => material.color), ["dorado rosa", "dorado", "blanco"], "el color inventado no llega al plan que se cotiza");
  assert.ok(Math.abs(materialesPodados.reduce((suma, material) => suma + material.participacion, 0) - 1) < 0.001, materialesPodados.map((material) => material.participacion).join(" "));
  assert.deepEqual(materialesPodados.filter((material) => material.rol_material === "principal").map((material) => material.color), ["dorado rosa"], "el principal sigue siendo el de la foto");
  const avisosPodado = podado.ajustes.flatMap((ajuste) => (ajuste.tipo === "material_quitado" ? [ajuste.aviso_cliente] : []));
  assert.equal(avisosPodado.length, 1, podado.ajustes.map((ajuste) => ajuste.tipo).join(" "));
  assert.match(avisosPodado[0]!, /globos fucsia/);
  assert.match(avisosPodado[0]!, /tu foto no los tiene/);
  assert.deepEqual(detectarJergaInterna(avisosPodado[0]!), [], avisosPodado[0]);
  // Una pieza entera de colores ajenos no se puede podar sin borrarla: ese caso
  // lo sigue atendiendo COLORES_REFERENCIA_OMITIDOS.
  const soloFucsia = pared([materialPared("P-FUCSIA", "fucsia", 1, "principal")]);
  const intacta = quitarMaterialesDeColorInventado(planDe(soloFucsia), materialesDeColorInventado([soloFucsia], paredFoto));
  assert.deepEqual(intacta.plan.estructuras[0]!.materiales.map((material) => material.color), ["fucsia"], "podar la pieza entera la borraría");
  assert.deepEqual(intacta.ajustes, []);
  ok("simetría del color: se poda el material y se reescalan las participaciones, nunca la pieza completa");

  // El turno completo: el fucsia no llega al plan firmado y el cliente se entera.
  const globosPared = [
    candidato("P-ORO-ROSA", "globo_latex", "dorado rosa", [{ variantId: "V-ORO-ROSA-12", diamPulg: 12 }]),
    candidato("P-ORO", "globo_latex", "dorado", [{ variantId: "V-ORO-12", diamPulg: 12 }]),
    candidato("P-BLANCO-MATE", "globo_latex", "blanco", [{ variantId: "V-BLANCO-MATE-12", diamPulg: 12 }]),
    candidato("P-FUCSIA", "globo_latex", "fucsia", [{ variantId: "V-FUCSIA-12", diamPulg: 12 }]),
  ];
  const argsPared = {
    concepto: { titulo: "Mr & Mrs", descripcion: "Pared orgánica de globos", paleta: ["rosado", "dorado", "blanco"] },
    espacio: { tipo: "salón", fuente: "foto" },
    estructuras: [pared(materialesReales)],
  };
  const { estado: estadoPared, confirmar: confirmarPared } = herramienta("Quiero algo así para mi matrimonio", globosPared, paredFoto, 0);
  const paredConfirmada = await confirmarPared(argsPared, llamada) as Record<string, unknown>;
  assert.equal(paredConfirmada.ok, true, JSON.stringify(paredConfirmada).slice(0, 500));
  assert.deepEqual(
    estadoPared.planResuelto?.plan.estructuras[0]?.materiales.map((material) => material.color),
    ["dorado rosa", "dorado", "blanco"],
    "el plan firmado (y lo que se envía a Python) no compra el color que el modelo inventó",
  );
  const avisosPared = paredConfirmada.avisos_cliente as string[];
  assert.ok(avisosPared.some((aviso) => /fucsia/.test(aviso) && /tu foto no los tiene/.test(aviso)), avisosPared.join(" | "));
  for (const aviso of avisosPared) assert.deepEqual(detectarJergaInterna(aviso), [], aviso);
  // El cliente manda sobre la foto: si él pidió el color, no es una invención.
  const { estado: estadoPedido, confirmar: confirmarPedido } = herramienta("Quiero algo así para mi matrimonio pero con un toque fucsia", globosPared, paredFoto, 0);
  const pedidoConfirmado = await confirmarPedido(argsPared, llamada) as Record<string, unknown>;
  assert.equal(pedidoConfirmado.ok, true, JSON.stringify(pedidoConfirmado).slice(0, 500));
  assert.deepEqual(
    estadoPedido.planResuelto?.plan.estructuras[0]?.materiales.map((material) => material.color),
    ["dorado rosa", "dorado", "blanco", "fucsia"],
    "el color que pidió el cliente se queda",
  );
  ok("simetría del color: el turno firma el plan sin el color inventado y avisa, salvo que lo pida el cliente");

  // ---------------------------------------------------------------------------
  // 2026-09-29, la otra mitad del mismo día: el ACABADO. La misma pared se leyó
  // bien (blush PERLADO, dorado CROMADO, blanco MATE) y el modelo compró el
  // blush como "Reflex Dorado Rosa": el cromado del dorado se contagió al rosa.
  // El prompt ya le entregaba el acabado resuelto por color; nadie lo vigilaba.
  const { acabadosObservadosDeMateriales } = await import("../../src/lib/plan/colores-referencia");
  const { disponibilidadDelTurno } = await import("../../src/lib/ia/herramientas/convergencia-plan");
  const esperadoPared = acabadosObservadosDeMateriales([pared(materialesReales)], paredFoto);
  assert.deepEqual(esperadoPared, [
    // El oro rosa sirve al blush (ΔE 23 del rosado observado): lleva SU acabado,
    // no el del dorado de al lado.
    { estructura_id: "EST_01_PARED", product_id: "P-ORO-ROSA", color: "dorado rosa", acabado: "satin" },
    { estructura_id: "EST_01_PARED", product_id: "P-ORO", color: "dorado", acabado: "reflex" },
    { estructura_id: "EST_01_PARED", product_id: "P-BLANCO-MATE", color: "blanco", acabado: "mate" },
  ], "el fucsia no sirve a ningún color de la foto, así que la foto no le exige acabado");
  // El silencio no es mate, y tampoco hereda el cromo del vecino: el rosado de
  // esta foto no dice acabado y no debe acabar comprado en Reflex.
  const paredSinAcabado = blueprintDe(["REF_01"], [elemento("REF_01_E01", "REF_01", "Balloon wall", "balloon_structure", ["light pink", "chrome gold"])]);
  assert.deepEqual(
    acabadosObservadosDeMateriales([pared([materialPared("P-ROSADO", "rosado", 1, "principal")])], paredSinAcabado),
    [],
    "un color sin acabado en su etiqueta no exige ninguno ni hereda el del color de al lado",
  );
  assert.deepEqual(acabadosObservadosDeMateriales([pared(materialesReales)], undefined), [], "sin foto no hay acabado observado");
  assert.deepEqual(acabadosObservadosDeMateriales([pared(materialesReales, null)], paredFoto), [], "una pieza que no materializa un elemento no sigue su acabado");

  const globoConAcabado = (productId: string, color: string, acabados: string[]): ProductoCandidato => ({
    ...candidato(productId, "globo_latex", color, [{ variantId: `V-${productId}-12`, diamPulg: 12 }]),
    acabados,
  });
  const oroRosaReflex = globoConAcabado("P-ORO-ROSA", "dorado rosa", ["reflex"]);
  const oroRosaSatin = globoConAcabado("P-ORO-ROSA-SATIN", "dorado rosa", ["satin"]);
  const oroReflex = globoConAcabado("P-ORO", "dorado", ["reflex"]);
  // Fashion es el mate del catálogo: un producto que solo dice "fashion" cumple.
  const blancoFashion = globoConAcabado("P-BLANCO-MATE", "blanco", ["fashion"]);
  const fucsiaReflex = globoConAcabado("P-FUCSIA", "fucsia", ["reflex"]);
  // El plan ya podado (el fucsia fuera, participaciones reescaladas a 1).
  const planPared = podado.plan;
  const nombresPared = new Map([["EST_01_PARED", "Pared orgánica de globos"]]);

  // El catálogo del turno tiene el MISMO color en el acabado de la foto: se compra ese.
  const respetado = aplicarAcabadoReferencia(planPared, esperadoPared, disponibilidadDelTurno([oroRosaReflex, oroRosaSatin, oroReflex, blancoFashion]));
  assert.deepEqual(
    respetado.plan.estructuras[0]!.materiales.map((material) => [material.product_id, material.acabado ?? null]),
    [["P-ORO-ROSA-SATIN", "satin"], ["P-ORO", null], ["P-BLANCO-MATE", null]],
    "el blush se compra perlado; el cromado del dorado no se contagia y el mate no se degrada",
  );
  assert.deepEqual(respetado.ajustes.map((ajuste) => ajuste.tipo), ["acabado_referencia"], JSON.stringify(respetado.ajustes));
  assert.deepEqual(
    respetado.plan.estructuras[0]!.materiales.map((material) => material.color),
    ["dorado rosa", "dorado", "blanco"],
    "el acabado no decide el color: el material conserva el suyo",
  );
  assert.deepEqual(avisosClienteAjustes(respetado.ajustes, { nombres: nombresPared }), [], "el acabado se respetó: no hay nada que avisarle al cliente");

  // El catálogo NO lo ofrece en ese color: se deja el que hay y se avisa. Quitar
  // el color por un acabado dejaría la pieza sin el color de la foto, que es peor.
  const avisado = aplicarAcabadoReferencia(planPared, esperadoPared, disponibilidadDelTurno([oroRosaReflex, oroReflex, blancoFashion]));
  assert.deepEqual(
    avisado.plan.estructuras[0]!.materiales.map((material) => [material.product_id, material.color]),
    [["P-ORO-ROSA", "dorado rosa"], ["P-ORO", "dorado"], ["P-BLANCO-MATE", "blanco"]],
    "nunca se quita el color ni el material por un acabado que el catálogo no tiene",
  );
  const avisosAcabado = avisosClienteAjustes(avisado.ajustes, { nombres: nombresPared });
  assert.deepEqual(avisosAcabado, [
    "En pared orgánica de globos los globos de color dorado rosa no vienen en acabado satin en el catálogo: van en su acabado normal.",
  ], JSON.stringify(avisado.ajustes));
  for (const aviso of avisosAcabado) assert.deepEqual(detectarJergaInterna(aviso), [], aviso);
  // Metalizado (mylar) no es el cromado del látex: no cumple "reflex".
  const metalizado = aplicarAcabadoReferencia(planPared, esperadoPared, disponibilidadDelTurno([oroRosaSatin, globoConAcabado("P-ORO", "dorado", ["metalizado"]), blancoFashion]));
  assert.ok(metalizado.ajustes.some((ajuste) => ajuste.tipo === "acabado_material" && ajuste.antes === "reflex" && ajuste.color === "dorado"), JSON.stringify(metalizado.ajustes));
  // Un producto cuyos acabados no se pudieron leer no se juzga: no saber qué
  // acabado tiene no es saber que no lo tiene, y el aviso sería falso.
  const sinLeer = aplicarAcabadoReferencia(planPared, esperadoPared, disponibilidadDelTurno([oroRosaReflex, oroReflex, blancoFashion].map((item) => ({ ...item, acabados: [] }))));
  assert.deepEqual(sinLeer.ajustes, [], "sin acabados leídos no se juzga ni se avisa");
  // Fashion, Reflex y Satin son líneas del globo de látex: a un número de mylar
  // no se le exige acabado ni se le avisa uno.
  const foilDorado: ProductoCandidato = { ...candidato("P-ORO", "globo_foil", "dorado", [{ variantId: "V-P-ORO-12", diamPulg: 12 }]), acabados: ["metalizado"] };
  const sinLatex = aplicarAcabadoReferencia(planPared, esperadoPared, disponibilidadDelTurno([oroRosaReflex, oroRosaSatin, foilDorado, blancoFashion]));
  assert.deepEqual(sinLatex.ajustes.map((ajuste) => ajuste.tipo), ["acabado_referencia"], JSON.stringify(sinLatex.ajustes));
  // Una variante que el modelo fijó nombra ESE producto: cambiarlo debajo
  // dejaría el plan contradiciéndose, así que solo se avisa.
  const conVariante = aplicarAcabadoReferencia(
    planDe(pared(materialesReales.map((material) => (material.product_id === "P-ORO-ROSA" ? { ...material, variant_id: "V-P-ORO-ROSA-12" } : material)))),
    esperadoPared,
    disponibilidadDelTurno([oroRosaReflex, oroRosaSatin, oroReflex, blancoFashion]),
  );
  assert.deepEqual(conVariante.plan.estructuras[0]!.materiales.map((material) => material.product_id), ["P-ORO-ROSA", "P-ORO", "P-BLANCO-MATE", "P-FUCSIA"]);
  assert.ok(conVariante.ajustes.some((ajuste) => ajuste.tipo === "acabado_material" && ajuste.antes === "satin"), JSON.stringify(conVariante.ajustes));
  ok("acabado de la foto: se compra el observado cuando el catálogo lo ofrece en ese color, y se avisa cuando no");

  // UI-2c: cuando el turno no trae el color en el acabado de la foto, el servidor lo busca antes de juzgar, y
  // solo entonces: con el producto ya en el turno, o con una variante fijada, la búsqueda no se usaría.
  const { busquedasDeAcabado } = await import("../../src/lib/plan/cobertura-materiales");
  assert.deepEqual(
    busquedasDeAcabado(planPared, esperadoPared, disponibilidadDelTurno([oroRosaReflex, oroReflex, blancoFashion])),
    ["globo latex redondo satin dorado rosa"],
    "falta el dorado rosa perlado: se pide ese color en ese acabado, y nada para lo que ya cumple",
  );
  assert.deepEqual(busquedasDeAcabado(planPared, esperadoPared, disponibilidadDelTurno([oroRosaReflex, oroRosaSatin, oroReflex, blancoFashion])), [], "el turno ya lo trae: no se busca");
  assert.deepEqual(
    busquedasDeAcabado(planDe(pared(materialesReales.map((material) => (material.product_id === "P-ORO-ROSA" ? { ...material, variant_id: "V-P-ORO-ROSA-12" } : material)))), esperadoPared, disponibilidadDelTurno([oroRosaReflex, oroReflex, blancoFashion])),
    [],
    "una variante fijada nombra ese producto: la regla 2 no la cambiaría, así que no se busca",
  );
  // CASE-002 de images-judge: «chrome silver» y «pastel pink»; el modelo compró Reflex Rosado.
  const semiarcoPastel = blueprintDe(["REF_01"], [elemento("REF_01_E01", "REF_01", "Balloon half arch", "balloon_structure", ["chrome silver", "pastel pink"])]);
  const planPastel = pared([materialPared("P-PLATA", "plateado", 0.5, "principal"), materialPared("P-ROSADO-REFLEX", "rosado", 0.5, "secundario")]);
  const esperadoPastel = acabadosObservadosDeMateriales([planPastel], semiarcoPastel);
  assert.deepEqual(esperadoPastel.map((item) => [item.product_id, item.acabado]), [["P-PLATA", "reflex"], ["P-ROSADO-REFLEX", "mate"]], "«pastel» es un acabado mate de la foto");
  const plataReflex = globoConAcabado("P-PLATA", "plateado", ["reflex"]);
  const rosadoReflex = globoConAcabado("P-ROSADO-REFLEX", "rosado", ["reflex"]);
  assert.deepEqual(
    busquedasDeAcabado(planDe(planPastel), esperadoPastel, disponibilidadDelTurno([plataReflex, rosadoReflex])),
    ["globo latex redondo mate rosado"],
    "el rosado pastel comprado en Reflex se busca en mate; el plateado cromado ya cumple",
  );
  const rosadoPastelMate = globoConAcabado("P-ROSADO-PASTEL", "rosado", ["mate"]);
  const pastelCumplido = aplicarAcabadoReferencia(planDe(planPastel), esperadoPastel, disponibilidadDelTurno([plataReflex, rosadoReflex, rosadoPastelMate]));
  assert.deepEqual(pastelCumplido.plan.estructuras[0]!.materiales.map((material) => material.product_id), ["P-PLATA", "P-ROSADO-PASTEL"], "con el mate en el turno, la puerta compra el pastel");
  ok("UI-2c: el servidor busca el color en el acabado de la foto cuando el turno no lo trae");

  // El turno completo: el plan firmado compra el perlado, y cuando no se pudo el
  // cliente se entera por el mismo canal de siempre.
  const { estado: estadoSatin, confirmar: confirmarSatin } = herramienta("Quiero algo así para mi matrimonio", [oroRosaReflex, oroRosaSatin, oroReflex, blancoFashion, fucsiaReflex], paredFoto, 0);
  const paredSatin = await confirmarSatin(argsPared, llamada) as Record<string, unknown>;
  assert.equal(paredSatin.ok, true, JSON.stringify(paredSatin).slice(0, 500));
  assert.deepEqual(
    estadoSatin.planResuelto?.plan.estructuras[0]?.materiales.map((material) => material.product_id),
    ["P-ORO-ROSA-SATIN", "P-ORO", "P-BLANCO-MATE"],
    "el plan firmado compra el blush perlado, no el cromado",
  );
  const { estado: estadoCromado, confirmar: confirmarCromado } = herramienta("Quiero algo así para mi matrimonio", [oroRosaReflex, oroReflex, blancoFashion, fucsiaReflex], paredFoto, 0);
  const paredCromada = await confirmarCromado(argsPared, llamada) as Record<string, unknown>;
  assert.equal(paredCromada.ok, true, JSON.stringify(paredCromada).slice(0, 500));
  assert.deepEqual(
    estadoCromado.planResuelto?.plan.estructuras[0]?.materiales.map((material) => material.product_id),
    ["P-ORO-ROSA", "P-ORO", "P-BLANCO-MATE"],
    "sin el color en ese acabado el plan lo conserva: nunca se pierde el color",
  );
  const avisosCromada = paredCromada.avisos_cliente as string[];
  assert.ok(avisosCromada.some((aviso) => /no vienen en acabado satin/.test(aviso)), avisosCromada.join(" | "));
  for (const aviso of avisosCromada) assert.deepEqual(detectarJergaInterna(aviso), [], aviso);
  // Si el cliente pidió el acabado, manda él y la foto no lo discute.
  const argsParedReflex = {
    ...argsPared,
    estructuras: [pared(materialesReales.map((material) => ({ ...material, acabado: "reflex" })))],
  };
  const { estado: estadoPedidoAcabado, confirmar: confirmarPedidoAcabado } = herramienta("Quiero algo así para mi matrimonio, todo en acabado reflex", [oroRosaReflex, oroRosaSatin, oroReflex, blancoFashion, fucsiaReflex], paredFoto, 0);
  const pedidoAcabado = await confirmarPedidoAcabado(argsParedReflex, llamada) as Record<string, unknown>;
  assert.equal(pedidoAcabado.ok, true, JSON.stringify(pedidoAcabado).slice(0, 500));
  assert.deepEqual(
    estadoPedidoAcabado.planResuelto?.plan.estructuras[0]?.materiales.map((material) => material.product_id),
    ["P-ORO-ROSA", "P-ORO", "P-BLANCO-MATE"],
    "un acabado que pidió el cliente manda sobre el de la foto",
  );
  ok("acabado de la foto: el turno firma el acabado observado y avisa cuando el catálogo no lo tiene");

  // ---------------------------------------------------------------------------
  // E2E 2026-09-14 (D2): a venue photo came back as 3 × 3 × 2,5 m "measured from
  // the photo". The model does not measure: those numbers are estimates.
  // The resolver's own normalization (foto + measures -> supuesto) is locked in
  // Python by golden vector 17; what stays here is the server's signing policy.
  const { aplicarFuenteMedidasEspacio, clienteDioMedidasEspacio } = await import("../../src/lib/plan/medidas-defecto");
  const espacioFoto = { tipo: "salon_eventos", ancho_m: 3, largo_m: 3, alto_m: 2.5, fuente: "foto" as const };
  const planEspacio = PlanDecoracionSchema.parse({ ...planSoloFigura, espacio: espacioFoto });
  assert.equal(clienteDioMedidasEspacio("Quiero algo así para la primera comunión"), false);
  assert.equal(clienteDioMedidasEspacio("El salón mide 10 x 8"), true);
  assert.equal(clienteDioMedidasEspacio("Un techo de 5,5 metros de alto"), true);
  assert.equal(clienteDioMedidasEspacio("Para 50 invitados"), false);
  assert.equal(aplicarFuenteMedidasEspacio(planEspacio, false).espacio.fuente, "supuesto");
  assert.equal(aplicarFuenteMedidasEspacio(planEspacio, true).espacio.fuente, "cliente", "measures the customer gave are the customer's");
  assert.equal(aplicarFuenteMedidasEspacio(PlanDecoracionSchema.parse({ ...planSoloFigura, espacio: { ...espacioFoto, fuente: "cliente" } }), false).espacio.fuente, "supuesto", "the model cannot claim the customer's numbers");
  const sinMedidas = PlanDecoracionSchema.parse({ ...planSoloFigura, espacio: { tipo: "salon_eventos", fuente: "foto" } });
  assert.equal(aplicarFuenteMedidasEspacio(sinMedidas, false), sinMedidas, "without numbers nothing changes");
  const { estado: estadoEspacio, confirmar: confirmarEspacio } = herramienta("Quiero un arco blanco para la primera comunión", [candidato("P-BLANCO", "globo_latex", "blanco", [{ variantId: "V-BLANCO-12", diamPulg: 12 }])], undefined, 2, [{ ...filasColumna[0]!, product_id: "P-BLANCO", variant_id: "V-BLANCO-12", colores_producto: ["blanco"], colores_variante: ["blanco"] }], { "P-BLANCO": "https://cdn.shopify.test/blanco-12.jpg" });
  // The brief is written by the model (guardar_brief): a number there is not the
  // customer's evidence (ADR-0031, amendment 2026-09-28).
  estadoEspacio.brief.espacio = "salón de 3 m por 3 m";
  const espacioConfirmado = await confirmarEspacio({ ...argsArco, espacio: espacioFoto }, llamada) as Record<string, unknown>;
  assert.equal(espacioConfirmado.ok, true, JSON.stringify(espacioConfirmado).slice(0, 400));
  assert.deepEqual(estadoEspacio.planResuelto?.plan.espacio, { ...espacioFoto, fuente: "supuesto" }, "the signed plan says estimated, never measured from the photo nor taken from a brief the model wrote");
  assert.equal(estadoEspacio.cotizacion?.lineas[0]?.foto, "https://cdn.shopify.test/blanco-12.jpg", "D9a: the chat quote carries the catalog photo");
  assert.deepEqual((espacioConfirmado.cotizacion as { lineas: Array<{ foto?: string }> }).lineas.map((linea) => linea.foto), ["https://cdn.shopify.test/blanco-12.jpg"]);
  ok("medidas del espacio: foto solo vale para el tipo; sin dato del cliente son supuesto (y la cotización trae foto)");

  // ---------------------------------------------------------------------------
  // E2E 2026-09-14 (D6): "Marco vino y plata" came back as "dusty rose" and the
  // pink was dropped; wine shades must reach the catalog vocabulary too.
  const { colorDeCatalogo } = await import("../../src/lib/plan/colores-catalogo");
  assert.deepEqual(coloresDominantesReferencia(["dusty rose", "pearl white", "metallic silver", "chrome silver"]), ["rosado", "blanco", "plateado"], "dusty rose is pink");
  for (const vino of ["vino", "color vino", "burdeos", "borgoña", "wine", "wine red", "burgundy", "deep burgundy", "maroon", "bordeaux", "vino tinto", "rojo vino", "granate", "marsala"]) {
    assert.deepEqual(coloresDominantesReferencia([vino]), ["burdeos"], `photo label ${vino}`);
    assert.equal(colorDeCatalogo(vino), "burdeos", `plan color ${vino}`);
  }
  assert.equal(colorDeCatalogo("rose gold"), "dorado rosa", "rose gold stays one catalog color");
  assert.equal(colorDeCatalogo("rojo"), "rojo");
  ok("colores de la foto: vocabulario de vino y rosa viejo");

  // ---------------------------------------------------------------------------
  // W2.2 (D7): the label parser lost the hue of "clear pink", never split on
  // punctuation, sent "hot pink" to rosado and dropped single-word shades.
  // Punctuation joins colors: the fold turned "/" and "," into a space before
  // the split, so only the first color of the label survived.
  assert.deepEqual(coloresDominantesReferencia(["gold/white"]), ["dorado", "blanco"]);
  assert.deepEqual(coloresDominantesReferencia(["white, gold, silver, pink"]), ["blanco", "dorado", "plateado"], "the 3-color cap still applies");
  assert.deepEqual(coloresDominantesReferencia(["blush+gold"]), ["rosado", "dorado"]);
  // Transparency is a finish: "clear pink" is the Cristal line in pink, and
  // claiming transparente as well would demand a material the photo never had.
  assert.deepEqual(coloresDominantesReferencia(["clear pink"]), ["rosado"]);
  assert.deepEqual(coloresDominantesReferencia(["crystal blue"]), ["azul"]);
  assert.deepEqual(coloresDominantesReferencia(["clear"]), ["transparente"], "a lone clear is still the color transparente");
  assert.deepEqual(coloresDominantesReferencia(["transparent"]), ["transparente"]);
  assert.deepEqual(coloresDominantesReferencia(["hot pink", "neon pink"]), ["fucsia"], "the catalog sells these as fucsia, not rosado");
  for (const [etiqueta, esperado] of [["navy", "azul"], ["navy blue", "azul"], ["sage", "verde"], ["sage green", "verde"], ["emerald", "verde"], ["lime", "verde"], ["olive", "verde"], ["plum", "morado"], ["mauve", "lila"]] as const) {
    assert.deepEqual(coloresDominantesReferencia([etiqueta]), [esperado], `photo label ${etiqueta}`);
  }
  // Names with no clear catalog color stay unmapped: inventing one buys the
  // wrong balloon, and the substitution notice is not worth a wrong purchase.
  for (const etiqueta of ["copper", "bronze", "taupe", "terracotta"]) assert.deepEqual(coloresDominantesReferencia([etiqueta]), [], `photo label ${etiqueta}`);
  // A Cristal Rosado material quoted as "rosado" covers a "clear pink" photo.
  assert.deepEqual(sustitucionesColorReferencia("EST_01_ARCO", coloresDominantesReferencia(["clear pink"]), ["rosado"]), []);
  const { coloresFotoParaBusqueda } = await import("../../src/lib/plan/colores-referencia");
  assert.deepEqual(coloresFotoParaBusqueda(blueprintDe(["REF_01"], [elemento("REF_01_E01", "REF_01", "Clear pink arch", "balloon_structure", ["clear pink", "navy"])])), ["rosado", "azul"]);
  ok("colores de la foto: puntuación, cristal con tono, fucsia y tonos en inglés de una palabra");

  // ---------------------------------------------------------------------------
  // E2E 2026-09-14 (D9b): raw model wording reached the structure detail.
  const { sanearPorque } = await import("../../src/lib/plan/porque-cliente");
  const casosPorque: ReadonlyArray<readonly [string, string]> = [
    ["Materializa la columna de globos observada a la izquierda de la imagen de referencia.", "Recrea la columna de globos a la izquierda de tu foto."],
    ["Materializa la instalación colgante de globos tupida del techo observada en la imagen.", "Recrea la instalación colgante de globos tupida del techo de tu foto."],
    ["Acompaña la mesa principal como en la referencia visual.", "Acompaña la mesa principal como en tu foto."],
    ["Materializa REF_01_E03 en arco_central.", "Recrea en arco central."],
    ["Enmarca la mesa del pastel.", "Enmarca la mesa del pastel."],
    ["REF_01_E01", "Pieza de tu decoración."],
  ];
  for (const [crudo, esperado] of casosPorque) {
    assert.equal(sanearPorque(crudo), esperado, crudo);
    assert.deepEqual(detectarJergaInterna(sanearPorque(crudo)), [], sanearPorque(crudo));
  }
  const esquemaPorque = (HERRAMIENTAS_PLAN[0]!.esquema as { properties: { estructuras: { items: { properties: { porque: { description?: string } } } } } }).properties.estructuras.items.properties.porque;
  assert.match(esquemaPorque.description ?? "", /frase corta para el cliente/);
  const { estado: estadoPorque, confirmar: confirmarPorque } = herramienta("Quiero un arco blanco para la primera comunión", [candidato("P-BLANCO", "globo_latex", "blanco", [{ variantId: "V-BLANCO-12", diamPulg: 12 }])], undefined, 2, [{ ...filasColumna[0]!, product_id: "P-BLANCO", variant_id: "V-BLANCO-12", colores_producto: ["blanco"], colores_variante: ["blanco"] }]);
  const porqueConfirmado = await confirmarPorque({ ...argsArco, estructuras: [{ ...arcoBlanco, porque: "Materializa el arco observado en la imagen de referencia." }] }, llamada) as Record<string, unknown>;
  assert.equal(porqueConfirmado.ok, true, JSON.stringify(porqueConfirmado).slice(0, 300));
  assert.equal(estadoPorque.planResuelto?.plan.estructuras[0]?.porque, "Recrea el arco de tu foto.");
  ok("porque: frase para el cliente sin jerga del modelo");

  // Regresion encontrada corriendo el servicio contra el catalogo real: un color
  // que la tabla de tonos no conoce puntuaba igual contra todos los disponibles y
  // el desempate alfabetico elegia el primero, asi que una foto frambuesa se
  // resolvia a amarillo. Sustituir exige una distancia; sin ella no se sustituye.
  {
    const enStock = ["amarillo", "azul", "blanco", "rojo", "verde"];
    // El catalogo no vende un globo redondo liso en burdeos, asi que este es el
    // caso real: la sustitucion tiene que encontrar rojo. Con el modelo de tono
    // salia por estar a 10 grados; con la distancia perceptual sale porque es
    // el unico del stock dentro del umbral (deltaE 41 de 45).
    assert.equal(colorCatalogoMasCercano("burdeos", enStock), "rojo", "el burdeos, que no se vende, cae en rojo");
    assert.equal(colorCatalogoMasCercano("rojo", enStock), "rojo", "un color exacto se devuelve tal cual");
    assert.equal(colorCatalogoMasCercano("frambuesa", enStock), undefined, "la tabla no conoce frambuesa: no hay distancia que medir");
    assert.equal(colorCatalogoMasCercano("burdeos", []), undefined, "sin stock no hay a que parecerse");
    casos += 1;
    console.log("[PASS] un color que la tabla no conoce no se sustituye por el primero alfabetico");
  }

  console.log(`\n${casos} casos OK (auditoría de referencia en el plan)`);
}

main().catch((error: unknown) => {
  console.error("[FAIL] plan auditoría referencia", error);
  process.exitCode = 1;
});
