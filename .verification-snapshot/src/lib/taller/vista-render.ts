import type { ItemBiblioteca } from "@/lib/globos3d/biblioteca";
import type { Pieza } from "@/lib/globos3d/piezas";
import type { Colocacion } from "@/lib/globos3d/escena";

/**
 * Qué vista del render estándar le toca a cada item de la biblioteca (REQ-002, paso 3): una misma cámara por tipo de
 * item, para que dos renders parecidos se parezcan en imagen.
 *
 * - `frente`: lo que se ve plano, como en las fotos de decoración: escenas completas, paredes, guirnaldas, murales,
 *   letras, formas y metalizados, y todo lo que se pone sobre una pared.
 * - `tres-cuartos`: lo que tiene volumen y va suelto: columnas, arcos, orgánicos, árboles y piezas libres.
 */
export type VistaRender = "frente" | "tres-cuartos";

const TIPOS_DE_FRENTE: ReadonlySet<Pieza["tipo"]> = new Set(["pared_malla", "pared_trenzas", "guirnalda", "mural", "letras", "forma", "metalizado"]);

const vistaDePieza = (pieza: Pieza, colocacion: Colocacion): VistaRender => (TIPOS_DE_FRENTE.has(pieza.tipo) || colocacion.en === "pared" ? "frente" : "tres-cuartos");

export function vistaRenderDe(item: ItemBiblioteca): VistaRender {
  const c = item.contenido;
  if (c.tipo === "escena") return "frente";
  if (c.tipo === "conjunto") return vistaDePieza(c.conjunto.raiz.pieza, c.conjunto.raiz.colocacion);
  return vistaDePieza(c.pieza, c.sugerida);
}

export const esVistaRender = (v: string | null | undefined): v is VistaRender => v === "frente" || v === "tres-cuartos";

/** Cuánto más hondo que ancho y alto (en cm) es lo que apunta hacia la cámara: de frente se vería como un punto. */
const RAZON_HONDA = 1.5;

/**
 * De frente no se ve una pieza larga que apunta hacia la cámara (el tallo de una flor, un pitillo en la pared): esas
 * pasan a tres cuartos. `caja`: lo que ocupa en el mundo (cm).
 */
export function vistaPorForma(vista: VistaRender, caja: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } }): VistaRender {
  const ancho = caja.max.x - caja.min.x, alto = caja.max.y - caja.min.y, hondo = caja.max.z - caja.min.z;
  return vista === "frente" && hondo > RAZON_HONDA * Math.max(ancho, alto) ? "tres-cuartos" : vista;
}
