import { colocacionSobreMesa } from "./centro-sobre-mesa";
import { idNuevo, type Escena, type EscenaArmada, type MarcoPieza, type NodoEscena } from "./escena";
import { esGrupoDeSillas, mesaDePieza } from "./mobiliario-conjunto";
import { tapaDeMesa } from "./mobiliario-asientos-mesa";
import { puntoEnSuperficie, superficieSuperior, type SuperficieSuperior } from "./mobiliario-superficie";
import type { Pieza } from "./piezas";
import { registroVivo } from "./salon-registro";
import { zonasDeEscena } from "./salon-zonas";

/**
 * **Centros de mesa**: una pieza encima de cada mesa, colocada como `sobre` la mesa (en el espacio de la mesa), así que moverla,
 * girarla o cambiarla de sitio lleva su centro con ella (la colocación lleva `encima: true`: ver `escena.ts`). Sirve con cualquier mesa
 * del catálogo, esté o no en un salón armado por la herramienta de salón (otra rama): redonda, imperial, cóctel, de postres… con
 * mantel, con sillas o sin ellas.
 *
 * Por qué una pieza por mesa y no un reparto en anclas (`ancla` + `cada` + `copias`): ese reparto copia UNA pieza en las anclas de
 * OTRA, y una mesa de escenografía no tiene anclas (son los huecos entre globos). Con N mesas hacen falta N piezas más; el tope de
 * la escena (`MAX_NODOS`) lo cuidan las herramientas y los materiales cuentan N veces porque son N piezas reales.
 *
 * Qué es un centro: un nodo `sobre` cuyo id empieza por `centro-` (diseño A) o `centro2-` (diseño B, el que alterna con el A).
 * El diseño es la pieza misma: todos los de una ranura son iguales, y cambiar la ranura los cambia todos a la vez.
 *
 * La altura de la cubierta sale de la geometría de la mesa (el sólido grande más alto), no de una constante: una mesa de cóctel
 * (110 cm), una redonda (75 cm) o una con sillas (cuya caja llega a lo alto del respaldo) dan cada una la suya.
 */

export type TipoMesa = "redonda" | "imperial" | "coctel" | "postres" | "otra";
export const GRUPOS_MESA = ["todas", "redondas", "imperiales", "coctel", "postres", "principal", "invitados"] as const;
export type GrupoMesa = (typeof GRUPOS_MESA)[number];
export type Ranura = 0 | 1;

/** La cara de arriba de una mesa: `superficieSuperior` (la única implementación: mesas del catálogo y paramétricas). */
export type Cubierta = SuperficieSuperior;
export type MesaDeEscena = { nodo: NodoEscena; marco: MarcoPieza; tipo: TipoMesa; cubierta: Cubierta; conCosas: boolean };

const RENGLON_CM = 70;
const NOMBRE_PRINCIPAL = /principal|honor|novios|presidi|head/i;

const esCentroId = (id: string) => /^centro2?-/.test(id);
export const esCentro = (n: NodoEscena): boolean => n.colocacion.en === "sobre" && esCentroId(n.id);
export const ranuraDe = (n: NodoEscena): Ranura => (n.id.startsWith("centro2-") ? 1 : 0);
export const centrosDe = (escena: Escena): NodoEscena[] => escena.nodos.filter(esCentro);
export const padreDeCentro = (n: NodoEscena): string | null => (n.colocacion.en === "sobre" ? n.colocacion.padreId : null);

function tipoDeMesa(n: NodoEscena, id: string): TipoMesa {
  // Una mesa paramétrica: la redonda y la cóctel son lo que dicen; la larga (rectangular, ovalada…) cuenta como imperial.
  const param = n.pieza.tipo === "escenografia" ? mesaDePieza(n.pieza) : null;
  if (param) return param.tipo === "redonda" ? "redonda" : param.tipo === "coctel" ? "coctel" : param.tipo === "rectangular" || param.tipo === "ovalada" ? "imperial" : "otra";
  if (/^mesa_redonda/.test(id)) return "redonda";
  if (/^mesa_imperial|^mesa_mantel$/.test(id)) return "imperial";
  if (/^mesa_coctel/.test(id)) return "coctel";
  if (/^mesa_postres/.test(id)) return "postres";
  return "otra";
}

/** Las mesas de la escena que admiten un centro (catálogo o paramétricas), con su cubierta. */
export function mesasDeEscena(escena: Escena, armada: EscenaArmada): MesaDeEscena[] {
  return escena.nodos.flatMap((nodo): MesaDeEscena[] => {
    const tapa = tapaDeMesa(nodo);
    const cubierta = tapa ? superficieSuperior(nodo, armada) : null;
    return tapa && cubierta ? [{ nodo, marco: cubierta.marco, tipo: tipoDeMesa(nodo, tapa.id), cubierta, conCosas: tapa.deFabricaConCosas }] : [];
  });
}

// ----------------------------------------------------------------------------------------------------------
// Qué mesas
// ----------------------------------------------------------------------------------------------------------

/**
 * La mesa principal. Con un salón armado (`principalDelSalon` definido) es la que dice su registro, o ninguna si se quitó: lo que
 * ven `ajustar_salon` y `mover_zona`, sin adivinar por el nombre. Sin salón, la que se llama así (principal, honor, novios…) y, si
 * ninguna, la imperial del fondo (la de menor z; una mesa de postres no cuenta). Vacío si no hay con qué decidirlo.
 * `adivinada` dice que fue por el sitio y no por el nombre.
 */
export function mesasPrincipales(mesas: readonly MesaDeEscena[], principalDelSalon?: string | null): { mesas: MesaDeEscena[]; adivinada: boolean } {
  if (principalDelSalon !== undefined) return { mesas: mesas.filter((m) => m.nodo.id === principalDelSalon), adivinada: false };
  const nombradas = mesas.filter((m) => NOMBRE_PRINCIPAL.test(`${m.nodo.id} ${m.nodo.nombre}`));
  if (nombradas.length) return { mesas: nombradas, adivinada: false };
  const imperiales = mesas.filter((m) => m.tipo === "imperial");
  const fondo = [...imperiales].sort((a, b) => a.cubierta.centro.z - b.cubierta.centro.z)[0];
  return { mesas: fondo ? [fondo] : [], adivinada: Boolean(fondo) };
}

/** El id de la mesa principal que dice el registro del salón: `undefined` si la escena no tiene un salón armado (entonces se adivina). */
export function principalDelSalon(escena: Escena): string | null | undefined {
  return registroVivo(escena) ? zonasDeEscena(escena).mesaPrincipal?.id ?? null : undefined;
}

const DE_GRUPO: Readonly<Record<Exclude<GrupoMesa, "todas" | "principal" | "invitados">, TipoMesa>> = { redondas: "redonda", imperiales: "imperial", coctel: "coctel", postres: "postres" };

/** Las mesas pedidas: por ids, por grupo, o las dos cosas a la vez (las que cumplen ambas). Sin nada, todas. */
export function seleccionarMesas(mesas: readonly MesaDeEscena[], pedido: { ids?: readonly string[]; grupo?: GrupoMesa; /** La principal que dice el salón (ver `principalDelSalon`). */ principal?: string | null }): { mesas: MesaDeEscena[]; error?: string; /** Lo que se supuso al elegir (la mesa principal por su sitio): para decírselo a quien pidió. */ aviso?: string } {
  let elegidas = [...mesas];
  if (pedido.ids?.length) {
    const faltan = pedido.ids.filter((id) => !mesas.some((m) => m.nodo.id === id));
    if (faltan.length) return { mesas: [], error: `No son mesas de la escena: ${faltan.join(", ")}. Mesas: ${mesas.map((m) => m.nodo.id).join(", ") || "(no hay)"}.` };
    elegidas = elegidas.filter((m) => pedido.ids!.includes(m.nodo.id));
  }
  const grupo = pedido.grupo ?? "todas";
  let aviso: string | undefined;
  if (grupo === "principal" || grupo === "invitados") {
    const principal = mesasPrincipales(mesas, pedido.principal);
    if (grupo === "principal" && !principal.mesas.length) return { mesas: [], error: "No identifico la mesa principal (ninguna se llama así ni hay una imperial): pásala con mesas = su id." };
    if (principal.adivinada) aviso = `Ninguna mesa se llama «principal»: tomé como principal «${principal.mesas[0]!.nodo.nombre}» (${principal.mesas[0]!.nodo.id}), la imperial más al fondo del salón. Si no es esa, di su id con mesas.`;
    elegidas = grupo === "principal" ? elegidas.filter((m) => principal.mesas.includes(m)) : elegidas.filter((m) => (m.tipo === "redonda" || m.tipo === "imperial") && !principal.mesas.includes(m));
  } else if (grupo !== "todas") {
    elegidas = elegidas.filter((m) => m.tipo === DE_GRUPO[grupo]);
  }
  return { mesas: elegidas, ...(aviso ? { aviso } : {}) };
}

/**
 * Qué diseño le toca a cada mesa cuando se alternan dos: un tablero de ajedrez por filas (mesas con z parecida) y de izquierda a
 * derecha, así que en una sola fila se alternan A, B, A, B y en una cuadrícula no quedan dos iguales pegadas.
 */
export function ranurasAlternas(mesas: readonly MesaDeEscena[]): Map<string, Ranura> {
  const porZ = [...mesas].sort((a, b) => a.cubierta.centro.z - b.cubierta.centro.z || a.cubierta.centro.x - b.cubierta.centro.x);
  const filas: MesaDeEscena[][] = [];
  for (const m of porZ) {
    const fila = filas.at(-1);
    if (fila && Math.abs(m.cubierta.centro.z - fila[0]!.cubierta.centro.z) <= RENGLON_CM) fila.push(m); else filas.push([m]);
  }
  const salida = new Map<string, Ranura>();
  filas.forEach((fila, r) => [...fila].sort((a, b) => a.cubierta.centro.x - b.cubierta.centro.x).forEach((m, c) => salida.set(m.nodo.id, ((r + c) % 2) as Ranura)));
  return salida;
}

// ----------------------------------------------------------------------------------------------------------
// Poner un centro
// ----------------------------------------------------------------------------------------------------------

/** Por qué una mesa ya no admite un centro sin forzar: lleva algo encima (regalos, un pastel, otra pieza apoyada), o null. */
export function cosaEncima(escena: Escena, armada: EscenaArmada, mesa: MesaDeEscena): string | null {
  if (mesa.conCosas) return "ya trae cosas encima de fábrica";
  const cara = mesa.cubierta.centro.y;
  for (const n of escena.nodos) {
    // Las sillas de la mesa (su grupo) y otras mesas no son «algo encima».
    if (n.id === mesa.nodo.id || esCentro(n) || esGrupoDeSillas(n.pieza)) continue;
    if (n.colocacion.en === "sobre" && n.colocacion.padreId === mesa.nodo.id) return `lleva «${n.nombre}» encima`;
    const hecho = armada.porNodo.find((x) => x.id === n.id);
    if (!hecho || hecho.copias === 0 || tapaDeMesa(n)) continue;
    const c = hecho.caja;
    const cx = (c.min.x + c.max.x) / 2, cz = (c.min.z + c.max.z) / 2;
    if (c.min.y >= cara - 3 && c.min.y <= cara + 4 && puntoEnSuperficie(mesa.cubierta, cx, cz, 5)) return `lleva «${n.nombre}» encima`;
  }
  return null;
}

/**
 * El nodo del centro de esta mesa: `sobre` la mesa, en el centro de su cubierta con la base justo en ella (el hundimiento del látex
 * se compensa para que no quede enterrado), o el motivo por el que no se pudo (no cabe, no sube al techo, no se arma). La colocación la
 * calcula `colocacionSobreMesa` (la misma de `poner_sobre`). `escena` es la escena de trabajo (con los centros ya puestos en esta misma
 * llamada); `armada`, la de la mesa antes de empezar; `como.nombre` es el nombre completo que se ve en la lista.
 */
export function centroDeMesa(escena: Escena, armada: EscenaArmada, mesa: MesaDeEscena, pieza: Pieza, como: { ranura: Ranura; nombre: string; /** Conserva el id de un centro que se rehace. */ id?: string }): { nodo: NodoEscena } | { motivo: string } {
  const id = como.id ?? idNuevo(escena, `centro${como.ranura ? "2" : ""}-${mesa.nodo.id}`);
  const colocacion = colocacionSobreMesa(escena, armada, mesa.nodo, pieza, { giroGrados: 0 }, id);
  if ("motivo" in colocacion) return colocacion;
  return { nodo: { id, nombre: como.nombre, pieza, colocacion } };
}
