import Link from "next/link";
import { Suspense } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { BarraSeleccion } from "@/components/catalogo/BarraSeleccion";
import { Facetas } from "@/components/catalogo/Facetas";
import { GridCatalogo } from "@/components/catalogo/GridCatalogo";
import { InterruptorTema } from "@/components/ui/interruptor-tema";
import { explorarCatalogo, facetasCatalogo, type FiltrosCatalogo } from "@/lib/shopify/consultas";

// Página de búsqueda: `searchParams` fuerza render dinámico por request. No
// tiene sentido un shell estático aquí — se acepta el bloqueo (igual que /admin).
export const instant = false;

const POR_PAGINA = 40;

function listaDe(valor: string | string[] | undefined): string[] {
  if (!valor) return [];
  const cadena = Array.isArray(valor) ? valor[0] : valor;
  return cadena.split(",").filter(Boolean);
}

export default async function CatalogoPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const pagina = Math.max(1, Number(Array.isArray(params.pagina) ? params.pagina[0] : params.pagina) || 1);

  const filtros: FiltrosCatalogo = {
    texto: Array.isArray(params.q) ? params.q[0] : params.q,
    categorias: listaDe(params.categoria),
    colores: listaDe(params.color),
    formas: listaDe(params.forma),
    ocasiones: listaDe(params.ocasion),
    solo_disponibles: params.disponible !== "0",
  };

  const [{ productos, total }, facetas] = await Promise.all([
    explorarCatalogo(filtros, pagina, POR_PAGINA),
    facetasCatalogo(),
  ]);

  const totalPaginas = Math.max(1, Math.ceil(total / POR_PAGINA));

  return (
    <div className="flex flex-1 flex-col">
      <header className="flex items-center justify-between gap-3 border-b border-borde-suave bg-fondo px-4 py-2.5 sm:px-5">
        <div className="min-w-0">
          <h1 className="text-base font-semibold text-texto">Catálogo</h1>
          <p className="text-xs text-texto-suave">{total} productos — Sempertex, precios B2C</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Link href="/" className="ui-button-ghost flex items-center gap-1 rounded-lg px-2 py-1.5">
            <ArrowLeft className="size-3.5" aria-hidden />
            Volver al chat
          </Link>
          <InterruptorTema />
        </div>
      </header>

      <div className="grid flex-1 grid-cols-1 gap-5 px-4 py-5 sm:px-5 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <aside className="min-w-0">
          <Suspense fallback={null}>
            <Facetas
              categorias={facetas.categorias}
              colores={facetas.colores}
              formas={facetas.formas}
              ocasiones={facetas.ocasiones}
            />
          </Suspense>
        </aside>

        <section className="min-w-0">
          {productos.length === 0 ? (
            <p className="text-sm text-texto-suave">
              No hay productos con estos filtros. Prueba quitando alguno.
            </p>
          ) : (
            <GridCatalogo productos={productos} key={JSON.stringify(filtros) + pagina} />
          )}

          {totalPaginas > 1 && (
            <nav className="mt-6 flex flex-wrap items-center justify-center gap-3 text-sm">
              {pagina > 1 && (
                <Link
                  href={`/catalogo?${new URLSearchParams({ ...paramsAString(params), pagina: String(pagina - 1) }).toString()}`}
                  className="ui-button-secondary"
                >
                  <ArrowLeft className="size-3.5" aria-hidden />
                  Anterior
                </Link>
              )}
              <span className="text-texto-suave">
                Página {pagina} de {totalPaginas}
              </span>
              {pagina < totalPaginas && (
                <Link
                  href={`/catalogo?${new URLSearchParams({ ...paramsAString(params), pagina: String(pagina + 1) }).toString()}`}
                  className="ui-button-secondary"
                >
                  Siguiente
                  <ArrowRight className="size-3.5" aria-hidden />
                </Link>
              )}
            </nav>
          )}
        </section>
      </div>

      <BarraSeleccion />
    </div>
  );
}

function paramsAString(params: Record<string, string | string[] | undefined>): Record<string, string> {
  const resultado: Record<string, string> = {};
  for (const [clave, valor] of Object.entries(params)) {
    if (clave === "pagina") continue;
    if (typeof valor === "string" && valor) resultado[clave] = valor;
    else if (Array.isArray(valor) && valor[0]) resultado[clave] = valor[0];
  }
  return resultado;
}
