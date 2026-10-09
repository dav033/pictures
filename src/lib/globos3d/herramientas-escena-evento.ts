import { z } from "zod";
import type { Escena } from "./escena";
import type { HerramientaExtra } from "./herramientas-escena-grupos";
import { coloresDeMuebles } from "./herramientas-escena-salon";
import { armarSalon } from "./salon-armar";
import { decorarSalon } from "./salon-decoracion";
import { ESTILOS_SALON } from "./salon-piezas";
import { type ArquetipoFondo, coloresDeTema, composicionDe } from "./salon-composicion";
import { ponerIdeasDeBiblioteca } from "./salon-ideas-biblioteca";
import { esPlantillaSinTocar } from "./escenas-presets";
import { MAX_INVITADOS_SALON, mesasNecesarias, TIPOS_MESA_SALON } from "./salon-evento";
import { vivas } from "./salon-registro";
import { ZONAS_SALON, zonasDeEscena, type ZonaSalon } from "./salon-zonas";
import { MAX_NODOS } from "./limites-escena";
import { decorarMesasYTecho, type TechoDelEvento } from "./salon-decorar-zonas";
import { fallar } from "./herramientas-escena-colores";

/**
 * **planificar_evento** (REQ-008): el pedido completo («boda de 120 en un salón, blanco y dorado») en UNA llamada. Elige la
 * escala (`alcance`): `solo_decoracion` (fondo de fotos y entrada, sin mesas), `rincon` (unas pocas mesas con postres y fondo de
 * fotos) o `salon` (la sala completa). Arma el salón (salon-armar.ts), lo decora con globos de los colores del pedido
 * (salon-decoracion.ts) y le pone un centro de mesa a cada mesa y el techo de la pista (salon-decorar-zonas.ts, con `decorar_mesas` y
 * `techo_por_zona`). Después el modelo afina con las herramientas de siempre y ajustar_salon / mover_zona / quitar_zona.
 */

export const TIPOS_EVENTO = ["boda", "quince", "cumpleanos", "bautizo", "baby_shower", "corporativo", "graduacion", "halloween", "otro"] as const;
export type TipoEvento = (typeof TIPOS_EVENTO)[number];
export const ALCANCES_EVENTO = ["solo_decoracion", "rincon", "salon"] as const;
export type AlcanceEvento = (typeof ALCANCES_EVENTO)[number];

const EventoSchema = z.object({
  tipo_evento: z.enum(TIPOS_EVENTO).describe("boda y quince: salón con mesa principal y pista; corporativo: sin pista ni postres; el resto (otro = cualquier decoración temática): fondo de fotos, postres y entrada"),
  tematica: z.string().min(2).max(60).optional().describe("el tema («safari», «princesas», «Frozen», «boho»): decide la composición del fondo y las ideas de la biblioteca; sin tema manda la ocasión"),
  texto: z.string().min(1).max(24).optional().describe("lo que dicen las letras o el número de foil del fondo, si la composición los lleva («Ana», «15», «2026»)"),
  alcance: z.enum(ALCANCES_EVENTO).optional().describe("solo_decoracion: fondo de fotos y entrada, sin mesas; rincon: pocas mesas con postres y fondo de fotos; salon: la sala completa. Si falta: sin invitados = solo_decoracion, hasta 40 = rincon, más = salon"),
  invitados: z.number().int().min(1).max(MAX_INVITADOS_SALON).optional().describe("invitados (50–200 es lo típico de un salón); no hace falta con solo_decoracion"),
  colores: z.array(z.string().min(1).max(40)).max(3).optional().describe("los colores del evento («blanco», «dorado»): el primero es el mantel y los globos principales, el segundo las sillas y los acentos"),
  estilo: z.enum(ESTILOS_SALON).optional().describe("organico (globos de varios tamaños, por defecto) o clasico (cuartetos)"),
  mesa: z.enum(TIPOS_MESA_SALON).optional().describe("redonda8 (por defecto), redonda10 o imperial"),
  ancho_cm: z.number().optional().describe("ancho del salón si lo dicen (300–3000); si no, se calcula"),
  fondo_cm: z.number().optional().describe("fondo del salón si lo dicen (300–3000)"),
  reemplazar: z.boolean().optional().describe("true: rehace el salón que ya hay (quita solo sus piezas salon-…)"),
});

const ZONAS_DE_FIESTA: readonly ZonaSalon[] = ["fondo_fotos", "mesa_postres", "entrada"];
const ZONAS_POR_EVENTO: Readonly<Record<TipoEvento, readonly ZonaSalon[]>> = {
  boda: ZONAS_SALON, quince: ZONAS_SALON,
  corporativo: ["mesa_principal", "fondo_fotos", "entrada"],
  cumpleanos: ZONAS_DE_FIESTA, bautizo: ZONAS_DE_FIESTA, baby_shower: ZONAS_DE_FIESTA, graduacion: ZONAS_DE_FIESTA, halloween: ZONAS_DE_FIESTA, otro: ZONAS_DE_FIESTA,
};

/** Las zonas que arma cada escala para ese tipo de evento. */
export function zonasDelEvento(tipo: TipoEvento, alcance: AlcanceEvento): ZonaSalon[] {
  if (alcance === "solo_decoracion") return ["fondo_fotos", "entrada"];
  if (alcance === "rincon") return ["fondo_fotos", "mesa_postres"];
  return [...ZONAS_POR_EVENTO[tipo]];
}

const INVITADOS_POR_DEFECTO: Readonly<Record<AlcanceEvento, number>> = { solo_decoracion: 0, rincon: 24, salon: 100 };

export const alcanceDe = (alcance: AlcanceEvento | undefined, invitados: number | undefined): AlcanceEvento =>
  alcance ?? (invitados === undefined ? "solo_decoracion" : invitados <= 40 ? "rincon" : "salon");

function planificar(escena: Escena, argumentos: unknown): { escena: Escena; resumen: string } {
  const a = EventoSchema.parse(argumentos ?? {});
  const notas: string[] = [];
  const alcance = alcanceDe(a.alcance, a.invitados);
  const invitados = alcance === "solo_decoracion" ? 0 : a.invitados ?? INVITADOS_POR_DEFECTO[alcance];
  const estilo = a.estilo ?? "organico";
  const mesa = a.mesa ?? "redonda8";
  if (alcance === "rincon" && mesasNecesarias(invitados, mesa) > 8) notas.push(`Un rincón lleva pocas mesas y son ${mesasNecesarias(invitados, mesa)}: para más de 8 mesas usa alcance salon.`);
  if (alcance === "solo_decoracion" && a.invitados !== undefined) notas.push("Con solo_decoracion no se arman mesas: ignoré los invitados.");

  // La plantilla de partida sin tocar no es trabajo de nadie: un evento nuevo la reemplaza (y se dice).
  const base = esPlantillaSinTocar(escena) ? { ...escena, nodos: [] } : escena;
  if (base !== escena) notas.push("La escena era la plantilla de partida sin tocar (arco, dos columnas y guirnalda): la reemplacé por el diseño del evento.");
  const colores = a.colores?.length ? a.colores : coloresDeTema(a.tipo_evento, a.tematica) ?? [];
  const composicion = composicionDe({ tipo: a.tipo_evento, tematica: a.tematica, colores: a.colores, estilo, texto: a.texto });

  const salon = armarSalon(base, {
    invitados, mesa, anchoCm: a.ancho_cm, fondoCm: a.fondo_cm, zonas: zonasDelEvento(a.tipo_evento, alcance), colores: coloresDeMuebles(a.colores, notas), reemplazar: a.reemplazar,
  }, notas);
  // Si el salón conservó decoración tuya en el fondo de fotos, esa es el fondo: no se le suma otra composición encima.
  const adoptada = vivas(salon.escena).some((v) => v.info.rol === "adoptada");
  const zonas = zonasDeEscena(salon.escena);
  let decorada = decorarSalon(salon.escena, zonas, { colores, estilo, composicion, texto: a.texto, fondo: !adoptada, entrada: true }, notas);
  if (!adoptada) decorada = ponerIdeasDeBiblioteca(decorada, zonasDeEscena(decorada), { tipo: a.tipo_evento, tematica: a.tematica, semilla: composicion.semilla, alFrente: alcance === "solo_decoracion" }, notas);
  if (decorada.nodos.length > MAX_NODOS) fallar(`El evento sumaría ${decorada.nodos.length} piezas y el máximo es ${MAX_NODOS}: usa menos zonas o menos invitados.`);
  // Centros de mesa y techo según la escala: solo_decoracion no lleva mesas (ni centros); el rincón, un grupito de globos sobre su mesa principal o de postres; el salón, festones sobre la pista; la composición «columnas y techo», globos sobre el fondo.
  const techos: TechoDelEvento[] = [...(alcance === "salon" ? ["pista" as const] : alcance === "rincon" ? ["rincon" as const] : []), ...(composicion.fondo === "columnas_techo" && !adoptada ? ["fondo" as const] : [])];
  const centros = alcance !== "solo_decoracion";
  const final = centros || techos.length ? decorarMesasYTecho(decorada, { colores, estilo, centros, techos }, notas) : decorada;
  const piezasNuevas = final.nodos.length - base.nodos.length;
  return { escena: final, resumen: [`Evento ${a.tipo_evento}${a.tematica ? ` «${a.tematica}»` : ""} (${alcance}): ${salon.resumen} Fondo: ${NOMBRE_COMPOSICION[composicion.fondo]}. ${piezasNuevas} piezas nuevas con globos ${estilo === "organico" ? "orgánicos" : "clásicos"}.`, ...new Set(notas)].join(" ") };
}

const NOMBRE_COMPOSICION: Readonly<Record<ArquetipoFondo, string>> = {
  arco_columnas: "arco con columnas y guirnalda", pared_letras: "pared de globos con letras de foil", paneles_guirnalda: "guirnalda orgánica a lo ancho con racimos", semiarco_racimos: "semiarco con racimos",
  columnas_techo: "columnas altas con globos en el techo", mural: "mural de globos", figuras: "figuras de globos", aro_ramos: "aro con ramos de helio",
};

export const HERRAMIENTAS_EVENTO: Readonly<Record<string, HerramientaExtra>> = {
  planificar_evento: {
    esquema: EventoSchema,
    descripcion: "Para un EVENTO o una DECORACIÓN TEMÁTICA NUEVA (boda, XV, cumpleaños, baby shower, bautizo, graduación, Halloween, corporativo; «el salón completo», «solo la decoración de safari», «un rincón de postres»): ÚSALA PRIMERO, en una llamada. Arma el salón (mesas con sillas, mesa principal, pista, postres, entrada; agranda la sala) y un fondo de fotos cuya composición sale de la tematica (palmeras, castillo, pared con letras, semiarco con racimos, mural, aro con ramos, columnas con techo, guirnalda a lo ancho; el arco con columnas es solo una), 1 a 3 ideas de la biblioteca, un centro en cada mesa y el techo de la pista, con los colores del pedido. Conserva lo que ya había y reemplaza la plantilla de partida sin tocar. Afina con ajustar_salon, mover_zona, quitar_zona, decorar_mesas, techo_por_zona.",
    aplicar: planificar,
  },
};
