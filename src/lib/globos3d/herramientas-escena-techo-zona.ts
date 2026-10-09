import { z } from "zod";
import { armarEscena, idNuevo, type Escena, type NodoEscena } from "./escena";
import { fallar } from "./herramientas-escena-colores";
import type { HerramientaExtra } from "./herramientas-escena-grupos";
import { MAX_NODOS } from "./limites-escena";
import { armarPieza } from "./piezas";
import { DENSIDADES, TIPOS_TECHO_ZONA, techoParaZona, type TipoTechoZona, type Zona } from "./techo-zona";

/**
 * **techo_por_zona**: una decoración de techo (festones, red, helio o tiras) sobre un rectángulo de la sala: la pista de baile, la
 * mesa principal, un rincón o todo el salón. El rectángulo se da en cm (`zona`), por una pieza que se quiere cubrir (`sobre_pieza`,
 * su caja más un margen) o es la sala entera (`toda_la_sala`). La pieza queda centrada en el rectángulo y dentro de la sala.
 *
 * Cuánto cuelga: pegada al techo si la sala mide 4 m o menos; en una sala más alta baja para que su punto más bajo quede al 72 %
 * del alto de la sala (o a `altura_libre_cm`), con su hilo. `reemplazar` rehace una ya puesta (otra zona, tipo, densidad o colores)
 * con el mismo id. Quitarla: quitar_pieza.
 */

const ZonaSchema = z.object({
  x_cm: z.number().describe("centro del rectángulo, izquierda (−) a derecha (+)"),
  z_cm: z.number().describe("centro del rectángulo, fondo (−) a frente (+)"),
  ancho_cm: z.number().min(40).max(3000).describe("medida a lo ancho (en x)"),
  fondo_cm: z.number().min(40).max(3000).describe("medida a lo largo (en z)"),
});

const TechoZonaSchema = z.object({
  tipo: z.enum(TIPOS_TECHO_ZONA).optional().describe("festones (guirnaldas en catenaria con globos de remate; por defecto), red (cuadrícula de cuartetos pegada al techo), helio (globos con cinta) o tiras (tiras colgantes)"),
  zona: ZonaSchema.optional().describe("el rectángulo a cubrir"),
  sobre_pieza: z.string().min(1).max(80).optional().describe("en vez de zona: id de la pieza que se quiere cubrir (una mesa, la pista…); cubre su caja más margen_cm"),
  toda_la_sala: z.boolean().optional().describe("en vez de zona: todo el salón (menos margen_cm de cada pared)"),
  margen_cm: z.number().min(0).max(500).optional().describe("sobre_pieza: lo que sobresale a cada lado (40 por defecto); toda_la_sala: lo que se separa de cada pared (60 por defecto)"),
  colores: z.array(z.string().min(1).max(40)).min(1).max(4).optional().describe("hasta 4 colores (blanco y dorado por defecto)"),
  densidad: z.enum(DENSIDADES).optional().describe("cuánto llena la zona: baja, media (por defecto) o alta"),
  altura_libre_cm: z.number().min(180).max(1500).optional().describe("altura del piso al punto más bajo; si falta, pegada al techo (salas de hasta 4 m) o al 72 % del alto de la sala"),
  reemplazar: z.string().min(1).max(80).optional().describe("id de un techo ya puesto con esta herramienta (techo-zona-…): se rehace con lo nuevo, mismo id"),
  nombre: z.string().min(1).max(60).optional().describe("nombre visible"),
});

const NOMBRE_TIPO: Readonly<Record<TipoTechoZona, string>> = { festones: "festones", red: "red de racimos", helio: "globos de helio", tiras: "tiras colgantes" };
const MARGEN_PAREDES_CM = 20;
const r0 = Math.round;

/** El rectángulo pedido, recortado a la sala (con su margen de seguridad), y de dónde salió. */
function zonaPedida(escena: Escena, a: z.infer<typeof TechoZonaSchema>, notas: string[]): { zona: Zona; origen: string } {
  const fuentes = [a.zona, a.sobre_pieza, a.toda_la_sala].filter((x) => x !== undefined && x !== false).length;
  if (fuentes !== 1) fallar("Di la zona con UNA de estas formas: zona (x_cm, z_cm, ancho_cm, fondo_cm), sobre_pieza (el id de lo que cubre) o toda_la_sala: true.");
  const { anchoCm, fondoCm } = escena.sala;
  let x0: number, x1: number, z0: number, z1: number, origen: string;
  if (a.zona) {
    x0 = a.zona.x_cm - a.zona.ancho_cm / 2; x1 = a.zona.x_cm + a.zona.ancho_cm / 2; z0 = a.zona.z_cm - a.zona.fondo_cm / 2; z1 = a.zona.z_cm + a.zona.fondo_cm / 2;
    origen = `la zona centrada en (${r0(a.zona.x_cm)}, ${r0(a.zona.z_cm)})`;
  } else if (a.sobre_pieza) {
    const nodo = escena.nodos.find((n) => n.id === a.sobre_pieza) ?? fallar(`No hay ninguna pieza con id «${a.sobre_pieza}». Ids: ${escena.nodos.map((n) => n.id).slice(0, 30).join(", ")}.`);
    const hecho = armarEscena(escena).porNodo.find((n) => n.id === nodo.id);
    if (!hecho || hecho.copias === 0) return fallar(`«${nodo.nombre}» no está puesta en la sala: no hay dónde medir la zona.`);
    const m = a.margen_cm ?? 40;
    x0 = hecho.caja.min.x - m; x1 = hecho.caja.max.x + m; z0 = hecho.caja.min.z - m; z1 = hecho.caja.max.z + m;
    origen = `sobre «${nodo.nombre}» (${nodo.id})`;
  } else {
    const m = a.margen_cm ?? 60;
    x0 = -anchoCm / 2 + m; x1 = anchoCm / 2 - m; z0 = -fondoCm / 2 + m; z1 = fondoCm / 2 - m;
    origen = "todo el salón";
  }
  const dentro = { x0: Math.max(x0, -anchoCm / 2 + MARGEN_PAREDES_CM), x1: Math.min(x1, anchoCm / 2 - MARGEN_PAREDES_CM), z0: Math.max(z0, -fondoCm / 2 + MARGEN_PAREDES_CM), z1: Math.min(z1, fondoCm / 2 - MARGEN_PAREDES_CM) };
  if (dentro.x1 - dentro.x0 < 40 || dentro.z1 - dentro.z0 < 40) fallar(`La zona queda fuera de la sala (x de ${r0(-anchoCm / 2)} a ${r0(anchoCm / 2)}, z de ${r0(-fondoCm / 2)} a ${r0(fondoCm / 2)}) o casi sin espacio dentro de ella.`);
  if (dentro.x0 > x0 + 0.5 || dentro.x1 < x1 - 0.5 || dentro.z0 > z0 + 0.5 || dentro.z1 < z1 - 0.5) notas.push("recorté la zona para que quede dentro de la sala");
  return { zona: { cx: (dentro.x0 + dentro.x1) / 2, cz: (dentro.z0 + dentro.z1) / 2, ancho: dentro.x1 - dentro.x0, fondo: dentro.z1 - dentro.z0 }, origen };
}

/**
 * Cuánto cuelga una decoración de techo (cm desde el techo): lo del 72 % del alto de la sala (o `libreCm`, el alto libre pedido) solo en
 * salas altas; en una baja, pegada al techo.
 */
function cuelgaDeTecho(altoSalaCm: number, altoPiezaCm: number, libreCm?: number): number {
  const objetivo = libreCm ?? (altoSalaCm > 400 ? altoSalaCm * 0.72 : altoSalaCm - altoPiezaCm);
  return Math.min(Math.max(0, altoSalaCm - 40), Math.max(0, altoSalaCm - objetivo - altoPiezaCm));
}

function aplicar(escena: Escena, argumentos: unknown) {
  const a = TechoZonaSchema.parse(argumentos ?? {});
  const notas: string[] = [];
  const previo = a.reemplazar ? escena.nodos.find((n) => n.id === a.reemplazar) : undefined;
  if (a.reemplazar && (!previo || !previo.id.startsWith("techo-zona-") || previo.pieza.tipo !== "techo")) fallar(`«${a.reemplazar}» no es un techo puesto con techo_por_zona (su id empieza por techo-zona-). Para otro techo usa quitar_pieza y vuelve a ponerlo.`);
  if (!previo && escena.nodos.length >= MAX_NODOS) fallar(`La escena ya tiene ${escena.nodos.length} piezas (máximo ${MAX_NODOS}): quita alguna antes de poner el techo.`);
  const tipo = a.tipo ?? "festones";
  const { zona, origen } = zonaPedida(escena, a, notas);
  const pieza = techoParaZona({ tipo, zona, colores: a.colores, densidad: a.densidad }, notas);
  const { min, max } = armarPieza(pieza).caja;
  const alto = max.y - min.y, sala = escena.sala;

  const cuelga = cuelgaDeTecho(sala.altoCm, alto, a.altura_libre_cm);
  const libre = sala.altoCm - cuelga - alto;
  if (a.altura_libre_cm !== undefined && Math.abs(libre - a.altura_libre_cm) > 1) notas.push(`el punto más bajo queda a ${r0(libre)} cm del piso (no a ${r0(a.altura_libre_cm)}): ${libre > a.altura_libre_cm ? "la pieza tapa el techo" : "el hilo máximo de esta sala"}`);
  if (libre < 210) notas.push(`el punto más bajo queda a ${r0(libre)} cm del piso: es bajo para pasar por debajo`);
  if (libre < 0) fallar(`La decoración mide ${r0(alto)} cm de alto y la sala ${r0(sala.altoCm)} cm: no cabe.`);

  const id = previo?.id ?? idNuevo(escena, `techo-zona-${tipo}`);
  const nodo: NodoEscena = {
    id, nombre: a.nombre ?? previo?.nombre ?? `Techo de ${NOMBRE_TIPO[tipo]}`, pieza,
    colocacion: { en: "techo", xCm: r0(zona.cx), zCm: r0(zona.cz), cuelgaCm: r0(cuelga), giroGrados: 0, volteada: false },
  };
  const nueva: Escena = { ...escena, nodos: previo ? escena.nodos.map((n) => (n.id === previo.id ? nodo : n)) : [...escena.nodos, nodo] };
  const hecho = armarEscena(nueva).porNodo.find((n) => n.id === id);
  if (!hecho || hecho.copias === 0) return fallar(`No se pudo armar el techo: ${hecho?.avisos[0] ?? "sin motivo"}`);
  const g = hecho.materiales.reduce((s, m) => s + m.cantidad, 0);
  return {
    escena: nueva,
    resumen: [
      `${previo ? "Rehice" : "Puse"} «${nodo.nombre}» (id ${id}): ${NOMBRE_TIPO[tipo]} sobre ${origen}, ${r0(zona.ancho)}×${r0(zona.fondo)} cm, ${a.densidad ?? "media"}, ${g} globos; ${cuelga > 0 ? `cuelga ${r0(cuelga)} cm con su hilo, ` : "pegada al techo, "}su punto más bajo a ${r0(libre)} cm del piso.`,
      "Cambiarla: techo_por_zona con reemplazar = su id; quitarla: quitar_pieza.", ...new Set(notas),
    ].join(" "),
  };
}

export const HERRAMIENTAS_TECHO_ZONA: Readonly<Record<string, HerramientaExtra>> = {
  techo_por_zona: {
    esquema: TechoZonaSchema,
    descripcion: "Pone una decoración de techo (festones, red, helio o tiras) sobre un rectángulo de la sala: la pista de baile, la mesa principal, un rincón o todo el salón. Dale la zona en cm (zona), una pieza que cubrir (sobre_pieza = su id) o toda_la_sala. Se ajusta al tamaño, queda dentro de la sala y baja según el alto de la sala (altura_libre_cm lo fija). Con densidad baja/media/alta y colores. Un grupito sobre una sola mesa o todo el techo del salón: la misma herramienta. reemplazar = id de uno ya puesto para rehacerlo.",
    aplicar,
  },
};
