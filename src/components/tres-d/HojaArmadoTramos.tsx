import { textoTiempo } from "@/lib/globos3d/bomba-segundos";
import type { TramoHoja } from "@/lib/globos3d/hoja-armado-tramos";
import { textoTamano } from "@/lib/globos3d/hoja-armado-texto";

/**
 * Los tramos de una pieza que no se arma en anillos, en una tabla: una fila por tramo con sus globos por color, por tamaño
 * y los segundos de bomba. Sin dibujo. Solo las paredes numeran los globos de un extremo al otro (`numerado`).
 */
export function HojaArmadoTramos({ tramos, numerado }: { tramos: TramoHoja[]; numerado: boolean }) {
  return (
    <table className="w-full table-fixed border-collapse text-sm">
      <colgroup>
        <col className="w-[38mm]" />
        <col />
        <col className="w-[50mm]" />
        <col className="w-[16mm]" />
      </colgroup>
      <thead>
        <tr className="border-b border-neutral-400 text-left text-xs uppercase tracking-wide text-neutral-500">
          <th className="py-1 pr-3 font-semibold">Tramo</th>
          <th className="py-1 pr-3 font-semibold">Por color</th>
          <th className="py-1 pr-3 font-semibold">Por tamaño</th>
          <th className="py-1 text-right font-semibold">Bomba</th>
        </tr>
      </thead>
      {tramos.map((t) => (
        <tbody key={t.numero} className="break-inside-avoid">
          <tr className={`${t.comoArmar ? "" : "border-b border-neutral-200 "}align-top`}>
            <td className="py-1.5 pr-3">
              <span className="font-semibold">{t.etiqueta}</span>
              <span className="block font-mono text-xs text-neutral-600">
                {numerado ? `Globos ${t.globos[0]?.numero}–${t.globos[t.globos.length - 1]?.numero} · ` : ""}{t.globos.length} en total
              </span>
            </td>
            <td className="py-1.5 pr-3">
              <ul>
                {t.colores.map((c) => (
                  <li key={`${c.formatoId}|${c.codigo}`} className="flex items-center gap-1.5">
                    <span className="size-3 shrink-0 rounded-full ring-1 ring-black/20" style={{ background: c.hex }} aria-hidden />
                    <span className="w-6 shrink-0 text-right font-mono">{c.cantidad}</span>
                    <span className="min-w-0">× {c.formatoId} {c.nombreColor}</span>
                  </li>
                ))}
              </ul>
              {t.marcas.length > 0 && <p className="mt-0.5 text-xs text-neutral-700">{t.marcas.join(" · ")}</p>}
            </td>
            <td className="py-1.5 pr-3 font-mono text-xs">
              <ul>{t.tamanos.map((x) => <li key={`${x.formatoId}|${x.infladoCm}`}>{textoTamano(x)}</li>)}</ul>
            </td>
            <td className="py-1.5 text-right font-mono text-xs">{textoTiempo(t.segundosBomba)}</td>
          </tr>
          {t.comoArmar && (
            <tr className="border-b border-neutral-200">
              <td colSpan={4} className="pb-1.5 text-xs text-neutral-700"><span className="font-semibold">Cómo armarlo.</span> {t.comoArmar}</td>
            </tr>
          )}
        </tbody>
      ))}
    </table>
  );
}
