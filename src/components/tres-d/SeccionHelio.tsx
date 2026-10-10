"use client";

import { AVISO_ALCANCE_HELIO, avisoMetalizados, LITROS_POR_TANQUE, METROS_CINTA_POR_GLOBO, PERDIDA_HELIO, resumenHelio, type GrupoHelio } from "@/lib/globos3d/helio-cinta";

const nf = (n: number) => n.toLocaleString("es-CO", { maximumFractionDigits: 1 });

/** La sección de helio y cinta de la lista de compra: aparece si la escena tiene globos de helio o piezas metalizadas (foil). */
export function SeccionHelio({ grupos, metalizados }: { grupos: ReadonlyArray<GrupoHelio>; metalizados: number }) {
  const resumen = resumenHelio(grupos);
  const foil = metalizados > 0 ? <p className="mt-1 text-xs text-taller-suave" role="note">{avisoMetalizados(metalizados)}</p> : null;
  if (!resumen) return foil && <section aria-label="Helio y cinta"><h3 className="taller-rotulo mb-2">Helio y cinta</h3>{foil}</section>;
  return (
    <section aria-label="Helio y cinta">
      <h3 className="taller-rotulo mb-2">Helio y cinta</h3>
      <ul className="text-sm">
        {resumen.filas.map((f) => (
          <li key={`${f.formatoId}|${f.infladoCm}`} className="flex justify-between gap-3 border-b border-taller-linea py-1">
            <span className="min-w-0">{f.cantidad} × {f.formatoId} inflado a {nf(f.infladoCm)} cm</span>
            <span className="shrink-0 font-mono text-taller-suave">{nf(f.litros)} L</span>
          </li>
        ))}
      </ul>
      <p className="mt-1 text-sm">
        Total: <span className="font-mono">{nf(resumen.litros)}</span> L de helio con {Math.round(PERDIDA_HELIO * 100)} % de pérdida, <span className="font-mono">{resumen.tanques}</span> {resumen.tanques === 1 ? "tanque" : "tanques"} de {nf(LITROS_POR_TANQUE)} L nominales · cinta: <span className="font-mono">{nf(resumen.metrosCinta)}</span> m
      </p>
      <p className="mt-1 text-xs text-taller-suave">
        Estimación: litros de la esfera de cada globo inflado. La cinta es la de la pieza (techo o ramo); sin dato, {nf(METROS_CINTA_POR_GLOBO)} m por globo. {AVISO_ALCANCE_HELIO} Confirmar el tanque con el proveedor.
      </p>
      {foil}
    </section>
  );
}
