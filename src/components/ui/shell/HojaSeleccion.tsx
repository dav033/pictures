"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useState, type FormEvent } from "react";
import { Plus, X } from "lucide-react";
import type { Producto } from "@/lib/types";

type Props = {
  abierta: boolean;
  onCerrar: () => void;
  seleccionados: readonly Producto[];
  onQuitar: (id: string) => void;
  onAgregarManual: (pieza: { nombre: string; descripcion: string; precio: number }) => void;
  /** Botón de generar sin propuesta; undefined cuando la imagen solo sale de aprobar una propuesta. */
  generar?: { etiqueta: string; deshabilitado: boolean; ayuda: string | null };
  onGenerar: () => void;
};

/**
 * Selección manual como hoja lateral (antes era una columna fija): la usa el
 * flujo sin propuesta — piezas tocadas en el chat, decoraciones armadas,
 * /catalogo o agregadas a mano — y `generar()` la manda a la imagen.
 */
export function HojaSeleccion({ abierta, onCerrar, seleccionados, onQuitar, onAgregarManual, generar, onGenerar }: Props) {
  const [agregando, setAgregando] = useState(false);
  const [nombre, setNombre] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [precio, setPrecio] = useState("");

  function enviarManual(evento: FormEvent) {
    evento.preventDefault();
    const limpio = nombre.trim();
    if (!limpio) return;
    onAgregarManual({ nombre: limpio, descripcion: descripcion.trim(), precio: Number(precio) || 0 });
    setNombre("");
    setDescripcion("");
    setPrecio("");
    setAgregando(false);
  }

  return (
    <Dialog.Root open={abierta} onOpenChange={(valor) => { if (!valor) onCerrar(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="hoja-fondo" />
        <Dialog.Content className="hoja outline-none" data-testid="hoja-seleccion" aria-describedby="hoja-seleccion-ayuda">
          <div className="flex items-center justify-between gap-3 border-b border-borde-suave px-5 py-4">
            <Dialog.Title className="text-base font-semibold">Tu selección ({seleccionados.length})</Dialog.Title>
            <Dialog.Close className="ui-icon-button" aria-label="Cerrar selección">
              <X className="size-4" aria-hidden="true" />
            </Dialog.Close>
          </div>
          <div className="scroll-suave min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
            <p id="hoja-seleccion-ayuda" className="text-sm text-texto-suave">
              Piezas que elegiste en el chat o en el catálogo. Puedes quitar o agregar piezas tú mismo.
            </p>

            {seleccionados.length === 0 ? (
              <p className="rounded-xl bg-superficie-suave px-3 py-3 text-sm text-texto-suave">
                Pide recomendaciones en el chat y elige las piezas que te gusten.
              </p>
            ) : (
              <ul className="divide-y divide-borde-suave rounded-xl border border-borde-suave">
                {seleccionados.map((producto) => (
                  <li key={producto.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                    {producto.foto ? (
                      // eslint-disable-next-line @next/next/no-img-element -- foto del catálogo (dominio externo variable)
                      <img src={producto.foto} alt="" className="size-9 shrink-0 rounded-lg bg-superficie-2 object-cover" />
                    ) : (
                      <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-lg bg-superficie-2 text-xs font-semibold uppercase text-texto-suave">
                        {producto.nombre.slice(0, 1)}
                      </span>
                    )}
                    <span className="min-w-0 flex-1 truncate">{producto.nombre}</span>
                    <button type="button" onClick={() => onQuitar(producto.id)} aria-label={`Quitar ${producto.nombre}`} className="ui-icon-button size-8">
                      <X className="size-3.5" aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {agregando ? (
              <form onSubmit={enviarManual} className="space-y-2 rounded-xl border border-borde-suave bg-superficie-suave p-3">
                <label className="block text-xs font-medium text-texto-suave">
                  Nombre de la pieza
                  <input value={nombre} onChange={(evento) => setNombre(evento.target.value)} required autoFocus className="ui-input mt-1" />
                </label>
                <label className="block text-xs font-medium text-texto-suave">
                  Descripción visual (para dibujarla)
                  <textarea value={descripcion} onChange={(evento) => setDescripcion(evento.target.value)} rows={2} className="ui-input mt-1 resize-none" />
                </label>
                <label className="block text-xs font-medium text-texto-suave">
                  Precio (opcional)
                  <input value={precio} onChange={(evento) => setPrecio(evento.target.value)} type="number" min={0} inputMode="numeric" className="ui-input mt-1" />
                </label>
                <div className="flex justify-end gap-2 pt-1">
                  <button type="button" onClick={() => setAgregando(false)} className="ui-button-secondary min-h-9 px-3 py-1.5">Cancelar</button>
                  <button type="submit" className="ui-button-primary min-h-9 px-3 py-1.5">Agregar</button>
                </div>
              </form>
            ) : (
              <button type="button" onClick={() => setAgregando(true)} className="inline-flex items-center gap-1.5 text-sm font-medium text-acento hover:underline">
                <Plus className="size-4" aria-hidden="true" />
                Agregar una pieza a mano
              </button>
            )}
          </div>
          {generar && (
            <div className="space-y-2 border-t border-borde-suave px-5 py-4">
              <button type="button" onClick={onGenerar} disabled={generar.deshabilitado} className="ui-button-primary w-full" data-testid="generar-sin-propuesta">
                {generar.etiqueta}
              </button>
              {generar.ayuda && <p className="text-xs text-texto-suave">{generar.ayuda}</p>}
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
