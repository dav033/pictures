import { MOTIVOS, type MotivoId } from "@/lib/feedback-ia/motivos";
import type { TemaCalificacion } from "./temas";

/** Motivos que solo tienen sentido en el taller de piezas 3D: el cliente de los chats no ve «quedó mal colocado». */
const SOLO_TALLER: ReadonlySet<MotivoId> = new Set(["mal_colocado", "foto_no_coincide"]);

/** Los motivos que se ofrecen: el Taller, todos; el chat del cliente, sin los del taller (la foto realista solo si el chat generó una imagen). */
export function motivosVisibles(tema: TemaCalificacion, { conImagen = false }: { conImagen?: boolean } = {}): readonly (typeof MOTIVOS)[number][] {
  if (tema === "taller") return MOTIVOS;
  return MOTIVOS.filter((m) => !SOLO_TALLER.has(m.id) || (m.id === "foto_no_coincide" && conImagen));
}
