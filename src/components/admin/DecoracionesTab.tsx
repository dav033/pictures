"use client";

import { useState } from "react";
import type { Decoracion, Producto } from "@/lib/types";
import { DecoracionForm } from "./DecoracionForm";

export function DecoracionesTab({
  decoraciones,
  productos,
  onCambio,
}: {
  decoraciones: Decoracion[];
  productos: Producto[];
  onCambio: (decoraciones: Decoracion[]) => void;
}) {
  const [editando, setEditando] = useState<Decoracion | "nuevo" | null>(null);

  function alGuardar(decoracion: Decoracion) {
    const existe = decoraciones.some((d) => d.id === decoracion.id);
    onCambio(
      existe
        ? decoraciones.map((d) => (d.id === decoracion.id ? decoracion : d))
        : [...decoraciones, decoracion],
    );
    setEditando(null);
  }

  async function eliminar(id: string) {
    if (!confirm("¿Eliminar esta decoración?")) return;
    const res = await fetch(`/api/decoraciones/${id}`, { method: "DELETE" });
    if (res.ok) onCambio(decoraciones.filter((d) => d.id !== id));
  }

  if (editando) {
    return (
      <DecoracionForm
        decoracion={editando === "nuevo" ? undefined : editando}
        productos={productos}
        onGuardado={alGuardar}
        onCancelar={() => setEditando(null)}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-texto-suave">{decoraciones.length} decoraciones armadas</p>
        <button
          type="button"
          onClick={() => setEditando("nuevo")}
          className="rounded-lg bg-acento px-3 py-1.5 text-sm font-medium text-white"
        >
          + Nueva decoración
        </button>
      </div>

      {productos.length === 0 && (
        <p className="text-xs text-texto-suave">
          Aún no hay productos en el catálogo — puedes crear la decoración igual y agregarle
          piezas después desde &ldquo;Editar&rdquo;.
        </p>
      )}

      {decoraciones.length === 0 ? (
        <p className="text-sm text-texto-suave">
          Aún no hay decoraciones. Arma paquetes curados a partir del catálogo.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {decoraciones.map((d) => (
            <div
              key={d.id}
              className="overflow-hidden rounded-xl border border-borde bg-superficie"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={d.imagen} alt={d.nombre} className="h-28 w-full object-cover" />
              <div className="p-2.5">
                <p className="truncate text-sm font-medium text-texto">{d.nombre}</p>
                <p className="text-xs text-texto-suave">
                  {d.elementos.length} elementos opcionales
                </p>
                <div className="mt-2 flex gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() => setEditando(d)}
                    className="text-texto-suave underline underline-offset-2 hover:text-acento"
                  >
                    Editar
                  </button>
                  <button
                    type="button"
                    onClick={() => eliminar(d.id)}
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
