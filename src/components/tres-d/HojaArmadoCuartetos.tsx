import type { CuartetoHoja } from "@/lib/globos3d/hoja-armado-trenza";
import { textoRango, textoSecuencia } from "@/lib/globos3d/hoja-armado-texto";

/** Los cuartetos de un arco o guirnalda en el orden del recorrido: una fila por bloque de cuartetos iguales. */
export function HojaArmadoCuartetos({ cuartetos }: { cuartetos: CuartetoHoja[] }) {
  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="border-b border-neutral-400 text-left text-xs uppercase tracking-wide text-neutral-500">
          <th className="py-1 pr-3 font-semibold">Cuarteto</th>
          <th className="py-1 pr-3 font-semibold">Globos</th>
          <th className="py-1 font-semibold">Orden de color en el cuarteto</th>
        </tr>
      </thead>
      <tbody>
        {cuartetos.map((c) => {
          const tamanos = [...new Set(c.globos.map((g) => `${g.formatoId} a ${Math.round(g.infladoCm)} cm`))].join(", ");
          return (
            <tr key={c.desde} className="break-inside-avoid border-b border-neutral-200 align-top">
              <td className="py-1 pr-3 font-mono">{textoRango(c.desde, c.repeticiones)}{c.repeticiones > 1 && <span className="text-neutral-500"> ({c.repeticiones} iguales)</span>}</td>
              <td className="py-1 pr-3 font-mono text-xs">{c.globos.length} × {tamanos}</td>
              <td className="py-1">
                <span className="mr-2 inline-flex gap-1 align-middle">
                  {c.globos.map((g, k) => <span key={k} className="size-3 shrink-0 rounded-full ring-1 ring-black/20" style={{ background: g.hex }} aria-hidden />)}
                </span>
                {textoSecuencia(c.secuencia)}
                {c.marcas.length > 0 && <span className="block text-xs text-neutral-700">Por cuarteto: {c.marcas.join(" · ")}</span>}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
