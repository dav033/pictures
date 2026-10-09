import { z } from "zod";
import { armarEscena, type Escena } from "./escena";
import type { HerramientaExtra } from "./herramientas-escena-grupos";
import { coloresDeMuebles } from "./herramientas-escena-salon";
import { armarSalon } from "./salon-armar";
import { decorarSalon } from "./salon-decoracion";
import { ESTILOS_SALON } from "./salon-piezas";
import { type ArquetipoFondo, coloresDeTema, composicionDe } from "./salon-composicion";
import { ponerIdeasDeBiblioteca } from "./salon-ideas-biblioteca";
import { aforoDeMesas, falloDeMesas, falloDeSillas, MAX_INVITADOS_SALON, mesasNecesarias, TIPOS_MESA_SALON } from "./salon-evento";
import { registroVivo, vivas } from "./salon-registro";
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
  tematica: z.string().min(2).max(60).optional().describe("el tema («safari», «Frozen», «boho»): decide el fondo y las ideas de la biblioteca"),
  variante: z.number().int().min(0).max(20).optional().describe("«dame otra»: 0 = la primera; 1, 2… = otra composición del mismo pedido"),
  texto: z.string().min(1).max(24).optional().describe("texto de las letras o número de foil («Ana», «15»)"),
  alcance: z.enum(ALCANCES_EVENTO).optional().describe("solo_decoracion: sin mesas; rincon: pocas mesas con postres; salon: la sala completa. Si falta: sin invitados = solo_decoracion, hasta 40 = rincon, más = salon"),
  invitados: z.number().int().min(1).max(MAX_INVITADOS_SALON).optional().describe("invitados (50–200 es lo típico); no hace falta con solo_decoracion"),
  colores: z.array(z.string().min(1).max(40)).max(3).optional().describe("los colores del evento («blanco», «dorado»): el primero, mantel y globos principales; el segundo, sillas y acentos"),
  estilo: z.enum(ESTILOS_SALON).optional().describe("organico (globos de varios tamaños, por defecto) o clasico (cuartetos)"),
  mesa: z.enum(TIPOS_MESA_SALON).optional().describe("redonda8 (por defecto), redonda10 o imperial"),
  sillas_por_mesa: z.number().int().optional().describe("sillas por mesa («mesas de 6» = 6): redonda 2–12, imperial par 4–20"),
  mesas: z.number().int().optional().describe("número EXACTO de mesas («6 mesas de 4»): aforo = mesas × sillas; manda sobre invitados"),
  ancho_cm: z.number().optional().describe("ancho del salón si lo dicen (300–3000); si no, se calcula"),
  fondo_cm: z.number().optional().describe("fondo del salón si lo dicen (300–3000)"),
  reemplazar: z.boolean().optional().describe("true: rehace el salón (solo sus piezas)"),
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

/** Una figura o letras de foil de la composición del fondo (su id empieza así: lo pone `decorarSalon`). */
const esFoilDelFondo = (n: { id: string }) => n.id.startsWith("salon-fondo-foil");

function planificar(escena: Escena, argumentos: unknown): { escena: Escena; resumen: string } {
  const a = EventoSchema.parse(argumentos ?? {});
  const notas: string[] = [];
  const mesa = a.mesa ?? "redonda8";
  const falloSillas = a.sillas_por_mesa === undefined ? null : falloDeSillas(mesa, a.sillas_por_mesa);
  if (falloSillas) fallar(falloSillas);
  const falloMesas = a.mesas === undefined ? null : falloDeMesas(a.mesas);
  if (falloMesas) fallar(falloMesas);
  // «6 mesas de 4»: con `mesas` el aforo es mesas × sillas y es lo que decide la escala.
  const aforo = a.mesas !== undefined ? aforoDeMesas(a.mesas, mesa, a.sillas_por_mesa) : a.invitados;
  const alcance = alcanceDe(a.alcance, aforo);
  const invitados = alcance === "solo_decoracion" ? 0 : aforo ?? INVITADOS_POR_DEFECTO[alcance];
  const estilo = a.estilo ?? "organico";
  if (alcance === "rincon" && mesasNecesarias(invitados, mesa, a.sillas_por_mesa) > 8) notas.push(`Un rincón lleva pocas mesas y son ${mesasNecesarias(invitados, mesa, a.sillas_por_mesa)}: para más de 8 mesas usa alcance salon.`);
  if (alcance === "solo_decoracion" && (a.invitados !== undefined || a.mesas !== undefined)) notas.push("Con solo_decoracion no se arman mesas: ignoré los invitados.");

  const colores = a.colores?.length ? a.colores : coloresDeTema(a.tipo_evento, a.tematica) ?? [];
  // «Otra opción»: el modelo solo ve texto, así que la variante vive en el registro del salón y sigue la cuenta solo si el pedido (ocasión, tema y alcance) es el mismo.
  const peticion = `${a.tipo_evento}|${(a.tematica ?? "").trim().toLowerCase()}|${alcance}`;
  const previo = registroVivo(escena);
  const variante = a.variante ?? (a.reemplazar && previo?.variante !== undefined && previo.peticion === peticion ? previo.variante + 1 : 0);
  const composicion = composicionDe({ tipo: a.tipo_evento, tematica: a.tematica, colores: a.colores, estilo, texto: a.texto, variante });
  if (variante >= composicion.opciones) notas.push(`Ya se acabaron las ${composicion.opciones} opciones de este pedido: la ${variante} repite la opción ${composicion.elegida} («${NOMBRE_COMPOSICION[composicion.fondo]}»).`);

  const intento = (reservaFondoCm: number | undefined) => {
    const locales: string[] = [];
    const salon = armarSalon(escena, {
      invitados, mesas: a.mesas, mesa, sillas: a.sillas_por_mesa, anchoCm: a.ancho_cm, fondoCm: a.fondo_cm, zonas: zonasDelEvento(a.tipo_evento, alcance), colores: coloresDeMuebles(a.colores, locales), reemplazar: a.reemplazar,
      ...(reservaFondoCm !== undefined ? { profundidadFondoCm: reservaFondoCm } : {}),
    }, locales);
    // Si el salón conservó decoración tuya en el fondo de fotos, esa es el fondo: no se le suma otra composición encima.
    const adoptada = vivas(salon.escena).some((v) => v.info.rol === "adoptada");
    let decorada = decorarSalon(salon.escena, zonasDeEscena(salon.escena), { colores, estilo, composicion, texto: a.texto, fondo: !adoptada, entrada: true }, locales);
    if (decorada.salon) decorada = { ...decorada, salon: { ...decorada.salon, variante, peticion } };
    return { salon, decorada, adoptada, locales };
  };
  let hecho = intento(undefined);
  // Las letras de foil van delante de la composición: si pasan del fondo de fotos que se reservó, las mesas (y la principal) se corren atrás y no se encaman.
  const letras = hecho.decorada.nodos.find(esFoilDelFondo);
  const reservado = hecho.decorada.salon?.profundidadFondoCm;
  if (letras && reservado !== undefined && invitados > 0) {
    const caja = armarEscena(hecho.decorada).porNodo.find((n) => n.id === letras.id)?.caja;
    const necesario = caja ? Math.ceil(caja.max.z + hecho.decorada.sala.fondoCm / 2 + 20) : 0;
    if (necesario > reservado) {
      try { hecho = intento(necesario); } catch (error) { hecho.locales.push(`Las letras de foil quedaron más cerca de las mesas de lo que debían: ${error instanceof Error ? error.message : String(error)}`); }
    }
  }
  notas.push(...hecho.locales);
  const { salon, adoptada } = hecho;
  let decorada = hecho.decorada;
  if (!adoptada) decorada = ponerIdeasDeBiblioteca(decorada, zonasDeEscena(decorada), { tipo: a.tipo_evento, tematica: a.tematica, semilla: composicion.semilla, colores, alFrente: alcance === "solo_decoracion" }, notas);
  if (decorada.nodos.length > MAX_NODOS) fallar(`El evento sumaría ${decorada.nodos.length} piezas y el máximo es ${MAX_NODOS}: usa menos zonas o menos invitados.`);
  // Centros de mesa y techo según la escala: solo_decoracion no lleva mesas (ni centros); el rincón, un grupito de globos sobre su mesa principal o de postres; el salón, festones sobre la pista; la composición «columnas y techo», globos sobre el fondo.
  const techos: TechoDelEvento[] = [...(alcance === "salon" ? ["pista" as const] : alcance === "rincon" ? ["rincon" as const] : []), ...(composicion.fondo === "columnas_techo" && !adoptada ? ["fondo" as const] : [])];
  const centros = alcance !== "solo_decoracion";
  const final = centros || techos.length ? decorarMesasYTecho(decorada, { colores, estilo, centros, techos }, notas) : decorada;
  const piezasNuevas = final.nodos.length - escena.nodos.length;
  return { escena: final, resumen: [`Evento ${a.tipo_evento}${a.tematica ? ` «${a.tematica}»` : ""} (${alcance}): ${salon.resumen} Fondo (opción ${variante}): ${NOMBRE_COMPOSICION[composicion.fondo]}. ${piezasNuevas} piezas nuevas con globos ${estilo === "organico" ? "orgánicos" : "clásicos"}.`, ...new Set(notas)].join(" ") };
}

const NOMBRE_COMPOSICION: Readonly<Record<ArquetipoFondo, string>> = {
  arco_columnas: "arco con columnas y guirnalda", pared_letras: "pared de globos con letras de foil", paneles_guirnalda: "guirnalda orgánica a lo ancho con racimos", semiarco_racimos: "semiarco con racimos",
  columnas_techo: "columnas altas con globos en el techo", mural: "mural de globos", figuras: "figuras de globos", aro_ramos: "aro con ramos de helio",
};

export const HERRAMIENTAS_EVENTO: Readonly<Record<string, HerramientaExtra>> = {
  planificar_evento: {
    esquema: EventoSchema,
    descripcion: "Para un EVENTO o una DECORACIÓN TEMÁTICA NUEVA (boda, XV, cumpleaños, baby shower, bautizo, graduación, Halloween, corporativo; «solo la decoración de safari», «un rincón de postres»): ÚSALA PRIMERO, en una llamada. Arma el salón (mesas con sillas, principal, pista, postres, entrada) y un fondo de fotos cuya composición sale de la tematica (palmeras, castillo, pared con letras, semiarco, mural, aro con ramos, columnas con techo, guirnalda; el arco con columnas es solo una), 1 a 3 ideas de la biblioteca, un centro en cada mesa y el techo de la pista, con los colores del pedido. Conserva lo que ya había.",
    aplicar: planificar,
  },
};
