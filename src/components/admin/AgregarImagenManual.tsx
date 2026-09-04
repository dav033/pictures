"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { AnimatePresence, motion } from "motion/react";
import { Plus, X } from "lucide-react";
import { useEffect, useState } from "react";

type ElementoCatalogo = {
  sku: string;
  producto: string;
  variante: string | null;
  precioUnitario: number;
  imagen: string | null;
  disponible: boolean;
};
type ElementoSeleccionado = ElementoCatalogo & { cantidad: number };

const TIPOS_ESTRUCTURA = [
  { valor: "arco", etiqueta: "Arco" },
  { valor: "semiarco", etiqueta: "Semiarco" },
  { valor: "guirnalda", etiqueta: "Guirnalda" },
  { valor: "columna", etiqueta: "Columna" },
  { valor: "pared", etiqueta: "Pared" },
  { valor: "bouquet", etiqueta: "Bouquet" },
  { valor: "centro_mesa", etiqueta: "Centro de mesa" },
  { valor: "otro", etiqueta: "Otro" },
];

function formatoCOP(valor: number): string {
  return `$${valor.toLocaleString("es-CO")}`;
}

function FilaElementoBusqueda({ elemento, yaAgregado, onAgregar }: { elemento: ElementoCatalogo; yaAgregado: boolean; onAgregar: () => void }) {
  return (
    <button
      type="button"
      disabled={yaAgregado}
      onClick={onAgregar}
      className="flex w-full items-center gap-2 rounded-lg border border-borde p-2 text-left hover:border-acento disabled:cursor-not-allowed disabled:opacity-50"
    >
      <div className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-md bg-superficie-2">
        {elemento.imagen ? (
          // eslint-disable-next-line @next/next/no-img-element -- imagen viene del CDN de Shopify
          <img src={elemento.imagen} alt={elemento.producto} className="size-full object-cover" />
        ) : null}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium text-texto">{elemento.producto}</p>
        <p className="truncate text-[11px] text-texto-suave">
          {elemento.variante ?? "—"} · {formatoCOP(elemento.precioUnitario)}
        </p>
      </div>
      {yaAgregado ? (
        <span className="shrink-0 text-[10px] text-texto-suave">agregado</span>
      ) : (
        <Plus className="size-3.5 shrink-0 text-acento" aria-hidden="true" />
      )}
    </button>
  );
}

export function AgregarImagenManual({ onCreada }: { onCreada: () => void }) {
  const [abierto, setAbierto] = useState(false);
  const [archivo, setArchivo] = useState<File | null>(null);
  const [previsualizacion, setPrevisualizacion] = useState<string | null>(null);
  const [tipoEstructura, setTipoEstructura] = useState("");
  const [seleccionados, setSeleccionados] = useState<ElementoSeleccionado[]>([]);
  const [busqueda, setBusqueda] = useState("");
  const [resultados, setResultados] = useState<ElementoCatalogo[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!abierto) return;
    let vigente = true;
    setBuscando(true);
    const timer = setTimeout(() => {
      fetch(`/api/admin/ordenes/catalogo-buscar?q=${encodeURIComponent(busqueda)}`)
        .then((r) => r.json())
        .then((data) => {
          if (vigente) setResultados(data.elementos ?? []);
        })
        .finally(() => vigente && setBuscando(false));
    }, 300);
    return () => {
      vigente = false;
      clearTimeout(timer);
    };
  }, [busqueda, abierto]);

  function elegirArchivo(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    setArchivo(f);
    setPrevisualizacion(f ? URL.createObjectURL(f) : null);
  }

  function agregarElemento(el: ElementoCatalogo) {
    setSeleccionados((actual) => (actual.some((s) => s.sku === el.sku) ? actual : [...actual, { ...el, cantidad: 1 }]));
  }

  function quitarElemento(sku: string) {
    setSeleccionados((actual) => actual.filter((s) => s.sku !== sku));
  }

  function resetear() {
    setArchivo(null);
    setPrevisualizacion(null);
    setTipoEstructura("");
    setSeleccionados([]);
    setBusqueda("");
    setResultados([]);
    setError(null);
  }

  async function guardar() {
    if (!archivo || !tipoEstructura || seleccionados.length === 0) return;
    setGuardando(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("foto", archivo);
      formData.append("tipoEstructura", tipoEstructura);
      formData.append(
        "elementos",
        JSON.stringify(seleccionados.map(({ sku, producto, variante, precioUnitario, cantidad }) => ({ sku, producto, variante, precioUnitario, cantidad }))),
      );
      const res = await fetch("/api/admin/ordenes/manual", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "No se pudo guardar.");
        return;
      }
      onCreada();
      setAbierto(false);
      resetear();
    } finally {
      setGuardando(false);
    }
  }

  const puedeGuardar = Boolean(archivo) && Boolean(tipoEstructura) && seleccionados.length > 0 && !guardando;

  return (
    <>
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="flex items-center gap-1.5 rounded-lg border border-acento px-2.5 py-1.5 text-xs font-medium text-acento hover:bg-acento-suave"
      >
        <Plus className="size-3.5" aria-hidden="true" /> Agregar imagen
      </button>

      <Dialog.Root
        open={abierto}
        onOpenChange={(o) => {
          if (!o && !guardando) {
            setAbierto(false);
            resetear();
          }
        }}
      >
        <AnimatePresence>
          {abierto && (
            <Dialog.Portal forceMount>
              <Dialog.Overlay asChild forceMount>
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  className="fixed inset-0 z-50 bg-black/60"
                />
              </Dialog.Overlay>
              <Dialog.Content forceMount className="fixed inset-0 z-50 flex items-center justify-center p-4 outline-none">
                <motion.div
                  initial={{ opacity: 0, scale: 0.97, y: 8 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.97, y: 8 }}
                  transition={{ duration: 0.18, ease: [0.23, 1, 0.32, 1] }}
                  className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-xl border border-borde bg-superficie p-5 shadow-xl"
                >
                  <div className="mb-3 flex items-center justify-between">
                    <Dialog.Title className="text-sm font-semibold text-texto">Agregar imagen al dataset</Dialog.Title>
                    <Dialog.Close asChild>
                      <button type="button" aria-label="Cerrar" className="text-texto-suave hover:text-texto" disabled={guardando}>
                        <X className="size-4" aria-hidden="true" />
                      </button>
                    </Dialog.Close>
                  </div>
                  <Dialog.Description className="mb-3 text-xs text-texto-suave">
                    Foto suelta, sin una orden de Shopify detrás -- marcá qué elementos del catálogo se ven y el tipo de
                    estructura, y se genera el caption automáticamente igual que en el resto del dataset.
                  </Dialog.Description>

                  <div className="space-y-4">
                    <label className="block text-xs">
                      <span className="mb-1 block font-medium text-texto-suave">Imagen</span>
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        onChange={elegirArchivo}
                        className="block w-full text-xs text-texto-suave file:mr-2 file:rounded-lg file:border file:border-borde file:bg-superficie-2 file:px-2.5 file:py-1.5 file:text-xs file:text-texto"
                      />
                      {previsualizacion && (
                        // eslint-disable-next-line @next/next/no-img-element -- previsualización local, no CDN
                        <img src={previsualizacion} alt="Previsualización" className="mt-2 h-32 w-full rounded-lg object-cover" />
                      )}
                    </label>

                    <label className="block text-xs">
                      <span className="mb-1 block font-medium text-texto-suave">Tipo de estructura</span>
                      <select
                        value={tipoEstructura}
                        onChange={(e) => setTipoEstructura(e.target.value)}
                        className="w-full rounded-lg border border-borde bg-superficie-2 px-2 py-1.5 text-xs text-texto outline-none focus:border-acento"
                      >
                        <option value="">Elegir…</option>
                        {TIPOS_ESTRUCTURA.map((t) => (
                          <option key={t.valor} value={t.valor}>
                            {t.etiqueta}
                          </option>
                        ))}
                      </select>
                    </label>

                    <div className="text-xs">
                      <span className="mb-1 block font-medium text-texto-suave">Elementos del catálogo visibles en la foto</span>

                      {seleccionados.length > 0 && (
                        <div className="mb-2 flex flex-wrap gap-1.5">
                          {seleccionados.map((s) => (
                            <span
                              key={s.sku}
                              className="flex items-center gap-1 rounded-full bg-acento-suave px-2 py-0.5 text-[11px] text-acento"
                            >
                              {s.producto}
                              {s.variante ? ` (${s.variante})` : ""}
                              <button type="button" onClick={() => quitarElemento(s.sku)} aria-label={`Quitar ${s.producto}`}>
                                <X className="size-3" aria-hidden="true" />
                              </button>
                            </span>
                          ))}
                        </div>
                      )}

                      <input
                        value={busqueda}
                        onChange={(e) => setBusqueda(e.target.value)}
                        placeholder="Buscar producto o SKU del catálogo…"
                        className="mb-1.5 w-full rounded-lg border border-borde bg-superficie-2 px-2 py-1.5 text-xs text-texto outline-none focus:border-acento"
                      />
                      <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-borde p-1.5">
                        {buscando ? (
                          <p className="p-2 text-texto-suave">Buscando…</p>
                        ) : resultados.length === 0 ? (
                          <p className="p-2 text-texto-suave">Sin resultados.</p>
                        ) : (
                          resultados.map((el) => (
                            <FilaElementoBusqueda
                              key={el.sku}
                              elemento={el}
                              yaAgregado={seleccionados.some((s) => s.sku === el.sku)}
                              onAgregar={() => agregarElemento(el)}
                            />
                          ))
                        )}
                      </div>
                    </div>

                    {error && <p className="text-xs text-error">{error}</p>}

                    <div className="flex justify-end gap-2 pt-1">
                      <Dialog.Close asChild>
                        <button type="button" disabled={guardando} className="rounded-lg border border-borde px-3 py-1.5 text-xs text-texto-suave">
                          Cancelar
                        </button>
                      </Dialog.Close>
                      <button
                        type="button"
                        disabled={!puedeGuardar}
                        onClick={guardar}
                        className="rounded-lg bg-acento px-3 py-1.5 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {guardando ? "Generando caption…" : "Guardar y generar caption"}
                      </button>
                    </div>
                  </div>
                </motion.div>
              </Dialog.Content>
            </Dialog.Portal>
          )}
        </AnimatePresence>
      </Dialog.Root>
    </>
  );
}
