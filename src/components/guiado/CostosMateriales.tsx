import type { Cotizacion } from "@/lib/cotizacion/motor";
import { TarjetaCotizacion } from "@/components/TarjetaCotizacion";
import { CotizacionProfesional } from "@/components/cotizacion/CotizacionProfesional";

export function CostosMateriales({ cotizacion, uso, clave, onProveedores }: { cotizacion: Cotizacion | null; uso: "negocio" | "personal"; clave: string; onProveedores: () => void }) {
  return <section className="mt-4" aria-label="Costo de materiales">
    {cotizacion ? uso === "negocio"
      ? <CotizacionProfesional cotizacion={cotizacion} clave={clave} />
      : <><TarjetaCotizacion cotizacion={cotizacion} /><p className="mt-2 text-sm text-texto-secundario">Precio de e-commerce para materiales. No incluye montaje ni otros gastos.</p></>
      : <p className="rounded-xl bg-superficie p-4 text-sm">El costeo queda pendiente: estos datos de decoración son de ejemplo y aún no incluyen materiales asociados a variantes reales.</p>}
    {uso === "personal" && <button type="button" onClick={onProveedores} className="mt-4 w-full rounded-xl bg-acento px-5 py-4 text-base font-bold text-white shadow-sm">Cotiza con un proveedor cerca de ti</button>}
  </section>;
}
