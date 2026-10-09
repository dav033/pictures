import type { Escena, NodoEscena } from "./escena";

/**
 * Sugerencias de pedidos para la IA según lo que HAY (D-021): con la sala vacía, para empezar; con una pieza elegida, lo que
 * tiene sentido para ese tipo de pieza; y con la escena, lo que se puede mejorar (columnas desiguales, una pared sin
 * guirnalda…). Nunca ofrece quitar lo que no existe. Puro.
 */

const metros = (cm: number) => `${(Math.round(cm / 10) / 10).toLocaleString("es-CO", { maximumFractionDigits: 1 })} m`;
const aDecenas = (cm: number) => Math.round(cm / 10) * 10;

function alturaDe(n: NodoEscena): number | null {
  const p = n.pieza;
  if (p.tipo === "columna") return p.alturaCm;
  if (p.tipo === "arco") return p.altoCm;
  if (p.tipo === "arco_organico") return p.arco.altoCm;
  return null;
}

const llevaFlores = (n: NodoEscena) => n.pieza.tipo === "columna" || n.pieza.tipo === "arco" || n.pieza.tipo === "arco_organico" || n.pieza.tipo === "organico";
const esFlorDelTecho = (n: NodoEscena) => n.colocacion.en === "techo" && (n.pieza.tipo === "decoracion" || /flor/i.test(n.nombre) || n.pieza.tipo === "techo");

function paraLaElegida(n: NodoEscena): string[] {
  const alto = alturaDe(n);
  const sugerencias: string[] = [];
  if (alto !== null) sugerencias.push(`Hazla más alta, de ${metros(aDecenas(alto + 40))}`);
  if (n.pieza.tipo === "arco_organico" || n.pieza.tipo === "organico") sugerencias.push("Hazla más tupida, con más globos R-24");
  sugerencias.push("Cámbiale el color a dorado y blanco");
  if (n.colocacion.en === "piso" || n.colocacion.en === "pared") sugerencias.push("Copia esta pieza al otro lado, espejada");
  if (llevaFlores(n)) sugerencias.push("Ponle flores");
  return sugerencias;
}

function paraLaEscena(escena: Escena): string[] {
  const nodos = escena.nodos;
  const sugerencias: string[] = [];
  const columnas = nodos.filter((n) => n.pieza.tipo === "columna");
  if (columnas.length >= 2) {
    const alturas = columnas.map((c) => alturaDe(c) ?? 0);
    sugerencias.push(new Set(alturas).size > 1 ? "Iguala la altura de las columnas" : `Haz las columnas más altas, de ${metros(aDecenas(Math.max(...alturas) + 40))}`);
  } else if (columnas.length === 1) sugerencias.push("Agrega otra columna igual al otro lado del arco");
  if (nodos.some(esFlorDelTecho)) sugerencias.push("Quita las flores del techo");
  else if (!nodos.some((n) => n.colocacion.en === "techo")) sugerencias.push("Agrega flores colgando del techo");
  if (!nodos.some((n) => n.pieza.tipo === "guirnalda")) sugerencias.push("Agrega una guirnalda dorada y blanca en la pared del fondo");
  if (nodos.some((n) => n.pieza.tipo === "arco_organico")) sugerencias.push("Haz el arco más tupido, con más globos R-24");
  sugerencias.push("Cámbialo todo a rosado y dorado");
  return sugerencias;
}

/** Hasta `max` pedidos que valen para esta escena (y esta pieza elegida, si la hay). */
export function sugerenciasIA(escena: Escena, elegida: { id: string } | null, max = 4): string[] {
  if (escena.nodos.length === 0) {
    return ["Un arco orgánico rosado y dorado de 3 m, con dos columnas blancas a los lados", "Una decoración de cumpleaños infantil: arco, columnas y una guirnalda en la pared del fondo"].slice(0, max);
  }
  const nodo = elegida ? escena.nodos.find((n) => n.id === elegida.id) : undefined;
  return [...new Set([...(nodo ? paraLaElegida(nodo) : []), ...paraLaEscena(escena)])].slice(0, max);
}
