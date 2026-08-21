"use client";

import { useState } from "react";
import { Tag } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { NOMBRES_CATEGORIA } from "@/lib/catalog-data";
import type { Decoracion, Producto } from "@/lib/types";
import { ImageInput } from "./ImageInput";

export function DecoracionForm({
  decoracion,
  productos,
  onGuardado,
  onCancelar,
}: {
  decoracion?: Decoracion;
  productos: Producto[];
  onGuardado: (decoracion: Decoracion) => void;
  onCancelar: () => void;
}) {
  const [nombre, setNombre] = useState(decoracion?.nombre ?? "");
  const [descripcion, setDescripcion] = useState(decoracion?.descripcion ?? "");
  const [elementos, setElementos] = useState<Set<string>>(
    new Set(decoracion?.elementos ?? []),
  );
  const [archivo, setArchivo] = useState<File | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function alternar(id: string) {
    setElementos((previo) => {
      const copia = new Set(previo);
      if (copia.has(id)) copia.delete(id);
      else copia.add(id);
      return copia;
    });
  }

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (!decoracion && !archivo) {
      setError("Sube una imagen de portada para la decoración.");
      return;
    }

    setGuardando(true);
    setError(null);

    const form = new FormData();
    form.set("nombre", nombre);
    form.set("descripcion", descripcion);
    form.set("elementos", JSON.stringify([...elementos]));
    if (archivo) form.set("imagen", archivo);

    try {
      const res = await fetch(
        decoracion ? `/api/decoraciones/${decoracion.id}` : "/api/decoraciones",
        { method: decoracion ? "PATCH" : "POST", body: form },
      );
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "No se pudo guardar la decoración.");
        return;
      }
      onGuardado(data);
    } catch {
      setError("No se pudo contactar al servidor.");
    } finally {
      setGuardando(false);
    }
  }

  const porCategoria = productos.reduce<Record<string, Producto[]>>((acc, p) => {
    (acc[p.categoria] ??= []).push(p);
    return acc;
  }, {});

  return (
    <form
      onSubmit={enviar}
      className="space-y-3 rounded-xl border border-borde bg-superficie p-4"
    >
      <h3 className="text-sm font-semibold text-texto">
        {decoracion ? "Editar decoración" : "Nueva decoración"}
      </h3>

      <ImageInput
        label="Imagen de portada"
        initialUrl={decoracion?.imagen}
        onFile={setArchivo}
        helper="Una foto de ejemplo de esta decoración aplicada — es la carátula del paquete."
      />

      <div>
        <label className="mb-1 block text-xs font-medium text-texto-suave">Nombre</label>
        <input
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          required
          placeholder="Ej. Boda boho jardín"
          className="w-full rounded-lg border border-borde bg-fondo px-3 py-2 text-sm text-texto outline-none focus:border-acento"
        />
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-texto-suave">
          Descripción (opcional)
        </label>
        <textarea
          value={descripcion}
          onChange={(e) => setDescripcion(e.target.value)}
          rows={2}
          className="w-full resize-none rounded-lg border border-borde bg-fondo px-3 py-2 text-sm text-texto outline-none focus:border-acento"
        />
      </div>

      <div>
        <div className="mb-1 flex items-baseline justify-between">
          <label className="text-xs font-medium text-texto-suave">
            Elementos que la componen
          </label>
          <span className="text-xs text-texto-suave">{elementos.size} seleccionados</span>
        </div>
        <p className="mb-2 text-xs text-texto-suave">
          Todos son opcionales: el cliente podrá quitar cualquiera al personalizar.
        </p>

        {productos.length === 0 ? (
          <p className="text-xs text-texto-suave">
            No hay productos en el catálogo todavía.
          </p>
        ) : (
          <div className="max-h-64 space-y-3 overflow-y-auto rounded-lg border border-borde bg-fondo p-3">
            {Object.entries(porCategoria).map(([categoria, items]) => (
              <div key={categoria}>
                <p className="mb-1 text-xs font-semibold text-texto-suave">
                  {NOMBRES_CATEGORIA[categoria as keyof typeof NOMBRES_CATEGORIA] ?? categoria}
                </p>
                <div className="space-y-1">
                  {items.map((p) => (
                    <label
                      key={p.id}
                      className="flex items-center gap-2 rounded-lg px-1.5 py-1 text-sm text-texto hover:bg-superficie"
                    >
                      <Checkbox
                        checked={elementos.has(p.id)}
                        onCheckedChange={() => alternar(p.id)}
                      />
                      {p.foto ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={p.foto} alt="" className="size-6 rounded object-cover" />
                      ) : p.emoji ? (
                        <span aria-hidden>{p.emoji}</span>
                      ) : (
                        <Tag className="size-4 text-texto-suave" aria-hidden />
                      )}
                      <span className="truncate">{p.nombre}</span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {error && (
        <p className="rounded-lg border border-acento/40 bg-acento-suave px-3 py-2 text-xs text-acento">
          {error}
        </p>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onCancelar}
          className="rounded-lg px-3 py-2 text-sm text-texto-suave hover:text-texto"
        >
          Cancelar
        </button>
        <button
          type="submit"
          disabled={guardando}
          className="rounded-lg bg-acento px-4 py-2 text-sm font-medium text-white transition disabled:opacity-40"
        >
          {guardando ? "Guardando…" : "Guardar"}
        </button>
      </div>
    </form>
  );
}
