import Link from "next/link";
import { Suspense } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { BarraSeleccion } from "@/components/catalogo/BarraSeleccion";
import { Facetas } from "@/components/catalogo/Facetas";
import { GridCatalogo } from "@/components/catalogo/GridCatalogo";
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
      <header className="flex items-baseline justify-between border-b border-borde bg-superficie px-5 py-3">
        <div>
          <h1 className="text-base font-semibold text-texto">Catálogo</h1>
          <p className="text-xs text-texto-suave">{total} productos — Sempertex, precios B2C</p>
        </div>
        <Link
          href="/"
          className="flex items-center gap-1 text-xs text-texto-suave underline underline-offset-2 hover:text-acento"
        >
          <ArrowLeft className="size-3.5" aria-hidden />
          Volver al chat
        </Link>
      </header>

      <div className="grid flex-1 grid-cols-1 gap-5 px-5 py-5 lg:grid-cols-[16rem_1fr]">
        <aside>
          <Suspense fallback={null}>
            <Facetas
              categorias={facetas.categorias}
              colores={facetas.colores}
              formas={facetas.formas}
              ocasiones={facetas.ocasiones}
            />
          </Suspense>
        </aside>

        <section>
          {productos.length === 0 ? (
            <p className="text-sm text-texto-suave">
              No hay productos con estos filtros. Prueba quitando alguno.
            </p>
          ) : (
            <GridCatalogo productos={productos} key={JSON.stringify(filtros) + pagina} />
          )}

          {totalPaginas > 1 && (
            <nav className="mt-6 flex items-center justify-center gap-3 text-sm">
              {pagina > 1 && (
                <Link
                  href={`/catalogo?${new URLSearchParams({ ...paramsAString(params), pagina: String(pagina - 1) }).toString()}`}
                  className="flex items-center gap-1.5 rounded-lg border border-borde px-3 py-1.5 text-texto hover:border-acento"
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
                  className="flex items-center gap-1.5 rounded-lg border border-borde px-3 py-1.5 text-texto hover:border-acento"
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
