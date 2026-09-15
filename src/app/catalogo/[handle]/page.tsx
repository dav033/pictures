import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { FichaProducto } from "@/components/catalogo/FichaProducto";
import { InterruptorTema } from "@/components/ui/interruptor-tema";
import { productoPorHandle } from "@/lib/shopify/consultas";

// `params` es una API de request-time; sin esto, Next intenta prerenderizar
// esta ruta (no hay generateStaticParams) y falla en build. Igual que
// /catalogo y /admin: es una página leída en vivo, se acepta el bloqueo.
export const instant = false;

export default async function ProductoPage({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const { handle } = await params;
  const producto = productoPorHandle(handle);
  if (!producto) notFound();

  return (
    <div className="flex flex-1 flex-col">
      <header className="flex items-center justify-between gap-3 border-b border-borde-suave bg-fondo px-4 py-2.5 sm:px-5">
        <div className="min-w-0">
          <h1 className="truncate text-base font-semibold text-texto">{producto.nombre}</h1>
          <p className="text-xs text-texto-suave">{producto.categoriaNombre}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Link href="/catalogo" className="ui-button-ghost flex items-center gap-1 rounded-lg px-2 py-1.5">
            <ArrowLeft className="size-3.5" aria-hidden />
            Volver al catálogo
          </Link>
          <InterruptorTema />
        </div>
      </header>

      <div className="min-w-0 flex-1 px-4 py-5 sm:px-5">
        <FichaProducto producto={producto} />
      </div>
    </div>
  );
}
