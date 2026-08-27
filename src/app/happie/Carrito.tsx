"use client";

import { useState } from "react";
import { ShoppingBag, Trash2, Plus, Minus, Info, ArrowRight, Check } from "lucide-react";
import type { HappiaPackage } from "@sempertex/happie-package-ia";
import { ArtePaquete } from "./Tema";

export type ItemCarrito = {
  paquete: HappiaPackage;
  cantidad: number;
};

export function Carrito({
  items,
  onCambiarCantidad,
  onQuitar,
}: {
  items: ItemCarrito[];
  onCambiarCantidad: (packageId: string, delta: number) => void;
  onQuitar: (packageId: string) => void;
}) {
  const [solicitada, setSolicitada] = useState(false);
  const totalItems = items.reduce((acc, item) => acc + item.cantidad, 0);

  return (
    <aside className="flex h-fit flex-col gap-3.5 rounded-[18px] border border-borde bg-superficie p-5 shadow-[0_2px_10px_var(--sombra)]">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShoppingBag className="h-4 w-4 text-texto" strokeWidth={1.8} />
          <span className="text-sm font-semibold text-texto">Tu selección</span>
        </div>
        {totalItems > 0 && (
          <span className="flex min-w-[22px] items-center justify-center rounded-full bg-acento px-1.5 py-0 text-xs font-semibold text-white">
            {totalItems}
          </span>
        )}
      </div>

      {items.length === 0 && (
        <p className="text-xs text-texto-suave">Aún no has agregado paquetes. Toca &ldquo;Agregar&rdquo; en el que te guste.</p>
      )}

      {items.length > 0 && (
        <>
          <div className="h-px bg-acento-suave" />

          <div className="flex flex-col gap-3">
            {items.map(({ paquete, cantidad }) => (
              <div key={paquete.id} className="flex items-center gap-3">
                <ArtePaquete nombre={paquete.name} className="h-11 w-11 shrink-0 rounded-[10px]" />
                <div className="flex flex-grow flex-col gap-0.5 overflow-hidden">
                  <span className="truncate text-[13px] font-medium text-texto">{paquete.name}</span>
                  <span className="text-[11.5px] text-texto-suave">{paquete.base_guests} invitados base</span>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <button
                    onClick={() => onCambiarCantidad(paquete.id, -1)}
                    className="flex h-[22px] w-[22px] items-center justify-center rounded-[7px] border border-borde text-texto-suave"
                  >
                    <Minus className="h-2.5 w-2.5" strokeWidth={2.6} />
                  </button>
                  <span className="w-3 text-center text-[13px] font-semibold text-texto">{cantidad}</span>
                  <button
                    onClick={() => onCambiarCantidad(paquete.id, 1)}
                    className="flex h-[22px] w-[22px] items-center justify-center rounded-[7px] border border-borde text-texto-suave"
                  >
                    <Plus className="h-2.5 w-2.5" strokeWidth={2.6} />
                  </button>
                  <button onClick={() => onQuitar(paquete.id)} className="p-0.5 text-texto-suave hover:text-error">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="flex items-start gap-2 rounded-xl bg-fondo p-3">
            <Info className="h-3.5 w-3.5 shrink-0 text-acento" strokeWidth={1.8} />
            <span className="text-[11.5px] leading-relaxed text-texto-suave">
              Un asesor confirma disponibilidad y valor antes de cerrar.
            </span>
          </div>

          {solicitada ? (
            <div className="flex items-center justify-center gap-2 rounded-xl bg-exito-suave py-3 text-[13px] font-semibold text-exito">
              <Check className="h-4 w-4" strokeWidth={2.6} />
              Listo, un asesor te escribe pronto
            </div>
          ) : (
            <button
              onClick={() => setSolicitada(true)}
              className="flex items-center justify-center gap-1.5 rounded-xl bg-acento py-3 text-[13px] font-semibold text-white shadow-[0_6px_16px_var(--sombra-acento)]"
            >
              Solicitar cotización
              <ArrowRight className="h-3.5 w-3.5" strokeWidth={2.2} />
            </button>
          )}
        </>
      )}
    </aside>
  );
}
