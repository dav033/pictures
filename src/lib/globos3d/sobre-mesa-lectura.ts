import { armarEscena, idNuevo, type Colocacion, type Escena, type NodoEscena } from "./escena";
import { colocacionSobreMesa, OCUPACION_MAXIMA } from "./centro-sobre-mesa";
import { mobiliarioLeido, type FondoLeido, type MedidaLeida, type NodoMobiliario } from "./compilar-mobiliario";
import { superficieSuperior, type SuperficieSuperior } from "./mobiliario-superficie";
import type { Pieza } from "./piezas";

/**
 * **Lo leído de una foto que va sobre una mesa** (el pastel, la base de pastel: `sobreMesa` en el catálogo): en vez de pararlo en el
 * piso a su retiro de la pared, se busca la mesa de la escena cuya tapa lo tiene debajo (por su x en la foto) y se pone encima, al
 * alto de la tapa y en el x leído, con la misma `colocacionSobreMesa` de `poner_sobre`. Se hace al final, cuando ya están todas las mesas.
 * No se inventa nada: si no hay una mesa debajo, o ya no cabe (ni corriéndolo, sin encimarse a los que ya están sobre esa tapa), no se arma y queda en
 * `omitidas` con el motivo. Los que ya se pusieron cuentan para el siguiente: dos pasteles no se encaraman.
 */

export type SobreMesaPendiente = { pieza: FondoLeido; medida: MedidaLeida; indice: number };

const r1 = (n: number) => Math.round(n * 10) / 10;
/** Aire (cm) que se deja entre dos cosas sobre la misma tapa, y paso (cm) con que se busca un sitio libre. */
const AIRE_CM = 1.5;
const PASO_CM = 2;

/** La tapa que tiene debajo la x dada (la más cercana en x si ninguna la cubre). */
function tapaBajo(tapas: ReadonlyArray<{ mesa: NodoEscena; tapa: SuperficieSuperior }>, x: number) {
  const dentro = (t: SuperficieSuperior) => Math.abs(x - t.centro.x) <= t.anchoCm / 2;
  const elegida = [...tapas].sort((a, b) => Number(dentro(b.tapa)) - Number(dentro(a.tapa)) || Math.abs(x - a.tapa.centro.x) - Math.abs(x - b.tapa.centro.x))[0];
  return elegida && dentro(elegida.tapa) ? elegida : null;
}

/** El corrimiento más cercano al deseado, dentro de la holgura de la tapa, que no se encima a nada de lo ya puesto (centros y radios en cm, en el eje de la tapa); `null` si no hay. */
function corrimientoLibre(deseado: number, holgura: number, radio: number, puestos: ReadonlyArray<{ x: number; r: number }>, centroTapa: number): number | null {
  const libre = (c: number) => puestos.every((q) => Math.abs(centroTapa + c - q.x) >= radio + q.r + AIRE_CM);
  const limite = Math.max(0, holgura);
  const dentro = Math.max(-limite, Math.min(limite, deseado));
  if (libre(dentro)) return dentro;
  for (let d = PASO_CM; d <= 2 * limite + PASO_CM; d += PASO_CM) {
    for (const c of [dentro + d, dentro - d]) if (Math.abs(c) <= limite && libre(c)) return c;
  }
  return null;
}

export function ponerSobreMesas(escena: Escena, pendientes: readonly SobreMesaPendiente[], notas: string[], omitidas: string[]): Escena {
  if (!pendientes.length) return escena;
  // Solo las mesas: armarlas es rápido (sin globos) y da su tapa en el mundo.
  const soloMesas: Escena = { ...escena, nodos: escena.nodos.filter((n) => n.colocacion.en === "piso" && n.pieza.tipo === "escenografia") };
  const armada = armarEscena(soloMesas);
  const tapas = soloMesas.nodos.flatMap((mesa) => { const tapa = superficieSuperior(mesa, armada); return tapa ? [{ mesa, tapa }] : []; });
  let actual = escena;
  const puestos = new Map<string, Array<{ x: number; r: number }>>();
  const poner = (m: NodoMobiliario, colocacion: Colocacion) => {
    actual = { ...actual, nodos: [...actual.nodos, { id: idNuevo(actual, m.base), nombre: m.nombre, pieza: m.pieza, colocacion }] };
  };
  for (const { pieza: p, medida, indice } of pendientes) {
    const etiqueta = `Pieza ${indice + 1} (${p.id})`;
    const omitir = (motivo: string) => { notas.push(`${etiqueta}: no se arma: ${motivo}.`); omitidas.push(`${etiqueta}: ${motivo}.`); };
    const elegida = tapaBajo(tapas, medida.xCm);
    if (!elegida) { omitir("no hay una mesa debajo donde apoyarlo"); continue; }
    const { mesa, tapa } = elegida;
    // Que quepa en lo angosto de la tapa (un pastel de 28 cm no entra en una consola de 31).
    const ancho = Math.min(medida.anchoCm, tapa.angostoCm * OCUPACION_MAXIMA * 0.95);
    const hechos = mobiliarioLeido(p, { ...medida, anchoCm: ancho }, notas, []);
    const hecho = hechos?.[0];
    if (!hecho) { omitir("no se pudo armar"); continue; }
    const radio = ancho / 2;
    const yaPuestos = puestos.get(mesa.id) ?? [];
    const holgura = Math.max(0, tapa.anchoCm / 2 - radio);
    const corrimiento = corrimientoLibre(medida.xCm - tapa.centro.x, holgura, radio, yaPuestos, tapa.centro.x);
    if (corrimiento === null) { omitir(`no cabe en «${mesa.nombre}» sin encimarse a lo que ya está sobre ella`); continue; }
    const sobre = colocacionSobreMesa(soloMesas, armada, mesa, hecho.pieza as Pieza, { xCm: r1(corrimiento), giroGrados: 0 }, `${hecho.base}-nuevo`);
    if ("motivo" in sobre) { omitir(`no se pudo poner sobre «${mesa.nombre}» (${sobre.motivo})`); continue; }
    poner(hecho, sobre);
    puestos.set(mesa.id, [...yaPuestos, { x: tapa.centro.x + corrimiento, r: radio }]);
    notas.push(`${etiqueta}: sobre «${mesa.nombre}», a ${r1(medida.xCm)} cm del centro de la foto${Math.abs(tapa.centro.x + corrimiento - medida.xCm) > 1 ? ` (corrido a ${r1(tapa.centro.x + corrimiento)} cm: ahí cabe sin encimarse)` : ""}.`);
  }
  return actual;
}
