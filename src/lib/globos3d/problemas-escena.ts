import { armarEscena, descendientes, type Escena, type EscenaArmada, type NodoArmado, type NodoEscena } from "./escena";
import { puntoEnSuperficie, superficieSuperior } from "./mobiliario-superficie";
import { muebleDeMesa } from "./descripcion-mobiliario";
import { CACHE_ARMADO } from "./altura-pieza";

/**
 * **Problemas que se ven en la escena aunque cada herramienta diga «ok»** (2026-10-09): la conversación 3d-20261009-103125-92b58a puso
 * flores de 9 globos en el PISO, en la x/z de cada mesa, bajo el mantel, y la IA contestó «coloqué un centro de mesa sobre cada mesa».
 * Aquí se detecta lo que una decoración tapada por una mesa deja en la geometría: su caja cae dentro de la cubierta de una mesa
 * y empieza por debajo de ella. Puro y sin red.
 */

export type ProblemaEscena = { tipo: "bajo_mesa"; nodoId: string; mesaId: string; texto: string };

/** Lo que una decoración puede sobresalir de la cubierta y seguir contando como «dentro» (cm). */
const MARGEN_CM = 5;
/** Cuánto por debajo de la cubierta tiene que empezar para no ser algo apoyado encima (cm): el látex cede 1,5 cm. */
const BAJO_LA_CUBIERTA_CM = 2;

/** ¿Es una pieza que va suelta (sobre el piso o en el aire) y no una cosa de la mesa o de la escenografía? */
function esDecoracionSuelta(n: NodoEscena, armado: NodoArmado | undefined): armado is NodoArmado {
  return n.pieza.tipo !== "escenografia" && armado !== undefined && armado.copias === 1 && armado.puestas.length === 1 && n.colocacion.en !== "ancla";
}

/**
 * Los problemas de `despues` que `antes` no tenía: lo que de verdad se rompió en este paso o turno. Lo que ya estaba (algo puesto a propósito por la
 * persona) no se le reclama a la IA ni se le pide corregir.
 */
export function problemasNuevos(antes: Escena, despues: Escena): ProblemaEscena[] {
  const previos = new Set(problemasDeEscena(antes).map((p) => `${p.nodoId}|${p.mesaId}`));
  return problemasDeEscena(despues).filter((p) => !previos.has(`${p.nodoId}|${p.mesaId}`));
}

/** Las decoraciones que quedaron dentro o debajo de una mesa. Vacío si no hay mesas (no arma nada). */
export function problemasDeEscena(escena: Escena, armada?: EscenaArmada): ProblemaEscena[] {
  const mesas = escena.nodos.filter((n) => muebleDeMesa(n) !== null);
  if (!mesas.length) return [];
  const hecha = armada ?? armarEscena(escena, CACHE_ARMADO);
  const salida: ProblemaEscena[] = [];
  for (const mesa of mesas) {
    const cubierta = superficieSuperior(mesa, hecha);
    if (!cubierta) continue;
    const tope = cubierta.centro.y;
    const propias = descendientes(escena, mesa.id);
    for (const n of escena.nodos) {
      const armado = hecha.porNodo.find((x) => x.id === n.id);
      if (propias.has(n.id) || !esDecoracionSuelta(n, armado)) continue;
      const c = armado.caja;
      // La huella de la pieza (su caja en el piso) contra la tapa de verdad —su contorno, no la caja que la encierra—: una columna en el hueco de una U o
      // en la esquina que deja una mesa girada 45° no está sobre la tapa aunque caiga dentro de su caja.
      const dentro = [[c.min.x, c.min.z], [c.max.x, c.min.z], [c.max.x, c.max.z], [c.min.x, c.max.z]].every(([x, z]) => puntoEnSuperficie(cubierta, x!, z!, MARGEN_CM));
      if (!dentro || c.min.y >= tope - BAJO_LA_CUBIERTA_CM) continue;
      const que = c.max.y <= tope ? "quedó dentro de la mesa, tapada por el mantel: no se ve" : "atraviesa la mesa";
      salida.push({ tipo: "bajo_mesa", nodoId: n.id, mesaId: mesa.id, texto: `«${n.nombre}» (${n.id}) ${que} («${mesa.nombre}», ${mesa.id}; su cubierta está a ${Math.round(tope)} cm del piso y esta pieza empieza a ${Math.round(c.min.y)} cm). Ponla encima con mover_sobre (id = ${n.id}, padre_id = ${mesa.id}).` });
    }
  }
  return salida;
}
