/**
 * Backend defects of the third real E2E run (2026-09-15, iteration 4). The
 * main demo flow ("Semiarcos rosa y plata" + "Quiero algo así para un
 * cumpleaños") failed 4 of 5 real runs:
 *
 * - D1 `guardar_brief` stored invented keys ("estilo_decorativo", "paleta") and
 *   the strict `fin` event rejected the brief: "No pude responder".
 * - D2 SIN_COBERTURA + COLORES_REFERENCIA_OMITIDOS looped until the 75 s
 *   deadline: the LoRA catalog only has some sizes of each balloon.
 * - D3 the size of the original request ("globos de 24 pulgadas") filtered
 *   every later search.
 * - D4 Fashion Gris is filed as "plateado": false grey notice / no coverage.
 * - D5 the "4" in gold is not in the LoRA catalog and nothing else was offered.
 *
 * No network, no database, no providers.
 * Run: npx tsx --conditions=react-server scripts/test-tercera-e2e-backend.ts
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

// A fake pool: nothing in this script may reach a real database.
const poolVacio = { query: async () => ({ rows: [] }) } as unknown as Pool;
(globalThis as { __ragPool?: Pool }).__ragPool = poolVacio;

async function main(): Promise<void> {
  const { crearEstadoConversacion, crearRegistroHerramientas, ACCION_NUMERO_INCORRECTO, ACCION_NUMEROS_EN_CATALOGO } = await import("../src/lib/ia/registro-herramientas");
  const { ChatFinishEventV1Schema } = await import("../src/lib/ia/contracts/chat-v1");
  const { ReferenceBlueprintV2Schema } = await import("../src/lib/ia/reference-blueprint");
  const brief = await import("../src/lib/ia/brief-herramienta");
  const convergencia = await import("../src/lib/ia/convergencia-plan");
  const { filtrosDurosDeBusqueda, avisoFiltrosBusqueda } = await import("../src/lib/rag/chat/filtros-turno");
  const { coloresRealesProducto } = await import("../src/lib/plan/colores-producto");
  const { candidatoDesdePython } = await import("../src/lib/rag/chat/candidato-python");
  const { buscarNumerosPorDigito, digitosBuscados } = await import("../src/lib/rag/catalog/numeros-por-digito");
  const { buscarGlobosPorColor } = await import("../src/lib/rag/catalog/globos-por-color");
  const { esperarObservabilidadPendiente } = await import("../src/lib/rag/observability/log");
  const { construirSistema } = await import("../src/lib/ia/prompt-sistema");
  const { ejecutarConversacionStream } = await import("@sempertex/agente-core");
  type ProductoCandidato = import("../src/lib/rag/chat/buscar").ProductoCandidato;
  type Blueprint = import("../src/lib/ia/reference-blueprint").ReferenceBlueprintV2;
  type ChatPort = import("@sempertex/agente-core").ChatPort;
  type FragmentoChat = import("@sempertex/agente-core").FragmentoChat;

  // ---------------------------------------------------------------------------
  // D1: invented brief keys never reach the terminal event.
  const invento = brief.normalizarArgsBrief({ estilo_decorativo: "elegante orgánico", paleta: ["rosado", "plateado"], tipo_evento: "cumpleaños", invitados: "30", mood: "fiesta", fecha: "" });
  assert.deepEqual(invento.brief, { estilo: "elegante orgánico", colores: ["rosado", "plateado"], tipo_evento: "cumpleaños", invitados: 30 });
  assert.deepEqual(invento.descartadas.sort(), ["fecha", "mood"]);
  assert.equal(brief.normalizarArgsBrief({ estilo: "boho", estilo_decoracion: "rústico" }).brief.estilo, "boho", "an exact field wins over a synonym");
  assert.deepEqual(brief.normalizarArgsBrief({ colores: "rosado, plateado y blanco" }).brief.colores, ["rosado", "plateado", "blanco"]);
  assert.deepEqual(brief.normalizarArgsBrief({ tipoEvento: "boda", numeroInvitados: 80 }).brief, { tipo_evento: "boda", invitados: 80 }, "camelCase keys map too");
  const estadoBrief = crearEstadoConversacion({}, "Quiero algo así para un cumpleaños");
  const registroBrief = crearRegistroHerramientas(estadoBrief, { pool: poolVacio });
  const guardado = await registroBrief.guardar_brief!({ estilo_decoracion: "elegante", estilo_decorativo: "orgánico", paleta: ["rosado", "plateado", "blanco", "transparente"], tipo_evento: "cumpleaños" }, { nombre: "guardar_brief", args: {} });
  assert.deepEqual(guardado.campos_ignorados, undefined, "synonyms are mapped, not ignored");
  const fin = {
    schema_version: "chat.sse.v1", type: "fin", request_id: crypto.randomUUID(), correlation_id: crypto.randomUUID(),
    reply: "ok", brief: estadoBrief.brief, proveedor: "gemini", modelo: "fake",
  };
  const parseadoFin = ChatFinishEventV1Schema.safeParse(fin);
  assert.ok(parseadoFin.success, `the fin event accepts the stored brief: ${JSON.stringify(parseadoFin.error?.issues)}`);
  assert.ok(ChatFinishEventV1Schema.safeParse({ ...fin, brief: brief.sanearBrief({ estilo_decorativo: "x", tema_color: 3, invitados: -1 }) }).success, "sanearBrief always yields a valid brief");
  ok("D1: guardar_brief normaliza sinónimos y descarta claves inventadas; el fin siempre valida");

  // ---------------------------------------------------------------------------
  // D2: the catalog of the failing runs (LoRA training_1, Neon 2026-09-15).
  const elemento = (id: string, name: string, category: string, colores: string[]) => ({
    element_id: id, source_image_id: "REF_01", name, category,
    scene_role: "midground", detection_confidence: 0.9, visible_evidence: name,
    reference_bbox: { x: 0.1, y: 0.1, width: 0.3, height: 0.8 }, depth_layer: 1,
    include_policy: "include", approved: true, source_type: "reference_only",
    quantity: { mode: "exact", min: 1, max: 1 },
    appearance: { observed_colors: colores, resolved_colors: [], color_policy: "match_reference", material: "latex", shape: name, composition: "mixed" },
    relationships: [], uncertainties: [],
  });
  const blueprint = (colores: string[]): Blueprint => ReferenceBlueprintV2Schema.parse({
    schema_version: "2.0",
    source_images: [{ image_id: "REF_01", approved_roles: ["composition_reference"] }],
    elements: [
      elemento("REF_01_E01", "left asymmetric balloon column", "balloon_structure", colores),
      elemento("REF_01_E02", "right asymmetric balloon column", "balloon_structure", colores),
    ],
    composition: { focal_point: "mesa", density: "moderate", symmetry: "unknown", negative_space: [] },
    palette: { observed: colores, priority: colores },
    unresolved_decisions: [],
  });
  const tamanosCatalogo: Record<string, { titulo: string; colores: string[]; diametros: number[]; acabados?: string[] }> = {
    "P-ROSADO": { titulo: "B2b Globo Latex Redondo Fashion Rosado", colores: ["rosado"], diametros: [5, 9, 12, 18, 24], acabados: ["fashion"] },
    "P-PLATA": { titulo: "B2b Globo Latex Redondo Reflex Plata", colores: ["plateado"], diametros: [5, 9, 12, 18, 24], acabados: ["reflex"] },
    "P-TRANSP": { titulo: "B2b Globo Latex Redondo Fashion Transparente", colores: ["transparente"], diametros: [9, 18, 24] },
    // Derived catalog colors file this grey balloon under "plateado".
    "P-GRIS": { titulo: "B2b Globo Latex Redondo Fashion Gris", colores: ["plateado"], diametros: [5, 12] },
    "P-AZUL": { titulo: "B2b Globo Latex Redondo Cristal Pastel Azul", colores: ["azul"], diametros: [5] },
    "P-LILA": { titulo: "B2b Globo Latex Redondo Fashion Lila", colores: ["lila"], diametros: [5, 9, 12, 18, 24] },
  };
  const filas = Object.entries(tamanosCatalogo).flatMap(([productId, producto]) => producto.diametros.map((diametro) => ({
    product_id: productId, variant_id: `${productId}-${diametro}`, sku: `SKU-${productId}-${diametro}`, sku_original: null, source_snapshot_id: null, source_variant_id: null, inventory_quantity: null, unidades_inferidas: null,
    producto_titulo: producto.titulo, variante_titulo: `R-${diametro}`, precio: 4000 + diametro * 100, unidades_paq: 12, disponible: true, producto_disponible: true,
    codigo_tamano: `R-${diametro}`, forma: "redondo", diam_pulg: diametro, colores_producto: producto.colores, colores_variante: [], acabados_producto: producto.acabados ?? [], descripcion: null, imagen: null,
  })));
  // Candidates exactly as the chat sees them after the Python search mapping.
  const candidato = (productId: string): ProductoCandidato => {
    const producto = tamanosCatalogo[productId]!;
    return candidatoDesdePython({
      product_id: productId, title: producto.titulo, category: "globo_latex", colors: producto.colores, finishes: producto.acabados ?? [], occasions: [], available: true, image: null,
      variants: producto.diametros.map((diametro) => ({ variant_id: `${productId}-${diametro}`, sku: null, title: null, price: 4000, available: true, size_code: `R-${diametro}`, diameter_inches: diametro, shape: "redondo", colors: [] })),
    });
  };
  const columna = (id: string, elementId: string, mezcla: string, materiales: Array<[string, string, number]>) => ({
    estructura_id: id, nombre: id.endsWith("IZQ") ? "Columna asimétrica izquierda" : "Columna asimétrica derecha", tipo: "columna", rol_escena: id.endsWith("IZQ") ? "focal" : "soporte",
    ubicacion: id.endsWith("IZQ") ? "lateral_izquierdo" : "lateral_derecho", medidas: { alto_m: 2 }, repeticiones: 1, densidad: "media", mezcla,
    referencia_element_id: elementId, porque: "Enmarca la mesa.",
    materiales: materiales.map(([productId, color, participacion], index) => ({ product_id: productId, color, participacion, rol_material: index === 0 ? "principal" : "secundario" })),
  });
  const plan = (mezcla: string, materiales: Array<[string, string, number]>) => ({
    concepto: { titulo: "Cumpleaños", descripcion: "Columnas de la foto", paleta: materiales.map(([, color]) => color) },
    espacio: { tipo: "salón", fuente: "supuesto" },
    estructuras: [columna("EST_01_COLUMNA_IZQ", "REF_01_E01", mezcla, materiales), columna("EST_02_COLUMNA_DER", "REF_01_E02", mezcla, materiales)],
    referencia_omitida: [],
  });
  const llamada = { nombre: "confirmar_plan_decoracion", args: {} };
  const turno = (opciones: { colores: string[]; candidatos: string[]; whitelistExtra?: Record<string, string[]>; hechosPeticion?: { tieneReferencia?: boolean; tieneFotoEspacio?: boolean; loraMode?: string; superficie?: string } }) => {
    const auditorias: unknown[][] = [];
    const pool = { query: async (sql: string, params: unknown[] = []) => {
      if (/INSERT INTO plan_audit_log/.test(sql)) auditorias.push(params);
      return /unnest\(\$1::text\[\]\) AS color/.test(sql) ? { rows: [] } : { rows: filas };
    } } as unknown as Pool;
    const estado = crearEstadoConversacion({}, "Quiero algo así para un cumpleaños", blueprint(opciones.colores));
    estado.ragCandidatos = opciones.candidatos.map(candidato);
    for (const c of estado.ragCandidatos) {
      estado.ragIdsRecuperados.add(c.productId);
      estado.ragVariantIdsRecuperados.set(c.productId, new Set(c.variantes.map((v) => v.variantId)));
    }
    for (const [productId, variantes] of Object.entries(opciones.whitelistExtra ?? {})) {
      estado.ragIdsRecuperados.add(productId);
      estado.ragVariantIdsRecuperados.set(productId, new Set(variantes));
    }
    const registro = crearRegistroHerramientas(estado, { pool, creatividad: 2, hechosPeticion: opciones.hechosPeticion });
    return { estado, auditorias, confirmar: (args: Record<string, unknown>) => registro.confirmar_plan_decoracion!(args, llamada) as Promise<Record<string, unknown>> };
  };
  const tamanos = (respuesta: Record<string, unknown>) => (respuesta.estructuras as Array<{ tamanos: string[] }>).flatMap((estructura) => estructura.tamanos.map((tamano) => tamano.split("×")[0]));

  // The clear balloon has no R-5: organica_fina became SIN_COBERTURA (rid ed4f9eb8).
  const mezcla = turno({ colores: ["light pink", "chrome silver", "white"], candidatos: ["P-ROSADO", "P-PLATA", "P-TRANSP"] });
  const conTransparente = await mezcla.confirmar(plan("organica_fina", [["P-ROSADO", "rosado", 0.5], ["P-PLATA", "plateado", 0.3], ["P-TRANSP", "transparente", 0.2]]));
  assert.equal(conTransparente.ok, true, `a close mix every material covers is chosen: ${JSON.stringify(conTransparente).slice(0, 500)}`);
  assert.ok(!tamanos(conTransparente).includes("R-5"), "organica_gruesa has no R-5");
  assert.ok(mezcla.estado.ajustesCobertura.some((ajuste) => ajuste.tipo === "mezcla" && ajuste.despues === "organica_gruesa"), JSON.stringify(mezcla.estado.ajustesCobertura));
  assert.equal(mezcla.estado.planResuelto?.plan.estructuras[0]?.mezcla, "organica_gruesa", "the signed plan carries the adjusted mix");
  ok("D2: una mezcla cercana que cubren todos los materiales reemplaza a la que deja SIN_COBERTURA");

  // Fashion Gris only has R-5 and R-12: the grey leaves the organic columns with a notice.
  const gris = turno({ colores: ["light pink", "chrome silver", "white"], candidatos: ["P-ROSADO", "P-PLATA", "P-GRIS"] });
  const conGris = await gris.confirmar(plan("organica_fina", [["P-ROSADO", "rosado", 0.5], ["P-PLATA", "plateado", 0.3], ["P-GRIS", "gris", 0.2]]));
  assert.equal(conGris.ok, true, JSON.stringify(conGris).slice(0, 500));
  assert.ok((conGris.avisos_cliente as string[]).some((aviso) => /No tengo globos gris en los tamaños que necesita columna asimétrica/.test(aviso)), JSON.stringify(conGris.avisos_cliente));
  assert.ok(tamanos(conGris).includes("R-5"), "the main material keeps the chosen organica_fina");
  const materialesGris = gris.estado.planResuelto!.plan.estructuras[0]!.materiales;
  assert.deepEqual(materialesGris.map((material) => material.product_id), ["P-ROSADO", "P-PLATA"]);
  assert.ok(Math.abs(materialesGris.reduce((suma, material) => suma + (material.participacion ?? 0), 0) - 1) < 1e-9, "shares still add up to 1");
  // The model wrote "satin" for Fashion Rosado and Fashion Blanco: every size uncovered (rid 0acd0eb6).
  const satin = turno({ colores: ["light pink", "chrome silver", "white"], candidatos: ["P-ROSADO", "P-PLATA"] });
  const planSatin = plan("organica_fina", [["P-ROSADO", "rosado", 0.6], ["P-PLATA", "plateado", 0.4]]);
  planSatin.estructuras = planSatin.estructuras.map((estructura) => ({ ...estructura, materiales: estructura.materiales.map((material, indice) => ({ ...material, acabado: indice === 0 ? "satin" : "reflex" })) }));
  const conSatin = await satin.confirmar(planSatin);
  assert.equal(conSatin.ok, true, JSON.stringify(conSatin).slice(0, 400));
  assert.ok(satin.estado.ajustesCobertura.some((ajuste) => ajuste.tipo === "acabado_material" && ajuste.antes === "satin"));
  ok("D2: el material que no tiene los tamaños de la pieza sale con aviso al cliente; un acabado que el producto no tiene se ignora");

  // A photo color whose only product cannot build the structure is not claimed.
  const azul = turno({ colores: ["light pink", "chrome silver", "blue"], candidatos: ["P-ROSADO", "P-PLATA", "P-AZUL"] });
  const sinAzul = await azul.confirmar(plan("organica_fina", [["P-ROSADO", "rosado", 0.6], ["P-PLATA", "plateado", 0.4]]));
  assert.notEqual(sinAzul.status, "COLORES_REFERENCIA_OMITIDOS", `R-5-only blue cannot build a column: ${JSON.stringify(sinAzul).slice(0, 400)}`);
  assert.equal(sinAzul.ok, true);
  assert.ok((sinAzul.avisos_cliente as string[]).some((aviso) => /muestra azul/.test(aviso)), "the customer is still told");
  ok("D2: COLORES_REFERENCIA_OMITIDOS no reclama un color sin cobertura de tamaño (no contradice SIN_COBERTURA)");

  // Convergence: after two refusals an uncovered material leaves instead of a third refusal.
  const lila = { "P-LILA": ["P-LILA-12"] };
  const repetido = turno({ colores: ["light pink", "chrome silver", "white"], candidatos: ["P-ROSADO", "P-PLATA"], whitelistExtra: lila });
  const conLila = plan("organica_fina", [["P-ROSADO", "rosado", 0.5], ["P-PLATA", "plateado", 0.3], ["P-LILA", "lila", 0.2]]);
  assert.equal((await repetido.confirmar(conLila)).status, "SIN_COBERTURA");
  assert.equal((await repetido.confirmar(conLila)).status, "SIN_COBERTURA");
  const tercero = await repetido.confirmar(conLila);
  assert.equal(tercero.ok, true, `third attempt converges: ${JSON.stringify(tercero).slice(0, 400)}`);
  assert.ok((tercero.avisos_cliente as string[]).some((aviso) => /No tengo globos lila en todos los tamaños/.test(aviso)), JSON.stringify(tercero.avisos_cliente));
  // Unrepairable refusals stop after RECHAZOS_MAXIMOS: the model must answer the customer.
  const sinSalida = turno({ colores: ["light pink", "chrome silver", "white"], candidatos: [], whitelistExtra: lila, hechosPeticion: { tieneReferencia: true, tieneFotoEspacio: false, loraMode: "training_1", superficie: "/api/chat" } });
  const soloLila = plan("organica_fina", [["P-LILA", "lila", 1]]);
  const estados: unknown[] = [];
  for (let intento = 0; intento < convergencia.RECHAZOS_MAXIMOS + 1; intento += 1) estados.push((await sinSalida.confirmar(soloLila)).status);
  assert.deepEqual(estados.slice(0, convergencia.RECHAZOS_MAXIMOS - 1), Array(convergencia.RECHAZOS_MAXIMOS - 1).fill("SIN_COBERTURA"));
  assert.equal(estados.at(-1), "PLAN_NO_CONVERGE", JSON.stringify(estados));
  ok("D2: salvaguarda de convergencia (acepta con avisos tras 2 rechazos; corta tras 4)");

  // A0.1: PLAN_NO_CONVERGE is audited, and every audit row carries the request
  // facts and the refusals counted so far (columns of migration 024).
  await esperarObservabilidadPendiente();
  const COL = { status: 15, tieneReferencia: 21, tieneFotoEspacio: 22, loraMode: 23, motor: 24, claseRechazo: 25, rechazosTurno: 26, superficie: 27 };
  const statusAuditados = sinSalida.auditorias.map((fila) => `${String(fila[COL.status])}@${String(fila[COL.rechazosTurno])}`);
  const noConverge = sinSalida.auditorias.filter((fila) => fila[COL.status] === "PLAN_NO_CONVERGE");
  assert.ok(noConverge.length >= 1, `PLAN_NO_CONVERGE audited: ${statusAuditados.join(", ")}`);
  assert.ok(noConverge.every((fila) => fila[COL.rechazosTurno] === convergencia.RECHAZOS_MAXIMOS), statusAuditados.join(", "));
  for (const fila of sinSalida.auditorias) {
    assert.equal(fila.length, 28);
    assert.deepEqual([fila[COL.tieneReferencia], fila[COL.tieneFotoEspacio], fila[COL.loraMode], fila[COL.superficie]], [true, false, "training_1", "/api/chat"]);
    assert.equal(fila[COL.motor], null, "motor_imagen_previsto has no server-side owner yet");
    assert.equal(fila[COL.claseRechazo], null, "clase_rechazo waits for the A4.1 classes");
  }
  ok("A0.1: PLAN_NO_CONVERGE auditado; filas de plan_audit_log con hechos de la petición y rechazos del turno");

  // A0.1: a plan the schema rejects is audited too, with validator paths only.
  const esquema = turno({ colores: ["light pink"], candidatos: ["P-ROSADO"] });
  const argsSensibles = { concepto: { titulo: "texto-del-modelo-no-auditable" }, estructuras: "no es una lista" };
  const rechazoEsquema = await esquema.confirmar(argsSensibles);
  assert.equal(rechazoEsquema.ok, false);
  await esperarObservabilidadPendiente();
  const filaEsquema = esquema.auditorias.find((fila) => fila[COL.status] === "PLAN_ESQUEMA_INVALIDO");
  assert.ok(filaEsquema, `schema refusal audited: ${esquema.auditorias.map((fila) => String(fila[COL.status])).join(", ")}`);
  assert.match(String(filaEsquema[16]), /estructuras/, "error keeps the validator path");
  assert.doesNotMatch(JSON.stringify(filaEsquema), /texto-del-modelo-no-auditable/, "model arguments are not stored");
  ok("A0.1: el rechazo de esquema de confirmar_plan_decoracion queda en plan_audit_log sin los argumentos del modelo");

  // The turn closes itself before the deadline, without another model call.
  assert.equal(convergencia.cierreAnticipado({ transcurridoMs: 20_000, hayPlan: false, coloresPedidos: ["rosado"], coloresDisponibles: ["rosado"] }), null);
  const pregunta = convergencia.cierreAnticipado({ transcurridoMs: 41_000, hayPlan: false, coloresPedidos: ["rosado", "plateado", "transparente"], coloresDisponibles: ["rosado", "plateado"] });
  assert.match(String(pregunta), /¿Quieres que la arme con rosado y plateado/);
  assert.equal(convergencia.cierreAnticipado({ transcurridoMs: 41_000, hayPlan: true, coloresPedidos: [], coloresDisponibles: [] }), null, "with a plan the model still writes its summary");
  let llamadasModelo = 0;
  const chatEnBucle: ChatPort = {
    id: "gemini", modelo: "fake",
    async turno() { throw new Error("not used"); },
    async *turnoStream(): AsyncGenerator<FragmentoChat> {
      llamadasModelo += 1;
      yield { tipo: "fin", texto: "", llamadas: [{ id: `c${llamadasModelo}`, nombre: "confirmar_plan_decoracion", args: {} }], uso: { entrada: 1, salida: 1 }, modelo: "fake" };
    },
  };
  let reloj = 0;
  const eventos: Array<{ tipo: string; resultado?: { texto: string } }> = [];
  for await (const evento of ejecutarConversacionStream({
    chat: chatEnBucle, sistema: "test", historial: [{ rol: "usuario", texto: "hola" }], herramientas: [],
    registro: { confirmar_plan_decoracion: async () => { reloj += 15_000; return { ok: false, status: "SIN_COBERTURA" }; } },
    cierreAnticipado: () => convergencia.cierreAnticipado({ transcurridoMs: reloj, hayPlan: false, coloresPedidos: ["rosado"], coloresDisponibles: ["rosado"] }),
    telemetria: { flujo: "evaluacion", superficie: "script:test-tercera-e2e-backend" },
  })) eventos.push(evento as { tipo: string; resultado?: { texto: string } });
  assert.equal(llamadasModelo, 3, "15 s per round: the 4th model call (past 40 s) never happens");
  assert.match(String(eventos.at(-1)?.resultado?.texto), /¿Quieres que la arme con rosado/);
  ok("D2: el turno se cierra con una pregunta útil antes del límite, sin otra llamada al modelo");

  // ---------------------------------------------------------------------------
  // D3: each search takes its size filter from its own message.
  const boda = "Decoración gigante para boda en jardín con globos de 24 pulgadas en dorado";
  const r12 = filtrosDurosDeBusqueda({ mensaje: "globo latex redondo dorado", solicitudOriginal: boda, brief: {} });
  assert.deepEqual(r12.diametros_pulgadas, [], "the 24\" of the request does not filter the search for other sizes");
  assert.ok(r12.colores.includes("dorado"), "customer colors stay locked");
  assert.deepEqual(filtrosDurosDeBusqueda({ mensaje: "globo latex dorado 24 pulgadas", solicitudOriginal: boda, brief: {} }).diametros_pulgadas, [24]);
  assert.deepEqual(filtrosDurosDeBusqueda({ mensaje: "globo latex dorado 12 pulgadas", solicitudOriginal: boda, brief: {} }).diametros_pulgadas, [], "a size the customer did not ask for never narrows the search");
  assert.deepEqual(filtrosDurosDeBusqueda({ mensaje: "globo latex azul elegante 12 pulgadas", solicitudOriginal: "Quiero decorar los 40 de mi esposo en azul y plateado", brief: {} }).diametros_pulgadas, [], "real run 70b491fc: the model's own sizes forced R-12 only");
  assert.equal(avisoFiltrosBusqueda(r12), null);
  assert.match(String(avisoFiltrosBusqueda(filtrosDurosDeBusqueda({ mensaje: "globo dorado 24 pulgadas", solicitudOriginal: boda, brief: {} }))), /No le digas al cliente que el catálogo no tiene/);
  assert.deepEqual(filtrosDurosDeBusqueda({ mensaje: "globo azul", solicitudOriginal: "40 en azul y plateado", brief: {}, coloresRetirados: ["plateado"] }).colores, ["azul"]);
  assert.match(construirSistema({ ragEnabled: true, franjasEnabled: false }), /limite_busqueda/, "the prompt forbids claiming total unavailability from a filtered search");
  ok("D3: el filtro de tamaño sale de cada búsqueda, no de la solicitud original");

  // ---------------------------------------------------------------------------
  // D4: grey is not silver.
  assert.deepEqual(coloresRealesProducto("B2b Globo Latex Redondo Fashion Gris", ["plateado"]), ["gris"]);
  assert.deepEqual(coloresRealesProducto("B2b Globo Latex Redondo Reflex Plata", ["plateado"]), ["plateado"]);
  assert.deepEqual(coloresRealesProducto("Globo Silk Nuevo Gris Medianoche", ["negro"]), ["gris", "negro"]);
  assert.deepEqual(coloresRealesProducto("Globo Gris Plata Duo", ["plateado"]), ["plateado"], "a title naming silver keeps it");
  // The model wrote "plateado" for Fashion Gris (ejemplo-07): the material and its line are grey.
  const marco = turno({ colores: ["chrome silver", "grey", "white"], candidatos: ["P-PLATA", "P-GRIS"] });
  const grisComoPlata = await marco.confirmar(plan("clasica", [["P-PLATA", "plateado", 0.6], ["P-GRIS", "plateado", 0.4]]));
  assert.equal(grisComoPlata.ok, true, JSON.stringify(grisComoPlata).slice(0, 400));
  const lineasGris = marco.estado.planResuelto!.estructuras[0]!.lineas.filter((linea) => linea.product_id === "P-GRIS");
  assert.ok(lineasGris.length > 0 && lineasGris.every((linea) => linea.color === "gris"), JSON.stringify(lineasGris.map((linea) => linea.color)));
  assert.ok(!(grisComoPlata.avisos_cliente as string[]).some((aviso) => /muestra gris/.test(aviso)), `no false grey notice: ${JSON.stringify(grisComoPlata.avisos_cliente)}`);
  assert.ok((grisComoPlata.avisos_cliente as string[]).some((aviso) => /muestra blanco/.test(aviso)));
  const plataComoGris = await buscarGlobosPorColor({ query: async () => ({ rows: [{ color: "plateado", product_id: "P-GRIS", titulo: "B2b Globo Latex Redondo Fashion Gris", diametros: [5, 12] }, { color: "plateado", product_id: "P-PLATA", titulo: "B2b Globo Latex Redondo Reflex Plata", diametros: [12] }] }) } as unknown as Pool, ["plateado"]);
  assert.deepEqual(plataComoGris.get("plateado")?.map((producto) => producto.product_id), ["P-PLATA"], "the color lookup does not offer grey as silver");
  ok("D4: gris ≠ plateado en candidatos, líneas, avisos y búsqueda de colores");

  // ---------------------------------------------------------------------------
  // D5: a digit outside the LoRA catalog in the requested color: offer the one there is.
  assert.deepEqual(digitosBuscados("globo metalizado numero 4 dorado"), ["4"]);
  assert.deepEqual(digitosBuscados("globos número 4 y numero 0 plata"), ["4", "0"]);
  const consultas: unknown[][] = [];
  const poolNumeros = { query: async (_sql: string, params: unknown[]) => {
    consultas.push(params);
    return { rows: [
      { product_id: "N4L", titulo: "B2b Globo Metalizado Numero 4 Latte", categoria: "globo_metalizado" },
      { product_id: "N40", titulo: "B2b Globo Latex Redondo 2 Caras Numero 40", categoria: "globo_latex" },
    ] };
  } } as unknown as Pool;
  const porDigito = await buscarNumerosPorDigito(poolNumeros, ["4"], { variantIds: ["V1"], catalogSnapshotId: "S1" });
  assert.deepEqual([...porDigito.entries()], [["4", ["Globo Metalizado Numero 4 Latte"]]], "printed latex balloons are not number figures");
  assert.deepEqual(consultas[0]?.slice(1), [["V1"], "S1"], "the lookup stays inside the LoRA pool and snapshot");
  assert.match(ACCION_NUMEROS_EN_CATALOGO, /ofrécele el color que sí existe/);
  assert.match(ACCION_NUMERO_INCORRECTO, /ofrécele al cliente el color en que sí está ese dígito/);
  assert.match(construirSistema({ ragEnabled: true, franjasEnabled: false }), /numeros_en_catalogo/);
  ok("D5: un dígito sin el color pedido ofrece el color disponible en vez de solo decir que no hay");

  console.log(`\n${casos} casos OK`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
