"use client";

import { useState } from "react";
import type { ItemListadoFeedback } from "@/lib/feedback-ia/contrato";
import { etiquetaDeMotivo } from "@/lib/feedback-ia/motivos";
import { AccesoAdminFeedback } from "./AccesoAdminFeedback";
import { AnalisisFeedbackPanel } from "./AnalisisFeedbackPanel";
import { DetalleFeedbackIa } from "./DetalleFeedbackIa";
import { FiltrosFeedback } from "./FiltrosFeedback";
import { useFeedbackAdmin } from "./useFeedbackAdmin";

const NOMBRE_PRODUCTO = { taller: "Taller 3D", cliente: "Chat del cliente" } as const;

function colorDeNota(nota: number | null): string {
  if (nota === null) return "bg-superficie-2 text-texto-suave";
  if (nota <= 4) return "bg-error-suave text-error";
  if (nota <= 7) return "bg-aviso-suave text-aviso";
  return "bg-exito-suave text-exito";
}

function Fila({ item, abierta, onAlternar }: { item: ItemListadoFeedback; abierta: boolean; onAlternar: () => void }) {
  return (
    <li className="rounded-xl border border-borde bg-superficie">
      <button type="button" aria-expanded={abierta} onClick={onAlternar} className="flex w-full items-start gap-3 p-3 text-left">
        <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg text-sm font-semibold ${colorDeNota(item.calificacion)}`}>
          {item.calificacion ?? "–"}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-texto">{item.pedido || "(sin pedido guardado)"}</span>
          <span className="mt-0.5 block truncate text-xs text-texto-suave">
            {NOMBRE_PRODUCTO[item.producto]} · {new Date(item.creadoEn).toLocaleString("es")}
            {item.deshecho && " · deshecho"}
            {item.herramientas.length > 0 && ` · ${item.herramientas.join(", ")}`}
          </span>
          {item.motivos.length > 0 && (
            <span className="mt-1 flex flex-wrap gap-1">
              {item.motivos.map((motivo) => <span key={motivo} className="rounded-full bg-superficie-2 px-2 py-0.5 text-[11px] text-texto-suave">{etiquetaDeMotivo(motivo)}</span>)}
            </span>
          )}
          {item.comentario && <span className="mt-1 line-clamp-2 block text-xs text-texto">{item.comentario}</span>}
        </span>
        <span className="shrink-0 text-xs text-texto-suave">{abierta ? "Cerrar" : "Ver"}</span>
      </button>
      {abierta && (
        <div className="border-t border-borde p-3">
          <DetalleFeedbackIa id={item.id} />
        </div>
      )}
    </li>
  );
}

export function FeedbackIaTab() {
  const panel = useFeedbackAdmin();
  const [abierta, setAbierta] = useState<number | null>(null);

  if (panel.acceso !== "abierto") return <AccesoAdminFeedback acceso={panel.acceso} error={panel.error} onIngresar={panel.ingresar} />;

  return (
    <div>
      <AnalisisFeedbackPanel analisis={panel.analisis} analizando={panel.analizando} onAnalizar={panel.analizarAhora} />
      <FiltrosFeedback filtros={panel.filtros} onCambio={panel.setFiltros} onAplicar={panel.aplicarFiltros} onLimpiar={panel.limpiarFiltros} total={panel.total} />

      {panel.error && <p role="alert" className="mb-3 rounded-lg bg-error-suave px-3 py-2 text-xs text-error">{panel.error}</p>}

      {panel.items.length === 0 && !panel.cargando ? (
        <p className="rounded-xl border border-dashed border-borde p-6 text-center text-sm text-texto-suave">
          Todavía no hay calificaciones con estos filtros.
        </p>
      ) : (
        <ul className="space-y-2">
          {panel.items.map((item) => (
            <Fila key={item.id} item={item} abierta={abierta === item.id} onAlternar={() => setAbierta(abierta === item.id ? null : item.id)} />
          ))}
        </ul>
      )}

      {panel.cargando && <p className="mt-3 text-xs text-texto-suave">Cargando…</p>}
      {!panel.cargando && panel.items.length < panel.total && (
        <button type="button" className="ui-button-secondary mt-3" onClick={panel.cargarMas}>Cargar más ({panel.total - panel.items.length} restantes)</button>
      )}
    </div>
  );
}
