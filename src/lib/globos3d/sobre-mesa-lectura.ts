import { armarEscena, idNuevo, type Colocacion, type Escena, type NodoEscena } from "./escena";
import { colocacionSobreMesa, OCUPACION_MAXIMA } from "./centro-sobre-mesa";
import { mobiliarioLeido, type FondoLeido, type MedidaLeida, type NodoMobiliario } from "./compilar-mobiliario";
import { superficieSuperior, type SuperficieSuperior } from "./mobiliario-superficie";
import type { Pieza } from "./piezas";

/**
 * **Lo leído de una foto que va sobre una mesa** (el pastel, la base de pastel: `sobreMesa` en el catálogo): en vez de pararlo en el
 * piso a su retiro de la pared, se busca la mesa de la escena cuya tapa lo tiene debajo (por su x en la foto) y se pone encima, al
 * alto de la tapa y en el x leído, con la misma `colocacionSobreMesa` de `poner_sobre`. Se hace al final, cuando ya están todas las mesas.
 * Si no hay mesa debajo (o no cabe), va al piso como cualquier mueble y queda dicho en las notas.
 */

export type SobreMesaPendiente = { pieza: FondoLeido; medida: MedidaLeida; indice: number };

const r1 = (n: number) => Math.round(n * 10) / 10;

/** La tapa que tiene debajo la x dada (la más cercana en x si ninguna la cubre). */
function tapaBajo(tapas: ReadonlyArray<{ mesa: NodoEscena; tapa: SuperficieSuperior }>, x: number) {
  const dentro = (t: SuperficieSuperior) => Math.abs(x - t.centro.x) <= t.anchoCm / 2;
  return [...tapas].sort((a, b) => Number(dentro(b.tapa)) - Number(dentro(a.tapa)) || Math.abs(x - a.tapa.centro.x) - Math.abs(x - b.tapa.centro.x))[0] ?? null;
}

export function ponerSobreMesas(escena: Escena, pendientes: readonly SobreMesaPendiente[], notas: string[]): Escena {
  if (!pendientes.length) return escena;
  // Solo las mesas: armarlas es rápido (sin globos) y da su tapa en el mundo.
  const soloMesas: Escena = { ...escena, nodos: escena.nodos.filter((n) => n.colocacion.en === "piso" && n.pieza.tipo === "escenografia") };
  const armada = armarEscena(soloMesas);
  const tapas = soloMesas.nodos.flatMap((mesa) => { const tapa = superficieSuperior(mesa, armada); return tapa ? [{ mesa, tapa }] : []; });
  let actual = escena;
  const poner = (m: NodoMobiliario, colocacion: Colocacion) => {
    actual = { ...actual, nodos: [...actual.nodos, { id: idNuevo(actual, m.base), nombre: m.nombre, pieza: m.pieza, colocacion }] };
  };
  for (const { pieza: p, medida, indice } of pendientes) {
    const etiqueta = `Pieza ${indice + 1} (${p.id})`;
    const elegida = tapaBajo(tapas, medida.xCm);
    const alPiso = (motivo: string) => {
      notas.push(`${etiqueta}: ${motivo}; va en el piso, delante de la pared.`);
      for (const m of mobiliarioLeido(p, medida, notas, []) ?? []) poner(m, m.colocacion);
    };
    if (!elegida) { alPiso("no hay una mesa donde apoyarlo"); continue; }
    const { mesa, tapa } = elegida;
    // Que quepa en lo angosto de la tapa (un pastel de 28 cm no entra en una consola de 31).
    const ancho = Math.min(medida.anchoCm, tapa.angostoCm * OCUPACION_MAXIMA * 0.95);
    const hechos = mobiliarioLeido(p, { ...medida, anchoCm: ancho }, notas, []);
    const hecho = hechos?.[0];
    if (!hecho) { alPiso("no se pudo armar"); continue; }
    const holgura = Math.max(0, tapa.anchoCm / 2 - ancho / 2);
    const corrimiento = Math.max(-holgura, Math.min(holgura, medida.xCm - tapa.centro.x));
    const sobre = colocacionSobreMesa(soloMesas, armada, mesa, hecho.pieza as Pieza, { xCm: r1(corrimiento), giroGrados: 0 }, `${hecho.base}-nuevo`);
    if ("motivo" in sobre) { alPiso(`no se pudo poner sobre «${mesa.nombre}» (${sobre.motivo})`); continue; }
    poner(hecho, sobre);
    notas.push(`${etiqueta}: sobre «${mesa.nombre}», a ${r1(medida.xCm)} cm del centro de la foto.`);
  }
  return actual;
}
