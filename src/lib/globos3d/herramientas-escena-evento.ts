import { z } from "zod";
import type { Escena } from "./escena";
import type { HerramientaExtra } from "./herramientas-escena-grupos";
import { coloresDeMuebles } from "./herramientas-escena-salon";
import { armarSalon } from "./salon-armar";
import { decorarSalon, ESTILOS_SALON } from "./salon-decoracion";
import { MAX_INVITADOS_SALON, mesasNecesarias, TIPOS_MESA_SALON } from "./salon-evento";
import { vivas } from "./salon-registro";
import { ZONAS_SALON, zonasDeEscena, type ZonaSalon } from "./salon-zonas";
import { MAX_NODOS } from "./limites-escena";
import { decorarMesasYTecho } from "./salon-decorar-zonas";
import { fallar } from "./herramientas-escena-colores";

/**
 * **planificar_evento** (REQ-008): el pedido completo («boda de 120 en un salón, blanco y dorado») en UNA llamada. Elige la
 * escala (`alcance`): `solo_decoracion` (fondo de fotos y entrada, sin mesas), `rincon` (unas pocas mesas con postres y fondo de
 * fotos) o `salon` (la sala completa). Arma el salón (salon-armar.ts), lo decora con globos de los colores del pedido
 * (salon-decoracion.ts) y le pone un centro de mesa a cada mesa y el techo de la pista (salon-decorar-zonas.ts, con `decorar_mesas` y
 * `techo_por_zona`). Después el modelo afina con las herramientas de siempre y ajustar_salon / mover_zona / quitar_zona.
 */

export const TIPOS_EVENTO = ["boda", "quince", "cumpleanos", "bautizo", "baby_shower", "corporativo"] as const;
export type TipoEvento = (typeof TIPOS_EVENTO)[number];
export const ALCANCES_EVENTO = ["solo_decoracion", "rincon", "salon"] as const;
export type AlcanceEvento = (typeof ALCANCES_EVENTO)[number];

const EventoSchema = z.object({
  tipo_evento: z.enum(TIPOS_EVENTO).describe("boda y quince: salón completo con mesa principal y pista; corporativo: sin pista ni postres; cumpleanos, bautizo y baby_shower: fondo de fotos, postres y entrada"),
  alcance: z.enum(ALCANCES_EVENTO).optional().describe("solo_decoracion: fondo de fotos y entrada, sin mesas; rincon: pocas mesas con postres y fondo de fotos; salon: la sala completa. Si falta: sin invitados = solo_decoracion, hasta 40 = rincon, más = salon"),
  invitados: z.number().int().min(1).max(MAX_INVITADOS_SALON).optional().describe("invitados (50–200 es lo típico de un salón); no hace falta con solo_decoracion"),
  colores: z.array(z.string().min(1).max(40)).max(3).optional().describe("los colores del evento («blanco», «dorado»): el primero es el mantel y los globos principales, el segundo las sillas y los acentos"),
  estilo: z.enum(ESTILOS_SALON).optional().describe("organico (globos de varios tamaños, por defecto) o clasico (cuartetos)"),
  mesa: z.enum(TIPOS_MESA_SALON).optional().describe("redonda8 (por defecto), redonda10 o imperial"),
  ancho_cm: z.number().optional().describe("ancho del salón si lo dicen (300–3000); si no, se calcula"),
  fondo_cm: z.number().optional().describe("fondo del salón si lo dicen (300–3000)"),
  reemplazar: z.boolean().optional().describe("true: rehace el salón que ya hay (quita solo sus piezas salon-…)"),
});

const ZONAS_POR_EVENTO: Readonly<Record<TipoEvento, readonly ZonaSalon[]>> = {
  boda: ZONAS_SALON, quince: ZONAS_SALON,
  corporativo: ["mesa_principal", "fondo_fotos", "entrada"],
  cumpleanos: ["fondo_fotos", "mesa_postres", "entrada"], bautizo: ["fondo_fotos", "mesa_postres", "entrada"], baby_shower: ["fondo_fotos", "mesa_postres", "entrada"],
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

  const salon = armarSalon(escena, {
    invitados, mesa, anchoCm: a.ancho_cm, fondoCm: a.fondo_cm, zonas: zonasDelEvento(a.tipo_evento, alcance), colores: coloresDeMuebles(a.colores, notas), reemplazar: a.reemplazar,
  }, notas);
  // Si el salón conservó decoración tuya en el fondo de fotos, esa es el fondo: no se le suma otro arco encima.
  const adoptada = vivas(salon.escena).some((v) => v.info.rol === "adoptada");
  const decorada = decorarSalon(salon.escena, zonasDeEscena(salon.escena), { colores: a.colores ?? [], estilo, fondo: !adoptada, entrada: true }, notas);
  if (decorada.nodos.length > MAX_NODOS) fallar(`El evento sumaría ${decorada.nodos.length} piezas y el máximo es ${MAX_NODOS}: usa menos zonas o menos invitados.`);
  // Centros de mesa y techo según la escala: solo_decoracion no lleva mesas ni techo; el rincón, un grupito de globos sobre su mesa principal o de postres; el salón, festones sobre la pista.
  const final = alcance === "solo_decoracion" ? decorada : decorarMesasYTecho(decorada, { colores: a.colores ?? [], estilo, techo: alcance === "salon" ? "pista" : "rincon" }, notas);
  const piezasNuevas = final.nodos.length - escena.nodos.length;
  return { escena: final, resumen: [`Evento ${a.tipo_evento} (${alcance}): ${salon.resumen} ${piezasNuevas} piezas nuevas con globos ${estilo === "organico" ? "orgánicos" : "clásicos"}.`, ...new Set(notas)].join(" ") };
}

export const HERRAMIENTAS_EVENTO: Readonly<Record<string, HerramientaExtra>> = {
  planificar_evento: {
    esquema: EventoSchema,
    descripcion: "Para pedidos de un EVENTO NUEVO o un SALÓN (boda, XV años, cumpleaños, baby shower, bautizo, evento corporativo; «el salón completo», «solo la decoración», «un rincón de postres»): ÚSALA PRIMERO, en una sola llamada. Arma el salón (mesas con sillas en cuadrícula con pasillos, mesa principal, pista, postres, entrada, dentro de una sala que agranda a lo necesario), el fondo de fotos con arco, columnas y guirnalda, el arco de la entrada, un centro de mesa en cada mesa y el techo de la pista (en un rincón, un grupito de globos sobre su mesa), con los colores del pedido; conserva lo que ya había. Después afina con las herramientas chicas: ajustar_salon, mover_zona, quitar_zona, decorar_mesas / cambiar_centros, techo_por_zona. alcance: solo_decoracion (sin mesas ni techo), rincon (pocas mesas) o salon.",
    aplicar: planificar,
  },
};
