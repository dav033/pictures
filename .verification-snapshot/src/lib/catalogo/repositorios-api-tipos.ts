import { z } from "zod";
import { esIdRepositorio } from "./ids";
import type { IdRepositorio } from "./tipos";

/**
 * La respuesta de `GET /api/catalogo/repositorios` (REQ-013 fase 5), lo que comparten la ruta y el Taller 3D. Sin `server-only` a
 * propósito: el navegador la valida con este mismo esquema. Es una vista pública del manifiesto —nada de rutas del servidor, como
 * el archivo de una lista de alquiler— más lo que decide la política: `visible` (la superficie `taller`) y `ui` (la interfaz por
 * repositorios, `ui-repositorios.ts`).
 */

export const RUTA_REPOSITORIOS = "/api/catalogo/repositorios";

const IdSchema = z.string().refine(esIdRepositorio, { message: "repositorio desconocido" }).transform((id) => id as IdRepositorio);

const LicenciaSchema = z.object({
  regimen: z.enum(["propia", "marca-socio", "referencia", "cc-by", "cc0", "comercial"]),
  titular: z.string(),
  url: z.string().optional(),
  atribucion: z.string().optional(),
  restricciones: z.array(z.string()),
});

const PrecioSchema = z.object({
  tipo: z.enum(["crosswalk-tienda", "lista-alquiler", "sin-precio"]),
  /** Solo `sin-precio`: por qué. */
  motivo: z.string().optional(),
});

export const RepositorioPublicoSchema = z.object({
  id: IdSchema,
  nombre: z.string(),
  descripcion: z.string(),
  version: z.string(),
  licencia: LicenciaSchema,
  precio: PrecioSchema,
  visible: z.boolean(),
});

export const RespuestaRepositoriosSchema = z.object({
  repositorios: z.array(RepositorioPublicoSchema),
  ui: z.boolean(),
});

export type RepositorioPublico = z.infer<typeof RepositorioPublicoSchema>;
export type RespuestaRepositorios = z.infer<typeof RespuestaRepositoriosSchema>;

const EnvolturaSchema = z.object({ repositorios: z.array(z.unknown()), ui: z.boolean() });

export type LecturaDeRepositorios = { ok: true; respuesta: RespuestaRepositorios; descartados: readonly string[] } | { ok: false; error: string };

/**
 * Lo que el navegador hace con la respuesta: tolerante con cada repositorio. Uno que no se entiende (un id o un régimen de licencia que
 * esta versión del navegador no conoce, porque el servidor es más nuevo) se descarta y se dice en `descartados`; el resto sigue, y la
 * bandera `ui` también. Solo una respuesta que no es ni siquiera `{ repositorios, ui }` es un error (`ok: false`).
 */
export function interpretarRespuestaRepositorios(json: unknown): LecturaDeRepositorios {
  const envoltura = EnvolturaSchema.safeParse(json);
  if (!envoltura.success) return { ok: false, error: `la respuesta no es { repositorios, ui }: ${envoltura.error.issues.map((i) => `${i.path.join(".") || "(raíz)"}: ${i.message}`).slice(0, 3).join("; ")}` };
  const repositorios: RepositorioPublico[] = [];
  const descartados: string[] = [];
  for (const [i, crudo] of envoltura.data.repositorios.entries()) {
    const lectura = RepositorioPublicoSchema.safeParse(crudo);
    if (lectura.success) repositorios.push(lectura.data);
    else descartados.push(`#${i} (${typeof crudo === "object" && crudo !== null && "id" in crudo ? String((crudo as { id: unknown }).id) : "sin id"}): ${lectura.error.issues.map((e) => `${e.path.join(".")}: ${e.message}`).slice(0, 2).join("; ")}`);
  }
  return { ok: true, respuesta: { repositorios, ui: envoltura.data.ui }, descartados };
}
