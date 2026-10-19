import { BIBLIOTECA_FABRICA, indexarEscena, type ItemBiblioteca } from "@/lib/globos3d/biblioteca";
import { perezoso } from "@/lib/globos3d/perezoso";
import { crearEntrada } from "../../construir";
import type { EntradaCatalogo } from "../../repositorio";
import type { Procedencia } from "../../tipos";

/**
 * La biblioteca del taller como entradas de Sempertex (clase `item-biblioteca`): los items de fábrica en su orden, con el item
 * mismo como carga (sigue perezoso: su contenido se arma al pedirlo), y los derivados de cada escena (`<escena>~<nodo>`), que se
 * resuelven indexando su escena la primera vez que se pide uno (arma la escena: no se listan).
 */

/** La procedencia del item: su fuente de hoy. Lo de referencias (web o del dueño) lleva licencia de referencia: se recreó la geometría, la imagen no se guarda. */
export function procedenciaDeItem(item: ItemBiblioteca): Procedencia {
  const f = item.fuente;
  if (!f) return { fuente: "propio", titulo: item.nombre };
  const esReferencia = f.tipo === "referencia-web" || f.tipo === "referencia-dueno";
  return {
    fuente: f.tipo, titulo: f.titulo, ...(f.url ? { url: f.url } : {}), ...(f.fotoUrl ? { fotoUrl: f.fotoUrl } : {}),
    ...(esReferencia ? { licencia: { regimen: "referencia", titular: f.titulo, ...(f.url ? { url: f.url } : {}), restricciones: ["geometría recreada a partir de la foto; la imagen no se guarda"] } } : {}),
  };
}

export const entradaDeItem = (item: ItemBiblioteca): EntradaCatalogo =>
  crearEntrada("sempertex", { clase: "item-biblioteca", idLocal: item.id, nombre: item.nombre, descripcion: () => item.descripcion, procedencia: procedenciaDeItem(item), dato: () => item });

export const entradasDeBiblioteca = (): EntradaCatalogo[] => BIBLIOTECA_FABRICA.map(entradaDeItem);

/**
 * Resuelve un derivado `<escena>~<nodo>` indexando su escena una vez. Solo se recuerda lo de una escena que existe: un id
 * inventado no agranda `porEscena` (a lo más, un mapa por item de fábrica).
 */
export function resolutorDeDerivados(porEscena = new Map<string, ReadonlyMap<string, EntradaCatalogo>>()): (idLocal: string) => EntradaCatalogo | undefined {
  const fabrica = perezoso(() => new Map(BIBLIOTECA_FABRICA.map((i) => [i.id, i])));
  return (idLocal) => {
    const corte = idLocal.indexOf("~");
    if (corte <= 0) return undefined;
    const escenaId = idLocal.slice(0, corte);
    let derivados = porEscena.get(escenaId);
    if (!derivados) {
      const escena = fabrica().get(escenaId);
      if (!escena) return undefined;
      derivados = new Map(indexarEscena(escena).map((d) => [d.id, entradaDeItem(d)] as const));
      porEscena.set(escenaId, derivados);
    }
    return derivados.get(idLocal);
  };
}
