import { z } from "zod";
import type { ProductoCanonico } from "./tipos";

/**
 * El catálogo público congelado en `datos/catalogo-publico.json` (lo escribe `scripts/catalogo/generar-snapshot-publico.ts`).
 * Es la forma canónica que ya persiste el sync, tal cual: el snapshot y el sync en vivo llenan las mismas tablas.
 */
export const VERSION_SNAPSHOT_CATALOGO = 1;

export type SnapshotCatalogo = {
  version: typeof VERSION_SNAPSHOT_CATALOGO;
  /** Cuándo se descargó de la tienda: lo que el cliente ve de precio y disponibilidad es de este momento. */
  generadoEn: string;
  productos: ProductoCanonico[];
};

/** Lo mínimo para no sembrar basura: el resto lo escribió nuestro propio script y lo cubre la prueba de siembra. */
const SnapshotSchema = z.object({
  version: z.literal(VERSION_SNAPSHOT_CATALOGO),
  generadoEn: z.iso.datetime(),
  productos: z
    .array(
      z.looseObject({
        id: z.string().min(1),
        handle: z.string().min(1),
        tituloLimpio: z.string().min(1),
        variantes: z.array(z.looseObject({ id: z.string().min(1), precio: z.number() })).min(1),
      }),
    )
    .min(1),
});

export class SnapshotCatalogoInvalidoError extends Error {
  readonly code = "SNAPSHOT_CATALOGO_INVALIDO";
  constructor(detalle: string) {
    super(`El snapshot del catálogo público no es válido: ${detalle}`);
  }
}

export function leerSnapshotCatalogo(dato: unknown): SnapshotCatalogo {
  const leido = SnapshotSchema.safeParse(dato);
  if (!leido.success) {
    const primero = leido.error.issues[0];
    throw new SnapshotCatalogoInvalidoError(`${primero?.path.join(".") ?? "(raíz)"}: ${primero?.message ?? "formato inesperado"}`);
  }
  return dato as SnapshotCatalogo;
}
