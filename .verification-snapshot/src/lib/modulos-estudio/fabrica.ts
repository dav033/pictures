import "server-only";
import { configuracionAlmacen, crearClienteAlmacen } from "@/lib/almacen/objetos-s3";
import { getRagPool } from "@/lib/rag/db";
import { decidir } from "@/lib/registro/servidor";
import { crearAlmacenS3 } from "./adaptadores/almacen-s3";
import { crearRepositorioNeon } from "./adaptadores/repositorio-neon";
import { generarRenderFlux } from "./generador-flux";
import type { AlmacenImagenes, RepositorioRendersModulo } from "./puertos";
import { crearServicioRenders, type ServicioRenders } from "./servicio-renders";

/**
 * Donde se enchufan los adaptadores reales del caché de renders (REQ-011). Si falta uno, el servicio degrada: el render
 * se genera y se devuelve igual, pero no se guarda (y la interfaz lo dice).
 */

declare global {
  var __servicioRendersModulo: ServicioRenders | undefined;
}

function repositorioDesdeEntorno(): RepositorioRendersModulo | null {
  if (!process.env.DATABASE_URL) return null;
  return crearRepositorioNeon(getRagPool());
}

/**
 * El almacén S3 compartido (`src/lib/almacen/objetos-s3.ts`, variables ALMACEN_S3_*): los renders van bajo `modulos/`
 * (ver `claveObjeto`). Sin variables devuelve `null` y el estudio degrada: genera, devuelve y avisa que no guarda.
 * El navegador nunca recibe una URL ni una clave del almacén: las imágenes salen por `/api/modulos-render`.
 */
function almacenDesdeEntorno(): AlmacenImagenes | null {
  const config = configuracionAlmacen();
  return config ? crearAlmacenS3(crearClienteAlmacen(config)) : null;
}

/** El servicio de la instancia (uno por proceso; en desarrollo Next reevalúa módulos, de ahí `globalThis`). */
export function servicioRenders(): ServicioRenders {
  return (globalThis.__servicioRendersModulo ??= crearServicioRenders({
    repositorio: repositorioDesdeEntorno(),
    almacen: almacenDesdeEntorno(),
    generar: generarRenderFlux,
    anotar: (evento, detalle) => decidir(`regla:render_modulo_${evento}`, `caché de renders de módulos: ${evento}`, detalle),
  }));
}
