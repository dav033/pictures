import { crearCacheTemporal } from "@/lib/cache/cache-temporal";
import type { LoraModeSlug } from "@/lib/lora/schema";
import { FalloPlanEditar, pedirPlanEditar } from "@/lib/plan/peticion-plan-editar";
import {
  LIMITE_INICIAL,
  armarBusqueda,
  armarPeticionColores,
  leerRespuestaBusqueda,
  leerRespuestaColores,
  type CandidatoDelServidor,
  type ColorCatalogo,
  type CuerpoBuscar,
} from "./ajuste-propuesta";

/**
 * Las dos lecturas que llenan el explorador del editor, con memoria en el navegador: lo que ya se pidió se
 * muestra al instante al volver a abrir el modal o a quitar y poner un filtro, y dos pantallas que piden lo mismo
 * comparten una sola petición.
 *
 * La clave lleva el token de la propuesta y el modo LoRA, así que dos propuestas (o dos modos) nunca comparten
 * respuesta. Un fallo no se recuerda. Editar la propuesta firma otro token y con él empieza otra memoria; el
 * servidor sí recuerda lo común (`cache-exploracion.ts`), por lo que esa primera vez sigue siendo rápida.
 */

export type RespuestaBusqueda = { candidatos: CandidatoDelServidor[]; hayMas: boolean };

export const RESPALDO_BUSQUEDA = "No se pudo buscar en el catálogo.";
export const RESPALDO_COLORES = "No se pudieron cargar los colores del catálogo.";

/** Un minuto: la disponibilidad del catálogo puede cambiar, y repetir una búsqueda es barato. */
const TTL_BUSQUEDAS_MS = 60_000;
/** Cinco minutos: la lista de colores de un catálogo publicado no cambia. */
const TTL_COLORES_MS = 5 * 60_000;

const cacheBusquedas = crearCacheTemporal<RespuestaBusqueda>({ ttlMs: TTL_BUSQUEDAS_MS, maximo: 80 });
const cacheColores = crearCacheTemporal<ColorCatalogo[]>({ ttlMs: TTL_COLORES_MS, maximo: 8 });

async function leerBusqueda(cuerpo: CuerpoBuscar, signal: AbortSignal): Promise<RespuestaBusqueda> {
  const leido = leerRespuestaBusqueda(await pedirPlanEditar(cuerpo, RESPALDO_BUSQUEDA, { signal }));
  if (!leido) throw new FalloPlanEditar(RESPALDO_BUSQUEDA);
  return leido;
}

async function leerColores(cuerpo: ReturnType<typeof armarPeticionColores>, signal: AbortSignal): Promise<ColorCatalogo[]> {
  const leido = leerRespuestaColores(await pedirPlanEditar(cuerpo, RESPALDO_COLORES, { signal }));
  if (!leido) throw new FalloPlanEditar(RESPALDO_COLORES);
  return leido;
}

export function pedirBusqueda(cuerpo: CuerpoBuscar, signal?: AbortSignal): Promise<RespuestaBusqueda> {
  return cacheBusquedas.obtener(JSON.stringify(cuerpo), (cancelar) => leerBusqueda(cuerpo, cancelar), { signal });
}

export function pedirColoresCatalogo(approvalToken: string | undefined, loraMode: LoraModeSlug | undefined, signal?: AbortSignal): Promise<ColorCatalogo[]> {
  const cuerpo = armarPeticionColores(approvalToken, loraMode);
  return cacheColores.obtener(JSON.stringify(cuerpo), (cancelar) => leerColores(cuerpo, cancelar), { signal });
}

/**
 * Pide de antemano lo que el modal necesita al abrir (los colores y la primera página sin filtros), para que el
 * cliente que acerca el dedo a «Ajustar plan» lo encuentre listo. Es lo mismo que el modal pediría: no cambia lo
 * que ve nadie, solo cuándo llega.
 */
export function precalentarExplorador(approvalToken: string | undefined, loraMode: LoraModeSlug | undefined): void {
  const colores = armarPeticionColores(approvalToken, loraMode);
  cacheColores.precalentar(JSON.stringify(colores), (cancelar) => leerColores(colores, cancelar));
  const primera = armarBusqueda({ texto: "", colores: [], tamanos: [], limite: LIMITE_INICIAL, approvalToken, loraMode });
  cacheBusquedas.precalentar(JSON.stringify(primera), (cancelar) => leerBusqueda(primera, cancelar));
}

/** Para las pruebas. */
export function olvidarExplorador(): void {
  cacheBusquedas.olvidar();
  cacheColores.olvidar();
}
