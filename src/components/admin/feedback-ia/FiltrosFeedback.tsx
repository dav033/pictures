"use client";

import { MOTIVOS } from "@/lib/feedback-ia/motivos";
import { consultaDeFiltros, type FiltrosPanel } from "./filtros";

type Props = {
  filtros: FiltrosPanel;
  onCambio: (filtros: FiltrosPanel) => void;
  onAplicar: () => void;
  onLimpiar: () => void;
  total: number;
};

const ETIQUETA = "mb-1 block text-[11px] font-medium uppercase tracking-wide text-texto-suave";

export function FiltrosFeedback({ filtros, onCambio, onAplicar, onLimpiar, total }: Props) {
  const cambiar = <K extends keyof FiltrosPanel>(clave: K, valor: FiltrosPanel[K]) => onCambio({ ...filtros, [clave]: valor });
  const notas = Array.from({ length: 10 }, (_, i) => String(i + 1));

  return (
    <form
      className="mb-4 rounded-xl border border-borde bg-superficie p-3"
      onSubmit={(evento) => { evento.preventDefault(); onAplicar(); }}
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
        <label>
          <span className={ETIQUETA}>Producto</span>
          <select className="ui-input" value={filtros.producto} onChange={(e) => cambiar("producto", e.target.value as FiltrosPanel["producto"])}>
            <option value="">Todos</option>
            <option value="taller">Taller 3D</option>
            <option value="cliente">Chat del cliente</option>
          </select>
        </label>
        <label>
          <span className={ETIQUETA}>Nota desde</span>
          <select className="ui-input" value={filtros.minimo} onChange={(e) => cambiar("minimo", e.target.value)}>
            <option value="">1</option>
            {notas.map((nota) => <option key={nota} value={nota}>{nota}</option>)}
          </select>
        </label>
        <label>
          <span className={ETIQUETA}>Nota hasta</span>
          <select className="ui-input" value={filtros.maximo} onChange={(e) => cambiar("maximo", e.target.value)}>
            <option value="">10</option>
            {notas.map((nota) => <option key={nota} value={nota}>{nota}</option>)}
          </select>
        </label>
        <label className="col-span-2 sm:col-span-1">
          <span className={ETIQUETA}>Motivo</span>
          <select className="ui-input" value={filtros.motivo} onChange={(e) => cambiar("motivo", e.target.value as FiltrosPanel["motivo"])}>
            <option value="">Cualquiera</option>
            {MOTIVOS.map((motivo) => <option key={motivo.id} value={motivo.id}>{motivo.etiqueta}</option>)}
          </select>
        </label>
        <label>
          <span className={ETIQUETA}>Desde</span>
          <input type="date" className="ui-input" value={filtros.desde} onChange={(e) => cambiar("desde", e.target.value)} />
        </label>
        <label>
          <span className={ETIQUETA}>Hasta</span>
          <input type="date" className="ui-input" value={filtros.hasta} onChange={(e) => cambiar("hasta", e.target.value)} />
        </label>
      </div>

      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="min-w-48 flex-1">
          <span className={ETIQUETA}>Buscar en pedido, respuesta y comentario</span>
          <input className="ui-input" value={filtros.texto} maxLength={120} onChange={(e) => cambiar("texto", e.target.value)} placeholder="Ej.: arco, columna, colores…" />
        </label>
        <label className="flex items-center gap-2 pb-2 text-xs text-texto-suave">
          <input type="checkbox" checked={filtros.soloDeshechos} onChange={(e) => cambiar("soloDeshechos", e.target.checked)} />
          Solo deshechos
        </label>
        <label className="flex items-center gap-2 pb-2 text-xs text-texto-suave">
          <input type="checkbox" checked={filtros.incluirSinCalificar} onChange={(e) => cambiar("incluirSinCalificar", e.target.checked)} />
          Incluir sin calificar
        </label>
        <div className="flex gap-2">
          <button type="submit" className="ui-button-primary">Filtrar</button>
          <button type="button" className="ui-button-secondary" onClick={onLimpiar}>Limpiar</button>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-borde pt-2 text-xs text-texto-suave">
        <span>{total} {total === 1 ? "resultado" : "resultados"}, de la peor nota a la mejor</span>
        <span className="flex gap-3">
          <a className="ui-button-ghost underline" href={`/api/feedback-ia/admin?${consultaDeFiltros(filtros, { formato: "csv" })}`}>Exportar CSV</a>
          <a className="ui-button-ghost underline" href={`/api/feedback-ia/admin?${consultaDeFiltros(filtros, { completo: "1" })}`}>Exportar JSON completo</a>
        </span>
      </div>
    </form>
  );
}
