import { entradaDeCatalogo } from "./fondos-escenografia";
import { FONDOS_CON_SUPERFICIE } from "./fondos-familias";
import type { PiezaLeida } from "./lectura-foto";
import { muebleDe } from "./mobiliario-catalogo";
import type { MuebleCatalogo } from "./mobiliario-tipos";
import { esTelonRepetible } from "./telones-en-fila";

/**
 * **Los fondos detectados que el lector no leyó** (`medir-fondos.ts`): la detección de fondos busca en la foto cada id del catálogo y, si el lector
 * no puso la pieza, esa caja se perdía (en la foto del cumpleaños, tres pasteles detectados como `base_pastel` y la lectura los mandó a `otro`).
 * Lo que va sobre una mesa (`sobreMesa`: el pastel, la base de pastel) se vuelve una pieza `fondo` en su caja, y `compilar-lectura.ts` la pone sobre la
 * mesa que tenga debajo. Solo si de verdad hay una mesa debajo: la tapa de una mesa leída con su x debajo de la caja y a la altura en que descansa
 * (su pie, justo encima del borde de arriba de la mesa). Si no, no se inventa un pastel flotando: queda como pieza «otro» (no se arma) con el motivo. Puro.
 */

type Fondo = Extract<PiezaLeida, { tipo: "fondo" }>;
type Otro = Extract<PiezaLeida, { tipo: "otro" }>;
type Caja = { x0: number; y0: number; x1: number; y1: number };

/** Una caja de `base_pastel` más alta que ancha (por esta razón o más) trae el pastel encima; más baja, es solo el plato vacío. */
const RAZON_ALTO_ANCHO_PASTEL = 1;
/** El pie del pastel descansa en la tapa: puede estar hasta esto por encima del borde de arriba de la mesa (la tapa se ve en perspectiva) y esto por debajo (fracción del alto de la foto). */
const POR_ENCIMA_DE_LA_TAPA = 0.12;
const POR_DEBAJO_DE_LA_TAPA = 0.06;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

const sobreMesa = (id: string): boolean => {
  const e = entradaDeCatalogo(id);
  return e?.clase === "mueble" && Boolean((e as MuebleCatalogo).sobreMesa);
};

/** La mesa de la lectura que tiene debajo a una caja (su x dentro de la tapa y su pie justo sobre el borde de arriba de la mesa), o `null`. */
export function mesaDebajoDe(caja: Caja, piezas: readonly PiezaLeida[], aspecto: number): Fondo | null {
  const x = (caja.x0 + caja.x1) / 2;
  return piezas.find((p): p is Fondo => {
    if (p.tipo !== "fondo" || !FONDOS_CON_SUPERFICIE.has(p.id) || muebleDe(p.id)?.grupo !== "mesa") return false;
    const arriba = p.yBase - p.alto;
    return Math.abs(x - p.x * aspecto) <= p.ancho / 2 + 1e-9 && caja.y1 >= arriba - POR_ENCIMA_DE_LA_TAPA && caja.y1 <= arriba + POR_DEBAJO_DE_LA_TAPA;
  }) ?? null;
}

/**
 * Las piezas de las cajas detectadas sin leer que van sobre una mesa; las cajas están en unidades de alto de la foto (x también: × aspecto). `piezas` son las de la lectura
 * (con las mesas); `otros` son las cajas que no tienen mesa debajo, como piezas «otro» para que se cuenten entre lo que no se armó.
 */
export function fondosSinLeer(sobrantes: ReadonlyArray<{ id: string; caja: Caja }>, aspecto: number, lugares: number, piezas: readonly PiezaLeida[] = []): { piezas: Fondo[]; otros: Otro[]; notas: string[] } {
  const nuevas: Fondo[] = [], otros: Otro[] = [], notas: string[] = [];
  for (const { id, caja } of sobrantes) {
    if (!sobreMesa(id) || nuevas.length + otros.length >= lugares) continue;
    const ancho = caja.x1 - caja.x0, alto = caja.y1 - caja.y0;
    const final = id === "base_pastel" && alto / ancho >= RAZON_ALTO_ANCHO_PASTEL ? "pastel" : id;
    const x = r3((caja.x0 + caja.x1) / 2 / aspecto);
    if (!mesaDebajoDe(caja, piezas, aspecto)) {
      otros.push({ tipo: "otro", descripcion: `«${final}» detectado en x ${x} sin una mesa debajo donde apoyarlo: no se arma` });
      notas.push(`«${final}» detectado en la foto (x ${x}) no se arma: no hay una mesa debajo, en su x y a la altura de su tapa.`);
      continue;
    }
    const hex = (entradaDeCatalogo(final) as MuebleCatalogo).colores[0]!;
    nuevas.push({
      tipo: "fondo", id: final, x, yBase: r3(caja.y1), ancho: r3(ancho), alto: r3(alto),
      colores: [{ nombre: "color de catálogo (no leído)", hex, peso: 100, acabado: "mate" }],
      nota: `Detectado en la foto (${id}) y no leído: su color es el de catálogo (no se leyó de la foto).`,
    });
    notas.push(`«${final}» detectado en la foto sin que el lector lo leyera: se arma desde su caja (x ${x}, ancho ${r3(ancho)}, alto ${r3(alto)}) con el color de catálogo, no uno leído.`);
  }
  return { piezas: nuevas, otros, notas };
}

// ----------------------------------------------------------------------------------------------------------
// Otro panel igual al que el lector sí leyó
// ----------------------------------------------------------------------------------------------------------

/** Una caja detectada es otro panel (y no el mismo, ni un pedazo) si no se encima con los que ya hay más que esto y no es menor que esta parte del leído. */
const SOLAPE_MAXIMO_ENTRE_PANELES = 0.3;
const PARTE_MINIMA_DEL_PANEL_LEIDO = 0.4;
const area = (c: Caja) => (c.x1 - c.x0) * (c.y1 - c.y0);
const cruceDe = (a: Caja, b: Caja) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
const cajaDeFondo = (p: Fondo, aspecto: number): Caja => ({ x0: p.x * aspecto - p.ancho / 2, x1: p.x * aspecto + p.ancho / 2, y0: p.yBase - p.alto, y1: p.yBase });

/**
 * Los paneles que la detección encontró y el lector no puso: si el lector leyó un telón (una pared de lentejuelas, una puerta con arco) y la detección trae OTRA
 * caja del mismo id que no se encima con ninguna de ese id (la pared de glitter del otro lado, la tercera puerta), esa caja es otro panel igual: se arma como el leído, en su
 * caja, con sus colores (el nombre rotulado no se copia). Solo de ids que el lector ya leyó: un id que nadie leyó puede ser una detección falsa. Puro.
 */
export function telonesSinLeer(sobrantes: ReadonlyArray<{ id: string; caja: Caja }>, piezas: readonly PiezaLeida[], aspecto: number, lugares: number, detectadas: ReadonlyMap<string, number>): { piezas: Fondo[]; notas: string[] } {
  const nuevas: Fondo[] = [], notas: string[] = [];
  const leidos = piezas.filter((p): p is Fondo => p.tipo === "fondo" && esTelonRepetible(p.id));
  // Solo sobran tantos paneles de un id como cajas detectadas tiene de más sobre las piezas que el lector leyó de él: si el lector puso el único panel lejos de su caja, esa caja no es otro panel.
  const cupo = new Map<string, number>();
  for (const [id, n] of detectadas) cupo.set(id, n - leidos.filter((p) => p.id === id).reduce((s, p) => s + Math.max(1, p.cantidad ?? 1), 0));
  for (const { id, caja } of [...sobrantes].sort((a, b) => a.caja.x0 - b.caja.x0)) {
    const modelo = leidos.filter((p) => p.id === id).sort((a, b) => area(cajaDeFondo(b, aspecto)) - area(cajaDeFondo(a, aspecto)))[0];
    if (!modelo || nuevas.length >= lugares || (cupo.get(id) ?? 0) <= 0) continue;
    const ancho = caja.x1 - caja.x0, alto = caja.y1 - caja.y0;
    if (ancho < PARTE_MINIMA_DEL_PANEL_LEIDO * modelo.ancho || alto < PARTE_MINIMA_DEL_PANEL_LEIDO * modelo.alto) continue;
    // Solo cuenta lo del mismo id: una pared de glitter dentro de una puerta con arco es otro objeto (la foto de XV), no la misma puerta.
    const ocupadas = [...leidos, ...nuevas].filter((p) => p.id === id).map((p) => cajaDeFondo(p, aspecto));
    if (ocupadas.some((o) => cruceDe(o, caja) / Math.min(area(o), area(caja)) > SOLAPE_MAXIMO_ENTRE_PANELES)) continue;
    const base: Fondo = { ...modelo };
    for (const campo of ["cantidad", "cajas", "texto", "colorTexto", "acabadoTexto"] as const) delete base[campo];
    const x = r3((caja.x0 + caja.x1) / 2 / aspecto);
    cupo.set(id, (cupo.get(id) ?? 0) - 1);
    nuevas.push({ ...base, x, yBase: r3(caja.y1), ancho: r3(ancho), alto: r3(alto), nota: `Detectado en la foto como otro «${id}» y no leído: toma los colores del que sí se leyó.` });
    notas.push(`«${id}» detectado en la foto (x ${x}, ancho ${r3(ancho)}, alto ${r3(alto)}) además del que leyó el lector: se arma otro igual, con los colores del leído.`);
  }
  return { piezas: nuevas, notas };
}
