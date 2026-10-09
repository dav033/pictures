import "server-only";
import { getRagPool } from "@/lib/rag/db";
import { encolarEscrituraObservabilidad, registrarPlanAudit } from "@/lib/rag/observability/log";
import { decidir } from "@/lib/registro/servidor";
import { verificarBase } from "./ajuste-plan-entero";
import type { AplicarEdicionResultado } from "./aplicar-edicion";
import { crearTokenPlan } from "./aprobacion";
import { avisosPlanDeIdea } from "./avisos-plan-idea";
import { claveResolucion, recordarResolucion } from "./cache-resoluciones";
import { conFotosDeCatalogo } from "./cotizacion-fotos";
import { PlanEditError } from "./edicion-error";
import type { BasePlan } from "./edicion-esquemas";
import { planConIdea, unirAllowlist } from "./plan-de-idea";
import { planGuardadoDeIdea } from "./planes-ideas-guardados";
import { resolverPlan } from "./resolver-backend";
import { PlanDecoracionSchema, type PlanDecoracion } from "./tipos";

/**
 * «Crear mi plan con esta idea» y «Agregar a mi plan» con la idea EXACTA (`plan-de-idea.ts`): el plan guardado de la
 * idea (sus piezas, medidas, armados, productos Sempertex y tamaños) va a Python, que lo vuelve a contar, cotizar y
 * firmar como cualquier plan. Sin modelo. Con `base`, las piezas del plan vigente quedan intactas y se suman las de la
 * idea. Solo usa `/plan/resolve`, que el Python del VPS (e447cfe) ya tiene.
 */

export { planGuardadoDeIdea };

type Entrada = { ideaId: string; base?: BasePlan; signal?: AbortSignal };

/** Globos por pieza y variante: las piezas del plan vigente tienen que quedar exactamente como estaban. */
function piezasIntactas(base: BasePlan, resuelto: { estructuras: ReadonlyArray<{ estructura_id: string; lineas: ReadonlyArray<{ variant_id: string; unidades: number }> }> }): boolean {
  const huella = (lineas: ReadonlyArray<{ variant_id: string; unidades?: unknown }>) => lineas.map((linea) => `${linea.variant_id}:${typeof linea.unidades === "number" ? linea.unidades : "?"}`).sort().join(",");
  return base.estructuras.every((antes) => {
    const despues = resuelto.estructuras.find((estructura) => estructura.estructura_id === antes.estructura_id);
    return Boolean(despues) && huella(antes.lineas) === huella(despues!.lineas);
  });
}

/** `avisos`: si el plan no salió exacto, por qué en palabras de cliente (`avisos-plan-idea.ts`); vacío si lo es. */
export type PlanDesdeIdea = AplicarEdicionResultado & { nuevas: string[]; globosIdea: number; exacto: boolean };

export async function planDesdeIdea({ ideaId, base, signal }: Entrada): Promise<PlanDesdeIdea> {
  const guardado = planGuardadoDeIdea(ideaId);
  if (!guardado) {
    decidir("regla:plan_desde_idea", "plan exacto de una idea del catálogo", { aplicado: false, motivo: "sin_plan_guardado" }, { entrada: { ideaId, conBase: Boolean(base) } });
    throw new PlanEditError(404, "Esa idea no tiene plan guardado.");
  }
  const verificado = base ? await verificarBase({ base, ...(signal ? { signal } : {}) }) : null;
  // Sumada a un plan, la idea lleva sus tallas obligatorias («R-5, R-12»): sin ellas su guirnalda salía con otros
  // tamaños y sustituciones. Si con ellas cambia alguna pieza que ya estaba, se resuelve sin ellas (abajo).
  const conTallasDeIdea = Boolean(base && guardado.plan.restricciones?.tamanos.length);
  let combinado = planConIdea(guardado.plan, base ? base.plan : null, { restriccionesDeIdea: conTallasDeIdea });
  const entradaRegistro = { ideaId, archivo: guardado.archivo, conBase: Boolean(base), planHashBase: base?.plan_hash ?? null, piezasIdea: guardado.plan.estructuras.map((estructura) => estructura.estructura_id), globosIdea: guardado.globos };
  if (!combinado.ok) {
    decidir("regla:plan_desde_idea", "plan exacto de una idea del catálogo", { aplicado: false, motivo: combinado.motivo, detalle: combinado.detalle }, { entrada: entradaRegistro, motivo: "va por el camino del modelo" });
    throw new PlanEditError(422, combinado.motivo === "ubicacion_ocupada" ? "Esa idea va donde ya hay otra pieza de tu plan." : "No pude sumar esa idea a tu plan.");
  }
  // El snapshot y los productos: los del plan vigente más los de la idea, o los de la idea sola.
  const snapshot = verificado ? verificado.snapshot : guardado.snapshot;
  const allowlist = verificado ? unirAllowlist(verificado.contexto.allowlist, guardado.allowlist) : guardado.allowlist;
  const requestId = verificado ? verificado.requestId : crypto.randomUUID();
  const correlationId = verificado ? verificado.correlationId : requestId;
  decidir("regla:plan_desde_idea", "plan exacto de una idea del catálogo: sus piezas, medidas, productos y tamaños, sin modelo", {
    aplicado: true, nuevas: combinado.nuevas, separadas: combinado.separadas, renombradas: combinado.renombradas,
    piezas: combinado.plan.estructuras.map((estructura) => ({ id: estructura.estructura_id, nombre: estructura.nombre, oficial: estructura.estructura_oficial ?? null, ubicacion: estructura.ubicacion })),
    snapshot, productos: allowlist.length,
  }, { entrada: entradaRegistro });
  const resolver = (plan: PlanDecoracion) => resolverPlan({ plan, allowlist, catalogSnapshotId: snapshot, requestId: crypto.randomUUID(), correlationId, ...(signal ? { signal } : {}) });
  let resolucion = await resolver(combinado.plan);
  let tallasDeIdea = conTallasDeIdea;
  if (base && conTallasDeIdea && !piezasIntactas(base, resolucion.resuelto)) {
    const sinTallas = planConIdea(guardado.plan, base.plan);
    if (sinTallas.ok) {
      combinado = sinTallas;
      resolucion = await resolver(sinTallas.plan);
      tallasDeIdea = false;
    }
  }
  const resuelto = resolucion.resuelto;
  if (resuelto.compras.length === 0) throw new PlanEditError(422, "Esa idea quedó sin globos disponibles.");
  resuelto.request_id = requestId;
  resuelto.approval_token = crearTokenPlan({
    planHash: resuelto.plan_hash,
    requestId,
    backend: "python",
    catalogSnapshotId: snapshot,
    allowlist,
    ...(verificado && verificado.contexto.creatividad !== null ? { creatividad: verificado.contexto.creatividad } : {}),
    ...(verificado?.contexto.medidasDelCliente ? { medidasDelCliente: true } : {}),
  });
  const firmado = PlanDecoracionSchema.safeParse(resuelto.plan);
  if (firmado.success) recordarResolucion(claveResolucion({ plan: firmado.data, catalogSnapshotId: snapshot, allowlist }), resolucion);
  const globos = resuelto.compras.reduce((suma, compra) => suma + compra.unidades_necesarias, 0);
  // Los globos de las piezas de la idea en el plan nuevo: si son los de su tarjeta, el plan es exacto.
  const nuevas = new Set(combinado.ok ? combinado.nuevas : []);
  const globosDeIdeaEnPlan = resuelto.estructuras.filter((estructura) => nuevas.has(estructura.estructura_id)).reduce((suma, estructura) => suma + estructura.lineas.reduce((parcial, linea) => parcial + linea.unidades, 0), 0);
  // Si no salió exacto, por qué y en palabras de cliente: la tarjeta lo dice (antes solo iba al registro y la ruta
  // devolvía `avisos: []`, verificador 127).
  const { exacto, avisos } = avisosPlanDeIdea({
    globosIdea: guardado.globos,
    globosDeIdeaEnPlan,
    nuevas: [...nuevas],
    sustituciones: resuelto.sustituciones,
    sinCobertura: resuelto.sin_cobertura,
    sinTallasDeIdea: conTallasDeIdea && !tallasDeIdea,
    // De qué color es la talla que falta: el producto pedido que no se pudo comprar (probador 141, I-5).
    coloresDeProducto: Object.fromEntries(resuelto.plan.estructuras.flatMap((estructura) => estructura.materiales.flatMap((material) => (material.color ? [[material.product_id, material.color] as const] : [])))),
  });
  decidir("regla:plan_desde_idea_resuelto", "Python resolvió el plan de la idea; si no es exacto, lo que ve el cliente", {
    plan_hash: resuelto.plan_hash, globos, globosIdea: guardado.globos, globosDeIdeaEnPlan, exacto, avisos,
    tallasDeIdea, sinCobertura: resuelto.sin_cobertura.length, sustituciones: resuelto.sustituciones.length,
  }, { entrada: { ideaId }, ...(conTallasDeIdea && !tallasDeIdea ? { motivo: "con las tallas de la idea cambiaba una pieza que ya estaba: se resolvió sin ellas" } : {}) });
  encolarEscrituraObservabilidad(registrarPlanAudit(getRagPool(), {
    requestId,
    planHash: resuelto.plan_hash,
    restricciones: resuelto.plan.restricciones,
    selectedProductIds: resuelto.compras.map((compra) => compra.variant_id),
    geometry: { accion: base ? "agregar_idea" : "plan_de_idea", idea: ideaId, nuevas: combinado.nuevas },
    costChosenCop: resuelto.totales.total_cop,
    ceilingCop: resuelto.comercial.techo_cop,
    deltaCop: resuelto.comercial.delta_cop,
    packages: { ahorro_paquetes_cop: resuelto.totales.ahorro_paquetes_cop, lineas: resuelto.compras.map((compra) => ({ variant_id: compra.variant_id, paquetes: compra.paquetes, subtotal: compra.subtotal })) },
    status: "PLAN_EDITED",
  }));
  return { plan: resuelto, cotizacion: conFotosDeCatalogo(resolucion.cotizacion, resuelto.compras), avisos, exacto, nuevas: combinado.nuevas, globosIdea: guardado.globos };
}
