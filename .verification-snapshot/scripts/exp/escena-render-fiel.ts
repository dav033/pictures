/**
 * La escena del caso de 2026-10-08 (capturas «092701/092707»): tres árboles de racimos con copa turquesa y verde
 * lima y manzanitas rojas, una palmera curva, un perrito de globos y una calabaza grande, en la sala inicial. Es la
 * base del experimento `render-fiel.ts` (se abre en /3d desde la biblioteca propia para sacar una captura limpia).
 * Sin red.
 */
import { ARBOLES_PREDEFINIDOS, type OpcionesArbolGlobos } from "../../src/lib/globos3d/arboles-globos";
import { decoracionPredefinida } from "../../src/lib/globos3d/figuras";
import { SALA_INICIAL, type Escena, type NodoEscena } from "../../src/lib/globos3d/escena";
import type { Pieza } from "../../src/lib/globos3d/piezas";

const arbolBase = (id: string): OpcionesArbolGlobos => structuredClone(ARBOLES_PREDEFINIDOS.find((a) => a.id === id)!.arbol);

function manzano(): Pieza {
  const arbol = arbolBase("arbol_racimos");
  if (arbol.copa.tipo !== "racimos") throw new Error("arbol_racimos ya no es de racimos");
  // Copa turquesa con verde lima y manzanitas rojas (como en la captura del dueño).
  arbol.copa = { ...arbol.copa, colores: ["038", "031"], pesos: [3, 1] };
  return { tipo: "arbol_globos", arbol };
}

const enPiso = (id: string, nombre: string, pieza: Pieza, xCm: number): NodoEscena => ({ id, nombre, pieza, colocacion: { en: "piso", xCm, zCm: -170, giroGrados: 0 } });

export const ESCENA_RENDER_FIEL: Escena = {
  sala: structuredClone(SALA_INICIAL),
  nodos: [
    enPiso("arbol-1", "Árbol de racimos", manzano(), -215),
    enPiso("palmera", "Palmera curva", { tipo: "arbol_globos", arbol: arbolBase("arbol_palmera_curva") }, -120),
    enPiso("arbol-2", "Árbol de racimos", manzano(), -15),
    enPiso("arbol-3", "Árbol de racimos", manzano(), 85),
    enPiso("perrito", "Perrito", { tipo: "decoracion", decoracion: decoracionPredefinida("figura_perrito") }, 165),
    enPiso("calabaza", "Calabaza grande", { tipo: "decoracion", decoracion: decoracionPredefinida("calabaza_grande") }, 235),
  ],
};
