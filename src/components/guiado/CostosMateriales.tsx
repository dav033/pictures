import type { Cotizacion } from "@/lib/cotizacion/motor";
import type { DecoracionSempertex } from "@/lib/biblioteca-sempertex/esquemas";
import { CotizacionProfesional } from "@/components/cotizacion/CotizacionProfesional";
import { notaNoIncluidos, type NoIncluidoEnPrecio } from "@/lib/guiada-motor/no-incluidos";
import { CotizacionPersonalGuiada } from "./CotizacionPersonalGuiada";

/**
 * Precio de los materiales de una idea elegida o de un plan; `decoracion` da el nombre de cada globo en palabras de
 * cliente y `titulos` (los del plan, por variante) el globo del catálogo, como la tarjeta y «Ver detalle».
 */
export function CostosMateriales({ cotizacion, decoracion, titulos, uso, clave, onProveedores, mensajePendiente, notaFlores = null, noIncluidos }: { cotizacion: Cotizacion | null; decoracion?: DecoracionSempertex; titulos?: ReadonlyMap<string, string>; uso: "negocio" | "personal"; clave: string; onProveedores: () => void; mensajePendiente: string; /** «Incluye flores de globo: …» (`notaFloresCotizacion`): sus globos ya están en las líneas. */ notaFlores?: string | null; /** Lo que la lista de la idea pide y el precio no cuenta (`datos.noIncluidos` del turno, que no se guarda en la sesión): se dice junto al total. */ noIncluidos?: ReadonlyArray<NoIncluidoEnPrecio> }) {
  return <section className="mt-4" aria-label="Costo de materiales">
    {cotizacion && notaFlores && <p className="mb-2 text-xs text-texto-suave" data-testid="nota-flores-cotizacion">{notaFlores}</p>}
    {cotizacion && notaNoIncluidos(noIncluidos) && <p className="mb-2 text-xs text-texto-suave" role="note" data-testid="nota-no-incluidos-cotizacion">{notaNoIncluidos(noIncluidos)}</p>}
    {cotizacion ? uso === "negocio"
      ? <CotizacionProfesional cotizacion={cotizacion} clave={clave} />
      : <CotizacionPersonalGuiada cotizacion={cotizacion} {...(decoracion ? { decoracion } : {})} {...(titulos ? { titulos } : {})} />
      : <p className="rounded-xl bg-superficie p-4 text-sm">{mensajePendiente}</p>}
    {uso === "personal" && <button type="button" onClick={onProveedores} className="mt-4 w-full rounded-xl bg-acento px-5 py-4 text-base font-bold text-sobre-acento shadow-sm">Cotiza con un proveedor cerca de ti</button>}
  </section>;
}
