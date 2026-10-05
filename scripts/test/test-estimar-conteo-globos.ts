/**
 * `estimar_conteo_globos` en el agente de chat (ADR-0038), del lado de Next.
 *
 * - detrás de `ESTIMAR_CONTEO_V1` (encendida fuera de producción, apagada en producción) el modelo ve la
 *   herramienta, es de solo lectura y su descripción no copia ninguna regla ni tolerancia;
 * - el handler solo valida el borde y mapea: lleva el armado que `armar_estructura` guardó en el turno, el
 *   conteo de la foto como objetivo por defecto, los tamaños y las medidas del cliente, y devuelve lo que
 *   Python contestó (`scripts/fixtures/estimar-conteo/respuestas.json`, generado con `services/ai-api`);
 * - no escribe nada: el estado del turno, el plan resuelto y el token quedan como estaban;
 * - lo que el modelo puede corregir (argumentos, un armado ausente o de otro tipo, un candidato o un armado
 *   que Python rechaza) vuelve con su estado y su motivo; lo que no, no tumba el turno;
 * - el prompt lo nombra solo con la bandera y un conteo de la foto, y dice que el número del cliente sale de
 *   `confirmar_plan_decoracion`;
 * - `ESTIMACION_INCONSISTENTE` ya no manda a tocar medidas, densidad ni mezcla de una pieza con armado.
 *
 * Qué NO se prueba aquí: cuántos globos da una pieza, la tolerancia ni qué variación acerca el total. Eso es
 * de `app/estimar_conteo.py` y `tests/test_estimar_conteo.py`. Offline, sin proveedores.
 * Run: npx tsx --conditions=react-server scripts/test/test-estimar-conteo-globos.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Pool } from "pg";
import {
  instalarResolutorPythonFalso,
  prepararEntornoPythonFalso,
  SNAPSHOT_FALSO,
  type LlamadaPython,
} from "../lib/resolutor-python-falso";

prepararEntornoPythonFalso();

type Json = Record<string, unknown>;

const RUTA_ESTIMAR = "/internal/v1/plan/estimar-conteo";
const FIXTURE = JSON.parse(
  readFileSync(path.join(process.cwd(), "scripts/fixtures/estimar-conteo/respuestas.json"), "utf8"),
) as Record<string, { pregunta: Json; respuesta: Json }>;
const ARMADOS = JSON.parse(
  readFileSync(path.join(process.cwd(), "scripts/fixtures/armado-estructura-ia/respuestas.json"), "utf8"),
) as Record<string, Json>;

let casos = 0;
function ok(nombre: string): void {
  casos += 1;
  console.log(`ok ${casos} - ${nombre}`);
}

/** La envoltura operativa con la que Python contesta, con los ids que el adaptador exige de vuelta. */
function respuestaPython(llamada: LlamadaPython, payload: unknown): Response {
  const contexto = llamada.body.context as Json;
  return Response.json({
    schema_version: "operational.v1",
    request_id: contexto.request_id,
    correlation_id: contexto.correlation_id,
    payload,
  });
}

/** Un rechazo de dominio de Python, con la forma que `upstreamDomainDetails` sabe leer. */
function rechazoPython(code: string, motivo: string, mensaje: string, etiqueta: string): Response {
  return Response.json({ detail: { code, motivo, mensaje, estructura_id: etiqueta } }, { status: 422 });
}

const FILAS = [
  { product_id: "P-GLOBOS", variant_id: "V-R-12-ROSA", sku: "SKU-ROSA", producto_titulo: "Globo rosado", variante_titulo: "R-12", precio: 10000, unidades_paq: 50, disponible: true, producto_disponible: true, codigo_tamano: "R-12", forma: "redondo", diam_pulg: 12, colores_producto: ["rosado"], colores_variante: ["rosado"], acabados_producto: [], descripcion: "Globo látex rosado R-12.", imagen: null },
  { product_id: "P-GLOBOS", variant_id: "V-R-12-BLANCO", sku: "SKU-BLANCO", producto_titulo: "Globo blanco", variante_titulo: "R-12", precio: 10500, unidades_paq: 50, disponible: true, producto_disponible: true, codigo_tamano: "R-12", forma: "redondo", diam_pulg: 12, colores_producto: ["blanco"], colores_variante: ["blanco"], acabados_producto: [], descripcion: "Globo látex blanco R-12.", imagen: null },
];
const POOL = { query: async (sql: string) => (sql.includes("catalog_variants") ? { rows: FILAS } : { rows: [] }) } as unknown as Pool;
const LLAMADA = { nombre: "estimar_conteo_globos", args: {} };

const ARCO: Json = {
  estructura_id: "EST_01_ARCO",
  nombre: "Arco de cumpleaños",
  tipo: "arco",
  rol_escena: "focal",
  ubicacion: "arco_central",
  medidas: { ancho_m: 3.2, alto_m: 2.3 },
  repeticiones: 1,
  densidad: "media",
  mezcla: "clasica",
  materiales: [
    { product_id: "P-GLOBOS", color: "rosado", participacion: 0.6, rol_material: "principal" },
    { product_id: "P-GLOBOS", color: "blanco", participacion: 0.4, rol_material: "secundario" },
  ],
  porque: "Arco principal.",
};

function argsPlan(estructuras: Json[]): Json {
  return {
    concepto: { titulo: "Cumpleaños rosado", descripcion: "Arco de globos.", paleta: ["rosado", "blanco"] },
    espacio: { tipo: "salón", fuente: "supuesto" },
    estructuras,
    supuestos: [],
  };
}

/** Lo que el turno guarda y esta herramienta no puede tocar. */
function huella(estado: Json): string {
  const { planResuelto, seleccionFinalIA, herramientaComercialUsada, rechazosPlan, armadosEstructura, planVigente } = estado as {
    planResuelto?: unknown; seleccionFinalIA?: unknown; herramientaComercialUsada?: unknown; rechazosPlan?: unknown; armadosEstructura?: Map<string, unknown>; planVigente?: unknown;
  };
  return JSON.stringify({ planResuelto, seleccionFinalIA, herramientaComercialUsada, rechazosPlan, planVigente, armados: [...(armadosEstructura ?? new Map())] });
}

async function main(): Promise<void> {
  const { crearEstadoConversacion, crearRegistroHerramientas, herramientasActivas, HERRAMIENTAS_SOLO_LECTURA } = await import("../../src/lib/ia/herramientas/registro-herramientas");
  const { ESTIMAR_CONTEO_GLOBOS } = await import("../../src/lib/ia/herramientas/herramientas");
  const { ArgsEstimarConteoGlobosSchema, objetivoDeLaFoto, solicitudDeEstimacion } = await import("../../src/lib/ia/herramientas/estimar-conteo");
  const { accionEstimacionInconsistente, ACCION_ESTIMACION_INCONSISTENTE } = await import("../../src/lib/ia/herramientas/convergencia-plan");
  const { featureEnabled } = await import("../../src/lib/ia/nucleo/feature-flags");
  const { construirSistema, BLOQUE_ESTIMAR_CONTEO, objetivoDelConteo } = await import("../../src/lib/ia/omoikane/prompt-sistema");
  const { EstimarConteoResultV1Schema, EstimarConteoRequestV1Schema } = await import("../../src/lib/ia/contracts/domain-v1");
  const { ReferenceBlueprintV2Schema } = await import("../../src/lib/ia/referencia/reference-blueprint");
  type Blueprint = import("../../src/lib/ia/referencia/reference-blueprint").ReferenceBlueprintV2;

  const entorno = { estimar: process.env.ESTIMAR_CONTEO_V1, conteo: process.env.CONTEO_REFERENCIA_V1, node: process.env.NODE_ENV };
  const restaurar = (clave: string, valor: string | undefined): void => {
    if (valor === undefined) delete process.env[clave]; else process.env[clave] = valor;
  };
  process.env.ESTIMAR_CONTEO_V1 = "true";
  process.env.CONTEO_REFERENCIA_V1 = "true";

  // ---------------------------------------------------------------------------
  // 0. Lo que Python contesta de verdad cumple el contrato que TypeScript exporta.
  for (const [nombre, entrada] of Object.entries(FIXTURE)) {
    if (nombre.startsWith("_")) continue;
    assert.equal(EstimarConteoResultV1Schema.safeParse(entrada.respuesta).success, true, `${nombre}: la respuesta de Python no cumple el contrato`);
    assert.equal(EstimarConteoRequestV1Schema.safeParse({ schema_version: "estimar-conteo.v1", ...entrada.pregunta }).success, true, `${nombre}: la pregunta no cumple el contrato`);
  }
  ok("la fixture de Python cumple estimar-conteo.v1 en los dos sentidos");

  // ---------------------------------------------------------------------------
  // 1. La herramienta existe solo con la bandera, y es de solo lectura.
  const conBandera = herramientasActivas({ estimarConteo: true }).map((herramienta) => herramienta.nombre);
  const sinBandera = herramientasActivas({ estimarConteo: false }).map((herramienta) => herramienta.nombre);
  assert.ok(conBandera.includes("estimar_conteo_globos"), conBandera.join(","));
  assert.ok(!sinBandera.includes("estimar_conteo_globos"), sinBandera.join(","));
  assert.deepEqual(conBandera.filter((nombre) => nombre !== "estimar_conteo_globos"), sinBandera.filter((nombre) => nombre !== "estimar_conteo_globos"));
  // Independiente de la bandera del armado: estimar sirve también sin armar.
  assert.ok(herramientasActivas({ estimarConteo: true, armadoMotor: false }).some((herramienta) => herramienta.nombre === "estimar_conteo_globos"));
  assert.ok(!herramientasActivas({ estimarConteo: false, armadoMotor: true }).some((herramienta) => herramienta.nombre === "estimar_conteo_globos"));
  assert.ok(HERRAMIENTAS_SOLO_LECTURA.has("estimar_conteo_globos"));
  assert.ok(!HERRAMIENTAS_SOLO_LECTURA.has("armar_estructura"));
  ok("estimar_conteo_globos entra detrás de ESTIMAR_CONTEO_V1, aparte de la del armado, y es de solo lectura");

  // ---------------------------------------------------------------------------
  // 1b. D2 (2026-10-04): encendida por defecto en todas partes, también en producción.
  delete process.env.ESTIMAR_CONTEO_V1;
  delete process.env.ARMADO_ARCO_COLUMNA_V1;
  Object.assign(process.env, { NODE_ENV: "test" });
  assert.equal(featureEnabled("ESTIMAR_CONTEO_V1"), true);
  Object.assign(process.env, { NODE_ENV: "production" });
  assert.equal(featureEnabled("ESTIMAR_CONTEO_V1"), true, "encendida en producción por defecto");
  assert.equal(featureEnabled("ARMADO_ARCO_COLUMNA_V1"), true, "la misma regla, sin depender de NODE_ENV");
  process.env.ESTIMAR_CONTEO_V1 = "true";
  assert.equal(featureEnabled("ESTIMAR_CONTEO_V1"), true);
  process.env.ESTIMAR_CONTEO_V1 = "false";
  Object.assign(process.env, { NODE_ENV: "test" });
  assert.equal(featureEnabled("ESTIMAR_CONTEO_V1"), false, "false es un kill-switch");
  restaurar("NODE_ENV", entorno.node);
  process.env.ESTIMAR_CONTEO_V1 = "true";
  ok("ESTIMAR_CONTEO_V1: encendida fuera de producción, apagada en producción y con kill-switch");

  // ---------------------------------------------------------------------------
  // 2. El esquema y la descripción: ninguna regla ni tolerancia copiada, y el número del cliente es de confirmar.
  const esquema = JSON.stringify(ESTIMAR_CONTEO_GLOBOS.esquema);
  assert.deepEqual(ESTIMAR_CONTEO_GLOBOS.esquema.required, ["candidatos"]);
  assert.equal(((ESTIMAR_CONTEO_GLOBOS.esquema.properties as Json).candidatos as Json).maxItems, 6);
  assert.doesNotMatch(ESTIMAR_CONTEO_GLOBOS.descripcion, /±|15 ?%|0[,.]92|3[,.]6\b|λ/, "la descripción no copia la tolerancia ni la fórmula");
  assert.doesNotMatch(esquema, /±|0[,.]92/);
  assert.match(ESTIMAR_CONTEO_GLOBOS.descripcion, /SOLO LECTURA/);
  assert.match(ESTIMAR_CONTEO_GLOBOS.descripcion, /SIEMPRE de confirmar_plan_decoracion/);
  assert.match(ESTIMAR_CONTEO_GLOBOS.descripcion, /NO lo mueven/);
  ok("el esquema y la descripción: solo lectura, sin reglas copiadas y el número del cliente es de confirmar_plan_decoracion");

  // ---------------------------------------------------------------------------
  // 3. Con la fórmula: el cuerpo que viaja y lo que vuelve, sin tocar el turno.
  const candidatosFormula = [
    { etiqueta: "arco 3,2 m", tipo: "arco", medidas: { ancho_m: 3.2, alto_m: 2.3 }, densidad: "media", mezcla: "organica_fina" },
    { etiqueta: "guirnalda 2,5 m", tipo: "guirnalda", medidas: { largo_m: 2.5 }, densidad: "media", mezcla: "organica_fina" },
  ];
  const estadoFormula = crearEstadoConversacion({}, "un arco y una guirnalda");
  const antes = huella(estadoFormula as unknown as Json);
  const llamadasFormula = instalarResolutorPythonFalso({ otrasRutas: (llamada) => respuestaPython(llamada, FIXTURE.formula!.respuesta) });
  const estimado = await crearRegistroHerramientas(estadoFormula, { pool: POOL })
    .estimar_conteo_globos!({ candidatos: candidatosFormula, objetivo: { conteo: 60, exacto: false } }, LLAMADA);
  assert.equal(estimado.ok, true, JSON.stringify(estimado).slice(0, 400));
  assert.equal(estimado.status, "ESTIMACION");
  assert.equal(estimado.origen_objetivo, "modelo");
  const enviada = llamadasFormula.find((llamada) => llamada.path === RUTA_ESTIMAR)!;
  assert.ok(enviada, llamadasFormula.map((llamada) => llamada.path).join(","));
  assert.equal(enviada.body.schema_version, "estimar-conteo.v1");
  assert.deepEqual(enviada.body.candidatos, candidatosFormula);
  assert.deepEqual(enviada.body.objetivo, { conteo: 60, exacto: false });
  assert.equal(enviada.body.medidas_del_cliente, false);
  assert.equal(enviada.body.tamanos_obligatorios, undefined);
  assert.deepEqual((enviada.body.context as Json).scopes, ["plan.estimar_conteo"]);
  // Lo que vuelve es lo que Python dijo, tal cual: el handler no recalcula ni reordena nada.
  assert.deepEqual(estimado.candidatos, FIXTURE.formula!.respuesta.candidatos);
  assert.deepEqual(estimado.objetivo, FIXTURE.formula!.respuesta.objetivo);
  assert.equal(estimado.mejor, FIXTURE.formula!.respuesta.mejor);
  assert.match(String(estimado.accion_requerida), /SIEMPRE de confirmar_plan_decoracion/);
  assert.equal(huella(estadoFormula as unknown as Json), antes, "estimar no escribe en el estado del turno");
  assert.equal(estadoFormula.planResuelto, undefined);
  assert.equal(llamadasFormula.filter((llamada) => llamada.path === "/internal/v1/plan/resolve").length, 0, "no resuelve ningún plan");
  ok("estimar con la fórmula: el cuerpo que viaja, la respuesta de Python tal cual y el estado intacto");

  // 3b. Los tamaños obligatorios y las medidas del cliente viajan; lo demás del turno no.
  const estadoCliente = crearEstadoConversacion({}, "un arco de 3 metros de ancho y 2 de alto, solo con globos R-12");
  const llamadasCliente = instalarResolutorPythonFalso({ otrasRutas: (llamada) => respuestaPython(llamada, FIXTURE.formula!.respuesta) });
  await crearRegistroHerramientas(estadoCliente, { pool: POOL }).estimar_conteo_globos!({ candidatos: candidatosFormula, objetivo: { conteo: 60 } }, LLAMADA);
  const cuerpoCliente = llamadasCliente.find((llamada) => llamada.path === RUTA_ESTIMAR)!.body;
  assert.equal(cuerpoCliente.medidas_del_cliente, true, "el cliente dio medidas en su pedido");
  assert.deepEqual(cuerpoCliente.tamanos_obligatorios, [12]);
  assert.deepEqual(cuerpoCliente.objetivo, { conteo: 60, exacto: false });
  ok("las medidas y los tamaños que el cliente dio viajan para que la sugerencia los respete");

  // ---------------------------------------------------------------------------
  // 4. Con armado: el que armar_estructura guardó entra al candidato, en el campo de su tipo.
  const armadoArco = ARMADOS.armar_arco!.armado as Json;
  const estadoMotor = crearEstadoConversacion({}, "un arco rosado y blanco");
  estadoMotor.armadosEstructura = new Map([["EST_01_ARCO", { tipo: "arco", armado: armadoArco as never }]]);
  const antesMotor = huella(estadoMotor as unknown as Json);
  const llamadasMotor = instalarResolutorPythonFalso({ otrasRutas: (llamada) => respuestaPython(llamada, FIXTURE.motor!.respuesta) });
  const conMotor = await crearRegistroHerramientas(estadoMotor, { pool: POOL }).estimar_conteo_globos!({
    candidatos: [
      { etiqueta: "arco con motor", tipo: "arco", medidas: { ancho_m: 3.2, alto_m: 2.3 }, densidad: "media", mezcla: "organica_fina", armado_de: "EST_01_ARCO" },
      { etiqueta: "arco con formula", tipo: "arco", medidas: { ancho_m: 3.2, alto_m: 2.3 }, densidad: "media", mezcla: "organica_fina" },
    ],
    objetivo: { conteo: 70 },
  }, LLAMADA);
  assert.equal(conMotor.ok, true, JSON.stringify(conMotor).slice(0, 400));
  const cuerpoMotor = llamadasMotor.find((llamada) => llamada.path === RUTA_ESTIMAR)!.body;
  const [primero, segundo] = cuerpoMotor.candidatos as Json[];
  assert.deepEqual(primero!.armado_arco, armadoArco, "el armado guardado viaja en el campo de su tipo");
  assert.equal(primero!.armado_de, undefined, "armado_de es del modelo, no del contrato");
  assert.equal(segundo!.armado_arco, undefined);
  const candidatoMotor = (conMotor.candidatos as Json[])[0]!;
  assert.equal(candidatoMotor.fuente, "motor");
  assert.match(String(candidatoMotor.nota), /NO lo mueven/);
  assert.equal(huella(estadoMotor as unknown as Json), antesMotor, "el armado guardado queda como estaba");
  ok("armado_de lleva el armado que armar_estructura guardó, y el estado del turno no cambia");

  // 4b. Un armado que no existe o es de otro tipo no se estima sin él: se dice, sin llamar a Python.
  for (const [armadoDe, tipo, estado] of [["EST_09_NO_ARMADA", "arco", "ARMADO_NO_ENCONTRADO"], ["EST_01_ARCO", "columna", "ARMADO_NO_CORRESPONDE"]] as const) {
    const estadoAusente = crearEstadoConversacion({}, "una pieza");
    estadoAusente.armadosEstructura = new Map([["EST_01_ARCO", { tipo: "arco", armado: armadoArco as never }]]);
    const llamadas = instalarResolutorPythonFalso({ otrasRutas: (llamada) => respuestaPython(llamada, FIXTURE.motor!.respuesta) });
    const rechazo = await crearRegistroHerramientas(estadoAusente, { pool: POOL }).estimar_conteo_globos!({
      candidatos: [{ etiqueta: "pieza", tipo, medidas: { alto_m: 2 }, densidad: "media", mezcla: "clasica", armado_de: armadoDe }],
    }, LLAMADA);
    assert.equal(rechazo.ok, false);
    assert.equal(rechazo.status, estado);
    assert.equal(rechazo.estructura_id, armadoDe);
    assert.equal(llamadas.length, 0, "no se llama a Python sin el armado que se pidió");
  }
  ok("un armado_de ausente o de otro tipo se rechaza en la frontera, sin llamar a Python");

  // ---------------------------------------------------------------------------
  // 5. Argumentos inválidos: no llegan a Python.
  const candidatoBueno = candidatosFormula[0]!;
  for (const [nombre, args] of [
    ["sin candidatos", { candidatos: [] }],
    ["siete candidatos", { candidatos: Array.from({ length: 7 }, (_, n) => ({ ...candidatoBueno, etiqueta: `c${n}` })) }],
    ["densidad desconocida", { candidatos: [{ ...candidatoBueno, densidad: "extrema" }] }],
    ["tipo sin geometría", { candidatos: [{ ...candidatoBueno, tipo: "kit" }] }],
    ["etiqueta vacía", { candidatos: [{ ...candidatoBueno, etiqueta: " " }] }],
    ["medida negativa", { candidatos: [{ ...candidatoBueno, medidas: { ancho_m: -1 } }] }],
    ["campo ajeno", { candidatos: [{ ...candidatoBueno, precio: 10 }] }],
    ["objetivo cero", { candidatos: [candidatoBueno], objetivo: { conteo: 0 } }],
    ["objetivo decimal", { candidatos: [candidatoBueno], objetivo: { conteo: 12.5 } }],
    ["argumento ajeno", { candidatos: [candidatoBueno], tolerancia: 0.5 }],
  ] as const) {
    const llamadas = instalarResolutorPythonFalso();
    const rechazo = await crearRegistroHerramientas(crearEstadoConversacion({}, "un arco"), { pool: POOL })
      .estimar_conteo_globos!(args as unknown as Json, LLAMADA);
    assert.equal(rechazo.ok, false, nombre);
    assert.equal(rechazo.status, "ARGUMENTOS_INVALIDOS", nombre);
    assert.ok((rechazo.errores as string[]).length > 0, nombre);
    assert.equal(llamadas.length, 0, `${nombre}: no se llama a Python`);
  }
  // El esquema de los argumentos no admite una tolerancia ni un total del modelo: nada que recalcular.
  assert.equal(ArgsEstimarConteoGlobosSchema.safeParse({ candidatos: [candidatoBueno], tolerancia: 0.5 }).success, false);
  ok("los argumentos inválidos se rechazan en la frontera, sin llamar a Python");

  // ---------------------------------------------------------------------------
  // 6. Lo que Python rechaza vuelve con su estado y su motivo; lo demás no tumba el turno.
  for (const [code, motivo, mensaje, estadoEsperado] of [
    ["candidato_invalido", "etiqueta_repetida", "Dos candidatos llevan la misma etiqueta.", "CANDIDATO_INVALIDO"],
    ["armado_invalido", "material_fuera_de_rango", "La pieza lleva 1 colores y el armado nombra el indice 1.", "ARMADO_INVALIDO"],
  ] as const) {
    instalarResolutorPythonFalso({ otrasRutas: () => rechazoPython(code, motivo, mensaje, "arco 3,2 m") });
    const estado = crearEstadoConversacion({}, "un arco");
    const antesRechazo = huella(estado as unknown as Json);
    const rechazo = await crearRegistroHerramientas(estado, { pool: POOL }).estimar_conteo_globos!({ candidatos: candidatosFormula }, LLAMADA);
    assert.equal(rechazo.ok, false);
    assert.equal(rechazo.status, estadoEsperado);
    assert.equal(rechazo.candidato, "arco 3,2 m");
    assert.equal(rechazo.motivo, motivo);
    assert.equal(rechazo.detalle, mensaje);
    assert.equal(huella(estado as unknown as Json), antesRechazo);
  }
  for (const [nombre, respuesta] of [
    ["Python caído", () => Response.json({ detail: { code: "unavailable" } }, { status: 503 })],
    ["respuesta sin forma", (llamada: LlamadaPython) => respuestaPython(llamada, { operation_schema_version: "estimar-conteo-result.v1", candidatos: "no" })],
    ["otros candidatos", (llamada: LlamadaPython) => respuestaPython(llamada, FIXTURE.sin_objetivo!.respuesta)],
  ] as const) {
    instalarResolutorPythonFalso({ otrasRutas: respuesta });
    const resultado = await crearRegistroHerramientas(crearEstadoConversacion({}, "un arco"), { pool: POOL })
      .estimar_conteo_globos!({ candidatos: candidatosFormula, objetivo: { conteo: 60 } }, LLAMADA);
    assert.equal(resultado.ok, false, nombre);
    assert.equal(resultado.status, "ESTIMACION_NO_DISPONIBLE", nombre);
    assert.match(String(resultado.accion_requerida), /confirmar_plan_decoracion/, nombre);
  }
  ok("un candidato o un armado que Python rechaza vuelve con su motivo; un fallo o una respuesta rota no tumba el turno");

  // 6a. Otra estimación en curso: la ruta no hace cola y el modelo recibe un «ocupado, reintenta» claro.
  instalarResolutorPythonFalso({ otrasRutas: () => Response.json({ detail: { code: "estimacion_ocupada" } }, { status: 429 }) });
  const ocupado = await crearRegistroHerramientas(crearEstadoConversacion({}, "un arco"), { pool: POOL })
    .estimar_conteo_globos!({ candidatos: candidatosFormula, objetivo: { conteo: 60 } }, LLAMADA);
  assert.equal(ocupado.ok, false);
  assert.equal(ocupado.status, "ESTIMACION_OCUPADA");
  assert.equal(ocupado.reintentable, true);
  assert.match(String(ocupado.accion_requerida), /vuelve a llamar estimar_conteo_globos una vez/);
  assert.notEqual(ocupado.status, "ESTIMACION_NO_DISPONIBLE", "ocupado no es «no disponible»");

  // 6b. Un 422 de forma que Zod dejó pasar es un error de los argumentos, no de la disponibilidad.
  instalarResolutorPythonFalso({ otrasRutas: () => Response.json({ detail: { code: "invalid_request" } }, { status: 422 }) });
  const deForma = await crearRegistroHerramientas(crearEstadoConversacion({}, "un arco"), { pool: POOL })
    .estimar_conteo_globos!({ candidatos: candidatosFormula, objetivo: { conteo: 60 } }, LLAMADA);
  assert.equal(deForma.status, "ARGUMENTOS_INVALIDOS");
  assert.ok((deForma.errores as string[]).length > 0);
  assert.match(String(deForma.accion_requerida), /Corrige los candidatos/);

  // 6c. Zod y el JSON Schema exportado coinciden en la coherencia de la estructura oficial: lo que Python rechazaría
  //     por tipo o densidad se rechaza aquí, con el campo, sin llamar a Python.
  for (const [nombre, candidatoIncoherente] of [
    ["arco_no_denso con densidad lujosa", { ...candidatoBueno, estructura_oficial: "arco_no_denso", densidad: "lujosa" }],
    ["columna con tipo arco", { ...candidatoBueno, estructura_oficial: "columna" }],
    ["aro_circular con tipo columna", { ...candidatoBueno, estructura_oficial: "aro_circular", tipo: "columna" }],
  ] as const) {
    const llamadas = instalarResolutorPythonFalso();
    const rechazo = await crearRegistroHerramientas(crearEstadoConversacion({}, "un arco"), { pool: POOL })
      .estimar_conteo_globos!({ candidatos: [candidatoIncoherente] }, LLAMADA);
    assert.equal(rechazo.status, "ARGUMENTOS_INVALIDOS", nombre);
    assert.ok((rechazo.errores as string[]).some((error) => /tipo|densidad/.test(error)), `${nombre}: ${JSON.stringify(rechazo.errores)}`);
    assert.equal(llamadas.length, 0, `${nombre}: no se llama a Python`);
    assert.equal(
      EstimarConteoRequestV1Schema.safeParse({ schema_version: "estimar-conteo.v1", candidatos: [{ ...candidatoIncoherente, medidas: {} }] }).success,
      false,
      `${nombre}: el contrato exportado también lo rechaza`,
    );
  }
  // Una estructura oficial coherente (y una sin ubicación, como pide el contrato) sigue pasando.
  assert.equal(ArgsEstimarConteoGlobosSchema.safeParse({ candidatos: [{ ...candidatoBueno, estructura_oficial: "techo_globos", tipo: "guirnalda" }] }).success, true);
  assert.equal(ArgsEstimarConteoGlobosSchema.safeParse({ candidatos: [{ ...candidatoBueno, estructura_oficial: "arco_asimetrico" }] }).success, true);

  // 6d. Una búsqueda que se cortó por el tope de la petición es una respuesta válida, no un error.
  const cortada = structuredClone(FIXTURE.formula!.respuesta) as { candidatos: { sugerencia: Json }[] };
  cortada.candidatos[0]!.sugerencia = { estado: "cortada_por_tope", via: "motor", cambios: [], total_resultante: null, brecha: null, motivo: "Se agotó el tiempo (2 s por consulta) antes de probar todos los mandos." };
  assert.equal(EstimarConteoResultV1Schema.safeParse(cortada).success, true);
  instalarResolutorPythonFalso({ otrasRutas: (llamada) => respuestaPython(llamada, cortada) });
  const conCorte = await crearRegistroHerramientas(crearEstadoConversacion({}, "un arco"), { pool: POOL })
    .estimar_conteo_globos!({ candidatos: candidatosFormula, objetivo: { conteo: 60 } }, LLAMADA);
  assert.equal(conCorte.ok, true);
  assert.equal(((conCorte.candidatos as Json[])[0]!.sugerencia as Json).estado, "cortada_por_tope");
  ok("ocupado y forma inválida tienen su mensaje; Zod y el contrato coinciden en la coherencia; un corte por tope es una respuesta");

  // 6e. Apagada, la herramienta no responde aunque alguien la llame.
  process.env.ESTIMAR_CONTEO_V1 = "false";
  const llamadasApagada = instalarResolutorPythonFalso();
  const apagada = await crearRegistroHerramientas(crearEstadoConversacion({}, "un arco"), { pool: POOL })
    .estimar_conteo_globos!({ candidatos: candidatosFormula }, LLAMADA);
  assert.equal(apagada.status, "HERRAMIENTA_NO_DISPONIBLE");
  assert.equal(llamadasApagada.length, 0);
  process.env.ESTIMAR_CONTEO_V1 = "true";
  ok("con la bandera apagada el handler no llama a Python");

  // ---------------------------------------------------------------------------
  // 7. El objetivo por defecto es el conteo de la foto, con la regla que el prompt ya usa.
  const conteoFoto = (cambios: Json = {}): Json => ({
    globos_visibles: 30, exacto: false, estimado_total: 60, racimos: null, globos_por_racimo: null,
    por_tamano: [], largo_relativo: null, alto_relativo: null, confianza: 0.8, ...cambios,
  });
  const elemento = (id: string, conteo?: Json): Json => ({
    element_id: id, source_image_id: "REF_01", name: `pieza ${id}`, category: "balloon_structure",
    scene_role: "midground", detection_confidence: 0.9, visible_evidence: "pieza",
    reference_bbox: { x: 0.1, y: 0.1, width: 0.3, height: 0.8 }, depth_layer: 1,
    include_policy: "include", approved: true, source_type: "reference_only",
    quantity: { mode: "exact", min: 1, max: 1 }, quantity_semantics: "physical_instances",
    appearance: {
      observed_colors: ["white", "gold"], resolved_colors: [], color_policy: "match_reference", material: "latex", shape: "piece", composition: "mixed",
      ...(conteo ? { conteo } : {}),
    },
    relationships: [], uncertainties: [],
  });
  const blueprintDe = (elementos: Json[]): Blueprint => ReferenceBlueprintV2Schema.parse({
    schema_version: "2.0",
    source_images: [{ image_id: "REF_01", approved_roles: ["composition_reference"] }],
    elements: elementos,
    composition: { focal_point: "pieza", density: "moderate", symmetry: "unknown", negative_space: [] },
    palette: { observed: ["white", "gold"], priority: ["white", "gold"] },
    unresolved_decisions: [],
  });
  const unSolo = blueprintDe([elemento("REF_01_E01", conteoFoto()), elemento("REF_01_E02")]);
  const dos = blueprintDe([elemento("REF_01_E01", conteoFoto()), elemento("REF_01_E02", conteoFoto({ globos_visibles: 20, exacto: true, estimado_total: null, confianza: 0.9 }))]);

  // El estimado de una lectura confiable; la cuenta exacta; y nada si no es confiable o la bandera lo apaga.
  assert.deepEqual(objetivoDelConteo(conteoFoto() as never), { conteo: 60, exacto: false });
  assert.deepEqual(objetivoDelConteo(conteoFoto({ globos_visibles: 20, exacto: true, estimado_total: null }) as never), { conteo: 20, exacto: true });
  assert.equal(objetivoDelConteo(conteoFoto({ confianza: 0.4 }) as never), null, "por debajo de la barra de Python no hay objetivo");
  assert.equal(objetivoDelConteo(conteoFoto({ estimado_total: null }) as never), null, "sin cifra leída (solo racimos) no hay objetivo");
  assert.equal(objetivoDelConteo(undefined as never), null);
  process.env.CONTEO_REFERENCIA_V1 = "false";
  assert.equal(objetivoDelConteo(conteoFoto() as never), null, "una lectura que el prompt no presenta tampoco es un objetivo");
  process.env.CONTEO_REFERENCIA_V1 = "true";

  assert.deepEqual(objetivoDeLaFoto(unSolo), { objetivo: { conteo: 60, exacto: false, origen: "foto", elemento: "REF_01_E01" } });
  assert.deepEqual(objetivoDeLaFoto(dos), { ambiguo: ["REF_01_E01", "REF_01_E02"] });
  assert.deepEqual(objetivoDeLaFoto(dos, "REF_01_E02"), { objetivo: { conteo: 20, exacto: true, origen: "foto", elemento: "REF_01_E02" } });
  assert.equal(objetivoDeLaFoto(dos, "REF_01_E09"), null);
  assert.equal(objetivoDeLaFoto(undefined), null);

  const estadoFoto = crearEstadoConversacion({}, "algo como la foto", unSolo);
  const llamadasFoto = instalarResolutorPythonFalso({ otrasRutas: (llamada) => respuestaPython(llamada, FIXTURE.formula!.respuesta) });
  const porFoto = await crearRegistroHerramientas(estadoFoto, { pool: POOL }).estimar_conteo_globos!({ candidatos: candidatosFormula }, LLAMADA);
  assert.equal(porFoto.ok, true, JSON.stringify(porFoto).slice(0, 300));
  assert.deepEqual(llamadasFoto.find((llamada) => llamada.path === RUTA_ESTIMAR)!.body.objetivo, { conteo: 60, exacto: false });
  assert.equal(porFoto.origen_objetivo, "foto");
  assert.equal(porFoto.elemento_objetivo, "REF_01_E01");
  // El objetivo del modelo manda sobre el de la foto.
  const delModelo = await crearRegistroHerramientas(crearEstadoConversacion({}, "como la foto", unSolo), { pool: POOL })
    .estimar_conteo_globos!({ candidatos: candidatosFormula, objetivo: { conteo: 60 } }, LLAMADA);
  assert.equal(delModelo.origen_objetivo, "modelo");

  // Con dos elementos con conteo y sin elegir, no se escoge uno por el modelo.
  const llamadasAmbiguo = instalarResolutorPythonFalso({ otrasRutas: (llamada) => respuestaPython(llamada, FIXTURE.sin_objetivo!.respuesta) });
  const ambiguo = await crearRegistroHerramientas(crearEstadoConversacion({}, "como la foto", dos), { pool: POOL })
    .estimar_conteo_globos!({ candidatos: [{ etiqueta: "columna 1,6 m", tipo: "columna", medidas: { alto_m: 1.6 }, densidad: "media", mezcla: "organica_fina" }] }, LLAMADA);
  assert.equal(ambiguo.ok, true, JSON.stringify(ambiguo).slice(0, 300));
  assert.equal(llamadasAmbiguo.find((llamada) => llamada.path === RUTA_ESTIMAR)!.body.objetivo, undefined);
  assert.equal(ambiguo.origen_objetivo, "ninguno");
  assert.deepEqual(ambiguo.elementos_con_conteo, ["REF_01_E01", "REF_01_E02"]);
  assert.match(String(ambiguo.accion_requerida), /referencia_element_id/);

  // Sin CONTEO_REFERENCIA_V1 la foto no da objetivo.
  process.env.CONTEO_REFERENCIA_V1 = "false";
  const llamadasSinConteo = instalarResolutorPythonFalso({ otrasRutas: (llamada) => respuestaPython(llamada, FIXTURE.sin_objetivo!.respuesta) });
  await crearRegistroHerramientas(crearEstadoConversacion({}, "como la foto", unSolo), { pool: POOL })
    .estimar_conteo_globos!({ candidatos: [{ etiqueta: "columna 1,6 m", tipo: "columna", medidas: { alto_m: 1.6 }, densidad: "media", mezcla: "organica_fina" }] }, LLAMADA);
  assert.equal(llamadasSinConteo.find((llamada) => llamada.path === RUTA_ESTIMAR)!.body.objetivo, undefined);
  process.env.CONTEO_REFERENCIA_V1 = "true";
  ok("el objetivo por defecto es el conteo de la foto, con la regla del prompt; el del modelo manda; sin elegir no se adivina");

  // ---------------------------------------------------------------------------
  // 7b. El mapeo puro no calcula nada: sin armado guardado, un candidato queda como llegó.
  const armada = solicitudDeEstimacion(ArgsEstimarConteoGlobosSchema.parse({ candidatos: [{ etiqueta: "x", tipo: "pared", densidad: "media", mezcla: "clasica" }] }), {
    armados: undefined, objetivo: undefined, tamanosObligatorios: [], medidasDelCliente: false,
  });
  assert.deepEqual(armada, { solicitud: { candidatos: [{ etiqueta: "x", tipo: "pared", medidas: {}, densidad: "media", mezcla: "clasica" }], medidas_del_cliente: false } });
  ok("el mapeo: sin medidas ni objetivo ni armado, el candidato viaja como llegó");

  // ---------------------------------------------------------------------------
  // 8. El prompt: el flujo detrás de la bandera y con un conteo en la foto, y el número del cliente es de confirmar.
  const conPrompt = construirSistema({ ragEnabled: true, referenceBlueprint: unSolo });
  assert.match(conPrompt, /estimar_conteo_globos[\s\S]{0,900}confirmar_plan_decoracion/);
  assert.match(conPrompt, /antes de armar_estructura y de confirmar_plan_decoracion llama estimar_conteo_globos con 2 o 3 candidatos/);
  assert.match(conPrompt, /sale SIEMPRE de confirmar_plan_decoracion, nunca de esta estimación/);
  assert.equal(conPrompt.includes(BLOQUE_ESTIMAR_CONTEO), true);
  assert.doesNotMatch(BLOQUE_ESTIMAR_CONTEO, /±|15 ?%|\d+ globos/, "el bloque no dice cuántos globos lleva nada ni copia la tolerancia");
  // Sin conteo en la foto, sin foto o con la bandera apagada el prompt no cambia ni un byte.
  const base = construirSistema({ ragEnabled: true });
  assert.equal(construirSistema({ ragEnabled: true, referenceBlueprint: blueprintDe([elemento("REF_01_E01")]) }).includes("estimar_conteo_globos"), false);
  assert.equal(base.includes("estimar_conteo_globos"), false);
  process.env.ESTIMAR_CONTEO_V1 = "false";
  assert.equal(construirSistema({ ragEnabled: true, referenceBlueprint: unSolo }).includes("estimar_conteo_globos"), false);
  process.env.ESTIMAR_CONTEO_V1 = "true";
  process.env.CONTEO_REFERENCIA_V1 = "false";
  assert.equal(construirSistema({ ragEnabled: true, referenceBlueprint: unSolo }).includes("estimar_conteo_globos"), false, "una lectura que el prompt no presenta no pide estimar");
  process.env.CONTEO_REFERENCIA_V1 = "true";
  ok("el prompt pide estimar solo con la bandera y un conteo en la foto, y dice que el número del cliente es de confirmar_plan_decoracion");

  // ---------------------------------------------------------------------------
  // 9. ESTIMACION_INCONSISTENTE no manda a tocar mandos que no mueven una pieza con armado del motor.
  assert.equal(accionEstimacionInconsistente([]), ACCION_ESTIMACION_INCONSISTENTE);
  assert.match(ACCION_ESTIMACION_INCONSISTENTE, /Revisa las medidas, densidad, mezcla o número de estructuras/);
  const conArmado = accionEstimacionInconsistente(["EST_01_ARCO"]);
  assert.match(conArmado, /EST_01_ARCO lleva armado del motor/);
  assert.match(conArmado, /NO cambian el total/);
  assert.match(conArmado, /armar_estructura/);
  assert.doesNotMatch(conArmado, /^Revisa las medidas, densidad, mezcla/);
  assert.match(accionEstimacionInconsistente(["EST_01_ARCO", "EST_02_COLUMNA"]), /EST_01_ARCO, EST_02_COLUMNA llevan armado del motor/);

  // De punta a punta: la puerta física señala un arco con armado y el rechazo ya no manda tocar sus medidas.
  const armadoDelModelo = ARMADOS.armar_arco!.armado as Json;
  const avisoPuerta = "puerta_fisica:EST_01_ARCO: estimated material quantity appears too low for medium density over 6.21 m (40 installed balloons)";
  const confirmarConPuerta = async (conArmadoGuardado: boolean): Promise<Json> => {
    const estado = crearEstadoConversacion({}, "un arco rosado y blanco");
    estado.ragCatalogSnapshotId = SNAPSHOT_FALSO;
    estado.ragIdsRecuperados.add("P-GLOBOS");
    estado.ragVariantIdsRecuperados.set("P-GLOBOS", new Set(FILAS.map((fila) => fila.variant_id)));
    if (conArmadoGuardado) estado.armadosEstructura = new Map([["EST_01_ARCO", { tipo: "arco", armado: armadoDelModelo as never }]]);
    instalarResolutorPythonFalso({
      veredicto: () => ({ advertencias: [avisoPuerta] }),
      otrasRutas: (llamada) => respuestaPython(llamada, {
        operation_schema_version: "omoikane-armado-estructura-result.v1",
        accion: "completar",
        armados: conArmadoGuardado ? [{ estructura_id: "EST_01_ARCO", tipo: "arco", clave: "armado_arco", origen: "modelo", armado: armadoDelModelo, avisos: [] }] : [],
      }),
    });
    return crearRegistroHerramientas(estado, { pool: POOL }).confirmar_plan_decoracion!(argsPlan([ARCO]), LLAMADA);
  };
  const conMotorRechazado = await confirmarConPuerta(true);
  assert.equal(conMotorRechazado.status, "ESTIMACION_INCONSISTENTE", JSON.stringify(conMotorRechazado).slice(0, 300));
  assert.match(String(conMotorRechazado.accion_requerida), /EST_01_ARCO lleva armado del motor[\s\S]*NO cambian el total/);
  assert.doesNotMatch(String(conMotorRechazado.accion_requerida), /^Revisa las medidas, densidad, mezcla/);
  const sinMotorRechazado = await confirmarConPuerta(false);
  assert.equal(sinMotorRechazado.status, "ESTIMACION_INCONSISTENTE");
  assert.equal(sinMotorRechazado.accion_requerida, ACCION_ESTIMACION_INCONSISTENTE, "sin armado el mensaje es el de siempre");
  ok("ESTIMACION_INCONSISTENTE: con armado del motor no manda tocar medidas, densidad ni mezcla; sin él, el mensaje de siempre");

  restaurar("ESTIMAR_CONTEO_V1", entorno.estimar);
  restaurar("CONTEO_REFERENCIA_V1", entorno.conteo);
  console.log(`\n${casos} casos pasaron`);
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
