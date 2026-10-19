import { z } from "zod";
import { TALLER_RAG_ENABLED } from "@/lib/ia/nucleo/feature-flags";
import type { ContextoTelemetriaIA } from "@/lib/ia/nucleo/telemetria-llamadas";
import { buscarEnTaller, type EntradaBusqueda, type RespuestaBusquedaTaller } from "./buscar";

/**
 * «Buscar por foto» de la biblioteca del taller (REQ-002 paso 6): valida la imagen que sube el navegador, la normaliza
 * (JPEG de hasta 1024 px), la embebe y busca por su vector. Sin la biblioteca indexada (`TALLER_RAG_ENABLED` apagada o
 * la base sin responder) NO inventa resultados: contesta que la búsqueda por foto la necesita. La ruta
 * (`/api/taller/buscar-foto`) solo pone la autenticación y las dependencias reales; todo lo demás se prueba aquí
 * con dependencias inyectadas, sin red.
 */

export const TOPE_BYTES_FOTO = 6 * 1024 * 1024;
export const LADO_MAXIMO_FOTO = 1024;
export const MIMES_FOTO: readonly string[] = ["image/jpeg", "image/png", "image/webp"];
export const MENSAJE_SIN_BIBLIOTECA = "La búsqueda por foto necesita la biblioteca indexada.";
/** Cuántos resultados pide el panel (la grilla los reparte por pestaña y los cruza con sus filtros). */
export const LIMITE_FOTO = 50;

export type DependenciasBuscarFoto = {
  autenticado: (request: Request) => boolean;
  mismoOrigen: (request: Request) => boolean;
  /** Por defecto `TALLER_RAG_ENABLED`. */
  habilitado?: boolean;
  /** Bytes + mime de la imagen ya normalizada → vector de 768. */
  embeber: (bytes: Uint8Array, mime: string, telemetria?: ContextoTelemetriaIA) => Promise<number[]>;
  buscar?: (entrada: EntradaBusqueda) => Promise<RespuestaBusquedaTaller>;
  /** Lleva la imagen a JPEG de hasta `LADO_MAXIMO_FOTO` px; lanza si no es una imagen legible. */
  normalizar: (bytes: Uint8Array) => Promise<Uint8Array>;
};

export type RespuestaBuscarFoto =
  | { disponible: true; ids: string[]; vectorImagen: number[]; avisos: string[] }
  | { disponible: false; error: string }
  | { error: string; detalle?: string[] };

const Tipos = z.array(z.string().trim().min(1).max(40)).max(12);

const json = (cuerpo: RespuestaBuscarFoto, status = 200) => Response.json(cuerpo, { status });

/** Los `tipos` de item a buscar (opcional): una lista JSON en el campo `tipos` del formulario. */
function leerTipos(crudo: FormDataEntryValue | null): string[] | null {
  if (crudo === null || crudo === "") return [];
  if (typeof crudo !== "string") return null;
  try {
    const t = Tipos.safeParse(JSON.parse(crudo));
    return t.success ? t.data : null;
  } catch {
    return null;
  }
}

export async function atenderBusquedaFoto(request: Request, deps: DependenciasBuscarFoto): Promise<Response> {
  if (!deps.autenticado(request) || !deps.mismoOrigen(request)) return json({ error: "Sesión requerida." }, 401);
  if (!(deps.habilitado ?? TALLER_RAG_ENABLED)) return json({ disponible: false, error: MENSAJE_SIN_BIBLIOTECA }, 503);

  const declarado = Number(request.headers.get("content-length"));
  // La imagen sola puede pesar hasta el tope; el resto del formulario son unos bytes de cabeceras.
  if (Number.isFinite(declarado) && declarado > TOPE_BYTES_FOTO + 16 * 1024) return json({ error: "La foto pesa más de 6 MB." }, 413);

  let formulario: FormData;
  try {
    formulario = await request.formData();
  } catch {
    return json({ error: "El cuerpo debe ser un formulario con la foto en el campo «imagen»." }, 400);
  }
  const imagen = formulario.get("imagen");
  if (!(imagen instanceof Blob)) return json({ error: "Falta la foto en el campo «imagen»." }, 400);
  if (imagen.size === 0) return json({ error: "La foto está vacía." }, 400);
  if (imagen.size > TOPE_BYTES_FOTO) return json({ error: "La foto pesa más de 6 MB." }, 413);
  if (!MIMES_FOTO.includes(imagen.type)) return json({ error: "La foto debe ser JPEG, PNG o WebP." }, 415);
  const tipos = leerTipos(formulario.get("tipos"));
  if (!tipos) return json({ error: "El campo «tipos» debe ser una lista JSON de tipos de item." }, 400);

  let normalizada: Uint8Array;
  try {
    normalizada = await deps.normalizar(new Uint8Array(await imagen.arrayBuffer()));
  } catch {
    return json({ error: "No se pudo leer la foto: el archivo no es una imagen válida." }, 400);
  }

  let vectorImagen: number[];
  try {
    vectorImagen = await deps.embeber(normalizada, "image/jpeg", { superficie: "taller_biblioteca" });
  } catch (error) {
    console.warn("[taller-foto] el embedding de la foto falló", { mensaje: error instanceof Error ? error.message : String(error) });
    return json({ error: "No se pudo analizar la foto en este momento. Inténtalo de nuevo." }, 502);
  }

  const buscar = deps.buscar ?? ((entrada: EntradaBusqueda) => buscarEnTaller(entrada));
  const respuesta = await buscar({ vectorImagen, filtros: tipos.length ? { tipos } : {}, limite: LIMITE_FOTO });
  // Si la base no respondió, `buscarEnTaller` cayó a memoria, que no usa vectores: no se presenta como resultado de la foto.
  if (respuesta.fuente !== "rag") return json({ disponible: false, error: MENSAJE_SIN_BIBLIOTECA }, 503);
  return json({ disponible: true, ids: respuesta.ids, vectorImagen, avisos: respuesta.avisos });
}
