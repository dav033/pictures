"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { ExternalLink, MapPin } from "lucide-react";
import { z } from "zod";
import type { DecoracionSempertex } from "@/lib/biblioteca-sempertex/esquemas";
import { nombreMaterial } from "./TarjetaEleccion";

const TIENDA = "https://www.sempertex.com";
const ImagenesSchema = z.object({ imagenes: z.record(z.string(), z.string()) }).strict();

/**
 * «Comprar»: los globos de la decoración con su foto del catálogo y dos salidas claras, la tienda en línea y un
 * distribuidor cercano. No pasa por el modelo: sale al instante. El enlace al kit solo aparece si la decoración ES
 * ese kit (su foto la representa); si no, la tienda general. Los handles `b2b-` no existen en la tienda pública.
 */
export function ComprarMateriales({ decoracion, onDistribuidor }: { decoracion: DecoracionSempertex; onDistribuidor: () => void }) {
  const [imagenes, setImagenes] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!decoracion.materiales.length) return;
    const consulta = decoracion.materiales.map((material) => `variant_id=${encodeURIComponent(material.variantId)}`).join("&");
    const control = new AbortController();
    fetch(`/api/catalogo/imagenes?${consulta}`, { signal: control.signal })
      .then(async (respuesta) => {
        if (!respuesta.ok) throw new Error(`imágenes del catálogo: estado ${respuesta.status}`);
        const datos = ImagenesSchema.safeParse(await respuesta.json());
        if (datos.success) setImagenes(datos.data.imagenes);
        else console.warn("[asistente-guiado] imágenes del catálogo con forma inesperada", datos.error.issues);
      })
      .catch((cause: unknown) => { if (!control.signal.aborted) console.warn("[asistente-guiado] sin imágenes del catálogo", cause); });
    return () => control.abort();
  }, [decoracion]);

  const kit = decoracion.fotoRepresentativa !== false && decoracion.shopifyHandle ? decoracion.shopifyHandle.replace(/^b2b-/, "") : null;
  const enlace = kit ? `${TIENDA}/products/${kit}` : TIENDA;
  return <section className="mt-4 rounded-2xl border border-borde-suave bg-superficie p-5 shadow-sm" aria-label="Comprar materiales">
    <h3 className="font-semibold">Lo que necesitas comprar</h3>
    <ul className="mt-3 divide-y divide-borde-suave">
      {decoracion.materiales.map((material) => <li key={material.variantId} className="flex items-center gap-3 py-2.5">
        <span className="relative grid size-11 shrink-0 place-items-center overflow-hidden rounded-xl bg-fondo">
          {imagenes[material.variantId] ? <Image src={imagenes[material.variantId]!} alt="" fill sizes="44px" unoptimized loading="eager" className="object-contain" /> : <span className="size-5 rounded-full bg-acento-suave" />}
        </span>
        <span className="flex-1 text-sm">{nombreMaterial(material.nota) ?? "Globos"}</span>
        <span className="text-sm font-semibold tabular-nums">{material.cantidad}</span>
      </li>)}
    </ul>
    <div className="mt-4 grid gap-3 sm:grid-cols-2">
      <a href={enlace} target="_blank" rel="noreferrer" className="flex items-center justify-center gap-2 rounded-xl bg-acento px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-acento-hover">
        <ExternalLink className="size-4" aria-hidden />{kit ? "Ver el kit en la tienda en línea" : "Ir a la tienda en línea"}
      </a>
      <button type="button" onClick={onDistribuidor} className="flex items-center justify-center gap-2 rounded-xl border border-borde-suave px-4 py-3 text-sm font-semibold transition-colors hover:border-acento">
        <MapPin className="size-4" aria-hidden />Buscar un distribuidor cerca
      </button>
    </div>
  </section>;
}
