"use client";

import { useId, useState } from "react";
import { SEGUNDOS_BOMBA_DEFECTO, filasBomba, type InflableBomba, parsearSegundos, segundosReferencia, tiempoTotalBomba, textoTiempo, type CalibracionBomba } from "@/lib/globos3d/bomba-segundos";
import { formatoPorId } from "@/lib/globos3d/formatos";
import { BTN } from "./ui-taller";

const nf = (n: number) => n.toLocaleString("es-CO", { maximumFractionDigits: 1 });

/** El mismo registro sin una clave. */
const sin = (registro: Record<string, string>, clave: string): Record<string, string> => Object.fromEntries(Object.entries(registro).filter(([k]) => k !== clave));

/** Un número que lee un lector de pantalla con su unidad (el visual sigue siendo corto). */
function Segundos({ valor }: { valor: number }) {
  return <>{nf(valor)}<span className="sr-only"> segundos</span></>;
}

/**
 * Bomba: segundos por globo y tamaño de la escena (los de helio no pasan por la bomba). La calibración la tiene la lista
 * (se lee del navegador una vez y se guarda al cambiarla); aquí solo se muestra y se corrige por formato.
 */
export function SeccionBomba({ globos, calibracion, onCambiar }: { globos: ReadonlyArray<InflableBomba>; calibracion: CalibracionBomba; onCambiar: (siguiente: CalibracionBomba) => void }) {
  const [editando, setEditando] = useState(false);
  const [escrito, setEscrito] = useState<Record<string, string>>({});
  const [error, setError] = useState<Record<string, string>>({});
  const idBase = useId();
  const filas = filasBomba(globos, calibracion);
  if (!filas.length) return null;
  const formatos = [...new Set(filas.map((f) => f.formatoId))];

  const confirmar = (formatoId: string) => {
    const texto = escrito[formatoId];
    if (texto === undefined) return;
    const s = parsearSegundos(texto);
    const anterior = segundosReferencia(formatoId, calibracion) ?? SEGUNDOS_BOMBA_DEFECTO[formatoId] ?? 0;
    if (s === undefined) {
      setError((e) => ({ ...e, [formatoId]: `No es un número de 0,1 a 60 segundos. Queda en ${nf(anterior)} s.` }));
      setEscrito((e) => ({ ...e, [formatoId]: nf(anterior) }));
      return;
    }
    setError((e) => sin(e, formatoId));
    setEscrito((e) => sin(e, formatoId));
    onCambiar({ ...calibracion, [formatoId]: s });
  };

  return (
    <section aria-label="Bomba">
      <h3 className="taller-rotulo mb-2">Bomba</h3>
      <ul className="text-sm">
        {filas.map((f) => (
          <li key={`${f.formatoId}|${f.cmInflado}`} className="flex justify-between gap-3 border-b border-taller-linea py-1">
            <span className="min-w-0">{f.cantidad} × {f.formatoId} inflado a {f.cmInflado} cm</span>
            <span className="shrink-0 font-mono text-taller-suave"><Segundos valor={f.segundosPorGlobo} /> por {f.unidad} · {nf(f.segundosTotal)} s en total</span>
          </li>
        ))}
        <li className="flex justify-between gap-3 py-1 font-medium">
          <span>Tiempo total de bomba</span>
          <span className="font-mono">{textoTiempo(tiempoTotalBomba(filas))}</span>
        </li>
      </ul>
      <p className="mt-1 text-xs text-taller-suave">Estimación para una bomba eléctrica estándar. El tiempo crece con el volumen del globo; un tubito cuenta entero, una vez, aunque se tuerza en varias burbujas. Los marcados como de helio no pasan por la bomba: si alguno flota y no está marcado (una escena guardada antes), márcalo en los parámetros de su pieza.</p>
      <button type="button" onClick={() => setEditando((v) => !v)} className={`${BTN} mt-2`} aria-expanded={editando} aria-controls={`${idBase}-calibrar`}>
        {editando ? "Cerrar calibración" : "Calibrar mi bomba"}
      </button>
      {editando && (
        <div id={`${idBase}-calibrar`} className="mt-2 flex flex-col gap-2 text-sm">
          <p className="text-xs text-taller-suave">Cuántos segundos tarda tu bomba en inflar un globo (o un tubito entero) de cada formato a su tamaño de decoración (por ejemplo, R-12 a 25 cm). Se guarda en este navegador. Los demás tamaños se calculan solos.</p>
          {formatos.map((id) => {
            const campo = `${idBase}-${id}`;
            const referencia = formatoPorId(id)?.infladoDecoracionCm ?? 0;
            const valor = escrito[id] ?? nf(segundosReferencia(id, calibracion) ?? 0);
            return (
              <div key={id} className="flex flex-col gap-1">
                <label htmlFor={campo}>{id} a {referencia} cm (segundos)</label>
                <input
                  id={campo}
                  inputMode="decimal"
                  value={valor}
                  onChange={(e) => setEscrito((x) => ({ ...x, [id]: e.target.value }))}
                  onBlur={() => confirmar(id)}
                  onKeyDown={(e) => { if (e.key === "Enter") confirmar(id); }}
                  aria-invalid={error[id] ? true : undefined}
                  aria-describedby={error[id] ? `${campo}-error` : undefined}
                  className="w-28 rounded border border-taller-linea bg-transparent px-2 py-1 font-mono"
                />
                {error[id] && <p id={`${campo}-error`} role="alert" className="text-xs text-red-600">{error[id]}</p>}
              </div>
            );
          })}
          <button type="button" onClick={() => onCambiar({})} className={`${BTN} self-start`}>Volver a los valores por defecto</button>
        </div>
      )}
    </section>
  );
}
