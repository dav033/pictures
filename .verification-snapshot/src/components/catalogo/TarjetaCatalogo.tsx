import Link from "next/link";
import { PartyPopper } from "lucide-react";
import type { ProductoExplorador } from "@/lib/shopify/consultas";

const pesos = new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "COP",
  maximumFractionDigits: 0,
});

export function TarjetaCatalogo({ producto }: { producto: ProductoExplorador }) {
  const rangoPrecio =
    producto.precioMin === producto.precioMax
      ? pesos.format(producto.precioMin)
      : `${pesos.format(producto.precioMin)} – ${pesos.format(producto.precioMax)}`;

  return (
    <Link
      href={`/catalogo/${producto.handle}`}
      className="group flex flex-col overflow-hidden rounded-xl border border-borde bg-superficie transition hover:border-acento/50"
    >
      <div className="flex aspect-square items-center justify-center overflow-hidden bg-superficie-2">
        {producto.imagen ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={producto.imagen}
            alt={producto.nombre}
            loading="lazy"
            className="size-full object-cover transition group-hover:scale-105"
          />
        ) : (
          <PartyPopper className="size-8 text-texto-suave" aria-hidden />
        )}
      </div>
      <div className="flex flex-1 flex-col gap-1 p-3">
        <span className="line-clamp-2 text-sm font-medium text-texto">{producto.nombre}</span>
        <span className="text-xs text-texto-suave">{producto.categoriaNombre}</span>
        <span className="mt-auto text-sm font-medium text-acento">{rangoPrecio}</span>
        {!producto.disponible && (
          <span className="text-xs text-texto-suave">Agotado temporalmente</span>
        )}
      </div>
    </Link>
  );
}
