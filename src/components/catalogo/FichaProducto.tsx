"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { PartyPopper } from "lucide-react";
import { useSeleccion } from "@/lib/estado/seleccion";
import type { Producto } from "@/lib/types";
import type { ProductoDetalle, VarianteDetalle } from "@/lib/shopify/consultas";

const pesos = new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "COP",
  maximumFractionDigits: 0,
});

function varianteAProducto(p: ProductoDetalle, v: VarianteDetalle): Producto {
  return {
    id: v.id,
    nombre: v.tamano ? `${p.nombre} — ${v.tamano}` : p.nombre,
    categoria: p.categoriaNombre,
    estilos: [],
    colores: p.colores,
    descripcion: p.nombre,
    precio: v.precio,
    unidadesPaquete: v.unidadesPaquete,
    foto: p.imagenPrincipal ?? undefined,
  };
}

export function FichaProducto({ producto }: { producto: ProductoDetalle }) {
  const router = useRouter();
  const { estaSeleccionado, alternar, agregarVarios } = useSeleccion();
  const imagenes = producto.imagenes.length
    ? producto.imagenes
    : [producto.imagenPrincipal].filter((x): x is string => Boolean(x));
  const [imagenActiva, setImagenActiva] = useState<string | null>(imagenes[0] ?? null);

  function preguntarAlAsistente() {
    const variante = producto.variantes.find((v) => v.disponible) ?? producto.variantes[0];
    if (variante) agregarVarios([varianteAProducto(producto, variante)]);
    router.push("/");
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,26rem)_1fr]">
      <div className="space-y-3">
        <div className="relative flex aspect-square items-center justify-center overflow-hidden rounded-xl border border-borde bg-superficie-2">
          <AnimatePresence mode="wait">
            {imagenActiva ? (
              <motion.img
                key={imagenActiva}
                src={imagenActiva}
                alt={producto.nombre}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="absolute inset-0 size-full object-cover"
              />
            ) : (
              <PartyPopper className="size-10 text-texto-suave" aria-hidden />
            )}
          </AnimatePresence>
        </div>
        {imagenes.length > 1 && (
          <div className="flex gap-2 overflow-x-auto">
            {imagenes.map((src) => (
              <button
                key={src}
                type="button"
                onClick={() => setImagenActiva(src)}
                className={`size-14 shrink-0 overflow-hidden rounded-lg border ${
                  imagenActiva === src ? "border-acento" : "border-borde"
                }`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src} alt="" className="size-full object-cover" />
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-5">
        {producto.descripcion && <p className="text-sm text-texto-suave">{producto.descripcion}</p>}

        {(producto.colores.length > 0 || producto.ocasiones.length > 0) && (
          <div className="flex flex-wrap gap-1.5">
            {[...producto.colores, ...producto.ocasiones].map((tag) => (
              <span
                key={tag}
                className="rounded-full border border-borde bg-superficie px-2.5 py-1 text-xs text-texto-suave"
              >
                {tag}
              </span>
            ))}
          </div>
        )}

        <button
          type="button"
          onClick={preguntarAlAsistente}
          className="rounded-xl border border-acento px-4 py-2 text-sm font-medium text-acento transition hover:bg-acento-suave"
        >
          Preguntarle al asistente sobre esta pieza
        </button>

        <div>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-texto-suave">
            Presentaciones ({producto.variantes.length})
          </h2>
          <div className="overflow-x-auto rounded-xl border border-borde">
            <table className="w-full text-left text-sm">
              <thead className="bg-superficie-2 text-xs text-texto-suave">
                <tr>
                  <th className="px-3 py-2">Tamaño</th>
                  <th className="px-3 py-2">Precio</th>
                  <th className="px-3 py-2">Unidades</th>
                  <th className="px-3 py-2">Stock</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {producto.variantes.map((v) => {
                  const seleccionado = estaSeleccionado(v.id);
                  return (
                    <tr
                      key={v.id}
                      className={`border-t border-borde transition-colors ${
                        seleccionado ? "bg-acento-suave" : "hover:bg-superficie-2"
                      }`}
                    >
                      <td className="px-3 py-2 text-texto">{v.tamano ?? "—"}</td>
                      <td className="px-3 py-2 text-texto">{pesos.format(v.precio)}</td>
                      <td className="px-3 py-2 text-texto-suave">paquete de {v.unidadesPaquete}</td>
                      <td className="px-3 py-2 text-texto-suave">
                        {!v.disponible
                          ? "Agotado"
                          : v.inventarioFuente === "cdn"
                            ? `${v.inventario} en stock`
                            : "Disponible"}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button
                          type="button"
                          disabled={!v.disponible}
                          onClick={() => alternar(varianteAProducto(producto, v))}
                          className={`rounded-lg border px-3 py-1 text-xs transition disabled:opacity-40 ${
                            seleccionado
                              ? "border-acento bg-acento-suave text-acento"
                              : "border-borde text-texto hover:border-acento/50"
                          }`}
                        >
                          {seleccionado ? "Quitar" : "Añadir"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
