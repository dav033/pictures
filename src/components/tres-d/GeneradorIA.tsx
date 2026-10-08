"use client";

import { useEffect, useState } from "react";
import { Sparkles, LoaderCircle, Trash2 } from "lucide-react";
import { AMBIENTES_RENDER, AMBIENTE_POR_DEFECTO, type AmbienteRender } from "@/lib/globos3d/render-ia";
import type { AspectoCaptura } from "./escena-globos";
import { MAXIMO, borrarImagen, guardarImagen, leerImagenes, type ImagenGuardada } from "./imagenes-guardadas";
import { VisorFoto } from "./VisorFoto";

const fecha = new Intl.DateTimeFormat("es", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** «Mi escena · Igual al visor · 8 oct, 12:40». */
const tituloDe = (g: ImagenGuardada) => `${g.escena ? `${g.escena} · ` : ""}${AMBIENTES_RENDER.find((a) => a.id === g.ambiente)?.nombre ?? ""} · ${fecha.format(new Date(g.creada))}`;

/**
 * «Generar imagen con IA»: captura lo que se ve en el visor y lo convierte en una foto realista con FLUX (la
 * decoración se conserva: forma, cantidades y colores; FLUX pone el látex real y el salón). Cada foto queda guardada
 * en este navegador (`imagenes-guardadas.ts`, las últimas 40) y sigue ahí al volver; nada se guarda en el servidor.
 */
export function GeneradorIA({ capturar, descripcion, escena = "" }: { capturar: () => { datos: string; aspecto: AspectoCaptura } | null; descripcion: string; escena?: string }) {
  const [ambiente, setAmbiente] = useState<AmbienteRender>(AMBIENTE_POR_DEFECTO);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [generadas, setGeneradas] = useState<ImagenGuardada[]>([]);
  /** La foto abierta en grande (índice en `generadas`). */
  const [abierta, setAbierta] = useState<number | null>(null);

  useEffect(() => {
    let vivo = true;
    void leerImagenes().then((guardadas) => { if (vivo) setGeneradas((actuales) => [...actuales, ...guardadas.filter((g) => !actuales.some((a) => a.id === g.id))]); });
    return () => { vivo = false; };
  }, []);

  async function generar() {
    const captura = capturar();
    if (!captura) { setError("El visor 3D todavía no está listo."); return; }
    setCargando(true);
    setError(null);
    setAviso(null);
    try {
      const respuesta = await fetch("/api/render-3d-imagen", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ render: captura.datos, descripcion, ambiente, aspecto: captura.aspecto }) });
      const datos = (await respuesta.json().catch(() => ({}))) as { imagen?: string; error?: string };
      if (!respuesta.ok || !datos.imagen) throw new Error(datos.error ?? "No pude generar la foto.");
      const nueva: ImagenGuardada = { id: Date.now(), imagen: datos.imagen, ambiente, escena, creada: new Date().toISOString() };
      setGeneradas((actuales) => [nueva, ...actuales].slice(0, MAXIMO));
      if (!(await guardarImagen(nueva))) setAviso("Este navegador no dejó guardar la foto: descárgala para no perderla.");
    } catch (causa) {
      setError(causa instanceof Error ? causa.message : "No pude generar la foto.");
    } finally {
      setCargando(false);
    }
  }

  function borrar(id: number) {
    setAbierta(null);
    setGeneradas((actuales) => actuales.filter((g) => g.id !== id));
    void borrarImagen(id);
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
      {aviso && <p role="status" className="text-sm text-texto-suave">{aviso}</p>}
      {generadas.length > 0 && (
        <>
          <p className="text-xs text-texto-suave">Tus fotos ({generadas.length}) se guardan en este navegador: siguen aquí al volver. Las últimas {MAXIMO}.</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {generadas.map((g, i) => (
              <figure key={g.id} className="overflow-hidden rounded-xl ring-1 ring-borde">
                <button type="button" onClick={() => setAbierta(i)} aria-label={`Ver en grande: ${tituloDe(g)}`} className="block w-full cursor-zoom-in">
                  {/* eslint-disable-next-line @next/next/no-img-element -- imagen generada en data URL, no pasa por next/image */}
                  <img src={g.imagen} alt={`Foto generada con IA${g.escena ? ` de «${g.escena}»` : ""} a partir del modelo 3D`} className="block w-full" />
                </button>
                <figcaption className="flex items-center gap-2 px-2 py-1 text-xs text-texto-suave">
                  <span className="min-w-0 flex-1 truncate">{tituloDe(g)}</span>
                  <a href={g.imagen} download={`globos-3d-${g.id}.jpg`} className="text-acento underline-offset-2 hover:underline">Descargar</a>
                  <button type="button" onClick={() => borrar(g.id)} aria-label="Borrar esta foto" className="grid size-8 place-items-center rounded-lg hover:bg-superficie-suave"><Trash2 className="size-3.5" aria-hidden /></button>
                </figcaption>
              </figure>
            ))}
          </div>
        </>
      )}
      {abierta !== null && generadas[abierta] && (
        <VisorFoto fotos={generadas.map((g) => ({ id: g.id, imagen: g.imagen, titulo: tituloDe(g) }))} indice={abierta} onCambiar={setAbierta} onCerrar={() => setAbierta(null)} />
      )}
    </section>
  );
}
