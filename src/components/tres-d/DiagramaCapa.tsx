import type { CapaHoja } from "@/lib/globos3d/hoja-armado-capas";
import { textoSobre } from "@/lib/globos3d/hoja-armado-comun";

/**
 * El anillo de una capa visto desde arriba, en cm: cada globo con su color, su tamaño y su número (el orden en que se arma, en
 * el sentido de `sentidoNumeracion`). El globo 1 lleva el borde grueso: está en su azimut real, así que la capa se ve girada como
 * se arma.
 */
export function DiagramaCapa({ capa }: { capa: CapaHoja }) {
  const e = capa.extensionCm;
  return (
    <svg
      viewBox={`${-e} ${-e} ${2 * e} ${2 * e}`}
      role="img"
      aria-label={`Esquema de la capa ${capa.numero}, vista desde arriba: ${capa.globos.length} globos numerados en sentido ${capa.sentidoNumeracion}`}
      className="h-auto w-full"
    >
      {capa.globos.map((g) => (
        <g key={g.numero}>
          <circle cx={g.x} cy={g.y} r={g.infladoCm / 2} fill={g.hex} stroke="#3a3a3a" strokeWidth={g.numero === 1 ? e / 40 : e / 120} strokeDasharray={g.helio ? "3 2" : undefined} />
          <text x={g.x} y={g.y} textAnchor="middle" dominantBaseline="central" fontSize={Math.max(g.infladoCm * 0.42, 3)} fill={textoSobre(g.hex)} fontFamily="ui-monospace, monospace">
            {g.numero}
          </text>
        </g>
      ))}
    </svg>
  );
}
