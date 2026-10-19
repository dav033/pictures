import { textoTiempo } from "@/lib/globos3d/bomba-segundos";
import { anexosDeFila, dondeDeFila, marcasDeLinea, type FilaCompacta } from "@/lib/globos3d/hoja-armado-compacta";
import { textoNombres } from "@/lib/globos3d/hoja-armado-texto";

/**
 * Las piezas pequeñas (hasta 3 globos por copia) y las que solo llevan tubos o links, en una tabla: una fila por lo que
 * lleva cada copia, con cuántas copias hay. Los tubos y links se inflan enteros.
 */
export function HojaArmadoCompacta({ filas, primero }: { filas: FilaCompacta[]; primero: boolean }) {
  return (
    <section aria-label="Piezas pequeñas y tubos" className="flex flex-col gap-2">
      {primero ? (
        <>
          <h3 className="border-b-2 border-neutral-800 pb-1 text-lg font-bold">Piezas pequeñas, tubos y links</h3>
          <p className="text-xs text-neutral-600">Hasta 3 globos por copia, o solo tubos y links. Una fila por lo que lleva cada copia; los tubos y links se inflan enteros.</p>
        </>
      ) : <h3 className="text-sm font-bold">Piezas pequeñas, tubos y links <span className="font-normal">(continúa)</span></h3>}
      {/* Anchos fijos: la estimación del alto de cada fila (`hoja-armado-paginas.ts`) cuenta caracteres por línea de cada columna. */}
      <table className="w-full table-fixed border-collapse text-sm">
        <colgroup>
          <col className="w-[50mm]" />
          <col className="w-[16mm]" />
          <col />
          <col className="w-[16mm]" />
        </colgroup>
        <thead>
          <tr className="border-b border-neutral-400 text-left text-xs uppercase tracking-wide text-neutral-500">
            <th className="py-1 pr-3 font-semibold">Pieza</th>
            <th className="py-1 pr-3 text-right font-semibold">Copias</th>
            <th className="py-1 pr-3 font-semibold">Qué lleva cada copia</th>
            <th className="py-1 text-right font-semibold">Bomba</th>
          </tr>
        </thead>
        <tbody>
          {filas.map((f, i) => (
            <tr key={i} className="break-inside-avoid border-b border-neutral-200 align-top">
              <td className="py-1 pr-3">{textoNombres(f.nombres)}</td>
              <td className="py-1 pr-3 text-right font-mono">{f.unidades}</td>
              <td className="py-1 pr-3">
                <ul>
                  {f.contenido.map((l) => {
                    const marcas = marcasDeLinea(l);
                    return (
                      <li key={l.clave} className="flex items-start gap-1.5">
                        <span className="mt-1 size-3 shrink-0 rounded-full ring-1 ring-black/20" style={{ background: l.hex }} aria-hidden />
                        <span className="shrink-0 font-mono">{l.cantidad} ×</span>
                        <span className="min-w-0">
                          {l.formatoId} {l.nombreColor}{l.infladoCm !== undefined ? ` a ${Math.round(l.infladoCm)} cm` : ""}
                          {marcas.length > 0 && <span className="text-xs text-neutral-700"> · {marcas.join(" · ")}</span>}
                        </span>
                      </li>
                    );
                  })}
                </ul>
                {[...anexosDeFila(f), dondeDeFila(f) ?? ""].filter(Boolean).map((a) => <p key={a} className="text-xs text-neutral-700">{a}</p>)}
              </td>
              <td className="py-1 text-right font-mono text-xs">{f.segundosBomba > 0 ? textoTiempo(f.segundosBomba) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
