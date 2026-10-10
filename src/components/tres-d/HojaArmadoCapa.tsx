import { textoFilaBomba, textoTiempo } from "@/lib/globos3d/bomba-segundos";
import type { CapaHoja } from "@/lib/globos3d/hoja-armado-capas";
import { textoGiro, textoSecuencia } from "@/lib/globos3d/hoja-armado-texto";
import { DiagramaCapa } from "./DiagramaCapa";

/**
 * Una capa (o varias iguales seguidas) de una columna o módulo: su esquema visto desde arriba (si cabe), el orden de color
 * alrededor del anillo, los colores y la bomba con el tamaño inflado.
 */
export function HojaArmadoCapa({ capa }: { capa: CapaHoja }) {
  const cuantas = capa.repeticiones > 1 ? `Capas ${capa.numero} a ${capa.hasta} (${capa.repeticiones} iguales)` : `Capa ${capa.numero}`;
  return (
    <article className="flex min-w-0 flex-col gap-2 break-inside-avoid border-b border-neutral-200 pb-3 sm:flex-row sm:items-start sm:gap-4 print:flex-row print:items-start print:gap-4">
      {capa.dibujable ? (
        <div className="w-[38mm] shrink-0">
          <DiagramaCapa capa={capa} />
          <p className="mt-1 text-[10px] leading-tight text-neutral-500">Vista desde arriba, numerados en sentido {capa.sentidoNumeracion}; el 1 lleva el borde grueso. Esquema, no a escala.</p>
        </div>
      ) : (
        <p className="w-[38mm] shrink-0 text-xs text-neutral-600">Anillo de {capa.globos.length} globos: demasiados para dibujarlo; se da la tabla.</p>
      )}
      <div className="min-w-0 flex-1 text-sm">
        <h4 className="font-semibold">{cuantas} · {capa.globos.length} {capa.globos.length === 1 ? "globo" : "globos"}{capa.repeticiones > 1 ? " cada una" : ""} · a {capa.alturaCm} cm de la base</h4>
        {capa.giroGrados !== null && <p className="text-xs text-neutral-700">{textoGiro(capa.giroGrados)}</p>}
        <p className="mt-1 text-xs"><span className="font-semibold">Orden de color:</span> {textoSecuencia(capa.secuencia)}</p>
        <ul className="mt-1.5 space-y-0.5">
          {capa.colores.map((c) => (
            <li key={`${c.formatoId}|${c.codigo}`} className="flex items-center gap-2">
              <span className="size-3.5 shrink-0 rounded-full ring-1 ring-black/20" style={{ background: c.hex }} aria-hidden />
              <span className="w-8 shrink-0 text-right font-mono">{c.cantidad}</span>
              <span className="min-w-0">× {c.formatoId} {c.nombreColor} <span className="font-mono text-xs text-neutral-500">{c.codigo}</span></span>
            </li>
          ))}
        </ul>
        {capa.marcas.length > 0 && <p className="mt-1 text-xs text-neutral-700">{capa.marcas.join(" · ")}</p>}
        {capa.filasBomba.length > 0 && (
          <div className="mt-2 border-t border-neutral-200 pt-1.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Bomba{capa.repeticiones > 1 ? " por capa" : ""} · {textoTiempo(capa.segundosBomba)}</p>
            <ul className="font-mono text-xs">
              {capa.filasBomba.map((f) => <li key={f.formatoId}>{textoFilaBomba(f)}</li>)}
            </ul>
          </div>
        )}
      </div>
    </article>
  );
}
