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
 * Run: npx tsx --conditions=react-server scripts/test-plan-auditoria-referencia.ts
 */
import assert from "node:assert/strict";
import type { Pool } from "pg";
import { instalarResolutorPythonFalso, prepararEntornoPythonFalso, veredictoColoresReferencia, SNAPSHOT_FALSO } from "./lib/resolutor-python-falso";

prepararEntornoPythonFalso();

let casos = 0;
function ok(nombre: string): void {
  casos += 1;
  console.log(`ok ${casos} - ${nombre}`);
}

async function main(): Promise<void> {
  const { crearEstadoConversacion, crearRegistroHerramientas } = await import("../src/lib/ia/registro-herramientas");
  const { detectarJergaInterna } = await import("../src/lib/ia/jerga-interna");
  const { construirSistema } = await import("../src/lib/ia/prompt-sistema");
  const { HERRAMIENTAS_PLAN } = await import("../src/lib/ia/herramientas");
  const restricciones = await import("../src/lib/plan/restricciones");
  const { ReferenceBlueprintV2Schema } = await import("../src/lib/ia/reference-blueprint");
  const { PlanDecoracionSchema } = await import("../src/lib/plan/tipos");
  type ProductoCandidato = import("../src/lib/rag/chat/buscar").ProductoCandidato;
  type Blueprint = import("../src/lib/ia/reference-blueprint").ReferenceBlueprintV2;

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
  const { ESTRUCTURAS_OFICIALES } = await import("../src/lib/plan/estructuras-oficiales");
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

  const { coloresDominantesReferencia, sustitucionesColorReferencia } = await import("../src/lib/plan/colores-referencia");
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
  const { coloresReferenciaOmitidos, productosGloboPorColor } = await import("../src/lib/plan/colores-referencia");
  const { ACCION_COLORES_REFERENCIA_OMITIDOS, MENSAJE_CLIENTE_COLORES_REFERENCIA } = await import("../src/lib/ia/registro-herramientas");
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
  }), semiarcosFoto).estructuras[0]!.colores_referencia, ["rosado", "plateado", "gris"]);
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
  const confirmarSemiarco = (solicitud: string, candidatos: ProductoCandidato[], filasColor: Array<{ color: string; product_id: string; titulo: string }>, allowlistVariantes?: string[]) => {
    const consultasColor: unknown[][] = [];
    const poolColores = { query: async (sql: string, params: unknown[] = []) => {
      if (/unnest\(\$1::text\[\]\) AS color/.test(sql)) {
        consultasColor.push(params);
        const pedidos = params[0] as string[];
        return { rows: filasColor.filter((fila) => pedidos.includes(fila.color)) };
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
    const catalogAllowlist = allowlistVariantes ? { entries: [], productIds: [], variantIds: allowlistVariantes } : undefined;
    const registro = crearRegistroHerramientas(estado, { pool: poolColores, creatividad: 0, ...(catalogAllowlist ? { catalogAllowlist } : {}) });
    return { estado, consultasColor, confirmar: (colores: string[]) => registro.confirmar_plan_decoracion!(argsSemiarco(colores), llamada) as Promise<Record<string, unknown>> };
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
  assert.deepEqual(turno.consultasColor.map((params) => params[0]), [["gris"]], "the catalog is only asked for the colors the turn search did not return");
  assert.equal(rechazoTurno.accion_requerida, ACCION_COLORES_REFERENCIA_OMITIDOS);
  assert.match(String(rechazoTurno.accion_requerida), /un solo color/);
  assert.equal(rechazoTurno.mensaje_cliente, MENSAJE_CLIENTE_COLORES_REFERENCIA);
  const conColoresFoto = await turno.confirmar(["rosado", "plateado"]);
  assert.equal(conColoresFoto.ok, true, JSON.stringify(conColoresFoto).slice(0, 400));
  assert.deepEqual((conColoresFoto.avisos_cliente as string[]).length, 1, "only grey, which the catalog does not have, is still a notice");
  const insiste = await turno.confirmar(["transparente"]);
  assert.equal(insiste.ok, true, "each color is sent back once per turn: no loop");
  assert.equal((insiste.avisos_cliente as string[]).length, 3);
  ok("confirmar_plan_decoracion devuelve un plan que descarta colores de la foto que el catálogo del turno tiene");

  // The turn search missed them (E2E: only the clear balloon came back) but the
  // active LoRA pool has them: the lookup stays inside that pool and asks for a search.
  const lora = confirmarSemiarco("Quiero algo así para un cumpleaños", transparentes, [
    { color: "rosado", product_id: "P-ROSADO", titulo: "Globo Latex Redondo Fashion Rosado" },
    { color: "plateado", product_id: "P-PLATA", titulo: "Globo Latex Redondo Reflex Plata" },
  ], ["V-TRANSP-12", "V-ROSADO-12", "V-PLATA-12"]);
  const rechazoLora = await lora.confirmar(["transparente"]);
  assert.equal(rechazoLora.status, "COLORES_REFERENCIA_OMITIDOS", JSON.stringify(rechazoLora).slice(0, 400));
  assert.deepEqual((rechazoLora.colores_omitidos as Array<{ productos: Array<{ en_busqueda: boolean }> }>)[0]!.productos.map((item) => item.en_busqueda), [false]);
  assert.equal(lora.consultasColor.length, 1);
  assert.deepEqual(lora.consultasColor[0]![0], ["rosado", "plateado", "gris"]);
  assert.deepEqual(lora.consultasColor[0]![1], ["V-TRANSP-12", "V-ROSADO-12", "V-PLATA-12"], "the lookup never leaves the LoRA pool");

  // The catalog really lacks them: the plan goes on with the notices.
  const sinColores = confirmarSemiarco("Quiero algo así para un cumpleaños", transparentes, []);
  const aceptado = await sinColores.confirmar(["transparente"]);
  assert.equal(aceptado.ok, true, JSON.stringify(aceptado).slice(0, 400));
  assert.equal((aceptado.avisos_cliente as string[]).length, 3);
  // An explicit customer color overrides the photo.
  const explicito = await confirmarSemiarco("Quiero algo así para un cumpleaños pero en blanco", [...transparentes, ...rosaYPlata], []).confirmar(["transparente"]);
  assert.notEqual(explicito.status, "COLORES_REFERENCIA_OMITIDOS", "the customer chose the palette");
  ok("colores de la foto: búsqueda en el pool activo, catálogo sin el color y color explícito del cliente");

  // ---------------------------------------------------------------------------
  // E2E 2026-09-14 (D2): a venue photo came back as 3 × 3 × 2,5 m "measured from
  // the photo". The model does not measure: those numbers are estimates.
  const { aplicarFuenteMedidasEspacio, clienteDioMedidasEspacio, completarMedidas, normalizarFuenteEspacio } = await import("../src/lib/plan/medidas-defecto");
  const espacioFoto = { tipo: "salon_eventos", ancho_m: 3, largo_m: 3, alto_m: 2.5, fuente: "foto" as const };
  assert.deepEqual(normalizarFuenteEspacio(espacioFoto), { ...espacioFoto, fuente: "supuesto" }, "numbers with source photo are an estimate");
  assert.deepEqual(normalizarFuenteEspacio({ tipo: "salon_eventos", fuente: "foto" as const }), { tipo: "salon_eventos", fuente: "foto" }, "the type seen in the photo stays");
  assert.deepEqual(normalizarFuenteEspacio({ ...espacioFoto, fuente: "cliente" as const }).fuente, "cliente");
  const planEspacio = PlanDecoracionSchema.parse({ ...planSoloFigura, espacio: espacioFoto });
  assert.equal(completarMedidas(planEspacio).espacio.fuente, "supuesto", "the resolver normalization (golden vector 17 locks Python)");
  assert.equal(clienteDioMedidasEspacio("Quiero algo así para la primera comunión"), false);
  assert.equal(clienteDioMedidasEspacio("El salón mide 10 x 8"), true);
  assert.equal(clienteDioMedidasEspacio("Un techo de 5,5 metros de alto"), true);
  assert.equal(clienteDioMedidasEspacio("Para 50 invitados", "salón de 12 m de largo"), true, "the brief counts");
  assert.equal(clienteDioMedidasEspacio("Para 50 invitados", 12), false, "a non-text brief field is ignored");
  assert.equal(aplicarFuenteMedidasEspacio(planEspacio, false).espacio.fuente, "supuesto");
  assert.equal(aplicarFuenteMedidasEspacio(planEspacio, true).espacio.fuente, "cliente", "measures the customer gave are the customer's");
  assert.equal(aplicarFuenteMedidasEspacio(PlanDecoracionSchema.parse({ ...planSoloFigura, espacio: { ...espacioFoto, fuente: "cliente" } }), false).espacio.fuente, "supuesto", "the model cannot claim the customer's numbers");
  const sinMedidas = PlanDecoracionSchema.parse({ ...planSoloFigura, espacio: { tipo: "salon_eventos", fuente: "foto" } });
  assert.equal(aplicarFuenteMedidasEspacio(sinMedidas, false), sinMedidas, "without numbers nothing changes");
  const { estado: estadoEspacio, confirmar: confirmarEspacio } = herramienta("Quiero un arco blanco para la primera comunión", [candidato("P-BLANCO", "globo_latex", "blanco", [{ variantId: "V-BLANCO-12", diamPulg: 12 }])], undefined, 2, [{ ...filasColumna[0]!, product_id: "P-BLANCO", variant_id: "V-BLANCO-12", colores_producto: ["blanco"], colores_variante: ["blanco"] }], { "P-BLANCO": "https://cdn.shopify.test/blanco-12.jpg" });
  const espacioConfirmado = await confirmarEspacio({ ...argsArco, espacio: espacioFoto }, llamada) as Record<string, unknown>;
  assert.equal(espacioConfirmado.ok, true, JSON.stringify(espacioConfirmado).slice(0, 400));
  assert.deepEqual(estadoEspacio.planResuelto?.plan.espacio, { ...espacioFoto, fuente: "supuesto" }, "the signed plan says estimated, never measured from the photo");
  assert.equal(estadoEspacio.cotizacion?.lineas[0]?.foto, "https://cdn.shopify.test/blanco-12.jpg", "D9a: the chat quote carries the catalog photo");
  assert.deepEqual((espacioConfirmado.cotizacion as { lineas: Array<{ foto?: string }> }).lineas.map((linea) => linea.foto), ["https://cdn.shopify.test/blanco-12.jpg"]);
  ok("medidas del espacio: foto solo vale para el tipo; sin dato del cliente son supuesto (y la cotización trae foto)");

  // ---------------------------------------------------------------------------
  // E2E 2026-09-14 (D6): "Marco vino y plata" came back as "dusty rose" and the
  // pink was dropped; wine shades must reach the catalog vocabulary too.
  const { colorDeCatalogo } = await import("../src/lib/plan/colores-catalogo");
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
  const { coloresFotoParaBusqueda } = await import("../src/lib/plan/colores-referencia");
  assert.deepEqual(coloresFotoParaBusqueda(blueprintDe(["REF_01"], [elemento("REF_01_E01", "REF_01", "Clear pink arch", "balloon_structure", ["clear pink", "navy"])])), ["rosado", "azul"]);
  ok("colores de la foto: puntuación, cristal con tono, fucsia y tonos en inglés de una palabra");

  // ---------------------------------------------------------------------------
  // E2E 2026-09-14 (D9b): raw model wording reached the structure detail.
  const { sanearPorque } = await import("../src/lib/plan/porque-cliente");
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

  console.log(`\n${casos} casos OK (auditoría de referencia en el plan)`);
}

main().catch((error: unknown) => {
  console.error("[FAIL] plan auditoría referencia", error);
  process.exitCode = 1;
});
