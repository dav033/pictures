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
 * No network, no database, no providers.
 * Run: npx tsx --conditions=react-server scripts/test-plan-auditoria-referencia.ts
 */
import assert from "node:assert/strict";
import type { Pool } from "pg";

process.env.PYTHON_BACKEND_ENABLED = "false";
process.env.PYTHON_BACKEND_KILL_SWITCH = "true";

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
  const herramienta = (solicitud: string, candidatos: ProductoCandidato[], blueprint: Blueprint | undefined, creatividad: 0 | 1 | 2 | 3 | 4 | 5 = 0, filas: unknown[] = []) => {
    const estado = crearEstadoConversacion({}, solicitud, blueprint);
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
  assert.match(construirSistema({ ragEnabled: true, franjasEnabled: false, planEnabled: true }), /FOTO SIN GLOBOS/, "the system prompt states the rule");
  assert.match(construirSistema({ ragEnabled: true, franjasEnabled: false, planEnabled: true }), /piezas iguales en la foto" [\s\S]*repeticiones[\s\S]*nunca un número de globos/, "blueprint quantity is pieces, never balloons");
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

  // Both resolvers never quote a declared material at 0 units (golden vector
  // 14-figura-cuatro-materiales locks the same numbers for TypeScript and Python).
  const { resolverPlan } = await import("../src/lib/plan/resolver");
  const poolFigura = { query: async () => ({ rows: filasFigura }) } as unknown as Pool;
  const whitelistFigura = new Map(filasFigura.map((fila) => [fila.product_id, new Set([fila.variant_id])]));
  const planSoloFigura = PlanDecoracionSchema.parse({
    plan_version: "1.0", plan_id: "14141414-1414-4141-8141-141414141414",
    concepto: { titulo: "Safari", descripcion: "Figura", paleta: ["negro"] }, espacio: { tipo: "salón", fuente: "supuesto" },
    estructuras: [{ ...figura(1, 2), rol_escena: "focal" }], supuestos: [],
  });
  const resueltoFigura = await resolverPlan(poolFigura, planSoloFigura, whitelistFigura);
  assert.deepEqual(resueltoFigura.estructuras[0]!.lineas.map((linea) => [linea.color, linea.unidades]), [["negro", 1], ["amarillo", 1], ["naranja", 1], ["blanco", 1]], "F13: every material of the figure is bought");
  ok("resolver: ningún material declarado queda en 0 al repartir");

  // plan_hash covers the resolved lines: a plan that already bought every
  // material must keep the pre-audit largest-remainder split, or plans approved
  // before the change fail at generation ("Plan hash does not match").
  const figuraDosColores = { ...figura(10, 1, 2), rol_escena: "focal", materiales: figura(10, 1, 2).materiales.map((material, index) => ({ ...material, participacion: index === 0 ? 0.55 : 0.45 })) };
  const planDosColores = PlanDecoracionSchema.parse({ ...planSoloFigura, estructuras: [figuraDosColores] });
  const resueltoDosColores = await resolverPlan(poolFigura, planDosColores, whitelistFigura);
  assert.deepEqual(resueltoDosColores.estructuras[0]!.lineas.map((linea) => linea.unidades), [6, 4], "0.55/0.45 of 10 stays 6/4");
  const figuraCasiUnColor = { ...figura(10, 1, 3), rol_escena: "focal", materiales: figura(10, 1, 3).materiales.map((material, index) => ({ ...material, participacion: [0.9, 0.05, 0.05][index]! })) };
  const resueltoCasiUnColor = await resolverPlan(poolFigura, PlanDecoracionSchema.parse({ ...planSoloFigura, estructuras: [figuraCasiUnColor] }), whitelistFigura);
  assert.deepEqual(resueltoCasiUnColor.estructuras[0]!.lineas.map((linea) => linea.unidades), [8, 1, 1], "a material left at 0 takes one unit from the largest");
  ok("resolver: el reparto de planes que ya compraban cada material no cambia (plan_hash estable)");

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
  assert.deepEqual(sustituciones.map((item) => item.pedido), ["cafe", "azul", "plateado"], "the lost photo colors are recorded as substitutions");
  assert.deepEqual(estadoColumna.planResuelto?.plan.estructuras[0]?.colores_referencia, ["cafe", "azul", "plateado"], "the signed plan carries the photo colors, not the model's");
  const avisos = confirmada.avisos_cliente as string[];
  assert.equal(avisos.length, 3, "the chat receives one notice per lost color");
  assert.match(String(confirmada.accion_requerida ?? ""), /avisos_cliente/, "the model is told it must tell the customer");
  ok("confirmar_plan_decoracion registra los colores perdidos y obliga a avisar");

  console.log(`\n${casos} casos OK (auditoría de referencia en el plan)`);
}

main().catch((error: unknown) => {
  console.error("[FAIL] plan auditoría referencia", error);
  process.exitCode = 1;
});
