/** Motivos por los que una persona califica mal (o regular) un turno de la IA; lista editable, la UI y el panel la comparten. */
export const MOTIVOS = [
  { id: "no_entendio", etiqueta: "No entendió lo que pedí" },
  { id: "cambio_de_mas", etiqueta: "Cambió cosas que no pedí" },
  { id: "falto_algo", etiqueta: "Faltó algo" },
  { id: "mal_colocado", etiqueta: "Quedó mal colocado" },
  { id: "colores", etiqueta: "Colores incorrectos" },
  { id: "tamanos", etiqueta: "Tamaños o proporciones" },
  { id: "feo", etiqueta: "Se ve feo o poco realista" },
  { id: "foto_no_coincide", etiqueta: "La foto realista no coincide" },
  { id: "lento", etiqueta: "Muy lento" },
  { id: "otra", etiqueta: "Otra" },
] as const;

export type MotivoId = (typeof MOTIVOS)[number]["id"];

export const MOTIVO_IDS = MOTIVOS.map((motivo) => motivo.id) as [MotivoId, ...MotivoId[]];

const ETIQUETAS: ReadonlyMap<string, string> = new Map(MOTIVOS.map((motivo) => [motivo.id, motivo.etiqueta]));

export function etiquetaDeMotivo(id: string): string {
  return ETIQUETAS.get(id) ?? id;
}
