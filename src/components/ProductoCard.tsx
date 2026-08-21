"use client";

import { Check } from "lucide-react";
import { NOMBRES_CATEGORIA } from "@/lib/catalog-data";
import type { Producto } from "@/lib/types";

const pesos = new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "COP",
  maximumFractionDigits: 0,
});

export function ProductoCard({
  producto,
  seleccionado,
  onToggle,
}: {
  producto: Producto;
  seleccionado: boolean;
  onToggle: (id: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onToggle(producto.id)}
      aria-pressed={seleccionado}
      className={`ui-pressable group flex min-h-[4.5rem] w-full items-center gap-3 rounded-xl border p-2 text-left ${
        seleccionado
          ? "border-acento bg-acento-suave"
          : "border-borde bg-superficie hover:border-acento/50"
      }`}
    >
      {producto.foto ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={producto.foto}
          alt={producto.nombre}
          className="size-14 shrink-0 rounded-lg object-cover"
        />
      ) : (
        <span
          aria-hidden
          className="flex size-14 shrink-0 items-center justify-center rounded-lg text-xs font-semibold uppercase tracking-wide text-texto-suave"
          style={{ backgroundColor: producto.tono ?? "var(--superficie-2)" }}
        >
          Sin foto
        </span>
      )}

      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-texto">
          {producto.nombre}
        </span>
        <span className="block text-xs text-texto-suave">
          {NOMBRES_CATEGORIA[producto.categoria as keyof typeof NOMBRES_CATEGORIA] ??
            producto.categoria}{" "}
          / {pesos.format(producto.precio)}
          {producto.unidadesPaquete ? ` / paquete de ${producto.unidadesPaquete}` : ""}
        </span>
      </span>

      <span
        aria-hidden
        className={`flex size-5 shrink-0 items-center justify-center rounded-full border ${
          seleccionado
            ? "border-acento bg-acento text-white"
            : "border-borde text-transparent group-hover:border-acento/50"
        }`}
      >
        <Check className="size-3" strokeWidth={3} />
      </span>
    </button>
  );
}
