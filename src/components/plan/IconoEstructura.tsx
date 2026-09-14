import type { EstructuraOficialId } from "@/lib/plan/estructuras-oficiales";

/**
 * Silueta simple de cada estructura oficial, solo informativa para el
 * cliente. Círculos = globos; hereda el color del texto (`currentColor`).
 */
const GLOBOS: Readonly<Record<EstructuraOficialId, ReadonlyArray<readonly [number, number, number]>>> = {
  arco: [[5, 20, 2.6], [5.5, 14, 2.6], [8, 8.5, 2.6], [13, 5.5, 2.6], [18, 5.5, 2.6], [23, 8.5, 2.6], [25.5, 14, 2.6], [26, 20, 2.6]],
  arco_asimetrico: [[5, 20, 3.2], [5.5, 13.5, 3], [8.5, 8, 2.6], [13.5, 5.5, 2.2], [18.5, 6, 1.8], [22.5, 9, 1.6], [25, 14, 1.5], [26, 20, 1.5]],
  arco_no_denso: [[5, 20, 1.8], [6.5, 12, 1.8], [11, 6.5, 1.8], [20, 6.5, 1.8], [24.5, 12, 1.8], [26, 20, 1.8]],
  semiarco: [[6, 21, 2.6], [6, 15, 2.6], [7.5, 9.5, 2.6], [11.5, 6, 2.6], [16.5, 5, 2.4]],
  semiarco_asimetrico: [[6, 21, 3.3], [6.5, 14.5, 2.9], [8.5, 9, 2.3], [12.5, 6, 1.8], [16.5, 5.5, 1.4]],
  columna: [[15.5, 22, 2.8], [15.5, 16.5, 2.8], [15.5, 11, 2.8], [15.5, 5.5, 2.8]],
  columna_asimetrica: [[15, 22, 3.2], [16.5, 16.5, 2.6], [14, 11.5, 2.4], [17.5, 11, 1.6], [15.5, 6, 2]],
  columna_no_densa: [[15.5, 22, 2], [15.5, 14, 2], [15.5, 6, 2]],
  pared_densa: [[7, 7, 2.6], [12.5, 7, 2.6], [18, 7, 2.6], [23.5, 7, 2.6], [7, 13, 2.6], [12.5, 13, 2.6], [18, 13, 2.6], [23.5, 13, 2.6], [7, 19, 2.6], [12.5, 19, 2.6], [18, 19, 2.6], [23.5, 19, 2.6]],
  pared_no_densa: [[7, 7, 2], [18, 7, 2], [12.5, 13, 2], [23.5, 13, 2], [7, 19, 2], [18, 19, 2]],
  guirnalda: [[4, 18, 2.2], [9, 20, 2.8], [14.5, 18.5, 2.2], [20, 20.5, 2.8], [26, 18.5, 2.4]],
  centro_mesa: [[11.5, 15, 2.4], [15.5, 13, 2.6], [19.5, 15, 2.4]],
  bouquet: [[11, 7, 2.6], [15.5, 5, 2.6], [20, 7, 2.6]],
  figura: [[15.5, 8, 3.4], [15.5, 15.5, 4.2], [10, 14, 1.8], [21, 14, 1.8]],
  aro_circular: [[15.5, 4, 2.2], [22.5, 7, 2.2], [25.5, 13.5, 2.2], [22.5, 20, 2.2], [15.5, 23, 2.2], [8.5, 20, 2.2], [5.5, 13.5, 2.2], [8.5, 7, 2.2]],
  techo_globos: [[6, 6, 2.2], [12, 7.5, 2.4], [18, 6, 2.2], [24, 7.5, 2.4]],
};

/** `espejo` voltea la silueta: un semiarco a la derecha se curva hacia la izquierda. */
export function IconoEstructura({ id, className, espejo = false }: { id: EstructuraOficialId; className?: string; espejo?: boolean }) {
  return (
    <svg viewBox="0 0 31 27" className={className} aria-hidden="true" focusable="false" style={espejo ? { transform: "scaleX(-1)" } : undefined}>
      {id === "centro_mesa" && <line x1="7" y1="19.5" x2="24" y2="19.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />}
      {id === "bouquet" && <path d="M11 9.5 L15.5 22 M15.5 7.5 L15.5 22 M20 9.5 L15.5 22" stroke="currentColor" strokeWidth="0.7" fill="none" />}
      {id === "techo_globos" && <line x1="2" y1="2" x2="29" y2="2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />}
      {GLOBOS[id].map(([cx, cy, r], index) => (
        <circle key={index} cx={cx} cy={cy} r={r} fill="currentColor" opacity={0.85} />
      ))}
    </svg>
  );
}
