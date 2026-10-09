"use client";

import { useEffect, useState } from "react";
import type { DetalleFeedback, ErrorFeedback } from "@/lib/feedback-ia/contrato";
import { hayCambios } from "@/lib/feedback-ia/diferencia-escena";
import { mensajeErrorCliente } from "@/lib/estado/mensaje-error-cliente";

const TITULO = "mb-1 text-[11px] font-semibold uppercase tracking-wide text-texto-suave";
const MAX_JSON_MOSTRADO = 20_000;

function Captura({ titulo, url }: { titulo: string; url: string | null }) {
  return (
    <figure className="min-w-0">
      <figcaption className={TITULO}>{titulo}</figcaption>
      {url ? (
        <a href={url} target="_blank" rel="noreferrer">
          {/* eslint-disable-next-line @next/next/no-img-element -- la captura la sirve nuestra ruta de administrador, no un origen optimizable */}
          <img src={url} alt={titulo} className="aspect-video w-full rounded-lg border border-borde bg-superficie-2 object-contain" loading="lazy" />
        </a>
      ) : (
        <div className="grid aspect-video place-items-center rounded-lg border border-dashed border-borde text-xs text-texto-suave">Sin captura</div>
      )}
    </figure>
  );
}

function Texto({ titulo, texto }: { titulo: string; texto: string | null }) {
  return (
    <div>
      <h4 className={TITULO}>{titulo}</h4>
      <p className="whitespace-pre-wrap break-words text-sm text-texto">{texto || <span className="text-texto-suave">—</span>}</p>
    </div>
  );
}

function jsonCorto(valor: unknown): string {
  const texto = JSON.stringify(valor, null, 2) ?? "";
  return texto.length > MAX_JSON_MOSTRADO ? `${texto.slice(0, MAX_JSON_MOSTRADO)}\n… (recortado; exporta el JSON completo)` : texto;
}

function Diferencia({ detalle }: { detalle: DetalleFeedback }) {
  const d = detalle.diferencia;
  if (!d) return <p className="text-xs text-texto-suave">No hay escenas de antes y después para comparar.</p>;
  if (!hayCambios(d)) return <p className="text-xs text-texto-suave">La escena no cambió.</p>;
  return (
    <ul className="space-y-0.5 text-xs text-texto">
      {d.agregados.length > 0 && <li><span className="text-exito">+ Agregadas ({d.agregados.length}):</span> {d.agregados.join(", ")}</li>}
      {d.quitados.length > 0 && <li><span className="text-error">− Quitadas ({d.quitados.length}):</span> {d.quitados.join(", ")}</li>}
      {d.modificados.map((m) => <li key={m.id}><span className="text-aviso">~ {m.id}:</span> {m.campos.join(", ")}</li>)}
      {d.otros.length > 0 && <li><span className="text-texto-suave">Otros cambios:</span> {d.otros.join(", ")}</li>}
    </ul>
  );
}

function Pasos({ detalle }: { detalle: DetalleFeedback }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div>
        <h4 className={TITULO}>Pasos y herramientas de la auditoría</h4>
        {detalle.pasos.length === 0 ? (
          <p className="text-xs text-texto-suave">No quedó auditoría de este turno.</p>
        ) : (
          <ol className="max-h-64 space-y-1 overflow-auto text-xs">
            {detalle.pasos.map((paso, i) => (
              <li key={`${paso.ts}-${i}`} className="rounded-md bg-superficie-2 px-2 py-1">
                <span className="font-medium text-texto">{paso.nombre}</span>
                <span className="ml-1 text-texto-suave">({paso.tipo}{paso.ms !== undefined ? `, ${paso.ms} ms` : ""})</span>
                <div className="break-words text-texto-suave">{paso.resumen}</div>
              </li>
            ))}
          </ol>
        )}
      </div>
      <div>
        <h4 className={TITULO}>Llamadas a modelos (ai_call_log)</h4>
        {detalle.llamadasIa.length === 0 ? (
          <p className="text-xs text-texto-suave">Sin llamadas registradas para esta solicitud.</p>
        ) : (
          <table className="w-full text-left text-xs">
            <thead className="text-texto-suave"><tr><th className="py-1">Capacidad</th><th>Modelo</th><th>Herramienta</th><th>ms</th><th>US$</th></tr></thead>
            <tbody>
              {detalle.llamadasIa.map((llamada, i) => (
                <tr key={i} className="border-t border-borde">
                  <td className="py-1">{llamada.capacidad}</td><td>{llamada.modelo}</td><td>{llamada.herramienta ?? "—"}</td><td>{llamada.ms}</td><td>{llamada.costeEstimadoUsd ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export function DetalleFeedbackIa({ id }: { id: number }) {
  const [detalle, setDetalle] = useState<DetalleFeedback | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vigente = true;
    fetch(`/api/feedback-ia/admin/${id}`)
      .then(async (respuesta) => {
        const cuerpo: unknown = await respuesta.json();
        if (!respuesta.ok) throw new Error((cuerpo as ErrorFeedback).error);
        return cuerpo as DetalleFeedback;
      })
      .then((datos) => { if (vigente) setDetalle(datos); })
      .catch((causa) => { if (vigente) setError(mensajeErrorCliente(causa, "No se pudo cargar el detalle.")); });
    return () => { vigente = false; };
  }, [id]);

  if (error) return <p className="text-xs text-error">{error}</p>;
  if (!detalle) return <p className="text-xs text-texto-suave">Cargando detalle…</p>;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Captura titulo="Antes" url={detalle.imagenAntesUrl} />
        <Captura titulo="Después" url={detalle.imagenDespuesUrl} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Texto titulo="Lo que pidió la persona" texto={detalle.pedido} />
        <Texto titulo="Respuesta de la IA" texto={detalle.respuesta} />
      </div>
      <Texto titulo="Falencias y mejoras (comentario)" texto={detalle.comentario} />
      <div>
        <h4 className={TITULO}>Diferencia de la escena</h4>
        <Diferencia detalle={detalle} />
      </div>
      <Pasos detalle={detalle} />
      <p className="text-xs text-texto-suave">
        Modelo {detalle.modelo ?? "—"} · {detalle.latenciaMs ?? "—"} ms · US$ {detalle.costeUsd ?? "—"} · versión {detalle.versionApp ?? "—"} · usuario {detalle.usuarioId} · actualizado {new Date(detalle.actualizadoEn).toLocaleString("es")}
        {detalle.solicitudId && ` · solicitud ${detalle.solicitudId}`}
      </p>
      {(detalle.escenaAntes || detalle.escenaDespues) && (
        <details className="text-xs">
          <summary className="cursor-pointer text-texto-suave">Escenas completas (JSON)</summary>
          <div className="mt-2 grid gap-3 lg:grid-cols-2">
            <pre className="max-h-72 overflow-auto rounded-md bg-superficie-2 p-2">{jsonCorto(detalle.escenaAntes)}</pre>
            <pre className="max-h-72 overflow-auto rounded-md bg-superficie-2 p-2">{jsonCorto(detalle.escenaDespues)}</pre>
          </div>
        </details>
      )}
    </div>
  );
}
