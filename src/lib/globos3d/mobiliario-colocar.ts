import { armarEscena, type Colocacion, type Escena } from "./escena";
import { muebleDe } from "./mobiliario-catalogo";
import { esGrupoDeSillas, mesaDePieza } from "./mobiliario-conjunto";
import { superficieSuperior } from "./mobiliario-superficie";
import { retiroDe, type FondoCatalogo } from "./mobiliario-tipos";

/**
 * Dónde entra por defecto un fondo o mueble que se pone sin decir dónde (el panel «Añadir» y la IA): en el piso, delante
 * de la pared del fondo a su retiro; corrido a un lado si ya hay algo ahí (dos sillas tocadas seguidas no se encaman);
 * y lo que va sobre una mesa (la base de pastel), arriba de la mesa que haya. Lo que flota (el nombre de acrílico, `flotaCm`) va
 * en el aire, a su altura y a su retiro, sin esquivar nada: es para ponerlo justo delante de un aro o un arco.
 */

/** Cuánto se corre de lado cada intento al esquivar lo que ya está (cm) y el aire que se deja entre piezas. */
const PASO_ESQUIVAR_CM = 15, AIRE_CM = 4;

/**
 * Una posición (x) del piso, a la profundidad `z`, donde la caja de la pieza nueva (`anchoCm` × `fondoCm`) no pisa la caja
 * de ninguna pieza que ya está en el piso: la del centro o, si está ocupada, la libre más cercana a un lado y al otro. null si
 * no hay lugar en todo el ancho de la sala.
 */
export function esquivarEnElPiso(escena: Escena, x: number, z: number, anchoCm: number, fondoCm: number): { x: number; z: number } | null {
  const armada = armarEscena(escena);
  const ocupadas = escena.nodos.flatMap((n) => {
    const hecho = armada.porNodo.find((h) => h.id === n.id);
    // Las sillas de una mesa (un grupo `sobre` ella) también ocupan el piso.
    return (n.colocacion.en === "piso" || (n.colocacion.en === "sobre" && esGrupoDeSillas(n.pieza))) && hecho && hecho.copias > 0 ? [hecho.caja] : [];
  });
  const libre = (cx: number) => !ocupadas.some((c) => cx + anchoCm / 2 + AIRE_CM > c.min.x && cx - anchoCm / 2 - AIRE_CM < c.max.x && z + fondoCm / 2 + AIRE_CM > c.min.z && z - fondoCm / 2 - AIRE_CM < c.max.z);
  const limite = Math.max(0, escena.sala.anchoCm / 2 - anchoCm / 2);
  if (libre(x)) return { x, z };
  for (let paso = PASO_ESQUIVAR_CM; paso <= escena.sala.anchoCm; paso += PASO_ESQUIVAR_CM) {
    for (const lado of [1, -1]) {
      const cx = Math.round(x + lado * paso);
      if (Math.abs(cx) <= limite && libre(cx)) return { x: cx, z };
    }
  }
  return null;
}

/** El centro y lo alto de la mesa de la escena donde va lo que se apoya en una mesa (la más reciente de las mesas puestas en el piso), o null. */
export function mesaParaApoyar(escena: Escena): { x: number; y: number; z: number } | null {
  const armada = armarEscena(escena);
  for (const nodo of [...escena.nodos].reverse()) {
    // Una mesa paramétrica da el centro útil de su tapa (en una media luna o una U no es el centro de su caja).
    const param = mesaDePieza(nodo.pieza);
    if (param && param.tipo !== "coctel" && nodo.colocacion.en === "piso") {
      const s = superficieSuperior(nodo, armada);
      if (s) return { x: Math.round(s.centro.x), y: Math.round(s.altoCm), z: Math.round(s.centro.z) };
    }
    const id = nodo.pieza.tipo === "escenografia" ? nodo.pieza.mueble?.id : undefined;
    const m = id ? muebleDe(id) : undefined;
    const esMesa = (m?.grupo === "mesa" && !/_sillas$|^mesa_coctel|^mesa_centro|^carrito|^mesa_hex|^mesas_nido/.test(m.id)) || id === "mesa_mantel";
    if (!esMesa || nodo.colocacion.en !== "piso") continue;
    const caja = armada.porNodo.find((n) => n.id === nodo.id)?.caja;
    if (caja) return { x: Math.round((caja.min.x + caja.max.x) / 2), y: Math.round(caja.max.y), z: Math.round((caja.min.z + caja.max.z) / 2) };
  }
  return null;
}

/** Dónde se pone una entrada del catálogo sin que nadie diga dónde (con las medidas que va a tener), y un aviso si no hay lugar libre. */
export function colocacionPorDefecto(escena: Escena, f: FondoCatalogo, medidas: { anchoCm: number; fondoCm: number }): { colocacion: Colocacion; aviso?: string } {
  if (f.lugar === "pared") return { colocacion: { en: "pared", pared: "fondo", aLoLargoCm: 0, alturaCm: f.alturaParedCm ?? 0 } };
  if (f.clase === "mueble" && f.sobreMesa) {
    const mesa = mesaParaApoyar(escena);
    if (mesa) return { colocacion: { en: "libre", xCm: mesa.x, yCm: mesa.y, zCm: mesa.z, giroGrados: 0 } };
  }
  const z = Math.round(-escena.sala.fondoCm / 2 + retiroDe(f));
  if (f.flotaCm !== undefined) return { colocacion: { en: "libre", xCm: 0, yCm: f.flotaCm, zCm: z, giroGrados: 0 } };
  const sitio = esquivarEnElPiso(escena, 0, z, medidas.anchoCm, medidas.fondoCm);
  return sitio
    ? { colocacion: { en: "piso", xCm: sitio.x, zCm: z, giroGrados: 0 } }
    : { colocacion: { en: "piso", xCm: 0, zCm: z, giroGrados: 0 }, aviso: `No hay lugar libre delante de la pared para «${f.nombre}»: quedó en el centro, encima de otra pieza. Muévela.` };
}
