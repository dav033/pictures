import type { Brief, ChatMessage } from "@/lib/types";
import { sugerenciaEscena, type NivelCreatividad, type SugerenciaEscena } from "../escena/creatividad";
import { escenaEspecificada } from "../escena/visual-context";

/**
 * Scene suggestion for one /api/chat turn. Only the customer's messages count
 * as specified, and a venue photo attached to the turn is the venue and its
 * light (the same reading /api/generate uses), so it leaves nothing to suggest.
 */
export function sugerenciaEscenaDelTurno(input: {
  nivel: NivelCreatividad;
  mensajes: ReadonlyArray<Pick<ChatMessage, "role" | "content">>;
  brief?: Brief;
  fotoEspacio: boolean;
  aleatorio?: () => number;
}): SugerenciaEscena | undefined {
  const textoCliente = input.mensajes.filter((mensaje) => mensaje.role === "user").map((mensaje) => mensaje.content).join(" ");
  return sugerenciaEscena(input.nivel, escenaEspecificada(textoCliente, input.brief ?? {}, { fotoEspacio: input.fotoEspacio }), input.aleatorio);
}
