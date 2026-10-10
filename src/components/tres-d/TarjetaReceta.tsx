"use client";

import { useMemo } from "react";
import type { ProductosDeItem, ItemBiblioteca } from "@/lib/globos3d/biblioteca";
import { hexDeCodigo } from "@/lib/globos3d/decoraciones-escena";
import { piezasDeContenido, recetaDeIdea } from "@/lib/globos3d/receta-idea";
import type { EscenaArmada } from "@/lib/globos3d/escena";

const TARJETA = "rounded-2xl bg-superficie ring-1 ring-borde";
const ETIQUETA = "rounded-full bg-superficie-suave px-2 py-0.5 text-[0.7rem] text-texto-suave ring-1 ring-borde";

/**
 * La receta de una idea del catálogo: cuántos globos de cada color y tamaño (matriz), de qué piezas está hecha, sus
 * medidas, su técnica y sus ocasiones (las de la ficha). Los datos los arma `recetaDeIdea`.
 */
export function TarjetaReceta({ item, productos, armada }: { item: ItemBiblioteca; productos: ProductosDeItem; armada: EscenaArmada | null }) {
  const receta = useMemo(() => recetaDeIdea({
    piezas: piezasDeContenido(item.contenido),
    productos,
    cajas: (armada?.porNodo ?? []).filter((n) => n.copias > 0).map((n) => n.caja),
    ocasiones: item.ocasiones,
  }), [item, productos, armada]);

  if (receta.total === 0) return null;

  return (
    <section className={`${TARJETA} flex flex-col gap-3 p-3`} aria-label="Receta">
      <header className="flex flex-col gap-1.5">
        <h3 className="text-sm font-semibold text-texto">Receta <span className="font-normal text-texto-suave">· {receta.total} globos</span></h3>
        <div className="flex flex-wrap gap-1.5">
          {receta.tecnicas.map((t) => <span key={t} className={`${ETIQUETA} text-texto`}>{t}</span>)}
          {receta.ocasiones.map((o) => <span key={o} className={ETIQUETA}>{o}</span>)}
        </div>
      </header>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-texto-suave">Estructura</h4>
          <ul className="text-sm text-texto">
            {receta.piezas.map((p) => <li key={p.nombre}>{p.cantidad > 1 ? `${p.cantidad} × ` : ""}{p.nombre}</li>)}
          </ul>
        </div>
        <div className="flex flex-col gap-1">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-texto-suave">Medidas aprox.</h4>
          <p className="font-mono text-sm text-texto">
            {receta.medidas ? `${receta.medidas.altoCm} × ${receta.medidas.anchoCm} × ${receta.medidas.fondoCm} cm (alto × ancho × fondo)` : "Sin medidas"}
          </p>
        </div>
      </div>

      <div className="-mx-1 overflow-x-auto px-1">
        <table className="w-full min-w-max border-collapse text-left text-sm">
          <caption className="sr-only">Globos por color y tamaño</caption>
          <thead>
            <tr className="text-xs text-texto-suave">
              <th scope="col" className="py-1 pr-3 font-normal">Color</th>
              {receta.tamanos.map((t) => <th key={t.formatoId} scope="col" className="px-2 py-1 text-right font-normal">{t.formatoId}</th>)}
              <th scope="col" className="py-1 pl-2 text-right font-semibold text-texto">Total</th>
            </tr>
          </thead>
          <tbody>
            {receta.colores.map((c) => (
              <tr key={c.codigo} className="border-t border-borde">
                <th scope="row" className="py-1.5 pr-3 font-normal text-texto">
                  <span className="inline-flex items-center gap-2">
                    <span aria-hidden className="size-3.5 rounded-full ring-1 ring-borde" style={{ background: hexDeCodigo(c.codigo) }} />
                    {c.color} <span className="font-mono text-xs text-texto-suave">{c.codigo}</span>
                  </span>
                </th>
                {receta.tamanos.map((t) => <td key={t.formatoId} className="px-2 py-1.5 text-right font-mono text-texto">{c.porTamano[t.formatoId] ?? "·"}</td>)}
                <td className="py-1.5 pl-2 text-right font-mono font-semibold text-texto">{c.total}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-borde text-xs text-texto-suave">
              <th scope="row" className="py-1.5 pr-3 font-normal">Total por tamaño</th>
              {receta.tamanos.map((t) => <td key={t.formatoId} className="px-2 py-1.5 text-right font-mono">{t.cantidad}</td>)}
              <td className="py-1.5 pl-2 text-right font-mono font-semibold text-texto">{receta.total}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}
