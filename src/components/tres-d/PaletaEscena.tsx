"use client";

import { useMemo, useState } from "react";
import { Palette } from "lucide-react";
import { NOMBRE_FAMILIA, coloresDelFormato } from "@/lib/globos3d/formatos";
import { coloresUsados } from "@/lib/globos3d/recolorear";
import { referenciaPorCodigo } from "@/lib/plan/referencia-sempertex";

type Material = { formatoId: string; codigo: string; cantidad: number };

/**
 * «Colores de la escena»: cada color que usa lo que se ve (con cuántos globos), y al tocarlo, la paleta para
 * cambiarlo en todo el montaje de una vez. Solo ofrece colores que se fabrican en alguno de sus formatos; los que
 * faltan en algún formato se marcan (ese formato queda como estaba y se avisa).
 */
export function PaletaEscena({ materiales, onReemplazar, aviso }: { materiales: readonly Material[]; onReemplazar: (de: string, a: string) => void; aviso: string | null }) {
  const usados = useMemo(() => coloresUsados(materiales), [materiales]);
  const [elegido, setElegido] = useState<string | null>(null);
  const actual = usados.find((u) => u.codigo === elegido) ?? null;
  const candidatos = useMemo(() => {
    if (!actual) return [];
    const porCodigo = new Map<string, { ref: ReturnType<typeof coloresDelFormato>[number]; faltaEn: string[] }>();
    for (const f of actual.formatos) for (const c of coloresDelFormato(f)) if (!porCodigo.has(c.codigo)) porCodigo.set(c.codigo, { ref: c, faltaEn: [] });
    for (const [codigo, item] of porCodigo) item.faltaEn = actual.formatos.filter((f) => !coloresDelFormato(f).some((c) => c.codigo === codigo));
    const grupos = new Map<string, Array<{ ref: ReturnType<typeof coloresDelFormato>[number]; faltaEn: string[] }>>();
    for (const item of porCodigo.values()) grupos.set(item.ref.familia, [...(grupos.get(item.ref.familia) ?? []), item]);
    return [...grupos.entries()];
  }, [actual]);

  if (usados.length === 0) return null;
  return (
    <section className="flex flex-col gap-2 rounded-2xl bg-superficie p-3 ring-1 ring-acento/40" aria-label="Colores de la escena">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-texto"><Palette className="size-4 text-acento" aria-hidden /> Colores de la escena</h2>
      <p className="text-xs text-texto-suave">Toca un color para cambiarlo en todo lo que se ve.</p>
      <div className="flex flex-wrap gap-1.5">
        {usados.map((u) => {
          const ref = referenciaPorCodigo(u.codigo);
          const activo = u.codigo === elegido;
          return (
            <button key={u.codigo} type="button" onClick={() => setElegido(activo ? null : u.codigo)} aria-pressed={activo}
              title={`${ref?.nombreCompleto ?? u.codigo} ${u.codigo} · ${u.cantidad} en ${u.formatos.join(", ")}`}
              className={`inline-flex min-h-10 items-center gap-1.5 rounded-full py-1 pl-1 pr-2.5 text-xs ring-1 ${activo ? "bg-superficie-suave ring-acento ring-2" : "ring-borde hover:bg-superficie-suave"}`}>
              <span className="size-7 shrink-0 rounded-full" style={{ background: ref?.hexGlobo ?? "#ccc", boxShadow: "inset 0 0 0 1px rgba(0,0,0,.12)" }} />
              <span className="text-left leading-tight text-texto">{ref?.nombreCompleto ?? u.codigo}<span className="block font-mono text-[0.65rem] text-texto-suave">{u.cantidad} · {u.codigo}</span></span>
            </button>
          );
        })}
      </div>
      {actual && (
        <div className="rounded-xl bg-superficie-suave p-2">
          <p className="mb-1 text-xs text-texto">Cambiar <b>{referenciaPorCodigo(actual.codigo)?.nombreCompleto ?? actual.codigo}</b> por:</p>
          <div className="max-h-52 overflow-y-auto pr-1">
            {candidatos.map(([familia, lista]) => (
              <div key={familia} className="mb-1.5">
                <p className="font-mono text-[0.65rem] uppercase tracking-wider text-texto-suave">{NOMBRE_FAMILIA[familia] ?? familia}</p>
                <div className="mt-0.5 flex flex-wrap gap-1">
                  {lista.map(({ ref, faltaEn }) => (
                    <button key={ref.codigo} type="button" onClick={() => { onReemplazar(actual.codigo, ref.codigo); setElegido(ref.codigo); }}
                      aria-label={`${ref.nombreCompleto} ${ref.codigo}${faltaEn.length ? ` (no viene en ${faltaEn.join(", ")})` : ""}`}
                      title={`${ref.nombreCompleto} ${ref.codigo}${faltaEn.length ? ` · no viene en ${faltaEn.join(", ")}` : ""}`}
                      className={`relative size-8 rounded-full ring-2 ring-offset-1 ring-offset-superficie-suave ${ref.codigo === actual.codigo ? "ring-acento" : "ring-transparent hover:ring-borde"} ${faltaEn.length ? "opacity-60" : ""}`}
                      style={{ background: ref.hexGlobo, boxShadow: "inset 0 0 0 1px rgba(0,0,0,.12)" }}>
                      {faltaEn.length > 0 && <span aria-hidden className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full bg-texto-suave ring-1 ring-superficie" />}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <p className="mt-1 text-[0.7rem] text-texto-suave">Los marcados con un punto no se fabrican en todos los formatos de este color: esos quedan como estaban.</p>
        </div>
      )}
      {aviso && <p role="status" className="text-xs text-texto">{aviso}</p>}
    </section>
  );
}
