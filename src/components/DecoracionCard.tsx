"use client";

import type { DecoracionConProductos } from "@/lib/types";

export function DecoracionCard({
  decoracion,
  onElegir,
}: {
  decoracion: DecoracionConProductos;
  onElegir: (decoracion: DecoracionConProductos) => void;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-borde bg-superficie shadow-[0_8px_20px_var(--sombra)]">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={decoracion.imagen}
        alt={decoracion.nombre}
        className="aspect-[16/9] w-full bg-superficie-2 object-cover"
      />
      <div className="p-3">
        <p className="text-sm font-medium text-texto">{decoracion.nombre}</p>
        {decoracion.descripcion && (
          <p className="mt-0.5 text-xs text-texto-suave">{decoracion.descripcion}</p>
        )}

        {decoracion.productos.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {decoracion.productos.map((p) => (
              <li
                key={p.id}
                className="flex items-center gap-1 rounded-full border border-borde bg-fondo px-2 py-0.5 text-xs text-texto-suave"
              >
                {p.nombre}
              </li>
            ))}
          </ul>
        )}

        <button
          type="button"
          onClick={() => onElegir(decoracion)}
          className="ui-button-primary ui-pressable mt-3 w-full"
        >
          Usar esta decoración
        </button>
      </div>
    </div>
  );
}
