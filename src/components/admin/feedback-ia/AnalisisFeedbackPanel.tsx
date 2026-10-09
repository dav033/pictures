"use client";

import type { AnalisisFeedback, ConteoPorClave } from "@/lib/feedback-ia/contrato";
import { etiquetaDeMotivo } from "@/lib/feedback-ia/motivos";

type Props = {
  analisis: AnalisisFeedback | null;
  analizando: boolean;
  onAnalizar: (dias: number, conResumen: boolean) => void;
};

const NOMBRE_PRODUCTO: Record<string, string> = { taller: "Taller 3D", cliente: "Chat del cliente" };

function Lista({ titulo, conteos, nombre }: { titulo: string; conteos: ConteoPorClave[]; nombre: (clave: string) => string }) {
  return (
    <div>
      <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-texto-suave">{titulo}</h3>
      {conteos.length === 0 ? (
        <p className="text-xs text-texto-suave">Sin datos.</p>
      ) : (
        <ul className="space-y-0.5 text-xs text-texto">
          {conteos.slice(0, 6).map((conteo) => (
            <li key={conteo.clave} className="flex justify-between gap-2">
              <span className="truncate">{nombre(conteo.clave)}</span>
              <span className="shrink-0 text-texto-suave">{conteo.total} · prom. {conteo.promedio ?? "—"}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Huecos recurrentes del último análisis (cron semanal o a pedido), arriba del listado. */
export function AnalisisFeedbackPanel({ analisis, analizando, onAnalizar }: Props) {
  return (
    <section className="mb-4 rounded-xl border border-borde bg-superficie p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-texto-suave">Huecos recurrentes de la IA</h2>
        <div className="flex gap-2">
          <button type="button" className="ui-button-secondary" disabled={analizando} onClick={() => onAnalizar(7, false)}>
            {analizando ? "Analizando…" : "Analizar 7 días"}
          </button>
          <button type="button" className="ui-button-secondary" disabled={analizando} onClick={() => onAnalizar(7, true)} title="Redacta un resumen con Gemini Flash (menos de US$0,02)">
            Con resumen de IA
          </button>
        </div>
      </div>

      {!analisis ? (
        <p className="text-xs text-texto-suave">Todavía no hay análisis. Se genera cada semana o con los botones de arriba.</p>
      ) : (
        <>
          <p className="mb-2 text-xs text-texto-suave">
            Últimos {analisis.dias} días, del {new Date(analisis.desde).toLocaleDateString("es")} al {new Date(analisis.hasta).toLocaleDateString("es")} ({analisis.origen}):{" "}
            {analisis.totalCalificados} calificados de {analisis.totalTurnos} turnos, promedio {analisis.promedio ?? "—"}
            {analisis.metricas.deshechos > 0 && `, ${analisis.metricas.deshechos} deshechos`}.
          </p>
          {analisis.resumen && (
            <div className="mb-3 rounded-lg bg-acento-suave p-3">
              <p className="whitespace-pre-line text-sm text-texto">{analisis.resumen}</p>
              <p className="mt-1 text-[11px] text-texto-suave">Resumen de {analisis.resumenModelo} · US$ {analisis.resumenCosteUsd ?? "—"}</p>
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-3">
            <Lista titulo="Motivos más repetidos" conteos={analisis.metricas.porMotivo} nombre={etiquetaDeMotivo} />
            <Lista titulo="Peor calificadas: herramientas" conteos={analisis.metricas.porHerramienta} nombre={(clave) => clave} />
            <Lista titulo="Por producto" conteos={analisis.metricas.porProducto} nombre={(clave) => NOMBRE_PRODUCTO[clave] ?? clave} />
          </div>
          {analisis.metricas.frases.length > 0 && (
            <p className="mt-3 text-xs text-texto-suave">
              Frases frecuentes en los comentarios:{" "}
              {analisis.metricas.frases.slice(0, 10).map((f) => `${f.frase} (${f.veces})`).join(" · ")}
            </p>
          )}
          {analisis.metricas.peores.length > 0 && (
            <div className="mt-3">
              <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-texto-suave">Peores ejemplos</h3>
              <ul className="space-y-0.5 text-xs text-texto">
                {analisis.metricas.peores.map((ejemplo) => (
                  <li key={ejemplo.id} className="truncate">
                    <span className="font-medium">{ejemplo.calificacion}</span> · {NOMBRE_PRODUCTO[ejemplo.producto]} · {ejemplo.pedido ?? ejemplo.turnoId}
                    {ejemplo.comentario && <span className="text-texto-suave"> — {ejemplo.comentario}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  );
}
