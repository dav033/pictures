import { armarEscena, type Escena, type NodoEscena } from "./escena";
import { armarPieza } from "./piezas";

/**
 * **Lo colgado de la pared que un panel taparía** (el neón «Happy Birthday» sobre la pared de lentejuelas, un letrero sobre
 * el panel redondo): los paneles de fondo se paran en el piso unos centímetros DELANTE de la pared, así que lo que la
 * lectura de una foto cuelga de la pared quedaba detrás de ellos y no se veía. Aquí, sin modelo: lo colgado de la pared
 * del fondo que se solapa (a lo ancho y a lo alto) con un panel delgado parado delante pasa a ir suelto, en el mismo sitio,
 * corrido al frente del panel. En la pared del fondo no hay giro, así que la posición suelta es la misma traslación.
 */

/** Separación (cm) entre la cara del panel y lo que va delante. */
const SEPARACION_CM = 2;
/** Más fondo que esto (cm) ya no es un panel (es una mesa, unos pedestales): lo que se cuelga no se le pone delante. */
const FONDO_MAXIMO_PANEL_CM = 40;

const r1 = (n: number) => Math.round(n * 10) / 10;
const esEscenografia = (n: NodoEscena) => n.pieza.tipo === "escenografia";

export function colgadoDelanteDePaneles(escena: Escena, notas: string[]): Escena {
  const colgados = escena.nodos.filter((n) => esEscenografia(n) && n.colocacion.en === "pared" && n.colocacion.pared === "fondo");
  const paneles = escena.nodos.filter((n) => esEscenografia(n) && n.colocacion.en === "piso");
  if (!colgados.length || !paneles.length) return escena;
  // Solo la escenografía: armarla es rápido (sin globos) y da las cajas en el mundo.
  const cajas = new Map(armarEscena({ ...escena, nodos: [...colgados, ...paneles] }).porNodo.map((n) => [n.id, n.caja]));
  const nodos = escena.nodos.map((n) => {
    if (!colgados.includes(n)) return n;
    const c = cajas.get(n.id);
    if (!c) return n;
    let frente = -Infinity, delante = "";
    for (const p of paneles) {
      const k = cajas.get(p.id);
      if (!k || k.max.z - k.min.z > FONDO_MAXIMO_PANEL_CM || k.max.z <= c.min.z) continue;
      const solapaX = Math.min(c.max.x, k.max.x) > Math.max(c.min.x, k.min.x);
      const solapaY = Math.min(c.max.y, k.max.y) > Math.max(c.min.y, k.min.y);
      if (solapaX && solapaY && k.max.z > frente) { frente = k.max.z; delante = p.nombre; }
    }
    if (frente === -Infinity) return n;
    const local = armarPieza(n.pieza).caja;
    notas.push(`«${n.nombre}» iba colgado de la pared, detrás de «${delante}»: va delante del panel.`);
    return {
      ...n,
      colocacion: { en: "libre" as const, xCm: r1(c.min.x - local.min.x), yCm: r1(c.min.y - local.min.y), zCm: r1(frente + SEPARACION_CM - local.min.z), giroGrados: 0 },
    };
  });
  return { ...escena, nodos };
}
