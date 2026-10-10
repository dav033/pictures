"use client";

import { useId, useState } from "react";
import { SEGUNDOS_BOMBA_DEFECTO, filasBomba, nf, parsearSegundos, segundosReferencia, textoFilaBomba, textoTiempo, tiempoTotalBomba, type CalibracionBomba, type InflableBomba } from "@/lib/globos3d/bomba-segundos";
import { formatoPorId } from "@/lib/globos3d/formatos";
import { BTN } from "./ui-taller";

/** El mismo registro sin una clave. */
const sin = (registro: Record<string, string>, clave: string): Record<string, string> => Object.fromEntries(Object.entries(registro).filter(([k]) => k !== clave));

/**
 * Bomba: tiempo por formato de la escena (los de helio no pasan por la bomba). Plegada por defecto, con el tiempo total en
 * la cabecera. La calibración la tiene la lista (se lee del navegador una vez y se guarda al cambiarla); aquí solo se muestra
 * y se corrige por formato. Lo escrito se valida al salir de cada campo, al pulsar Intro y al plegar la sección.
 */
export function SeccionBomba({ globos, calibracion, onCambiar }: { globos: ReadonlyArray<InflableBomba>; calibracion: CalibracionBomba; onCambiar: (siguiente: CalibracionBomba) => void }) {
  const [abierta, setAbierta] = useState(false);
  const [editando, setEditando] = useState(false);
  const [escrito, setEscrito] = useState<Record<string, string>>({});
  const [errores, setErrores] = useState<Record<string, string>>({});
  const idBase = useId();
  const filas = filasBomba(globos, calibracion);
  if (!filas.length) return null;
  const formatos = [...new Set(filas.map((f) => f.formatoId))];

  /** Aplica de una vez los campos escritos de `ids` que son correctos; los que no vuelven a su valor con un aviso. */
  const validar = (ids: readonly string[]) => {
    const pendientes = ids.filter((id) => escrito[id] !== undefined);
    if (!pendientes.length) return;
    const siguiente: Record<string, number> = { ...calibracion };
    const escritoNuevo = { ...escrito };
    const erroresNuevos = { ...errores };
    let cambio = false;
    for (const id of pendientes) {
      const s = parsearSegundos(escrito[id] ?? "");
      delete escritoNuevo[id];
      if (s === undefined) {
        const anterior = segundosReferencia(id, calibracion) ?? SEGUNDOS_BOMBA_DEFECTO[id] ?? 0;
        erroresNuevos[id] = `${id}: no es un número de 0,1 a 60 segundos. Queda en ${nf(anterior)} s.`;
      } else {
        delete erroresNuevos[id];
        siguiente[id] = s;
        cambio = true;
      }
    }
    setEscrito(escritoNuevo);
    setErrores(erroresNuevos);
    if (cambio) onCambiar(siguiente);
  };

  const alternar = () => {
    if (abierta) validar(formatos);
    setAbierta((v) => !v);
  };

  const total = textoTiempo(tiempoTotalBomba(filas));
  const mensajes = Object.values(errores);
  return (
    <section aria-label="Bomba">
      <h3>
        <button type="button" onClick={alternar} aria-expanded={abierta} aria-controls={`${idBase}-detalle`} className="taller-rotulo flex min-h-8 w-full items-center justify-between gap-3 py-1 text-left">
          <span>Bomba · {total}</span>
          <span aria-hidden className="font-mono text-xs">{abierta ? "−" : "+"}</span>
        </button>
      </h3>
      {mensajes.length > 0 && <div role="alert" className="mt-1 text-xs text-red-600">{mensajes.map((m) => <p key={m}>{m}</p>)}</div>}
      <div id={`${idBase}-detalle`} hidden={!abierta} className="mt-2">
        <ul className="text-sm">
          {filas.map((f) => (
            <li key={f.formatoId} className="border-b border-taller-linea py-1 font-mono">{textoFilaBomba(f)}</li>
          ))}
        </ul>
        <p className="mt-1 text-xs text-taller-suave">Estimación para una bomba eléctrica estándar. c/u es el promedio por globo; el tiempo crece con el volumen del globo. Un tubito cuenta entero, una vez, aunque se tuerza en varias burbujas. Los marcados como de helio no pasan por la bomba: si alguno flota y no está marcado (una escena guardada antes), márcalo en los parámetros de su pieza.</p>
        <button type="button" onClick={() => setEditando((v) => !v)} className={`${BTN} mt-2`} aria-expanded={editando} aria-controls={`${idBase}-calibrar`}>
          {editando ? "Cerrar calibración" : "Calibrar mi bomba"}
        </button>
        <div id={`${idBase}-calibrar`} hidden={!editando} className="mt-2 flex flex-col gap-2 text-sm">
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
                  onChange={(e) => {
                    setEscrito((x) => ({ ...x, [id]: e.target.value }));
                    setErrores((x) => sin(x, id));
                  }}
                  onBlur={() => validar([id])}
                  onKeyDown={(e) => { if (e.key === "Enter") validar([id]); }}
                  aria-invalid={errores[id] ? true : undefined}
                  className="w-28 rounded border border-taller-linea bg-transparent px-2 py-1 font-mono"
                />
              </div>
            );
          })}
          <button type="button" onClick={() => { setEscrito({}); setErrores({}); onCambiar({}); }} className={`${BTN} self-start`}>Volver a los valores por defecto</button>
        </div>
      </div>
    </section>
  );
}
