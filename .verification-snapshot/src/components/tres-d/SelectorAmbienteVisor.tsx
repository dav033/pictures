"use client";

import { LENTES_VISOR, NOMBRES_LUZ_VISOR, type IdLente, type IdLuz } from "@/lib/globos3d/ambiente-visor";
import { FLOTANTE } from "./ui-taller";
import type { EscenaGlobos } from "./escena-globos";
import { useAmbienteVisor } from "./useAmbienteVisor";

const SELECT = "min-h-8 rounded-lg bg-transparent px-1.5 text-xs text-taller-texto outline-none focus-visible:ring-2 focus-visible:ring-taller-resalte";

/**
 * Luz y lente del visor, en una fila bajo la barra de herramientas. Solo se ve en pantallas anchas (`activo`); en las
 * angostas el visor usa el ambiente neutro.
 */
export function SelectorAmbienteVisor({ visor, activo }: { visor: EscenaGlobos | null; activo: boolean }) {
  const { ambiente, elegir } = useAmbienteVisor(visor, activo);
  return (
    <div role="group" aria-label="Luz y lente del visor"
      className={`pointer-events-auto absolute left-1/2 top-16 z-10 ${activo ? "flex" : "hidden"} -translate-x-1/2 items-center gap-3 rounded-xl px-2 py-1 ${FLOTANTE}`}>
      <label className="flex items-center gap-1.5 text-xs text-taller-suave">
        Luz
        <select aria-label="Luz del visor" value={ambiente.luz} onChange={(e) => elegir({ luz: e.target.value as IdLuz })} className={SELECT}>
          {(Object.keys(NOMBRES_LUZ_VISOR) as IdLuz[]).map((id) => <option key={id} value={id}>{NOMBRES_LUZ_VISOR[id]}</option>)}
        </select>
      </label>
      <label className="flex items-center gap-1.5 text-xs text-taller-suave">
        Lente
        <select aria-label="Lente del visor" value={ambiente.lente} onChange={(e) => elegir({ lente: e.target.value as IdLente })} className={SELECT}>
          {(Object.keys(LENTES_VISOR) as IdLente[]).map((id) => <option key={id} value={id}>{LENTES_VISOR[id].nombre}</option>)}
        </select>
      </label>
    </div>
  );
}
