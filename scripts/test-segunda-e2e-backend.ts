/**
 * Backend defects of the second real E2E run (2026-09-15, iteration 4):
 *
 * - D1 photo colors hidden by the occasion filter ("Semiarcos rosa y plata" +
 *   "Quiero algo así para un cumpleaños"), and the COLORES_REFERENCIA_OMITIDOS
 *   refusal that could loop until the turn ran out.
 * - D2 a turn that ended with an empty text and no plan.
 * - D3 the assistant claimed "Cambié el plateado por blanco" while the silver of
 *   the first message was still mandatory and no plan was confirmed.
 * - D4 "los 40 de mi esposo" quoted with the number balloons 0 and 1.
 * - D5 "Marco vino y plata": grey and pink shown as photo colors, dropped silently.
 * - D6 /api/generate without X-Request-ID; character names in plan titles.
 *
 * No network, no database, no providers. El plan lo resuelve Python desde el
 * paso 5 del ADR-0023 y esa llamada la responde un doble de transporte
 * (scripts/lib/resolutor-python-falso.ts): el sujeto de estos defectos es lo
 * que Next decide antes y después de resolver, no el conteo.
 * Run: npx tsx --conditions=react-server scripts/test-segunda-e2e-backend.ts
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

// A fake pool: nothing in this script may reach a real database.
const poolVacio = { query: async () => ({ rows: [] }) } as unknown as Pool;
(globalThis as { __ragPool?: Pool }).__ragPool = poolVacio;

async function main(): Promise<void> {
  const { crearEstadoConversacion, crearRegistroHerramientas } = await import("../src/lib/ia/registro-herramientas");
  const { ReferenceBlueprintV2Schema } = await import("../src/lib/ia/reference-blueprint");
  const { PlanDecoracionSchema } = await import("../src/lib/plan/tipos");
  const { detectarJergaInterna } = await import("../src/lib/ia/omoikane/jerga-interna");
  const { construirSistema } = await import("../src/lib/ia/omoikane/prompt-sistema");
  const relajacion = await import("../src/lib/rag/chat/relajacion-filtros");
  const { extraerFiltrosDurosBusqueda } = await import("../src/lib/rag/query-parser/hard-filters");
  const coloresReferencia = await import("../src/lib/plan/colores-referencia");
  const restricciones = await import("../src/lib/plan/restricciones");
  type ProductoCandidato = import("../src/lib/rag/chat/buscar").ProductoCandidato;
  type Blueprint = import("../src/lib/ia/reference-blueprint").ReferenceBlueprintV2;

  const elemento = (id: string, name: string, category: string, colores: string[], approved = true) => ({
    element_id: id, source_image_id: "REF_01", name, category,
    scene_role: "midground", detection_confidence: 0.9, visible_evidence: name,
    reference_bbox: { x: 0.1, y: 0.1, width: 0.3, height: 0.8 }, depth_layer: 1,
    include_policy: "include", approved, source_type: "reference_only",
    quantity: { mode: "exact", min: 1, max: 1 },
    appearance: { observed_colors: colores, resolved_colors: [], color_policy: "match_reference", material: "latex", shape: name, composition: "mixed" },
    relationships: [], uncertainties: [],
  });
  const blueprint = (elementos: unknown[], paleta: string[]): Blueprint => ReferenceBlueprintV2Schema.parse({
    schema_version: "2.0",
    source_images: [{ image_id: "REF_01", approved_roles: ["composition_reference"] }],
    elements: elementos,
    composition: { focal_point: "mesa", density: "moderate", symmetry: "unknown", negative_space: [] },
    palette: { observed: paleta, priority: paleta },
    unresolved_decisions: [],
  });
  const candidato = (productId: string, titulo: string, categoria: string, colores: string[], variantes: Array<{ variantId: string; diamPulg: number | null }>): ProductoCandidato => ({
    productId, titulo, categoria, colores, acabados: [], ocasiones: [], disponible: true, imagen: null,
    variantes: variantes.map((variante) => ({ variantId: variante.variantId, sku: null, titulo: null, precio: 4000, disponible: true, codigoTamano: variante.diamPulg ? `R-${variante.diamPulg}` : null, diamPulg: variante.diamPulg, forma: variante.diamPulg ? "redondo" : null, colores })),
  });
  const fila = (productId: string, variantId: string, color: string, precio = 4000) => ({
    product_id: productId, variant_id: variantId, sku: null, sku_original: null, source_snapshot_id: null, source_variant_id: null, inventory_quantity: null, unidades_inferidas: null,
    producto_titulo: `Globo ${color}`, variante_titulo: "R-12", precio, unidades_paq: 12, disponible: true, producto_disponible: true,
    codigo_tamano: "R-12", forma: "redondo", diam_pulg: 12, colores_producto: [color], colores_variante: [color], acabados_producto: [], descripcion: null, imagen: null,
  });
  const llamada = { nombre: "confirmar_plan_decoracion", args: {} };

  // ---------------------------------------------------------------------------
  // D1: the occasion filter must not hide the photo colors.
  // "Semiarcos rosa y plata" as the analyzer returned it (analisis-e01-r3.json).
  const semiarcos = blueprint([
    elemento("REF_01_E03", "left balloon garland", "balloon_structure", ["soft pink", "chrome silver", "pearl white", "clear"]),
    elemento("REF_01_E04", "right balloon garland", "balloon_structure", ["soft pink", "chrome silver", "pearl white", "clear"]),
    elemento("REF_01_E05", "chairs", "furniture", ["white"]),
    elemento("REF_01_E09", "flowers", "floral", ["pink", "green"]),
  ], ["soft pink", "chrome silver", "pearl white", "white"]);
  assert.deepEqual(coloresReferencia.coloresFotoParaBusqueda(semiarcos), ["rosado", "plateado", "blanco"], "the dominant colors of the balloon structures");
  assert.deepEqual(coloresReferencia.coloresFotoParaBusqueda(blueprint([elemento("REF_01_E01", "arch", "balloon_structure", ["charcoal grey", "gold"])], [])), ["dorado"], "grey is not a catalog color: it never forces a relaxation");
  assert.deepEqual(coloresReferencia.coloresFotoParaBusqueda(undefined), []);

  const pedidoCumple = "Quiero algo así para un cumpleaños";
  const filtros = extraerFiltrosDurosBusqueda(pedidoCumple, {});
  assert.deepEqual(filtros.ocasiones, ["cumpleanos"], JSON.stringify(filtros));
  assert.deepEqual(filtros.colores, [], "the photo colors are not hard filters");
  type Producto = { id: string; colores: string[]; ocasiones: string[] };
  const catalogo: Producto[] = [
    { id: "P-FELIZ-CUMPLE-RAYITO", colores: ["multicolor"], ocasiones: ["cumpleanos"] },
    { id: "P-HAPPY-BIRTHDAY-DORADO", colores: ["dorado"], ocasiones: ["cumpleanos"] },
    { id: "P-ROSADO", colores: ["rosado"], ocasiones: [] },
    { id: "P-PALO-DE-ROSA", colores: ["rosado"], ocasiones: [] },
    { id: "P-PLATA", colores: ["plateado"], ocasiones: [] },
    { id: "P-BLANCO", colores: ["blanco"], ocasiones: [] },
  ];
  const buscarFalso = async (paso: typeof filtros) => catalogo.filter((producto) => paso.ocasiones.length === 0 || producto.ocasiones.some((ocasion) => (paso.ocasiones as readonly string[]).includes(ocasion)));
  const escalera = (coloresContexto: readonly string[], filtrosPaso = filtros) => buscarFalso(filtrosPaso).then((primera) => relajacion.recorrerEscalera(filtrosPaso, primera, {
    buscar: buscarFalso,
    cantidad: (respuesta) => respuesta.length,
    colores: (respuesta) => respuesta,
    coloresContexto,
  }));
  const conFoto = await escalera(coloresReferencia.coloresFotoParaBusqueda(semiarcos));
  assert.equal(conFoto.relajado, "ocasiones", "the birthday prints leave pink, silver and white uncovered: the occasion is relaxed");
  assert.ok(conFoto.respuesta.some((producto) => producto.id === "P-ROSADO") && conFoto.respuesta.some((producto) => producto.id === "P-PLATA"), JSON.stringify(conFoto.respuesta));
  const sinFoto = await escalera([]);
  assert.equal(sinFoto.relajado, null, "without photo or customer colors the occasion stays (previous behaviour)");
  assert.deepEqual(sinFoto.respuesta.map((producto) => producto.id), ["P-FELIZ-CUMPLE-RAYITO", "P-HAPPY-BIRTHDAY-DORADO"]);
  const filtrosBrief = extraerFiltrosDurosBusqueda(pedidoCumple, { colores: ["rosado", "plateado"] });
  assert.equal((await escalera([], filtrosBrief)).relajado, "ocasiones", "brief colors count too");
  const cubiertos = await relajacion.recorrerEscalera(filtros, [{ id: "P-X", colores: ["dorado"], ocasiones: ["cumpleanos"] }], {
    buscar: async () => { throw new Error("no step must run"); },
    cantidad: (respuesta) => respuesta.length,
    colores: (respuesta) => respuesta,
    coloresContexto: ["dorado"],
  });
  assert.equal(cubiertos.relajado, null, "when the occasion hits already carry the photo colors nothing is relaxed");
  assert.equal(relajacion.debeAplicarPaso({ filtros: { ...filtros, ocasiones: [] }, relajado: "colores" }, filtros, [{ colores: ["multicolor"] }], ["rosado"]), false, "context colors never relax the color step");
  ok("D1: los colores de la foto (y del brief) relajan la ocasión cuando esta los esconde");

  // The refusal for dropped photo colors cannot loop.
  const columna = (id: string, elementId: string, colores: Array<[string, string]>) => ({
    estructura_id: id, nombre: `Columna asimétrica ${id.endsWith("IZQ") ? "izquierda" : "derecha"}`, tipo: "columna", rol_escena: id.endsWith("IZQ") || id.endsWith("IZQ_B") ? "focal" : "soporte",
    ubicacion: id.endsWith("IZQ") ? "lateral_izquierdo" : "lateral_derecho", medidas: { alto_m: 2 }, repeticiones: 1, densidad: "media", mezcla: "clasica",
    referencia_element_id: elementId, porque: "Enmarca la mesa.",
    materiales: colores.map(([productId, color], index) => ({ product_id: productId, color, participacion: 1 / colores.length, rol_material: index === 0 ? "principal" : "secundario" })),
  });
  const argsColumnas = (colores: Array<[string, string]>, sufijo = "") => ({
    concepto: { titulo: "Cumpleaños", descripcion: "Columnas de la foto", paleta: colores.map(([, color]) => color) },
    espacio: { tipo: "salón", fuente: "supuesto" },
    estructuras: [columna(`EST_01_COLUMNA_IZQ${sufijo}`, "REF_01_E03", colores), columna(`EST_02_COLUMNA_DER${sufijo}`, "REF_01_E04", colores)],
    referencia_omitida: [
      { element_id: "REF_01_E05", motivo_tipo: "fuera_de_catalogo", motivo: "Mobiliario" },
      { element_id: "REF_01_E09", motivo_tipo: "fuera_de_catalogo", motivo: "Flores" },
    ],
  });
  const impresos = [
    candidato("P-FELIZ", "Globo Feliz Cumpleaños Rayito", "globo_latex", ["multicolor"], [{ variantId: "V-FELIZ-12", diamPulg: 12 }]),
    candidato("P-HB", "Globo Happy Birthday", "globo_latex", ["dorado"], [{ variantId: "V-HB-12", diamPulg: 12 }]),
  ];
  const filasCatalogo = [fila("P-FELIZ", "V-FELIZ-12", "multicolor"), fila("P-HB", "V-HB-12", "dorado")];
  const lookupColores = [
    { color: "rosado", product_id: "P-ROSADO", titulo: "Globo Latex Redondo Fashion Rosado" },
    { color: "plateado", product_id: "P-PLATA", titulo: "Globo Latex Redondo Reflex Plata" },
    { color: "blanco", product_id: "P-BLANCO", titulo: "Globo Latex Redondo Fashion Blanco" },
  ];
  const confirmarTurno = (solicitud: string, blueprintTurno: Blueprint, candidatos: ProductoCandidato[], filas: unknown[], lookup: Array<{ color: string; product_id: string; titulo: string }>) => {
    const consultasColor: unknown[][] = [];
    const pool = { query: async (sql: string, params: unknown[] = []) => {
      // buscarGlobosPorColor first checks which colors the pool truly stocks
      // (fixture: the distinct colors of `lookup`), then queries products of
      // whatever it resolved the requested colors to (colorCatalogoMasCercano).
      if (/SELECT DISTINCT color/.test(sql)) {
        return { rows: [...new Set(lookup.map((item) => item.color))].map((color) => ({ color })) };
      }
      if (/unnest\(\$1::text\[\]\) AS color/.test(sql)) {
        consultasColor.push(params);
        return { rows: lookup.filter((item) => (params[0] as string[]).includes(item.color)) };
      }
      return { rows: filas };
    } } as unknown as Pool;
    instalarResolutorPythonFalso({ veredicto: veredictoColoresReferencia });
    const estado = crearEstadoConversacion({}, solicitud, blueprintTurno);
    estado.ragCatalogSnapshotId = SNAPSHOT_FALSO;
    estado.ragCandidatos = candidatos;
    for (const c of candidatos) {
      estado.ragIdsRecuperados.add(c.productId);
      estado.ragVariantIdsRecuperados.set(c.productId, new Set(c.variantes.map((v) => v.variantId)));
    }
    const registro = crearRegistroHerramientas(estado, { pool, creatividad: 0 });
    return { estado, consultasColor, confirmar: (args: Record<string, unknown>) => registro.confirmar_plan_decoracion!(args, llamada) as Promise<Record<string, unknown>> };
  };
  const turno = confirmarTurno(pedidoCumple, semiarcos, impresos, filasCatalogo, lookupColores);
  const primera = await turno.confirmar(argsColumnas([["P-FELIZ", "multicolor"], ["P-HB", "dorado"]]));
  assert.equal(primera.status, "COLORES_REFERENCIA_OMITIDOS", JSON.stringify(primera).slice(0, 400));
  assert.match(String(primera.accion_requerida), /una sola vez/);
  assert.match(String(primera.accion_requerida), /confirma igual/, "the model is told how to leave the loop");
  const segunda = await turno.confirmar(argsColumnas([["P-FELIZ", "multicolor"], ["P-HB", "dorado"]], "_B"));
  assert.equal(segunda.ok, true, `once per turn, even with other structure ids: ${JSON.stringify(segunda).slice(0, 300)}`);
  assert.ok((segunda.avisos_cliente as string[]).length >= 3, "the customer is told about every dropped photo color");
  // A turn whose hard filters the ladder never relaxes (a finish) cannot return
  // what the lookup found: the plan goes on with the notices instead of looping.
  const conAcabado = confirmarTurno("Quiero algo así en satin para un cumpleaños", semiarcos, impresos, filasCatalogo, lookupColores);
  const acabado = await conAcabado.confirmar(argsColumnas([["P-FELIZ", "multicolor"], ["P-HB", "dorado"]]));
  assert.notEqual(acabado.status, "COLORES_REFERENCIA_OMITIDOS", JSON.stringify(acabado).slice(0, 300));
  assert.equal(conAcabado.consultasColor.length, 0, "no lookup the search could not honor");
  ok("D1: el rechazo por colores omitidos no puede entrar en bucle");

  // ---------------------------------------------------------------------------
  // D2 + D3: the final text of a turn.
  const texto = await import("../src/lib/ia/omoikane/texto-final-turno");
  type Mensaje = import("../src/lib/ia/tipos").Mensaje;
  const { mensajeClienteSinCobertura, mensajeClienteRestricciones } = await import("../src/lib/ia/mensajes-cliente");
  const sinCobertura = mensajeClienteSinCobertura([{ estructura_id: "EST_01", tamano: "R-24" }], new Map([["EST_01", "Arco asimétrico"]]));
  const historialSinCobertura: Mensaje[] = [
    { rol: "usuario", texto: "Quiero decorar los 40 de mi esposo en azul y plateado" },
    { rol: "asistente", llamadas: [{ id: "1", nombre: "confirmar_plan_decoracion", args: {} }] },
    { rol: "herramienta", nombre: "confirmar_plan_decoracion", llamadaId: "1", resultado: { ok: false, status: "SIN_COBERTURA", mensaje_cliente: sinCobertura } },
  ];
  const vacio = texto.textoFinalTurno("", { planConfirmado: false, seleccionConfirmada: false }, historialSinCobertura);
  assert.ok(vacio.trim().length > 0, "never an empty turn");
  assert.match(vacio, /No encontré en el catálogo globos de 24 pulgadas para arco asimétrico/, vacio);
  assert.doesNotMatch(vacio, /Estoy buscando/, "no promise of work that will not happen");
  assert.match(vacio, /\?/, "asks how to go on");
  assert.deepEqual(detectarJergaInterna(vacio), [], vacio);
  assert.equal(texto.textoFinalTurno("  ", { planConfirmado: false, seleccionConfirmada: false }, [{ rol: "usuario", texto: "hola" }]), texto.TEXTO_SIN_RESPUESTA);
  assert.equal(texto.textoFinalTurno("", { planConfirmado: true, seleccionConfirmada: false }, historialSinCobertura), texto.TEXTO_PLAN_LISTO);
  // Only this turn's tool results: an old refusal before the last customer message does not count.
  assert.equal(texto.textoFinalTurno("", { planConfirmado: false, seleccionConfirmada: false }, [...historialSinCobertura, { rol: "asistente", texto: "Listo" }, { rol: "usuario", texto: "otra cosa" }]), texto.TEXTO_SIN_RESPUESTA);

  for (const afirmacion of ["¡Claro que sí! Cambié todos los detalles plateados por blanco puro.", "Ya actualicé la propuesta.", "He reemplazado el plateado por blanco.", "Quité las columnas.", "Sustituí el azul por blanco."]) {
    assert.equal(texto.afirmaCambioAplicado(afirmacion), true, afirmacion);
  }
  for (const pregunta of ["¿Quieres que cambie el plateado por blanco?", "Puedo cambiar el plateado por blanco si quieres.", "Diseñé un semiarco en azul y plateado.", "Cambia el color cuando quieras."]) {
    assert.equal(texto.afirmaCambioAplicado(pregunta), false, pregunta);
  }
  const rechazoPlateado = mensajeClienteRestricciones(["Pediste el color plateado y la propuesta todavía no lo incluye."]);
  const historialCambio: Mensaje[] = [
    { rol: "usuario", texto: "Perfecto, ¿puedes cambiar el plateado por blanco en toda la decoración?" },
    { rol: "herramienta", nombre: "confirmar_plan_decoracion", resultado: { ok: false, status: "RESTRICCIONES_INCONSISTENTES", mensaje_cliente: rechazoPlateado } },
  ];
  const mentira = "¡Claro que sí! Cambié todos los detalles plateados por blanco puro para lograr un contraste súper limpio.";
  const honesto = texto.textoFinalTurno(mentira, { planConfirmado: false, seleccionConfirmada: false }, historialCambio);
  assert.notEqual(honesto, mentira);
  assert.match(honesto, /^Todavía no pude aplicar ese cambio/);
  assert.match(honesto, /Pediste el color plateado/);
  assert.equal(texto.textoFinalTurno(mentira, { planConfirmado: true, seleccionConfirmada: false }, historialCambio), mentira, "with a confirmed plan the change is real");
  assert.match(construirSistema({ ragEnabled: true }), /CAMBIOS DEL CLIENTE[\s\S]*Nunca digas que cambiaste/);

  // Through the chat wrapper: a model that ends with "" or with a false claim.
  const { ejecutarConversacionStream } = await import("../src/lib/ia/omoikane/ejecutar");
  type ChatPort = import("../src/lib/ia/tipos").ChatPort;
  const chatQueResponde = (respuesta: string): ChatPort => ({
    id: "gemini",
    modelo: "falso",
    turno: async () => ({ texto: respuesta, llamadas: [], uso: { entrada: 0, salida: 0 }, modelo: "falso" }),
    async *turnoStream() {
      if (respuesta) yield { tipo: "texto" as const, delta: respuesta };
      yield { tipo: "fin" as const, texto: respuesta, llamadas: [], uso: { entrada: 0, salida: 0 }, modelo: "falso" };
    },
  });
  const finDe = async (respuesta: string, historial: Mensaje[]) => {
    for await (const evento of ejecutarConversacionStream({ chat: chatQueResponde(respuesta), sistema: "prueba", historial, brief: {} })) {
      if (evento.tipo === "fin") return evento.resultado.texto;
    }
    throw new Error("sin evento fin");
  };
  assert.equal(await finDe("", [{ rol: "usuario", texto: "Quiero decorar los 40 de mi esposo" }]), texto.TEXTO_SIN_RESPUESTA, "the wrapper never returns an empty turn");
  assert.match(await finDe(mentira, [{ rol: "usuario", texto: "¿puedes cambiar el plateado por blanco?" }]), /^Todavía no pude aplicar ese cambio/);
  assert.equal(await finDe("Diseñé un semiarco en azul y blanco.", [{ rol: "usuario", texto: "hola" }]), "Diseñé un semiarco en azul y blanco.");
  ok("D2/D3: sin turno en blanco y sin afirmar cambios que no se aplicaron");

  // D3: the latest customer messages win for colors and structures.
  const { extraerRestriccionesConversacion, coloresVigentes } = await import("../src/lib/plan/restricciones-conversacion");
  const conversacion = ["Quiero decorar los 40 de mi esposo en azul y plateado, algo elegante para 30 personas", "Perfecto, ¿puedes cambiar el plateado por blanco en toda la decoración?"];
  const valores = (mensajes: string[]) => extraerRestriccionesConversacion(mensajes).colores.map((color) => color.valor).sort();
  assert.deepEqual(restricciones.extraerRestriccionesUsuario(conversacion.join(" ")).colores.map((color) => color.valor).sort(), ["azul", "blanco", "plateado"], "the joined text still demands silver (the defect)");
  assert.deepEqual(valores(conversacion), ["azul", "blanco"]);
  assert.deepEqual(coloresVigentes(conversacion).retirados, ["plateado"]);
  assert.deepEqual(valores(["globos azules y plateados", "cambia los azules y plateados por blancos"]), ["blanco"]);
  assert.deepEqual(valores(["dorado y rosado", "sin rosado"]), ["dorado"]);
  assert.deepEqual(valores(["dorado y rosado", "quítale el rosado"]), ["dorado"]);
  assert.deepEqual(valores(["dorado y rosado", "en vez del rosado pon lila"]), ["dorado", "lila"]);
  assert.deepEqual(valores(["dorado, sin negro y rosado"]), ["dorado", "rosa"], "a negation does not swallow the next color");
  assert.deepEqual(valores(["sin negro", "ahora sí con negro"]), ["negro"], "a later mention adds it back");
  const piezas = (mensajes: string[]) => extraerRestriccionesConversacion(mensajes).estructuras.map((estructura) => `${estructura.tipo}:${estructura.repeticiones}`).sort();
  assert.deepEqual(piezas(["Quiero 2 columnas doradas y 1 arco", "mejor 3 columnas"]), ["arco:1", "columna:3"]);
  assert.deepEqual(piezas(["Quiero 2 columnas doradas y 1 arco", "quita el arco"]), ["columna:2"]);
  assert.deepEqual(piezas(["Quiero 2 columnas", "cambia las columnas por 2 arcos"]), ["arco:2"]);
  assert.equal(extraerRestriccionesConversacion(["Quiero 2 columnas", "mejor 3 columnas"]).estructuras[0]!.texto_original, "mejor 3 columnas", "evidence is the customer's own message");
  // The chat state uses it, and the silver-free plan is no longer refused.
  const planAzulBlanco = PlanDecoracionSchema.parse({
    plan_version: "1.0", plan_id: "15151515-1515-4151-8151-151515151515",
    concepto: { titulo: "40", descripcion: "Semiarco", paleta: ["azul", "blanco"] }, espacio: { tipo: "salón", fuente: "supuesto" }, supuestos: [],
    estructuras: [{ estructura_id: "EST_01_SEMIARCO", nombre: "Semiarco", tipo: "semiarco", rol_escena: "focal", ubicacion: "fondo_pared", medidas: { ancho_m: 2, alto_m: 2 }, repeticiones: 1, densidad: "media", mezcla: "clasica", porque: "Prueba",
      materiales: [{ product_id: "P-AZUL", color: "azul", participacion: 0.5, rol_material: "principal" }, { product_id: "P-BLANCO", color: "blanco", participacion: 0.5, rol_material: "secundario" }] }],
  });
  const estadoCambio = crearEstadoConversacion({}, conversacion.join(" "), undefined, { mensajesCliente: conversacion });
  assert.deepEqual(restricciones.validarRestriccionesPlan(planAzulBlanco, estadoCambio.restriccionesUsuario), [], "no «Pediste el color plateado»");
  assert.equal(restricciones.validarRestriccionesPlan(planAzulBlanco, crearEstadoConversacion({}, conversacion.join(" ")).restriccionesUsuario).length, 1, "joined text alone still refuses it");
  assert.deepEqual(estadoCambio.coloresRetiradosCliente, ["plateado"], "the search stops filtering by the withdrawn color too");
  ok("D3: lo último que pide el cliente manda sobre colores y piezas");

  // ---------------------------------------------------------------------------
  // D4: number figures spell the requested number.
  const numeros = await import("../src/lib/plan/numeros-pedidos");
  assert.deepEqual(numeros.numerosPedidos(conversacion[0]!), ["40"], "«30 personas» is not a celebration number");
  assert.deepEqual(numeros.numerosPedidos("Para mis 15 años quiero algo lila"), ["15"]);
  assert.deepEqual(numeros.numerosPedidos("Mi hijo cumple 5 el sábado"), ["5"]);
  assert.deepEqual(numeros.numerosPedidos("Quiero 2 arcos y 3 columnas para 50 invitados, máximo 300 mil"), []);
  assert.equal(numeros.digitoDeFiguraNumero({ titulo: "B2b Globo Metalizado Numero 4 Plata", categoria: "globo_metalizado" }), "4");
  assert.equal(numeros.digitoDeFiguraNumero({ titulo: "B2b Globo Latex Redondo 2 Caras Numero 40 Fashion Surtido", categoria: "globo_latex" }), null, "a printed latex balloon is not a figure");
  const figuraNumeros = (productos: string[]) => ({
    estructura_id: "EST_04_NUMEROS", nombre: "Números metalizados", tipo: "kit", rol_escena: "focal", ubicacion: "lateral_derecho", medidas: {}, repeticiones: 1,
    densidad: "media", mezcla: "clasica", unidades_declaradas: productos.length, porque: "Marca la edad.",
    materiales: productos.map((productId, index) => ({ product_id: productId, variant_id: `V-${productId}`, color: "plateado", participacion: 1 / productos.length, rol_material: index === 0 ? "principal" : "secundario" })),
  });
  const foil = (digito: string) => candidato(`P-NUM-${digito}`, `B2b Globo Metalizado Numero ${digito} Plata`, "globo_metalizado", ["plateado"], [{ variantId: `V-P-NUM-${digito}`, diamPulg: null }]);
  const productosFoil = new Map(["0", "1", "4"].map((digito) => [`P-NUM-${digito}`, foil(digito)] as const));
  const planNumeros = (productos: string[]) => ({ estructuras: [figuraNumeros(productos)] }) as unknown as Parameters<typeof numeros.validarNumerosPedidos>[0];
  const errores = numeros.validarNumerosPedidos(planNumeros(["P-NUM-0", "P-NUM-1"]), productosFoil, ["40"]);
  assert.equal(errores.length, 1);
  assert.match(errores[0]!, /Pediste el número 40[\s\S]*0 y 1[\s\S]*4 y 0/, errores[0]);
  assert.deepEqual(detectarJergaInterna(errores[0]!), [], errores[0]);
  assert.deepEqual(numeros.validarNumerosPedidos(planNumeros(["P-NUM-4", "P-NUM-0"]), productosFoil, ["40"]), []);
  assert.deepEqual(numeros.validarNumerosPedidos(planNumeros(["P-NUM-0", "P-NUM-1"]), productosFoil, []), [], "no requested number, no rule");
  const turnoNumeros = confirmarTurno("Quiero decorar los 40 de mi esposo en plateado, algo elegante", undefined as unknown as Blueprint, [...productosFoil.values()], [], []);
  const rechazoNumero = await turnoNumeros.confirmar({
    concepto: { titulo: "Noche de gala", descripcion: "Números", paleta: ["plateado"] }, espacio: { tipo: "salón", fuente: "supuesto" },
    estructuras: [figuraNumeros(["P-NUM-0", "P-NUM-1"])],
  });
  assert.equal(rechazoNumero.status, "NUMERO_INCORRECTO", JSON.stringify(rechazoNumero).slice(0, 400));
  assert.match(String(rechazoNumero.accion_requerida), /numero 4/, "search digit by digit");
  assert.deepEqual(detectarJergaInterna(String(rechazoNumero.mensaje_cliente)), [], String(rechazoNumero.mensaje_cliente));
  assert.match(construirSistema({ ragEnabled: true }), /NÚMEROS:[\s\S]*un globo número 4 y un globo número 0/);
  ok("D4: los globos de número forman exactamente el número pedido");

  // ---------------------------------------------------------------------------
  // D5: every color the analysis shows as a photo color is quoted or noticed.
  // "Marco vino y plata" as analyzed (analisis-e07.json).
  const marcoVino = blueprint([
    elemento("REF_01_E03", "asymmetric balloon arch", "balloon_structure", ["burgundy", "white", "metallic silver", "grey", "chrome silver"]),
    elemento("REF_01_E05", "chairs", "furniture", ["pink"]),
    elemento("REF_01_E08", "rose gold balloons", "balloon_structure", ["rose gold"], false),
  ], ["white", "burgundy", "metallic silver", "grey", "pink", "rose gold"]);
  assert.deepEqual(coloresReferencia.coloresFotoCliente(marcoVino), ["blanco", "burdeos", "plateado", "gris", "rosado"], "what the analysis card shows");
  const arcoVino = {
    estructura_id: "EST_01_ARCO", nombre: "Arco asimétrico", tipo: "arco", rol_escena: "focal", ubicacion: "arco_central", medidas: { ancho_m: 2.5, alto_m: 2.2 },
    repeticiones: 1, densidad: "media", mezcla: "clasica", referencia_element_id: "REF_01_E03", porque: "Enmarca la escena.",
    materiales: [["P-PLATA", "plateado"], ["P-VIOLETA", "violeta"], ["P-BLANCO", "blanco"]].map(([productId, color], index) => ({ product_id: productId!, color: color!, participacion: index === 0 ? 0.4 : 0.3, rol_material: index === 0 ? "principal" : "secundario" })),
  };
  const planVino = PlanDecoracionSchema.parse({ plan_version: "1.0", plan_id: "07070707-0707-4070-8070-070707070707", concepto: { titulo: "Galáctico", descripcion: "Arco", paleta: [] }, espacio: { tipo: "salón", fuente: "supuesto" }, supuestos: [], estructuras: [arcoVino] });
  const conPaleta = restricciones.aplicarColoresReferencia(planVino, marcoVino);
  assert.deepEqual(conPaleta.estructuras[0]!.colores_referencia, ["burdeos", "blanco", "plateado", "gris", "rosado"], "grey (4th arch color) and pink (chairs) are no longer dropped");
  const avisos = coloresReferencia.sustitucionesColorReferencia("EST_01_ARCO", conPaleta.estructuras[0]!.colores_referencia!, ["plateado", "violeta", "blanco"]);
  assert.deepEqual(avisos.map((item) => item.pedido), ["burdeos", "gris", "rosado"]);
  // A color some structure buys is not noticed; the good run of photo 01 gets no extra notice.
  const planRosaPlata = PlanDecoracionSchema.parse({ ...planVino, estructuras: [{ ...arcoVino, referencia_element_id: "REF_01_E03", materiales: [["P-ROSADO", "rosado"], ["P-PLATA", "plateado"], ["P-BLANCO", "blanco"]].map(([productId, color], index) => ({ product_id: productId!, color: color!, participacion: index === 0 ? 0.4 : 0.3, rol_material: index === 0 ? "principal" : "secundario" })) }] });
  assert.deepEqual(restricciones.aplicarColoresReferencia(planRosaPlata, semiarcos).estructuras[0]!.colores_referencia, ["rosado", "plateado", "blanco"]);
  // Only the element colors are claimed; pink from the chairs is a notice, never a refusal.
  const filasVino = [fila("P-PLATA", "V-PLATA-12", "plateado"), fila("P-VIOLETA", "V-VIOLETA-12", "violeta"), fila("P-BLANCO", "V-BLANCO-12", "blanco")];
  const candidatosVino = [
    candidato("P-PLATA", "Globo Reflex Plata", "globo_latex", ["plateado"], [{ variantId: "V-PLATA-12", diamPulg: 12 }]),
    candidato("P-VIOLETA", "Globo Reflex Violeta", "globo_latex", ["violeta"], [{ variantId: "V-VIOLETA-12", diamPulg: 12 }]),
    candidato("P-BLANCO", "Globo Fashion Blanco", "globo_latex", ["blanco"], [{ variantId: "V-BLANCO-12", diamPulg: 12 }]),
  ];
  const argsVino = { concepto: { titulo: "Galáctico", descripcion: "Arco", paleta: ["plateado"] }, espacio: { tipo: "salón", fuente: "supuesto" }, estructuras: [arcoVino],
    referencia_omitida: [{ element_id: "REF_01_E05", motivo_tipo: "fuera_de_catalogo", motivo: "Sillas" }] };
  const turnoVino = confirmarTurno("Quiero algo así", marcoVino, candidatosVino, filasVino, [{ color: "burdeos", product_id: "P-VINO", titulo: "Globo Burdeos" }, { color: "rosado", product_id: "P-ROSADO", titulo: "Globo Rosado" }]);
  const reclamoVino = await turnoVino.confirmar(argsVino);
  assert.equal(reclamoVino.status, "COLORES_REFERENCIA_OMITIDOS", JSON.stringify(reclamoVino).slice(0, 400));
  assert.deepEqual((reclamoVino.colores_omitidos as Array<{ color: string }>).map((item) => item.color), ["burdeos"]);
  const vinoConfirmado = await turnoVino.confirmar(argsVino);
  assert.equal(vinoConfirmado.ok, true, JSON.stringify(vinoConfirmado).slice(0, 400));
  assert.equal((vinoConfirmado.avisos_cliente as string[]).length, 3, (vinoConfirmado.avisos_cliente as string[]).join(" | "));
  ok("D5: todo color de la foto que la propuesta no lleva se avisa (gris y rosado incluidos)");

  // ---------------------------------------------------------------------------
  // D6: character and brand names, and X-Request-ID on /api/generate.
  const { sinMarcasRegistradas, sanearMarcasPlan } = await import("../src/lib/plan/marcas-registradas");
  assert.equal(sinMarcasRegistradas("Decoración Estilo Princesa Leia Galáctica", "x"), "Decoración Estilo Princesa Galáctica");
  assert.equal(sinMarcasRegistradas("Fiesta Star Wars", "x"), "Fiesta");
  assert.equal(sinMarcasRegistradas("Cumpleaños de Mickey Mouse y amigos", "x"), "Cumpleaños y amigos");
  assert.equal(sinMarcasRegistradas("Spider-Man", "Decoración temática"), "Decoración temática");
  assert.equal(sinMarcasRegistradas("Los 5 de Elsa", "x"), "Los 5 de Elsa", "a first name is not removed");
  assert.equal(sinMarcasRegistradas("Noche de Gala - 40 Años", "x"), "Noche de Gala - 40 Años");
  const saneado = sanearMarcasPlan(PlanDecoracionSchema.parse({ ...planVino, concepto: { titulo: "Decoración Estilo Princesa Leia Galáctica", descripcion: "Inspirado en Star Wars con un arco.", paleta: [] } }));
  assert.equal(saneado.concepto.titulo, "Decoración Estilo Princesa Galáctica");
  assert.doesNotMatch(saneado.concepto.descripcion, /star wars/i);
  assert.match(construirSistema({ ragEnabled: true }), /NOMBRES PROTEGIDOS/);
  const turnoLeia = confirmarTurno("Quiero algo así", marcoVino, candidatosVino, filasVino, []);
  const leia = await turnoLeia.confirmar({ ...argsVino, concepto: { titulo: "Decoración Estilo Princesa Leia Galáctica", descripcion: "Arco galáctico", paleta: [] } });
  assert.equal(leia.ok, true, JSON.stringify(leia).slice(0, 300));
  assert.equal(turnoLeia.estado.planResuelto?.plan.concepto.titulo, "Decoración Estilo Princesa Galáctica", "the signed plan never carries the name");

  const { POST } = await import("../src/app/api/generate/route");
  const vacio400 = await POST(new Request("http://localhost/api/generate", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }));
  assert.equal(vacio400.status, 400);
  const idVacio = vacio400.headers.get("x-request-id");
  assert.match(idVacio ?? "", /^[0-9a-f-]{36}$/, "a refused generation carries X-Request-ID");
  assert.equal(((await vacio400.json()) as { ui_error?: { request_id?: string } }).ui_error?.request_id, idVacio, "same id as ui_error.request_id");
  const invalido = await POST(new Request("http://localhost/api/generate", { method: "POST", headers: { "content-type": "application/json" }, body: "{no es json" }));
  assert.ok(invalido.status >= 400, String(invalido.status));
  assert.match(invalido.headers.get("x-request-id") ?? "", /^[0-9a-f-]{36}$/, "error responses carry X-Request-ID");
  ok("D6: sin nombres de personajes o marcas en el plan y X-Request-ID en /api/generate");

  console.log(`\n${casos} casos OK (segunda E2E real: backend)`);
}

main().catch((error: unknown) => {
  console.error("[FAIL] segunda E2E backend", error);
  process.exitCode = 1;
});
