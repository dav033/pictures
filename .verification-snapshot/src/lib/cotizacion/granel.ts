import type { Cotizacion } from "@/lib/cotizacion/motor";
import { errorDePesos, estadoPrecioMaterial, leerPesos, type BorradorProfesional } from "./borrador-profesional";
import {
  MAX_UNIDADES,
  type CotizacionProfesionalResultado,
  type EntradaCotizacionProfesional,
  type GranelMaterial,
  type LineaMaterialProfesional,
  type ModoMateriales,
} from "./profesional";

/**
 * Globos a granel en la cotización profesional: lo que escribe el decorador
 * (su costo por globo y los globos extra que agrega para vender), tal como lo
 * escribe, y su paso a `granel` en `cotizacion-profesional.v1`. Aquí no se
 * multiplica ni se suma nada: el precio por globo de partida, cada subtotal,
 * el sobrante y los totales los calcula Python. Las unidades del plan y los
 * globos por paquete salen de la cotización del plan (también de Python).
 * Sin React.
 */

export type BorradorGranel = {
  modo: ModoMateriales;
  /** Costo por globo que escribió el decorador, por variante. Sin entrada: el de Python (paquete ÷ unidades). */
  preciosUnidad: Record<string, string>;
  /** Globos extra para vender, por variante, como se escribieron. Sin entrada: ninguno. */
  extras: Record<string, string>;
};

/** Por variante, los globos que usa el plan y cuántos trae su paquete. */
export type UnidadesMaterial = { unidades_plan: number; unidades_paquete: number };

export function granelVacio(): BorradorGranel {
  return { modo: "paquete", preciosUnidad: {}, extras: {} };
}

/** ¿El Python que respondió sabe cotizar a granel? Uno anterior no lo anuncia (y nunca se le manda `granel`). */
export function anunciaGranel(datos: Pick<CotizacionProfesionalResultado, "modos_materiales"> | null | undefined): boolean {
  return Boolean(datos?.modos_materiales?.includes("granel"));
}

/**
 * Las unidades de cada material que se cotiza (los de `materialesDesdeCotizacion`, con las mismas líneas): los
 * globos del plan se suman por variante como allí los paquetes. `null` si algún material no trae sus unidades o
 * sus globos por paquete: medio granel no existe y entonces no se ofrece.
 */
export function unidadesDesdeCotizacion(
  cotizacion: Pick<Cotizacion, "lineas">,
  materiales: readonly LineaMaterialProfesional[],
): Record<string, UnidadesMaterial> | null {
  if (materiales.length === 0) return null;
  const porVariante: Record<string, UnidadesMaterial> = {};
  for (const linea of cotizacion.lineas) {
    const { varianteId, paquetes, precioPaquete, unidadesPaquete, cantidadNecesaria } = linea;
    if (linea.sinReferencia || !varianteId || !paquetes || precioPaquete === undefined) continue;
    if (!unidadesPaquete || !Number.isSafeInteger(unidadesPaquete) || !Number.isSafeInteger(cantidadNecesaria)) return null;
    const previa = porVariante[varianteId];
    if (previa && previa.unidades_paquete !== unidadesPaquete) return null;
    porVariante[varianteId] = { unidades_plan: (previa?.unidades_plan ?? 0) + cantidadNecesaria, unidades_paquete: unidadesPaquete };
  }
  for (const material of materiales) {
    const unidades = porVariante[material.variant_id];
    if (!unidades || unidades.unidades_plan < 1 || unidades.unidades_plan > MAX_UNIDADES || unidades.unidades_paquete > MAX_UNIDADES) return null;
  }
  return porVariante;
}

/** Globos extra como se escriben: enteros, sin signo; vacío es ninguno. `null` si no se puede leer. */
export function leerGlobosExtra(texto: string): number | null {
  const limpio = texto.replace(/[\s.]/g, "");
  if (!limpio) return 0;
  if (!/^\d+$/.test(limpio)) return null;
  const valor = Number(limpio);
  return Number.isSafeInteger(valor) && valor <= MAX_UNIDADES ? valor : null;
}

function errorDeGlobosExtra(texto: string): string {
  const limpio = texto.replace(/[\s.]/g, "");
  if (/^\d+$/.test(limpio)) return `Hasta ${MAX_UNIDADES.toLocaleString("es-CO")} globos extra.`;
  return "Escribe cuántos globos de más, en números enteros (por ejemplo 10).";
}

/** En qué está el costo por globo: el de Python, uno propio o un campo que no se puede dar por bueno. */
export type EstadoPrecioUnidad = "base" | "propio" | "vacio" | "ilegible";

/** Como el precio por paquete: un campo VACÍO no es «vuelve al de partida», es un precio a medio escribir. */
export function estadoPrecioUnidad(escrito: string | undefined): EstadoPrecioUnidad {
  if (escrito === undefined) return "base";
  if (!escrito.trim()) return "vacio";
  return leerPesos(escrito) === null ? "ilegible" : "propio";
}

const MENSAJE_PRECIO_UNIDAD_VACIO = "Escribe cuánto te cuesta cada globo o vuelve al precio del paquete.";

export type GranelLeido = {
  /** Por variante, lo que se envía; `null` mientras algo escrito no se puede leer. */
  granel: Record<string, GranelMaterial> | null;
  erroresPrecio: Record<string, string>;
  erroresExtra: Record<string, string>;
};

export function leerGranel(borrador: BorradorGranel, unidades: Readonly<Record<string, UnidadesMaterial>>, materiales: readonly LineaMaterialProfesional[]): GranelLeido {
  const erroresPrecio: Record<string, string> = {};
  const erroresExtra: Record<string, string> = {};
  const granel: Record<string, GranelMaterial> = {};
  for (const material of materiales) {
    const id = material.variant_id;
    const base = unidades[id];
    if (!base) return { granel: null, erroresPrecio, erroresExtra };
    const escrito = borrador.preciosUnidad[id];
    const estado = estadoPrecioUnidad(escrito);
    if (estado === "vacio" || estado === "ilegible") erroresPrecio[id] = errorDePesos(escrito ?? "", MENSAJE_PRECIO_UNIDAD_VACIO) ?? MENSAJE_PRECIO_UNIDAD_VACIO;
    const extra = leerGlobosExtra(borrador.extras[id] ?? "");
    if (extra === null) erroresExtra[id] = errorDeGlobosExtra(borrador.extras[id] ?? "");
    const precio = estado === "propio" ? leerPesos(escrito ?? "") : null;
    granel[id] = {
      ...base,
      ...(extra ? { unidades_extra: extra } : {}),
      ...(precio !== null ? { precio_unidad_cop: precio } : {}),
    };
  }
  const valido = Object.keys(erroresPrecio).length === 0 && Object.keys(erroresExtra).length === 0;
  return { granel: valido ? granel : null, erroresPrecio, erroresExtra };
}

/**
 * Los precios por paquete que se envían a granel: solo los que se leen. Un precio por paquete a medio escribir no
 * frena el cálculo a granel (su campo ni se ve en ese modo): esa línea parte del precio de catálogo.
 */
export function preciosLegibles(borrador: BorradorProfesional, materiales: readonly LineaMaterialProfesional[]): BorradorProfesional {
  const precios: Record<string, string> = {};
  for (const material of materiales) {
    const escrito = borrador.precios[material.variant_id];
    const estado = estadoPrecioMaterial(escrito, material.precio_paquete_catalogo_cop);
    if (escrito !== undefined && (estado === "propio" || estado === "catalogo")) precios[material.variant_id] = escrito;
  }
  return { ...borrador, precios };
}

/**
 * La entrada con los globos sueltos y el modo, para un Python que anunció el granel. A granel, sin todo lo escrito
 * legible no se envía nada (`null`). Por paquete se manda igual el granel cuando se lee, para que Python dé también
 * el total a granel con el que se compara; si no se lee, la entrada de siempre.
 */
export function entradaConGranel(entrada: EntradaCotizacionProfesional, leido: GranelLeido, modo: ModoMateriales): EntradaCotizacionProfesional | null {
  const { granel } = leido;
  if (!granel) return modo === "granel" ? null : entrada;
  const materiales = entrada.materiales.map((material) => {
    const suelto = granel[material.variant_id];
    return suelto ? { ...material, granel: suelto } : material;
  });
  if (materiales.some((material) => !material.granel)) return modo === "granel" ? null : entrada;
  return { ...entrada, materiales, modo_materiales: modo };
}

/** ¿Escribió algo en el modo a granel? (para guardarlo y recuperarlo al recargar). */
export function granelConContenido(borrador: BorradorGranel): boolean {
  return borrador.modo !== "paquete" || Object.keys(borrador.preciosUnidad).length > 0 || Object.values(borrador.extras).some((texto) => texto.trim() !== "");
}

/** Lee lo guardado en la sesión del navegador; cualquier cosa que no tenga la forma esperada se descarta. */
export function granelDesdeTexto(texto: string | null): BorradorGranel | null {
  if (!texto) return null;
  try {
    const datos = JSON.parse(texto) as Partial<Record<keyof BorradorGranel, unknown>>;
    const textos = (valor: unknown): Record<string, string> => (typeof valor === "object" && valor !== null && !Array.isArray(valor)
      ? Object.fromEntries(Object.entries(valor).filter((entrada): entrada is [string, string] => typeof entrada[1] === "string"))
      : {});
    return { modo: datos.modo === "granel" ? "granel" : "paquete", preciosUnidad: textos(datos.preciosUnidad), extras: textos(datos.extras) };
  } catch {
    return null;
  }
}
