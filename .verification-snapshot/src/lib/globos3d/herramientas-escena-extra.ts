import { z } from "zod";
import { paraGoogleSchema } from "@/lib/ia/nucleo/esquema-google";
import type { Escena } from "./escena";
import { HERRAMIENTAS_CENTROS } from "./herramientas-escena-centros";
import { HERRAMIENTAS_DISPOSICION } from "./herramientas-escena-disposicion";
import { HERRAMIENTA_FOTO, MODELAR_DESDE_FOTO } from "./herramientas-escena-foto";
import { HERRAMIENTAS_GRUPOS, type HerramientaExtra } from "./herramientas-escena-grupos";
import { HERRAMIENTAS_MESAS } from "./herramientas-escena-mesas";
import { HERRAMIENTAS_MOBILIARIO } from "./herramientas-escena-mobiliario";
import { HERRAMIENTAS_EVENTO } from "./herramientas-escena-evento";
import { HERRAMIENTAS_TECHO_ZONA } from "./herramientas-escena-techo-zona";
import { HERRAMIENTAS_PINTAR } from "./herramientas-escena-pintar";
import { HERRAMIENTAS_REMATE } from "./herramientas-escena-remate";
import { HERRAMIENTAS_SALON } from "./herramientas-escena-salon";

/**
 * **Herramientas de la IA de escena que viven fuera de herramientas-escena.ts** (2026-10-08): para no seguir
 * engordando ese archivo, cada familia nueva se registra aquí con su esquema Zod, su descripción y su `aplicar`;
 * herramientas-escena.ts las suma a `DECLARACIONES_ESCENA` y las despacha en `aplicarHerramienta`.
 * - grupos (herramientas-escena-grupos.ts): seleccionar_grupo, contar_globos;
 * - disposición (herramientas-escena-disposicion.ts): alinear, distribuir, espejar;
 * - remate (herramientas-escena-remate.ts): poner_remate, el globo de arriba de las columnas;
 * - pintar (herramientas-escena-pintar.ts): pintar_en_malla, una letra o figura pintada dentro de una pared de globos;
 * - mobiliario (herramientas-escena-mobiliario.ts): agregar_mobiliario, sillas, mesas y fondos que no son globos (en fila o alrededor de una mesa);
 * - salón de eventos (herramientas-escena-salon.ts y -evento.ts, REQ-008): armar_salon, ajustar_salon, mover_zona, quitar_zona y el composite planificar_evento;
 * - centros (herramientas-escena-centros.ts): decorar_mesas, completar_centros, cambiar_centros, quitar_centros, el centro de mesa de cada mesa;
 * - techo por zona (herramientas-escena-techo-zona.ts): techo_por_zona, festones, red, helio o tiras sobre un rectángulo, una pieza o toda la sala;
 * - mesas (herramientas-escena-mesas.ts): agregar_mesas, cambiar_sillas, cambiar_mesas, N mesas de cualquier tipo con M sillas cada una, desacopladas;
 * - foto (herramientas-escena-foto.ts): modelar_desde_foto, aplica la foto adjunta leída por la IA de visión (la atiende la ruta);
 * - preguntar_usuario: la ruta corta el turno y el taller muestra la pregunta con sus opciones como botones.
 */

/** Nombre de la herramienta con la que la IA pregunta (la ruta la reconoce y termina el turno). */
export const PREGUNTAR_USUARIO = "preguntar_usuario";

const PreguntaSchema = z.object({
  pregunta: z.string().min(3).max(240).describe("la pregunta, corta y en español («¿Cuál columna: la izquierda o la derecha?»)"),
  opciones: z.array(z.string().min(1).max(80)).min(2).max(4).describe("2 a 4 respuestas posibles, cada una lista para mandarse tal cual como el próximo pedido («la columna izquierda», «las dos»)"),
});
export type PreguntaUsuario = z.infer<typeof PreguntaSchema>;

/** La pregunta de una llamada a preguntar_usuario, o null si sus argumentos no valen. */
export function preguntaDe(argumentos: unknown): PreguntaUsuario | null {
  const r = PreguntaSchema.safeParse(argumentos ?? {});
  return r.success ? { pregunta: r.data.pregunta.trim(), opciones: [...new Set(r.data.opciones.map((o) => o.trim()).filter(Boolean))] } : null;
}

const PREGUNTAR: HerramientaExtra = {
  esquema: PreguntaSchema,
  descripcion: "Pregunta al usuario y TERMINA el turno: el taller muestra la pregunta con 2 a 4 opciones como botones (al tocar una, su texto llega como el próximo pedido). Solo si dos o más piezas encajan con lo pedido y no hay pieza elegida ni nombrada; nunca para algo que puedas suponer.",
  aplicar: (escena: Escena, argumentos: unknown) => {
    const a = PreguntaSchema.parse(argumentos ?? {});
    return { escena, consulta: true, resumen: `Pregunta al usuario: ${a.pregunta} (${a.opciones.join(" | ")})` };
  },
};

export const HERRAMIENTAS_EXTRA: Readonly<Record<string, HerramientaExtra>> = { ...HERRAMIENTAS_GRUPOS, ...HERRAMIENTAS_DISPOSICION, ...HERRAMIENTAS_REMATE, ...HERRAMIENTAS_PINTAR, ...HERRAMIENTAS_MOBILIARIO, ...HERRAMIENTAS_MESAS, ...HERRAMIENTAS_CENTROS, ...HERRAMIENTAS_TECHO_ZONA, ...HERRAMIENTAS_SALON, ...HERRAMIENTAS_EVENTO, [PREGUNTAR_USUARIO]: PREGUNTAR, [MODELAR_DESDE_FOTO]: HERRAMIENTA_FOTO };
export const NOMBRES_EXTRA = Object.keys(HERRAMIENTAS_EXTRA);

/** Las declaraciones para Gemini de las herramientas extra (mismo formato que `DECLARACIONES_ESCENA`). */
export function declaracionesExtra(): Array<{ name: string; description: string; parametersJsonSchema: Record<string, unknown> }> {
  return NOMBRES_EXTRA.map((nombre) => ({
    name: nombre,
    description: HERRAMIENTAS_EXTRA[nombre]!.descripcion,
    parametersJsonSchema: paraGoogleSchema(z.toJSONSchema(HERRAMIENTAS_EXTRA[nombre]!.esquema, { target: "draft-7" })) as Record<string, unknown>,
  }));
}
