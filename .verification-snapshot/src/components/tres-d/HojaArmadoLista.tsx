import { textoTiempo } from "@/lib/globos3d/bomba-segundos";
import type { TrozoLista } from "@/lib/globos3d/hoja-armado";
import { referenciaPorCodigo } from "@/lib/plan/referencia-sempertex";

/** La lista de compra de la escena (globos y tubitos de todas las piezas) y la bomba total, al final de la hoja. */
export function HojaArmadoLista({ trozo, segundosBomba }: { trozo: TrozoLista; segundosBomba: number }) {
  return (
    <section aria-label="Globos y tubitos" className="flex flex-col gap-3">
      <h3 className="border-b-2 border-neutral-800 pb-1 text-lg font-bold">Globos y tubitos{!trozo.primero && <span className="font-normal"> (continúa)</span>}</h3>
      {trozo.lineas.length > 0 && (
        <ul className="text-sm">
          {trozo.lineas.map((l) => (
            <li key={`${l.formatoId}|${l.codigo}`} className="flex break-inside-avoid items-center gap-2 py-0.5">
              <span className="size-3.5 shrink-0 rounded-full ring-1 ring-black/20" style={{ background: l.hex }} aria-hidden />
              <span className="w-12 shrink-0 text-right font-mono">{l.cantidad}</span>
              <span>× {l.formatoId} {referenciaPorCodigo(l.codigo)?.nombreCompleto ?? l.nombreColor} <span className="font-mono text-xs text-neutral-500">{l.codigo}</span></span>
            </li>
          ))}
        </ul>
      )}
      {trozo.ultimo && <p className="font-mono text-sm">Bomba total: {textoTiempo(segundosBomba)} (estimación para una bomba eléctrica estándar)</p>}
    </section>
  );
}
