import type { HappiaPackage } from "./tipos";

/**
 * Sin campo de precio ni reglas de escalado por invitado adicional en la API,
 * `base_guests` no es un límite duro confiable para excluir paquetes (hoy casi
 * todos los de cumpleaños comparten `base_guests: 10`, así que filtrar de
 * forma estricta dejaría la lista vacía para cualquier evento más grande).
 * Se usa solo para reordenar por cercanía — el candidato más parecido primero
 * — dejando que el LLM explique en su razón si el paquete cubre o no la
 * cantidad pedida.
 */
export function ordenarPorInvitados(paquetes: HappiaPackage[], invitados: number): HappiaPackage[] {
  return [...paquetes].sort(
    (a, b) => Math.abs(a.base_guests - invitados) - Math.abs(b.base_guests - invitados),
  );
}
