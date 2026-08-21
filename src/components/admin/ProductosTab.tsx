"use client";

import { useState } from "react";
import { Tag } from "lucide-react";
import { NOMBRES_CATEGORIA } from "@/lib/catalog-data";
import type { Producto } from "@/lib/types";
import { ProductoForm } from "./ProductoForm";

const pesos = new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "COP",
  maximumFractionDigits: 0,
});

export function ProductosTab({
  productos,
  onCambio,
}: {
  productos: Producto[];
  onCambio: (productos: Producto[]) => void;
}) {
  const [editando, setEditando] = useState<Producto | "nuevo" | null>(null);

  function alGuardar(producto: Producto) {
    const existe = productos.some((p) => p.id === producto.id);
    onCambio(
      existe ? productos.map((p) => (p.id === producto.id ? producto : p)) : [...productos, producto],
    );
    setEditando(null);
  }

  async function eliminar(id: string) {
    if (!confirm("¿Eliminar este producto del catálogo?")) return;
    const res = await fetch(`/api/productos/${id}`, { method: "DELETE" });
    if (res.ok) onCambio(productos.filter((p) => p.id !== id));
  }

  async function eliminarTodos() {
    if (productos.length === 0) return;
    const confirmado = confirm(
      `Esto borra los ${productos.length} productos del catálogo y sus fotos. No se pueden recuperar ni se resembrarán solos. ¿Continuar?`,
    );
    if (!confirmado) return;
    const res = await fetch("/api/productos", { method: "DELETE" });
    if (res.ok) onCambio([]);
  }

  if (editando) {
    return (
      <ProductoForm
        producto={editando === "nuevo" ? undefined : editando}
        onGuardado={alGuardar}
        onCancelar={() => setEditando(null)}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-texto-suave">{productos.length} productos en el catálogo</p>
        <div className="flex gap-2">
          {productos.length > 0 && (
            <button
              type="button"
              onClick={eliminarTodos}
              className="rounded-lg border border-acento/40 px-3 py-1.5 text-sm font-medium text-acento hover:bg-acento-suave"
            >
              Eliminar todos
            </button>
          )}
          <button
            type="button"
            onClick={() => setEditando("nuevo")}
            className="rounded-lg bg-acento px-3 py-1.5 text-sm font-medium text-white"
          >
            + Nuevo producto
          </button>
        </div>
      </div>

      {productos.length === 0 ? (
        <p className="text-sm text-texto-suave">Aún no hay productos en el catálogo.</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {productos.map((p) => (
            <div
              key={p.id}
              className="overflow-hidden rounded-xl border border-borde bg-superficie"
            >
              {p.foto ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.foto} alt={p.nombre} className="h-28 w-full object-cover" />
              ) : (
                <div
                  className="flex h-28 items-center justify-center text-3xl"
                  style={{ backgroundColor: p.tono ?? "var(--superficie-2)" }}
                >
                  {p.emoji ?? <Tag className="size-6 text-texto-suave" aria-hidden />}
                </div>
              )}
              <div className="p-2.5">
                <p className="truncate text-sm font-medium text-texto">{p.nombre}</p>
                <p className="text-xs text-texto-suave">
                  {NOMBRES_CATEGORIA[p.categoria as keyof typeof NOMBRES_CATEGORIA] ?? p.categoria} ·{" "}
                  {pesos.format(p.precio)}
                </p>
                <div className="mt-2 flex gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() => setEditando(p)}
                    className="text-texto-suave underline underline-offset-2 hover:text-acento"
                  >
                    Editar
                  </button>
                  <button
                    type="button"
                    onClick={() => eliminar(p.id)}
                    className="text-texto-suave underline underline-offset-2 hover:text-acento"
                  >
                    Eliminar
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
