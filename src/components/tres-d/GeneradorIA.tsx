"use client";

import { useState } from "react";
import { Sparkles, LoaderCircle } from "lucide-react";
import { AMBIENTES_RENDER, AMBIENTE_POR_DEFECTO, type AmbienteRender } from "@/lib/globos3d/render-ia";
import type { AspectoCaptura } from "./escena-globos";

type Generada = { id: number; imagen: string; ambiente: AmbienteRender };

/**
 * «Generar imagen con IA»: captura lo que se ve en el visor y lo convierte en una foto realista con FLUX (la
 * decoración se conserva: forma, cantidades y colores; FLUX pone el látex real y el salón). Guarda las últimas 4
 * en la página; nada se guarda en el servidor.
 */
export function GeneradorIA({ capturar, descripcion }: { capturar: () => { datos: string; aspecto: AspectoCaptura } | null; descripcion: string }) {
  const [ambiente, setAmbiente] = useState<AmbienteRender>(AMBIENTE_POR_DEFECTO);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generadas, setGeneradas] = useState<Generada[]>([]);

  async function generar() {
    const captura = capturar();
    if (!captura) { setError("El visor 3D todavía no está listo."); return; }
    setCargando(true);
    setError(null);
    try {
      const respuesta = await fetch("/api/render-3d-imagen", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ render: captura.datos, descripcion, ambiente, aspecto: captura.aspecto }) });
      const datos = (await respuesta.json().catch(() => ({}))) as { imagen?: string; error?: string };
      if (!respuesta.ok || !datos.imagen) throw new Error(datos.error ?? "No pude generar la foto.");
      const imagen = datos.imagen;
      setGeneradas((actuales) => [{ id: Date.now(), imagen, ambiente }, ...actuales].slice(0, 4));
    } catch (causa) {
      setError(causa instanceof Error ? causa.message : "No pude generar la foto.");
    } finally {
      setCargando(false);
    }
  }

  return (
    <section className="flex flex-col gap-3 rounded-2xl bg-superficie p-3 ring-1 ring-borde" aria-label="Imagen con IA">
      <div className="flex flex-wrap items-end gap-2">
        <label htmlFor="ambiente-ia" className="grid gap-1 text-xs text-texto-suave">
          Lugar
          <select id="ambiente-ia" value={ambiente} onChange={(e) => setAmbiente(e.target.value as AmbienteRender)} className="min-h-11 rounded-xl bg-superficie px-3 text-sm text-texto ring-1 ring-borde">
            {AMBIENTES_RENDER.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
          </select>
        </label>
        <button type="button" onClick={() => void generar()} disabled={cargando}
          className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-acento px-4 text-sm font-semibold text-sobre-acento disabled:opacity-60">
          {cargando ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <Sparkles className="size-4" aria-hidden />}
          {cargando ? "Generando la foto… (20–40 s)" : "Generar imagen con IA"}
        </button>
        <p className="text-xs text-texto-suave">Usa lo que se ve en el visor (gíralo antes para elegir el ángulo).</p>
      </div>
      {error && <p role="alert" className="text-sm text-texto">{error}</p>}
      {generadas.length > 0 && (
        <div className="grid gap-2 sm:grid-cols-2">
          {generadas.map((g) => (
            <figure key={g.id} className="overflow-hidden rounded-xl ring-1 ring-borde">
              {/* eslint-disable-next-line @next/next/no-img-element -- imagen generada en data URL, no pasa por next/image */}
              <img src={g.imagen} alt="Foto generada con IA a partir del modelo 3D" className="block w-full" />
              <figcaption className="flex items-center justify-between px-2 py-1 text-xs text-texto-suave">
                {AMBIENTES_RENDER.find((a) => a.id === g.ambiente)?.nombre} · imagen de referencia creada con IA
                <a href={g.imagen} download={`globos-3d-${g.id}.jpg`} className="text-acento underline-offset-2 hover:underline">Descargar</a>
              </figcaption>
            </figure>
          ))}
        </div>
      )}
    </section>
  );
}
