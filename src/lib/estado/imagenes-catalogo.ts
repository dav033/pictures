"use client";

import { useEffect, useState } from "react";

/**
 * Real product photos by catalog `variant_id` for cards whose lines arrive
 * without a photo (D9 del E2E real: the quote card showed empty squares).
 * Same source as the proposal card: GET /api/catalogo/imagenes (at most 96
 * ids per request). Ids already answered are not asked again; a failed
 * request marks them as missing so the card stops showing "loading".
 */

const MAX_IDS_POR_PETICION = 96;

/** Distinct, valid ids that still need a photo, in first-seen order. */
export function idsSinFoto(lineas: ReadonlyArray<{ varianteId?: string; foto?: string; sinReferencia?: boolean }>): string[] {
  const ids = lineas
    .filter((linea) => !linea.foto && !linea.sinReferencia && linea.varianteId && linea.varianteId.length <= 160)
    .map((linea) => linea.varianteId!);
  return [...new Set(ids)].slice(0, MAX_IDS_POR_PETICION);
}

export function useImagenesCatalogo(variantIds: readonly string[]): { imagenes: Readonly<Record<string, string>>; ausentes: Readonly<Record<string, true>> } {
  const [imagenes, setImagenes] = useState<Record<string, string>>({});
  const [ausentes, setAusentes] = useState<Record<string, true>>({});
  const pendientes = variantIds.filter((id) => !imagenes[id] && !ausentes[id]);
  const solicitud = pendientes.map((id) => `variant_id=${encodeURIComponent(id)}`).join("&");

  useEffect(() => {
    if (!solicitud) return;
    const ids = new URLSearchParams(solicitud).getAll("variant_id");
    const controlador = new AbortController();
    fetch(`/api/catalogo/imagenes?${solicitud}`, { signal: controlador.signal })
      .then((respuesta) => (respuesta.ok ? respuesta.json() : Promise.reject(new Error("catalogo/imagenes"))))
      .then((datos: { imagenes?: Record<string, string> }) => {
        const recibidas = datos.imagenes ?? {};
        setImagenes((previas) => ({ ...previas, ...recibidas }));
        setAusentes((previas) => ({ ...previas, ...Object.fromEntries(ids.filter((id) => !recibidas[id]).map((id) => [id, true] as const)) }));
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setAusentes((previas) => ({ ...previas, ...Object.fromEntries(ids.map((id) => [id, true] as const)) }));
      });
    return () => controlador.abort();
  }, [solicitud]);

  return { imagenes, ausentes };
}
