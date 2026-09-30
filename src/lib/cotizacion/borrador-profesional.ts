import type { Cotizacion } from "@/lib/cotizacion/motor";
import { CATALOGO_ERRORES_UI_V1 } from "@/lib/ia/contracts/ui-error-v1";
import { esCancelacion, mensajeErrorRespuesta } from "@/lib/plan/peticion-plan-editar";
import {
  CotizacionProfesionalResultadoSchema,
  MAX_CANTIDAD,
  MAX_COP,
  MAX_LINEAS_SECCION,
  MAX_UTILIDAD_PORCENTAJE,
  SECCIONES_COSTO,
  type CotizacionProfesionalResultado,
  type EntradaCotizacionProfesional,
  type LineaCosto,
  type LineaMaterialProfesional,
  type SeccionCosto,
} from "./profesional";

/**
 * Lo que escribe el decorador en la cotización profesional, tal como lo
 * escribe (texto), y su paso a `cotizacion-profesional.v1`. Aquí no se suma ni
 * se multiplica nada: los totales son de Python. Solo se lee lo que el
 * decorador escribió y se decide qué filas están completas para enviarse.
 * Sin React.
 */

export type FilaCosto = { id: string; descripcion: string; costo: string; cantidad: string };

export type BorradorProfesional = {
  costos: Record<SeccionCosto, FilaCosto[]>;
  /** Precio por bolsa que escribió el decorador, por variante. Sin entrada: el del catálogo. */
  precios: Record<string, string>;
  utilidad: string;
};

export const TITULOS_SECCION: Record<SeccionCosto, string> = {
  mano_de_obra: "Mano de obra",
  equipos_transporte: "Equipos y transporte",
  indirectos: "Costos indirectos",
};

export const DESCRIPCIONES_SECCION: Record<SeccionCosto, string> = {
  mano_de_obra: "Horas propias, ayudantes, montaje.",
  equipos_transporte: "Transporte de ida y regreso, alquiler de bases, estructuras o equipos.",
  indirectos: "La parte de este proyecto de publicidad, oficina o personal administrativo.",
};

export function filaVacia(id: string): FilaCosto {
  return { id, descripcion: "", costo: "", cantidad: "" };
}

export function borradorVacio(): BorradorProfesional {
  return { costos: { mano_de_obra: [], equipos_transporte: [], indirectos: [] }, precios: {}, utilidad: "" };
}

/** Pesos enteros como se escriben en Colombia: "12.000", "$ 12.000" o "12000". Los decimales no existen en COP. */
export function leerPesos(texto: string): number | null {
  const limpio = texto.replace(/[\s$.]/g, "");
  if (!/^\d+$/.test(limpio)) return null;
  const valor = Number(limpio);
  return Number.isSafeInteger(valor) && valor <= MAX_COP ? valor : null;
}

/** Hasta dos decimales, con coma o punto: "2", "1,5", "0.25". */
function leerDecimal(texto: string, maximo: number): number | null {
  const limpio = texto.trim().replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(limpio)) return null;
  const valor = Number(limpio);
  return valor <= maximo ? valor : null;
}

export function leerCantidad(texto: string): number | null {
  const valor = leerDecimal(texto, MAX_CANTIDAD);
  return valor !== null && valor > 0 ? valor : null;
}

export function leerPorcentaje(texto: string): number | null {
  return leerDecimal(texto.replace("%", ""), MAX_UTILIDAD_PORCENTAJE);
}

function filaEnBlanco(fila: FilaCosto): boolean {
  return !fila.descripcion.trim() && !fila.costo.trim() && !fila.cantidad.trim();
}

/**
 * Los materiales de la cotización del plan: solo productos del catálogo con
 * precio y bolsas. Una línea sin referencia o sin precio no se puede cotizar
 * y se cuenta aparte, para decirlo.
 */
export function materialesDesdeCotizacion(cotizacion: Pick<Cotizacion, "lineas">): { materiales: LineaMaterialProfesional[]; sinPrecio: number } {
  const porVariante = new Map<string, LineaMaterialProfesional>();
  let sinPrecio = 0;
  for (const linea of cotizacion.lineas) {
    const { varianteId, paquetes, precioPaquete } = linea;
    if (linea.sinReferencia || !varianteId || !paquetes || precioPaquete === undefined) {
      sinPrecio += 1;
      continue;
    }
    const previa = porVariante.get(varianteId);
    if (previa) {
      previa.paquetes += paquetes;
      continue;
    }
    const descripcion = (linea.nombre ?? ([linea.tamano, linea.color].filter(Boolean).join(" ") || varianteId)).slice(0, 120);
    porVariante.set(varianteId, { variant_id: varianteId, descripcion, paquetes, precio_paquete_catalogo_cop: precioPaquete });
  }
  return { materiales: [...porVariante.values()], sinPrecio };
}

export type EntradaLeida = {
  /** `null` mientras algo escrito no se puede leer: no se envía nada. */
  entrada: EntradaCotizacionProfesional | null;
  /** Ids de las filas enviadas por sección, en el orden en que Python devuelve sus líneas. */
  enviadas: Record<SeccionCosto, string[]>;
  /** Filas empezadas pero incompletas o con un número que no se puede leer. */
  invalidas: Set<string>;
  /** Precios por bolsa escritos que no son pesos. */
  preciosInvalidos: Set<string>;
  utilidadInvalida: boolean;
};

export function leerBorrador(borrador: BorradorProfesional, materiales: readonly LineaMaterialProfesional[]): EntradaLeida {
  const invalidas = new Set<string>();
  const preciosInvalidos = new Set<string>();
  const enviadas = { mano_de_obra: [], equipos_transporte: [], indirectos: [] } as Record<SeccionCosto, string[]>;
  const secciones = { mano_de_obra: [], equipos_transporte: [], indirectos: [] } as Record<SeccionCosto, LineaCosto[]>;
  for (const seccion of SECCIONES_COSTO) {
    for (const fila of borrador.costos[seccion].slice(0, MAX_LINEAS_SECCION)) {
      if (filaEnBlanco(fila)) continue;
      const descripcion = fila.descripcion.trim().slice(0, 120);
      const costo = leerPesos(fila.costo);
      const cantidad = leerCantidad(fila.cantidad);
      if (!descripcion || costo === null || cantidad === null) {
        invalidas.add(fila.id);
        continue;
      }
      secciones[seccion].push({ descripcion, costo_unitario_cop: costo, cantidad });
      enviadas[seccion].push(fila.id);
    }
  }
  const lineas = materiales.map((material) => {
    const escrito = borrador.precios[material.variant_id];
    if (escrito === undefined || !escrito.trim()) return material;
    const precio = leerPesos(escrito);
    if (precio === null) {
      preciosInvalidos.add(material.variant_id);
      return material;
    }
    return precio === material.precio_paquete_catalogo_cop ? material : { ...material, precio_paquete_cop: precio };
  });
  const utilidad = borrador.utilidad.trim() ? leerPorcentaje(borrador.utilidad) : null;
  const utilidadInvalida = Boolean(borrador.utilidad.trim()) && utilidad === null;
  const valida = lineas.length > 0 && invalidas.size === 0 && preciosInvalidos.size === 0 && !utilidadInvalida;
  return {
    entrada: valida ? { materiales: lineas, ...secciones, utilidad_porcentaje: utilidad } : null,
    enviadas,
    invalidas,
    preciosInvalidos,
    utilidadInvalida,
  };
}

export const RESPALDO_COTIZACION_PROFESIONAL = "No pude calcular la cotización profesional. Intenta de nuevo en un momento.";

export class FalloCotizacionProfesional extends Error {}

/** POST a /api/cotizacion-profesional. Una cancelación se relanza tal cual; cualquier otro fallo es un `FalloCotizacionProfesional`. */
export async function pedirCotizacionProfesional(
  entrada: EntradaCotizacionProfesional,
  opciones: { signal?: AbortSignal; fetcher?: typeof fetch } = {},
): Promise<CotizacionProfesionalResultado> {
  const fetcher = opciones.fetcher ?? fetch;
  let respuesta: Response;
  try {
    respuesta = await fetcher("/api/cotizacion-profesional", { method: "POST", headers: { "Content-Type": "application/json" }, signal: opciones.signal, body: JSON.stringify(entrada) });
  } catch (error) {
    if (esCancelacion(error)) throw error;
    throw new FalloCotizacionProfesional(CATALOGO_ERRORES_UI_V1.SIN_CONEXION.mensaje_usuario, { cause: error });
  }
  let datos: unknown;
  try {
    datos = await respuesta.json();
  } catch (error) {
    if (esCancelacion(error)) throw error;
    throw new FalloCotizacionProfesional(RESPALDO_COTIZACION_PROFESIONAL, { cause: error });
  }
  if (!respuesta.ok) throw new FalloCotizacionProfesional(mensajeErrorRespuesta(datos, RESPALDO_COTIZACION_PROFESIONAL));
  const resultado = CotizacionProfesionalResultadoSchema.safeParse(datos);
  if (!resultado.success) throw new FalloCotizacionProfesional(RESPALDO_COTIZACION_PROFESIONAL, { cause: resultado.error });
  return resultado.data;
}
