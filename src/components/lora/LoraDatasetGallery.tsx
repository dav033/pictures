"use client";

import Image from "next/image";
import { CheckCircle2, Download, ImageIcon, RotateCcw, Search, Tag, Trash2 } from "lucide-react";
import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import type { LoraDatasetGalleryData, LoraDatasetGalleryRecord } from "@/lib/lora/dataset-v005-view";

type Filter = "all" | "order" | "web";

const numberFormat = new Intl.NumberFormat("es-CO");
const SELECTION_STORAGE_PREFIX = "lora-dataset-selection:";
/** Un solo Set vacÃ­o compartido: crear `new Set()` por tarjeta en cada render romperÃ­a el memo. */
const SIN_COMPONENTES_REMOVIDOS: ReadonlySet<string> = new Set<string>();

function statusClass(record: LoraDatasetGalleryRecord): string {
  return record.status === "order" ? "bg-exito-suave text-exito" : "bg-superficie-2 text-texto-suave";
}

function productComponentKey(component: LoraDatasetGalleryRecord["components"][number], index: number): string {
  return `${component.sku ?? "sin-sku"}|${component.label}|${index}`;
}

const DatasetImageCard = memo(function DatasetImageCard({
  record,
  index,
  total,
  selected,
  onToggle,
  removedComponentKeys,
  onRemoveComponent,
  onRestoreComponents,
  onDelete,
}: {
  record: LoraDatasetGalleryRecord;
  index: number;
  total: number;
  selected: boolean;
  onToggle: (imageId: string) => void;
  removedComponentKeys: Set<string>;
  onRemoveComponent: (imageId: string, componentKey: string) => void;
  onRestoreComponents: (imageId: string) => void;
  onDelete: (imageId: string) => void;
}) {
  const imageUrl = `/api/lora/dataset-v005/${encodeURIComponent(record.imageFile)}`;
  const isOrder = record.status === "order";
  const sourceLabel = isOrder ? "Foto real de orden" : "Sempertex.com â€” Ideas de Fiesta";
  const statusLabel = isOrder ? "Foto de orden" : "Web Sempertex";
  const visibleComponents = record.components.filter((component, componentIndex) => !removedComponentKeys.has(productComponentKey(component, componentIndex)));
  const removedComponentCount = record.components.length - visibleComponents.length;

  return (
    <article className="overflow-hidden rounded-2xl border border-borde bg-superficie shadow-sm transition hover:border-acento/50 hover:shadow-md">
      <a
        href={imageUrl}
        target="_blank"
        rel="noreferrer"
        className="group relative block aspect-[4/3] overflow-hidden bg-superficie-2"
        aria-label={`Abrir imagen ${record.imageId} en tamaÃ±o completo`}
      >
        <Image
          src={imageUrl}
          alt={`Imagen ${record.imageId} del dataset de entrenamiento`}
          fill
          sizes="(min-width: 1280px) 31vw, (min-width: 640px) 47vw, 100vw"
          loading={index < 6 ? "eager" : "lazy"}
          unoptimized
          className="object-contain transition duration-300 group-hover:scale-[1.02]"
        />
        <span className="absolute left-3 top-3 rounded-full bg-black/70 px-2.5 py-1 text-[11px] font-semibold tabular-nums text-white backdrop-blur-sm">
          {String(index + 1).padStart(3, "0")} / {total}
        </span>
        <span className="absolute bottom-3 right-3 rounded-full bg-black/70 px-2.5 py-1 text-[11px] text-white opacity-0 transition group-hover:opacity-100">
          Abrir completa
        </span>
      </a>

      <div className="space-y-3 p-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <label className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 text-[10px] text-texto-suave">
              <input
                type="checkbox"
                checked={selected}
                onChange={() => onToggle(record.imageId)}
                aria-label={`${selected ? "Deseleccionar" : "Seleccionar"} imagen ${record.imageId}`}
                className="size-4 rounded border-borde accent-acento focus:ring-2 focus:ring-acento/30"
              />
              <span>{selected ? "Seleccionada" : "No seleccionada"}</span>
            </label>
            <p className="min-w-0 truncate text-xs font-semibold text-texto">{record.imageId}</p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${statusClass(record)}`}>
              {statusLabel}
            </span>
            <button
              type="button"
              onClick={() => onDelete(record.imageId)}
              title="Borrar esta imagen del computador y del dataset"
              aria-label={`Borrar imagen ${record.imageId}`}
              className="inline-flex items-center gap-1 rounded-lg border border-borde px-2 py-1 text-[10px] font-medium text-error transition hover:bg-error-suave focus-visible:outline-2 focus-visible:outline-error"
            >
              <Trash2 className="size-3" aria-hidden="true" />
              Borrar
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-texto-suave">
          <span>{sourceLabel}</span>
          {record.conceptIds.length > 0 && <span>{record.conceptIds.length} identidad canonizada</span>}
          {!isOrder && record.components.length === 0 && (
            <span>
              {record.productBreakdownStatus === "not_found_in_source_blog_page"
                ? "Fuente oficial sin desglose publicado"
                : "Desglose de productos pendiente"}
            </span>
          )}
        </div>

        <details open className="group/components rounded-xl border border-borde bg-fondo px-3 py-2">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-xs font-semibold text-acento [&::-webkit-details-marker]:hidden">
            <span>Productos que componen la imagen</span>
            <span className="rounded-full bg-superficie-2 px-2 py-0.5 text-[10px] tabular-nums text-texto-suave">
              {visibleComponents.length}{removedComponentCount > 0 ? `/${record.components.length}` : ""}
            </span>
          </summary>
          {record.componentsStatus === "confirmed_visible" && (
            <p className="mt-2 border-t border-borde pt-2 text-[11px] text-texto-suave">Confirmados como visibles en esta foto.</p>
          )}
          {record.componentsStatus === "order_breakdown_only" && (
            <p className="mt-2 border-t border-borde pt-2 text-[11px] text-texto-suave">Tomados del desglose de la orden; visibilidad no confirmada.</p>
          )}
          {record.componentsStatus === "source_breakdown_only" && (
            <p className="mt-2 border-t border-borde pt-2 text-[11px] text-texto-suave">Asociados por el carrusel oficial de Sempertex; visibilidad no confirmada.</p>
          )}
          {visibleComponents.length > 0 ? (
            <ul className="mt-2 space-y-2 border-t border-borde pt-2">
              {record.components.map((component, componentIndex) => {
                const key = productComponentKey(component, componentIndex);
                if (removedComponentKeys.has(key)) return null;
                return (
                <li key={key} className="flex items-center gap-2 text-xs leading-5 text-texto-suave">
                  {component.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- miniatura remota del CDN de Shopify
                    <img src={component.imageUrl} alt={`Miniatura de ${component.label}`} loading="lazy" className="size-12 shrink-0 rounded-lg border border-borde bg-white object-contain p-1" />
                  ) : (
                    <span className="flex size-12 shrink-0 items-center justify-center rounded-lg border border-dashed border-borde bg-superficie-2 px-1 text-center text-[9px] leading-3 text-texto-suave">Sin miniatura</span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium text-texto">{component.label}</span>
                    <span className="block text-[11px]">
                      {component.quantity != null ? `Cantidad en orden: ${component.quantity}` : "Cantidad no disponible"}
                      {component.sku ? ` Â· SKU ${component.sku}` : ""}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => onRemoveComponent(record.imageId, key)}
                    title="Quitar producto de esta imagen"
                    aria-label={`Quitar ${component.label} de la imagen`}
                    className="flex size-8 shrink-0 items-center justify-center rounded-lg text-texto-suave transition hover:bg-error-suave hover:text-error focus-visible:outline-2 focus-visible:outline-error"
                  >
                    <Trash2 className="size-3.5" aria-hidden="true" />
                  </button>
                </li>
                );
              })}
            </ul>
          ) : removedComponentCount > 0 ? (
            <p className="mt-2 border-t border-borde pt-2 text-xs leading-5 text-texto-suave">Todos los productos fueron retirados de esta imagen.</p>
          ) : (
            <p className="mt-2 border-t border-borde pt-2 text-xs leading-5 text-texto-suave">
              {record.status === "web_pending"
                ? record.productBreakdownStatus === "not_found_in_source_blog_page"
                  ? "La pÃ¡gina oficial de Sempertex no publica productos asociados a esta imagen."
                  : "Esta imagen de Sempertex.com aÃºn no tiene desglose de productos confirmado."
                : "No hay productos confirmados para esta imagen."}
            </p>
          )}
          {removedComponentCount > 0 && (
            <button
              type="button"
              onClick={() => onRestoreComponents(record.imageId)}
              className="mt-2 inline-flex items-center gap-1.5 text-[11px] font-medium text-acento hover:underline focus-visible:outline-2 focus-visible:outline-acento"
            >
              <RotateCcw className="size-3.5" aria-hidden="true" />
              Restaurar productos retirados
            </button>
          )}
        </details>

        <details className="group/caption rounded-xl bg-superficie-2 px-3 py-2">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-xs font-semibold text-acento [&::-webkit-details-marker]:hidden">
            <span>
              <span className="group-open/caption:hidden">Ver caption</span>
              <span className="hidden group-open/caption:inline">Ocultar caption</span>
            </span>
            {record.captionVersion === "v007" ? (
              <span className="rounded-full bg-exito-suave px-2 py-0.5 text-[10px] font-semibold text-exito">
                v007 Â· nombres canÃ³nicos
              </span>
            ) : record.captionVersion === "legacy" ? (
              <span className="rounded-full bg-superficie px-2 py-0.5 text-[10px] font-medium text-texto-suave">
                legado Â· sin canonizar
              </span>
            ) : null}
          </summary>
          <p className="mt-2 border-t border-borde pt-2 text-xs leading-5 text-texto-suave">
            {record.caption ?? "Caption pendiente de revisiÃ³n visual y nombres canÃ³nicos."}
          </p>
        </details>
      </div>
    </article>
  );
},
/**
 * Comparador explÃ­cito para no re-renderizar 370 tarjetas por cada click en un checkbox.
 *
 * Los callbacks quedan fuera de la comparaciÃ³n a propÃ³sito: los cuatro son estables
 * (`useCallback` sin dependencias, y el de borrado va contra un ref al closure mÃ¡s nuevo), asÃ­
 * que su identidad nunca cambia y compararlos no aportarÃ­a nada. Si alguno dejara de ser
 * estable, esta comparaciÃ³n lo esconderÃ­a: cualquier callback nuevo que se agregue tiene que
 * mantenerse estable o entrar acÃ¡.
 */
(previa, siguiente) =>
  previa.record === siguiente.record &&
  previa.index === siguiente.index &&
  previa.total === siguiente.total &&
  previa.selected === siguiente.selected &&
  previa.removedComponentKeys === siguiente.removedComponentKeys);

function Stats({ data }: { data: LoraDatasetGalleryData }) {
  return (
    <dl className="mt-5 grid grid-cols-2 gap-2 border-t border-borde pt-5 sm:grid-cols-6">
      <div className="rounded-xl bg-superficie-2 px-3 py-3">
        <dt className="text-[11px] text-texto-suave">ImÃ¡genes</dt>
        <dd className="mt-1 text-lg font-semibold tabular-nums text-texto">{numberFormat.format(data.imageCount)}</dd>
      </div>
      <div className="rounded-xl bg-superficie-2 px-3 py-3">
        <dt className="text-[11px] text-texto-suave">Captions</dt>
        <dd className="mt-1 text-lg font-semibold tabular-nums text-texto">{data.captionCount}/{data.imageCount}</dd>
      </div>
      <div className="rounded-xl bg-superficie-2 px-3 py-3">
        <dt className="text-[11px] text-texto-suave">CanÃ³nicos v007</dt>
        <dd className="mt-1 text-lg font-semibold tabular-nums text-acento">{data.captionV007Count}/{data.orderImageCount}</dd>
      </div>
      <div className="rounded-xl bg-exito-suave px-3 py-3">
        <dt className="text-[11px] text-exito">Fotos de Ã³rdenes</dt>
        <dd className="mt-1 text-lg font-semibold tabular-nums text-exito">{numberFormat.format(data.orderImageCount)}</dd>
      </div>
      <div className="rounded-xl bg-superficie-2 px-3 py-3">
        <dt className="text-[11px] text-texto-suave">Web Sempertex</dt>
        <dd className="mt-1 text-lg font-semibold tabular-nums text-texto">{numberFormat.format(data.webImageCount)}</dd>
      </div>
      <div className="rounded-xl bg-superficie-2 px-3 py-3">
        <dt className="text-[11px] text-texto-suave">CatÃ¡logo Shopify</dt>
        <dd className="mt-1 text-lg font-semibold tabular-nums text-texto">{numberFormat.format(data.catalogImageCount)}</dd>
      </div>
    </dl>
  );
}

export default function LoraDatasetGallery({ data }: { data: LoraDatasetGalleryData | null }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [selectionReady, setSelectionReady] = useState(false);
  const [removedComponents, setRemovedComponents] = useState<Record<string, Set<string>>>({});
  const [componentStateReady, setComponentStateReady] = useState(false);
  const [deletedImageIds, setDeletedImageIds] = useState<Set<string>>(() => new Set());
  const [deletingImageIds, setDeletingImageIds] = useState<Set<string>>(() => new Set());
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [exportando, setExportando] = useState(false);
  const [exportOk, setExportOk] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const datasetId = data?.id ?? "none";
  const restoredDatasetId = useRef<string | null>(null);

  useEffect(() => {
    // `data` puede cambiar de identidad con un refresh del Server Component; no hay que
    // restaurar otra vez porque eso reemplazarÃ­a la selecciÃ³n viva del usuario.
    if (restoredDatasetId.current === datasetId) return;
    restoredDatasetId.current = datasetId;
    if (!data) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- limpia el estado al desmontar la fuente de datos
      setSelectedIds(new Set());
      setRemovedComponents({});
      setDeletedImageIds(new Set());
      setSelectionReady(true);
      setComponentStateReady(true);
      return;
    }
    const validIds = new Set(data.records.map((record) => record.imageId));
    const validComponentKeys = new Map(data.records.map((record) => [
      record.imageId,
      new Set(record.components.map((component, componentIndex) => productComponentKey(component, componentIndex))),
    ]));
    try {
      const stored = JSON.parse(window.localStorage.getItem(`${SELECTION_STORAGE_PREFIX}${datasetId}`) ?? "[]");
      const restored = Array.isArray(stored) ? stored.filter((id): id is string => typeof id === "string" && validIds.has(id)) : [];
      setSelectedIds(new Set(restored));
    } catch {
      setSelectedIds(new Set());
    }
    try {
      const stored = JSON.parse(window.localStorage.getItem(`${SELECTION_STORAGE_PREFIX}${datasetId}:removed-components`) ?? "{}");
      const restored: Record<string, Set<string>> = {};
      if (stored && typeof stored === "object" && !Array.isArray(stored)) {
        for (const [imageId, keys] of Object.entries(stored)) {
          const validKeys = validComponentKeys.get(imageId);
          if (!validKeys || !Array.isArray(keys)) continue;
          const filteredKeys = keys.filter((key): key is string => typeof key === "string" && validKeys.has(key));
          if (filteredKeys.length > 0) restored[imageId] = new Set(filteredKeys);
        }
      }
      setRemovedComponents(restored);
    } catch {
      setRemovedComponents({});
    }
    setSelectionReady(true);
    setComponentStateReady(true);
  }, [data, datasetId]);

  useEffect(() => {
    if (!selectionReady || !data) return;
    window.localStorage.setItem(`${SELECTION_STORAGE_PREFIX}${datasetId}`, JSON.stringify([...selectedIds]));
  }, [data, datasetId, selectedIds, selectionReady]);

  useEffect(() => {
    if (!componentStateReady || !data) return;
    const serializable = Object.fromEntries(
      Object.entries(removedComponents).map(([imageId, keys]) => [imageId, [...keys]]),
    );
    window.localStorage.setItem(`${SELECTION_STORAGE_PREFIX}${datasetId}:removed-components`, JSON.stringify(serializable));
  }, [componentStateReady, data, datasetId, removedComponents]);

  // Los tres usan la forma funcional del setter, asÃ­ que no capturan estado: pueden ser
  // estables sin dependencias y el memo de la tarjeta los ignora con seguridad.
  const toggleSelection = useCallback((imageId: string): void => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(imageId)) next.delete(imageId);
      else next.add(imageId);
      return next;
    });
  }, []);

  const removeComponent = useCallback((imageId: string, componentKey: string): void => {
    setRemovedComponents((current) => ({
      ...current,
      [imageId]: new Set([...(current[imageId] ?? []), componentKey]),
    }));
  }, []);

  const restoreComponents = useCallback((imageId: string): void => {
    setRemovedComponents((current) => {
      const next = { ...current };
      delete next[imageId];
      return next;
    });
  }, []);

  /**
   * Saca la curadurÃ­a del navegador y la deja en disco, donde el empaquetador la puede leer.
   * Sin esto la selecciÃ³n solo existe en el `localStorage` del navegador que la hizo, asÃ­ que
   * no se puede empaquetar el dataset desde otra mÃ¡quina ni desde un script, y limpiar el
   * navegador borra el trabajo de revisiÃ³n sin dejar rastro.
   */
  async function exportarSeleccion(): Promise<void> {
    setExportError(null);
    setExportOk(null);
    setExportando(true);
    try {
      const response = await fetch("/api/lora/dataset/exportar-seleccion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          datasetId,
          seleccion: [...selectedIds],
          componentesRemovidos: Object.fromEntries(
            Object.entries(removedComponents).map(([imageId, keys]) => [imageId, [...keys]]),
          ),
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? "No se pudo exportar la selecciÃ³n.");
      setExportOk(`${numberFormat.format(payload.total ?? selectedIds.size)} image_id en ${payload.archivo ?? "aprobadas.json"}`);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : String(error));
    } finally {
      setExportando(false);
    }
  }

  async function deleteImageIds(imageIds: string[]): Promise<string[] | null> {
    const ids = [...new Set(imageIds)].filter((imageId) => !deletedImageIds.has(imageId));
    if (ids.length === 0) return [];
    const selectedBeforeDelete = new Set([...selectedIds].filter((imageId) => ids.includes(imageId)));
    setDeleteError(null);
    setDeletingImageIds(new Set(ids));
    // Borrado optimista: UI responde de inmediato mientras sistema elimina archivos y derivados.
    setDeletedImageIds((current) => new Set([...current, ...ids]));
    setSelectedIds((current) => {
      const next = new Set(current);
      ids.forEach((id) => next.delete(id));
      return next;
    });
    try {
      const response = await fetch("/api/lora/dataset-v005", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageIds: ids }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? "No se pudieron borrar las imÃ¡genes.");
      const deletedIds: string[] = Array.isArray(payload.deletedIds)
        ? (payload.deletedIds as unknown[]).filter((id: unknown): id is string => typeof id === "string")
        : ids;
      const notDeletedIds = ids.filter((id) => !deletedIds.includes(id));
      if (notDeletedIds.length > 0) {
        setDeletedImageIds((current) => {
          const next = new Set(current);
          notDeletedIds.forEach((id) => next.delete(id));
          return next;
        });
        setSelectedIds((current) => new Set([...current, ...selectedBeforeDelete].filter((id) => !deletedIds.includes(id))));
        setDeleteError(`El servidor no confirmÃ³ borrado de ${notDeletedIds.length} imagen${notDeletedIds.length === 1 ? "" : "es"}.`);
      }
      setRemovedComponents((current) => {
        const next = { ...current };
        deletedIds.forEach((id) => delete next[id]);
        return next;
      });
      return notDeletedIds.length > 0 && deletedIds.length === 0 ? null : deletedIds;
    } catch (error) {
      setDeletedImageIds((current) => {
        const next = new Set(current);
        ids.forEach((id) => next.delete(id));
        return next;
      });
      setSelectedIds((current) => new Set([...current, ...selectedBeforeDelete]));
      setDeleteError(error instanceof Error ? error.message : "No se pudieron borrar las imÃ¡genes.");
      return null;
    } finally {
      setDeletingImageIds(new Set());
    }
  }

  async function deleteOneImage(imageId: string): Promise<void> {
    await deleteImageIds([imageId]);
  }

  /**
   * `onDelete` de la tarjeta, estable pero nunca rancio.
   *
   * Hace falta porque `deleteImageIds` lee `selectedIds` y `deletedImageIds` directo del
   * closure, no con setters funcionales: si la tarjeta memoizada se quedara con una versiÃ³n
   * vieja de esta funciÃ³n, borrarÃ­a consultando estado viejo â€” y ese botÃ³n borra archivos del
   * disco. El ref se actualiza en cada render y el callback estable siempre invoca al Ãºltimo.
   */
  const borrarRef = useRef(deleteOneImage);
  useEffect(() => {
    borrarRef.current = deleteOneImage;
  });
  const borrarUnaImagen = useCallback((imageId: string): void => {
    setDeleteError(null);
    void borrarRef.current(imageId);
  }, []);

  async function deleteAllUnselected(): Promise<void> {
    if (!data) return;
    const ids = data.records.filter((record) => !selectedIds.has(record.imageId)).map((record) => record.imageId);
    await deleteImageIds(ids);
  }

  const viewData = useMemo(() => {
    if (!data) return null;
    const records = data.records.filter((record) => !deletedImageIds.has(record.imageId));
    const orderImageCount = records.filter((record) => record.status === "order").length;
    const webImageCount = records.filter((record) => record.status === "web_pending").length;
    const captionCount = records.filter((record) => Boolean(record.caption)).length;
    return {
      ...data,
      records,
      imageCount: records.length,
      captionCount,
      orderImageCount,
      webImageCount,
      pendingImageCount: records.length - captionCount,
    };
  }, [data, deletedImageIds]);

  /** PosiciÃ³n original de cada imagen, calculada una vez. Ver `sortedRecords`. */
  const indicePorImagen = useMemo(() => {
    if (!viewData) return new Map<string, number>();
    return new Map(viewData.records.map((record, index) => [record.imageId, index] as const));
  }, [viewData]);

  /**
   * El reordenamiento (seleccionadas primero) se calcula sobre una copia DIFERIDA de la
   * selecciÃ³n: al tildar un checkbox, React pinta el tilde en el render urgente y deja el
   * reacomodo de las tarjetas para un render de baja prioridad. Sin esto, el click esperaba a
   * que se reordenara la grilla entera antes de verse marcado.
   */
  const selectedIdsParaOrden = useDeferredValue(selectedIds);

  const sortedRecords = useMemo(() => {
    if (!viewData) return [];
    const lastSelectedIndex = viewData.records.reduce(
      (latestIndex, record, index) => selectedIdsParaOrden.has(record.imageId) ? index : latestIndex,
      -1,
    );

    // `indicePorImagen` en vez de `records.indexOf(record)`: ese indexOf corrÃ­a DENTRO del
    // comparador, asÃ­ que el orden salÃ­a cuadrÃ¡tico â€” con 370 imÃ¡genes, del orden de un millÃ³n
    // de recorridos de array por cada click en un checkbox. Era la lentitud que se sentÃ­a.
    const posicion = (imageId: string) => indicePorImagen.get(imageId) ?? 0;

    return [...viewData.records].sort((a, b) => {
      const aIndex = posicion(a.imageId);
      const bIndex = posicion(b.imageId);
      const aSelected = selectedIdsParaOrden.has(a.imageId);
      const bSelected = selectedIdsParaOrden.has(b.imageId);

      if (aSelected !== bSelected) return aSelected ? -1 : 1;

      if (lastSelectedIndex >= 0) {
        const aIsBeforeSelection = !aSelected && aIndex < lastSelectedIndex;
        const bIsBeforeSelection = !bSelected && bIndex < lastSelectedIndex;
        if (aIsBeforeSelection !== bIsBeforeSelection) return aIsBeforeSelection ? 1 : -1;
      }

      return aIndex - bIndex;
    });
  }, [indicePorImagen, selectedIdsParaOrden, viewData]);

  /** PosiciÃ³n de cada imagen en el orden mostrado, para la etiqueta "007 / 370" de la tarjeta. */
  const posicionMostrada = useMemo(
    () => new Map(sortedRecords.map((record, index) => [record.imageId, index] as const)),
    [sortedRecords],
  );

  const filteredRecords = useMemo(() => {
    if (!viewData) return [];
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return sortedRecords.filter((record) => {
      const matchesFilter = filter === "all"
        || (filter === "order" && record.status === "order")
        || (filter === "web" && record.status === "web_pending");
      if (!matchesFilter) return false;
      if (!normalizedQuery) return true;
      return `${record.imageId} ${record.caption ?? ""} ${record.origin}`.toLocaleLowerCase().includes(normalizedQuery);
    });
  }, [filter, query, sortedRecords, viewData]);

  if (!data || !viewData) {
    return (
      <section className="rounded-3xl border border-error/30 bg-error-suave p-5 sm:p-7" role="alert">
        <h2 className="text-sm font-semibold text-texto">Dataset no disponible</h2>
        <p className="mt-1 text-sm leading-6 text-texto-suave">No hay una selecciÃ³n de imÃ¡genes disponible para revisar.</p>
      </section>
    );
  }

  return (
    <section className="space-y-5" aria-labelledby="lora-dataset-heading">
      <div className="rounded-3xl border border-borde bg-superficie p-5 shadow-sm sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-acento-suave px-2.5 py-1 text-acento">
                <CheckCircle2 className="size-3.5" aria-hidden="true" />
                Borrador para revisar
              </span>
              <span className="text-texto-suave">v006 Â· Ã³rdenes + web Sempertex</span>
            </div>
            <h2 id="lora-dataset-heading" className="mt-3 text-xl font-semibold tracking-tight text-texto">ImÃ¡genes configuradas para entrenamiento</h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-texto-suave">
              Incluye {numberFormat.format(viewData.orderImageCount)} fotos reales de Ã³rdenes y {numberFormat.format(viewData.webImageCount)} imÃ¡genes directas de Sempertex.com. No incluye Pinterest, BASE ni imÃ¡genes individuales del catÃ¡logo Shopify. Todas comienzan deseleccionadas; tu selecciÃ³n manual se conserva en este navegador. Las imÃ¡genes web siguen pendientes de captions, desglose y revisiÃ³n de licencia.
            </p>
          </div>
          <ImageIcon className="size-5 text-acento" aria-hidden="true" />
        </div>
        <Stats data={viewData} />
      </div>

      <div className="rounded-2xl border border-borde bg-superficie p-4 shadow-sm sm:p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <label className="block min-w-0 flex-1">
            <span className="mb-1.5 block text-xs font-semibold text-texto">Buscar en las imÃ¡genes</span>
            <span className="relative block">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-texto-suave" aria-hidden="true" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="ID, origen o texto del captionâ€¦"
                className="min-h-11 w-full rounded-xl border border-borde bg-fondo pl-9 pr-3 text-sm text-texto outline-none transition placeholder:text-texto-suave focus:border-acento focus:ring-2 focus:ring-acento/20"
              />
            </span>
          </label>
          <label className="block lg:w-56">
            <span className="mb-1.5 block text-xs font-semibold text-texto">Mostrar</span>
            <span className="relative block">
              <Tag className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-texto-suave" aria-hidden="true" />
              <select
                value={filter}
                onChange={(event) => setFilter(event.target.value as Filter)}
                className="min-h-11 w-full appearance-none rounded-xl border border-borde bg-fondo pl-9 pr-3 text-sm text-texto outline-none transition focus:border-acento focus:ring-2 focus:ring-acento/20"
              >
                <option value="all">Las {numberFormat.format(viewData.imageCount)} imÃ¡genes</option>
                <option value="order">Fotos de Ã³rdenes ({numberFormat.format(viewData.orderImageCount)})</option>
                <option value="web">Web Sempertex ({numberFormat.format(viewData.webImageCount)})</option>
              </select>
            </span>
          </label>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-borde pt-4">
          <p className="text-xs text-texto-suave" aria-live="polite">
            Seleccionadas: <span className="font-semibold text-texto">{numberFormat.format(selectedIds.size)}</span> Â· No seleccionadas: {numberFormat.format(Math.max(0, viewData.imageCount - selectedIds.size))}
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setSelectedIds((current) => new Set([...current, ...filteredRecords.map((record) => record.imageId)]))}
              className="rounded-lg border border-acento px-2.5 py-1.5 text-xs font-medium text-acento transition hover:bg-acento-suave focus-visible:outline-2 focus-visible:outline-acento"
            >
              Seleccionar visibles
            </button>
            <button
              type="button"
              onClick={() => setSelectedIds(new Set(viewData.records.map((record) => record.imageId)))}
              className="rounded-lg border border-acento px-2.5 py-1.5 text-xs font-medium text-acento transition hover:bg-acento-suave focus-visible:outline-2 focus-visible:outline-acento"
            >
              Seleccionar todas
            </button>
            <button
              type="button"
              onClick={() => setSelectedIds(new Set())}
              className="rounded-lg border border-borde px-2.5 py-1.5 text-xs font-medium text-texto-suave transition hover:bg-superficie-2 focus-visible:outline-2 focus-visible:outline-acento"
            >
              Deseleccionar todas
            </button>
            <button
              type="button"
              disabled={selectedIds.size === 0 || exportando}
              onClick={() => { void exportarSeleccion(); }}
              title="Escribe data/staging/lora-v007/aprobadas.json con los image_id seleccionados, para que el empaquetador los lea"
              className="inline-flex items-center gap-1.5 rounded-lg border border-acento bg-acento-suave px-2.5 py-1.5 text-xs font-medium text-acento transition hover:bg-acento-suave focus-visible:outline-2 focus-visible:outline-acento disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Download className="size-3.5" aria-hidden="true" />
              {exportando ? "Exportandoâ€¦" : `Exportar selecciÃ³n (${numberFormat.format(selectedIds.size)})`}
            </button>
            <button
              type="button"
              disabled={viewData.imageCount - selectedIds.size === 0 || deletingImageIds.size > 0}
              onClick={() => { setDeleteError(null); void deleteAllUnselected(); }}
              title="Borrar permanentemente todas las imÃ¡genes no seleccionadas"
              className="inline-flex items-center gap-1.5 rounded-lg border border-error/50 px-2.5 py-1.5 text-xs font-medium text-error transition hover:bg-error-suave disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Trash2 className="size-3.5" aria-hidden="true" />
              {deletingImageIds.size > 0
                ? `Borrando ${numberFormat.format(deletingImageIds.size)}â€¦`
                : `Borrar no seleccionadas (${numberFormat.format(Math.max(0, viewData.imageCount - selectedIds.size))})`}
            </button>
          </div>
        </div>
        {exportOk && <p className="mt-3 text-xs text-acento" role="status" aria-live="polite">SelecciÃ³n exportada: {exportOk}</p>}
        {exportError && <p className="mt-3 text-xs text-error" role="alert">{exportError}</p>}
        {deleteError && <p className="mt-3 text-xs text-error" role="alert">{deleteError}</p>}
        {deletingImageIds.size > 0 && (
          <p className="mt-3 text-xs text-texto-suave" role="status" aria-live="polite">
            Imagenes ocultas. Eliminando archivos del computador en segundo plano...
          </p>
        )}
        <p className="mt-3 text-xs text-texto-suave" aria-live="polite">
          Mostrando {numberFormat.format(filteredRecords.length)} de {numberFormat.format(viewData.imageCount)} imÃ¡genes. Las seleccionadas aparecen primero; al seleccionar una, las no seleccionadas anteriores pasan al fondo absoluto.
          {viewData.pendingImageCount === 0 ? " No hay captions pendientes." : ` Quedan ${numberFormat.format(viewData.pendingImageCount)} pendientes.`}
        </p>
      </div>

      {filteredRecords.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-borde bg-superficie px-5 py-10 text-center">
          <Search className="mx-auto size-5 text-texto-suave" aria-hidden="true" />
          <p className="mt-2 text-sm font-medium text-texto">No hay imÃ¡genes con ese filtro</p>
          <p className="mt-1 text-sm text-texto-suave">Prueba con otro tÃ©rmino o muestra todas las imÃ¡genes.</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {filteredRecords.map((record) => (
            <DatasetImageCard
              key={record.imageId}
              record={record}
              index={posicionMostrada.get(record.imageId) ?? 0}
              total={viewData.imageCount}
              selected={selectedIds.has(record.imageId)}
              onToggle={toggleSelection}
              removedComponentKeys={removedComponents[record.imageId] ?? SIN_COMPONENTES_REMOVIDOS}
              onRemoveComponent={removeComponent}
              onRestoreComponents={restoreComponents}
              onDelete={borrarUnaImagen}
            />
          ))}
        </div>
      )}
    </section>
  );
}


