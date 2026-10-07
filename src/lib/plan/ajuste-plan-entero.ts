import "server-only";
import type { Pool } from "pg";
import { llamarPythonCatalogSelection } from "@/lib/ia/nucleo/python-adapter";
import { getRagPool } from "@/lib/rag/db";
import { encolarEscrituraObservabilidad, registrarPlanAudit } from "@/lib/rag/observability/log";
import { decidir } from "@/lib/registro/servidor";
import { acabadoMotorDeTitulo, planConColor, planConColorReemplazado, planSinPieza, type GloboNuevo } from "./ajuste-estructural";
import { errorAllowlistDesdePython } from "./allowlist-producto-variante";
import { conteosDeLaEdicion, contextoBaseExigido, correlationDesde, lecturasGuirnaldaDeLaEdicion, MENSAJE_APROBACION_INVALIDA, type AplicarEdicionResultado } from "./aplicar-edicion";
import { allowlistDesdeMapa, crearTokenPlan, mapaDesdeAllowlist, verificarTokenAprobacion, type ContextoPlan } from "./aprobacion";
import { claveResolucion, recordarResolucion, resolucionRecordada } from "./cache-resoluciones";
import { coloresRealesProducto } from "./colores-producto";
import { conFotosDeCatalogo } from "./cotizacion-fotos";
import { EDICION_PYTHON_DEADLINE_MS, exigirContextoPython } from "./edicion-python";
import { PlanEditError } from "./edicion-error";
import type { BasePlan } from "./edicion-esquemas";
import { piezasCambiadas, piezasIntactas, planConPiezaEditada, planConPiezaNueva, type PiezaEditada, type PiezaNuevaArmada, type PiezaNuevaEntrada, type UbicacionPiezaNueva } from "./pieza-nueva";
import { resolverPlan, type ResolucionPlan } from "./resolver-backend";
import type { PlanResuelto } from "./resuelto";
import { PlanDecoracionSchema, type PlanDecoracion } from "./tipos";

/**
 * «Quitar pieza» y «Añadir un color» de «Ajustar mi plan», sin modelo y con garantía determinista: el cambio se hace
 * sobre la entrada del plan firmado (`ajuste-estructural.ts`) y Python lo vuelve a resolver y a firmar, como cualquier
 * edición de `/api/plan-editar`. Lo que no se toca queda igual: mismas medidas, armados, pesos y nombres.
 *
 * Solo usa lo que el Python del VPS ya tiene (commit e447cfe): `/plan/resolve` y `/catalog/selection`. La mutación de
 * la entrada (quitar una estructura entera, añadir un material a la paleta) no existe como edición en
 * `plan_edicion.py`; se hace aquí sobre datos firmados y Python sigue siendo el único que cuenta los globos.
 */

type Entrada = { base: BasePlan; signal?: AbortSignal; pool?: Pool };

export type Verificado = {
  contexto: ContextoPlan;
  snapshot: string;
  whitelist: Map<string, Set<string>>;
  correlationId: string;
  requestId: string;
  antes: ResolucionPlan;
};

function resolver(base: BasePlan, verificado: Pick<Verificado, "snapshot" | "correlationId" | "contexto">, plan: PlanDecoracion, allowlist: ContextoPlan["allowlist"], signal?: AbortSignal, conConteos = true) {
  const conteos = conConteos ? conteosDeLaEdicion(base, null, verificado.contexto.medidasDelCliente) : undefined;
  const lecturas = conConteos ? lecturasGuirnaldaDeLaEdicion(base) : undefined;
  return resolverPlan({
    plan,
    allowlist,
    catalogSnapshotId: verificado.snapshot,
    // ADR-0031/0032: las lecturas de la foto vuelven a viajar para no perderse; no se ajusta ninguna pieza.
    ...(conteos ? { completarConteos: true, pistasConteo: conteos.pistas, completarConteosDe: conteos.ajustar } : {}),
    ...(conteos?.medidasDelCliente ? { medidasDelCliente: true } : {}),
    ...(lecturas ? { pistasGuirnalda: lecturas } : {}),
    requestId: crypto.randomUUID(),
    correlationId: verificado.correlationId,
    ...(signal ? { signal } : {}),
  });
}

/** Lo mismo que verifica `aplicarEdicionPlan`: token firmado, procedencia Python y que el plan base no cambió. */
export async function verificarBase({ base, signal }: Entrada): Promise<Verificado> {
  const { aprobacion, contexto } = contextoBaseExigido(base);
  const snapshot = exigirContextoPython(contexto);
  const correlationId = correlationDesde(base.request_id ?? aprobacion.requestId);
  const parcial = { snapshot, correlationId, contexto };
  const antes = resolucionRecordada(base.plan_hash, claveResolucion({ plan: base.plan, catalogSnapshotId: snapshot, allowlist: contexto.allowlist }))
    ?? await resolver(base, parcial, base.plan, contexto.allowlist, signal, false);
  if (antes.resuelto.plan_hash !== base.plan_hash) throw new PlanEditError(409, "El plan base cambió desde que se mostró. Vuelve a solicitar la propuesta.");
  if (!verificarTokenAprobacion(base.approval_token, antes.resuelto.plan_hash)) throw new PlanEditError(409, MENSAJE_APROBACION_INVALIDA);
  return { ...parcial, whitelist: mapaDesdeAllowlist(contexto.allowlist), requestId: base.request_id ?? aprobacion.requestId, antes };
}

/** El plan nuevo resuelto, firmado y auditado como una edición (`PLAN_EDITED`). */
function firmar(verificado: Verificado, resolucion: ResolucionPlan, allowlist: ContextoPlan["allowlist"], geometria: Record<string, unknown>, pool: Pool): AplicarEdicionResultado {
  const resuelto = resolucion.resuelto;
  if (resuelto.compras.length === 0) throw new PlanEditError(422, "El cambio dejó tu plan sin globos disponibles.");
  const { contexto, requestId } = verificado;
  resuelto.request_id = requestId;
  resuelto.approval_token = crearTokenPlan({
    planHash: resuelto.plan_hash,
    requestId,
    backend: "python",
    catalogSnapshotId: contexto.catalogSnapshotId,
    allowlist,
    ...(contexto.creatividad === null ? {} : { creatividad: contexto.creatividad }),
    ...(contexto.medidasDelCliente ? { medidasDelCliente: true } : {}),
  });
  const firmado = PlanDecoracionSchema.safeParse(resuelto.plan);
  if (firmado.success) recordarResolucion(claveResolucion({ plan: firmado.data, catalogSnapshotId: verificado.snapshot, allowlist }), resolucion);
  encolarEscrituraObservabilidad(registrarPlanAudit(pool, {
    requestId,
    planHash: resuelto.plan_hash,
    restricciones: resuelto.plan.restricciones,
    selectedProductIds: resuelto.compras.map((compra) => compra.variant_id),
    geometry: geometria,
    costChosenCop: resuelto.totales.total_cop,
    ceilingCop: resuelto.comercial.techo_cop,
    deltaCop: resuelto.comercial.delta_cop,
    packages: { ahorro_paquetes_cop: resuelto.totales.ahorro_paquetes_cop, lineas: resuelto.compras.map((compra) => ({ variant_id: compra.variant_id, paquetes: compra.paquetes, subtotal: compra.subtotal })) },
    status: "PLAN_EDITED",
  }));
  return { plan: resuelto, cotizacion: conFotosDeCatalogo(resolucion.cotizacion, resuelto.compras), avisos: [] };
}

function planValido(plan: PlanDecoracion, mensaje: string): PlanDecoracion {
  const valido = PlanDecoracionSchema.safeParse(plan);
  if (!valido.success) throw new PlanEditError(422, mensaje);
  return valido.data;
}

/** Quita UNA pieza: las demás quedan exactamente como estaban y Python vuelve a contar y a cotizar. */
export async function quitarPiezaPlan(input: Entrada & { estructuraId: string }): Promise<AplicarEdicionResultado> {
  const pool = input.pool ?? getRagPool();
  const verificado = await verificarBase(input);
  const sin = planSinPieza(input.base.plan, input.estructuraId);
  if (!sin) throw new PlanEditError(422, "Esa pieza no se puede quitar: tu plan necesita al menos una.");
  const quitada = input.base.plan.estructuras.find((estructura) => estructura.estructura_id === input.estructuraId);
  decidir("regla:quitar_pieza", "quitar una pieza del plan sin tocar las demás", { estructura_id: input.estructuraId, nuevaFocal: sin.nuevaFocal, quedan: sin.plan.estructuras.map((estructura) => estructura.estructura_id) }, {
    entrada: { plan_hash: input.base.plan_hash, quitada: quitada ? { id: quitada.estructura_id, nombre: quitada.nombre, oficial: quitada.estructura_oficial ?? null, repeticiones: quitada.repeticiones } : null },
  });
  const plan = planValido(sin.plan, "Esa pieza no se puede quitar de este plan.");
  const allowlist = verificado.contexto.allowlist;
  const resolucion = await resolver(input.base, verificado, plan, allowlist, input.signal);
  return firmar(verificado, resolucion, allowlist, { accion: "quitar_pieza", estructura_id: input.estructuraId }, pool);
}

type Admitidas = { variantIds: string[]; titulo: string; colores: string[] };

/** Admite en el snapshot firmado las variantes (tamaños) del globo nuevo, en UNA llamada a `/catalog/selection`. */
async function admitirVariantes(verificado: Verificado, productId: string, variantIds: readonly string[], signal?: AbortSignal): Promise<Admitidas> {
  let seleccion: Awaited<ReturnType<typeof llamarPythonCatalogSelection>>;
  try {
    seleccion = await llamarPythonCatalogSelection({
      items: variantIds.map((variantId) => ({ product_id: productId, variant_id: variantId, quantity: 1 })),
      allowlist: [{ product_id: productId, variant_ids: [...variantIds] }],
      catalogSnapshotId: verificado.snapshot,
      requestId: crypto.randomUUID(),
      correlationId: verificado.correlationId,
      deadlineMs: EDICION_PYTHON_DEADLINE_MS,
      ...(signal ? { parentSignal: signal } : {}),
    });
  } catch (error) {
    throw errorAllowlistDesdePython(error) ?? error;
  }
  const validados = seleccion.validados.filter((item) => item.product_id === productId && variantIds.includes(item.variant_id));
  if (!validados.length) throw new PlanEditError(409, "Ese globo no está disponible en el catálogo de tu plan. Prueba con otro color.", "VARIANTE_NO_ADMITIDA");
  const variantes = verificado.whitelist.get(productId) ?? new Set<string>();
  for (const item of validados) variantes.add(item.variant_id);
  verificado.whitelist.set(productId, variantes);
  const primero = validados[0]!;
  return { variantIds: validados.map((item) => item.variant_id), titulo: primero.product_title, colores: coloresRealesProducto(primero.product_title, [...new Set(validados.flatMap((item) => item.colors))]) };
}

const SIN_TAMANOS_DEL_COLOR = "El catálogo no tiene globos lisos de ese color en los tamaños que llevan tus piezas. Prueba con otro color.";

function normal(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLocaleLowerCase("es");
}

/** Piezas a las que el plan resuelto les dejó globos sin cobertura que antes no faltaban. */
function piezasSinCobertura(antes: PlanResuelto, despues: PlanResuelto, productId: string): Set<string> {
  const clave = (item: PlanResuelto["sin_cobertura"][number]) => `${item.estructura_id}|${item.product_id}|${item.tamano}`;
  const yaFaltaba = new Set(antes.sin_cobertura.map(clave));
  return new Set(despues.sin_cobertura.filter((item) => item.product_id === productId && !yaFaltaba.has(clave(item))).map((item) => item.estructura_id));
}

/**
 * Añade un color a las piezas que lo admiten, con todas sus medidas, armados y pesos intactos (la paleta de cada una
 * gana el color con una parte del 15 %). Si el catálogo no tiene ese globo en algún tamaño que una pieza necesita,
 * esa pieza se queda sin el color y se vuelve a resolver una vez; si ninguna lo admite, no se cambia nada.
 */
export async function agregarColorPlan(input: Entrada & { color: string; productId: string; variantIds: readonly string[]; estructuraIds?: readonly string[] }): Promise<AplicarEdicionResultado & { piezas: string[] }> {
  const pool = input.pool ?? getRagPool();
  const verificado = await verificarBase(input);
  const admitidas = await admitirVariantes(verificado, input.productId, input.variantIds, input.signal);
  if (!admitidas.colores.some((color) => normal(color) === normal(input.color))) {
    throw new PlanEditError(422, "Ese globo no es del color que elegiste. Prueba con otro color.");
  }
  const globo: GloboNuevo = { product_id: input.productId, color: normal(input.color), acabadoMotor: acabadoMotorDeTitulo(admitidas.titulo) };
  const allowlist = allowlistDesdeMapa(verificado.whitelist);
  // Con piezas pedidas («a las columnas»), las demás no se tocan.
  const elegidas = input.estructuraIds?.length ? new Set(input.estructuraIds) : undefined;
  const primero = planConColor(input.base.plan, globo, elegidas, "el cliente no lo pidió en esta pieza");
  if (!primero.piezas.length) throw new PlanEditError(422, "Ninguna pieza de tu plan admite otro color. Quita uno de una pieza para añadir este.");
  let resolucion = await resolver(input.base, verificado, planValido(primero.plan, "No pude añadir ese color a tus piezas."), allowlist, input.signal);
  let piezas = primero.piezas;
  const faltan = piezasSinCobertura(verificado.antes.resuelto, resolucion.resuelto, input.productId);
  if (faltan.size) {
    piezas = primero.piezas.filter((id) => !faltan.has(id));
    if (!piezas.length) throw new PlanEditError(422, SIN_TAMANOS_DEL_COLOR);
    const segundo = planConColor(input.base.plan, globo, new Set(piezas));
    resolucion = await resolver(input.base, verificado, planValido(segundo.plan, "No pude añadir ese color a tus piezas."), allowlist, input.signal);
    if (piezasSinCobertura(verificado.antes.resuelto, resolucion.resuelto, input.productId).size) {
      throw new PlanEditError(422, SIN_TAMANOS_DEL_COLOR);
    }
  }
  decidir("regla:agregar_color", "añadir un color a las piezas del plan sin tocar sus medidas", { color: globo.color, product_id: input.productId, variantes: admitidas.variantIds, acabadoMotor: globo.acabadoMotor, piezas, sinCobertura: [...faltan], omitidas: primero.omitidas }, {
    entrada: { plan_hash: input.base.plan_hash, color: input.color, variantesPedidas: input.variantIds.length, estructuras: input.estructuraIds ?? null },
  });
  return { ...firmar(verificado, resolucion, allowlist, { accion: "agregar_color", color: globo.color, product_id: input.productId, piezas }, pool), piezas };
}

const SIN_TAMANOS_DEL_REEMPLAZO = "El catálogo no tiene ese globo en todos los tamaños que lleva ese color. Prueba con otro globo.";

/**
 * Cambia UN color del plan por otro globo del catálogo («Cambiar» de «Ajustar mi plan»), en todas sus medidas: cada
 * material de ese color pasa a ser el producto elegido en su mismo lugar, con su misma parte (`planConColorReemplazado`).
 * Medidas, armados, nombres y los demás colores no se tocan; Python vuelve a contar y a firmar. Si el globo nuevo no
 * cubre algún tamaño que ese color necesita, no se cambia nada (el plan quedaría con globos sin comprar).
 */
export async function reemplazarColorPlan(input: Entrada & { color: string; productIdAnterior?: string; estructuraIds?: readonly string[]; colorNuevo: string; productId: string; variantIds: readonly string[] }): Promise<AplicarEdicionResultado & { piezas: string[] }> {
  const pool = input.pool ?? getRagPool();
  const verificado = await verificarBase(input);
  const admitidas = await admitirVariantes(verificado, input.productId, input.variantIds, input.signal);
  if (!admitidas.colores.some((color) => normal(color) === normal(input.colorNuevo))) {
    throw new PlanEditError(422, "Ese globo no es del color que elegiste. Prueba con otro.");
  }
  const globo = { product_id: input.productId, color: normal(input.colorNuevo), acabadoMotor: acabadoMotorDeTitulo(admitidas.titulo) };
  const objetivo = { color: input.color, ...(input.productIdAnterior ? { product_id: input.productIdAnterior } : {}), ...(input.estructuraIds?.length ? { estructuras: new Set(input.estructuraIds) } : {}) };
  const cambio = planConColorReemplazado(input.base.plan, objetivo, globo);
  if (!cambio.piezas.length) throw new PlanEditError(422, cambio.omitidas.length ? "Esa pieza ya lleva ese globo. Prueba con otro." : "Tu plan no lleva ese color.");
  const allowlist = allowlistDesdeMapa(verificado.whitelist);
  const resolucion = await resolver(input.base, verificado, planValido(cambio.plan, "No pude cambiar ese color en tus piezas."), allowlist, input.signal);
  const faltan = piezasSinCobertura(verificado.antes.resuelto, resolucion.resuelto, input.productId);
  if (faltan.size) throw new PlanEditError(422, SIN_TAMANOS_DEL_REEMPLAZO);
  decidir("regla:reemplazar_color", "cambiar un color del plan por otro globo del catálogo sin tocar medidas ni los demás colores", { color: normal(input.color), colorNuevo: globo.color, product_id: input.productId, titulo: admitidas.titulo, variantes: admitidas.variantIds, acabadoMotor: globo.acabadoMotor, piezas: cambio.piezas, omitidas: cambio.omitidas }, {
    entrada: { plan_hash: input.base.plan_hash, color: input.color, productIdAnterior: input.productIdAnterior ?? null, estructuras: input.estructuraIds ?? null, variantesPedidas: input.variantIds.length },
  });
  return { ...firmar(verificado, resolucion, allowlist, { accion: "reemplazar_color", color: normal(input.color), colorNuevo: globo.color, product_id: input.productId, piezas: cambio.piezas }, pool), piezas: cambio.piezas };
}

// --- El CRUD por chat de la guiada: sumar, mover y renombrar una pieza (dueño, 2026-10-07) ----------------------------

const MENSAJE_PIEZA_NUEVA: Readonly<Record<Extract<PiezaNuevaArmada, { ok: false }>["motivo"], string>> = {
  tope_piezas: "Tu plan ya tiene el máximo de piezas. Quita una para sumar otra.",
  ubicacion_ocupada: "Ese lugar ya tiene una pieza en tu plan. Pídemela en otro lugar (al centro, a un lado…).",
  sin_colores: "Tu plan no lleva esos colores. Pídemela en los colores de tu plan o dime cuál añadir.",
  esquema: "No pude sumar esa pieza a tu plan.",
};

type GloboPedido = { color: string; productId: string; variantIds: readonly string[] };

/** Piezas nuevas a las que el plan resuelto les dejó globos sin cobertura. */
function sinCoberturaDe(resuelto: PlanResuelto, estructuraId: string): PlanResuelto["sin_cobertura"] {
  return resuelto.sin_cobertura.filter((item) => item.estructura_id === estructuraId);
}

/**
 * Suma UNA pieza al plan firmado («agrégale una guirnalda en medio», pedido por chat): la entrada del plan con la pieza
 * nueva (`planConPiezaNueva`: copia de una pieza igual del plan, o la estándar del tipo en los colores y productos del
 * plan) y Python la vuelve a resolver y a firmar. Garantía: las piezas de antes compran EXACTAMENTE lo mismo
 * (`piezasIntactas`); si no, no se cambia nada. Los colores que el plan no lleva llegan como globos del catálogo y se
 * admiten en el snapshot firmado (`/catalog/selection`), como «Añadir un color». Si el catálogo no cubre algún tamaño de
 * la mezcla orgánica de la pieza nueva, se intenta una vez con la mezcla clásica; si tampoco, no se cambia nada.
 */
export async function agregarPiezaPlan(input: Entrada & { pieza: Omit<PiezaNuevaEntrada, "materialesNuevos">; globos?: readonly GloboPedido[] }): Promise<AplicarEdicionResultado & { nuevas: string[]; nombre: string; ubicacion: string; medidas: Record<string, number> }> {
  const pool = input.pool ?? getRagPool();
  const verificado = await verificarBase(input);
  const materialesNuevos: Array<{ product_id: string; color: string }> = [];
  for (const globo of input.globos ?? []) {
    const admitidas = await admitirVariantes(verificado, globo.productId, globo.variantIds, input.signal);
    if (!admitidas.colores.some((color) => normal(color) === normal(globo.color))) throw new PlanEditError(422, "Ese globo no es del color que pediste. Prueba con otro color.");
    materialesNuevos.push({ product_id: globo.productId, color: normal(globo.color) });
  }
  const armada = planConPiezaNueva(input.base.plan, { ...input.pieza, ...(materialesNuevos.length ? { materialesNuevos } : {}) });
  const entrada = { plan_hash: input.base.plan_hash, pieza: input.pieza, globos: (input.globos ?? []).map((globo) => ({ color: globo.color, product_id: globo.productId, variantes: globo.variantIds.length })), piezasAntes: input.base.plan.estructuras.map((estructura) => ({ id: estructura.estructura_id, nombre: estructura.nombre, ubicacion: estructura.ubicacion })) };
  if (!armada.ok) {
    decidir("regla:agregar_pieza", "sumar una pieza al plan por chat sin tocar las demás", { aplicado: false, motivo: armada.motivo, detalle: armada.detalle }, { entrada });
    throw new PlanEditError(422, MENSAJE_PIEZA_NUEVA[armada.motivo]);
  }
  const allowlist = allowlistDesdeMapa(verificado.whitelist);
  let planNuevo = planValido(armada.plan, MENSAJE_PIEZA_NUEVA.esquema);
  let resolucion = await resolver(input.base, verificado, planNuevo, allowlist, input.signal);
  let mezclaClasica = false;
  const sinArmado = armada.plantilla !== "copia";
  if (sinCoberturaDe(resolucion.resuelto, armada.nueva).length && sinArmado && armada.plan.estructuras.at(-1)?.mezcla !== "clasica") {
    // Un color del plan sin algún tamaño de la mezcla orgánica: la misma pieza en la mezcla clásica (un tamaño).
    planNuevo = planValido({ ...planNuevo, estructuras: planNuevo.estructuras.map((estructura) => (estructura.estructura_id === armada.nueva ? { ...estructura, mezcla: "clasica" as const } : estructura)) }, MENSAJE_PIEZA_NUEVA.esquema);
    resolucion = await resolver(input.base, verificado, planNuevo, allowlist, input.signal);
    mezclaClasica = true;
  }
  const resuelto = resolucion.resuelto;
  const intactas = piezasIntactas(input.base, resuelto);
  const globosNueva = resuelto.estructuras.find((estructura) => estructura.estructura_id === armada.nueva)?.lineas.reduce((suma, linea) => suma + linea.unidades, 0) ?? 0;
  const sinCobertura = sinCoberturaDe(resuelto, armada.nueva);
  const aplicado = intactas && globosNueva > 0 && sinCobertura.length === 0;
  decidir("regla:agregar_pieza", "sumar una pieza al plan por chat sin tocar las demás (Python la cuenta y firma)", {
    aplicado, nueva: armada.nueva, nombre: armada.nombre, ubicacion: armada.ubicacion, medidas: armada.medidas, plantilla: armada.plantilla, materiales: armada.materiales,
    renombradas: armada.renombradas, mezclaClasica, intactas, cambiadas: intactas ? [] : piezasCambiadas(input.base, resuelto), globosNueva, sinCobertura,
  }, { entrada, ...(mezclaClasica ? { motivo: "el catálogo no cubría la mezcla orgánica de la pieza nueva: se resolvió con la mezcla clásica" } : {}) });
  if (!intactas) throw new PlanEditError(422, "No pude sumar esa pieza sin cambiar las que ya tienes. Tu plan sigue como estaba.");
  if (!globosNueva || sinCobertura.length) throw new PlanEditError(422, "El catálogo de tu plan no tiene esos colores en los tamaños que lleva esa pieza. Prueba con otros colores.");
  const firmado = firmar(verificado, resolucion, allowlist, { accion: "agregar_pieza", estructura_id: armada.nueva, oficial: input.pieza.estructura, ubicacion: armada.ubicacion, plantilla: armada.plantilla }, pool);
  return { ...firmado, nuevas: [armada.nueva], nombre: armada.nombre, ubicacion: armada.ubicacion, medidas: Object.fromEntries(Object.entries(armada.medidas).filter((par): par is [string, number] => typeof par[1] === "number")) };
}

const MENSAJE_PIEZA_EDITADA: Readonly<Record<Extract<PiezaEditada, { ok: false }>["motivo"], string>> = {
  sin_pieza: "No encontré esa pieza en tu plan. Tu plan sigue como estaba.",
  ubicacion_ocupada: "Ese lugar ya tiene una pieza en tu plan. Pídemela en otro lugar.",
  nombre_repetido: "Otra pieza de tu plan ya se llama así. Elige otro nombre.",
  sin_cambio: "Esa pieza ya está así en tu plan.",
  esquema: "No pude cambiar esa pieza de lugar.",
};

/**
 * Mueve o renombra UNA pieza del plan firmado («pon la guirnalda arriba», «llama a la guirnalda Cascada»): solo cambian
 * su ubicación y su nombre (`planConPiezaEditada`) y Python vuelve a resolver y a firmar. Mover no cambia los globos:
 * si alguna pieza compra otra cosa, no se cambia nada.
 */
export async function editarPiezaPlan(input: Entrada & { estructuraId: string; ubicacion?: UbicacionPiezaNueva; nombre?: string }): Promise<AplicarEdicionResultado & { nombre: string; ubicacion: string }> {
  const pool = input.pool ?? getRagPool();
  const verificado = await verificarBase(input);
  const editada = planConPiezaEditada(input.base.plan, input.estructuraId, { ...(input.ubicacion ? { ubicacion: input.ubicacion } : {}), ...(input.nombre ? { nombre: input.nombre } : {}) });
  const entrada = { plan_hash: input.base.plan_hash, estructura_id: input.estructuraId, ubicacion: input.ubicacion ?? null, nombre: input.nombre ?? null };
  if (!editada.ok) {
    decidir("regla:editar_pieza", "mover o renombrar una pieza del plan por chat", { aplicado: false, motivo: editada.motivo, detalle: editada.detalle }, { entrada });
    throw new PlanEditError(422, MENSAJE_PIEZA_EDITADA[editada.motivo]);
  }
  const allowlist = verificado.contexto.allowlist;
  const resolucion = await resolver(input.base, verificado, planValido(editada.plan, MENSAJE_PIEZA_EDITADA.esquema), allowlist, input.signal);
  const intactas = piezasIntactas(input.base, resolucion.resuelto);
  decidir("regla:editar_pieza", "mover o renombrar una pieza del plan por chat (Python vuelve a resolver; los globos no cambian)", { aplicado: intactas, antes: editada.antes, despues: editada.despues, cambiadas: intactas ? [] : piezasCambiadas(input.base, resolucion.resuelto) }, { entrada });
  if (!intactas) throw new PlanEditError(422, "No pude mover esa pieza sin cambiar sus globos. Tu plan sigue como estaba.");
  const firmado = firmar(verificado, resolucion, allowlist, { accion: "editar_pieza", estructura_id: input.estructuraId, antes: editada.antes, despues: editada.despues }, pool);
  return { ...firmado, nombre: editada.despues.nombre, ubicacion: editada.despues.ubicacion };
}
