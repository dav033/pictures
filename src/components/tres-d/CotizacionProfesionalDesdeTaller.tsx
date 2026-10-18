"use client";

import { useState } from "react";
import type { ResumenHelio } from "@/lib/globos3d/helio-cinta";
import { bomHelio, textoPies3, textoVolumenYCinta } from "@/lib/globos3d/helio-bom";
import { LITROS_POR_TANQUE } from "@/lib/globos3d/helio-cinta";
import { cotizacionProfesionalDesdeTaller } from "@/lib/taller/cotizacion-profesional-desde-taller";
import type { CotizacionTallerV2 } from "@/lib/taller/cotizacion-taller-tipos";
import { CotizacionProfesional } from "@/components/cotizacion/CotizacionProfesional";
import { OwnerSharedQuotes } from "@/components/shared-quotes/OwnerSharedQuotes";
import type { EscenaGlobos } from "./escena-globos";
import { BTN } from "./ui-taller";

const nf = (valor: number) => valor.toLocaleString("es-CO", { maximumFractionDigits: 1 });

/** Cantidades de helio y cinta que acompañan la cotización; no tienen un precio inventado. */
export function ResumenHelioCotizacion({ resumen }: { resumen: ResumenHelio | null }) {
  const bom = bomHelio(resumen);
  if (!resumen || !bom) return <p className="text-sm text-taller-suave">La escena no tiene globos marcados para helio; no se suma helio ni cinta.</p>;
  return (
    <section aria-label="Cantidades de helio de la cotización" className="rounded-xl bg-taller-superficie p-3">
      <h4 className="text-sm font-semibold">Helio y cinta · cantidades de la escena</h4>
      <ul className="mt-1 text-sm">
        {bom.lineas.map((linea) => <li key={`${linea.formatoId}|${linea.infladoCm}`} className="flex justify-between gap-3"><span>{linea.cantidad} × {linea.formatoId} inflado a {nf(linea.infladoCm)} cm</span><span className="shrink-0 font-mono">{nf(linea.litros)} L ({textoPies3(linea.pies3)})</span></li>)}
      </ul>
      <p className="mt-1 text-sm">{textoVolumenYCinta(bom)} · {resumen.tanques} {resumen.tanques === 1 ? "tanque" : "tanques"} de {nf(LITROS_POR_TANQUE)} L nominales.</p>
      <p className="mt-1 text-xs text-taller-suave">Estimación de cantidades; el costo del helio y la cinta no está incluido porque el catálogo del Taller no tiene esos precios.</p>
    </section>
  );
}

export function CotizacionProfesionalDesdeTaller({ nombre, cotizacion, helio, clave, vigente, visor, readerEnabled, writerEnabled }: {
  nombre: string;
  cotizacion: CotizacionTallerV2;
  helio: ResumenHelio | null;
  clave: string;
  vigente: boolean;
  visor: EscenaGlobos | null;
  readerEnabled: boolean;
  writerEnabled: boolean;
}) {
  const [abierta, setAbierta] = useState(false);
  return (
    <section aria-label="Cotización profesional de la escena" className="mt-3 flex flex-col gap-3 rounded-xl border border-taller-linea p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4 className="text-sm font-semibold">Cotización profesional</h4>
          <p className="text-xs text-taller-suave">{nombre}</p>
        </div>
        <button type="button" className={BTN} disabled={!vigente} onClick={() => setAbierta((valor) => !valor)} aria-expanded={abierta && vigente}>
          {!vigente ? "Cotización desactualizada" : abierta ? "Cerrar cotización" : "Pasar a cotización"}
        </button>
      </div>
      {!vigente && <p role="status" data-testid="aviso-cotizacion-taller-desactualizada" className="text-sm text-amber-700">La escena cambió desde esta cotización. Vuelve a cotizar los materiales antes de continuar.</p>}
      {abierta && vigente && (
        <div className="flex flex-col gap-3">
          <ResumenHelioCotizacion resumen={helio} />
          <CotizacionProfesional
            key={clave}
            cotizacion={cotizacionProfesionalDesdeTaller(cotizacion)}
            clave={clave}
            incrustada
            sharing={readerEnabled && writerEnabled && visor ? {
              enabled: true,
              sceneName: nombre,
              sceneKey: clave,
              captureStill: () => visor.exportarPng(),
            } : undefined}
          />
          <OwnerSharedQuotes sceneKey={clave} enabled={readerEnabled} />
        </div>
      )}
    </section>
  );
}
