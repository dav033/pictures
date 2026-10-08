import { claseDePieza, ideaPerezosa, type IdeaDigitalizada, type ProductoDeIdea } from "./tipos";
import { fuenteIdea } from "./fuentes";
import { IDEAS_FIGURAS } from "../ideas-figuras";
import { IDEAS_FORMAS } from "../ideas-formas";
import { LOTE_01 } from "./lote-01";
import { LOTE_02 } from "./lote-02";
import { LOTE_03 } from "./lote-03";
import { LOTE_04 } from "./lote-04";
import { LOTE_05 } from "./lote-05";
import { LOTE_06 } from "./lote-06";
import { LOTE_07 } from "./lote-07";
import { LOTE_08 } from "./lote-08";
import { LOTE_09 } from "./lote-09";
import { LOTE_10 } from "./lote-10";
import { LOTE_11 } from "./lote-11";
import { LOTE_12 } from "./lote-12";
import { LOTE_13 } from "./lote-13";
import { LOTE_14 } from "./lote-14";
import { LOTE_15 } from "./lote-15";
import { LOTE_16 } from "./lote-16";
import { LOTE_17 } from "./lote-17";
import { LOTE_18 } from "./lote-18";
import { LOTE_19 } from "./lote-19";
import { LOTE_20 } from "./lote-20";
import { LOTE_21 } from "./lote-21";
import { LOTE_22 } from "./lote-22";
import { LOTE_23 } from "./lote-23";
import { LOTE_24 } from "./lote-24";
import { LOTE_25 } from "./lote-25";
import { LOTE_26 } from "./lote-26";
import { LOTE_27 } from "./lote-27";
import { LOTE_28 } from "./lote-28";
import { LOTE_29 } from "./lote-29";
import { LOTE_30 } from "./lote-30";
import { IDEAS_IMPRESOS } from "../ideas-impresos";

/** Etiqueta de la tienda → ocasiones de la biblioteca (ids de la taxonomía de celebraciones: `taller/taxonomia-celebraciones.ts`). */
const OCASION_DE_ETIQUETA: Readonly<Record<string, readonly string[]>> = {
  halloween: ["halloween"], amor: ["san-valentin"], "amor-y-amistad": ["san-valentin"], "san-valentin": ["san-valentin"], "decoracion-con-amor": ["san-valentin"],
  navidad: ["navidad"], cumpleanos: ["cumpleanos"], "1-ano": ["primer-cumpleanos"], "baby-shower": ["baby-shower"],
  "aniversario-y-boda": ["boda", "aniversario"], boda: ["boda"], "despedida-de-soltera": ["despedida-soltera"],
  grados: ["graduacion"], grado: ["graduacion"], "quince-anos": ["quince-anos"], "15-anos": ["quince-anos"],
  bautizo: ["bautizo"], "primera-comunion": ["primera-comunion"], comunion: ["primera-comunion"],
  madres: ["dia-de-la-madre"], "dia-de-la-madre": ["dia-de-la-madre"], padres: ["dia-del-padre"], padre: ["dia-del-padre"],
  "ano-nuevo": ["ano-nuevo"], "feliz-ano": ["ano-nuevo"], pascua: ["pascua"], verano: ["fiesta-verano"], mundial: ["mundial-futbol"],
  ninas: ["fiesta-infantil"], ninos: ["fiesta-infantil"], infantil: ["fiesta-infantil"], personajes: ["fiesta-infantil"],
};

export function ocasionesDeEtiquetas(etiquetas: readonly string[]): string[] {
  const salida = [...new Set(etiquetas.flatMap((e) => OCASION_DE_ETIQUETA[e] ?? []))];
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
    return [ideaPerezosa(
      { id: `idea:${f.slug}`, numero: fuente.numero, slug: f.slug, nombre: f.nombre, ocasiones: ocasionesDeEtiquetas(fuente.etiquetas), fotoUrl: fuente.fotoUrl, clase: claseDePieza(f.pieza), nota: f.nota },
      () => ({ tipo: "pieza", pieza: f.pieza }), () => productos,
    )];
  });
}

/** Las formas y letras digitalizadas (ideas-formas.ts; las básicas con id 0 no son ideas y se quedan fuera). */
function deFormas(): IdeaDigitalizada[] {
  return IDEAS_FORMAS.flatMap((f) => {
    const fuente = f.id > 0 ? fuenteIdea(f.slug) : null;
    if (!fuente) return [];
    const productos: ProductoDeIdea[] = f.productos.map((p) => ({
      nombre: p.nombre, url: fuente.productos.find((q) => q.nombre === p.nombre)?.url ?? "", formato: p.formatoId, codigo: p.codigo, cantidad: null,
    }));
    const sugerida = f.lugar === "pared" ? { en: "pared" as const, pared: "fondo" as const, aLoLargoCm: 0, alturaCm: 120 } : { en: "piso" as const, xCm: 0, zCm: 0, giroGrados: 0 };
    return [ideaPerezosa(
      { id: `idea:${f.slug}`, numero: fuente.numero, slug: f.slug, nombre: f.nombre, ocasiones: ocasionesDeEtiquetas(fuente.etiquetas), fotoUrl: fuente.fotoUrl, clase: claseDePieza(f.pieza), nota: f.nota },
      () => ({ tipo: "pieza", pieza: f.pieza, sugerida }), () => productos,
    )];
  });
}

/** Todas las ideas de sempertex.com digitalizadas (cada lote lo llena un encargo distinto, sin pisarse). */
export const IDEAS_SEMPERTEX: readonly IdeaDigitalizada[] = [...LOTE_01, ...LOTE_02, ...LOTE_03, ...LOTE_04, ...LOTE_05, ...LOTE_06, ...LOTE_07, ...LOTE_08, ...LOTE_09, ...LOTE_10, ...LOTE_11, ...LOTE_12, ...LOTE_13, ...LOTE_14, ...LOTE_15, ...LOTE_16, ...LOTE_17, ...LOTE_18, ...LOTE_19, ...LOTE_20, ...LOTE_21, ...LOTE_22, ...LOTE_23, ...LOTE_24, ...LOTE_25, ...LOTE_26, ...LOTE_27, ...LOTE_28, ...LOTE_29, ...LOTE_30, ...deFiguras(), ...deFormas(), ...IDEAS_IMPRESOS];
