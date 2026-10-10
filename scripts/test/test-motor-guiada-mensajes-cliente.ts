/**
 * Lo que el cliente lee cuando un cambio del plan 3D no se hace, y el aviso del chat según la bandera (REQ-007, fase 5):
 * - el motivo técnico del motor se dice en palabras de cliente (sin códigos de formato, «paleta» ni «armado»);
 * - una tanda de razones se une entera;
 * - la vista no muestra jerga aunque le llegue un «No pude: …» con ella;
 * - con `python` el aviso del chat es byte a byte el de siempre; con el motor 3D no se nombra a Python;
 * - el aviso sigue al motor del PLAN abierto que manda la vista (`estadoGuiado.motorPlan`, P-045), no a la bandera.
 *
 * Run: npx tsx --conditions=react-server scripts/test/test-motor-guiada-mensajes-cliente.ts
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mensajeAjuste } from "../../src/components/guiado/ajuste/ejecutar-ajuste";
import { FalloPlanEditar } from "../../src/lib/plan/peticion-plan-editar";
import { motivoParaCliente, noPudeDeMotivos, unirNoPude } from "../../src/lib/guiada-motor/mensajes-cliente";
import { avisoEdicionDelPlanAbierto, avisoEdicionPlan } from "../../src/lib/ia/guiado/aviso-edicion-plan";
import { AsistenteGuiadoRequestSchema, ASISTENTE_GUIADO_VERSION } from "../../src/lib/ia/contracts/asistente-guiado-v1";

const JERGA = /R-\d|\(\d{3}\)|armad|motor|paleta|fabric|tope|token/i;

// Los motivos que de verdad dice el motor (espec-a-escena, colores-formato, herramientas de escena).
const MOTIVOS_DEL_MOTOR = [
  "Ningún color de la paleta se fabrica en R-18, R-24: se usa Fashion Blanco (005).",
  "El color Amarillo (020) no llega a la lista de materiales del armado.",
  "Lleva 3000 globos y el tope por pieza es 2000.",
  "Con esta pieza el plan pasa de 12000 globos.",
  "pieza declarada: se cuenta pero no se dibuja",
  "Ningún color de la paleta se fabrica en R-12.",
];

test("cada motivo técnico del motor se dice en palabras de cliente, sin jerga", () => {
  for (const motivo of MOTIVOS_DEL_MOTOR) {
    const frase = motivoParaCliente(motivo);
    assert.doesNotMatch(frase, JERGA, `${motivo} => ${frase}`);
    assert.ok(frase.length > 10, frase);
  }
  assert.match(motivoParaCliente("Ningún color de la paleta se fabrica en R-18"), /color/);
  assert.match(motivoParaCliente("Lleva 3000 globos y el tope por pieza es 2000."), /demasiado grande/);
});

test("las razones de una tanda se unen en una sola frase, sin repetir el «No pude» y sin repetir razones", () => {
  assert.equal(unirNoPude(["No pude: a.", "No pude: b."]), "No pude: a. B.");
  assert.equal(unirNoPude(["No pude: no reconozco el color «rosado».", "No pude: no reconozco la pieza."]), "No pude: no reconozco el color «rosado». No reconozco la pieza.");
  assert.equal(unirNoPude(["No pude: a."]), "No pude: a.");
  assert.equal(noPudeDeMotivos(["Ningún color de la paleta se fabrica en R-18.", "Ningún color de la paleta se fabrica en R-24."]), "No pude: ese color no se puede armar en esa pieza; prueba con otro color.");
});

test("la vista no muestra jerga: un «No pude: …» con códigos o con «armado» se cambia por una frase de cliente", () => {
  assert.equal(mensajeAjuste(new FalloPlanEditar("No pude: el armado de R-18 no reparte el color 020.")), "No pude: ese cambio no se puede hacer en esta pieza. Tu plan sigue como estaba; prueba con otro ajuste.");
  assert.equal(mensajeAjuste(new FalloPlanEditar("No pude: la tienda no vende algún globo de ese cambio en esa talla o color.")), "No pude: la tienda no vende algún globo de ese cambio en esa talla o color.");
});

test("el aviso del chat con python es el de siempre, byte a byte", () => {
  assert.equal(
    avisoEdicionPlan("python"),
    "La interfaz hace este cambio sobre el plan del cliente y conserva todo lo demás (título, medidas, acabados, otros colores y piezas); Python vuelve a contar los globos. Responde con UNA frase corta que diga qué cambias; no digas que ya quedó ni des cantidades ni precios.",
  );
});

test("el aviso del chat con el motor 3D no nombra a Python ni promete el recuento", () => {
  const aviso = avisoEdicionPlan("3d");
  assert.doesNotMatch(aviso, /Python/);
  assert.match(aviso, /si no se puede hacer, se le dice al cliente/);
  assert.notEqual(aviso, avisoEdicionPlan("python"));
});

test("el aviso del cambio por chat sigue al motor del plan abierto que manda la vista, no a la bandera (P-045)", () => {
  const pedido = (estadoGuiado?: Record<string, unknown>) => AsistenteGuiadoRequestSchema.parse({
    schema_version: ASISTENTE_GUIADO_VERSION, messages: [{ role: "user", content: "cambia el azul por rojo" }], brief: {}, ...(estadoGuiado ? { estadoGuiado } : {}),
  }).estadoGuiado;
  assert.equal(avisoEdicionDelPlanAbierto(pedido({ motorPlan: "3d" })), avisoEdicionPlan("3d"), "plan del 3D abierto: el aviso del 3D, diga lo que diga la bandera");
  assert.equal(avisoEdicionDelPlanAbierto(pedido({})), avisoEdicionPlan("python"), "sin el campo (planes de Python, clientes de antes): el de siempre");
  assert.equal(avisoEdicionDelPlanAbierto(pedido()), avisoEdicionPlan("python"));
  assert.equal(avisoEdicionDelPlanAbierto(pedido({ motorPlan: "cuatro-d" })), avisoEdicionPlan("python"), "un valor raro no tumba el turno: cae al de siempre");
});
