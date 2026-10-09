import { fijoEnFormato, type ColorOrganico } from "./organico";
import type { Pieza } from "./piezas";
import { FLORES_ARTIFICIALES, type OpcionesFlores, type TipoFlorArtificial } from "./flores-artificiales";
import { fallar } from "./herramientas-escena-colores";
import { escalarGenerador, piezaDeGenerador, type GeneradorOrganico } from "./generadores-organicos";
import { INFLADOS_TRAZO, MEZCLA_TRAZO, SILUETAS_TRAZO, cajaTrazo, esColumnaTrazo, puntosDeSilueta, validarTrazo, type ParametrosTrazoOrganico, type PuntoTrazo, type SiluetaTrazo } from "./trazo-organico";

/**
 * La IA de escena con el **trazo orgánico** (`trazo-organico.ts`): crearlo por silueta con nombre o por puntos (de una
 * foto: x a la derecha y y hacia arriba desde el piso, con el grosor en cada punto) y cambiarlo por sus parámetros
 * (medidas, grosor, colores, tamaños). Los colores ya llegan resueltos a la paleta orgánica.
 */

export const IDS_SILUETA = SILUETAS_TRAZO.map((s) => s.id) as [SiluetaTrazo, ...SiluetaTrazo[]];
export const RANGOS_TRAZO = { ancho_cm: [80, 900], alto_cm: [40, 400], grosor_cm: [20, 140] } as const;

export type PuntoPedido = { x_cm: number; y_cm: number; grosor_cm: number };
export type PedidoTrazo = { silueta?: string; puntos?: readonly PuntoPedido[]; ancho_cm?: number; alto_cm?: number; grosor_cm?: number; tamanos?: readonly string[]; racimos?: number; flores?: boolean; follaje?: readonly string[] };

const r0 = (n: number) => Math.round(n);
const semillaDe = (...n: number[]) => (n.reduce((s, x) => (s * 31 + r0(x)) % 9973, 7) || 7);

function enRango(valor: number, [min, max]: readonly [number, number], que: string): number {
  if (!Number.isFinite(valor) || valor < min || valor > max) fallar(`${que} = ${valor} cm está fuera de rango: va de ${min} a ${max} cm.`);
  return r0(valor);
}

/** La mezcla de tamaños: la de las fotos, o solo los tamaños pedidos (con sus pesos de esa mezcla). */
function mezclaDe(tamanos: readonly string[] | undefined): Record<string, number> {
  if (!tamanos?.length) return { ...MEZCLA_TRAZO };
  const pedidos = tamanos.map((t) => t.trim().toUpperCase());
  for (const t of pedidos) if (INFLADOS_TRAZO[t] === undefined) fallar(`El tamaño «${t}» no va en una guirnalda orgánica: usa ${Object.keys(INFLADOS_TRAZO).join(", ")}.`);
  return Object.fromEntries(pedidos.map((t) => [t, MEZCLA_TRAZO[t] ?? 0.1]));
}

export function crearTrazo(p: PedidoTrazo, colores: ColorOrganico[]): { pieza: Pieza; nombre: string } {
  let puntos: PuntoTrazo[];
  let silueta: SiluetaTrazo | undefined;
  let nombre = "Guirnalda orgánica libre";
  if (p.puntos?.length) {
    if (p.silueta) fallar("Pasa «silueta» o «puntos», no los dos.");
    puntos = p.puntos.map((q) => ({ x: q.x_cm, y: q.y_cm, grosor: q.grosor_cm }));
  } else {
    const elegida = SILUETAS_TRAZO.find((s) => s.id === (p.silueta ?? "feston")) ?? fallar(`Silueta «${p.silueta}» desconocida: ${IDS_SILUETA.join(", ")}.`);
    silueta = elegida.id;
    const columna = esColumnaTrazo(elegida.id);
    const grosor = enRango(p.grosor_cm ?? (columna ? 65 : 60), RANGOS_TRAZO.grosor_cm, "grosor_cm");
    // La columna recta mide de ancho su grosor; las de forma libre, lo que se corren de lado.
    const ancho = elegida.id === "columna_recta" ? grosor : enRango(p.ancho_cm ?? (columna ? Math.round(grosor * 2.6) : 260), [columna ? grosor : RANGOS_TRAZO.ancho_cm[0], RANGOS_TRAZO.ancho_cm[1]], "ancho_cm");
    const alto = enRango(p.alto_cm ?? (elegida.id === "feston" ? 90 : columna ? 200 : 190), RANGOS_TRAZO.alto_cm, "alto_cm");
    puntos = puntosDeSilueta(elegida.id, { anchoCm: ancho, altoCm: Math.max(alto, grosor + 10), grosorCm: grosor });
    nombre = columna ? (elegida.id === "columna_recta" ? "Columna orgánica irregular" : `Columna orgánica · ${elegida.nombre.toLowerCase()}`) : `Guirnalda orgánica · ${elegida.nombre.toLowerCase()}`;
  }
  const racimos = p.racimos === undefined ? undefined : Math.min(1, Math.max(0, p.racimos));
  const trazo: ParametrosTrazoOrganico = { ...(silueta ? { silueta } : {}), puntos, mezcla: mezclaDe(p.tamanos), colores, ...(racimos !== undefined ? { racimos } : {}), semilla: semillaDe(...puntos.flatMap((q) => [q.x, q.y])) };
  const error = validarTrazo(trazo);
  if (error) fallar(error);
  const flores = p.follaje?.length ? floresPedidas(p.follaje) : p.flores ? structuredClone(FLORES_TRAZO) : null;
  return { pieza: piezaDeGenerador({ tipo: "trazo", trazo }, flores, huecosPara(trazo, flores)), nombre };
}

/** Flores de tela por defecto en los huecos (rosas blancas y gypsophila, como en las fotos de boda). */
const FLORES_TRAZO: OpcionesFlores = { semilla: 5, proporcion: [{ tipo: "rosa", colorId: "blanca", peso: 3 }, { tipo: "gypsophila", colorId: "blanca", peso: 1 }], tallosPorRacimo: 3 };

/** Cambia un trazo que ya existe por sus parámetros: medidas por fuera, grosor, colores, tamaños, racimos. */
export function ajustarTrazo(pieza: Extract<Pieza, { tipo: "organico" }>, g: Extract<GeneradorOrganico, { tipo: "trazo" }>, p: PedidoTrazo & { colores?: ColorOrganico[] }): Extract<Pieza, { tipo: "organico" }> {
  let gen: GeneradorOrganico = g;
  const caja = cajaTrazo(g.trazo);
  const ancho = p.ancho_cm === undefined ? undefined : enRango(p.ancho_cm, RANGOS_TRAZO.ancho_cm, "ancho_cm");
  const alto = p.alto_cm === undefined ? undefined : enRango(p.alto_cm, RANGOS_TRAZO.alto_cm, "alto_cm");
  const grosorMayor = Math.max(...g.trazo.puntos.map((q) => q.grosor));
  const factor = p.grosor_cm === undefined ? undefined : enRango(p.grosor_cm, RANGOS_TRAZO.grosor_cm, "grosor_cm") / grosorMayor;
  if (ancho !== undefined || alto !== undefined || factor !== undefined) gen = escalarGenerador(gen, { ...(ancho !== undefined && ancho !== caja.anchoCm ? { anchoCm: ancho } : {}), ...(alto !== undefined ? { altoCm: alto } : {}), ...(factor !== undefined ? { grosor: factor } : {}) });
  // «Solo estos tamaños» reemplaza toda la mezcla: también los cambios por zona y el relleno a medida de ajustar_tamanos.
  const t: ParametrosTrazoOrganico = { ...gen.trazo };
  if (p.tamanos?.length) {
    const mezcla = mezclaDe(p.tamanos);
    delete t.zonas;
    delete t.relleno;
    // La mezcla propia de cada tramo y los globos fijos son de la mezcla de antes: con «solo estos tamaños» mandan los pedidos.
    t.puntos = t.puntos.map((q) => { const sin = { ...q }; delete sin.pesos; return sin; });
    if (t.fijos) {
      const quedan = t.fijos.filter((f) => Object.keys(mezcla).some((formato) => (mezcla[formato] ?? 0) > 0 && fijoEnFormato(f, formato)));
      if (quedan.length) t.fijos = quedan; else delete t.fijos;
    }
  }
  gen = { tipo: "trazo", trazo: { ...t, ...(p.colores ? { colores: p.colores } : {}), ...(p.tamanos?.length ? { mezcla: mezclaDe(p.tamanos) } : {}), ...(p.racimos !== undefined ? { racimos: Math.min(1, Math.max(0, p.racimos)) } : {}) } };
  const error = validarTrazo(gen.trazo);
  if (error) fallar(error);
  const flores = p.follaje?.length ? floresPedidas(p.follaje) : p.flores === undefined ? pieza.flores : p.flores ? (pieza.flores ?? structuredClone(FLORES_TRAZO)) : null;
  return piezaDeGenerador(gen, flores, huecosPara(gen.trazo, flores));
}

export const TIPOS_FOLLAJE = Object.keys(FLORES_ARTIFICIALES) as [TipoFlorArtificial, ...TipoFlorArtificial[]];

/**
 * «monstera», «palma dorada», «rosa marfil», «hoja_seca beige»… → las flores y hojas de los huecos, en partes iguales
 * (el primero pesa el doble: es el que más se ve). El color es uno de los de esa flor; si falta, el primero.
 */
export function floresPedidas(lista: readonly string[]): OpcionesFlores {
  const proporcion = lista.map((pedido, i) => {
    const [tipo, ...resto] = pedido.trim().toLowerCase().replace(/\s+/g, " ").split(" ");
    const flor = FLORES_ARTIFICIALES[tipo as TipoFlorArtificial] ?? fallar(`Follaje «${pedido}» desconocido: ${TIPOS_FOLLAJE.join(", ")} (con color opcional: «palma dorada»).`);
    const nombre = resto.join(" ");
    const color = nombre ? flor.colores.find((c) => c.id === nombre || c.nombre === nombre) ?? fallar(`«${flor.nombre}» viene en ${flor.colores.map((c) => c.nombre).join(", ")}.`) : flor.colores[0]!;
    return { tipo: flor.tipo, colorId: color.id, peso: i === 0 ? 2 : 1 };
  });
  return { semilla: 9, proporcion, tallosPorRacimo: proporcion.length > 1 ? 2 : 1 };
}

/** Huecos para el follaje: uno cada ~45 cm de trazo (las hojas se ven sueltas, no en montón). */
function huecosPara(t: ParametrosTrazoOrganico, flores: OpcionesFlores | null): number {
  if (!flores) return 0;
  let largo = 0;
  for (let i = 1; i < t.puntos.length; i++) largo += Math.hypot(t.puntos[i]!.x - t.puntos[i - 1]!.x, t.puntos[i]!.y - t.puntos[i - 1]!.y);
  return Math.max(4, Math.min(30, Math.round(largo / 45)));
}
