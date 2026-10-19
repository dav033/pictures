import path from "node:path";

/**
 * Orders are a runtime mount. The project-local fallback keeps builds and
 * standalone tracing independent from any developer's filesystem layout.
 */
export function directorioOrdenes(): string {
  return process.env["ORDENES_DECORACION_DIR"] ?? path.join(process.cwd(), "data", "ordenes-decoracion");
}

const EXTENSIONES_FOTO = "jpg|jpeg|png|webp";

/** Returns a safe photo filename for the requested order index. */
export function nombreFotoOrden(indice: number, value: unknown = undefined): string | null {
  if (value === undefined) return `foto-${indice}.jpg`;
  if (typeof value !== "string") return null;
  const match = new RegExp(`^foto-(\\d+)\\.(${EXTENSIONES_FOTO})$`, "i").exec(value);
  return match && Number(match[1]) === indice ? value : null;
}
