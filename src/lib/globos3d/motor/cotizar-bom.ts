import type { z } from "zod";
import { CotizacionPlanGuiadoSchema, ListaMaterialesRequestSchema } from "@/lib/ia/contracts/asistente-guiado-v1";
import type { PythonListaMaterialesEntrada, PythonListaMaterialesResultado } from "@/lib/ia/nucleo/python-adapter";
import type { Crosswalk } from "./crosswalk-variantes";
import { MERMA_PORCENTAJE } from "./merma";
import { POLITICA_PAQUETES, planearCompra, pulgadasDeFormato, repartirPorPieza, type AsignacionPieza, type CompraPlaneada, type FaltanteCruce, type PoliticaPaquetes, type ReservaPlan } from "./plan-de-compra";
import type { BomLinea } from "./resultado-motor-v1";

/**
 * **Precio de la lista de materiales del motor 3D** con el servicio de precios que ya existe (Python,
 * `/internal/v1/plan/lista-materiales`): qué se compra (`plan-de-compra.ts`, la política de paquetes y la reserva), la
 * variante de la tienda de cada compra y la cotización con paquetes cerrados e IVA. Aquí no se calcula ningún precio: se
 * arma la lista de `(variante, cantidad)` y se lee lo que Python devuelve.
 *
 * `lista-materiales` es todo o nada (`material_no_disponible`, 422): una variante que falte tumba la cotización entera.
 * Por eso se cruza antes con el catálogo (`crosswalk-variantes.ts`) y, si aun así falla, se devuelve un fallo TIPADO para
 * que quien llama resuelva el plan con el motor de Python en vez de mostrarle al cliente un plan sin precio.
 */
export type CotizacionPlanGuiado = z.infer<typeof CotizacionPlanGuiadoSchema>;

/** Las líneas que admite `lista-materiales.v1` en una sola cotización (`ListaMaterialesRequestSchema`). */
const MAX_LINEAS_COTIZACION = 256;

/** Una compra: una variante de la tienda, lo que cubre del conteo del motor y lo que Python cobra por ella. */
export type CompraMotor = CompraPlaneada & {
  /** Lo que cuenta el motor para esta variante más su reserva. */
  cantidadConMerma: number;
  precioPaquete: number;
  subtotal: number;
  /** Globos que se compran de más sobre los que cuenta el motor (la reserva y el paquete cerrado). */
  sobrante: number;
};

export type { FaltanteCruce };

export type FalloCotizacion =
  | { ok: false; razon: "sin_cobertura"; faltantes: FaltanteCruce[] }
  | { ok: false; razon: "material_no_disponible"; detalle: string }
  | { ok: false; razon: "precio_fallido"; detalle: string };

export type CotizacionDelMotor = {
  ok: true;
  /** El snapshot del catálogo del que Python sacó los precios: el publicado si se pudo leer, y si no el del cruce. */
  snapshot: string;
  /** El snapshot con que se armó el cruce de variantes. */
  snapshotCruce: string;
  politica: PoliticaPaquetes;
  compras: CompraMotor[];
  reserva: ReservaPlan;
  /** A qué pieza va cada compra (cuántos globos de cada variante lleva cada pieza). */
  porPieza: Record<string, AsignacionPieza<CompraMotor>[]>;
  total: number;
  cotizacion: CotizacionPlanGuiado;
};

export type ResultadoCotizacionBom = CotizacionDelMotor | FalloCotizacion;

export type DependenciasCotizacion = {
  crosswalk: () => Promise<Crosswalk>;
  /** El cruce armado con el catálogo de ahora, para cuando el incluido se quedó viejo. Opcional. */
  crosswalkEnVivo?: () => Promise<Crosswalk>;
  /** El snapshot publicado del catálogo (el de que Python saca los precios), si se puede leer. Opcional. */
  snapshotPublicado?: () => Promise<string | null>;
  /** `llamarPythonListaMateriales`, con la solicitud y la correlación ya puestas por quien llama. */
  cotizarLista: (entrada: PythonListaMaterialesEntrada) => Promise<PythonListaMaterialesResultado>;
  /** Por defecto `POLITICA_PAQUETES`. */
  politica?: PoliticaPaquetes;
};

export type BomPorPieza = { total: readonly BomLinea[]; porPieza: Readonly<Record<string, readonly BomLinea[]>> };

/** El 422 de `lista-materiales` cuando falta una variante: el adaptador de Python lo trae en `domainCode`. */
function esMaterialNoDisponible(error: unknown): boolean {
  return typeof error === "object" && error !== null && "domainCode" in error && error.domainCode === "material_no_disponible";
}

function cotizacionDe(compras: readonly CompraMotor[], total: number, porPieza: Readonly<Record<string, readonly AsignacionPieza<CompraMotor>[]>>): CotizacionPlanGuiado {
  const piezasDe = (compra: CompraMotor) => Object.entries(porPieza).filter(([, asignaciones]) => asignaciones.some((a) => a.compra === compra)).map(([piezaId]) => piezaId);
  return CotizacionPlanGuiadoSchema.parse({
    lineas: compras.map((compra) => {
      const { variante } = compra;
      return {
        id: variante.variantId,
        productId: variante.productId,
        tamano: compra.formatoId,
        tamanoCodigo: compra.formatoId,
        ...(/^R-/.test(compra.formatoId) ? { diamPulg: pulgadasDeFormato(compra.formatoId) } : {}),
        estructuras: piezasDe(compra),
        cantidadNecesaria: compra.cantidad,
        designQuantity: compra.cantidad,
        wasteReserve: compra.reserva,
        requiredQuantity: compra.cantidadConMerma,
        purchaseQuantity: compra.paquetes * compra.unidadesPaquete,
        disponible: true,
        varianteId: variante.variantId,
        nombre: `${variante.titulo} — ${variante.tituloVariante}`,
        precioPaquete: compra.precioPaquete,
        unidadesPaquete: compra.unidadesPaquete,
        paquetes: compra.paquetes,
        subtotal: compra.subtotal,
        sobrante: compra.sobrante,
        ...(variante.color ? { color: variante.color } : {}),
      };
    }),
    total,
    mermaPorcentaje: MERMA_PORCENTAJE,
    incluyeIva: true,
    complementosSoportados: false,
  });
}

async function cotizarConCruce(bom: BomPorPieza, crosswalk: Crosswalk, snapshotPrecios: string, deps: DependenciasCotizacion): Promise<ResultadoCotizacionBom> {
  const politica = deps.politica ?? POLITICA_PAQUETES;
  const plan = planearCompra(bom.total, crosswalk, politica);
  if (!plan.ok) return { ok: false, razon: "sin_cobertura", faltantes: plan.faltantes };
  const { compras: planeadas } = plan;
  if (!planeadas.length || planeadas.length > MAX_LINEAS_COTIZACION) return { ok: false, razon: "precio_fallido", detalle: `la lista tiene ${planeadas.length} líneas y el servicio de precios admite de 1 a ${MAX_LINEAS_COTIZACION}` };
  if (new Set(planeadas.map((c) => c.variante.variantId)).size !== planeadas.length) return { ok: false, razon: "precio_fallido", detalle: "dos líneas del motor caen en la misma variante de la tienda" };

  let cotizada: PythonListaMaterialesResultado;
  try {
    // Los paquetes ya están decididos: se pide exactamente lo que esos paquetes cubren y Python cobra paquetes cerrados.
    cotizada = await deps.cotizarLista(ListaMaterialesRequestSchema.parse({ schema_version: "lista-materiales.v1", materiales: planeadas.map((c) => ({ variant_id: c.variante.variantId, cantidad: c.paquetes * c.unidadesPaquete })) }));
  } catch (error) {
    if (esMaterialNoDisponible(error)) return { ok: false, razon: "material_no_disponible", detalle: "Python no tiene alguna de las variantes elegidas" };
    return { ok: false, razon: "precio_fallido", detalle: error instanceof Error ? error.message : "el servicio de precios falló" };
  }

  const compras: CompraMotor[] = [];
  for (const [indice, planeada] of planeadas.entries()) {
    const linea = cotizada.lineas[indice]!;
    // Si el paquete del catálogo cambió desde que se armó el cruce, la decisión de qué comprar ya no vale: se trata como cruce viejo.
    if (linea.unidades_paquete !== planeada.unidadesPaquete || linea.paquetes !== planeada.paquetes) return { ok: false, razon: "material_no_disponible", detalle: `el paquete de ${planeada.variante.variantId} ya no es el del cruce` };
    compras.push({
      ...planeada, cantidadConMerma: planeada.cantidad + planeada.reserva, precioPaquete: linea.precio_paquete, subtotal: linea.subtotal,
      sobrante: linea.paquetes * linea.unidades_paquete - planeada.cantidad,
    });
  }
  const porPieza = repartirPorPieza(bom.porPieza, compras) as Record<string, AsignacionPieza<CompraMotor>[]>;
  return { ok: true, snapshot: snapshotPrecios, snapshotCruce: crosswalk.snapshot, politica, compras, reserva: plan.reserva, porPieza, total: cotizada.total, cotizacion: cotizacionDe(compras, cotizada.total, porPieza) };
}

/** Aplica la política de paquetes, cruza con la tienda y cotiza. Nunca lanza: todo fallo es un `FalloCotizacion` para que el plan caiga a Python. */
export async function cotizarBom(bom: BomPorPieza, deps: DependenciasCotizacion): Promise<ResultadoCotizacionBom> {
  let cruce = await deps.crosswalk();
  const publicado = deps.snapshotPublicado ? await deps.snapshotPublicado().catch(() => null) : null;
  // Si el catálogo ya publicó otro snapshot, los precios de Python son los de ese: se arma el cruce con él antes de elegir.
  if (publicado && publicado !== cruce.snapshot && deps.crosswalkEnVivo) cruce = (await deps.crosswalkEnVivo().catch(() => null)) ?? cruce;
  const snapshotPrecios = publicado ?? cruce.snapshot;
  const primero = await cotizarConCruce(bom, cruce, snapshotPrecios, deps);
  if (primero.ok || !deps.crosswalkEnVivo || primero.razon === "precio_fallido") return primero;
  // El cruce puede haberse quedado atrás del catálogo publicado: se reintenta una vez con el de ahora.
  const vivo = await deps.crosswalkEnVivo().catch(() => null);
  if (!vivo || vivo.snapshot === cruce.snapshot) return primero;
  return cotizarConCruce(bom, vivo, publicado ?? vivo.snapshot, deps);
}
