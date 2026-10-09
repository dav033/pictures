/**
 * El cambio que pide el modelo del chat sobre un plan del motor 3D (REQ-007, fase 5), con el modelo simulado: la herramienta
 * del modelo se valida en `pedidoDesdeHerramienta`, el chat lo manda al servidor del 3D con el id del turno y nunca toca
 * `/api/plan-editar`. Además: la espec que sale de una edición se vuelve a armar igual (ida y vuelta por JSON), y la red
 * de la edición lleva la bandera apagada (409) y los «No pude: …» (422) a la vista sin cambiar el plan.
 * Sin red ni modelo reales.
 *
 * Run: npx tsx --conditions=react-server scripts/test/test-motor-guiada-edicion-modelo.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { PlanGuiado } from "../../src/components/guiado/ajuste/ajuste-plan-guiado";
import { ejecutarEdicionChat3d } from "../../src/components/guiado/ajuste/edicion-chat-3d";
import { avisosDelCambio, crearDependenciasEdicion3d, FalloMotor3dApagado, type DependenciasEdicion3d } from "../../src/components/guiado/edicion-motor3d";
import type { EdicionDelCliente, RespuestaEditarMotor } from "../../src/lib/guiada-motor/editar-contrato";
import { EspecClienteV1Schema } from "../../src/lib/globos3d/motor/espec-cliente-v1";
import { aplicarEdicion, armarDesdeEspec, especDesdePropuesta, planActualDesdeEspec, type EspecClienteV1 } from "../../src/lib/globos3d/motor/v1";
import { PlanGuiadoSchema } from "../../src/lib/ia/contracts/asistente-guiado-v1";
import { pedidoDesdeHerramienta, type PedidoEdicionPlan } from "../../src/lib/ia/guiado/edicion-plan-chat";
import { FalloPlanEditar } from "../../src/lib/plan/peticion-plan-editar";

const BASE: EspecClienteV1 = especDesdePropuesta({ frase: "x", colores: ["azul", "dorado"], piezas: [{ estructura: "arco", cantidad: 1 }, { estructura: "columna", cantidad: 2 }] }).espec;
const ARCO = "EST_01_ARCO";
const plan: PlanGuiado = PlanGuiadoSchema.parse(JSON.parse(readFileSync("scripts/test/fixtures/plan-guiado-columnas-repetidas.json", "utf8")));

/** El modelo elige una herramienta con sus argumentos; se valida como lo hace el chat antes de ejecutar nada. */
function pedidoDelModelo(herramienta: Parameters<typeof pedidoDesdeHerramienta>[0], args: Record<string, unknown>, ultimoUsuario: string): PedidoEdicionPlan {
  const r = pedidoDesdeHerramienta(herramienta, args, { plan: planActualDesdeEspec(BASE), ultimoUsuario, deteccion: { estado: "ninguna" } });
  assert.ok(r.ok, `el pedido del modelo es válido (${r.ok ? "" : r.motivo})`);
  return r.pedido;
}

function respuestaDelServidor(): RespuestaEditarMotor {
  return {
    plan,
    cotizacion: { total: 1 },
    descripcion: "cambié el azul por rojo",
    confirmacion: "Listo: cambié el azul por rojo; lo demás quedó igual.",
    avisos: ["«azul» no se fabrica en los globos de la columna: puse «rojo», el más parecido."],
    noAplicadas: [],
    tocadas: [ARCO],
    turno: { turnoId: "turno-1", antes: { especHash: "a", espec: BASE }, despues: { especHash: "b", espec: BASE } },
  };
}

test("el pedido del modelo llega al servidor del 3D con el id del turno, como pedido, y el chat lo dice con el servidor como única dependencia", async () => {
  const llamadas: { edicion: EdicionDelCliente; turnoId: string | undefined }[] = [];
  const dependencias: DependenciasEdicion3d = {
    editar: async (_base, edicion, opciones) => {
      llamadas.push({ edicion, turnoId: opciones?.turnoId });
      return respuestaDelServidor();
    },
  };
  const pedido = pedidoDelModelo("cambiar_color_plan", { color_actual: "azul", color_nuevo: "rojo" }, "cambia el azul por rojo");

  const hecha = await ejecutarEdicionChat3d(plan, pedido, { dependencias, turnoId: "turno-1" });

  assert.equal(llamadas.length, 1, "una sola llamada al servidor del 3D");
  assert.deepEqual(llamadas[0]!.edicion, { tipo: "pedido", pedido });
  assert.equal(llamadas[0]!.turnoId, "turno-1");
  assert.equal(hecha.turno?.turnoId, "turno-1", "el turno vuelve para calificar el cambio");
  assert.deepEqual(hecha.piezas, [ARCO]);
  assert.match(hecha.confirmacion, /^Listo: cambié el azul por rojo; lo demás quedó igual\./);
  assert.ok(hecha.avisos?.some((aviso) => /no se fabrica/.test(aviso)), "el aviso del servidor llega al cliente");
});

test("el servidor responde 409 con la bandera en python: el cliente recibe FalloMotor3dApagado y el plan no cambia", async () => {
  const red = (async () => new Response(JSON.stringify({ error: "Este plan se arma con el motor de siempre.", codigo: "MOTOR_PYTHON", fallback: { razon: "bandera_python" } }), { status: 409, headers: { "Content-Type": "application/json" } })) as typeof fetch;
  const dependencias = crearDependenciasEdicion3d({ red });
  const pedido = pedidoDelModelo("agregar_color_plan", { color: "rosado" }, "agrega rosado");
  await assert.rejects(() => dependencias.editar(plan, { tipo: "pedido", pedido }), (error: unknown) => error instanceof FalloMotor3dApagado);
});

test("el servidor responde 422 con «No pude: …»: el cliente lee esa frase y el plan se queda como estaba", async () => {
  const frase = "No pude: la tienda no vende algún globo de ese cambio en esa talla o color.";
  const red = (async () => new Response(JSON.stringify({ error: frase, codigo: "SIN_COBERTURA" }), { status: 422, headers: { "Content-Type": "application/json" } })) as typeof fetch;
  const dependencias = crearDependenciasEdicion3d({ red });
  const pedido = pedidoDelModelo("agregar_color_plan", { color: "rosado" }, "agrega rosado");
  await assert.rejects(() => dependencias.editar(plan, { tipo: "pedido", pedido }), (error: unknown) => error instanceof FalloPlanEditar && error.message === frase);
});

test("el servidor responde 429 (cupo por hora): el cliente lee el mensaje de cliente y el plan no cambia", async () => {
  const mensaje = "Llegaste al límite de cambios por hora. Espera un rato y vuelve a intentarlo; tu plan sigue como estaba.";
  const red = (async () => new Response(JSON.stringify({ error: mensaje, codigo: "LIMITE_EDICIONES" }), { status: 429, headers: { "Content-Type": "application/json" } })) as typeof fetch;
  const dependencias = crearDependenciasEdicion3d({ red });
  const pedido = pedidoDelModelo("agregar_color_plan", { color: "rosado" }, "agrega rosado");
  await assert.rejects(() => dependencias.editar(plan, { tipo: "pedido", pedido }), (error: unknown) => error instanceof FalloPlanEditar && error.message === mensaje);
});

test("ida y vuelta: una edición se guarda como JSON, se lee de nuevo y se arma igual dos veces (mismo hash y misma lista)", () => {
  const cambiada = aplicarEdicion(BASE, { op: "tamano_pieza", pieza: ARCO, direccion: 1 });
  assert.ok(!cambiada.noAplicado, "la edición se aplica");
  const leida = EspecClienteV1Schema.parse(JSON.parse(JSON.stringify(cambiada.espec)));
  const primera = armarDesdeEspec(leida);
  const segunda = armarDesdeEspec(leida);
  assert.equal(primera.especHash, segunda.especHash);
  assert.deepEqual(primera.bom, segunda.bom);
  assert.equal(primera.especHash, armarDesdeEspec(cambiada.espec).especHash, "la espec de memoria y la leída arman el mismo plan");
  assert.notEqual(primera.especHash, armarDesdeEspec(BASE).especHash, "el tamaño cambió: otra espec, otro hash");
});

test("los avisos del cambio son los del servidor más los que el armado agrega, sin repetir", () => {
  const respuesta = respuestaDelServidor();
  assert.deepEqual(avisosDelCambio(plan, respuesta), respuesta.avisos);
});
