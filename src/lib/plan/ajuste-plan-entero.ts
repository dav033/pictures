import "server-only";
import type { Pool } from "pg";
import { llamarPythonCatalogSelection } from "@/lib/ia/nucleo/python-adapter";
import { getRagPool } from "@/lib/rag/db";
import { encolarEscrituraObservabilidad, registrarPlanAudit } from "@/lib/rag/observability/log";
import { decidir } from "@/lib/registro/servidor";
import { acabadoMotorDeTitulo, planConColor, planSinPieza, type GloboNuevo } from "./ajuste-estructural";
import { errorAllowlistDesdePython } from "./allowlist-producto-variante";
import { conteosDeLaEdicion, contextoBaseExigido, correlationDesde, lecturasGuirnaldaDeLaEdicion, MENSAJE_APROBACION_INVALIDA, type AplicarEdicionResultado } from "./aplicar-edicion";
import { allowlistDesdeMapa, crearTokenPlan, mapaDesdeAllowlist, verificarTokenAprobacion, type ContextoPlan } from "./aprobacion";
import { claveResolucion, recordarResolucion, resolucionRecordada } from "./cache-resoluciones";
import { coloresRealesProducto } from "./colores-producto";
import { conFotosDeCatalogo } from "./cotizacion-fotos";
import { EDICION_PYTHON_DEADLINE_MS, exigirContextoPython } from "./edicion-python";
import { PlanEditError } from "./edicion-error";
import type { BasePlan } from "./edicion-esquemas";
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

type Verificado = {
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
async function verificarBase({ base, signal }: Entrada): Promise<Verificado> {
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
export async function agregarColorPlan(input: Entrada & { color: string; productId: string; variantIds: readonly string[] }): Promise<AplicarEdicionResultado & { piezas: string[] }> {
  const pool = input.pool ?? getRagPool();
  const verificado = await verificarBase(input);
  const admitidas = await admitirVariantes(verificado, input.productId, input.variantIds, input.signal);
  if (!admitidas.colores.some((color) => normal(color) === normal(input.color))) {
    throw new PlanEditError(422, "Ese globo no es del color que elegiste. Prueba con otro color.");
  }
  const globo: GloboNuevo = { product_id: input.productId, color: normal(input.color), acabadoMotor: acabadoMotorDeTitulo(admitidas.titulo) };
  const allowlist = allowlistDesdeMapa(verificado.whitelist);
  const primero = planConColor(input.base.plan, globo);
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
    entrada: { plan_hash: input.base.plan_hash, color: input.color, variantesPedidas: input.variantIds.length },
  });
  return { ...firmar(verificado, resolucion, allowlist, { accion: "agregar_color", color: globo.color, product_id: input.productId, piezas }, pool), piezas };
}
