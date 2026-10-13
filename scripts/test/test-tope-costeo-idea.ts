import { strict as assert } from "node:assert";
import { costearIdeaElegida, type EntornoCosteoIdea } from "@/lib/guiada-motor/costear-idea-elegida";
import type { DependenciasCosteo } from "@/lib/guiada-motor/costear-idea";
import type { FilaAuditoriaPlan3d } from "@/lib/guiada-motor/auditoria-plan";
import { devolverCosteoIdeaDurable, CLAVE_COSTEO_IDEA_POR_HORA, reiniciarCosteoIdeaPorHora, tomarCosteoIdea, tomarCosteoIdeaDurable, topeCosteoIdeaPorHora, TOPE_COSTEO_IDEA_POR_HORA_DEFECTO } from "@/lib/guiada-motor/tope-costeo-idea";
import { responderAccionIdea, respuestaCosteoBloqueado, TEXTO_MUCHOS_PEDIDOS_DE_PRECIO } from "@/lib/ia/guiado/accion-idea";
import { topeDurable, type Consulta } from "@/lib/topes/tope-durable";

/**
 * REQ-015 T12 (D-044): the idea quote chip and tool share a global hourly cap. Exhaustion prevents costing and quote audit rows.
 * Uses a fake database provider; no network or real database:
 *
 *   npx tsx --conditions=react-server scripts/test/test-tope-costeo-idea.ts
 */
delete process.env.GEMINI_API_KEY;
delete process.env.DATABASE_URL;
delete process.env.COSTEO_IDEA_TOPE_HORA;

const cotizacion = { lineas: [{ id: "l1", tamano: "12", cantidadNecesaria: 10, disponible: true, varianteId: "v1", nombre: "Globo 12", precioPaquete: 25_000, unidadesPaquete: 50, paquetes: 1, subtotal: 25_000, sobrante: 40 }], total: 25_000, mermaPorcentaje: 8, incluyeIva: true as const, complementosSoportados: false as const };
let costeos = 0;
const deps: DependenciasCosteo = {
  leerMotor: async () => "python",
  tienePlanGuardado: async () => false,
  cotizarConMotor: async () => { throw new Error("no se usa"); },
  cotizarConPython: async () => { throw new Error("no se usa"); },
  cotizarCurada: async () => { costeos += 1; return { ok: true, cotizacion, globos: 10, fuera: [] }; },
  auditar: () => undefined,
};
const idea = { id: "deco-uno", titulo: "Arco de prueba", materiales: [{ variantId: "v1", cantidad: 10 }], pasos: [{ orden: 1, texto: "Infla los globos." }] } as const;
const filas: FilaAuditoriaPlan3d[] = [];
const entorno: EntornoCosteoIdea = { decoraciones: [idea], requestId: "r1", superficie: "/api/asistente-guiado", costeo: deps, registrarAuditoria: async (fila) => { filas.push(fila); }, tomarCosteo: tomarCosteoIdeaDurable, devolverCosteo: devolverCosteoIdeaDurable };
const pedir = () => costearIdeaElegida({}, { decoracionId: idea.id, uso: "personal" }, entorno);

/** Fake atomic counter, optionally unavailable. */
function baseFalsa(cae: () => boolean): { consulta: Consulta; sentencias: unknown[][] } {
  const sentencias: unknown[][] = [];
  let usadas = 0;
  const consulta: Consulta = async (_sql, parametros) => {
    if (parametros.length === 0) return { rows: [] };
    sentencias.push([...parametros]);
    if (cae()) throw new Error("base caída");
    const tope = Number(parametros[2]);
    if (usadas >= tope) return { rows: [] };
    usadas += 1;
    return { rows: [{ usadas, ventana: "2026-10-13 10:00:00+00" }] };
  };
  return { consulta, sentencias };
}
const conBase = (consulta: Consulta) => topeDurable().usarProveedor(async () => consulta);

void (async () => {
  // Invalid configuration never removes the cap.
  assert.equal(TOPE_COSTEO_IDEA_POR_HORA_DEFECTO, 300);
  assert.equal(topeCosteoIdeaPorHora({}), 300);
  assert.equal(topeCosteoIdeaPorHora({ COSTEO_IDEA_TOPE_HORA: "5" }), 5);
  for (const roto of ["3000000000", "", "0", "-3", "abc", "1.5", "Infinity"]) assert.equal(topeCosteoIdeaPorHora({ COSTEO_IDEA_TOPE_HORA: roto }), 300, `«${roto}» cae al valor por defecto`);

  // Missing database: the bounded memory fallback still allows quotes below the cap.
  topeDurable().usarProveedor(async () => { throw new Error("sin base"); });
  const bajo = await pedir();
  assert.ok(bajo.ok && bajo.costeo.cotizacion?.total === 25_000);
  assert.equal(filas.length, 1);
  assert.equal(costeos, 1);

  // Exhausted memory cap: no costing or durable quote audit row.
  reiniciarCosteoIdeaPorHora();
  process.env.COSTEO_IDEA_TOPE_HORA = "2";
  costeos = 0; filas.length = 0;
  assert.ok((await pedir()).ok);
  assert.ok((await pedir()).ok);
  const negada = await pedir();
  assert.deepEqual(negada, { ok: false, motivo: "muchos_pedidos_de_precio" });
  assert.equal(costeos, 2, "el costeo negado no corre");
  assert.equal(filas.length, 2, "ni deja fila de auditoría");
  const chip = await responderAccionIdea("costear", idea, pedir);
  assert.equal(chip.motivo, "muchos_pedidos");
  assert.equal(chip.texto, TEXTO_MUCHOS_PEDIDOS_DE_PRECIO);
  assert.match(chip.texto, /Muchas personas están pidiendo precios ahora; vuelve a intentarlo en unos minutos/);
  assert.doesNotMatch(chip.texto, /tope|motor|python|plan_|429/i, "sin jerga");
  assert.equal("cotizacion" in chip.result, false);
  assert.equal(costeos, 2);
  assert.equal(filas.length, 2);

  // Validation precedes the cap and preserves its own denial reason.
  assert.deepEqual(await costearIdeaElegida({}, { decoracionId: idea.id }, entorno), { ok: false, motivo: "falta_que_el_cliente_elija_negocio_o_personal" });

  // The memory counter opens a new window after one hour.
  reiniciarCosteoIdeaPorHora();
  assert.equal(tomarCosteoIdea(1_000, 1).ok, true);
  assert.equal(tomarCosteoIdea(2_000, 1).ok, false);
  assert.equal(tomarCosteoIdea(1_000 + 3_600_001, 1).ok, true, "pasada la hora, una ventana nueva");

  // The durable counter receives the global key and configured cap.
  reiniciarCosteoIdeaPorHora();
  const viva = baseFalsa(() => false);
  conBase(viva.consulta);
  costeos = 0; filas.length = 0;
  assert.ok((await pedir()).ok);
  assert.ok((await pedir()).ok);
  assert.equal((await pedir()).ok, false);
  assert.equal(costeos, 2);
  assert.deepEqual(viva.sentencias.map((p) => [p[0], p[2]]), [[CLAVE_COSTEO_IDEA_POR_HORA, 2], [CLAVE_COSTEO_IDEA_POR_HORA, 2], [CLAVE_COSTEO_IDEA_POR_HORA, 2]]);

  // Database failure retains the configured cap in memory.
  reiniciarCosteoIdeaPorHora();
  let caida = false;
  const intermitente = baseFalsa(() => caida);
  topeDurable().usarProveedor(async () => intermitente.consulta);
  caida = true;
  costeos = 0;
  assert.ok((await pedir()).ok);
  assert.ok((await pedir()).ok);
  assert.equal((await pedir()).ok, false, "con la base caída el mismo N sigue valiendo, en memoria");
  assert.equal(costeos, 2);

  // An interrupted quote refunds its slot and propagates the original error.
  topeDurable().usarProveedor(async () => { throw new Error("sin base"); });
  reiniciarCosteoIdeaPorHora();
  process.env.COSTEO_IDEA_TOPE_HORA = "1";
  const roto: EntornoCosteoIdea = { ...entorno, costeo: { ...deps, auditar: () => { throw new Error("motor caído"); } } };
  await assert.rejects(() => costearIdeaElegida({}, { decoracionId: idea.id, uso: "personal" }, roto), /motor caído/);
  assert.ok((await pedir()).ok, "tras el fallo el cupo sigue disponible");

  reiniciarCosteoIdeaPorHora();
  const vieja = tomarCosteoIdea(1_000, 1);
  assert.ok(tomarCosteoIdea(3_601_001, 1).ok);
  await devolverCosteoIdeaDurable(vieja);
  assert.equal(tomarCosteoIdea(3_601_002, 1).ok, false, "un recibo viejo no devuelve cupo de otra hora");

  // The tool shares the same cap and translates exhaustion into a customer message.
  const fuente = await (await import("node:fs/promises")).readFile("src/app/api/asistente-guiado/route.ts", "utf8");
  assert.match(fuente, /tomarCosteo: tomarCosteoIdeaDurable/, "la ruta inyecta el tope en el entorno que usan chip y herramienta");
  assert.match(fuente, /respuestaCosteoBloqueado\(resultado.motivo\)/, "la herramienta devuelve un aviso que el modelo puede decir");
  const aviso = respuestaCosteoBloqueado("muchos_pedidos_de_precio");
  assert.equal(aviso.ok, false);
  assert.match(String(aviso.aviso), /No inventes ni estimes un precio/);
  console.log("test-tope-costeo-idea: el costeo de una idea tiene tope global por hora, con respaldo en memoria");
})().catch((error: unknown) => { console.error(error); process.exit(1); });
