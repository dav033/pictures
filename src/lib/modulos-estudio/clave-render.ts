import type { ConfigModulo } from "./configuracion";
import { coloresCanonicos } from "./simetrias";

/**
 * Versión del procedimiento que hace la imagen (captura 3D guía + texto de `prompt-estudio.ts` + modelo). Es parte de la
 * clave: si cualquiera de esos cambia, se sube la versión y los renders viejos dejan de servirse (siguen en el almacén,
 * pero ninguna clave nueva los alcanza). La prueba `test-modulos-estudio.ts` guarda la huella del texto de ejemplo y
 * falla si el texto cambió sin subir esta versión.
 */
export const VERSION_PIPELINE = "estudio-v1";

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

/** Ruta del objeto en el almacén: `modulos/<versión>/<tipo>/<tamaño>_<colores>.<ext>` (sin `:`, válida en cualquier S3). */
export function claveObjeto(clave: string, mime: string): string {
  const [version, tipo, formato, colores] = clave.split(":");
  return `modulos/${version}/${tipo}/${formato}_${colores}.${EXTENSION[mime] ?? "bin"}`;
}
