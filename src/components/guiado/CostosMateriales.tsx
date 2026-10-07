import type { Cotizacion } from "@/lib/cotizacion/motor";
import type { DecoracionSempertex } from "@/lib/biblioteca-sempertex/esquemas";
import { CotizacionProfesional } from "@/components/cotizacion/CotizacionProfesional";
import { CotizacionPersonalGuiada } from "./CotizacionPersonalGuiada";

/** Precio de los materiales de una idea elegida; `decoracion` da el nombre de cada globo en palabras de cliente. */
export function CostosMateriales({ cotizacion, decoracion, uso, clave, onProveedores, mensajePendiente }: { cotizacion: Cotizacion | null; decoracion?: DecoracionSempertex; uso: "negocio" | "personal"; clave: string; onProveedores: () => void; mensajePendiente: string }) {
  return <section className="mt-4" aria-label="Costo de materiales">
    {cotizacion ? uso === "negocio"
      ? <CotizacionProfesional cotizacion={cotizacion} clave={clave} />
      : <CotizacionPersonalGuiada cotizacion={cotizacion} {...(decoracion ? { decoracion } : {})} />
      : <p className="rounded-xl bg-superficie p-4 text-sm">{mensajePendiente}</p>}
    {uso === "personal" && <button type="button" onClick={onProveedores} className="mt-4 w-full rounded-xl bg-acento px-5 py-4 text-base font-bold text-sobre-acento shadow-sm">Cotiza con un proveedor cerca de ti</button>}
  </section>;
}
