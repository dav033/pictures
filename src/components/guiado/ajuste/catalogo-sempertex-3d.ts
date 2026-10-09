import { TABLA_SEMPERTEX, type ReferenciaSempertex } from "@/lib/plan/referencia-sempertex";
import { familiaSempertex } from "../color-globo";
import type { GloboCatalogo } from "./selector-globos";

/**
 * El catálogo de colores del selector de «Ajustar mi plan» cuando el plan es del motor 3D (REQ-007, fase 5): la lámina
 * Sempertex (las referencias con su código, nombre y tono), sin llamar a Python. Un globo es una referencia; su
 * `variantIds` lleva el código de tres cifras (el 3D compra por código y la tienda se cruza en el servidor). Los tamaños son
 * los de la lámina; lo que la tienda no venda en una talla lo dice el servidor al hacer el cambio («No pude: …»).
 */
const PULGADAS_DE_FORMATO = /^R-(\d+)$/;

function globoDe(referencia: ReferenciaSempertex): GloboCatalogo {
  const tamanos = referencia.formatos.flatMap((formato) => {
    const pulgadas = PULGADAS_DE_FORMATO.exec(formato)?.[1];
    return pulgadas ? [Number(pulgadas)] : [];
  }).sort((a, b) => a - b);
  return {
    clave: `sempertex|${referencia.codigo}`,
    productId: `sempertex-${referencia.codigo}`,
    color: referencia.nombre,
    nombre: referencia.nombreCompleto,
    colorCliente: referencia.nombre,
    acabado: familiaSempertex(referencia.nombreCompleto)?.nombre ?? null,
    hex: referencia.hexGlobo,
    imagen: null,
    tamanos,
    variantIds: [referencia.codigo],
    titulo: referencia.nombreCompleto,
  };
}

let guardado: GloboCatalogo[] | null = null;

/** Las referencias que se fabrican en R-12 (la talla de las piezas de cuartetos y de la mayoría de las orgánicas). */
export function globosDelCatalogo3d(): GloboCatalogo[] {
  guardado ??= TABLA_SEMPERTEX.referencias.filter((referencia) => referencia.formatos.includes("R-12")).map(globoDe);
  return guardado;
}
