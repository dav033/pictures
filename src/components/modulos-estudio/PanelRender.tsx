"use client";

import { Download, Loader2, Sparkles, Trash2 } from "lucide-react";
import { COSTE_FOTO_USD, TIEMPO_FOTO } from "@/lib/globos3d/foto-realista";
import type { EstadoRender } from "./useRenderModulo";

/**
 * El botón del render con IA y lo que promete: si ya está guardado (gratis, sin llamar a nadie), si hay que generarlo
 * (cuánto cuesta y cuánto tarda, y que se guarda para la próxima vez) o si el caché no está disponible (se genera igual,
 * pero no se conserva). Nunca dispara una generación por sí sola.
 */
const precio = `≈ US$${COSTE_FOTO_USD.toLocaleString("es-CO", { minimumFractionDigits: 2 })}`;

export function PanelRender({ estado, base, puedeEscribir, viendoRender, onGenerar, onVerRender, onDescartar }: {
  estado: EstadoRender;
  /** Lo que dijo el caché antes de un error o de generar: define qué ofrece el botón al reintentar. */
  base: EstadoRender | null;
  /** Si esta sesión puede generar y descartar renders (`null` mientras el servidor no lo ha dicho). */
  puedeEscribir: boolean | null;
  viendoRender: boolean;
  onGenerar: () => void;
  onVerRender: () => void;
  onDescartar: () => void;
}) {
  const ocupado = estado.fase === "consultando" || estado.fase === "generando";
  const sinCache = estado.fase === "sin_cache" || (estado.fase === "error" && base?.fase === "sin_cache");
  const gratis = estado.fase === "guardado" || estado.fase === "lista";
  const soloLectura = puedeEscribir === false && !gratis;
  const guardadoEnCache = estado.fase === "guardado" || (estado.fase === "lista" && estado.guardada);
  const urlDescarga = estado.fase === "guardado" || estado.fase === "lista" ? estado.url : null;

  const etiqueta = ocupado ? (estado.fase === "generando" ? "Generando el render…" : "Revisando el caché…")
    : gratis ? (viendoRender ? "Render guardado" : "Ver el render guardado")
    : estado.fase === "error" ? "Intentar de nuevo" : "Generar render con IA";
  const nota = soloLectura ? "Todavía no hay un render de esta combinación. Solo el equipo puede generar renders nuevos."
    : estado.fase === "generando" ? `Tarda ${TIEMPO_FOTO}. No cierres la página.`
    : estado.fase === "consultando" ? "Buscando si esta combinación ya está hecha."
    : gratis ? (estado.fase === "lista" && !estado.guardada ? "Listo, pero no se pudo guardar: la próxima vez se generará de nuevo." : "Gratis · ya estaba hecho, no se vuelve a generar.")
    : sinCache ? `${precio} · ${TIEMPO_FOTO} · el caché no está disponible: este render no se guardará.`
    : `${precio} · ${TIEMPO_FOTO} · se guarda para que la próxima vez sea gratis.`;

  return (
    <section aria-labelledby="titulo-render" className="flex flex-col gap-3 rounded-2xl bg-superficie p-4 ring-1 ring-borde">
      <h2 id="titulo-render" className="text-sm font-semibold text-texto">Render con IA</h2>
      <button
        type="button"
        disabled={ocupado || soloLectura || (gratis && viendoRender)}
        onClick={gratis ? onVerRender : onGenerar}
        className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-acento px-4 text-sm font-semibold text-sobre-acento transition-colors hover:bg-acento-hover disabled:cursor-not-allowed disabled:opacity-60"
      >
        {ocupado ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Sparkles className="size-4" aria-hidden />}
        {etiqueta}
      </button>
      <p className="text-xs leading-relaxed text-texto-suave" aria-live="polite">{nota}</p>
      {estado.fase === "error" && <p role="alert" className="rounded-lg bg-error-suave px-3 py-2 text-xs text-error">{estado.mensaje}</p>}
      {estado.fase === "lista" && estado.avisos.length > 0 && (
        <ul className="list-disc pl-4 text-xs text-aviso">{estado.avisos.map((a) => <li key={a}>{a}</li>)}</ul>
      )}
      {puedeEscribir === true && guardadoEnCache && (
        <button
          type="button"
          onClick={() => { if (window.confirm("¿Descartar este render guardado? Se borra y se podrá generar de nuevo (cuesta una imagen).")) onDescartar(); }}
          className="inline-flex min-h-10 items-center gap-1.5 self-start rounded-full px-3 text-xs font-medium text-error ring-1 ring-borde hover:bg-error-suave"
        >
          <Trash2 className="size-3.5" aria-hidden /> Descartar este render
        </button>
      )}
      {urlDescarga && (
        <a href={urlDescarga} download="modulo-globos" className="inline-flex items-center gap-1.5 self-start text-xs font-medium text-acento hover:underline">
          <Download className="size-3.5" aria-hidden /> Descargar la imagen
        </a>
      )}
    </section>
  );
}
