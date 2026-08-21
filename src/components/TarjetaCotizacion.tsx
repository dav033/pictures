import type { Cotizacion } from "@/lib/cotizacion/motor";

const pesos = new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "COP",
  maximumFractionDigits: 0,
});

export function TarjetaCotizacion({ cotizacion }: { cotizacion: Cotizacion }) {
  return (
    <div className="mt-3 max-w-[85%] space-y-2 rounded-xl border border-borde bg-superficie p-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-texto">Cotización</span>
        <span className="text-sm font-semibold text-acento">{pesos.format(cotizacion.total)}</span>
      </div>

      <ul className="space-y-1.5 text-sm text-texto">
        {cotizacion.lineas.map((linea, i) => (
          <li key={i} className="flex flex-col">
            {linea.sinReferencia ? (
              <span className="text-texto-suave">
                {linea.tamano}
                {linea.color ? ` ${linea.color}` : ""} · sin referencia disponible en el catálogo
              </span>
            ) : (
              <>
                <span className="flex justify-between">
                  <span className="truncate">{linea.nombre}</span>
                  <span>{pesos.format(linea.subtotal ?? 0)}</span>
                </span>
                <span className="text-xs text-texto-suave">
                  {linea.paquetes} paquete{linea.paquetes === 1 ? "" : "s"} de {linea.unidadesPaquete} ·
                  necesitas {linea.cantidadNecesaria}
                  {linea.sobrante ? ` · ${linea.sobrante} de sobra` : ""}
                  {!linea.disponible ? " · agotado" : ""}
                </span>
              </>
            )}
          </li>
        ))}
      </ul>

      <p className="text-xs text-texto-suave">
        Incluye {cotizacion.mermaPorcentaje}% de merma por reventones al inflar/montar · precios{" "}
        {cotizacion.incluyeIva ? "con IVA incluido" : "sin IVA"} · no incluye montaje ni complementos.
      </p>
    </div>
  );
}
