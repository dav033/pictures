import type { IdeaDigitalizada, ProductoDeIdea } from "./tipos";
import { fuenteIdea } from "./fuentes";
import { IDEAS_FIGURAS } from "../ideas-figuras";
import { LOTE_01 } from "./lote-01";
import { LOTE_02 } from "./lote-02";
import { LOTE_03 } from "./lote-03";
import { LOTE_04 } from "./lote-04";
import { LOTE_05 } from "./lote-05";
import { LOTE_06 } from "./lote-06";

/** Etiqueta de la tienda → ocasión de la biblioteca (las mismas palabras de `OCASIONES`). */
const OCASION_DE_ETIQUETA: Readonly<Record<string, string>> = {
  halloween: "halloween", amor: "amor", "amor-y-amistad": "amor", "san-valentin": "amor", "decoracion-con-amor": "amor",
  navidad: "navidad", cumpleanos: "cumpleaños", "baby-shower": "baby shower", "aniversario-y-boda": "boda", boda: "boda",
  grados: "grado", grado: "grado", "quince-anos": "quince años", "15-anos": "quince años", bautizo: "bautizo y comunión",
  "primera-comunion": "bautizo y comunión", comunion: "bautizo y comunión", madres: "día de la madre", "dia-de-la-madre": "día de la madre",
  "ano-nuevo": "año nuevo", "feliz-ano": "año nuevo", ninas: "infantil", ninos: "infantil", infantil: "infantil", personajes: "infantil",
};

export function ocasionesDeEtiquetas(etiquetas: readonly string[]): string[] {
  const salida = [...new Set(etiquetas.map((e) => OCASION_DE_ETIQUETA[e]).filter((o): o is string => Boolean(o)))];
  return salida.length ? salida : ["general"];
}

/** Las figuras digitalizadas (ideas-figuras.ts) en el formato común, con su foto, ocasión y productos de la tienda. */
function deFiguras(): IdeaDigitalizada[] {
  return IDEAS_FIGURAS.flatMap((f) => {
    const fuente = fuenteIdea(f.slug);
    if (!fuente) return [];
    const productos: ProductoDeIdea[] = f.productos.map((p) => ({
      nombre: p.nombre, url: fuente.productos.find((q) => q.nombre === p.nombre)?.url ?? "", formato: p.formato, codigo: p.codigo, cantidad: null,
    }));
    return [{ id: `idea:${f.slug}`, numero: fuente.numero, slug: f.slug, nombre: f.nombre, ocasiones: ocasionesDeEtiquetas(fuente.etiquetas), fotoUrl: fuente.fotoUrl, productos, contenido: { tipo: "pieza", pieza: f.pieza }, nota: f.nota }];
  });
}

/** Todas las ideas de sempertex.com digitalizadas (cada lote lo llena un encargo distinto, sin pisarse). */
export const IDEAS_SEMPERTEX: readonly IdeaDigitalizada[] = [...LOTE_01, ...LOTE_02, ...LOTE_03, ...LOTE_04, ...LOTE_05, ...LOTE_06, ...deFiguras()];
