"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { AnimatePresence, motion } from "motion/react";
import { X } from "lucide-react";
import { useMemo, useState } from "react";
import type { OrdenRevision, FotoOrden } from "@/app/api/admin/ordenes/route";
import { CATEGORIAS_ENTRENAMIENTO } from "@/lib/ordenes/tipos";
import { ETIQUETAS_CATEGORIA } from "./EstadisticasOrdenes";
import { VisorImagenCompleta } from "./VisorImagenCompleta";

type ItemGaleria = { numero: string; foto: FotoOrden };

function ThumbGaleria({ item, onClick }: { item: ItemGaleria; onClick: () => void }) {
  const apta = item.foto.feedback?.aptoParaEntrenamiento;
  return (
    <button
      type="button"
      onClick={onClick}
      className="group relative aspect-square overflow-hidden rounded-lg bg-superficie-2 outline-none focus:ring-2 focus:ring-acento"
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- foto vive fuera de /public */}
      <img
        src={`/api/admin/ordenes/${item.numero}/foto?indice=${item.foto.indice}`}
        alt={`Orden #${item.numero} · ${item.foto.archivo}`}
        loading="lazy"
        className="size-full object-cover transition-transform group-hover:scale-105"
      />
      <span
        className={`absolute right-1 top-1 size-2.5 rounded-full ring-2 ring-black/40 ${
          apta === true ? "bg-exito" : apta === false ? "bg-error" : "bg-texto-suave"
        }`}
      />
      <span className="absolute inset-x-0 bottom-0 truncate bg-black/60 px-1.5 py-0.5 text-[10px] text-white opacity-0 transition-opacity group-hover:opacity-100">
        #{item.numero}
      </span>
    </button>
  );
}

function LightboxGaleria({ item, onCerrar }: { item: ItemGaleria | null; onCerrar: () => void }) {
  const [verGrande, setVerGrande] = useState(false);
  const src = item ? `/api/admin/ordenes/${item.numero}/foto?indice=${item.foto.indice}` : null;
  const alt = item ? `Orden #${item.numero} · ${item.foto.archivo}` : "";

  return (
    <Dialog.Root open={item !== null} onOpenChange={(o) => { if (!o) onCerrar(); }}>
      <AnimatePresence>
        {item && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild forceMount>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="fixed inset-0 z-50 bg-black/70"
              />
            </Dialog.Overlay>
            <Dialog.Content forceMount className="fixed inset-0 z-50 flex items-center justify-center p-4 outline-none">
              <motion.div
                initial={{ opacity: 0, scale: 0.97, y: 8 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.97, y: 8 }}
                transition={{ duration: 0.18, ease: [0.23, 1, 0.32, 1] }}
                className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-borde bg-superficie shadow-xl sm:flex-row"
              >
                <button
                  type="button"
                  onClick={() => setVerGrande(true)}
                  title="Ver a pantalla completa"
                  className="flex shrink-0 cursor-zoom-in items-center justify-center bg-superficie-2 sm:max-w-md"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- foto vive fuera de /public */}
                  <img
                    src={`/api/admin/ordenes/${item.numero}/foto?indice=${item.foto.indice}`}
                    alt={`Orden #${item.numero} · ${item.foto.archivo}`}
                    className="max-h-[50vh] w-full object-contain sm:max-h-[90vh]"
                  />
                </button>
                <div className="min-w-0 flex-1 space-y-2 overflow-y-auto p-4">
                  <div className="flex items-center justify-between">
                    <Dialog.Title className="text-sm font-semibold text-texto">
                      Orden #{item.numero} · {item.foto.archivo}
                    </Dialog.Title>
                    <Dialog.Close asChild>
                      <button type="button" aria-label="Cerrar" className="text-texto-suave hover:text-texto">
                        <X className="size-4" aria-hidden="true" />
                      </button>
                    </Dialog.Close>
                  </div>
                  <Dialog.Description className="sr-only">Vista ampliada de la foto con su caption y feedback.</Dialog.Description>

                  {item.foto.feedback && (
                    <div className="flex flex-wrap gap-1.5 text-xs">
                      <span
                        className={`rounded-full px-2 py-0.5 ${
                          item.foto.feedback.aptoParaEntrenamiento ? "bg-exito-suave text-exito" : "bg-error-suave text-error"
                        }`}
                      >
                        {item.foto.feedback.aptoParaEntrenamiento ? "apta para entrenamiento" : "no apta"}
                      </span>
                      <span className="rounded-full bg-superficie-2 px-2 py-0.5 text-texto-suave">
                        fidelidad {item.foto.feedback.fidelidadImagen}
                      </span>
                    </div>
                  )}

                  {item.foto.caption ? (
                    <>
                      <p className="text-xs font-medium text-texto-suave">{item.foto.caption.tipo_estructura}</p>
                      <p className="text-xs leading-relaxed text-texto">{item.foto.caption.caption}</p>
                      {item.foto.caption.proporcion_relativa_presente && (
                        <p className="text-xs text-texto-suave">
                          <span className="font-medium">Proporción relativa:</span>{" "}
                          {item.foto.caption.proporcion_relativa_descripcion}
                        </p>
                      )}
                    </>
                  ) : (
                    <p className="text-xs text-texto-suave">Sin caption todavía.</p>
                  )}
                </div>
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
      <VisorImagenCompleta src={src} alt={alt} abierto={verGrande} onCerrar={() => setVerGrande(false)} />
    </Dialog.Root>
  );
}

export function GaleriaOrdenes({ ordenes }: { ordenes: OrdenRevision[] }) {
  const [soloAptas, setSoloAptas] = useState(false);
  const [categoria, setCategoria] = useState<string>("todas");
  const [seleccion, setSeleccion] = useState<ItemGaleria | null>(null);

  const items = useMemo(() => {
    const todas: ItemGaleria[] = ordenes.flatMap((o) => o.fotos.map((foto) => ({ numero: o.numero, foto })));
    return todas.filter((it) => {
      if (soloAptas && !it.foto.feedback?.aptoParaEntrenamiento) return false;
      if (categoria !== "todas" && (it.foto.feedback?.categoria ?? "no_asignada") !== categoria) return false;
      return true;
    });
  }, [ordenes, soloAptas, categoria]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-xs text-texto-suave">{items.length} fotos</p>
        <label className="flex items-center gap-1.5 text-xs text-texto-suave">
          <input type="checkbox" checked={soloAptas} onChange={(e) => setSoloAptas(e.target.checked)} />
          Solo aptas para entrenamiento
        </label>
        <select
          value={categoria}
          onChange={(e) => setCategoria(e.target.value)}
          className="rounded-lg border border-borde bg-superficie px-2 py-1 text-xs text-texto outline-none focus:border-acento"
        >
          <option value="todas">Todas las categorías</option>
          {CATEGORIAS_ENTRENAMIENTO.map((c) => (
            <option key={c} value={c}>
              {ETIQUETAS_CATEGORIA[c]}
            </option>
          ))}
        </select>
        <div className="ml-auto flex items-center gap-3 text-xs text-texto-suave">
          <span className="flex items-center gap-1"><span className="size-2 rounded-full bg-exito" /> apta</span>
          <span className="flex items-center gap-1"><span className="size-2 rounded-full bg-error" /> no apta</span>
          <span className="flex items-center gap-1"><span className="size-2 rounded-full bg-texto-suave" /> sin feedback</span>
        </div>
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-texto-suave">No hay fotos que calcen con el filtro.</p>
      ) : (
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10">
          {items.map((item) => (
            <ThumbGaleria key={`${item.numero}-${item.foto.indice}`} item={item} onClick={() => setSeleccion(item)} />
          ))}
        </div>
      )}

      <LightboxGaleria item={seleccion} onCerrar={() => setSeleccion(null)} />
    </div>
  );
}
