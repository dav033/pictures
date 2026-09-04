"use client";

/* Fotos autenticadas del dataset; no usar next/image para conservar cookie de sesión. */
/* eslint-disable @next/next/no-img-element */

import * as Dialog from "@radix-ui/react-dialog";
import { AnimatePresence, motion } from "motion/react";
import { ImageIcon, ImageOff, TriangleAlert, X, ZoomIn } from "lucide-react";
import { useState } from "react";
import { VisorImagenCompleta } from "@/components/admin/VisorImagenCompleta";

export type ReferenciaEvidencia = {
  imageId: string;
  imageFile: string;
  sourceRef: string | null;
  caption: string;
  conceptVisible: boolean;
  visibleConceptCount: number;
  otherConceptCount: number;
  uncertainties: string[];
};

export type ReferenciasEvidenciaData = {
  conceptId: string;
  canonicalLabel: string;
  requestedSizeCode: string | null;
  records: ReferenciaEvidencia[];
};

type LoadState = "idle" | "loading" | "error" | "ready";

export function ReferenciasEntrenamientoModal({
  open,
  onClose,
  onRetry,
  loadState,
  error,
  data,
  productLabel,
  expectedCount,
}: {
  open: boolean;
  onClose: () => void;
  onRetry: () => void;
  loadState: LoadState;
  error: string | null;
  data: ReferenciasEvidenciaData | null;
  productLabel: string;
  expectedCount: number;
}) {
  const [selectedImage, setSelectedImage] = useState<{ src: string; alt: string } | null>(null);
  const [unavailableImages, setUnavailableImages] = useState<ReadonlySet<string>>(() => new Set());
  const records = data?.records ?? [];
  const announcement = loadState === "loading"
    ? "Cargando fotos de entrenamiento…"
    : loadState === "error"
      ? error ?? "No se pudieron cargar las referencias."
      : loadState === "ready"
        ? `${records.length} ${records.length === 1 ? "foto cargada" : "fotos cargadas"}.`
        : "";

  return (
    <>
      <Dialog.Root open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
        <AnimatePresence>
          {open && (
            <Dialog.Portal forceMount>
              <Dialog.Overlay asChild forceMount>
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.18 }}
                  className="fixed inset-0 z-[60] bg-black/55 backdrop-blur-[2px]"
                />
              </Dialog.Overlay>
              <Dialog.Content forceMount className="fixed left-1/2 top-1/2 z-[60] flex max-h-[calc(100dvh-2rem)] w-[min(94vw,62rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-borde bg-superficie shadow-2xl outline-none">
                <motion.div
                  initial={{ opacity: 0, y: 8, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 8, scale: 0.98 }}
                  transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
                  className="flex min-h-0 flex-col"
                >
                  <div className="flex items-start justify-between gap-4 border-b border-borde px-5 py-4">
                    <div className="min-w-0">
                      <Dialog.Title className="break-words text-base font-semibold text-texto">Referencias usadas en entrenamiento</Dialog.Title>
                      <Dialog.Description className="mt-1 break-words text-xs leading-5 text-texto-suave">
                        {productLabel}{data?.requestedSizeCode ? ` · ${data.requestedSizeCode}` : ""}. {expectedCount} {expectedCount === 1 ? "foto coincide" : "fotos coinciden"} con este conteo.
                      </Dialog.Description>
                    </div>
                    <Dialog.Close asChild>
                      <button type="button" aria-label="Cerrar referencias de entrenamiento" className="ui-pressable shrink-0 rounded-lg p-1.5 text-texto-suave hover:bg-superficie-2 hover:text-texto">
                        <X className="size-4" aria-hidden="true" />
                      </button>
                    </Dialog.Close>
                  </div>

                  <p className="sr-only" aria-live="polite">{announcement}</p>
                  <div className="min-h-0 overflow-y-auto p-5">
                    {loadState === "loading" && (
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2" role="status">
                        {[0, 1, 2, 3].map((index) => <div key={index} className="animate-pulse overflow-hidden rounded-xl border border-borde"><div className="aspect-[4/3] bg-superficie-2" /><div className="space-y-2 p-3"><div className="h-3 w-2/3 rounded bg-superficie-2" /><div className="h-3 w-full rounded bg-superficie-2" /></div></div>)}
                      </div>
                    )}
                    {loadState === "error" && (
                      <div className="mx-auto max-w-lg rounded-xl border border-error/30 bg-error-suave p-4 text-sm text-texto" role="alert">
                        <div className="flex gap-2"><TriangleAlert className="mt-0.5 size-4 shrink-0 text-error" aria-hidden="true" /><p>{error ?? "No se pudieron cargar las referencias."}</p></div>
                        <button type="button" onClick={onRetry} className="ui-pressable mt-3 rounded-lg border border-error/30 px-3 py-2 text-xs font-semibold text-error hover:bg-superficie">Reintentar</button>
                      </div>
                    )}
                    {loadState === "ready" && records.length === 0 && (
                      <div className="mx-auto max-w-lg rounded-xl border border-borde bg-fondo p-5 text-center">
                        <ImageIcon className="mx-auto size-5 text-texto-suave" aria-hidden="true" />
                        <p className="mt-2 text-sm font-medium text-texto">No hay fotos disponibles</p>
                        <p className="mt-1 text-xs leading-5 text-texto-suave">El conteo cambió antes de cargar la evidencia. Cierra y vuelve a intentarlo.</p>
                      </div>
                    )}
                    {loadState === "ready" && records.length > 0 && (
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        {records.map((record) => {
                          const imageUrl = `/api/lora/dataset-v005/${encodeURIComponent(record.imageFile)}`;
                          const alt = `Foto ${record.imageId} de entrenamiento para ${productLabel}`;
                          const imageUnavailable = unavailableImages.has(imageUrl);
                          return (
                            <article key={record.imageId} className="min-w-0 overflow-hidden rounded-xl border border-borde bg-fondo">
                              {imageUnavailable ? (
                                <div className="flex aspect-[4/3] flex-col items-center justify-center gap-2 bg-superficie-2 px-4 text-center" role="img" aria-label={`Foto ${record.imageId} no disponible`}>
                                  <ImageOff className="size-5 text-texto-suave" aria-hidden="true" />
                                  <p className="text-xs font-medium text-texto">Foto no disponible ahora</p>
                                  <p className="text-[11px] leading-4 text-texto-suave">La evidencia y las demás fotos siguen disponibles.</p>
                                  <button type="button" onClick={() => setUnavailableImages((previous) => { const next = new Set(previous); next.delete(imageUrl); return next; })} className="ui-pressable rounded-md border border-borde px-2 py-1 text-[11px] font-semibold text-acento hover:bg-acento-suave focus-visible:outline-2 focus-visible:outline-acento">Reintentar foto</button>
                                </div>
                              ) : (
                                <button type="button" onClick={() => setSelectedImage({ src: imageUrl, alt })} className="group relative block aspect-[4/3] w-full overflow-hidden bg-superficie-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acento" aria-label={`Abrir foto ${record.imageId} a tamaño completo`}>
                                  <img src={imageUrl} alt={alt} loading="lazy" onError={() => setUnavailableImages((previous) => new Set(previous).add(imageUrl))} className="size-full object-contain transition duration-200 group-hover:scale-[1.02]" />
                                  <span className="absolute bottom-2 right-2 inline-flex items-center gap-1 rounded-md bg-black/70 px-2 py-1 text-[10px] font-semibold text-white"><ZoomIn className="size-3" aria-hidden="true" />Ampliar</span>
                                </button>
                              )}
                              <div className="space-y-2 p-3">
                                <div className="flex flex-wrap items-start justify-between gap-2">
                                  <p className="min-w-0 break-all text-xs font-semibold text-texto">{record.imageId}</p>
                                  <div className="flex flex-wrap justify-end gap-1.5">
                                    {record.conceptVisible && record.otherConceptCount === 0 && record.uncertainties.length === 0 && <span className="rounded-full border border-exito/30 bg-exito-suave px-2 py-0.5 text-[10px] font-medium text-exito">Evidencia limpia</span>}
                                    {record.otherConceptCount > 0 && <span className="rounded-full border border-borde bg-superficie-2 px-2 py-0.5 text-[10px] font-medium text-texto-suave">Mezclada con {record.otherConceptCount} {record.otherConceptCount === 1 ? "concepto" : "conceptos"}</span>}
                                    {!record.conceptVisible && <span className="rounded-full border border-borde bg-superficie-2 px-2 py-0.5 text-[10px] font-medium text-texto-suave">Visibilidad no confirmada</span>}
                                  </div>
                                </div>
                                <p className="break-words text-[11px] leading-5 text-texto-suave">{record.caption}</p>
                                {record.uncertainties.length > 0 && <details className="rounded-lg border border-aviso/25 bg-aviso-suave/50 px-2.5 py-2 text-[11px] text-texto"><summary className="cursor-pointer font-medium text-aviso">El anotador declaró incertidumbre</summary><ul className="mt-1 list-disc space-y-1 pl-4 text-texto-suave">{record.uncertainties.map((uncertainty) => <li key={uncertainty} className="break-words">{uncertainty}</li>)}</ul></details>}
                              </div>
                            </article>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </motion.div>
              </Dialog.Content>
            </Dialog.Portal>
          )}
        </AnimatePresence>
      </Dialog.Root>
      <VisorImagenCompleta src={selectedImage?.src ?? null} alt={selectedImage?.alt ?? "Foto de entrenamiento"} abierto={Boolean(selectedImage)} onCerrar={() => setSelectedImage(null)} />
    </>
  );
}
