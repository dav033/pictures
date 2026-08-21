"use client";

import { useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { NOMBRES_CATEGORIA } from "@/lib/catalog-data";
import type { Categoria, Producto } from "@/lib/types";
import { ImageInput } from "./ImageInput";

const CATEGORIAS = Object.entries(NOMBRES_CATEGORIA) as [Categoria, string][];

export function ProductoForm({
  producto,
  onGuardado,
  onCancelar,
}: {
  producto?: Producto;
  onGuardado: (producto: Producto) => void;
  onCancelar: () => void;
}) {
  const [nombre, setNombre] = useState(producto?.nombre ?? "");
  const [categoria, setCategoria] = useState<Categoria>((producto?.categoria as Categoria) ?? "arco");
  const [descripcion, setDescripcion] = useState(producto?.descripcion ?? "");
  const [precio, setPrecio] = useState(producto ? String(producto.precio) : "");
  const [estilos, setEstilos] = useState(producto?.estilos.join(", ") ?? "");
  const [colores, setColores] = useState(producto?.colores.join(", ") ?? "");
  const [archivo, setArchivo] = useState<File | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (!producto && !archivo) {
      setError("Sube una foto real del producto.");
      return;
    }

    setGuardando(true);
    setError(null);

    const form = new FormData();
    form.set("nombre", nombre);
    form.set("categoria", categoria);
    form.set("descripcion", descripcion);
    form.set("precio", precio);
    form.set("estilos", estilos);
    form.set("colores", colores);
    if (archivo) form.set("imagen", archivo);

    try {
      const res = await fetch(
        producto ? `/api/productos/${producto.id}` : "/api/productos",
        { method: producto ? "PATCH" : "POST", body: form },
      );
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "No se pudo guardar el producto.");
        return;
      }
      onGuardado(data);
    } catch {
      setError("No se pudo contactar al servidor.");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <form
      onSubmit={enviar}
      className="space-y-3 rounded-xl border border-borde bg-superficie p-4"
    >
      <h3 className="text-sm font-semibold text-texto">
        {producto ? "Editar producto" : "Nuevo producto"}
      </h3>

      <ImageInput
        label="Foto real del producto"
        initialUrl={producto?.foto}
        onFile={setArchivo}
        helper="Sobre fondo limpio si es posible. Se usa como referencia real al generar imágenes."
      />

      <div>
        <label className="mb-1 block text-xs font-medium text-texto-suave">Nombre</label>
        <input
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          required
          className="w-full rounded-lg border border-borde bg-fondo px-3 py-2 text-sm text-texto outline-none focus:border-acento"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-texto-suave">Categoría</label>
          <Select value={categoria} onValueChange={(v) => setCategoria(v as Categoria)}>
            <SelectTrigger className="w-full max-w-none border border-borde bg-fondo text-sm font-normal text-texto">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CATEGORIAS.map(([valor, etiqueta]) => (
                <SelectItem key={valor} value={valor}>
                  {etiqueta}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-texto-suave">Precio (COP)</label>
          <input
            type="number"
            min={0}
            step="1"
            value={precio}
            onChange={(e) => setPrecio(e.target.value)}
            required
            className="w-full rounded-lg border border-borde bg-fondo px-3 py-2 text-sm text-texto outline-none focus:border-acento"
          />
        </div>
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-texto-suave">
          Descripción visual
        </label>
        <textarea
          value={descripcion}
          onChange={(e) => setDescripcion(e.target.value)}
          required
          rows={3}
          placeholder="Ej. arco circular de madera clara con pampas y eucalipto seco…"
          className="w-full resize-none rounded-lg border border-borde bg-fondo px-3 py-2 text-sm text-texto outline-none focus:border-acento"
        />
        <p className="mt-1 text-xs text-texto-suave">
          Es lo que la IA usa para generar imágenes. Sé específico con forma, color y material.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-texto-suave">
            Estilos (separados por coma)
          </label>
          <input
            value={estilos}
            onChange={(e) => setEstilos(e.target.value)}
            placeholder="boho, rustico"
            className="w-full rounded-lg border border-borde bg-fondo px-3 py-2 text-sm text-texto outline-none focus:border-acento"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-texto-suave">
            Colores (separados por coma)
          </label>
          <input
            value={colores}
            onChange={(e) => setColores(e.target.value)}
            placeholder="tierra, beige"
            className="w-full rounded-lg border border-borde bg-fondo px-3 py-2 text-sm text-texto outline-none focus:border-acento"
          />
        </div>
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
