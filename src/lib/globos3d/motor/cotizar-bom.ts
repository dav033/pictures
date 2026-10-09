import type { z } from "zod";
import { CotizacionPlanGuiadoSchema, ListaMaterialesRequestSchema } from "@/lib/ia/contracts/asistente-guiado-v1";
import type { PythonListaMaterialesEntrada, PythonListaMaterialesResultado } from "@/lib/ia/nucleo/python-adapter";
import { claveCruce, elegirVariante, type Crosswalk, type MotivoSinCobertura, type VarianteElegida } from "./crosswalk-variantes";
import { MERMA_PORCENTAJE, cantidadConMerma } from "./merma";
import type { BomLinea } from "./resultado-motor-v1";

/**
 * **Precio de la lista de materiales del motor 3D** con el servicio de precios que ya existe (Python,
 * `/internal/v1/plan/lista-materiales`): merma -> redondeo -> variante de la tienda -> cotización con paquetes cerrados e
 * IVA. Aquí no se calcula ningún precio: se arma la lista de `(variante, cantidad)` y se lee lo que Python devuelve.
 *
 * `lista-materiales` es todo o nada (`material_no_disponible`, 422): una variante que falte tumba la cotización entera.
 * Por eso se cruza antes con el catálogo (`crosswalk-variantes.ts`) y, si aun así falla, se devuelve un fallo TIPADO para
 * que quien llama resuelva el plan con el motor de Python en vez de mostrarle al cliente un plan sin precio.
 */
export type CotizacionPlanGuiado = z.infer<typeof CotizacionPlanGuiadoSchema>;

/** Las líneas que admite `lista-materiales.v1` en una sola cotización (`ListaMaterialesRequestSchema`). */
const MAX_LINEAS_COTIZACION = 256;

/** Una compra: lo que el motor cuenta de un (formato, color), la variante que se compra y lo que Python cobra por ella. */
export type CompraMotor = {
  clave: string;
  /** Todas las líneas del motor (formato|código) que cayeron en esta variante: casi siempre una. */
  claves: string[];
  formatoId: string;
  codigo: string;
  variante: VarianteElegida;
  /** Lo que cuenta el motor, sin merma. */
  cantidad: number;
  /** Lo que se manda a cotizar: `ceil(cantidad * (1 + MERMA))`. */
  cantidadConMerma: number;
  unidadesPaquete: number;
  paquetes: number;
  precioPaquete: number;
  subtotal: number;
  /** Globos que se compran de más sobre los que cuenta el motor (la merma y el paquete cerrado). */
  sobrante: number;
};

export type FaltanteCruce = { formatoId: string; codigo: string; motivo: MotivoSinCobertura | "desconocida" };

export type FalloCotizacion =
  | { ok: false; razon: "sin_cobertura"; faltantes: FaltanteCruce[] }
  | { ok: false; razon: "material_no_disponible"; detalle: string }
  | { ok: false; razon: "precio_fallido"; detalle: string };

export type CotizacionDelMotor = {
  ok: true;
  /** El snapshot del cruce con que se eligieron las variantes. */
  snapshot: string;
  compras: CompraMotor[];
  total: number;
  cotizacion: CotizacionPlanGuiado;
};

export type ResultadoCotizacionBom = CotizacionDelMotor | FalloCotizacion;

export type DependenciasCotizacion = {
  crosswalk: () => Promise<Crosswalk>;
  /** El cruce armado con el catálogo de ahora, para cuando el incluido se quedó viejo. Opcional. */
  crosswalkEnVivo?: () => Promise<Crosswalk>;
  /** `llamarPythonListaMateriales`, con la solicitud y la correlación ya puestas por quien llama. */
  cotizarLista: (entrada: PythonListaMaterialesEntrada) => Promise<PythonListaMaterialesResultado>;
};

export type BomPorPieza = { total: readonly BomLinea[]; porPieza: Readonly<Record<string, readonly BomLinea[]>> };

/** El 422 de `lista-materiales` cuando falta una variante: el adaptador de Python lo trae en `domainCode`. */
function esMaterialNoDisponible(error: unknown): boolean {
  return typeof error === "object" && error !== null && "domainCode" in error && error.domainCode === "material_no_disponible";
}

const tamanoEnPulgadas = (formatoId: string): number | undefined => {
  const numero = /(\d+)$/.exec(formatoId)?.[1];
  return numero ? Number(numero) : undefined;
};

function cotizacionDe(compras: readonly CompraMotor[], total: number, piezasPorClave: ReadonlyMap<string, string[]>): CotizacionPlanGuiado {
  return CotizacionPlanGuiadoSchema.parse({
    lineas: compras.map((compra) => {
      const { variante } = compra;
      return {
        id: variante.variantId,
        productId: variante.productId,
        tamano: compra.formatoId,
        tamanoCodigo: compra.formatoId,
        ...(tamanoEnPulgadas(compra.formatoId) !== undefined && /^R-/.test(compra.formatoId) ? { diamPulg: tamanoEnPulgadas(compra.formatoId) } : {}),
        estructuras: piezasPorClave.get(compra.clave) ?? [],
        cantidadNecesaria: compra.cantidad,
        designQuantity: compra.cantidad,
        wasteReserve: compra.cantidadConMerma - compra.cantidad,
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

export type LineaPedida = { clave: string; claves: string[]; linea: BomLinea; variante: VarianteElegida; cantidad: number; conMerma: number };

/**
 * Lo que se le pide a la tienda: por cada línea del motor, la variante que se compra y la cantidad con merma. Sin Python
 * y sin precios: es la parte del pedido que se puede fijar en una prueba. Una variante repetida se suma.
 */
export function elegirPedido(bom: readonly BomLinea[], crosswalk: Crosswalk): { ok: true; pedidas: LineaPedida[] } | { ok: false; faltantes: FaltanteCruce[] } {
  const faltantes: FaltanteCruce[] = [];
  const porVariante = new Map<string, LineaPedida>();
  for (const linea of bom) {
    const conMerma = cantidadConMerma(linea.cantidad);
    const variante = elegirVariante(crosswalk, linea.formatoId, linea.codigo, conMerma);
    if (!variante.ok) { faltantes.push({ formatoId: linea.formatoId, codigo: linea.codigo, motivo: variante.motivo }); continue; }
    // Dos globos del motor que caen en la misma variante de la tienda se suman: Python no admite una variante repetida.
    const previa = porVariante.get(variante.variantId);
    if (previa) { previa.cantidad += linea.cantidad; previa.conMerma += conMerma; previa.claves.push(claveCruce(linea.formatoId, linea.codigo)); continue; }
    const clave = claveCruce(linea.formatoId, linea.codigo);
    porVariante.set(variante.variantId, { clave, claves: [clave], linea, variante, cantidad: linea.cantidad, conMerma });
  }
  return faltantes.length ? { ok: false, faltantes } : { ok: true, pedidas: [...porVariante.values()] };
}

async function cotizarConCruce(bom: BomPorPieza, crosswalk: Crosswalk, deps: DependenciasCotizacion): Promise<ResultadoCotizacionBom> {
  const pedido = elegirPedido(bom.total, crosswalk);
  if (!pedido.ok) return { ok: false, razon: "sin_cobertura", faltantes: pedido.faltantes };
  const { pedidas } = pedido;
  if (!pedidas.length || pedidas.length > MAX_LINEAS_COTIZACION) return { ok: false, razon: "precio_fallido", detalle: `la lista tiene ${pedidas.length} líneas y el servicio de precios admite de 1 a ${MAX_LINEAS_COTIZACION}` };

  let cotizada: PythonListaMaterialesResultado;
  try {
    cotizada = await deps.cotizarLista(ListaMaterialesRequestSchema.parse({ schema_version: "lista-materiales.v1", materiales: pedidas.map((p) => ({ variant_id: p.variante.variantId, cantidad: p.conMerma })) }));
  } catch (error) {
    if (esMaterialNoDisponible(error)) return { ok: false, razon: "material_no_disponible", detalle: "Python no tiene alguna de las variantes elegidas" };
    return { ok: false, razon: "precio_fallido", detalle: error instanceof Error ? error.message : "el servicio de precios falló" };
  }

  const compras: CompraMotor[] = pedidas.map((pedida, indice) => {
    const linea = cotizada.lineas[indice]!;
    return {
      clave: pedida.clave, claves: pedida.claves, formatoId: pedida.linea.formatoId, codigo: pedida.linea.codigo, variante: pedida.variante,
      cantidad: pedida.cantidad, cantidadConMerma: pedida.conMerma,
      unidadesPaquete: linea.unidades_paquete, paquetes: linea.paquetes, precioPaquete: linea.precio_paquete, subtotal: linea.subtotal,
      sobrante: linea.paquetes * linea.unidades_paquete - pedida.cantidad,
    };
  });
  const piezasPorClave = new Map<string, string[]>();
  for (const [piezaId, lineas] of Object.entries(bom.porPieza)) for (const l of lineas) piezasPorClave.set(claveCruce(l.formatoId, l.codigo), [...(piezasPorClave.get(claveCruce(l.formatoId, l.codigo)) ?? []), piezaId]);
  return { ok: true, snapshot: crosswalk.snapshot, compras, total: cotizada.total, cotizacion: cotizacionDe(compras, cotizada.total, piezasPorClave) };
}

/** Aplica la merma, cruza con la tienda y cotiza. Nunca lanza: todo fallo es un `FalloCotizacion` para que el plan caiga a Python. */
export async function cotizarBom(bom: BomPorPieza, deps: DependenciasCotizacion): Promise<ResultadoCotizacionBom> {
  const incluido = await deps.crosswalk();
  const primero = await cotizarConCruce(bom, incluido, deps);
  if (primero.ok || !deps.crosswalkEnVivo || primero.razon === "precio_fallido") return primero;
  // El cruce incluido puede haberse quedado atrás del catálogo publicado: se reintenta una vez con el de ahora.
  const vivo = await deps.crosswalkEnVivo().catch(() => null);
  if (!vivo || vivo.snapshot === incluido.snapshot) return primero;
  return cotizarConCruce(bom, vivo, deps);
}
