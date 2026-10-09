import type { ProductoFeedback } from "@/lib/feedback-ia/contrato";
import type { MotivoId } from "@/lib/feedback-ia/motivos";

export type FiltrosPanel = {
  producto: "" | ProductoFeedback;
  minimo: string;
  maximo: string;
  motivo: "" | MotivoId;
  desde: string;
  hasta: string;
  texto: string;
  soloDeshechos: boolean;
  incluirSinCalificar: boolean;
};

export const FILTROS_INICIALES: FiltrosPanel = {
  producto: "",
  minimo: "",
  maximo: "",
  motivo: "",
  desde: "",
  hasta: "",
  texto: "",
  soloDeshechos: false,
  incluirSinCalificar: false,
};

/** Query string de GET /api/feedback-ia/admin con solo los filtros que tienen valor. */
export function consultaDeFiltros(filtros: FiltrosPanel, extra: Record<string, string> = {}): string {
  const parametros = new URLSearchParams();
  if (filtros.producto) parametros.set("producto", filtros.producto);
  if (filtros.minimo) parametros.set("minimo", filtros.minimo);
  if (filtros.maximo) parametros.set("maximo", filtros.maximo);
  if (filtros.motivo) parametros.set("motivo", filtros.motivo);
  if (filtros.desde) parametros.set("desde", filtros.desde);
  if (filtros.hasta) parametros.set("hasta", filtros.hasta);
  if (filtros.texto.trim()) parametros.set("texto", filtros.texto.trim());
  if (filtros.soloDeshechos) parametros.set("deshecho", "1");
  if (filtros.incluirSinCalificar) parametros.set("sinCalificar", "1");
  for (const [clave, valor] of Object.entries(extra)) parametros.set(clave, valor);
  return parametros.toString();
}
