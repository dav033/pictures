"use client";

import { useState, type FormEvent } from "react";
import { z } from "zod";
import type { EntradaCotizacionProfesional } from "@/lib/cotizacion/profesional";
import { MAX_SHARED_STILL_BYTES } from "@/lib/shared-quotes/contracts";
import { tomorrowInBogota } from "@/lib/shared-quotes/dates";
import { BTN } from "@/components/tres-d/ui-taller";

const CreateResponseSchema = z.object({
  path: z.string().startsWith("/cotizacion-compartida/"),
  validUntil: z.string(),
}).strict();

async function encodeJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("El navegador no pudo comprimir la imagen.")), "image/jpeg", quality);
  });
}

export async function compressSharedStill(png: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(png);
  const canvas = document.createElement("canvas");
  try {
    for (const scale of [1, 0.85, 0.7, 0.55]) {
      const longestSide = Math.max(bitmap.width, bitmap.height);
      const targetSide = Math.min(1200, Math.max(1, Math.round(longestSide * scale)));
      const ratio = targetSide / longestSide;
      canvas.width = Math.max(1, Math.round(bitmap.width * ratio));
      canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("El navegador no pudo preparar la imagen.");
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      for (const quality of [0.82, 0.68, 0.54]) {
        const compressed = await encodeJpeg(canvas, quality);
        if (compressed.size > 0 && compressed.size <= MAX_SHARED_STILL_BYTES) return compressed;
      }
    }
    throw new Error("La imagen de la escena supera el tamaño permitido.");
  } finally {
    bitmap.close();
    canvas.width = 0;
    canvas.height = 0;
  }
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") return reject(new Error("No se pudo preparar la imagen."));
      const separator = result.indexOf(",");
      if (separator < 0) return reject(new Error("No se pudo preparar la imagen."));
      resolve(result.slice(separator + 1));
    };
    reader.onerror = () => reject(new Error("No se pudo leer la imagen."));
    reader.readAsDataURL(blob);
  });
}

export function ShareQuoteControl({
  enabled,
  ready,
  sceneName,
  sceneKey,
  quoteInput,
  captureStill,
}: {
  enabled: boolean;
  ready: boolean;
  sceneName: string;
  sceneKey: string;
  quoteInput: EntradaCotizacionProfesional | null;
  captureStill: () => Promise<Blob>;
}) {
  const [open, setOpen] = useState(false);
  const [minimumDate, setMinimumDate] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function createLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ready || !quoteInput || !validUntil || submitting) return;
    setSubmitting(true);
    setError(null);
    setUrl(null);
    try {
      const still = await compressSharedStill(await captureStill());
      const response = await fetch("/api/taller/cotizaciones-compartidas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          sceneName,
          sceneKey,
          validUntil,
          quoteInput,
          stillBase64: await blobToBase64(still),
        }),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const parsedError = z.object({ message: z.string().optional() }).safeParse(body);
        throw new Error(parsedError.success && parsedError.data.message ? parsedError.data.message : "No pude crear el enlace.");
      }
      const parsed = CreateResponseSchema.parse(body);
      setUrl(new URL(parsed.path, window.location.origin).toString());
      setOpen(false);
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : "No pude crear el enlace.");
    } finally {
      setSubmitting(false);
    }
  }

  async function copyLink() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  function toggleForm() {
    if (!open) {
      const nextDate = tomorrowInBogota(new Date());
      setMinimumDate(nextDate);
      setValidUntil((current) => current && current >= nextDate ? current : nextDate);
    }
    setOpen(!open);
    setError(null);
  }

  if (!enabled) return null;
  return (
    <section aria-label="Compartir cotización para aprobación" className="mt-4 border-t border-borde-suave pt-3">
      <button type="button" className={BTN} disabled={!ready || submitting} onClick={toggleForm}>
        {submitting ? "Creando enlace…" : open ? "Cerrar enlace compartido" : "Compartir para aprobación"}
      </button>
      {!ready && <p className="mt-2 text-xs text-texto-suave">Espera a que el precio termine de calcularse antes de compartir.</p>}
      {open && (
        <form className="mt-3 flex flex-col gap-2" onSubmit={(event) => void createLink(event)}>
          <label htmlFor="quote-valid-until" className="text-sm font-medium">Cotización válida hasta</label>
          <input
            id="quote-valid-until"
            type="date"
            min={minimumDate}
            value={validUntil}
            onChange={(event) => setValidUntil(event.target.value)}
            required
            className="min-h-11 rounded-lg border border-borde-suave bg-superficie px-3 text-sm text-texto focus-visible:outline-2 focus-visible:outline-acento"
          />
          <p className="text-xs text-texto-suave">El enlace vence al terminar este día en Colombia.</p>
          <button type="submit" className={BTN} disabled={!ready || !minimumDate || submitting}>
            {submitting ? "Preparando escena y precio…" : "Crear enlace"}
          </button>
        </form>
      )}
      {error && <p role="alert" className="mt-2 text-sm text-error">{error}</p>}
      {url && (
        <div className="mt-3 flex flex-col gap-2">
          <label htmlFor="quote-share-url" className="text-sm font-medium">Enlace · válido hasta {validUntil}</label>
          <input id="quote-share-url" readOnly value={url} className="min-h-11 w-full rounded-lg border border-borde-suave bg-superficie px-3 text-xs text-texto" />
          <button type="button" className={BTN} onClick={() => void copyLink()}>{copied ? "Enlace copiado" : "Copiar enlace"}</button>
        </div>
      )}
    </section>
  );
}
