import { strict as assert } from "node:assert";
import { AsistenteGuiadoRequestSchema } from "@/lib/ia/contracts/asistente-guiado-v1";
import { costearDecoracion, type DependenciasCosteo } from "@/lib/guiada-motor/costear-idea";
import { costearIdeaElegida, type EntornoCosteoIdea } from "@/lib/guiada-motor/costear-idea-elegida";
import type { FilaAuditoriaPlan3d } from "@/lib/guiada-motor/auditoria-plan";
import { PREGUNTA_USO, responderAccionIdea } from "@/lib/ia/guiado/accion-idea";
import { accionIdeaAlElegirUso, accionIdeaDelTurno } from "@/components/guiado/opcion-idea";
import { EstadoGuardadoSchema } from "@/components/guiado/estado-guardado";

/**
 * REQ-015 T9 (D-043): los chips «Cuánto cuesta» / «Aprender a hacerlo» de una idea sin plan guardado (404) o que no se arma
 * sola (422) se responden por reglas, sin turno del modelo (que aún tenía `proponer_composicion` y la vista aceptaba su
 * propuesta sola). Sin red, sin llave de IA y sin base de datos:
 *
 *   npx tsx --conditions=react-server scripts/test/test-accion-idea-guiada.ts
 */

// Si una regla fallara y el turno llegara al modelo, que falle sin llave (nunca una llamada pagada) ni escritura en la base.
delete process.env.GEMINI_API_KEY;
delete process.env.DATABASE_URL;

const DINO = "deco-real-04-71mp5umakml-ac-uf894-1000-ql80";
const base = { schema_version: "asistente-guiado.v1", messages: [{ role: "user", content: "Quiero saber cuánto cuestan los materiales." }], brief: { evento: "cumpleaños", edad: 7, tematica: "dinosaurios" } };

// ── Contrato: la acción solo vale con la idea elegida, sin plan ni alcance, y con valores conocidos ─────────────────
const valido = (estadoGuiado: object) => AsistenteGuiadoRequestSchema.safeParse({ ...base, estadoGuiado }).success;
assert.equal(valido({ decoracionId: DINO, accionIdea: "costear" }), true);
assert.equal(valido({ decoracionId: DINO, accionIdea: "aprender", uso: "personal" }), true);
assert.equal(valido({ decoracionId: DINO, accionIdea: "comprar" }), false, "una acción desconocida se rechaza");
assert.equal(valido({ decoracionId: DINO, accionIdea: 1 }), false);
assert.equal(valido({ accionIdea: "costear" }), false, "sin idea elegida no hay acción de idea");
assert.equal(valido({ decoracionId: DINO, accionIdea: "costear", alcancePropuesta: "completa" }), false);
assert.equal(valido({ decoracionId: DINO, accionIdea: "costear", planActual: { piezas: [{ estructura: "columna", cantidad: 1 }], colores: ["rojo"] } }), false, "con plan, la acción es del plan");
assert.equal(valido({ decoracionId: DINO }), true, "un cliente que no la manda sigue igual");

// ── El costeo compartido: el mismo total que `costearDecoracion`, con la idea y el uso confirmados ────────────────
const cotizacion = { lineas: [{ id: "l1", tamano: "12", cantidadNecesaria: 10, disponible: true, varianteId: "v1", nombre: "Globo 12", precioPaquete: 25_000, unidadesPaquete: 50, paquetes: 1, subtotal: 25_000, sobrante: 40 }], total: 25_000, mermaPorcentaje: 8, incluyeIva: true as const, complementosSoportados: false as const };
const auditadas: unknown[] = [];
const deps: DependenciasCosteo = {
  leerMotor: async () => "python",
  tienePlanGuardado: async () => false,
  cotizarConMotor: async () => { throw new Error("no se usa"); },
  cotizarConPython: async () => { throw new Error("no se usa"); },
  cotizarCurada: async () => ({ ok: true, cotizacion, globos: 10, fuera: [] }),
  auditar: (_quien, _que, resultado) => { auditadas.push(resultado); },
};
const idea = { id: "deco-uno", titulo: "Arco de prueba", materiales: [{ variantId: "v1", cantidad: 10 }], pasos: [{ orden: 1, texto: "Infla los globos." }] } as const;
const filas: FilaAuditoriaPlan3d[] = [];
const entorno: EntornoCosteoIdea = { decoraciones: [idea], requestId: "r1", superficie: "/api/asistente-guiado", costeo: deps, registrarAuditoria: async (fila) => { filas.push(fila); } };

void (async () => {
  const referencia = await costearDecoracion(idea, "personal", deps);
  const costeo = await costearIdeaElegida({}, { decoracionId: idea.id, uso: "personal" }, entorno);
  assert.ok(costeo.ok);
  assert.equal(costeo.costeo.cotizacion?.total, referencia.cotizacion?.total);
  assert.equal(filas.length, 1, "deja su fila durable de auditoría");
  assert.equal((await costearIdeaElegida({}, { decoracionId: idea.id }, entorno)).ok, false, "sin uso confirmado no cotiza");
  assert.deepEqual(await costearIdeaElegida({ uso: "negocio" }, { decoracionId: idea.id, uso: "personal" }, entorno), { ok: false, motivo: "uso_o_decoracion_no_validado_por_el_cliente" }, "otro uso que el confirmado no cotiza");
  assert.deepEqual(await costearIdeaElegida({ decoracionId: "deco-otra" }, { decoracionId: idea.id, uso: "personal" }, entorno), { ok: false, motivo: "uso_o_decoracion_no_validado_por_el_cliente" }, "otra idea que la elegida no cotiza");
  assert.equal((await costearIdeaElegida({}, { decoracionId: "deco-no-existe", uso: "personal" }, entorno)).ok, false, "una idea fuera de la biblioteca no cotiza");
  assert.equal(filas.length, 1, "lo que no cotiza no deja fila de precio");

  // ── La respuesta por reglas del chip ─────────────────────────────────────────────────────────────────────────
  const precio = await responderAccionIdea("costear", idea, () => costearIdeaElegida({}, { decoracionId: idea.id, uso: "personal" }, entorno));
  assert.equal(precio.motivo, "cotizada");
  assert.equal((precio.result.cotizacion as { total: number }).total, referencia.cotizacion?.total, "el precio del chip = el de costearDecoracion");
  assert.match(precio.texto, /25\.000/);
  assert.doesNotMatch(precio.texto, /motor|python|curada|plan_/i, "sin jerga del motor");
  assert.equal("propuesta" in precio.result, false, "ninguna propuesta que la vista acepte sola");

  const faltaUso = await responderAccionIdea("costear", idea, () => costearIdeaElegida({}, { decoracionId: idea.id }, entorno));
  assert.deepEqual(faltaUso, { texto: PREGUNTA_USO, result: { preguntaUso: true }, motivo: "falta_uso" }, "sin uso, pregunta con los botones");

  let costeoLlamado = false;
  const pasos = await responderAccionIdea("aprender", { ...idea, pasos: [{ orden: 1, texto: "Infla los globos.", foto: "x.jpg" } as { orden: number; texto: string }] }, async () => { costeoLlamado = true; return { ok: false, motivo: "falta_que_el_cliente_elija_negocio_o_personal" }; });
  assert.equal(costeoLlamado, false, "aprender no cotiza");
  assert.deepEqual(pasos.result.pasos, [{ orden: 1, texto: "Infla los globos." }], "solo orden y texto: lo que admite la vista");

  // ── La vista: elegir el uso tras «Cuánto cuesta» de una idea sigue por reglas ─────────────────────────────────
  assert.equal(accionIdeaAlElegirUso({ hayIdea: true, hayPlan: false }), "costear");
  assert.equal(accionIdeaAlElegirUso({ hayIdea: true, hayPlan: true }), undefined);
  assert.equal(accionIdeaAlElegirUso({ hayIdea: false, hayPlan: false }), undefined);
  assert.equal(accionIdeaDelTurno("costear", { hayIdea: true, hayPlan: false, hayAlcance: false }), "costear", "viaja con la idea elegida y sin plan");
  assert.equal(accionIdeaDelTurno("costear", { hayIdea: true, hayPlan: true, hayAlcance: false }), undefined, "con plan, nunca (el contrato la rechazaría)");
  assert.equal(accionIdeaDelTurno("aprender", { hayIdea: false, hayPlan: false, hayAlcance: false }), undefined);
  assert.equal(accionIdeaDelTurno("costear", { hayIdea: true, hayPlan: false, hayAlcance: true }), undefined);
  assert.equal(accionIdeaDelTurno(undefined, { hayIdea: true, hayPlan: false, hayAlcance: false }), undefined);
  // Tras recargar, el pendiente guarda su acción: «Reintentar» la repite por reglas, no con el modelo.
  const sesion = EstadoGuardadoSchema.safeParse({ mensajes: [{ id: "u1", role: "user", content: "Quiero saber cuánto cuestan los materiales.", envio: { uso: "personal", accionIdea: "costear" } }], brief: {} });
  assert.ok(sesion.success, "la sesión guardada admite la acción del chip");
  assert.equal(sesion.data?.mensajes[0]?.envio?.accionIdea, "costear");
  assert.equal(EstadoGuardadoSchema.safeParse({ mensajes: [{ id: "u1", role: "user", content: "x", envio: { accionIdea: "comprar" } }], brief: {} }).success, false);

  // ── La ruta: la acción del chip se responde antes del modelo (sin llave, si llegara al modelo fallaría) ──────────
  const { POST } = await import("@/app/api/asistente-guiado/route");
  const turno = async (content: string, estadoGuiado: object) => POST(new Request("http://localhost/api/asistente-guiado", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...base, messages: [{ role: "user", content }], estadoGuiado }),
  }));
  const sinUso = await (await turno("Quiero saber cuánto cuestan los materiales.", { decoracionId: DINO, accionIdea: "costear" })).text();
  assert.match(sinUso, /"proveedor":"reglas"/, "el chip sin plan guardado no llega al modelo");
  assert.match(sinUso, /"preguntaUso":true/);
  assert.doesNotMatch(sinUso, /proponer_composicion|"propuesta"/, "ninguna herramienta ni propuesta del modelo");

  const aprender = await (await turno("Quiero aprender a hacerlo paso a paso.", { decoracionId: DINO, accionIdea: "aprender" })).text();
  assert.match(aprender, /"proveedor":"reglas"/);
  assert.match(aprender, /"pasos":\[/);
  assert.match(aprender, /"opciones":\["contratar","costear","comprar","aprender"\]/, "la idea conserva sus botones");

  const ajena = await (await turno("Quiero saber cuánto cuestan los materiales.", { decoracionId: "deco-no-existe-en-la-biblioteca", accionIdea: "costear", uso: "personal" })).text();
  assert.match(ajena, /"proveedor":"reglas"/, "una idea que no está en la biblioteca tampoco llega al modelo");
  assert.doesNotMatch(ajena, /"cotizacion"/, "ni se cotiza");

  assert.equal((await turno("hola", { decoracionId: DINO, accionIdea: "comprar" })).status, 400, "la ruta rechaza una acción desconocida");
  assert.equal((await turno("hola", { accionIdea: "costear" })).status, 400, "y una acción sin idea elegida");
  assert.ok(auditadas.length > 0);
  console.log("test-accion-idea-guiada: los chips de una idea sin plan guardado se responden por reglas, sin modelo");
})().catch((error: unknown) => { console.error(error); process.exit(1); });
