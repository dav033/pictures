/**
 * REQ-015 T11 (auditoría Codex P2-5): la confirmación honesta de un cambio de color (T3, `diferencia-colores.ts`) también en
 * los dos caminos del motor 3D, el de producción (D-039): el panel «Ajustar mi plan» y el chat. Si al rearmar se mueve la
 * cifra de otro color, la confirmación la dice con el cambio de precio y nunca «igual»; el servidor solo dice «lo demás
 * quedó igual» si ninguna otra cifra se movió. Sin coste: el motor y la ruta reales, Python es un doble; sin red ni base.
 *
 * Run: npx tsx --conditions=react-server scripts/test/test-confirmacion-color-motor3d.ts
 */
import assert from "node:assert/strict";
import type { CambioPlan, PlanGuiado } from "../../src/components/guiado/ajuste/ajuste-plan-guiado";
import { globosDelCatalogo3d } from "../../src/components/guiado/ajuste/catalogo-sempertex-3d";
import { ejecutarEdicionChat, type DependenciasEdicionChat } from "../../src/components/guiado/ajuste/edicion-chat-guiada";
import { hacerCambioDelPanel } from "../../src/components/guiado/ajuste/usarAjustePlanGuiado";
import type { DependenciasEdicion3d } from "../../src/components/guiado/edicion-motor3d";
import { armarDesdeEspec, cotizarBom, crosswalkIncluido, especDesdePropuesta, sobreDelMotor, type EspecClienteV1, type ResultadoMotorV1 } from "../../src/lib/globos3d/motor/v1";
import { RespuestaEditarMotorSchema, type EdicionDelCliente } from "../../src/lib/guiada-motor/editar-contrato";
import { atenderEditarMotor } from "../../src/lib/guiada-motor/editar-motor";
import { huellaDeNavegador } from "../../src/lib/guiada-motor/plan-motor";
import { crearTopePorNavegador } from "../../src/lib/guiada-motor/tope-imagenes-navegador";
import { PlanGuiadoSchema } from "../../src/lib/ia/contracts/asistente-guiado-v1";
import { PedidoEdicionPlanSchema } from "../../src/lib/ia/guiado/edicion-plan-chat";
import { otrasCifrasIguales } from "../../src/lib/plan/cifras-conservadas";
import { planGuardadoDeIdea } from "../../src/lib/plan/planes-ideas-guardados";
import { sessionToken, SESSION_COOKIE } from "../../src/lib/auth/session";
import { pythonDoble } from "../lib/python-doble-precio";

const CLAVE_APP = "clave-app-de-prueba";
const IDENTIDAD = "a1".repeat(16);
process.env.APP_PASSWORD = CLAVE_APP;
delete process.env.DATABASE_URL;
delete process.env.GUIADA_MOTOR;
const COOKIES = `${SESSION_COOKIE}=${sessionToken(CLAVE_APP)}; feedback_usuario=${IDENTIDAD}`;

const cruce = crosswalkIncluido();
const doble = pythonDoble(cruce);
const cotizar = (bom: ResultadoMotorV1["bom"]) => cotizarBom({ total: bom.total, porPieza: bom.porPieza }, { crosswalk: async () => cruce, cotizarLista: doble.cotizarLista });

/** Rearma como el motor y, si se pide, le quita `menos` globos al color `codigo` en `pieza` (lo que hizo Python en el juez). */
function armarMoviendo(mover?: { pieza: string; codigo: string; menos: number }) {
  return (espec: EspecClienteV1): ResultadoMotorV1 => {
    const armado = armarDesdeEspec(espec);
    if (!mover) return armado;
    const linea = armado.bom.porPieza[mover.pieza]?.find((item) => item.codigo === mover.codigo);
    assert.ok(linea && linea.cantidad > mover.menos, `la pieza ${mover.pieza} lleva el color ${mover.codigo}`);
    const total = armado.bom.total.find((item) => item.codigo === linea.codigo && item.formatoId === linea.formatoId)!;
    return {
      ...armado,
      bom: {
        porPieza: { ...armado.bom.porPieza, [mover.pieza]: armado.bom.porPieza[mover.pieza]!.map((item) => (item === linea ? { ...item, cantidad: item.cantidad - mover.menos } : item)) },
        total: armado.bom.total.map((item) => (item === total ? { ...item, cantidad: item.cantidad - mover.menos } : item)),
      },
    };
  };
}

/** `editar` del navegador contra la ruta real del 3D (sin red). */
function motor(mover?: { pieza: string; codigo: string; menos: number }): DependenciasEdicion3d {
  let ids = 0;
  return {
    async editar(base, edicion: EdicionDelCliente, extra = {}) {
      const respuesta = await atenderEditarMotor(new Request("https://app.test/api/guiada/motor/editar", { method: "POST", headers: { "content-type": "application/json", cookie: COOKIES }, body: JSON.stringify({ plan: base, edicion, ...(extra.turnoId ? { turnoId: extra.turnoId } : {}) }) }), {
        leerBandera: async () => ({ motor: "3d", fuente: "cookie" }),
        auditar: () => undefined,
        armar: armarMoviendo(mover),
        planGuardado: planGuardadoDeIdea,
        cotizar: (bom) => cotizar(bom),
        nuevoId: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, "0")}`,
        registrarPlan: async () => undefined,
        tomarEdicion: crearTopePorNavegador(1000).tomar,
      });
      const json: unknown = await respuesta.json();
      assert.equal(respuesta.status, 200, JSON.stringify(json));
      return RespuestaEditarMotorSchema.parse(json);
    },
  };
}

async function main(): Promise<void> {
  const { espec } = especDesdePropuesta({ frase: "x", colores: ["azul", "dorado"], piezas: [{ estructura: "arco", cantidad: 1 }, { estructura: "columna", cantidad: 2 }] });
  const resultado = armarDesdeEspec(espec);
  const cotizada = await cotizar(resultado.bom);
  if (!cotizada.ok) throw new Error("no se cotizó");
  const sobre = sobreDelMotor({ espec, resultado, cotizacion: cotizada, concepto: { titulo: "Plan de prueba", descripcion: "Plan de prueba" }, requestId: "11111111-1111-4111-8111-111111111111", navegador: huellaDeNavegador(`nav-${IDENTIDAD}`) });
  if (!sobre.ok) throw new Error(sobre.motivo);
  const base = PlanGuiadoSchema.parse(sobre.plan) as PlanGuiado;
  const antes = sobre.cotizacion;
  const codigoDe = (nombre: string) => espec.piezas[0]!.colores.find((color) => color.nombre.toLocaleLowerCase("es").includes(nombre))!.codigo;
  const AZUL = codigoDe("azul");
  const DORADO = codigoDe("dorado");
  const pesos = (valor: number) => `\\$\\s?${valor.toLocaleString("es-CO").replace(/\./g, "\\.")}`;

  // --- 1. Panel: dorado → rojo en todo el plan; al rearmar, el arco pierde 3 azules -----------------------------------
  const rojo = globosDelCatalogo3d().find((globo) => globo.variantIds.includes("015"))!;
  const dorado = base.plan.estructuras[0]!.materiales.find((material) => material.color === "dorado")!;
  const cambio: CambioPlan = { tipo: "reemplazar-color", color: "dorado", productIdAnterior: dorado.product_id, globo: { productId: rojo.productId, color: rojo.color, variantIds: rojo.variantIds, nombre: rojo.nombre } };
  const movido = await hacerCambioDelPanel(cambio, base, { motor3d: motor({ pieza: "EST_01_ARCO", codigo: AZUL, menos: 3 }), cotizacionAntes: antes, uso: "personal" });
  const despues = movido.nuevo.cotizacion as { total: number };
  assert.doesNotMatch(movido.confirmacion, /igual/i, `con una cifra movida nunca dice «igual»: ${movido.confirmacion}`);
  assert.match(movido.confirmacion, new RegExp(`^Listo: ${rojo.nombre} en lugar de dorado`), movido.confirmacion);
  assert.match(movido.confirmacion, /lleva 100 globos/, `el rojo toma los 100 del dorado: ${movido.confirmacion}`);
  assert.match(movido.confirmacion, /azul[^,.]* 97 \(antes 100\)/i, `dice la cifra que se movió: ${movido.confirmacion}`);
  assert.notEqual(despues.total, antes.total);
  assert.match(movido.confirmacion, new RegExp(`pasan de ${pesos(antes.total)} a ${pesos(despues.total)}`), `dice el cambio de precio: ${movido.confirmacion}`);
  assert.doesNotMatch(movido.confirmacion, /\bR-\d|armad|motor|sempertex-|espec/i, "sin palabras del motor");

  // Sin nada movido: «igual» sí se puede decir, y el precio que quedó.
  const quieto = await hacerCambioDelPanel(cambio, base, { motor3d: motor(), cotizacionAntes: antes, uso: "personal" });
  assert.match(quieto.confirmacion, /los mismos que tenía dorado[^;]*; los demás colores quedaron igual\./, quieto.confirmacion);
  assert.match(quieto.confirmacion, /Los materiales \(uso personal, con IVA\)/, quieto.confirmacion);

  // En el negocio no se dice una cifra personal.
  const negocio = await hacerCambioDelPanel(cambio, base, { motor3d: motor({ pieza: "EST_01_ARCO", codigo: AZUL, menos: 3 }), cotizacionAntes: antes, uso: "negocio" });
  assert.doesNotMatch(negocio.confirmacion, /\$|uso personal/, negocio.confirmacion);
  assert.match(negocio.confirmacion, /97 \(antes 100\)/, negocio.confirmacion);

  // --- 2. Chat: azul → celeste en la columna izquierda; la columna pierde 2 dorados ----------------------------------------
  const chatDeps = (mover?: { pieza: string; codigo: string; menos: number }): DependenciasEdicionChat => ({
    aplicar: async () => { throw new Error("Python no se usa en el 3D"); },
    quitarPieza: async () => { throw new Error("Python no se usa en el 3D"); },
    agregarColor: async () => { throw new Error("Python no se usa en el 3D"); },
    reemplazarColor: async () => { throw new Error("Python no se usa en el 3D"); },
    buscarGlobos: async () => [],
    motor3d: { dependencias: motor(mover), turnoId: "msj-1" },
  });
  const pedido = PedidoEdicionPlanSchema.parse({ tipo: "reemplazar_color", color: "azul", colorNuevo: "celeste", piezas: ["Columna izquierda"] });
  const chat = await ejecutarEdicionChat(base, pedido, chatDeps({ pieza: "EST_02_COLUMNA", codigo: DORADO, menos: 2 }), { cotizacionAntes: antes, uso: "personal" });
  const chatDespues = chat.cotizacion as { total: number };
  assert.doesNotMatch(chat.confirmacion, /igual/i, `con una cifra movida nunca dice «igual»: ${chat.confirmacion}`);
  assert.match(chat.confirmacion, /^Listo: .*celeste.* en lugar de azul en la columna izquierda/i, chat.confirmacion);
  assert.match(chat.confirmacion, /dorado[^,.]* 98 \(antes 100\)/i, `dice la cifra que se movió: ${chat.confirmacion}`);
  assert.match(chat.confirmacion, new RegExp(`pasan de ${pesos(antes.total)} a ${pesos(chatDespues.total)}`), `dice el cambio de precio: ${chat.confirmacion}`);

  const chatQuieto = await ejecutarEdicionChat(base, pedido, chatDeps(), { cotizacionAntes: antes, uso: "personal" });
  assert.match(chatQuieto.confirmacion, /los demás colores quedaron igual\./, chatQuieto.confirmacion);

  // --- 3. El servidor del 3D: «lo demás quedó igual» solo si no se movió ninguna otra cifra --------------------------
  const servidorMovido = await motor({ pieza: "EST_01_ARCO", codigo: AZUL, menos: 3 }).editar(base, { tipo: "cambio", cambio: { tipo: "reemplazar-color", color: "dorado", nuevo: "015" } });
  assert.doesNotMatch(servidorMovido.confirmacion, /igual/i, servidorMovido.confirmacion);
  const servidorQuieto = await motor().editar(base, { tipo: "cambio", cambio: { tipo: "reemplazar-color", color: "dorado", nuevo: "015" } });
  assert.match(servidorQuieto.confirmacion, /; lo demás quedó igual\.$/, servidorQuieto.confirmacion);
  const agrandado = await motor().editar(base, { tipo: "cambio", cambio: { tipo: "tamano-todo", direccion: 1 } });
  assert.doesNotMatch(agrandado.confirmacion, /igual/i, `agrandar cambia las cifras: ${agrandado.confirmacion}`);
  const sinColumna = await motor().editar(base, { tipo: "cambio", cambio: { tipo: "quitar-pieza", estructuraId: "EST_03_COLUMNA" } });
  assert.match(sinColumna.confirmacion, /; lo demás quedó igual\.$/, sinColumna.confirmacion);

  // --- 4. El color nuevo ya estaba en otra pieza y allí se movió: se dice (antagonista A2) ------------------------------
  const conRojo = quieto.nuevo.plan as PlanGuiado;
  const ROJO = "015";
  const azulArco = conRojo.plan.estructuras[0]!.materiales.find((material) => material.color === "azul")!;
  const soloArco: CambioPlan = { tipo: "reemplazar-color", color: "azul", productIdAnterior: azulArco.product_id, estructuraIds: ["EST_01_ARCO"], globo: { productId: rojo.productId, color: rojo.color, variantIds: rojo.variantIds, nombre: rojo.nombre } };
  const enOtra = await hacerCambioDelPanel(soloArco, conRojo, { motor3d: motor({ pieza: "EST_02_COLUMNA", codigo: ROJO, menos: 2 }), cotizacionAntes: quieto.nuevo.cotizacion, uso: "personal" });
  assert.doesNotMatch(enOtra.confirmacion, /igual/i, `el rojo de la columna se movió: ${enOtra.confirmacion}`);
  assert.match(enOtra.confirmacion, /rojo 34 \(antes 36\)/i, enOtra.confirmacion);

  // --- 5. Una pieza no tocada que cambia de producto no es «lo demás quedó igual» (antagonista A1) --------------------
  const otroProducto = PlanGuiadoSchema.parse({ ...base, estructuras: base.estructuras.map((estructura) => estructura.estructura_id !== "EST_03_COLUMNA" ? estructura : { ...estructura, lineas: estructura.lineas.map((linea, indice) => (indice === 0 ? { ...linea, product_id: "otro-producto" } : linea)) }) });
  assert.equal(otrasCifrasIguales(base, base, []), true, "sin cambios, todo igual");
  assert.equal(otrasCifrasIguales(base, otroProducto, ["EST_01_ARCO"]), false, "la columna derecha no se tocó y cambió de globo");
  assert.equal(otrasCifrasIguales(base, otroProducto, ["EST_03_COLUMNA"]), true, "en la pieza tocada lo que salió o entró no cuenta");

  console.log("test-confirmacion-color-motor3d: ok");
}

main().catch((causa: unknown) => { console.error(causa); process.exit(1); });
