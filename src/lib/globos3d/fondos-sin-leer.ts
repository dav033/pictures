import { entradaDeCatalogo } from "./fondos-escenografia";
import type { PiezaLeida } from "./lectura-foto";
import type { MuebleCatalogo } from "./mobiliario-tipos";

/**
 * **Los fondos detectados que el lector no leyó** (`medir-fondos.ts`): la detección de fondos busca en la foto cada id del catálogo y, si el lector
 * no puso la pieza, esa caja se perdía (en la foto del cumpleaños, tres pasteles detectados como `base_pastel` y la lectura los mandó a `otro`).
 * Lo que va sobre una mesa (`sobreMesa`: el pastel, la base de pastel) se vuelve una pieza `fondo` en su caja, y `compilar-lectura.ts` la pone sobre la
 * mesa que tenga debajo. Solo eso: una caja suelta de un panel o de una mesa que el lector no leyó podría ser un pedazo de otra cosa. Puro.
 */

type Fondo = Extract<PiezaLeida, { tipo: "fondo" }>;
type Caja = { x0: number; y0: number; x1: number; y1: number };

/** Una caja de `base_pastel` más alta que ancha (por esta razón o más) trae el pastel encima; más baja, es solo el plato vacío. */
const RAZON_ALTO_ANCHO_PASTEL = 1;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

const sobreMesa = (id: string): boolean => {
  const e = entradaDeCatalogo(id);
  return e?.clase === "mueble" && Boolean((e as MuebleCatalogo).sobreMesa);
};

/** Las piezas `fondo` de las cajas detectadas sin leer que van sobre una mesa; las cajas están en unidades de alto de la foto (x también: × aspecto). */
export function fondosSinLeer(sobrantes: ReadonlyArray<{ id: string; caja: Caja }>, aspecto: number, lugares: number): { piezas: Fondo[]; notas: string[] } {
  const piezas: Fondo[] = [], notas: string[] = [];
  for (const { id, caja } of sobrantes) {
    if (!sobreMesa(id) || piezas.length >= lugares) continue;
    const ancho = caja.x1 - caja.x0, alto = caja.y1 - caja.y0;
    const final = id === "base_pastel" && alto / ancho >= RAZON_ALTO_ANCHO_PASTEL ? "pastel" : id;
    const hex = (entradaDeCatalogo(final) as MuebleCatalogo).colores[0]!;
    piezas.push({
      tipo: "fondo", id: final, x: r3((caja.x0 + caja.x1) / 2 / aspecto), yBase: r3(caja.y1), ancho: r3(ancho), alto: r3(alto),
      colores: [{ nombre: "marfil", hex, peso: 100, acabado: "mate" }],
      nota: `Detectado en la foto (${id}) y no leído por el lector: se arma desde su caja detectada.`,
    });
    notas.push(`«${final}» detectado en la foto sin que el lector lo leyera: se arma desde su caja (x ${r3((caja.x0 + caja.x1) / 2 / aspecto)}, ancho ${r3(ancho)}, alto ${r3(alto)}).`);
  }
  return { piezas, notas };
}
