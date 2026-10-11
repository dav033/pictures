import { textoFilaBomba, textoTiempo } from "@/lib/globos3d/bomba-segundos";
import type { TrozoEstructura } from "@/lib/globos3d/hoja-armado";
import { textoFlores } from "@/lib/globos3d/hoja-armado-anexos";
import { plural } from "@/lib/globos3d/texto-cantidad";
import { totalDeCapas } from "@/lib/globos3d/hoja-armado-capas";
import { referenciaPorCodigo } from "@/lib/plan/referencia-sempertex";
import { HojaArmadoCapa } from "./HojaArmadoCapa";
import { HojaArmadoCuartetos } from "./HojaArmadoCuartetos";
import { HojaArmadoHelioDePieza } from "./HojaArmadoHelio";
import { HojaArmadoTramos } from "./HojaArmadoTramos";

const LINEA = "flex items-center gap-1.5";

/** Lo que se cuenta en el título: capas, tramos o cuartetos, según cómo se arma la pieza. */
function unidadesDe(e: TrozoEstructura["estructura"]): string {
  if (e.modo === "anillos") { const n = totalDeCapas(e.capas); return `${n} ${plural(n, "capa", "capas")}`; }
  if (e.modo === "trenza") { const n = e.cuartetos.reduce((s, c) => s + c.repeticiones, 0); return `${n} ${plural(n, "cuarteto", "cuartetos")}`; }
  if (e.modo === "capas") return `${e.tramos.length} ${plural(e.tramos.length, "capa", "capas")}`;
  return `${e.tramos.length} ${plural(e.tramos.length, "tramo", "tramos")}`;
}

/** Un trozo de una pieza (o de varias iguales) en una página. El primero trae el resumen; los demás, «(continúa)». */
export function HojaArmadoEstructura({ trozo }: { trozo: TrozoEstructura }) {
  const { estructura: e, capas, tramos, cuartetos, primero } = trozo;
  const varias = e.unidades > 1;
  return (
    <section aria-label={`Pieza ${e.nombre}`} className="flex flex-col gap-3">
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b-2 border-neutral-800 pb-1">
        <h3 className="text-lg font-bold">
          {e.nombre}
          {!primero && <span className="font-normal"> (continúa)</span>}
        </h3>
        <p className="font-mono text-xs text-neutral-600">
          {varias ? `${e.unidades} iguales · ` : ""}{unidadesDe(e)} · {e.globosPorUnidad} {plural(e.globosPorUnidad, "globo", "globos")}{varias ? ` por copia (${e.totalGlobos} en total)` : ""}
        </p>
      </header>
      {primero && (
        <div className="space-y-2 text-sm">
          {varias && <p className="text-xs text-neutral-700">Lo de abajo es UNA copia; hay que armar {e.unidades}, todas iguales.</p>}
          {e.modulo && <p><span className="font-semibold">{e.modulo.etiqueta}:</span> los globos van en grupos de {e.modulo.globosPorGrupo}; cada grupo es un {e.modulo.etiqueta.toLowerCase()}.</p>}
          {e.patron && <p><span className="font-semibold">Patrón {e.patron.nombre.toLowerCase()}:</span> {e.patron.descripcion}</p>}
          {e.sentido && <p className="font-semibold">{e.sentido}</p>}
          {e.nota && <p className="text-xs text-neutral-700">{e.nota}</p>}
          {e.comoArmar && e.comoArmar.length > 0 && (
            <div>
              <p className="font-semibold">Cómo armarla</p>
              {e.comoArmar.map((linea) => <p key={linea} className="text-xs">{linea}</p>)}
            </div>
          )}
          {e.aparte.length > 0 && (
            <div>
              <p className="font-semibold">Aparte (no van en las capas)</p>
              <ul className="text-xs">
                {e.aparte.map((a) => (
                  <li key={`${a.etiqueta}|${a.formatoId}|${a.codigo}|${a.infladoCm}|${a.impreso ?? ""}`} className={LINEA}>
                    <span className="size-3 shrink-0 rounded-full ring-1 ring-black/20" style={{ background: a.hex }} aria-hidden />
                    <span className="font-mono">{a.cantidad} ×</span>
                    <span>{a.formatoId} {referenciaPorCodigo(a.codigo)?.nombreCompleto ?? a.nombreColor} a {Math.round(a.infladoCm)} cm ({a.etiqueta}){a.impreso ? ` · ${a.impreso}` : ""}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {e.tubos.length > 0 && (
            <div>
              <p className="font-semibold">Tubos y links (se inflan enteros, no por capa)</p>
              <ul className="text-xs">
                {e.tubos.map((t) => (
                  <li key={`${t.formatoId}|${t.codigo}`} className={LINEA}>
                    <span className="size-3 shrink-0 rounded-full ring-1 ring-black/20" style={{ background: t.hex }} aria-hidden />
                    <span className="font-mono">{t.cantidad} ×</span>
                    <span>{t.formatoId} {t.nombreColor}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {e.flores.length > 0 && <p><span className="font-semibold">{textoFlores(e.flores)}</span> por copia, metidas entre los globos (no son globos).</p>}
          {e.relleno && <p><span className="font-semibold">{e.relleno}</span> por copia (va dentro del globo; no es globo).</p>}
          {e.avisos.length > 0 && <p className="text-xs text-red-700" role="note">{e.avisos.join(" ")}</p>}
          <div className="font-mono text-xs">
            <p>Bomba de la pieza: {textoTiempo(e.segundosPorUnidad)}{varias ? ` por copia · ${textoTiempo(e.segundosBomba)} en total` : ""}</p>
            <ul>{e.filasBomba.map((f) => <li key={f.formatoId}>{textoFilaBomba(f)}</li>)}</ul>
          </div>
          {e.helio && <HojaArmadoHelioDePieza resumen={e.helio} copias={e.unidades} />}
        </div>
      )}
      {capas.length > 0 && (
        <div className="flex flex-col gap-3">
          {capas.map((capa) => <HojaArmadoCapa key={capa.numero} capa={capa} />)}
        </div>
      )}
      {cuartetos.length > 0 && <HojaArmadoCuartetos cuartetos={cuartetos} />}
      {tramos.length > 0 && <HojaArmadoTramos tramos={tramos} numerado={e.modo === "paredes"} />}
    </section>
  );
}
