import "server-only";
import {
  cotizarBom, cotizarLoQueSeVende, extenderCruce, productosDePresentaciones, sumarLineas,
  type BomLinea, type Crosswalk, type DependenciasCotizacion, type FilaDePresentaciones, type ProductoDePresentaciones,
} from "@/lib/globos3d/motor/v1";
import { presentacionMaterialGuiado } from "@/lib/ia/guiado/presentacion-material-guiado";
import { cotizacionDeLaTarjeta, type CotizacionIdea } from "./cotizacion-de-tarjeta";
import type { FueraDelPrecio } from "./no-incluidos";

/**
 * «¿Cuánto cuesta?» de una idea SIN plan guardado (D-038, cotización única): su lista curada (variante de la tienda y
 * cantidad) se vuelve la lista de globos que el Taller compraría y pasa por el mismo cotizador que el plan del 3D
 * (`cotizarBom`: repuestos por globo y la combinación de paquetes más barata). Los globos del cruce cuestan en la tarjeta
 * lo mismo que en el «Precio en la tienda» del Taller. En las ideas con globos impresos NO son el mismo total: el Taller solo
 * cotiza lo que el cruce conoce, y la tarjeta es el precio del Taller MÁS las líneas de los impresos.
 * - una variante del cruce con la tienda es el globo (formato y color) al que pertenece;
 * - lo que el cruce no conoce (un globo impreso, una cortina) se compra igual, con los paquetes que la tienda vende de ESE
 *   globo (`presentaciones`: las variantes de su producto con la misma talla, forma, diámetro y colores, como `mismo_globo` de
 *   Python), con la misma regla de reserva y paquetes, y lo cotiza `lista-materiales` de Python como todo lo demás. Se leen
 *   primero; el cruce de ahora solo se pide para lo que ellas no resuelven;
 * - solo lo que de verdad no tiene precio (ninguna presentación vendida, el catálogo sin responder a tiempo, o un color o talla
 *   que la tienda ya no tiene) queda fuera del total, como en el Taller (`faltantes`): sale en `fuera` con su motivo, nunca
 *   con otro precio, y la lectura del catálogo nunca deja el turno esperando.
 */
export type MaterialCurado = { variantId: string; cantidad: number; nota?: string };

export type DependenciasCurada = DependenciasCotizacion & {
  /** `presentacionesDeVariantes` de la fachada, con el catálogo puesto por quien llama. Sin ella, lo que el cruce no conoce no tiene precio. */
  presentaciones?: (variantIds: readonly string[]) => Promise<FilaDePresentaciones[]>;
};

export type ResultadoCotizacionCurada =
  | { ok: true; cotizacion: CotizacionIdea; globos: number; fuera: FueraDelPrecio[] }
  | { ok: false; razon: "sin_cobertura" | "precio_fallido"; detalle: string };

const claveDeGlobo = (linea: { formatoId: string; codigo: string }): string => `${linea.formatoId}|${linea.codigo}`;

/**
 * Cada material curado cuya variante está en el cruce, como globo (formato y código); el resto, a `sinCruce`. `porClave`: los
 * materiales de cada globo (para nombrarlo si la tienda no lo vende).
 */
export function curadaABom(materiales: ReadonlyArray<MaterialCurado>, cruce: Crosswalk): { globos: BomLinea[]; sinCruce: MaterialCurado[]; porClave: Map<string, MaterialCurado[]> } {
  const clavePorVariante = new Map(Object.entries(cruce.entradas).flatMap(([clave, entrada]) => entrada.variantes.map((variante) => [variante.variantId, clave] as const)));
  const globos: BomLinea[] = [];
  const sinCruce: MaterialCurado[] = [];
  const porClave = new Map<string, MaterialCurado[]>();
  for (const material of materiales) {
    const clave = clavePorVariante.get(material.variantId);
    if (!clave) { sinCruce.push(material); continue; }
    const [formatoId, codigo] = clave.split("|") as [string, string];
    globos.push({ formatoId, codigo, cantidad: material.cantidad });
    porClave.set(clave, [...(porClave.get(clave) ?? []), material]);
  }
  return { globos, sinCruce, porClave };
}

const nombreDe = (material: MaterialCurado): string => presentacionMaterialGuiado(material.nota).nombre;

type Presentadas = { productos: ProductoDePresentaciones[]; sinRespuesta: boolean };

/** Las presentaciones de lo que el cruce no conoce. Nunca lanza ni espera de más: si el catálogo no responde, se sabe (`sinRespuesta`) y esas variantes quedan fuera del precio. */
async function leerPresentaciones(sinCruce: ReadonlyArray<MaterialCurado>, deps: DependenciasCurada): Promise<Presentadas> {
  if (!sinCruce.length || !deps.presentaciones) return { productos: [], sinRespuesta: false };
  try {
    return { productos: productosDePresentaciones(await deps.presentaciones(sinCruce.map((material) => material.variantId))), sinRespuesta: false };
  } catch {
    return { productos: [], sinRespuesta: true };
  }
}

export async function cotizarListaCurada(materiales: ReadonlyArray<MaterialCurado>, deps: DependenciasCurada): Promise<ResultadoCotizacionCurada> {
  const incluido = await deps.crosswalk();
  let cruce = incluido;
  let mapa = curadaABom(materiales, incluido);
  // Dos lecturas que no dependen una de otra van a la vez: el snapshot publicado (que las dos cotizaciones de abajo reusan) y las presentaciones.
  const lecturaDelSnapshot = deps.snapshotPublicado ? deps.snapshotPublicado().catch(() => null) : Promise.resolve(null);
  const [publicado, { productos, sinRespuesta }] = await Promise.all([lecturaDelSnapshot, leerPresentaciones(mapa.sinCruce, deps)]);
  const productoDe = new Map(productos.flatMap((producto) => producto.pedidas.map((variantId) => [variantId, producto] as const)));

  // El cruce de ahora solo se lee para lo que las presentaciones no resolvieron (los globos impresos nunca están en un cruce), y no si el catálogo no respondió.
  const sinResolver = mapa.sinCruce.filter((material) => !productoDe.has(material.variantId));
  if (sinResolver.length && deps.crosswalkEnVivo && !sinRespuesta) {
    const vivo = await deps.crosswalkEnVivo().catch(() => null);
    const delVivo = vivo ? curadaABom(sinResolver, vivo) : null;
    if (vivo && delVivo && delVivo.sinCruce.length < sinResolver.length) {
      cruce = vivo;
      mapa = curadaABom(materiales, vivo);
    }
  }

  const porClave = new Map(mapa.porClave);
  const delCatalogo: BomLinea[] = [];
  const sinPrecio: FueraDelPrecio[] = [];
  for (const material of mapa.sinCruce) {
    const producto = productoDe.get(material.variantId);
    if (!producto) {
      sinPrecio.push({ variantId: material.variantId, nombre: nombreDe(material), cantidad: material.cantidad, motivo: sinRespuesta ? "catalogo_no_respondio" : "sin_presentaciones" });
      continue;
    }
    const linea = { formatoId: producto.formatoId, codigo: producto.codigo, cantidad: material.cantidad };
    delCatalogo.push(linea);
    porClave.set(claveDeGlobo(linea), [...(porClave.get(claveDeGlobo(linea)) ?? []), material]);
  }
  const total = sumarLineas([...mapa.globos, ...delCatalogo]);
  if (!total.length) return { ok: false, razon: "sin_cobertura", detalle: `la lista curada no trae nada que la tienda venda y se pueda cotizar${sinRespuesta ? " (el catálogo no respondió a tiempo)" : ""}` };

  const extender = (c: Crosswalk): Crosswalk => (productos.length ? extenderCruce(c, productos) : c);
  const enVivo = deps.crosswalkEnVivo;
  const conCatalogo: DependenciasCotizacion = {
    ...deps, crosswalk: async () => extender(cruce),
    ...(deps.snapshotPublicado ? { snapshotPublicado: async () => publicado } : {}),
    // Con el catálogo sin responder no se vuelve a pedir el cruce de ahora: se cotiza con el que hay.
    ...(enVivo && !sinRespuesta ? { crosswalkEnVivo: async () => extender(await enVivo()) } : {}),
  };
  const { cotizada, faltantes } = await cotizarLoQueSeVende(total, (bom) => cotizarBom(bom, conCatalogo));
  if (!cotizada.ok) {
    return cotizada.razon === "sin_cobertura"
      ? { ok: false, razon: "sin_cobertura", detalle: cotizada.faltantes.map((f) => `${f.formatoId} ${f.codigo}: ${f.motivo}`).join("; ") }
      : { ok: false, razon: "precio_fallido", detalle: cotizada.detalle };
  }
  const fuera: FueraDelPrecio[] = [
    ...sinPrecio,
    ...faltantes.flatMap((faltante) => (porClave.get(claveDeGlobo(faltante)) ?? []).map((material): FueraDelPrecio => ({ variantId: material.variantId, nombre: nombreDe(material), cantidad: material.cantidad, motivo: "tienda_no_vende" }))),
  ];
  const cotizacion = cotizacionDeLaTarjeta(cotizada);
  if (!cotizacion.success) return { ok: false, razon: "precio_fallido", detalle: "la cotización de la lista curada no cumple el contrato" };
  return { ok: true, cotizacion: cotizacion.data, globos: cotizada.compras.reduce((suma, compra) => suma + compra.cantidad, 0), fuera };
}
