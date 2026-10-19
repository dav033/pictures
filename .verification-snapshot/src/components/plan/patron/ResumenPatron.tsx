import type { PatronColorResuelto } from "@/lib/plan/patron-color";
import { colorDe, type ColorLeyenda } from "./leyenda";
import { MuestraNumero } from "./LeyendaPatron";

const numero = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 });

type Props = {
  conteo: PatronColorResuelto["conteo"];
  repeticiones: number;
  leyenda: readonly ColorLeyenda[];
  /** Conteo de un patrón que el plan todavía no usa (una sugerencia o un borrador sin aplicar): no se cotiza. */
  fueraDePropuesta?: boolean;
  compacto?: boolean;
  className?: string;
};

/**
 * Globos por color tal como los contó Python (`conteo`): la barra, la cifra
 * total y su porcentaje. Con varias piezas iguales dice también cuántos van
 * en cada una. No suma ni reparte nada por su cuenta salvo el porcentaje que
 * se muestra.
 */
export function ResumenPatron({ conteo, repeticiones, leyenda, fueraDePropuesta = false, compacto = false, className = "" }: Props) {
  const total = conteo.reduce((suma, fila) => suma + fila.unidades_total, 0);
  if (!conteo.length || total <= 0) return null;
  const porPieza = repeticiones > 1;
  return (
    <div className={className}>
      {/* Tono plano en la barra: el brillo del cromado se lee en las muestras, no en una franja. */}
      <div aria-hidden="true" className="flex h-2.5 gap-px overflow-hidden rounded-full bg-borde p-px">
        {conteo.map((fila) => {
          const color = colorDe(leyenda, fila.material);
          return <span key={fila.material} className="h-full first:rounded-l-full last:rounded-r-full" style={{ width: `${(fila.unidades_total / total) * 100}%`, background: color.brillo === "multicolor" ? color.muestra.fondo : color.hex }} />;
        })}
      </div>
      <ul aria-label={fueraDePropuesta ? "Globos por color (todavía no está en tu propuesta)" : "Globos por color"} className={`mt-2 grid gap-x-4 gap-y-1.5 ${compacto ? "grid-cols-1 @sm:grid-cols-2" : "grid-cols-1 @md:grid-cols-2"}`}>
        {conteo.map((fila) => {
          const color = colorDe(leyenda, fila.material);
          return (
            <li key={fila.material} className="flex min-w-0 items-center gap-2 text-[13px]">
              <MuestraNumero color={color} tamano="sm" />
              <span className="min-w-0 flex-1 truncate text-texto">{color.etiqueta}</span>
              <span className="shrink-0 tabular-nums text-texto">
                <strong className="font-semibold">{numero.format(fila.unidades_total)}</strong>
                <span className="text-texto-suave"> · {Math.round((fila.unidades_total / total) * 100)} %</span>
              </span>
            </li>
          );
        })}
      </ul>
      {(porPieza || fueraDePropuesta) && (
        <p className="mt-1.5 text-[11px] text-texto-suave">
          {[porPieza ? `Total de las ${repeticiones} piezas iguales` : null, fueraDePropuesta ? "todavía no está en tu propuesta" : null].filter(Boolean).join(" · ")}
        </p>
      )}
    </div>
  );
}
