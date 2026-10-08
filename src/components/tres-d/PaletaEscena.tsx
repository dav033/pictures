"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Palette, Undo2 } from "lucide-react";
import { NOMBRE_FAMILIA, coloresDelFormato } from "@/lib/globos3d/formatos";
import { coloresUsados } from "@/lib/globos3d/recolorear";
import { referenciaPorCodigo } from "@/lib/plan/referencia-sempertex";

type Material = { formatoId: string; codigo: string; cantidad: number };

/** Un grupo de la paleta: «todo» (lo que se ve), o la base y las decoraciones por separado. */
export type GrupoColor = { id: "todo" | "base" | "decoraciones"; nombre: string; materiales: readonly Material[] };

/**
 * «Colores de la escena»: cada color que usa lo que se ve (con cuántos globos), y al tocarlo, la paleta para
 * cambiarlo en todo el montaje de una vez. Solo ofrece colores que se fabrican en alguno de sus formatos; los que
 * faltan en algún formato se marcan (ese formato queda como estaba y se avisa).
 */
export function PaletaEscena({ grupos, onReemplazar, aviso, puedeDeshacer, onDeshacer, variante = "chips", titulo = "Colores de la escena", ayuda, extra }: {
  grupos: readonly GrupoColor[];
  onReemplazar: (de: string, a: string, grupo: GrupoColor["id"]) => void;
  aviso: string | null;
  puedeDeshacer: boolean;
  onDeshacer: () => void;
  /**
   * «lista»: filas planas (muestra, nombre, cantidad · código) como en el panel Piezas; «muestras»: una fila de círculos
   * (los colores de la pieza en el inspector); «chips»: botones redondeados.
   */
  variante?: "chips" | "lista" | "muestras";
  titulo?: string;
  /** El texto de ayuda bajo los colores (si no, el de siempre). */
  ayuda?: string;
  /** Lo que va al final de la fila de muestras (el «+»). */
  extra?: ReactNode;
}) {
  const porGrupo = useMemo(() => grupos.map((g) => ({ ...g, usados: coloresUsados(g.materiales) })).filter((g) => g.usados.length > 0), [grupos]);
  const [elegido, setElegido] = useState<{ grupo: GrupoColor["id"]; codigo: string } | null>(null);
  const actual = (elegido && porGrupo.find((g) => g.id === elegido.grupo)?.usados.find((u) => u.codigo === elegido.codigo)) ?? null;
  const candidatos = useMemo(() => {
    if (!actual) return [];
    const porCodigo = new Map<string, { ref: ReturnType<typeof coloresDelFormato>[number]; faltaEn: string[] }>();
    for (const f of actual.formatos) for (const c of coloresDelFormato(f)) if (!porCodigo.has(c.codigo)) porCodigo.set(c.codigo, { ref: c, faltaEn: [] });
    for (const [codigo, item] of porCodigo) item.faltaEn = actual.formatos.filter((f) => !coloresDelFormato(f).some((c) => c.codigo === codigo));
    const grupos = new Map<string, Array<{ ref: ReturnType<typeof coloresDelFormato>[number]; faltaEn: string[] }>>();
    for (const item of porCodigo.values()) grupos.set(item.ref.familia, [...(grupos.get(item.ref.familia) ?? []), item]);
    return [...grupos.entries()];
  }, [actual]);

  if (porGrupo.length === 0) return null;
  if (variante === "muestras") {
    return (
      <section className="flex flex-col gap-2.5" aria-label={titulo}>
        <h3 className="taller-rotulo">{titulo}</h3>
        {porGrupo.map((g) => (
          <div key={g.id} className="flex flex-wrap items-center gap-2.5">
            {g.usados.map((u) => {
              const ref = referenciaPorCodigo(u.codigo);
              const activo = elegido?.grupo === g.id && u.codigo === elegido.codigo;
              return (
                <button key={u.codigo} type="button" onClick={() => setElegido(activo ? null : { grupo: g.id, codigo: u.codigo })} aria-pressed={activo} aria-expanded={activo}
                  aria-label={`${ref?.nombreCompleto ?? u.codigo} ${u.codigo} (${u.cantidad} globos): cambiarlo en esta pieza`} title={`${ref?.nombreCompleto ?? u.codigo} ${u.codigo} · ${u.cantidad} en ${u.formatos.join(", ")}`}
                  className={`size-[30px] shrink-0 rounded-full border-2 border-taller-panel ${activo ? "shadow-[0_0_0_2px_var(--taller-resalte)]" : "shadow-[0_0_0_1px_var(--taller-borde)] hover:shadow-[0_0_0_2px_var(--taller-borde)]"}`}
                  style={{ background: ref?.hexGlobo ?? "#ccc" }} />
              );
            })}
            {extra}
          </div>
        ))}
        {actual && elegido && <Candidatos actual={actual} candidatos={candidatos} onElegir={(codigo) => { onReemplazar(actual.codigo, codigo, elegido.grupo); setElegido({ grupo: elegido.grupo, codigo }); }} />}
        {ayuda && <p className="text-xs text-taller-suave">{ayuda}</p>}
        {aviso && <p role="status" className="text-xs text-taller-texto">{aviso}</p>}
      </section>
    );
  }
  if (variante === "lista") {
    return (
      <section className="flex flex-col gap-2" aria-label={titulo}>
        <div className="flex items-center justify-between gap-2">
          <h2 className="taller-rotulo py-1">{titulo}</h2>
          {puedeDeshacer && (
            <button type="button" onClick={onDeshacer} className="inline-flex min-h-8 items-center gap-1 rounded-lg px-2 text-xs text-taller-acento hover:bg-taller-encima">
              <Undo2 className="size-3.5" aria-hidden /> Deshacer
            </button>
          )}
        </div>
        {porGrupo.map((g) => (
          <div key={g.id} className="flex flex-col gap-0.5">
            {g.nombre && <p className="font-mono text-[0.65rem] uppercase tracking-wider text-taller-suave">{g.nombre}</p>}
            {g.usados.map((u) => {
              const ref = referenciaPorCodigo(u.codigo);
              const activo = elegido?.grupo === g.id && u.codigo === elegido.codigo;
              return (
                <button key={u.codigo} type="button" onClick={() => setElegido(activo ? null : { grupo: g.id, codigo: u.codigo })} aria-pressed={activo} aria-expanded={activo}
                  title={`${ref?.nombreCompleto ?? u.codigo} ${u.codigo} · ${u.cantidad} en ${u.formatos.join(", ")}`}
                  className={`flex min-h-9 w-full items-center gap-2.5 rounded-lg px-1.5 text-left text-[13px] ${activo ? "bg-taller-elegido text-taller-texto" : "text-taller-texto-2 hover:bg-taller-encima"}`}>
                  <span className="size-[22px] shrink-0 rounded-full border-2 border-taller-panel shadow-[0_0_0_1px_var(--taller-borde)]" style={{ background: ref?.hexGlobo ?? "#ccc" }} aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{ref?.nombreCompleto ?? u.codigo}</span>
                  <span className="shrink-0 font-mono text-[11px] text-taller-suave">{u.cantidad} · {u.codigo}</span>
                </button>
              );
            })}
          </div>
        ))}
        {actual && elegido && <Candidatos actual={actual} candidatos={candidatos} onElegir={(codigo) => { onReemplazar(actual.codigo, codigo, elegido.grupo); setElegido({ grupo: elegido.grupo, codigo }); }} />}
        <p className="text-xs leading-snug text-taller-suave">{ayuda ?? `Toca un color para cambiarlo ${porGrupo.length > 1 ? "en esa parte de una vez" : "en toda la escena"}.`}</p>
        {aviso && <p role="status" className="text-xs text-taller-texto">{aviso}</p>}
      </section>
    );
  }
  return (
    <section className="flex flex-col gap-2 rounded-2xl bg-superficie p-3 ring-1 ring-acento/40" aria-label="Colores de la escena">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-texto"><Palette className="size-4 text-acento" aria-hidden /> Colores de la escena</h2>
        {puedeDeshacer && (
          <button type="button" onClick={onDeshacer} className="inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-xs text-acento ring-1 ring-borde hover:bg-superficie-suave lg:min-h-9">
            <Undo2 className="size-3.5" aria-hidden /> Deshacer
          </button>
        )}
      </div>
      <p className="text-xs text-texto-suave">Toca un color para cambiarlo {porGrupo.length > 1 ? "en esa parte de una vez" : "en todo lo que se ve"}.</p>
      {porGrupo.map((g) => (
      <div key={g.id} className="flex flex-col gap-1">
      {g.nombre && <p className="font-mono text-[0.65rem] uppercase tracking-wider text-texto-suave">{g.nombre}</p>}
      <div className="flex flex-wrap gap-1.5">
        {g.usados.map((u) => {
          const ref = referenciaPorCodigo(u.codigo);
          const activo = elegido?.grupo === g.id && u.codigo === elegido.codigo;
          return (
            <button key={u.codigo} type="button" onClick={() => setElegido(activo ? null : { grupo: g.id, codigo: u.codigo })} aria-pressed={activo}
              title={`${ref?.nombreCompleto ?? u.codigo} ${u.codigo} · ${u.cantidad} en ${u.formatos.join(", ")}`}
              className={`inline-flex min-h-11 items-center gap-1.5 rounded-full py-1 pl-1 pr-2.5 text-xs ring-1 lg:min-h-10 ${activo ? "bg-superficie-suave ring-acento ring-2" : "ring-borde hover:bg-superficie-suave"}`}>
              <span className="size-7 shrink-0 rounded-full" style={{ background: ref?.hexGlobo ?? "#ccc", boxShadow: "inset 0 0 0 1px rgba(0,0,0,.12)" }} />
              <span className="text-left leading-tight text-texto">{ref?.nombreCompleto ?? u.codigo}<span className="block font-mono text-[0.65rem] text-texto-suave">{u.cantidad} · {u.codigo}</span></span>
            </button>
          );
        })}
      </div>
      </div>
      ))}
      {actual && elegido && <Candidatos actual={actual} candidatos={candidatos} onElegir={(codigo) => { onReemplazar(actual.codigo, codigo, elegido.grupo); setElegido({ grupo: elegido.grupo, codigo }); }} />}
      {aviso && <p role="status" className="text-xs text-texto">{aviso}</p>}
    </section>
  );
}

type Usado = ReturnType<typeof coloresUsados>[number];
type Candidato = { ref: ReturnType<typeof coloresDelFormato>[number]; faltaEn: string[] };

/** Los colores por los que se puede cambiar el elegido (por familia; los que no vienen en todos sus formatos, marcados). */
function Candidatos({ actual, candidatos, onElegir }: { actual: Usado; candidatos: ReadonlyArray<[string, Candidato[]]>; onElegir: (codigo: string) => void }) {
  return (
    <div className="rounded-xl bg-superficie-suave p-2">
      <p className="mb-1 text-xs text-texto">Cambiar <b>{referenciaPorCodigo(actual.codigo)?.nombreCompleto ?? actual.codigo}</b> por:</p>
      <div className="max-h-64 overflow-y-auto pr-1 lg:max-h-52">
        {candidatos.map(([familia, lista]) => (
          <div key={familia} className="mb-1.5">
            <p className="font-mono text-[0.65rem] uppercase tracking-wider text-texto-suave">{NOMBRE_FAMILIA[familia] ?? familia}</p>
            <div className="mt-0.5 flex flex-wrap gap-1">
              {lista.map(({ ref, faltaEn }) => (
                <button key={ref.codigo} type="button" onClick={() => onElegir(ref.codigo)}
                  aria-label={`${ref.nombreCompleto} ${ref.codigo}${faltaEn.length ? ` (no viene en ${faltaEn.join(", ")})` : ""}`}
                  title={`${ref.nombreCompleto} ${ref.codigo}${faltaEn.length ? ` · no viene en ${faltaEn.join(", ")}` : ""}`}
                  className={`relative size-11 rounded-full ring-2 ring-offset-1 lg:size-8 ring-offset-superficie-suave ${ref.codigo === actual.codigo ? "ring-acento" : "ring-transparent hover:ring-borde"} ${faltaEn.length ? "opacity-60" : ""}`}
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
  );
}
