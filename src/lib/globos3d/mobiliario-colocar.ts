import { armarEscena, type Colocacion, type Escena } from "./escena";
import { muebleDe } from "./mobiliario-catalogo";
import { retiroDe, type FondoCatalogo } from "./mobiliario-tipos";

/**
 * Dónde entra por defecto un fondo o mueble que se pone sin decir dónde (el panel «Añadir» y la IA): en el piso, delante
 * de la pared del fondo a su retiro; corrido a un lado si ya hay algo ahí (dos sillas tocadas seguidas no se encaman);
 * y lo que va sobre una mesa (la base de pastel), arriba de la mesa que haya.
 */

/** Lo que se corre de lado cada intento al esquivar lo que ya está (cm), y cuántos intentos. */
const PASO_ESQUIVAR_CM = 12, INTENTOS_ESQUIVAR = 14;

/** Una posición del piso (x, z) libre de otras piezas del piso: la pedida o, si hay algo encima, la primera libre hacia la derecha y luego la izquierda. */
export function esquivarEnElPiso(escena: Escena, x: number, z: number, anchoCm: number, fondoCm: number): { x: number; z: number } {
  const ocupa = (cx: number) => escena.nodos.some((n) => n.colocacion.en === "piso" && Math.abs(n.colocacion.xCm - cx) < anchoCm * 0.6 && Math.abs(n.colocacion.zCm - z) < fondoCm * 0.6);
  const limite = escena.sala.anchoCm / 2 - anchoCm / 2;
  if (!ocupa(x)) return { x, z };
  const paso = anchoCm + PASO_ESQUIVAR_CM;
  for (let i = 1; i <= INTENTOS_ESQUIVAR; i++) {
    for (const lado of [1, -1]) {
      const cx = x + lado * paso * Math.ceil(i / 2);
      if (Math.abs(cx) <= limite && !ocupa(cx)) return { x: Math.round(cx), z };
    }
  }
  return { x, z };
}

/** El centro y lo alto de la mesa de la escena donde va lo que se apoya en una mesa (la más reciente de las mesas puestas en el piso), o null. */
export function mesaParaApoyar(escena: Escena): { x: number; y: number; z: number } | null {
  const armada = armarEscena(escena);
  for (const nodo of [...escena.nodos].reverse()) {
    const id = nodo.pieza.tipo === "escenografia" ? nodo.pieza.mueble?.id : undefined;
    const m = id ? muebleDe(id) : undefined;
    const esMesa = (m?.grupo === "mesa" && !/_sillas$|^mesa_coctel|^mesa_centro|^carrito|^mesa_hex|^mesas_nido/.test(m.id)) || id === "mesa_mantel";
    if (!esMesa || nodo.colocacion.en !== "piso") continue;
    const caja = armada.porNodo.find((n) => n.id === nodo.id)?.caja;
    if (caja) return { x: Math.round((caja.min.x + caja.max.x) / 2), y: Math.round(caja.max.y), z: Math.round((caja.min.z + caja.max.z) / 2) };
  }
  return null;
}

/** Dónde se pone una entrada del catálogo sin que nadie diga dónde (con las medidas que va a tener, para esquivar y apoyar). */
export function colocacionPorDefecto(escena: Escena, f: FondoCatalogo, medidas: { anchoCm: number; fondoCm: number }): Colocacion {
  if (f.lugar === "pared") return { en: "pared", pared: "fondo", aLoLargoCm: 0, alturaCm: f.alturaParedCm ?? 0 };
  if (f.clase === "mueble" && f.sobreMesa) {
    const mesa = mesaParaApoyar(escena);
    if (mesa) return { en: "libre", xCm: mesa.x, yCm: mesa.y, zCm: mesa.z, giroGrados: 0 };
  }
  const z = Math.round(-escena.sala.fondoCm / 2 + retiroDe(f));
  const { x } = esquivarEnElPiso(escena, 0, z, medidas.anchoCm, medidas.fondoCm);
  return { en: "piso", xCm: x, zCm: z, giroGrados: 0 };
}
