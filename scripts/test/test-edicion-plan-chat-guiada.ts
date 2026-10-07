import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TarjetaPlan } from "@/components/guiado/TarjetaPlan";
import type { CandidatoDelServidor } from "@/components/plan/ajuste/ajuste-propuesta";
import { avisoEdicionChat, ejecutarEdicionChat, elegirGloboParaColor, estructurasDeNombres, type DependenciasEdicionChat } from "@/components/guiado/ajuste/edicion-chat-guiada";
import type { CambioPlan, PlanGuiado } from "@/components/guiado/ajuste/ajuste-plan-guiado";
import { globosDeCandidatos } from "@/components/guiado/ajuste/selector-globos";
import { AsistenteGuiadoRequestSchema, PlanActualGuiadoSchema, PlanGuiadoSchema } from "@/lib/ia/contracts/asistente-guiado-v1";
import {
  detectarEleccionIdea,
  detectarPedidoEdicion,
  fraseDelPedido,
  HERRAMIENTAS_EDICION,
  herramientaElegirIdea,
  herramientasConEdicion,
  herramientasEdicionPlan,
  ideaDesdeHerramienta,
  PedidoEdicionPlanSchema,
  pedidoDesdeHerramienta,
  type DeteccionEdicion,
  type PedidoEdicionPlan,
} from "@/lib/ia/guiado/edicion-plan-chat";
import { planActualDesdePlan } from "@/lib/ia/guiado/instruccion-plan";
import { planConColorReemplazado } from "@/lib/plan/ajuste-estructural";
import type { EdicionPlan } from "@/lib/plan/edicion-esquemas";
import { separarEstructurasRepetidas } from "@/lib/plan/piezas-individuales";

/**
 * Editar el plan vigente POR CHAT en la guiada (probador 104, 2026-10-07) y elegir una idea con palabras, sin red ni
 * modelo: qué herramienta deciden las reglas para cada pedido, cómo se valida lo que manda el modelo, qué cambios del
 * editor salen de cada pedido y que el resto del plan (título, otras piezas, medidas, acabados) queda igual. Con el
 * plan real del registro dgkw9b (semiarco orgánico + dos columnas) y dobles de /api/plan-editar: nada llama a Python
 * ni a Gemini.
 */

// --- El plan real, con las dos columnas como piezas individuales («Columna izquierda» y «Columna derecha») ---
const crudo = PlanGuiadoSchema.parse(JSON.parse(readFileSync("scripts/test/fixtures/plan-guiado-columnas-repetidas.json", "utf8")));
const separado = separarEstructurasRepetidas(crudo.plan).plan;
const [SEMIARCO, IZQUIERDA, DERECHA] = separado.estructuras.map((estructura) => estructura.estructura_id) as [string, string, string];
const plan: PlanGuiado = PlanGuiadoSchema.parse({
  ...crudo,
  approval_token: "token-de-prueba",
  plan: separado,
  estructuras: [crudo.estructuras[0]!, { ...crudo.estructuras[1]!, estructura_id: IZQUIERDA }, { ...crudo.estructuras[1]!, estructura_id: DERECHA }],
});
assert.deepEqual(plan.plan.estructuras.map((estructura) => estructura.nombre), ["Semiarco orgánico", "Columna izquierda", "Columna derecha"]);
const actual = planActualDesdePlan(plan);
assert.ok(actual, "el plan se resume para el turno");

// --- 1. Las reglas eligen la herramienta (y el pedido completo) ---------------------------------------------------
function pedido(texto: string): DeteccionEdicion {
  return detectarPedidoEdicion(texto, actual!);
}
function edicionDe(texto: string): PedidoEdicionPlan {
  const deteccion = pedido(texto);
  assert.equal(deteccion.estado, "edicion", `«${texto}» es una edición completa: ${JSON.stringify(deteccion)}`);
  return (deteccion as Extract<DeteccionEdicion, { estado: "edicion" }>).pedido;
}

const celeste = pedido("el azul cámbialo por celeste clarito en las dos columnas, el resto igual");
assert.equal(celeste.estado, "edicion");
assert.equal((celeste as Extract<DeteccionEdicion, { estado: "edicion" }>).herramienta, "cambiar_color_plan", "cambiar un color: cambiar_color_plan, NO proponer_composicion");
assert.deepEqual(edicionDe("el azul cámbialo por celeste clarito en las dos columnas, el resto igual"), { tipo: "reemplazar_color", color: "azul", colorNuevo: "celeste", piezas: ["Columna izquierda", "Columna derecha"] }, "el tono que dijo el cliente y solo las dos columnas (el semiarco también lleva azul y no se toca)");
assert.deepEqual(edicionDe("quita la columna derecha"), { tipo: "quitar_pieza", piezas: ["Columna derecha"] });
assert.deepEqual(edicionDe("hazla un poco más grande"), { tipo: "tamano", direccion: 1, piezas: [] }, "sin pieza nombrada: toda la decoración");
assert.deepEqual(edicionDe("que las columnas midan 2,5 m"), { tipo: "medidas", medidas: { alto_m: 2.5 }, piezas: ["Columna izquierda", "Columna derecha"] }, "una columna se mide en alto");
assert.deepEqual(edicionDe("el semiarco de 3 metros de ancho"), { tipo: "medidas", medidas: { ancho_m: 3 }, piezas: ["Semiarco orgánico"] });
assert.deepEqual(edicionDe("agrégale dorado a las columnas"), { tipo: "agregar_color", colores: ["dorado"], piezas: ["Columna izquierda", "Columna derecha"] });
assert.deepEqual(edicionDe("más rosado en la columna izquierda"), { tipo: "protagonismo", color: "rosado", direccion: 1, piezas: ["Columna izquierda"] });
assert.deepEqual(edicionDe("sin el plateado"), { tipo: "quitar_color", color: "plateado", piezas: [] });
assert.deepEqual(edicionDe("quita el azul y pon celeste"), { tipo: "reemplazar_color", color: "azul", colorNuevo: "celeste", piezas: [] });
assert.deepEqual(edicionDe("en vez del blanco, dorado en el semiarco"), { tipo: "reemplazar_color", color: "blanco", colorNuevo: "dorado", piezas: ["Semiarco orgánico"] });
assert.deepEqual(edicionDe("la columna de la izquierda más baja"), { tipo: "tamano", direccion: -1, piezas: ["Columna izquierda"] });
assert.equal(pedido("quita la columna").estado, "incompleta", "dos columnas y no dice cuál: el modelo pregunta");
assert.equal(pedido("el resto igual, sin tocar la columna derecha").estado, "ninguna", "«sin tocar…» no quita nada");
// CRUD por chat (dueño, 2026-10-07): sumar una pieza ya es una edición (agregar_pieza), no rehacer el plan.
assert.deepEqual(edicionDe("agrégale una columna"), { tipo: "agregar_pieza", pieza: { estructura: "columna", ubicacion: null, colores: [] } }, "agregar una pieza: se suma al plan con agregar_pieza_plan (test-crud-plan-chat-guiada.ts)");
assert.equal(pedido("agrégale dos columnas").estado, "no_cabe", "varias piezas a la vez: se rehace con proponer_composicion");
assert.equal(pedido("hazla más sencilla").estado, "no_cabe");
assert.equal(pedido("quiero otros colores: verde y blanco").estado, "no_cabe");
assert.equal(pedido("con globos más grandes").estado, "ninguna", "el tamaño de los globos no es el de la pieza");
assert.equal(pedido("¿cuánto me sale?").estado, "ninguna");
assert.equal(pedido("cambiemos a verde y dorado").estado, "no_cabe", "otra paleta sin decir qué color cambia: se rehace");
assert.equal(pedido("cambia el azul").estado, "incompleta", "no dice por cuál: el modelo pregunta");
assert.equal(pedido("mejor cambiemos, mi hijo ahora quiere dinosaurios").estado, "ninguna", "un cambio de temática no es una edición (lo resuelve cambio-tematica.ts)");

// El turno real del probador 104 (registro guiada-20261006-234525-va33im): el planActual que mandó la vista.
const delRegistro = PlanActualGuiadoSchema.parse({
  piezas: [
    { estructura: "columna", cantidad: 1, nombre: "Columna izquierda", ubicacion: "lateral_izquierdo", medidas: { ancho_m: 0.6, alto_m: 2.03 }, participacion: [{ color: "rosado", parte: 0.44 }, { color: "lila", parte: 0.14 }, { color: "azul", parte: 0.2 }, { color: "dorado", parte: 0.22 }] },
    { estructura: "columna", cantidad: 1, nombre: "Columna derecha", ubicacion: "lateral_derecho", medidas: { ancho_m: 0.6, alto_m: 2 }, participacion: [{ color: "rosado", parte: 0.28 }, { color: "lila", parte: 0.22 }, { color: "azul", parte: 0.22 }, { color: "dorado", parte: 0.28 }] },
  ],
  colores: ["rosado", "lila", "azul", "dorado"], totalGlobos: 72,
  resumen: "Tu plan: columna izquierda de 0,6 × 2,03 m y columna derecha de 0,6 × 2 m, en rosado, lila, azul y dorado; 72 globos en total.",
});
const real = detectarPedidoEdicion("el azul cámbialo por celeste clarito en las dos columnas, el resto igual", delRegistro);
assert.deepEqual(real, { estado: "edicion", herramienta: "cambiar_color_plan", pedido: { tipo: "reemplazar_color", color: "azul", colorNuevo: "celeste", piezas: ["Columna izquierda", "Columna derecha"] }, motivo: "cambiar un color por otro, con colores y piezas nombrados" }, "el pedido que rehízo el plan entero ahora es una edición del color en las dos columnas");
assert.deepEqual(detectarPedidoEdicion("quita la columna derecha", delRegistro), { estado: "edicion", herramienta: "quitar_pieza_plan", pedido: { tipo: "quitar_pieza", piezas: ["Columna derecha"] }, motivo: "quitar piezas nombradas" });
assert.equal(detectarPedidoEdicion("más rosado en la columna izquierda", delRegistro).estado, "edicion", "el ajuste del probador, ahora también por chat");

// Las herramientas del turno (lo que hace la ruta antes de llamar al modelo).
const BASE = [{ nombre: "proponer_composicion", descripcion: "", esquema: {} }, { nombre: "abrir_accion_plan", descripcion: "", esquema: {} }];
const nombres = (deteccion: DeteccionEdicion, eleccion: ReturnType<typeof detectarEleccionIdea> = null, conIdeas = false) =>
  herramientasConEdicion({ base: BASE, plan: actual, ideas: conIdeas ? [{ id: "deco-uno", titulo: "Semiarco con centros de mesa" }] : [], deteccion, eleccion }).herramientas.map((herramienta) => herramienta.nombre);
assert.deepEqual(nombres(celeste), ["cambiar_color_plan"], "«el azul cámbialo por celeste…»: solo cambiar_color_plan; sin proponer_composicion no puede rehacer el plan");
assert.deepEqual(nombres(pedido("quita la columna derecha")), ["quitar_pieza_plan"]);
assert.deepEqual(nombres(pedido("hazla un poco más grande")), ["cambiar_tamano_plan"]);
assert.deepEqual(nombres(pedido("quita la columna")), [...HERRAMIENTAS_EDICION], "falta un dato: las de edición (pregunta cuál), nunca rehacer");
assert.deepEqual(nombres(pedido("agrégale una columna")), ["agregar_pieza_plan"], "sumar una pieza: solo agregar_pieza_plan (sin proponer_composicion no puede armar un plan nuevo)");
assert.ok(nombres(pedido("hazla más sencilla")).includes("proponer_composicion"), "lo que no cabe en una edición sí puede rehacerse");
assert.deepEqual(nombres({ estado: "ninguna" }, null, true), ["proponer_composicion", "abrir_accion_plan", ...HERRAMIENTAS_EDICION, "elegir_idea"], "un turno libre con plan e ideas: todas");
const eleccionUno = detectarEleccionIdea("me quedo con la primera", [{ id: "deco-uno", titulo: "Semiarco con centros de mesa" }]);
assert.deepEqual(nombres({ estado: "ninguna" }, eleccionUno, true), ["elegir_idea"], "«me quedo con la primera»: solo elegir_idea");
assert.deepEqual(herramientasConEdicion({ base: BASE, plan: null, ideas: [], deteccion: { estado: "ninguna" }, eleccion: null }).herramientas.map((herramienta) => herramienta.nombre), ["proponer_composicion", "abrir_accion_plan"], "sin plan ni ideas, nada cambia");

// --- 2. Lo que manda el modelo se valida contra el plan y las reglas -----------------------------------------------
const ninguna: DeteccionEdicion = { estado: "ninguna" };
const delModelo = pedidoDesdeHerramienta("cambiar_color_plan", { color_actual: "Azul", color_nuevo: "azul", piezas: ["columna izquierda", "Columna Derecha"] }, { plan: actual!, ultimoUsuario: "el azul cámbialo por celeste en las columnas", deteccion: ninguna });
assert.ok(delModelo.ok);
assert.deepEqual(delModelo.pedido, { tipo: "reemplazar_color", color: "azul", colorNuevo: "celeste", piezas: ["Columna izquierda", "Columna derecha"] }, "el tono que dijo el cliente manda sobre la familia que eligió el modelo; los nombres, como los tiene el plan");
assert.equal(delModelo.origen, "modelo");
const conReglas = pedidoDesdeHerramienta("cambiar_color_plan", { color_actual: "azul", color_nuevo: "celeste" }, { plan: actual!, ultimoUsuario: "x", deteccion: celeste });
assert.ok(conReglas.ok && conReglas.origen === "reglas" && conReglas.pedido.tipo === "reemplazar_color" && conReglas.pedido.piezas.length === 2, "si las reglas leyeron la edición, mandan las reglas (el modelo había olvidado las piezas: habría cambiado también el semiarco)");
const piezaInventada = pedidoDesdeHerramienta("quitar_pieza_plan", { piezas: ["Arco principal"] }, { plan: actual!, ultimoUsuario: "quita el arco", deteccion: ninguna });
assert.ok(!piezaInventada.ok && piezaInventada.motivo === "pieza_desconocida" && /Columna izquierda/.test(piezaInventada.accion_requerida), "una pieza que no está: vuelve al modelo con los nombres reales");
const todas = pedidoDesdeHerramienta("quitar_pieza_plan", { piezas: ["Semiarco orgánico", "Columna izquierda", "Columna derecha"] }, { plan: actual!, ultimoUsuario: "quita todo", deteccion: ninguna });
assert.ok(!todas.ok && todas.motivo === "quitaria_todo");
const colorAusente = pedidoDesdeHerramienta("cambiar_color_plan", { color_actual: "verde", color_nuevo: "rojo" }, { plan: actual!, ultimoUsuario: "cambia el verde por rojo", deteccion: ninguna });
assert.ok(!colorAusente.ok && colorAusente.motivo === "color_no_esta_en_el_plan");
const medida = pedidoDesdeHerramienta("cambiar_tamano_plan", { cambio: "medida", piezas: ["Columna derecha"], alto_m: 2.4 }, { plan: actual!, ultimoUsuario: "", deteccion: ninguna });
assert.ok(medida.ok);
assert.deepEqual(medida.pedido, { tipo: "medidas", medidas: { alto_m: 2.4 }, piezas: ["Columna derecha"] });
assert.throws(() => pedidoDesdeHerramienta("mas_o_menos_color", { color: "rosado", direccion: "muchisimo" }, { plan: actual!, ultimoUsuario: "", deteccion: ninguna }), "argumentos fuera del esquema: protegerHerramientas lo devuelve al modelo como ok:false");
for (const valido of [delModelo.pedido, medida.pedido]) assert.ok(PedidoEdicionPlanSchema.safeParse(valido).success, "lo que viaja a la vista cumple el contrato");

// Las herramientas solo admiten las piezas y los colores de ESTE plan.
const herramientas = herramientasEdicionPlan(actual!);
assert.deepEqual(herramientas.map((herramienta) => herramienta.nombre), ["cambiar_color_plan", "agregar_color_plan", "quitar_color_plan", "mas_o_menos_color", "quitar_pieza_plan", "cambiar_tamano_plan", "agregar_pieza_plan", "colores_pieza_plan", "editar_pieza_plan"]);
const esquemaCambio = herramientas[0]!.esquema as { properties: { piezas: { items: { enum: string[] } }; color_actual: { enum: string[] } } };
assert.deepEqual(esquemaCambio.properties.piezas.items.enum, ["Semiarco orgánico", "Columna izquierda", "Columna derecha"]);
assert.deepEqual([...esquemaCambio.properties.color_actual.enum].sort(), ["azul", "blanco", "plateado", "rosado"]);
assert.equal(fraseDelPedido(delModelo.pedido), "Cambio el azul por celeste en columna izquierda y columna derecha; lo demás queda igual.");

// --- 3. Elegir una idea con palabras («Me gusta esta» por chat) ---------------------------------------------------
const ideas = [
  { id: "deco-semiarco-centros-de-mesa", titulo: "Semiarco con centros de mesa" },
  { id: "deco-columnas-azules", titulo: "Columnas azules y plateadas" },
  { id: "deco-bouquet-celeste", titulo: "Bouquet celeste" },
  { id: "deco-guirnalda-nino", titulo: "Guirnalda baby shower niño" },
];
const primero = detectarEleccionIdea("Mejor me quedo con el primero, el semiarco con centros de mesa", ideas);
assert.deepEqual(primero && { id: primero.idea.id, posicion: primero.posicion, por: primero.por }, { id: "deco-semiarco-centros-de-mesa", posicion: 1, por: "ambas" });
assert.equal(detectarEleccionIdea("me quedo con la primera idea", ideas)?.posicion, 1);
assert.equal(detectarEleccionIdea("quiero la tercera", ideas)?.idea.id, "deco-bouquet-celeste");
assert.equal(detectarEleccionIdea("me gusta la de las columnas azules", ideas)?.idea.id, "deco-columnas-azules", "por su título");
assert.equal(detectarEleccionIdea("me quedo con la última", ideas)?.posicion, 4);
assert.equal(detectarEleccionIdea("me quedo con la segunda, la del bouquet celeste", ideas)?.idea.id, "deco-bouquet-celeste", "si la posición y el título no coinciden, manda el título");
assert.equal(detectarEleccionIdea("es la primera vez que hago esto, me gusta", ideas), null, "«la primera vez» no elige nada");
assert.equal(detectarEleccionIdea("muéstrame otras como la primera", ideas), null, "pedir más ideas no es elegir");
assert.equal(detectarEleccionIdea("no me gusta la primera", ideas), null);
assert.equal(detectarEleccionIdea("quiero algo rosado con columnas", ideas), null, "describir lo que quiere no es elegir");
assert.equal(detectarEleccionIdea("quita la primera columna", ideas), null, "editar el plan no es elegir una idea");
// El carrusel real del probador 104 (registro guiada-20261006-235906-fswwz2).
const ideasReales = [
  { id: "deco-real-03-63ba2a23-cda3-4af6-af27-bb1746751288-1", titulo: "Semiarco azul y plateado con centros de mesa" },
  { id: "deco-real-10-images-25", titulo: "Semiarco azul, blanco y plateado" },
  { id: "deco-real-20-semiarcoilusionazul-1200x1200", titulo: "Semiarco azul ilusión" },
  { id: "deco-real-16-images-31", titulo: "Guirnalda azul" },
];
const delProbador = detectarEleccionIdea("Mejor me quedo con el primero, el semiarco con centros de mesa", ideasReales);
assert.deepEqual(delProbador && [delProbador.idea.id, delProbador.posicion, delProbador.por], ["deco-real-03-63ba2a23-cda3-4af6-af27-bb1746751288-1", 1, "ambas"], "el «Excelente elección» sin elegir ahora elige la idea");
assert.equal(detectarEleccionIdea("me gusta el semiarco azul ilusión", ideasReales)?.posicion, 3);
assert.ok(AsistenteGuiadoRequestSchema.safeParse({ schema_version: "asistente-guiado.v1", messages: [{ role: "user", content: "x" }], brief: {}, estadoGuiado: { ideasMostradas: ideasReales } }).success, "los ids reales cumplen el contrato");
const porModelo = ideaDesdeHerramienta({ titulo: "Columnas azules y plateadas" }, ideas, null);
assert.ok(porModelo.ok && porModelo.idea.posicion === 2 && porModelo.origen === "modelo");
const porPosicion = ideaDesdeHerramienta({ posicion: 4 }, ideas, null);
assert.ok(porPosicion.ok && porPosicion.idea.id === "deco-guirnalda-nino");
const ninguna2 = ideaDesdeHerramienta({ posicion: 9 }, ideas, null);
assert.ok(!ninguna2.ok && /1\. «Semiarco con centros de mesa»/.test(ninguna2.accion_requerida));
assert.deepEqual((herramientaElegirIdea(ideas).esquema as { properties: { titulo: { enum: string[] } } }).properties.titulo.enum, ideas.map((idea) => idea.titulo));
assert.ok(AsistenteGuiadoRequestSchema.safeParse({ schema_version: "asistente-guiado.v1", messages: [{ role: "user", content: "me quedo con el primero" }], brief: {}, estadoGuiado: { ideasMostradas: ideas } }).success, "el turno lleva las ideas a la vista");

// --- 4. El globo del catálogo para «celeste» ------------------------------------------------------------------------
function variante(id: string, diam: number, color: string) {
  return { variantId: id, titulo: `R-${diam}`, disponible: true, codigoTamano: `R-${diam}`, diamPulg: diam, forma: "redondo", colores: [color] };
}
const CELESTE_FASHION = "8634000000101";
const CELESTE_PASTEL = "8634000000102";
const candidatosAzules: CandidatoDelServidor[] = [
  { productId: "8634000000100", titulo: "B2b Globo Latex Redondo Reflex Azul", imagen: null, variantes: [variante("ra12", 12, "azul"), variante("ra5", 5, "azul")] },
  { productId: CELESTE_PASTEL, titulo: "B2b Globo Latex Redondo Pastel Mate Azul", imagen: null, variantes: [variante("pm12", 12, "azul")] },
  { productId: CELESTE_FASHION, titulo: "B2b Globo Latex Redondo Fashion Azul Celeste", imagen: null, variantes: [variante("fc12", 12, "azul"), variante("fc5", 5, "azul"), variante("fc18", 18, "azul")] },
  { productId: "8634239385895", titulo: "B2b Globo Latex Redondo Fashion Azul", imagen: null, variantes: [variante("fa12", 12, "azul")] },
];
const globos = globosDeCandidatos(candidatosAzules);
const paraCeleste = elegirGloboParaColor(globos, { color: "celeste", tamanos: [12], acabadoPreferido: "Fashion", excluir: new Set(["8634239385895"]) });
assert.equal(paraCeleste?.globo.productId, CELESTE_FASHION, "celeste: el Fashion Azul Celeste (mismo acabado que el azul de antes), nunca el Reflex Azul");
assert.deepEqual(paraCeleste?.globo.variantIds, ["fc12", "fc5", "fc18"], "con todas sus variantes");
assert.equal(elegirGloboParaColor(globos, { color: "celeste", tamanos: [12], acabadoPreferido: "Reflex" })?.globo.productId, CELESTE_FASHION, "un Reflex no es celeste aunque el de antes fuera Reflex");
assert.equal(elegirGloboParaColor(globos, { color: "azul", tamanos: [12, 5], acabadoPreferido: "Reflex" })?.globo.productId, "8634000000100", "azul (sin tono): el mismo acabado que el de antes y que cubra los tamaños");
assert.equal(elegirGloboParaColor(globos, { color: "rosado", tamanos: [12], acabadoPreferido: null }), null, "sin globos de ese color: null (el chat dice «No encontré globos lisos…»)");

// --- 5. El pedido se hace con los cambios del editor y lo demás queda igual -----------------------------------------
type Llamada = { tipo: string; detalle: unknown };

function dobles(llamadas: Llamada[], candidatos: readonly CandidatoDelServidor[] = candidatosAzules): DependenciasEdicionChat {
  let version = 0;
  const firmado = (base: PlanGuiado, planNuevo: PlanGuiado["plan"]): PlanGuiado => PlanGuiadoSchema.parse({ ...base, plan: planNuevo, plan_hash: `${(version += 1)}`.padStart(64, "e") });
  return {
    buscarGlobos: async (familia, token, palabra) => { llamadas.push({ tipo: "buscar", detalle: { familia, token, palabra } }); return candidatos; },
    reemplazarColor: async (base, cambio) => {
      llamadas.push({ tipo: "reemplazar", detalle: { color: cambio.color, estructuraIds: cambio.estructuraIds ?? null, productId: cambio.globo.productId, variantIds: cambio.globo.variantIds } });
      // Lo mismo que hace el servidor (ajuste-plan-entero.ts) antes de que Python cuente: la entrada del plan con el color cambiado.
      const hecho = planConColorReemplazado(base.plan, { color: cambio.color, ...(cambio.estructuraIds?.length ? { estructuras: new Set(cambio.estructuraIds) } : {}) }, { product_id: cambio.globo.productId, color: cambio.globo.color, acabadoMotor: "mate" });
      return { plan: firmado(base, hecho.plan), cotizacion: null, piezas: hecho.piezas };
    },
    quitarPieza: async (base, estructuraId) => {
      llamadas.push({ tipo: "quitar-pieza", detalle: estructuraId });
      return { plan: firmado(base, { ...base.plan, estructuras: base.plan.estructuras.filter((estructura) => estructura.estructura_id !== estructuraId) }), cotizacion: null };
    },
    agregarColor: async (base, globo, estructuraIds) => {
      llamadas.push({ tipo: "agregar-color", detalle: { productId: globo.productId, estructuraIds: estructuraIds ?? null } });
      return { plan: firmado(base, base.plan), cotizacion: null, piezas: [...(estructuraIds ?? [])] };
    },
    aplicar: async (base, edicion: EdicionPlan) => {
      llamadas.push({ tipo: "aplicar", detalle: { accion: edicion.accion, estructura: edicion.estructura_id, alto: edicion.accion === "armado_columna" ? edicion.armado_columna?.cuerpo.alto_m : null } });
      const estructuras = base.plan.estructuras.map((estructura) => (estructura.estructura_id === edicion.estructura_id && edicion.accion === "armado_columna" && edicion.armado_columna
        ? { ...estructura, armado_columna: edicion.armado_columna, medidas: { ...estructura.medidas, alto_m: edicion.armado_columna.cuerpo.alto_m } }
        : estructura));
      return { plan: firmado(base, { ...base.plan, estructuras }), cotizacion: null };
    },
  };
}

async function probarEjecucion(): Promise<void> {
  // «el azul cámbialo por celeste clarito en las dos columnas, el resto igual»
  const llamadas: Llamada[] = [];
  const hecha = await ejecutarEdicionChat(plan, edicionDe("el azul cámbialo por celeste clarito en las dos columnas, el resto igual"), dobles(llamadas));
  assert.deepEqual(llamadas.map((llamada) => llamada.tipo), ["buscar", "reemplazar"], "una búsqueda de globos y UN cambio del editor; ninguna llamada a /api/chat");
  assert.deepEqual(llamadas[0]!.detalle, { familia: "azul", token: "token-de-prueba", palabra: "celeste" }, "busca la familia del catálogo (con la palabra del tono) en el catálogo firmado del plan");
  assert.deepEqual(llamadas[1]!.detalle, { color: "azul", estructuraIds: [IZQUIERDA, DERECHA], productId: CELESTE_FASHION, variantIds: ["fc12", "fc5", "fc18"] }, "solo en las dos columnas, con el globo celeste y todos sus tamaños");
  const antes = plan.plan;
  const despues = hecha.plan.plan;
  assert.equal(despues.concepto.titulo, antes.concepto.titulo, "el título no cambia");
  assert.deepEqual(despues.estructuras[0], antes.estructuras[0], "el semiarco (que también lleva azul) queda idéntico");
  for (const indice of [1, 2]) {
    const [de, a] = [antes.estructuras[indice]!, despues.estructuras[indice]!];
    assert.deepEqual(a.medidas, de.medidas, "las medidas de cada columna no cambian");
    assert.deepEqual(a.armado_columna, de.armado_columna, "el patrón de la columna no cambia");
    assert.equal(a.nombre, de.nombre);
    assert.deepEqual(a.materiales[0], { product_id: CELESTE_FASHION, color: "azul", participacion: de.materiales[0]!.participacion, rol_material: de.materiales[0]!.rol_material }, "el azul pasa al celeste en su mismo lugar y con su misma parte");
    assert.deepEqual(a.materiales.slice(1), de.materiales.slice(1), "plateado (Reflex), blanco y rosado: mismos productos y acabados");
  }
  assert.deepEqual(despues.estructuras[1]!.materiales, despues.estructuras[2]!.materiales, "las dos columnas quedan iguales entre sí");
  assert.match(hecha.descripcion, /en lugar de azul en la columna izquierda y la columna derecha$/, `«Último ajuste»: ${hecha.descripcion}`);
  assert.match(hecha.confirmacion, /^Listo: .* en lugar de azul; medidas y demás colores quedaron igual\.$/, hecha.confirmacion);
  assert.ok(hecha.descripcion.length <= 160);

  // «quita la columna derecha»: una sola pieza, las demás intactas.
  const quitadas: Llamada[] = [];
  const sinDerecha = await ejecutarEdicionChat(plan, edicionDe("quita la columna derecha"), dobles(quitadas));
  assert.deepEqual(quitadas, [{ tipo: "quitar-pieza", detalle: DERECHA }]);
  assert.deepEqual(sinDerecha.plan.plan.estructuras, plan.plan.estructuras.slice(0, 2), "el semiarco y la columna izquierda, idénticos");
  assert.equal(sinDerecha.confirmacion, "Listo: quité la columna derecha; lo demás quedó igual.");

  // «hazla un poco más grande»: todas las piezas un 10 %, una tras otra (tamano-todo del editor).
  const agrandadas: Llamada[] = [];
  await ejecutarEdicionChat(plan, edicionDe("hazla un poco más grande"), dobles(agrandadas));
  assert.deepEqual(agrandadas.map((llamada) => (llamada.detalle as { estructura: string }).estructura), [SEMIARCO, IZQUIERDA, DERECHA], "cada pieza crece, encadenadas");

  // «que las columnas midan 2,5 m»: la izquierda y, sobre ese plan, la derecha con la misma medida (pareja).
  const medidas: Llamada[] = [];
  const altas = await ejecutarEdicionChat(plan, edicionDe("que las columnas midan 2,5 m"), dobles(medidas));
  assert.deepEqual(medidas.map((llamada) => llamada.detalle), [{ accion: "armado_columna", estructura: IZQUIERDA, alto: 2.5 }, { accion: "armado_columna", estructura: DERECHA, alto: 2.5 }], "un solo cambio «a las dos»: las dos columnas miden lo mismo");
  assert.deepEqual(altas.plan.plan.estructuras[0], plan.plan.estructuras[0], "el semiarco no cambia");

  // «agrégale dorado a las columnas»: el color nuevo solo en esas piezas.
  const doradas: Llamada[] = [];
  const conDorado = await ejecutarEdicionChat(plan, edicionDe("agrégale dorado a las columnas"), dobles(doradas, [{ productId: "8634000000200", titulo: "B2b Globo Latex Redondo Reflex Dorado", imagen: null, variantes: [variante("rd12", 12, "dorado")] }]));
  assert.deepEqual(doradas.map((llamada) => llamada.tipo), ["buscar", "agregar-color"]);
  assert.deepEqual(doradas[1]!.detalle, { productId: "8634000000200", estructuraIds: [IZQUIERDA, DERECHA] }, "/api/plan-editar recibe las piezas (estructura_ids)");
  assert.match(conDorado.descripcion, /^con Reflex Dorado en la columna izquierda y la columna derecha$/, conDorado.descripcion);

  // Con un tono, si la búsqueda con su palabra no trae ninguno del tono, se busca en toda la familia.
  const segunda: Llamada[] = [];
  const sinCelesteAlPrincipio: DependenciasEdicionChat = { ...dobles(segunda), buscarGlobos: async (familia, token, palabra) => { segunda.push({ tipo: "buscar", detalle: palabra }); return palabra ? candidatosAzules.slice(0, 1) : candidatosAzules; } };
  const conSegunda = await ejecutarEdicionChat(plan, edicionDe("el azul cámbialo por celeste en las dos columnas"), sinCelesteAlPrincipio);
  assert.deepEqual(segunda.filter((llamada) => llamada.tipo === "buscar").map((llamada) => llamada.detalle), ["celeste", null]);
  assert.equal(conSegunda.globos[0]?.globo.productId, CELESTE_FASHION);
  // Un color sin globo liso: el plan no se toca y el chat lo dice.
  await assert.rejects(ejecutarEdicionChat(plan, { tipo: "reemplazar_color", color: "azul", colorNuevo: "rosa pastel", piezas: [] }, dobles([], candidatosAzules)), /No encontré globos lisos/);
  // Una pieza que el plan ya no tiene (cambió entre el turno y el cambio): no se adivina.
  await assert.rejects(ejecutarEdicionChat(plan, { tipo: "quitar_pieza", piezas: ["Arco principal"] }, dobles([])), /No encontré esa pieza/);
  assert.deepEqual(estructurasDeNombres(plan, ["columna IZQUIERDA"]), [IZQUIERDA], "los nombres se comparan sin tildes ni mayúsculas, como en el servidor");

  // Los cambios que salen de cada pedido son los del editor (los mismos tipos que «Ajustar mi plan»).
  const tipos = new Set<CambioPlan["tipo"]>([...hecha.cambios, ...sinDerecha.cambios, ...altas.cambios, ...conDorado.cambios].map((cambio) => cambio.tipo));
  assert.deepEqual([...tipos].sort(), ["agregar-color", "medidas", "quitar-pieza", "reemplazar-color"]);
  assert.match(avisoEdicionChat(edicionDe("el azul cámbialo por celeste en las dos columnas")), /^Cambio el azul por celeste; medidas y demás colores quedan igual…$/);
}

// --- 6. La tarjeta «Tu plan» se actualiza en su sitio: esqueleto mientras se hace y «Último ajuste: …» al terminar ---
function probarTarjeta(): void {
  const props = {
    plan, imagen: null, estadoImagen: "nada" as const, usoCosteo: null, compraAbierta: false, vigente: true, ocupado: false, hechas: [], contextoCompra: {},
    onAccion: () => undefined, onCosteo: () => undefined, onProveedores: () => undefined, onDistribuidor: () => undefined, onPlanAjustado: () => undefined,
    ajustes: ["Fashion Azul Celeste en lugar de azul en la columna izquierda y la columna derecha"],
  };
  const quieta = renderToStaticMarkup(createElement(TarjetaPlan, props));
  assert.match(quieta.replace(/<!-- -->/g, ""), /Último ajuste: Fashion Azul Celeste en lugar de azul en la columna izquierda y la columna derecha/, "la tarjeta dice el último ajuste");
  assert.ok(!quieta.includes("Calculando globos"));
  const enCurso = renderToStaticMarkup(createElement(TarjetaPlan, { ...props, recalculandoPorChat: true }));
  assert.ok(enCurso.includes("Calculando globos"), "mientras se hace el cambio pedido por chat, el total muestra su esqueleto (como un ajuste del panel)");
}

probarTarjeta();
probarEjecucion()
  .then(() => console.log("edicion-plan-chat-guiada: OK"))
  .catch((error: unknown) => { console.error(error); process.exitCode = 1; });
