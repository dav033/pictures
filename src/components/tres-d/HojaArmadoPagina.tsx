import type { PaginaHoja } from "@/lib/globos3d/hoja-armado";
import { HojaArmadoCompacta } from "./HojaArmadoCompacta";
import { HojaArmadoEstructura } from "./HojaArmadoEstructura";
import { HojaArmadoHelioTotal } from "./HojaArmadoHelio";
import { HojaArmadoLista } from "./HojaArmadoLista";
import { HojaArmadoMetalizados } from "./HojaArmadoMetalizados";

/** Una página impresa de la hoja: sus trozos en orden y, abajo, «Página n de N». Cada página empieza en hoja nueva al imprimir. */
export function HojaArmadoPagina({ pagina, total, segundosBomba }: { pagina: PaginaHoja; total: number; segundosBomba: number }) {
  return (
    <div className={`flex flex-col gap-5 ${pagina.numero > 1 ? "print:break-before-page" : ""}`} data-pagina={pagina.numero}>
      {pagina.trozos.map((trozo, i) => {
        switch (trozo.tipo) {
          case "estructura": return <HojaArmadoEstructura key={`${trozo.estructura.id}-${i}`} trozo={trozo} />;
          case "compacta": return <HojaArmadoCompacta key={`compacta-${i}`} filas={trozo.filas} primero={trozo.primero} />;
          case "metalizados": return <HojaArmadoMetalizados key={`metalizados-${i}`} lineas={trozo.lineas} primero={trozo.primero} />;
          case "otras": return <p key="otras" className="text-sm"><span className="font-semibold">Otras piezas (sin globos de látex ni tubos, solo se nombran):</span> {trozo.nombres.join(", ")}.</p>;
          case "lista": return <HojaArmadoLista key={`lista-${i}`} trozo={trozo} segundosBomba={segundosBomba} />;
          case "helio": return <HojaArmadoHelioTotal key="helio" resumen={trozo.resumen} />;
        }
      })}
      <p className="text-right font-mono text-[10px] text-neutral-500">Página {pagina.numero} de {total}</p>
    </div>
  );
}
