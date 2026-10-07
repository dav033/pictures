"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Rows3, Circle } from "lucide-react";
import { FORMATOS_GLOBO, NOMBRE_FAMILIA, coloresDelFormato, formatoPorId, infladoValido, type FormatoGlobo } from "@/lib/globos3d/formatos";
import type { EscenaGlobos, GloboEnEscena } from "./escena-globos";

const formatoCm = (valor: number) => `${valor.toLocaleString("es-CO", { maximumFractionDigits: 1 })} cm`;

/**
 * Página /3d: cada globo Sempertex modelado en 3D, uno por uno, a su tamaño real. Se elige el formato (R-5 a
 * R-36, Link-O-Loon, tubitos, corazón), el color de la tabla oficial (solo los que se fabrican en ese formato,
 * con su acabado) y el inflado en cm. «Todos los tamaños» pone la familia de redondos lado a lado sobre la
 * cuadrícula de 10 cm para comparar escalas.
 */
export function Taller3D() {
  const lienzoRef = useRef<HTMLCanvasElement>(null);
  const escenaRef = useRef<EscenaGlobos | null>(null);
  const [listo, setListo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formatoId, setFormatoId] = useState("R-12");
  const formato = formatoPorId(formatoId) ?? FORMATOS_GLOBO[2]!;
  const colores = useMemo(() => coloresDelFormato(formato.id), [formato.id]);
  const [codigo, setCodigo] = useState("009");
  const color = colores.find((c) => c.codigo === codigo) ?? colores[0];
  const [infladoCm, setInfladoCm] = useState(formato.infladoDecoracionCm);
  const [vista, setVista] = useState<"uno" | "todos">("uno");

  // La escena se crea una vez (three.js se carga solo en el navegador).
  useEffect(() => {
    let vivo = true;
    let observador: ResizeObserver | null = null;
    void import("./escena-globos").then(({ crearEscena }) => {
      if (!vivo || !lienzoRef.current) return;
      try {
        const escena = crearEscena(lienzoRef.current);
        escenaRef.current = escena;
        observador = new ResizeObserver(() => escena.redimensionar());
        observador.observe(lienzoRef.current);
        setListo(true);
      } catch (causa) {
        setError("Tu navegador no pudo abrir el visor 3D (WebGL). Prueba con Chrome o Edge actualizados.");
        console.error("[3d]", causa);
      }
    });
    return () => {
      vivo = false;
      observador?.disconnect();
      escenaRef.current?.destruir();
      escenaRef.current = null;
    };
  }, []);

  // Lo que se ve: un globo, o la fila de todos los formatos redondos en el color elegido.
  useEffect(() => {
    const escena = escenaRef.current;
    if (!listo || !escena || !color) return;
    if (vista === "todos") {
      const fila: GloboEnEscena[] = FORMATOS_GLOBO.filter((f) => f.tipo === "redondo" && color.formatos.includes(f.id))
        .map((f) => ({ formato: f, infladoCm: f.infladoDecoracionCm, hex: color.hexGlobo, familia: color.familia }));
      escena.mostrar(fila);
    } else {
      escena.mostrar([{ formato, infladoCm: infladoValido(formato, infladoCm), hex: color.hexGlobo, familia: color.familia }]);
    }
  }, [listo, vista, formato, infladoCm, color]);

  function elegirFormato(f: FormatoGlobo) {
    setFormatoId(f.id);
    setInfladoCm(f.infladoDecoracionCm);
    if (!coloresDelFormato(f.id).some((c) => c.codigo === codigo)) setCodigo(coloresDelFormato(f.id)[0]?.codigo ?? codigo);
    setVista("uno");
  }

  const porFamilia = useMemo(() => {
    const grupos = new Map<string, typeof colores>();
    for (const c of colores) grupos.set(c.familia, [...(grupos.get(c.familia) ?? []), c]);
    return [...grupos.entries()];
  }, [colores]);

  return (
    <main className="mx-auto flex min-h-dvh max-w-7xl flex-col gap-4 px-4 py-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-xs uppercase tracking-wider text-acento">Taller 3D</p>
          <h1 className="text-2xl font-semibold text-texto">Globos Sempertex en 3D</h1>
          <p className="text-sm text-texto-suave">Cada formato a su tamaño real. La cuadrícula del piso es de 10 cm.</p>
        </div>
        <Link href="/asistente" className="inline-flex min-h-11 items-center gap-2 rounded-full px-4 text-sm text-texto ring-1 ring-borde hover:bg-superficie-suave">
          <ArrowLeft className="size-4" aria-hidden /> Volver al asistente
        </Link>
      </header>

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
        <aside className="order-2 flex min-w-0 flex-col gap-4 lg:order-1" aria-label="Elegir el globo">
          <section className="rounded-2xl bg-superficie p-3 ring-1 ring-borde">
            <h2 className="mb-2 text-sm font-semibold text-texto">Formato</h2>
            <div className="grid grid-cols-3 gap-1.5">
              {FORMATOS_GLOBO.map((f) => (
                <button key={f.id} type="button" onClick={() => elegirFormato(f)} aria-pressed={vista === "uno" && f.id === formato.id}
                  className={`min-h-11 rounded-xl px-2 text-sm ring-1 transition-colors ${vista === "uno" && f.id === formato.id ? "bg-acento text-sobre-acento ring-acento" : "bg-superficie text-texto ring-borde hover:bg-superficie-suave"}`}>
                  {f.id}
                </button>
              ))}
            </div>
            <button type="button" onClick={() => setVista(vista === "todos" ? "uno" : "todos")} aria-pressed={vista === "todos"}
              className={`mt-2 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl text-sm ring-1 ${vista === "todos" ? "bg-acento text-sobre-acento ring-acento" : "bg-superficie text-texto ring-borde hover:bg-superficie-suave"}`}>
              {vista === "todos" ? <Circle className="size-4" aria-hidden /> : <Rows3 className="size-4" aria-hidden />}
              {vista === "todos" ? "Ver un solo globo" : "Todos los tamaños lado a lado"}
            </button>
          </section>

          {vista === "uno" && (
            <section className="rounded-2xl bg-superficie p-3 ring-1 ring-borde">
              <label htmlFor="inflado" className="flex items-baseline justify-between text-sm font-semibold text-texto">
                Inflado <span className="font-mono text-xs font-normal text-texto-suave">{formatoCm(infladoValido(formato, infladoCm))} de {formatoCm(formato.diametroMaxCm)} máx.</span>
              </label>
              <input id="inflado" type="range" min={Math.round(formato.diametroMaxCm * 0.4 * 10) / 10} max={formato.diametroMaxCm} step={0.5}
                value={infladoValido(formato, infladoCm)} onChange={(e) => setInfladoCm(Number(e.target.value))} className="mt-2 w-full accent-[var(--color-acento,#7c3aed)]" />
              <button type="button" onClick={() => setInfladoCm(formato.infladoDecoracionCm)} className="mt-1 text-xs text-acento underline-offset-2 hover:underline">
                Inflado de decoración ({formatoCm(formato.infladoDecoracionCm)})
              </button>
              <p className="mt-2 text-xs text-texto-suave">{formato.descripcion}</p>
            </section>
          )}

          <section className="min-h-0 rounded-2xl bg-superficie p-3 ring-1 ring-borde">
            <h2 className="mb-1 text-sm font-semibold text-texto">Color <span className="font-normal text-texto-suave">· {colores.length} en {formato.id}</span></h2>
            <div className="flex max-h-[42vh] flex-col gap-3 overflow-y-auto pr-1">
              {porFamilia.map(([familia, lista]) => (
                <div key={familia}>
                  <p className="mb-1 font-mono text-[0.7rem] uppercase tracking-wider text-texto-suave">{NOMBRE_FAMILIA[familia] ?? familia}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {lista.map((c) => (
                      <button key={c.codigo} type="button" onClick={() => setCodigo(c.codigo)} aria-pressed={c.codigo === color?.codigo}
                        title={`${c.nombreCompleto} ${c.codigo}`} aria-label={`${c.nombreCompleto} ${c.codigo}`}
                        className={`size-9 rounded-full ring-2 ring-offset-2 ring-offset-superficie ${c.codigo === color?.codigo ? "ring-acento" : "ring-transparent hover:ring-borde"}`}
                        style={{ background: c.hexGlobo, boxShadow: "inset 0 0 0 1px rgba(0,0,0,.12)" }} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </aside>

        <section className="order-1 flex min-w-0 flex-col gap-2 lg:order-2" aria-label="Visor 3D">
          <div className="relative h-[58vh] min-h-[320px] overflow-hidden rounded-2xl bg-superficie-suave ring-1 ring-borde lg:h-[calc(100dvh-170px)]">
            <canvas ref={lienzoRef} className="block h-full w-full touch-none" aria-label="Globo en 3D: arrastra para girar, rueda o pellizca para acercar" />
            {!listo && !error && <p className="absolute inset-0 grid place-items-center text-sm text-texto-suave">Cargando el visor 3D…</p>}
            {error && <p role="alert" className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-texto">{error}</p>}
            {color && (
              <div className="pointer-events-none absolute left-3 top-3 max-w-[80%] rounded-xl bg-superficie/90 px-3 py-2 text-sm shadow-sm ring-1 ring-borde backdrop-blur">
                <p className="font-semibold text-texto">{vista === "todos" ? "Redondos de 5\" a 36\"" : formato.nombre} · {color.nombreCompleto} <span className="font-mono text-xs text-texto-suave">{color.codigo}</span></p>
                <p className="font-mono text-xs text-texto-suave">
                  {vista === "todos"
                    ? "Inflado de decoración de cada tamaño"
                    : formato.largoCm
                      ? `${formatoCm(infladoValido(formato, infladoCm))} de grosor × ${formatoCm(formato.largoCm)} de largo`
                      : `${formatoCm(infladoValido(formato, infladoCm))} de diámetro`}
                  {" · "}{color.acabado}
                </p>
              </div>
            )}
          </div>
          <p className="text-xs text-texto-suave">Arrastra para girar · rueda o pellizca para acercar · medidas nominales del catálogo Sempertex; el color es el del globo inflado.</p>
        </section>
      </div>
    </main>
  );
}
