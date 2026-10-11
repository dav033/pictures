import type { ResumenHelio } from "@/lib/globos3d/helio-cinta";
import { filasDeHelio, NOTA_ESTIMACION_HELIO, textoCierreDeEstructura, textoCierreDeTotal, textoDetalleEnLista, textoGloboDeHelio } from "@/lib/globos3d/hoja-armado-helio";
import { textoNumero } from "@/lib/globos3d/texto-cantidad";

/** Una fila por formato y tamaño con sus litros; con demasiados tamaños, la remisión a la lista de compra. */
function FilasDeHelio({ resumen }: { resumen: ResumenHelio }) {
  const filas = filasDeHelio(resumen);
  if (!filas) return <p className="text-xs text-neutral-700">{textoDetalleEnLista(resumen)}</p>;
  return (
    <ul className="font-mono text-xs">
      {filas.map((f) => (
        <li key={`${f.formatoId}|${f.infladoCm}`} className="flex justify-between gap-3">
          <span>{textoGloboDeHelio(f)}</span>
          <span className="shrink-0">{textoNumero(f.litros)} L</span>
        </li>
      ))}
    </ul>
  );
}

/** El helio y la cinta de una pieza, dentro de su resumen: los litros de todas las copias, con las cuentas de la lista de compra. */
export function HojaArmadoHelioDePieza({ resumen, copias }: { resumen: ResumenHelio; copias: number }) {
  return (
    <div className="max-w-[110mm]">
      <p className="font-semibold">Helio y cinta{copias > 1 ? ` (las ${copias} copias)` : ""}</p>
      <FilasDeHelio resumen={resumen} />
      <p className="text-xs">{textoCierreDeEstructura(resumen)}</p>
    </div>
  );
}

/** El helio y la cinta de toda la hoja, al final: lo que hay que pedir al proveedor. */
export function HojaArmadoHelioTotal({ resumen }: { resumen: ResumenHelio }) {
  return (
    <section aria-label="Helio y cinta de toda la hoja" className="flex flex-col gap-2">
      <h3 className="border-b-2 border-neutral-800 pb-1 text-lg font-bold">Helio y cinta de toda la hoja</h3>
      <FilasDeHelio resumen={resumen} />
      <p className="font-mono text-sm">{textoCierreDeTotal(resumen)}</p>
      <p className="text-xs text-neutral-600">{NOTA_ESTIMACION_HELIO}</p>
    </section>
  );
}
