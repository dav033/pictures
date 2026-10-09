import type { ConfigModulo } from "./configuracion";
import { versionPipeline } from "./huella-pipeline";
import { coloresCanonicos } from "./simetrias";

/**
 * Versión del procedimiento que hace la imagen: `estudio-v2.<huella>` (ver `huella-pipeline.ts`). La huella sale sola de la
 * geometría que arma `armarModulo`, la captura 3D (cámara, tamaño, sala, aligerado) y el texto de FLUX, así que cualquier
 * cambio de esos invalida las claves viejas sin que nadie lo recuerde (los renders viejos siguen en el almacén, pero ninguna
 * clave nueva los alcanza). Un cambio que ninguna huella ve (otro modelo, p. ej.) sube `VERSION_MANUAL`.
 */
export const VERSION_PIPELINE = versionPipeline();

/**
 * Clave canónica de un render: `<versión>:<tipo>:<tamaño>:<colores canónicos>`. Los colores son el arreglo de globos
 * reducido por las simetrías del módulo (ver `simetrias.ts`): «dúo rojo + azul» y «dúo azul + rojo» dan la misma clave.
 */
export function claveRender(config: ConfigModulo, version: string = VERSION_PIPELINE): string {
  return [version, config.tipo, config.formatoId, coloresCanonicos(config.tipo, config.colores).join("_")].join(":");
}

/** La config en su forma canónica (la que se guarda en la fila y se manda a FLUX): mismo módulo, mismo orden siempre. */
export function configCanonica(config: ConfigModulo): ConfigModulo {
  return { ...config, colores: coloresCanonicos(config.tipo, config.colores) };
}

const EXTENSION: Readonly<Record<string, string>> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

/**
 * Ruta del objeto en el almacén: `modulos/<versión>/<tipo>/<tamaño>_<colores>[-<ficha>].<ext>` (sin `:`, válida en cualquier S3).
 * La ficha es la de la reserva que lo generó: cada generación tiene su propio objeto, así que descartar un render no puede
 * borrar el que otra instancia acaba de guardar para la misma clave.
 */
export function claveObjeto(clave: string, mime: string, ficha = ""): string {
  const [version, tipo, formato, colores] = clave.split(":");
  const sufijo = ficha ? `-${ficha.replace(/[^A-Za-z0-9]/g, "").slice(0, 12)}` : "";
  return `modulos/${version}/${tipo}/${formato}_${colores}${sufijo}.${EXTENSION[mime] ?? "bin"}`;
}
