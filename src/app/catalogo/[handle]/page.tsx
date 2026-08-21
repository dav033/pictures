import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { FichaProducto } from "@/components/catalogo/FichaProducto";
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
      <header className="flex items-baseline justify-between border-b border-borde bg-superficie px-5 py-3">
        <div>
          <h1 className="truncate text-base font-semibold text-texto">{producto.nombre}</h1>
          <p className="text-xs text-texto-suave">{producto.categoriaNombre}</p>
        </div>
        <Link
          href="/catalogo"
          className="flex shrink-0 items-center gap-1 text-xs text-texto-suave underline underline-offset-2 hover:text-acento"
        >
          <ArrowLeft className="size-3.5" aria-hidden />
          Volver al catálogo
        </Link>
      </header>

      <div className="flex-1 px-5 py-5">
        <FichaProducto producto={producto} />
      </div>
    </div>
  );
}
