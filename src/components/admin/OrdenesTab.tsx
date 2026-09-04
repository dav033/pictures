"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { AnimatePresence, motion } from "motion/react";
import { X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { OrdenRevision, FotoOrden, Caption, FeedbackFoto } from "@/app/api/admin/ordenes/route";
import { CATEGORIAS_ENTRENAMIENTO, type CategoriaEntrenamiento } from "@/lib/ordenes/tipos";
import { AgregarImagenManual } from "./AgregarImagenManual";
import { ETIQUETAS_CATEGORIA, EstadisticasOrdenes } from "./EstadisticasOrdenes";
import { GaleriaOrdenes } from "./GaleriaOrdenes";
import { VisorImagenCompleta } from "./VisorImagenCompleta";

type Vista = "lista" | "galeria" | "estadisticas";
type Filtro = "todas" | "completas" | "incompletas";
type LineaDesglose = NonNullable<OrdenRevision["desglose"]>["lineas"][number];

// El texto de "producto" en productosRepresentados no es linea.producto solo -- es el mismo
// texto combinado que ve la IA en el prompt de captioning (nombre + variante pegados, ver
// `listaCompleta` en generarCaption.ts) y que devuelve tal cual. Todo lo que arme o busque en
// productosRepresentados tiene que usar este mismo formato o el cruce nunca matchea.
function claveProductoVariante(linea: LineaDesglose): string {
  return `${linea.producto}${linea.variante ? ` (${linea.variante})` : ""}`;
}

function feedbackVacio(numero: string, archivoFoto: string, lineas: LineaDesglose[]): FeedbackFoto {
  return {
    orden: numero,
    foto: archivoFoto,
    esDecoracion: true,
    decoracionCompleta: true,
    elementoPrincipal: "",
    fidelidadImagen: "media",
    productosRepresentados: lineas.map((l) => ({ producto: claveProductoVariante(l), representado: true })),
    aptoParaEntrenamiento: true,
    categoria: "no_asignada",
    notas: "",
    revisadoEn: "",
    fuente: "humano",
  };
}

function estaCompleta(orden: OrdenRevision): boolean {
  return Boolean(orden.desglose) && orden.fotos.length > 0 && orden.fotos.every((f) => f.caption);
}

function EstadoBadge({ ok, etiqueta }: { ok: boolean; etiqueta: string }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs ${ok ? "bg-exito-suave text-exito" : "bg-superficie-2 text-texto-suave"}`}
    >
      {etiqueta}
    </span>
  );
}

function borradorVacio(numero: string, archivoFoto: string): Caption {
  return {
    orden: numero,
    foto: archivoFoto,
    trigger_token: "eventdecor_style_v1",
    tipo_estructura: "",
    elementos_no_comprados: [],
    proporcion_relativa_presente: false,
    proporcion_relativa_descripcion: "",
    caption: "",
    caption_status: "editado_manualmente",
  };
}

function formatoCOP(valor: number): string {
  return `$${valor.toLocaleString("es-CO")}`;
}

function TarjetaMaterial({
  linea,
  representado,
  onToggle,
}: {
  linea: LineaDesglose;
  /** true/false = lo que dice el feedback de esta foto puntual; undefined = todavía no hay
   * feedback para esta foto, no se puede saber -- no resaltar ni ofrecer el toggle. */
  representado?: boolean;
  onToggle?: () => void;
}) {
  const catalogo = linea.catalogo;
  const noVisible = representado === false;
  return (
    <div
      className={`flex items-center gap-2.5 rounded-lg border p-2 ${
        noVisible ? "border-error/50 bg-error-suave/20" : "border-borde bg-superficie-2"
      }`}
    >
      <div className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-md bg-superficie">
        {catalogo?.imagen ? (
          // eslint-disable-next-line @next/next/no-img-element -- imagen viene del CDN de Shopify, no de /public
          <img src={catalogo.imagen} alt={catalogo.titulo} className="size-full object-cover" />
        ) : (
          <span className="text-[10px] text-texto-suave">sin foto</span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium text-texto">{catalogo?.titulo ?? linea.producto}</p>
        <p className="truncate text-xs text-texto-suave">
          {linea.cantidad}× {linea.variante ?? "—"}
        </p>
      </div>
      <div className="shrink-0 text-right">
        {catalogo ? (
          <>
            <p className="text-xs font-medium text-texto">{formatoCOP(catalogo.precio)}</p>
            {!catalogo.disponible && <p className="text-[10px] text-error">agotado</p>}
          </>
        ) : (
          <p className="text-[10px] text-texto-suave">sin match en catálogo</p>
        )}
      </div>
      {onToggle && (
        <button
          type="button"
          onClick={onToggle}
          title={noVisible ? "Marcar como visible en la foto" : "Marcar como NO visible en la foto"}
          className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-medium ${
            noVisible ? "bg-error text-white" : "bg-exito-suave text-exito"
          }`}
        >
          {noVisible ? "no visible" : "visible"}
        </button>
      )}
    </div>
  );
}

function EditarCaptionModal({
  numeroOrden,
  foto,
  abierto,
  onCerrar,
  onGuardado,
}: {
  numeroOrden: string;
  foto: FotoOrden;
  abierto: boolean;
  onCerrar: () => void;
  onGuardado: (caption: Caption) => void;
}) {
  // Se inicializa una sola vez al montar -- el padre le da `key` distinta cada vez que se
  // abre (ver BloqueFoto) para forzar un remount con un borrador limpio, sin necesidad de
  // sincronizar estado en un efecto.
  const [borrador, setBorrador] = useState<Caption>(() => foto.caption ?? borradorVacio(numeroOrden, foto.archivo));
  const [guardando, setGuardando] = useState(false);
  const [errorGuardar, setErrorGuardar] = useState<string | null>(null);

  async function guardar() {
    setGuardando(true);
    setErrorGuardar(null);
    try {
      const res = await fetch(`/api/admin/ordenes/${numeroOrden}/caption?indice=${foto.indice}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(borrador),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorGuardar(data.error ?? "No se pudo guardar.");
        return;
      }
      onGuardado(data.caption);
      onCerrar();
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Dialog.Root open={abierto} onOpenChange={(o) => { if (!o) onCerrar(); }}>
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
            <Dialog.Content
              forceMount
              className="fixed inset-0 z-50 flex items-center justify-center p-4 outline-none"
            >
              <motion.div
                initial={{ opacity: 0, scale: 0.97, y: 8 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.97, y: 8 }}
                transition={{ duration: 0.18, ease: [0.23, 1, 0.32, 1] }}
                className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-xl border border-borde bg-superficie p-5 shadow-xl"
              >
                <div className="mb-3 flex items-center justify-between">
                  <Dialog.Title className="text-sm font-semibold text-texto">
                    Editar caption — Orden #{numeroOrden} · {foto.archivo}
                  </Dialog.Title>
                  <Dialog.Close asChild>
                    <button type="button" aria-label="Cerrar" className="text-texto-suave hover:text-texto">
                      <X className="size-4" aria-hidden="true" />
                    </button>
                  </Dialog.Close>
                </div>
                <Dialog.Description className="sr-only">
                  Formulario para editar manualmente el caption generado para esta foto de la orden.
                </Dialog.Description>

                <div className="space-y-3">
                  <label className="block text-xs">
                    <span className="mb-1 block font-medium text-texto-suave">Tipo de estructura</span>
                    <input
                      value={borrador.tipo_estructura}
                      onChange={(e) => setBorrador({ ...borrador, tipo_estructura: e.target.value })}
                      className="w-full rounded-lg border border-borde bg-superficie-2 px-2 py-1.5 text-xs text-texto outline-none focus:border-acento"
                    />
                  </label>

                  <label className="block text-xs">
                    <span className="mb-1 block font-medium text-texto-suave">Caption</span>
                    <textarea
                      value={borrador.caption}
                      onChange={(e) => setBorrador({ ...borrador, caption: e.target.value })}
                      rows={5}
                      className="w-full rounded-lg border border-borde bg-superficie-2 px-2 py-1.5 text-xs text-texto outline-none focus:border-acento"
                    />
                  </label>

                  <label className="block text-xs">
                    <span className="mb-1 block font-medium text-texto-suave">
                      Elementos visibles no comprados (uno por línea)
                    </span>
                    <textarea
                      value={borrador.elementos_no_comprados.join("\n")}
                      onChange={(e) =>
                        setBorrador({
                          ...borrador,
                          elementos_no_comprados: e.target.value.split("\n").map((l) => l.trim()).filter(Boolean),
                        })
                      }
                      rows={2}
                      className="w-full rounded-lg border border-borde bg-superficie-2 px-2 py-1.5 text-xs text-texto outline-none focus:border-acento"
                    />
                  </label>

                  <label className="flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={borrador.proporcion_relativa_presente}
                      onChange={(e) => setBorrador({ ...borrador, proporcion_relativa_presente: e.target.checked })}
                    />
                    <span className="text-texto-suave">Muestra proporción relativa de tamaños</span>
                  </label>

                  {borrador.proporcion_relativa_presente && (
                    <label className="block text-xs">
                      <span className="mb-1 block font-medium text-texto-suave">Descripción de la proporción</span>
                      <textarea
                        value={borrador.proporcion_relativa_descripcion}
                        onChange={(e) => setBorrador({ ...borrador, proporcion_relativa_descripcion: e.target.value })}
                        rows={2}
                        className="w-full rounded-lg border border-borde bg-superficie-2 px-2 py-1.5 text-xs text-texto outline-none focus:border-acento"
                      />
                    </label>
                  )}

                  {errorGuardar && <p className="text-xs text-error">{errorGuardar}</p>}

                  <div className="flex justify-end gap-2 pt-1">
                    <Dialog.Close asChild>
                      <button type="button" className="rounded-lg border border-borde px-3 py-1.5 text-xs text-texto-suave">
                        Cancelar
                      </button>
                    </Dialog.Close>
                    <button
                      type="button"
                      disabled={guardando}
                      onClick={guardar}
                      className="rounded-lg bg-acento px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60"
                    >
                      {guardando ? "Guardando…" : "Guardar"}
                    </button>
                  </div>
                </div>
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}

function FeedbackModal({
  numeroOrden,
  foto,
  lineas,
  abierto,
  onCerrar,
  onGuardado,
}: {
  numeroOrden: string;
  foto: FotoOrden;
  lineas: LineaDesglose[];
  abierto: boolean;
  onCerrar: () => void;
  onGuardado: (feedback: FeedbackFoto) => void;
}) {
  const [borrador, setBorrador] = useState<FeedbackFoto>(() => foto.feedback ?? feedbackVacio(numeroOrden, foto.archivo, lineas));
  const [guardando, setGuardando] = useState(false);
  const [errorGuardar, setErrorGuardar] = useState<string | null>(null);

  function marcarProducto(producto: string, representado: boolean) {
    setBorrador({
      ...borrador,
      productosRepresentados: borrador.productosRepresentados.map((p) => (p.producto === producto ? { ...p, representado } : p)),
    });
  }

  async function guardar() {
    setGuardando(true);
    setErrorGuardar(null);
    try {
      const res = await fetch(`/api/admin/ordenes/${numeroOrden}/feedback?indice=${foto.indice}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(borrador),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorGuardar(data.error ?? "No se pudo guardar.");
        return;
      }
      onGuardado(data.feedback);
      onCerrar();
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Dialog.Root open={abierto} onOpenChange={(o) => { if (!o) onCerrar(); }}>
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
                  <Dialog.Title className="text-sm font-semibold text-texto">
                    Feedback de revisión — Orden #{numeroOrden} · {foto.archivo}
                  </Dialog.Title>
                  <Dialog.Close asChild>
                    <button type="button" aria-label="Cerrar" className="text-texto-suave hover:text-texto">
                      <X className="size-4" aria-hidden="true" />
                    </button>
                  </Dialog.Close>
                </div>
                <Dialog.Description className="sr-only">
                  Revisión humana estructurada de esta foto, usada como insumo para regenerar el caption.
                </Dialog.Description>

                <div className="space-y-3">
                  <label className="flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={borrador.esDecoracion}
                      onChange={(e) => setBorrador({ ...borrador, esDecoracion: e.target.checked })}
                    />
                    <span className="text-texto">¿Es una foto de decoración?</span>
                  </label>

                  <label className="flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={borrador.decoracionCompleta}
                      onChange={(e) => setBorrador({ ...borrador, decoracionCompleta: e.target.checked })}
                    />
                    <span className="text-texto">Decoración completa (espacio completo con varios elementos, no un recorte)</span>
                  </label>

                  <label className="block text-xs">
                    <span className="mb-1 block font-medium text-texto-suave">Elemento principal de la foto</span>
                    <input
                      list={`productos-${numeroOrden}-${foto.indice}`}
                      value={borrador.elementoPrincipal}
                      onChange={(e) => setBorrador({ ...borrador, elementoPrincipal: e.target.value })}
                      className="w-full rounded-lg border border-borde bg-superficie-2 px-2 py-1.5 text-xs text-texto outline-none focus:border-acento"
                    />
                    <datalist id={`productos-${numeroOrden}-${foto.indice}`}>
                      {lineas.map((l) => (
                        <option key={l.producto} value={l.producto} />
                      ))}
                    </datalist>
                  </label>

                  <label className="block text-xs">
                    <span className="mb-1 block font-medium text-texto-suave">Fidelidad de la imagen</span>
                    <select
                      value={borrador.fidelidadImagen}
                      onChange={(e) => setBorrador({ ...borrador, fidelidadImagen: e.target.value as FeedbackFoto["fidelidadImagen"] })}
                      className="w-full rounded-lg border border-borde bg-superficie-2 px-2 py-1.5 text-xs text-texto outline-none focus:border-acento"
                    >
                      <option value="alta">Alta</option>
                      <option value="media">Media</option>
                      <option value="baja">Baja</option>
                    </select>
                  </label>

                  {lineas.length > 0 && (
                    <div className="text-xs">
                      <span className="mb-1 block font-medium text-texto-suave">¿Qué productos comprados se ven representados en esta foto?</span>
                      <div className="space-y-1 rounded-lg border border-borde bg-superficie-2 p-2">
                        {borrador.productosRepresentados.map((p) => (
                          <label key={p.producto} className="flex items-center gap-2">
                            <input type="checkbox" checked={p.representado} onChange={(e) => marcarProducto(p.producto, e.target.checked)} />
                            <span className="text-texto">{p.producto}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}

                  <label className="flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={borrador.aptoParaEntrenamiento}
                      onChange={(e) => setBorrador({ ...borrador, aptoParaEntrenamiento: e.target.checked })}
                    />
                    <span className="text-texto">Apta para entrenamiento del LoRA</span>
                  </label>

                  <label className="block text-xs">
                    <span className="mb-1 block font-medium text-texto-suave">
                      Categoría de entrenamiento (para separar base y acentos por tema)
                    </span>
                    <select
                      value={borrador.categoria}
                      onChange={(e) => setBorrador({ ...borrador, categoria: e.target.value as FeedbackFoto["categoria"] })}
                      className="w-full rounded-lg border border-borde bg-superficie-2 px-2 py-1.5 text-xs text-texto outline-none focus:border-acento"
                    >
                      {CATEGORIAS_ENTRENAMIENTO.map((c) => (
                        <option key={c} value={c}>
                          {ETIQUETAS_CATEGORIA[c]}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="block text-xs">
                    <span className="mb-1 block font-medium text-texto-suave">Notas</span>
                    <textarea
                      value={borrador.notas}
                      onChange={(e) => setBorrador({ ...borrador, notas: e.target.value })}
                      rows={2}
                      className="w-full rounded-lg border border-borde bg-superficie-2 px-2 py-1.5 text-xs text-texto outline-none focus:border-acento"
                    />
                  </label>

                  {errorGuardar && <p className="text-xs text-error">{errorGuardar}</p>}

                  <div className="flex justify-end gap-2 pt-1">
                    <Dialog.Close asChild>
                      <button type="button" className="rounded-lg border border-borde px-3 py-1.5 text-xs text-texto-suave">
                        Cancelar
                      </button>
                    </Dialog.Close>
                    <button
                      type="button"
                      disabled={guardando}
                      onClick={guardar}
                      className="rounded-lg bg-acento px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60"
                    >
                      {guardando ? "Guardando…" : "Guardar feedback"}
                    </button>
                  </div>
                </div>
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}

function BloqueFoto({
  numeroOrden,
  foto,
  lineas,
  onActualizada,
  onFeedbackActualizado,
}: {
  numeroOrden: string;
  foto: FotoOrden;
  lineas: LineaDesglose[];
  onActualizada: (indice: number, caption: Caption) => void;
  onFeedbackActualizado: (indice: number, feedback: FeedbackFoto) => void;
}) {
  const [editando, setEditando] = useState(false);
  const [sesionEdicion, setSesionEdicion] = useState(0);
  const [revisando, setRevisando] = useState(false);
  const [sesionRevision, setSesionRevision] = useState(0);
  const [recaptioning, setRecaptioning] = useState(false);
  const [errorRecaption, setErrorRecaption] = useState<string | null>(null);
  const [guardandoToggle, setGuardandoToggle] = useState(false);
  const [verGrande, setVerGrande] = useState(false);

  async function alternarRepresentado(claveTexto: string) {
    if (guardandoToggle) return;
    const base = foto.feedback ?? feedbackVacio(numeroOrden, foto.archivo, lineas);
    // Si no había feedback todavía, feedbackVacio ya arranca con todo representado=true --
    // togglear la que se clickeó sobre esa base en vez de perder el resto.
    const productosRepresentados = base.productosRepresentados.some((p) => p.producto === claveTexto)
      ? base.productosRepresentados.map((p) => (p.producto === claveTexto ? { ...p, representado: !p.representado } : p))
      : [...base.productosRepresentados, { producto: claveTexto, representado: false }];

    setGuardandoToggle(true);
    try {
      const res = await fetch(`/api/admin/ordenes/${numeroOrden}/feedback?indice=${foto.indice}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...base, productosRepresentados }),
      });
      const data = await res.json();
      if (res.ok) onFeedbackActualizado(foto.indice, data.feedback);
    } finally {
      setGuardandoToggle(false);
    }
  }

  async function cambiarApto(aptoParaEntrenamiento: boolean) {
    if (guardandoToggle) return;
    const base = foto.feedback ?? feedbackVacio(numeroOrden, foto.archivo, lineas);
    setGuardandoToggle(true);
    try {
      const res = await fetch(`/api/admin/ordenes/${numeroOrden}/feedback?indice=${foto.indice}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...base, aptoParaEntrenamiento }),
      });
      const data = await res.json();
      if (res.ok) onFeedbackActualizado(foto.indice, data.feedback);
    } finally {
      setGuardandoToggle(false);
    }
  }

  async function cambiarCategoria(categoria: CategoriaEntrenamiento) {
    if (guardandoToggle) return;
    const base = foto.feedback ?? feedbackVacio(numeroOrden, foto.archivo, lineas);
    setGuardandoToggle(true);
    try {
      const res = await fetch(`/api/admin/ordenes/${numeroOrden}/feedback?indice=${foto.indice}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...base, categoria }),
      });
      const data = await res.json();
      if (res.ok) onFeedbackActualizado(foto.indice, data.feedback);
    } finally {
      setGuardandoToggle(false);
    }
  }

  function abrirEdicion() {
    setSesionEdicion((s) => s + 1);
    setEditando(true);
  }

  function abrirRevision() {
    setSesionRevision((s) => s + 1);
    setRevisando(true);
  }

  async function recaptionear() {
    setRecaptioning(true);
    setErrorRecaption(null);
    try {
      const res = await fetch(`/api/admin/ordenes/${numeroOrden}/recaption?indice=${foto.indice}`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setErrorRecaption(data.error ?? "No se pudo regenerar el caption.");
        return;
      }
      onActualizada(foto.indice, data.caption);
    } finally {
      setRecaptioning(false);
    }
  }

  const hayNoVisibles = lineas.some((linea) => {
    const entrada = foto.feedback?.productosRepresentados.find((p) => p.producto === claveProductoVariante(linea));
    return entrada?.representado === false;
  });

  return (
    <div className="flex flex-col gap-3 sm:flex-row">
      <button
        type="button"
        onClick={() => setVerGrande(true)}
        title="Ver a pantalla completa"
        className="flex w-full shrink-0 cursor-zoom-in items-center justify-center overflow-hidden rounded-lg bg-superficie-2 sm:w-56"
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- foto vive fuera de /public, no aplica el optimizador de next/image */}
        <img
          src={`/api/admin/ordenes/${numeroOrden}/foto?indice=${foto.indice}`}
          alt={`Foto real orden #${numeroOrden} (${foto.archivo})`}
          className="h-56 w-full object-cover sm:h-full"
        />
      </button>
      <VisorImagenCompleta
        src={`/api/admin/ordenes/${numeroOrden}/foto?indice=${foto.indice}`}
        alt={`Foto real orden #${numeroOrden} (${foto.archivo})`}
        abierto={verGrande}
        onCerrar={() => setVerGrande(false)}
      />

      <div className="flex-1 space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] uppercase tracking-wide text-texto-suave">{foto.archivo}</span>
          <button
            type="button"
            onClick={() => cambiarApto(!(foto.feedback?.aptoParaEntrenamiento ?? true))}
            disabled={guardandoToggle}
            title="Click para cambiar apta/no apta para entrenamiento"
            className={`rounded-full px-2 py-0.5 text-xs disabled:opacity-60 ${(foto.feedback?.aptoParaEntrenamiento ?? true) ? "bg-exito-suave text-exito hover:bg-exito-suave/70" : "bg-error-suave text-error hover:bg-error-suave/70"}`}
          >
            {(foto.feedback?.aptoParaEntrenamiento ?? true) ? "apta para entrenamiento" : "no apta"}
          </button>
          {foto.feedback && (
            <span className="rounded-full bg-superficie-2 px-2 py-0.5 text-xs text-texto-suave">
              {foto.feedback.fuente === "ia_automatica" ? "revisión IA" : "revisión humana"}
            </span>
          )}
          <select
            value={foto.feedback?.categoria ?? "no_asignada"}
            onChange={(e) => cambiarCategoria(e.target.value as CategoriaEntrenamiento)}
            disabled={guardandoToggle}
            title="Categoría de entrenamiento"
            className="rounded-full border border-borde bg-superficie-2 px-2 py-0.5 text-xs text-texto-suave outline-none hover:text-texto disabled:opacity-60"
          >
            {CATEGORIAS_ENTRENAMIENTO.map((c) => (
              <option key={c} value={c}>
                {ETIQUETAS_CATEGORIA[c]}
              </option>
            ))}
          </select>
          <div className="ml-auto flex gap-1.5">
            <button
              type="button"
              onClick={abrirRevision}
              className="rounded-lg border border-borde px-2 py-0.5 text-xs text-texto-suave hover:text-texto"
            >
              {foto.feedback ? "Ver feedback" : "Feedback"}
            </button>
            {foto.feedback && (
              <button
                type="button"
                disabled={recaptioning}
                onClick={recaptionear}
                className="rounded-lg border border-acento px-2 py-0.5 text-xs text-acento hover:bg-acento-suave disabled:opacity-60"
              >
                {recaptioning ? "Regenerando…" : "Recaption"}
              </button>
            )}
            <button
              type="button"
              onClick={abrirEdicion}
              className="rounded-lg border border-borde px-2 py-0.5 text-xs text-texto-suave hover:text-texto"
            >
              Editar
            </button>
          </div>
        </div>

        {errorRecaption && <p className="text-xs text-error">{errorRecaption}</p>}

        {foto.caption ? (
          <>
            <div className="flex flex-wrap gap-1.5 text-xs">
              <span className="rounded-full bg-superficie-2 px-2 py-0.5 text-texto-suave">
                {foto.caption.tipo_estructura}
              </span>
              {foto.caption.proporcion_relativa_presente && (
                <span className="rounded-full bg-superficie-2 px-2 py-0.5 text-texto-suave">
                  proporción relativa
                </span>
              )}
              {foto.caption.caption_status === "editado_manualmente" && (
                <span className="rounded-full bg-superficie-2 px-2 py-0.5 text-texto-suave">editado a mano</span>
              )}
              {foto.caption.caption_status === "recaption_con_feedback" && (
                <span className="rounded-full bg-acento-suave px-2 py-0.5 text-acento">recaption con feedback</span>
              )}
            </div>
            <p className="text-xs leading-relaxed text-texto">{foto.caption.caption}</p>
            {foto.caption.elementos_no_comprados.length > 0 && (
              <p className="text-xs text-texto-suave">
                <span className="font-medium">No comprado, visible en la foto:</span>{" "}
                {foto.caption.elementos_no_comprados.join(", ")}
              </p>
            )}
          </>
        ) : (
          <p className="text-xs text-texto-suave">Sin caption todavía.</p>
        )}

        {lineas.length > 0 && (
          <details className="text-xs">
            <summary
              className={`cursor-pointer select-none hover:text-texto ${hayNoVisibles ? "font-medium text-error" : "text-texto-suave"}`}
            >
              Materiales de la orden ({lineas.length})
              {hayNoVisibles && <span className="ml-1 text-[10px]">-- hay elementos que NO aparecen en esta foto</span>}
            </summary>
            <div className="mt-1.5 space-y-1.5">
              {lineas.map((linea, i) => {
                const claveTexto = claveProductoVariante(linea);
                const entradaFeedback = foto.feedback?.productosRepresentados.find((p) => p.producto === claveTexto);
                return (
                  <TarjetaMaterial
                    key={i}
                    linea={linea}
                    representado={entradaFeedback?.representado}
                    onToggle={() => alternarRepresentado(claveTexto)}
                  />
                );
              })}
            </div>
          </details>
        )}
      </div>

      <EditarCaptionModal
        key={sesionEdicion}
        numeroOrden={numeroOrden}
        foto={foto}
        abierto={editando}
        onCerrar={() => setEditando(false)}
        onGuardado={(caption) => onActualizada(foto.indice, caption)}
      />
      <FeedbackModal
        key={`fb-${sesionRevision}`}
        numeroOrden={numeroOrden}
        foto={foto}
        lineas={lineas}
        abierto={revisando}
        onCerrar={() => setRevisando(false)}
        onGuardado={(feedback) => onFeedbackActualizado(foto.indice, feedback)}
      />
    </div>
  );
}

function TarjetaOrden({
  orden,
  onEliminada,
  onActualizada,
  onFeedbackActualizado,
}: {
  orden: OrdenRevision;
  onEliminada: (numero: string) => void;
  onActualizada: (numero: string, indice: number, caption: Caption) => void;
  onFeedbackActualizado: (numero: string, indice: number, feedback: FeedbackFoto) => void;
}) {
  const completa = estaCompleta(orden);
  const [eliminando, setEliminando] = useState(false);
  const [confirmarEliminar, setConfirmarEliminar] = useState(false);

  async function eliminar() {
    setEliminando(true);
    try {
      const res = await fetch(`/api/admin/ordenes/${orden.numero}`, { method: "DELETE" });
      if (res.ok) onEliminada(orden.numero);
    } finally {
      setEliminando(false);
      setConfirmarEliminar(false);
    }
  }

  return (
    <article className="rounded-xl border border-borde bg-superficie p-4">
      <header className="mb-3 flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-texto">Orden #{orden.numero}</h3>
        {orden.desglose?.cliente && <span className="text-xs text-texto-suave">{orden.desglose.cliente}</span>}
        <div className="ml-auto flex items-center gap-1.5">
          <EstadoBadge ok={orden.fotos.length > 0} etiqueta={`foto${orden.fotos.length > 1 ? `s (${orden.fotos.length})` : ""}`} />
          <EstadoBadge ok={Boolean(orden.desglose)} etiqueta="desglose" />
          <EstadoBadge ok={orden.fotos.length > 0 && orden.fotos.every((f) => f.caption)} etiqueta="caption" />
          {confirmarEliminar ? (
            <span className="flex items-center gap-1">
              <button
                type="button"
                disabled={eliminando}
                onClick={eliminar}
                className="rounded-lg bg-error px-2 py-0.5 text-xs text-white disabled:opacity-60"
              >
                {eliminando ? "Eliminando…" : "Confirmar"}
              </button>
              <button
                type="button"
                onClick={() => setConfirmarEliminar(false)}
                className="rounded-lg border border-borde px-2 py-0.5 text-xs text-texto-suave"
              >
                Cancelar
              </button>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmarEliminar(true)}
              className="rounded-lg border border-borde px-2 py-0.5 text-xs text-error hover:bg-error/10"
            >
              Eliminar orden
            </button>
          )}
        </div>
      </header>

      {orden.fotos.length === 0 ? (
        <p className="text-xs text-texto-suave">Sin foto todavía.</p>
      ) : (
        <div className="space-y-4">
          {orden.fotos.map((foto) => (
            <BloqueFoto
              key={foto.indice}
              numeroOrden={orden.numero}
              foto={foto}
              lineas={orden.desglose?.lineas ?? []}
              onActualizada={(indice, caption) => onActualizada(orden.numero, indice, caption)}
              onFeedbackActualizado={(indice, feedback) => onFeedbackActualizado(orden.numero, indice, feedback)}
            />
          ))}
        </div>
      )}

      {/* Con foto(s), la lista de materiales vive dentro de cada BloqueFoto -- ahí sí se puede
       * resaltar/togglear qué se ve en ESA foto puntual. Sin foto todavía no hay a qué feedback
       * atar eso, así que se muestra un fallback simple. */}
      {orden.fotos.length === 0 && (
        <div className="mt-3">
          {orden.desglose ? (
            <details className="text-xs">
              <summary className="cursor-pointer select-none text-texto-suave hover:text-texto">
                Materiales de la orden ({orden.desglose.lineas.length})
              </summary>
              <div className="mt-1.5 space-y-1.5">
                {orden.desglose.lineas.map((linea, i) => (
                  <TarjetaMaterial key={i} linea={linea} />
                ))}
              </div>
            </details>
          ) : (
            <p className="text-xs text-texto-suave">Sin desglose todavía.</p>
          )}
        </div>
      )}

      {!completa && (
        <p className="mt-2 text-xs text-texto-suave">
          Falta correr:{" "}
          <code className="rounded bg-superficie-2 px-1 py-0.5">npm run ordenes:procesar -- {orden.numero}</code>
        </p>
      )}
    </article>
  );
}

export function OrdenesTab() {
  const [ordenes, setOrdenes] = useState<OrdenRevision[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<Filtro>("todas");
  const [busqueda, setBusqueda] = useState("");
  const [vista, setVista] = useState<Vista>("lista");

  useEffect(() => {
    let vigente = true;
    fetch("/api/admin/ordenes")
      .then((r) => r.json())
      .then((data) => {
        if (!vigente) return;
        setOrdenes(data.ordenes);
        setError(data.error ?? null);
      });
    return () => {
      vigente = false;
    };
  }, []);

  // Recarga completa tras agregar una imagen manual -- más simple y confiable que armar a mano
  // el objeto OrdenRevision en el cliente (el cruce con el catálogo para `linea.catalogo` lo
  // calcula el servidor).
  function recargar() {
    fetch("/api/admin/ordenes")
      .then((r) => r.json())
      .then((data) => {
        setOrdenes(data.ordenes);
        setError(data.error ?? null);
      });
  }

  function eliminarDeLista(numero: string) {
    setOrdenes((actual) => actual?.filter((o) => o.numero !== numero) ?? actual);
  }

  function actualizarCaptionDeLista(numero: string, indice: number, caption: Caption) {
    setOrdenes(
      (actual) =>
        actual?.map((o) =>
          o.numero === numero
            ? { ...o, fotos: o.fotos.map((f) => (f.indice === indice ? { ...f, caption } : f)) }
            : o,
        ) ?? actual,
    );
  }

  function actualizarFeedbackDeLista(numero: string, indice: number, feedback: FeedbackFoto) {
    setOrdenes(
      (actual) =>
        actual?.map((o) =>
          o.numero === numero
            ? { ...o, fotos: o.fotos.map((f) => (f.indice === indice ? { ...f, feedback } : f)) }
            : o,
        ) ?? actual,
    );
  }

  const filtradas = useMemo(() => {
    if (!ordenes) return [];
    return ordenes.filter((o) => {
      const completa = estaCompleta(o);
      if (filtro === "completas" && !completa) return false;
      if (filtro === "incompletas" && completa) return false;
      if (busqueda && !o.numero.includes(busqueda.trim())) return false;
      return true;
    });
  }, [ordenes, filtro, busqueda]);

  const totalCompletas = ordenes?.filter(estaCompleta).length ?? 0;

  // Fotos con feedback ya guardado -- son las únicas que un recaption puede mejorar (sin
  // feedback, generarCaption usa el desglose completo igual que la primera pasada, así que
  // recaptionarlas de nuevo no cambiaría nada).
  const fotosConFeedback = useMemo(
    () =>
      (ordenes ?? []).flatMap((o) =>
        o.fotos.filter((f) => f.feedback).map((f) => ({ numero: o.numero, indice: f.indice })),
      ),
    [ordenes],
  );

  const [recaptionandoTodas, setRecaptionandoTodas] = useState(false);
  const [progresoGlobal, setProgresoGlobal] = useState<{ hecho: number; total: number } | null>(null);
  const [resumenGlobal, setResumenGlobal] = useState<string | null>(null);

  async function recaptionearTodas() {
    setRecaptionandoTodas(true);
    setResumenGlobal(null);
    const objetivos = fotosConFeedback;
    setProgresoGlobal({ hecho: 0, total: objetivos.length });

    let exitos = 0;
    let fallos = 0;
    for (const [i, objetivo] of objetivos.entries()) {
      try {
        const res = await fetch(`/api/admin/ordenes/${objetivo.numero}/recaption?indice=${objetivo.indice}`, { method: "POST" });
        const data = await res.json();
        if (res.ok) {
          actualizarCaptionDeLista(objetivo.numero, objetivo.indice, data.caption);
          exitos += 1;
        } else {
          fallos += 1;
        }
      } catch {
        fallos += 1;
      }
      setProgresoGlobal({ hecho: i + 1, total: objetivos.length });
    }

    setResumenGlobal(`Listo: ${exitos} recaptioneadas, ${fallos} con error.`);
    setRecaptionandoTodas(false);
  }

  return (
    <div className="space-y-4">
      {error && <p className="text-xs text-error">{error}</p>}

      <div className="inline-flex rounded-lg border border-borde bg-superficie p-0.5">
        <button
          type="button"
          onClick={() => setVista("lista")}
          className={`rounded-md px-3 py-1 text-xs font-medium ${vista === "lista" ? "bg-acento text-white" : "text-texto-suave"}`}
        >
          Lista
        </button>
        <button
          type="button"
          onClick={() => setVista("galeria")}
          className={`rounded-md px-3 py-1 text-xs font-medium ${vista === "galeria" ? "bg-acento text-white" : "text-texto-suave"}`}
        >
          Galería
        </button>
        <button
          type="button"
          onClick={() => setVista("estadisticas")}
          className={`rounded-md px-3 py-1 text-xs font-medium ${vista === "estadisticas" ? "bg-acento text-white" : "text-texto-suave"}`}
        >
          Estadísticas
        </button>
      </div>

      {vista === "estadisticas" ? (
        <EstadisticasOrdenes />
      ) : vista === "galeria" ? (
        !ordenes ? <p className="text-sm text-texto-suave">Cargando…</p> : <GaleriaOrdenes ordenes={ordenes} />
      ) : !ordenes ? (
        <p className="text-sm text-texto-suave">Cargando…</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-xs text-texto-suave">
              {ordenes.length} órdenes · {totalCompletas} completas (foto + desglose + caption)
            </p>
            <AgregarImagenManual onCreada={recargar} />
            <button
              type="button"
              disabled={recaptionandoTodas || fotosConFeedback.length === 0}
              onClick={recaptionearTodas}
              className="rounded-lg border border-acento px-2.5 py-1.5 text-xs font-medium text-acento hover:bg-acento-suave disabled:cursor-not-allowed disabled:opacity-50"
            >
              {recaptionandoTodas
                ? `Recaptioneando ${progresoGlobal?.hecho ?? 0}/${progresoGlobal?.total ?? 0}…`
                : `Recaption global (${fotosConFeedback.length})`}
            </button>
            <div className="ml-auto flex items-center gap-2">
              <input
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                placeholder="Buscar # orden…"
                className="rounded-lg border border-borde bg-superficie px-2.5 py-1.5 text-xs text-texto outline-none focus:border-acento"
              />
              <select
                value={filtro}
                onChange={(e) => setFiltro(e.target.value as Filtro)}
                className="rounded-lg border border-borde bg-superficie px-2.5 py-1.5 text-xs text-texto outline-none focus:border-acento"
              >
                <option value="todas">Todas</option>
                <option value="completas">Completas</option>
                <option value="incompletas">Incompletas</option>
              </select>
            </div>
          </div>

          {resumenGlobal && <p className="text-xs text-texto-suave">{resumenGlobal}</p>}

          {filtradas.length === 0 ? (
            <p className="text-sm text-texto-suave">No hay órdenes que calcen con el filtro.</p>
          ) : (
            <div className="space-y-3">
              {filtradas.map((orden) => (
                <TarjetaOrden
                  key={orden.numero}
                  orden={orden}
                  onEliminada={eliminarDeLista}
                  onActualizada={actualizarCaptionDeLista}
                  onFeedbackActualizado={actualizarFeedbackDeLista}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
