import { GloboMiniatura } from "../GloboMiniatura";
import { globosPorColor, rotuloGlobo, type PiezaVista } from "../piezas-vista";

/**
 * La leyenda de la vista del plan 3D: un chip por color con cuántos globos lleva, sumando todas las piezas. Sale de la
 * misma lista de materiales que la tabla y la compra (las líneas del plan), no de lo que el visor dibuja.
 */
export function LeyendaPlan3D({ piezas }: { piezas: readonly PiezaVista[] }) {
  const colores = globosPorColor(piezas.flatMap((pieza) => pieza.lineas));
  if (!colores.length) return null;
  return (
    <ul data-testid="leyenda-plan-3d" aria-label="Colores de tu decoración y cuántos globos lleva cada uno" className="mt-2 flex flex-wrap gap-1.5">
      {colores.map((color) => (
        <li key={color.clave} title={rotuloGlobo(color).titulo} className="inline-flex items-center gap-1 rounded-2xl bg-superficie py-0.5 pl-1 pr-2 text-xs leading-tight text-texto tabular-nums ring-1 ring-borde-suave">
          <GloboMiniatura hex={color.hex} acabado={color.acabado} pulgadas={color.pulgadas} tamano={16} className="shrink-0" />
          {rotuloGlobo(color).texto} <span className="font-semibold">{color.cantidad}</span>
        </li>
      ))}
    </ul>
  );
}
