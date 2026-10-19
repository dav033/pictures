import type { ReactNode } from "react";
import { Box, Circle, Columns2, Flower2, Grid3x3, Heart, LampCeiling, Palmtree, PartyPopper, Rainbow, Shapes, Spline, Type, Waves } from "lucide-react";
import { PATRONES_COLUMNA } from "@/lib/globos3d/columnas";
import { FORMAS_ARCO } from "@/lib/globos3d/arcos";
import { PATRONES_MALLA } from "@/lib/globos3d/paredes";
import { PATRONES_TRENZAS } from "@/lib/globos3d/pared-trenzas";
import { MODULOS } from "@/lib/globos3d/modulos";
import type { Pieza, TipoPieza } from "@/lib/globos3d/piezas";
import type { Caja, NodoEscena } from "@/lib/globos3d/escena";
import { metros } from "./ui-taller";

/** El nombre de cada tipo de pieza, para la interfaz. */
export const NOMBRE_TIPO: Readonly<Record<TipoPieza, string>> = {
  columna: "Columna", arco: "Arco", pared_malla: "Pared de malla", pared_trenzas: "Pared de trenzas", organico: "Orgánico",
  decoracion: "Decoración", arco_organico: "Arco orgánico", guirnalda: "Guirnalda", escenografia: "Escenografía", globo: "Globo suelto",
  forma: "Forma de globos", letras: "Letras de globos", metalizado: "Globo metalizado",
  mural: "Mural pixelado", techo: "Decoración de techo", arbol_globos: "Palmera o árbol", modulo: "Módulo",
};

/** El ícono de cada tipo (lista de piezas, partes del editor solitario). */
export function IconoTipo({ pieza, className = "size-4" }: { pieza: Pieza; className?: string }): ReactNode {
  const p = { className, "aria-hidden": true } as const;
  switch (pieza.tipo) {
    case "columna": return <Columns2 {...p} />;
    case "arco": case "arco_organico": return <Rainbow {...p} />;
    case "guirnalda": return <Waves {...p} />;
    case "pared_malla": case "pared_trenzas": case "mural": return <Grid3x3 {...p} />;
    case "organico": return <Spline {...p} />;
    case "decoracion": return pieza.decoracion.tipo === "flor_corazones" ? <Heart {...p} /> : <Flower2 {...p} />;
    case "globo": case "metalizado": return <Circle {...p} />;
    case "modulo": return <Shapes {...p} />;
    case "forma": return <Shapes {...p} />;
    case "letras": return <Type {...p} />;
    case "techo": return <LampCeiling {...p} />;
    case "arbol_globos": return <Palmtree {...p} />;
    case "escenografia": return pieza.utileria ? <PartyPopper {...p} /> : <Box {...p} />;
  }
}

/** Lo que es la pieza en una línea (el rótulo morado del inspector): «Columna clásica · trenza de cuartetos». */
export function subtituloPieza(pieza: Pieza): string {
  switch (pieza.tipo) {
    case "columna": return `Columna clásica · ${PATRONES_COLUMNA.find((p) => p.id === pieza.patron)?.nombre.toLowerCase() ?? "trenza"} de cuartetos`;
    case "arco": return `Arco ${FORMAS_ARCO.find((f) => f.id === pieza.forma)?.nombre.toLowerCase() ?? ""} · trenza de cuartetos`;
    case "arco_organico": return "Arco orgánico · globos de varios tamaños";
    case "guirnalda": return pieza.guirnalda.recorrido ? "Guirnalda · curva libre" : pieza.guirnalda.caidaCm > 0 ? "Guirnalda en festón" : "Guirnalda recta";
    case "pared_malla": return `Pared · malla ${pieza.formatoId} ${PATRONES_MALLA.find((p) => p.id === pieza.patron)?.nombre.toLowerCase() ?? ""}`;
    case "pared_trenzas": return `Pared · trenzas ${PATRONES_TRENZAS.find((p) => p.id === pieza.opciones.patron)?.nombre.toLowerCase() ?? ""}`;
    case "organico": return "Orgánico · globos de varios tamaños";
    case "decoracion": return "Decoración pequeña";
    case "globo": return `Globo suelto · ${pieza.formatoId}`;
    case "modulo": return `Módulo · ${MODULOS.find((m) => m.id === pieza.modulo)?.nombre ?? pieza.modulo} de ${pieza.formatoId}`;
    case "forma": return "Forma de globos";
    case "letras": return `Letras de globos · «${pieza.letras.texto}»`;
    case "metalizado": return "Globo metalizado (foil)";
    case "mural": return "Mural pixelado";
    case "techo": return "Decoración de techo";
    case "arbol_globos": return "Palmera o árbol de globos";
    case "escenografia": return pieza.utileria ? "Utilería de fiesta (no es globo)" : "Escenografía (no son globos)";
  }
}

/** La medida que identifica a la pieza en su etiqueta del visor («· 1,8 m»): su alto o su ancho. */
export function medidaPrincipal(pieza: Pieza, caja: Caja | undefined): string | null {
  switch (pieza.tipo) {
    case "columna": return metros(pieza.alturaCm);
    case "arco": return `${metros(pieza.anchoCm)} × ${metros(pieza.altoCm)}`;
    case "arco_organico": return `${metros(pieza.arco.anchoCm)} × ${metros(pieza.arco.altoCm)}`;
    case "guirnalda": return pieza.guirnalda.recorrido ? null : metros(pieza.guirnalda.anchoCm);
    case "pared_malla": return `${metros(pieza.anchoCm)} × ${metros(pieza.altoCm)}`;
    case "pared_trenzas": return `${metros(pieza.opciones.anchoCm)} × ${metros(pieza.opciones.altoCm)}`;
    default: return caja ? metros(Math.max(0, caja.max.y - caja.min.y), 1) : null;
  }
}

/** Una pieza que cuelga de otra (de sus anclas o apoyada sobre ella). */
export const esColgada = (n: NodoEscena) => n.colocacion.en === "ancla" || n.colocacion.en === "sobre";
/** De quién cuelga (o `null`). */
export const padreDe = (n: NodoEscena): string | null => (n.colocacion.en === "ancla" || n.colocacion.en === "sobre" ? n.colocacion.padreId : null);
