"use client";

import { Tag } from "lucide-react";
import type { MaterialDecoracion } from "@/lib/globos3d/figuras";
import { referenciaPorCodigo } from "@/lib/plan/referencia-sempertex";
import { BTN } from "./ui-taller";
import { useCotizacionTaller } from "./useCotizacionTaller";

const pesos = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });

/**
 * El precio de la lista de compra en la tienda en línea (D-038): el mismo cotizador que el plan y el «¿cuánto cuesta?» de
 * la vista guiada, así que la misma lista cuesta lo mismo aquí y allá. Se pide con el botón.
 */
export function SeccionPrecio({ materiales }: { materiales: ReadonlyArray<MaterialDecoracion> }) {
  const { estado, cotizar, demasiadas } = useCotizacionTaller(materiales);
  if (!materiales.length) return null;
  const cotizando = estado.estado === "cotizando";
  return (
    <section aria-label="Precio en la tienda" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="taller-rotulo">Precio en la tienda</h3>
        <button type="button" onClick={cotizar} disabled={cotizando || demasiadas} className={BTN}><Tag className="size-4" aria-hidden />{cotizando ? "Cotizando…" : estado.estado === "lista" ? "Volver a cotizar" : "Cotizar en la tienda"}</button>
      </div>
      {demasiadas && <p className="text-xs text-taller-suave">La lista es demasiado grande para cotizarla de una vez.</p>}
      {estado.estado === "error" && <p className="text-sm text-red-600" role="alert">{estado.mensaje}</p>}
      {estado.estado === "lista" && (
        <div aria-live="polite">
          <p className="text-[15px] font-semibold">Total: <span className="font-mono">{pesos.format(estado.cotizacion.total)}</span>{!estado.vigente && <span className="ml-2 text-xs font-normal text-taller-suave">(la escena cambió: vuelve a cotizar)</span>}</p>
          <ul className="text-sm">
            {estado.cotizacion.lineas.map((l) => (
              <li key={`${l.formatoId}|${l.codigo}|${l.unidadesPaquete}`} className="flex justify-between gap-3 border-b border-taller-linea py-1">
                <span className="min-w-0"><span className="font-mono">{l.paquetes}</span> × {l.nombre}</span>
                <span className="shrink-0 font-mono text-taller-suave">{pesos.format(l.subtotal)}</span>
              </li>
            ))}
          </ul>
          {estado.cotizacion.faltantes.length > 0 && (
            <p className="mt-1 text-xs text-red-600" role="note">Sin precio (la tienda no los vende en esa talla o color): {estado.cotizacion.faltantes.map((f) => `${f.cantidad} × ${f.formatoId} ${referenciaPorCodigo(f.codigo)?.nombreCompleto ?? f.codigo}`).join(", ")}.</p>
          )}
          <p className="mt-1 text-xs text-taller-suave">Con IVA y con los paquetes que vende la tienda. Incluye repuestos de cada globo (el {estado.cotizacion.mermaPorcentaje} %, al menos uno) salvo cuando comprarlos encarece de más. No incluye helio ni montaje.</p>
        </div>
      )}
    </section>
  );
}
