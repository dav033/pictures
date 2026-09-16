/**
 * Un fallo de infraestructura no se presenta como conversación.
 *
 * Reproduce el incidente de SEGUIMIENTO.md §3.B: con Python respondiendo fuera
 * de contrato, el chat le decía al cliente "no pude verificar la propuesta…
 * intentemos de nuevo en un momento", con el paso en verde y sin propuesta. El
 * texto lo redactaba el modelo a partir de un `mensaje_cliente`, y el prompt le
 * autoriza parafrasearlo "con sus palabras": de ahí salió la promesa que nadie
 * le había dado.
 *
 * Offline: el servicio Python lo responde un doble de transporte.
 * Run: npx tsx scripts/test-fallo-tecnico-chat.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { Pool } from "pg";
import { crearEstadoConversacion, crearRegistroHerramientas } from "../src/lib/ia/registro-herramientas";
import { FalloTecnicoTurnoError } from "../src/lib/ia/fallo-tecnico-turno";
import { uiErrorDesdeChatV1 } from "../src/lib/ia/contracts/ui-error-v1";
import { prepararEntornoPythonFalso, SNAPSHOT_FALSO } from "./lib/resolutor-python-falso";

let casos = 0;
function ok(nombre: string): void {
  casos += 1;
  console.log(`[PASS] ${nombre}`);
}

const filas = [
  { product_id: "P-VERDE", variant_id: "V-VERDE", sku: "SKU-VERDE", producto_titulo: "Cortina verde", variante_titulo: "Verde", precio: 12_000, unidades_paq: 1, disponible: true, producto_disponible: true, codigo_tamano: null, forma: null, diam_pulg: null, colores_producto: ["verde"], colores_variante: ["verde"], acabados_producto: [], descripcion: "Cortina verde", imagen: null },
];

function estadoPreparado() {
  const estado = crearEstadoConversacion({}, "arco verde para un cumpleaños");
  estado.ragCatalogSnapshotId = SNAPSHOT_FALSO;
  estado.ragIdsRecuperados.add("P-VERDE");
  estado.ragVariantIdsRecuperados.set("P-VERDE", new Set(["V-VERDE"]));
  return estado;
}

const estructura = (id: string, ubicacion: "arco_central" | "lateral_izquierdo" | "lateral_derecho") => ({
  estructura_id: id,
  nombre: `Instalación ${id}`,
  tipo: "accesorio" as const,
  rol_escena: id.startsWith("EST_01_") ? "focal" as const : "soporte" as const,
  ubicacion,
  medidas: {},
  repeticiones: 1,
  densidad: "sencilla" as const,
  mezcla: "clasica" as const,
  materiales: [{ product_id: "P-VERDE", variant_id: "V-VERDE", participacion: 1, rol_material: "principal" as const, color: "verde" }],
  unidades_declaradas: 1,
  porque: "Prueba de fallo técnico",
});

const planDeHerramienta = {
  concepto: { titulo: "Arco verde", descripcion: "Arco verde sencillo", paleta: ["verde"], ocasion: "cumpleaños" },
  espacio: { tipo: "salón", fuente: "supuesto" as const },
  estructuras: [
    estructura("EST_01_ACC", "arco_central"),
    estructura("EST_02_ACC", "lateral_izquierdo"),
    estructura("EST_03_ACC", "lateral_derecho"),
  ],
  supuestos: [],
};

async function main(): Promise<void> {
  prepararEntornoPythonFalso();
  const pool = {
    query: async (sql: string) => sql.includes("catalog_variants") ? { rows: filas } : { rows: [] },
  } as unknown as Pool;

  // El servicio responde 200 con un cuerpo que no cumple `plan-resolution-result.v1`.
  // Es el caso real del incidente: el esquema acepta números válidos, la
  // incoherencia aparece una capa después.
  globalThis.fetch = (async () => new Response(
    JSON.stringify({ operation_schema_version: "plan-resolution-result.v1", plan_resuelto: { esto_no: "cumple el contrato" } }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  )) as typeof fetch;

  const estado = estadoPreparado();
  const registro = crearRegistroHerramientas(estado, { pool });
  const llamada = { nombre: "confirmar_plan_decoracion", args: {} };

  // 1. La herramienta corta el turno en vez de devolverle un texto al modelo.
  let lanzado: unknown;
  let resultado: unknown;
  try {
    resultado = await registro.confirmar_plan_decoracion!(planDeHerramienta, llamada);
  } catch (error) {
    lanzado = error;
  }
  assert.ok(
    lanzado instanceof FalloTecnicoTurnoError,
    `un fallo de contrato debe cortar el turno, no volver como resultado narrable: ${JSON.stringify(resultado)?.slice(0, 300)}`,
  );
  assert.equal(resultado, undefined, "la herramienta no puede devolver nada que el modelo pueda parafrasear");
  ok("una respuesta fuera de contrato corta el turno en vez de volver como resultado");

  // 2. Nada de lo que se lanza lleva texto para el cliente: ese texto es de ui-error.v1.
  const mensaje = (lanzado as FalloTecnicoTurnoError).message;
  assert.doesNotMatch(mensaje, /en un momento|intentemos/i, "el error técnico no redacta promesas al cliente");
  assert.equal(estado.planResuelto, undefined, "no queda un plan a medias en el estado del turno");
  ok("el fallo no redacta mensaje de cliente ni deja plan a medias");

  // 3. El cliente recibe el literal del catálogo, con su acción de salida.
  const ui = uiErrorDesdeChatV1({ code: "RAG_UNAVAILABLE", error: "No se pudo verificar la propuesta contra el catálogo. Intenta nuevamente.", causa: "backend_plan" });
  assert.equal(ui.code, "SERVICIO_NO_DISPONIBLE");
  assert.equal(ui.accion_sugerida, "reintentar", "sin acción de salida el cliente queda sin nada que hacer (§3.B defecto 3)");
  assert.equal(ui.retryable, true);
  assert.doesNotMatch(ui.mensaje_usuario, /catálogo comercial|python|backend/i, "sin nombres de infraestructura");
  ok("el error llega como ui-error.v1 con acción de salida");

  // 4. El segundo dueño del texto de fallo técnico ya no existe.
  const mensajesCliente = readFileSync("src/lib/ia/mensajes-cliente.ts", "utf8");
  assert.doesNotMatch(mensajesCliente, /Intentemos de nuevo en un momento/, "MENSAJE_CLIENTE_VERIFICACION_FALLIDA era un dueño paralelo a ui-error.v1");
  const rutaChat = readFileSync("src/app/api/chat/route.ts", "utf8");
  assert.match(rutaChat, /FalloTecnicoTurnoError\) return "RAG_UNAVAILABLE"/, "la ruta debe traducir el fallo técnico a un código que ui-error.v1 conozca");
  ok("no queda un segundo dueño del texto de fallo técnico");

  console.log(`\n${casos} casos OK (fallo técnico sin narración del modelo)`);
}

void main();
