import type { Cotizacion } from "@/lib/cotizacion/motor";
import { CATALOGO_ERRORES_UI_V1 } from "@/lib/ia/contracts/ui-error-v1";
import { esCancelacion, mensajeErrorRespuesta } from "@/lib/plan/peticion-plan-editar";
import { productoCliente, pulgadasCliente } from "@/lib/plan/presentacion-cliente";
import { errorDeCantidad, errorDeGanancia, errorDePesos, leerCantidad, leerPesos, leerPorcentaje } from "./lectura-numeros";
import { estadoFilas } from "./limites-filas";
import {
  CotizacionProfesionalResultadoSchema,
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

/**
 * Lo que se lee en pantalla. Una palabra por concepto: «gastos» es lo que le
 * cuesta a quien cotiza (los nombres del contrato —mano_de_obra,
 * equipos_transporte, indirectos, utilidad— no se tocan: solo este texto).
 */
export const TITULOS_SECCION: Record<SeccionCosto, string> = {
  mano_de_obra: "Tu trabajo y ayudantes",
  equipos_transporte: "Transporte y equipos",
  indirectos: "Otros gastos",
};

export const DESCRIPCIONES_SECCION: Record<SeccionCosto, string> = {
  mano_de_obra: "Tus horas, ayudantes, montaje.",
  equipos_transporte: "Ida y regreso, alquiler de bases, estructuras o equipos.",
  indirectos: "Una parte de publicidad, oficina o personal de apoyo.",
};

export function filaVacia(id: string): FilaCosto {
  return { id, descripcion: "", costo: "", cantidad: "" };
}

export function borradorVacio(): BorradorProfesional {
  return { costos: { mano_de_obra: [], equipos_transporte: [], indirectos: [] }, precios: {}, utilidad: "" };
}

// La lectura de números vive en `lectura-numeros.ts`; se reexporta aquí porque es la puerta de este módulo.
export { ecoDePesos, escrituraPesos, FICHAS_GANANCIA, fichaActiva, errorDeCantidad, errorDeGanancia, errorDePesos, formatearPesos, leerCantidad, leerPesos, leerPorcentaje, posicionTrasDigitos } from "./lectura-numeros";

export function filaEnBlanco(fila: FilaCosto): boolean {
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

/** Qué tiene mal cada celda de una fila empezada (una celda sin entrada está bien). */
export type ErroresFila = { descripcion?: string; costo?: string; cantidad?: string };

export type EntradaLeida = {
  /** `null` mientras algo escrito no se puede leer: no se envía nada. */
  entrada: EntradaCotizacionProfesional | null;
  /** Ids de las filas enviadas por sección, en el orden en que Python devuelve sus líneas. */
  enviadas: Record<SeccionCosto, string[]>;
  /** Filas empezadas pero incompletas o con un número que no se puede leer. */
  invalidas: Set<string>;
  /** Por fila empezada, qué dice cada celda que está mal (mensaje para el usuario). */
  erroresFila: Record<string, ErroresFila>;
  /** Precios por paquete escritos que no son pesos, o que se dejaron en blanco. */
  preciosInvalidos: Set<string>;
  erroresPrecio: Record<string, string>;
  utilidadInvalida: boolean;
  errorUtilidad: string | null;
  /** Listas con más gastos que el tope: no se calcula con menos de los que se ven. Mensaje por lista. */
  excesos: Partial<Record<SeccionCosto, string>>;
};

/** En qué está el precio por paquete de un material: el del catálogo, uno propio, o un campo que no se puede dar por bueno. */
export type EstadoPrecio = "catalogo" | "propio" | "vacio" | "ilegible";

/**
 * Sin entrada: el del catálogo. Un campo VACÍO no es «vuelve al catálogo»: es
 * un precio a medio escribir y no se envía nada hasta que se escriba uno o se
 * pida volver al del catálogo (así nunca se cobra un precio que el campo no
 * muestra). Un precio igual al del catálogo cuenta como el del catálogo.
 */
export function estadoPrecioMaterial(escrito: string | undefined, catalogo: number): EstadoPrecio {
  if (escrito === undefined) return "catalogo";
  if (!escrito.trim()) return "vacio";
  const precio = leerPesos(escrito);
  if (precio === null) return "ilegible";
  return precio === catalogo ? "catalogo" : "propio";
}

export const TEXTO_ESTADO_PRECIO: Record<EstadoPrecio, string> = {
  catalogo: "precio de catálogo",
  propio: "tu precio",
  vacio: "falta el precio",
  ilegible: "precio no válido",
};

const MENSAJE_PRECIO_VACIO = "Escribe el precio por paquete o vuelve al de catálogo.";

export function leerBorrador(borrador: BorradorProfesional, materiales: readonly LineaMaterialProfesional[]): EntradaLeida {
  const invalidas = new Set<string>();
  const erroresFila: Record<string, ErroresFila> = {};
  const preciosInvalidos = new Set<string>();
  const erroresPrecio: Record<string, string> = {};
  const excesos: Partial<Record<SeccionCosto, string>> = {};
  const enviadas = { mano_de_obra: [], equipos_transporte: [], indirectos: [] } as Record<SeccionCosto, string[]>;
  const secciones = { mano_de_obra: [], equipos_transporte: [], indirectos: [] } as Record<SeccionCosto, LineaCosto[]>;
  for (const seccion of SECCIONES_COSTO) {
    // Primero se descartan las filas en blanco y luego se cuentan: así ninguna fila con algo escrito se pierde por estar después del tope.
    const conContenido = borrador.costos[seccion].filter((fila) => !filaEnBlanco(fila));
    const exceso = estadoFilas(conContenido.length).avisoDeExceso;
    if (exceso) excesos[seccion] = exceso;
    for (const fila of conContenido) {
      const descripcion = fila.descripcion.trim().slice(0, 120);
      const costo = leerPesos(fila.costo);
      const cantidad = leerCantidad(fila.cantidad);
      if (!descripcion || costo === null || cantidad === null) {
        invalidas.add(fila.id);
        const errores: ErroresFila = {};
        if (!descripcion) errores.descripcion = "Escribe qué es este gasto.";
        if (costo === null) errores.costo = errorDePesos(fila.costo, "Escribe cuánto cuesta cada unidad, por ejemplo 12.500.") ?? undefined;
        if (cantidad === null) errores.cantidad = errorDeCantidad(fila.cantidad) ?? undefined;
        erroresFila[fila.id] = errores;
        continue;
      }
      secciones[seccion].push({ descripcion, costo_unitario_cop: costo, cantidad });
      enviadas[seccion].push(fila.id);
    }
  }
  const lineas = materiales.map((material) => {
    const escrito = borrador.precios[material.variant_id];
    const estado = estadoPrecioMaterial(escrito, material.precio_paquete_catalogo_cop);
    if (estado === "vacio" || estado === "ilegible") {
      preciosInvalidos.add(material.variant_id);
      erroresPrecio[material.variant_id] = errorDePesos(escrito ?? "", MENSAJE_PRECIO_VACIO) ?? MENSAJE_PRECIO_VACIO;
      return material;
    }
    // «Propio» siempre trae un precio legible; el del catálogo escrito de vuelta no es una edición.
    return estado === "propio" ? { ...material, precio_paquete_cop: leerPesos(escrito ?? "") ?? material.precio_paquete_catalogo_cop } : material;
  });
  const utilidad = borrador.utilidad.trim() ? leerPorcentaje(borrador.utilidad) : null;
  const utilidadInvalida = Boolean(borrador.utilidad.trim()) && utilidad === null;
  const valida = lineas.length > 0 && invalidas.size === 0 && preciosInvalidos.size === 0 && !utilidadInvalida && Object.keys(excesos).length === 0;
  return {
    entrada: valida ? { materiales: lineas, ...secciones, utilidad_porcentaje: utilidad } : null,
    enviadas,
    invalidas,
    erroresFila,
    preciosInvalidos,
    erroresPrecio,
    utilidadInvalida,
    errorUtilidad: utilidadInvalida ? errorDeGanancia(borrador.utilidad) : null,
    excesos,
  };
}

/**
 * ¿Hay algo escrito? Un borrador vacío no se guarda y no abre el panel al
 * recargar. Un precio de material a medio escribir (vacío) sí cuenta: es una
 * edición empezada.
 */
export function borradorConContenido(borrador: BorradorProfesional): boolean {
  return SECCIONES_COSTO.some((seccion) => borrador.costos[seccion].some((fila) => !filaEnBlanco(fila)))
    || Object.keys(borrador.precios).length > 0
    || borrador.utilidad.trim() !== "";
}

/**
 * Cómo se llama un material para quien cotiza: el producto y su tamaño, para
 * que dos paquetes del mismo producto no se vean iguales
 * («Globo Latex Redondo Fashion Blanco de 5 pulgadas»).
 */
export function nombreMaterialCliente(descripcion: string): string {
  const producto = productoCliente(descripcion);
  const tamano = /\bR-(\d+(?:[.,]\d+)?)\b/i.exec(descripcion)?.[1];
  return tamano ? `${producto} de ${pulgadasCliente(tamano)}` : producto;
}

/** Aviso, visible sin abrir nada, de lo que la propuesta tiene y el precio NO incluye; `null` si todo se incluye. */
export function avisoProductosExcluidos(sinPrecio: number): string | null {
  if (sinPrecio <= 0) return null;
  return sinPrecio === 1
    ? "Un producto de esta propuesta no tiene precio en el catálogo y no está en este precio."
    : `${sinPrecio} productos de esta propuesta no tienen precio en el catálogo y no están en este precio.`;
}

/** Por qué no hay nada que cotizar, con qué hacer. */
export function textoSinMateriales(sinPrecio: number): string {
  return sinPrecio > 0
    ? "Ningún producto de esta propuesta tiene precio en el catálogo, así que no puedo armar tu precio. Cámbialos en la propuesta por productos del catálogo y el precio aparecerá aquí."
    : "Esta propuesta todavía no tiene materiales. Cuando los tenga, aquí verás tu precio al cliente.";
}

export const RESPALDO_COTIZACION_PROFESIONAL = "No pude calcular tu precio. Intenta de nuevo en un momento.";

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
