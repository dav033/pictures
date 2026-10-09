import { armarEscena, type Escena, type NodoEscena } from "./escena";
import { centroDe } from "./letras";
import { muebleDe } from "./mobiliario-catalogo";
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

/** Los globos que atraviesan el plano del letrero: su parte de atrás a lo más esto delante de su cara (cm). */
const PEGADOS_AL_LETRERO_CM = 10;
/** Lo más que se corre un letrero hacia la sala para quedar delante de los globos (cm): una guirnalda gruesa ronda 80; más ya no es «encima de la guirnalda». */
const MAXIMO_ADELANTE_LETRERO_CM = 120;

/** Un letrero con texto (el nombre de acrílico, el neón): lo que se lee tiene que verse. */
const esLetrero = (n: NodoEscena) => n.pieza.tipo === "escenografia" && Boolean(n.pieza.mueble && muebleDe(n.pieza.mueble.id)?.conTexto);

/**
 * **Los letreros con texto que los globos taparían** (el «Isabella» de acrílico sobre un aro cuando la lectura hace pasar la
 * guirnalda por detrás de él): el letrero va suelto, en el mismo sitio, justo delante de los globos que caen sobre él en la
 * foto (no delante de toda la guirnalda: solo de los que se le cruzan). Sin giro, como arriba.
 */
export function letrerosDelanteDeGlobos(escena: Escena, notas: string[]): Escena {
  const letreros = escena.nodos.filter((n) => esLetrero(n) && n.colocacion.en !== "piso" && (n.colocacion.en !== "pared" || n.colocacion.pared === "fondo") && (n.colocacion.en !== "libre" || n.colocacion.giroGrados === 0));
  if (!letreros.length || !escena.nodos.some((n) => n.pieza.tipo !== "escenografia")) return escena;
  const armada = armarEscena(escena);
  const globos = armada.porNodo.filter((n) => !letreros.some((l) => l.id === n.id)).flatMap((n) => n.globos.map((g) => ({ c: centroDe(g), r: g.infladoCm / 2 })));
  const cajas = new Map(armada.porNodo.map((n) => [n.id, n.caja]));
  const nodos = escena.nodos.map((n) => {
    if (!letreros.includes(n)) return n;
    const c = cajas.get(n.id);
    if (!c) return n;
    // Los globos cuyo disco cae sobre el letrero (de frente) y que lo atraviesan, capa por capa: primero los que tocan su
    // cara y después los que tocan a esos (el cuerpo de una guirnalda de 80 cm de grueso entero), sin saltar huecos de más de
    // `PEGADOS_AL_LETRERO_CM`. Un montón de piso que está metros delante tapa al letrero de verdad, como en la foto: no lo
    // arrastra hacia la sala.
    const encima = globos.filter((g) => g.c.x + g.r > c.min.x && g.c.x - g.r < c.max.x && g.c.y + g.r > c.min.y && g.c.y - g.r < c.max.y);
    let frente = c.max.z;
    for (let antes = -Infinity; frente > antes;) {
      antes = frente;
      frente = encima.reduce((m, g) => (g.c.z - g.r <= antes + PEGADOS_AL_LETRERO_CM ? Math.max(m, g.c.z + g.r) : m), antes);
    }
    if (!(frente > c.max.z)) return n;
    if (frente - c.max.z > MAXIMO_ADELANTE_LETRERO_CM) {
      notas.push(`«${n.nombre}» queda tapado por globos que van ${Math.round(frente - c.max.z)} cm delante de él: se deja donde está.`);
      return n;
    }
    const local = armarPieza(n.pieza).caja;
    notas.push(`«${n.nombre}» quedaba detrás de los globos que le pasan por delante: va delante de ellos.`);
    return { ...n, colocacion: { en: "libre" as const, xCm: r1(c.min.x - local.min.x), yCm: r1(c.min.y - local.min.y), zCm: r1(frente + SEPARACION_CM - local.min.z), giroGrados: 0 } };
  });
  return { ...escena, nodos };
}
