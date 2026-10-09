import { armarEscena, type Escena, type NodoEscena } from "./escena";
import { centroDe } from "./letras";
import { muebleDe } from "./mobiliario-catalogo";
import { armarPieza } from "./piezas";
import { esTelon } from "./fondos-escenografia";

/**
 * **Lo colgado de la pared que un panel taparía** (el neón «Happy Birthday» sobre la pared de lentejuelas, un letrero sobre
 * el panel redondo): los paneles de fondo se paran en el piso unos centímetros DELANTE de la pared, así que lo que la
 * lectura de una foto cuelga de la pared quedaba detrás de ellos y no se veía. Aquí, sin modelo: lo colgado de la pared
 * del fondo que se solapa (a lo ancho y a lo alto) con un panel delgado parado delante pasa a ir suelto, en el mismo sitio,
 * corrido al frente del panel. En la pared del fondo no hay giro, así que la posición suelta es la misma traslación.
 */

/** Separación (cm) entre la cara del panel y lo que va delante. */
const SEPARACION_CM = 2;

const r1 = (n: number) => Math.round(n * 10) / 10;
const esEscenografia = (n: NodoEscena) => n.pieza.tipo === "escenografia";
/**
 * ¿El nodo de piso es un telón (panel, arco, marco, aro, biombo)? Lo dice el catálogo (`esTelon`), no su fondo: una mesa de postres
 * de 31 cm de fondo o unos pedestales no son un panel aunque sean delgados, y no tapan lo que cuelga de la pared.
 */
const esPanelDeFondo = (n: NodoEscena) => n.pieza.tipo === "escenografia" && n.pieza.mueble !== undefined && esTelon(n.pieza.mueble.id);

export function colgadoDelanteDePaneles(escena: Escena, notas: string[]): Escena {
  const colgados = escena.nodos.filter((n) => esEscenografia(n) && n.colocacion.en === "pared" && n.colocacion.pared === "fondo");
  const paneles = escena.nodos.filter((n) => esPanelDeFondo(n) && n.colocacion.en === "piso");
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
      if (!k || k.max.z <= c.min.z) continue;
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
const esLetreroConTexto = (n: NodoEscena) => n.pieza.tipo === "escenografia" && Boolean(n.pieza.mueble && muebleDe(n.pieza.mueble.id)?.conTexto);
/** Las letras y los números de globo metalizado (foil): también son lo que se lee, y se les pone delante del arco como al neón. */
const esLetraDeFoil = (n: NodoEscena) => n.pieza.tipo === "metalizado" && ["letra", "letras", "numero"].includes(n.pieza.metalizado.forma.tipo);
const esLetrero = (n: NodoEscena) => esLetreroConTexto(n) || esLetraDeFoil(n);

/**
 * **Los letreros con texto que los globos taparían** (el «Isabella» de acrílico sobre un aro cuando la lectura hace pasar la
 * guirnalda por detrás de él, las letras de foil de «Happy Birthday» colgadas en el plano de la pared): el letrero va suelto, en el
 * mismo sitio, justo delante de los globos que caen sobre él en la foto (no delante de toda la guirnalda: solo de los que se le
 * cruzan). Sin giro, como arriba.
 *
 * Las letras de foil son un rótulo que cruza la abertura del arco: todas las letras de una misma línea van a la misma profundidad (la de la cara
 * delantera del arco más la suya: sin el tope de los demás letreros, porque un rótulo de este tipo va delante de la guirnalda entera) y, si la
 * línea cabe entre los brazos del arco, se corre de lado hasta quedar dentro de su abertura.
 */
export function letrerosDelanteDeGlobos(escena: Escena, notas: string[]): Escena {
  const letreros = escena.nodos.filter((n) => esLetrero(n) && n.colocacion.en !== "piso" && (n.colocacion.en !== "pared" || n.colocacion.pared === "fondo") && (n.colocacion.en !== "libre" || n.colocacion.giroGrados === 0));
  if (!letreros.length || !escena.nodos.some((n) => n.pieza.tipo !== "escenografia" && n.pieza.tipo !== "metalizado")) return escena;
  const armada = armarEscena(escena);
  const globos = armada.porNodo.filter((n) => !letreros.some((l) => l.id === n.id)).flatMap((n) => n.globos.map((g) => ({ c: centroDe(g), r: g.infladoCm / 2 })));
  const cajas = new Map(armada.porNodo.map((n) => [n.id, n.caja]));
  /** El z de la cara de delante de los globos que tapan al letrero, capa por capa (sin saltar huecos de más de `PEGADOS_AL_LETRERO_CM`). */
  const frenteDe = (c: { min: { x: number; y: number }; max: { x: number; y: number; z: number } }): number => {
    const encima = globos.filter((g) => g.c.x + g.r > c.min.x && g.c.x - g.r < c.max.x && g.c.y + g.r > c.min.y && g.c.y - g.r < c.max.y);
    let frente = c.max.z;
    for (let antes = -Infinity; frente > antes;) {
      antes = frente;
      frente = encima.reduce((m, g) => (g.c.z - g.r <= antes + PEGADOS_AL_LETRERO_CM ? Math.max(m, g.c.z + g.r) : m), antes);
    }
    return frente;
  };
  /** Cada línea de letras de foil (las que están a la misma altura) como un solo rótulo. */
  const lineas = new Map<number, NodoEscena[]>();
  for (const n of letreros.filter(esLetraDeFoil)) { const y = n.colocacion.en === "libre" ? n.colocacion.yCm : 0; lineas.set(y, [...(lineas.get(y) ?? []), n]); }
  const nuevas = new Map<string, NodoEscena["colocacion"]>();
  const poner = (n: NodoEscena, c: { min: { x: number; y: number; z: number } }, x: number, z: number) => {
    const local = armarPieza(n.pieza).caja;
    nuevas.set(n.id, { en: "libre" as const, xCm: r1(x - local.min.x), yCm: r1(c.min.y - local.min.y), zCm: r1(z - local.min.z), giroGrados: 0 });
  };
  for (const linea of lineas.values()) {
    const cs = linea.flatMap((n) => { const c = cajas.get(n.id); return c ? [{ n, c }] : []; });
    if (!cs.length) continue;
    const frente = Math.max(...cs.map(({ c }) => frenteDe(c)));
    const min = { x: Math.min(...cs.map(({ c }) => c.min.x)), y: Math.min(...cs.map(({ c }) => c.min.y)), z: Math.min(...cs.map(({ c }) => c.min.z)) };
    const max = { x: Math.max(...cs.map(({ c }) => c.max.x)), y: Math.max(...cs.map(({ c }) => c.max.y)), z: Math.max(...cs.map(({ c }) => c.max.z)) };
    // La abertura del arco a la altura del rótulo: entre lo más a la derecha de los globos de la izquierda y lo más a la izquierda de los de la derecha.
    const centro = (min.x + max.x) / 2;
    const banda = globos.filter((g) => g.c.y + g.r > min.y && g.c.y - g.r < max.y);
    const izq = banda.filter((g) => g.c.x < centro), der = banda.filter((g) => g.c.x >= centro);
    const dentroDesde = izq.length ? Math.max(...izq.map((g) => g.c.x + g.r)) : -Infinity, dentroHasta = der.length ? Math.min(...der.map((g) => g.c.x - g.r)) : Infinity;
    let dx = 0;
    if (max.x - min.x <= dentroHasta - dentroDesde) dx = Math.max(dentroDesde - min.x, 0) + Math.min(dentroHasta - max.x, 0);
    // Detrás de los globos del arco: toda la línea pasa a empezar justo delante de su cara de delante.
    const dz = frente > max.z ? frente + SEPARACION_CM - min.z : 0;
    if (dz <= 0 && dx === 0) continue;
    notas.push(`«${cs.map(({ n }) => n.nombre).join(" · ")}»: ${dz > 0 ? `quedaba detrás de los globos del arco: va delante de ellos` : "se corrió de lado"}${dx !== 0 ? `${dz > 0 ? " y" : ""} dentro de su abertura` : ""}.`);
    for (const { n, c } of cs) poner(n, c, c.min.x + dx, c.min.z + dz);
  }
  const nodos = escena.nodos.map((n) => {
    const colocada = nuevas.get(n.id);
    if (colocada) return { ...n, colocacion: colocada };
    if (!letreros.includes(n) || esLetraDeFoil(n)) return n;
    const c = cajas.get(n.id);
    if (!c) return n;
    // Los globos cuyo disco cae sobre el letrero (de frente) y que lo atraviesan, capa por capa: primero los que tocan su
    // cara y después los que tocan a esos (el cuerpo de una guirnalda de 80 cm de grueso entero). Un montón de piso que está
    // metros delante tapa al letrero de verdad, como en la foto: no lo arrastra hacia la sala.
    const frente = frenteDe(c);
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
