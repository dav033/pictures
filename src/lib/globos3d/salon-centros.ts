import { armarEscena, type Escena, type NodoEscena } from "./escena";
import { centrosDe, centroDeMesa, mesasDeEscena, padreDeCentro, ranuraDe } from "./centros-mesa";
import { HERRAMIENTAS_CENTROS } from "./herramientas-escena-centros";
import { zonasDeEscena } from "./salon-zonas";

/**
 * **Los centros de mesa cuando cambia el salón** (REQ-008): `ajustar_salon` agrega mesas, quita mesas o cambia su tipo, y los centros
 * (piezas `sobre` su mesa) tienen que seguir pareciendo de ese salón. Si el salón ya llevaba centros:
 * - las mesas nuevas reciben el MISMO centro (`completar_centros`), sin que la IA tenga que acordarse;
 * - las mesas que cambiaron de tipo (otro mueble con otra tapa y otra altura) vuelven a apoyar su centro en la tapa nueva; si ya no
 *   cabe en ella, ese centro se quita y se avisa (una mesa sin centro es honesta; uno flotando o metido en la mesa, no);
 * - las mesas que se quitan se llevan su centro (lo hace `quitarConLoSuyo`, no esta función).
 * Si el salón no llevaba centros, no se pone ninguno: no se decora lo que nadie pidió decorar.
 */

const muebleDe = (n: NodoEscena): string | undefined => (n.pieza.tipo === "escenografia" ? n.pieza.mueble?.id : undefined);

/** Quita esos centros de la escena. */
const sinCentros = (escena: Escena, ids: ReadonlySet<string>): Escena => ({ ...escena, nodos: escena.nodos.filter((n) => !ids.has(n.id)) });

function volverAApoyar(antes: Escena, despues: Escena, notas: string[]): Escena {
  const cambiadas = new Set(despues.nodos.filter((n) => { const previa = antes.nodos.find((x) => x.id === n.id); return previa && muebleDe(previa) !== muebleDe(n); }).map((n) => n.id));
  const afectados = centrosDe(despues).filter((c) => cambiadas.has(padreDeCentro(c) ?? ""));
  if (!afectados.length) return despues;
  const armada = armarEscena(despues);
  const mesas = mesasDeEscena(despues, armada);
  let actual = despues;
  const quitados = new Set<string>();
  for (const centro of afectados) {
    const mesa = mesas.find((m) => m.nodo.id === padreDeCentro(centro));
    const hecho = mesa && centroDeMesa(actual, armada, mesa, structuredClone(centro.pieza), { ranura: ranuraDe(centro), nombre: centro.nombre, id: centro.id });
    if (hecho && "nodo" in hecho) { actual = { ...actual, nodos: actual.nodos.map((n) => (n.id === centro.id ? hecho.nodo : n)) }; continue; }
    quitados.add(centro.id);
    notas.push(`${mesa?.nodo.nombre ?? padreDeCentro(centro)}: su centro de mesa ya no cabe en la mesa nueva (${hecho && "motivo" in hecho ? hecho.motivo : "no es una mesa que admita centro"}) y lo quité.`);
  }
  if (afectados.length > quitados.size) notas.push(`Volví a apoyar ${afectados.length - quitados.size} centro(s) de mesa en las mesas de otro tipo.`);
  return sinCentros(actual, quitados);
}

/** Deja los centros del salón de `despues` al día con lo que cambió respecto a `antes` (la escena antes del ajuste). */
export function sincronizarCentros(antes: Escena, despues: Escena, notas: string[]): Escena {
  if (!centrosDe(antes).length) return despues;
  const habia = new Set(zonasDeEscena(antes).mesas);
  const nuevas = zonasDeEscena(despues).mesas.filter((id) => !habia.has(id));
  let actual = despues;
  if (nuevas.length) {
    try {
      actual = HERRAMIENTAS_CENTROS.completar_centros!.aplicar(actual, { mesas: nuevas }).escena;
      notas.push(`Las ${nuevas.length} mesa(s) nueva(s) recibieron el mismo centro de mesa que las demás.`);
    } catch (error) {
      notas.push(`Las ${nuevas.length} mesa(s) nueva(s) quedaron sin centro de mesa (${error instanceof Error ? error.message : String(error)}): usa completar_centros.`);
    }
  }
  return volverAApoyar(antes, actual, notas);
}

/** Cuántos centros de mesa se fueron entre dos escenas (por ejemplo al rehacer el salón con sus mesas). */
export const centrosPerdidos = (antes: Escena, despues: Escena): number => Math.max(0, centrosDe(antes).length - centrosDe(despues).length);
