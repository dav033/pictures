import { NOTA_METALIZADOS, type LineaMetalizada } from "@/lib/globos3d/hoja-armado-metalizados";

/** Los globos metalizados (foil): qué comprar y lo que el motor sabe de cómo se ponen. */
export function HojaArmadoMetalizados({ lineas, primero }: { lineas: LineaMetalizada[]; primero: boolean }) {
  return (
    <section aria-label="Globos metalizados (foil)" className="flex flex-col gap-2">
      {primero ? (
        <>
          <h3 className="border-b-2 border-neutral-800 pb-1 text-lg font-bold">Globos metalizados (foil)</h3>
          <p className="text-xs text-neutral-600">{NOTA_METALIZADOS}</p>
        </>
      ) : <h3 className="text-sm font-bold">Globos metalizados (foil) <span className="font-normal">(continúa)</span></h3>}
      <ul className="text-sm">
        {lineas.map((l) => (
          <li key={`${l.nombre}|${l.producto ?? ""}|${l.comoArmar.join("|")}`} className="break-inside-avoid border-b border-neutral-200 py-1">
            <p>
              <span className="font-mono">{l.cantidad} ×</span> <span className="font-semibold">{l.nombre}</span>
              {" · "}{l.producto ? <>Comprar: {l.producto}</> : <>No hay uno igual en la tienda: se compra uno parecido</>}
            </p>
            {l.tallas && <p className="text-xs text-neutral-700">Talla: {l.tallas}.</p>}
            {l.comoArmar.map((paso) => <p key={paso} className="text-xs text-neutral-700">{paso}</p>)}
          </li>
        ))}
      </ul>
    </section>
  );
}
