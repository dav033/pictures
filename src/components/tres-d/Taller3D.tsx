"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Rows3, Circle, Anchor } from "lucide-react";
import { FORMATOS_GLOBO, NOMBRE_FAMILIA, coloresDelFormato, formatoPorId, infladoValido, type FormatoGlobo } from "@/lib/globos3d/formatos";
import { MODULOS, armarModulo, materialesModulo, moduloPorId, type TipoModulo } from "@/lib/globos3d/modulos";
import { PATRONES_COLUMNA, armarColumna, type PatronColumna } from "@/lib/globos3d/columnas";
import { FORMAS_ARCO, armarArco, type FormaArco } from "@/lib/globos3d/arcos";
import { FLORES_PREDEFINIDAS, armarFlor, colocarEn, elegirAnclas, materialesPorFormato, type GloboDecoracion, type PropiedadesFlor, type ReglaDecoracion } from "@/lib/globos3d/decoraciones";
import { PanelFlor, type DondeDecoracion } from "./PanelFlor";
import { PanelPared, PARED_INICIAL, type OpcionesPared } from "./PanelPared";
import { armarPared } from "@/lib/globos3d/paredes";
import { referenciaPorCodigo, type ReferenciaSempertex } from "@/lib/plan/referencia-sempertex";
import type { EscenaGlobos, GloboColocadoEnEscena, GloboEnEscena } from "./escena-globos";

const formatoCm = (valor: number) => `${valor.toLocaleString("es-CO", { maximumFractionDigits: 1 })} cm`;

/** Formatos de la columna de cuartetos: redondos de 5" a 18". */
const FORMATOS_COLUMNA = ["R-5", "R-9", "R-12", "R-18"] as const;

/** Formatos con los que se arman módulos: redondos de 5" a 24" y Link-O-Loon 6 y 12. */
const FORMATOS_MODULO = ["R-5", "R-9", "R-12", "R-18", "R-24", "LOL-6", "LOL-12"] as const;

type Modo = "globo" | "modulo" | "columna" | "arco" | "pared" | "decoracion";

const BOTON = "min-h-11 rounded-xl px-2 text-sm ring-1 transition-colors";
const ACTIVO = "bg-acento text-sobre-acento ring-acento";
const INACTIVO = "bg-superficie text-texto ring-borde hover:bg-superficie-suave";

/**
 * Página /3d. Dos pestañas:
 * - Globo: cada globo Sempertex a su tamaño real (formato, color oficial, inflado), o todos los redondos lado a lado.
 * - Módulos: pareja, trío, cuarteto, quinteto y sexteto armados como enseña Sempertex, con color por globo,
 *   sus anclas (donde se cuelgan las decoraciones) y su lista de materiales.
 */
export function Taller3D() {
  const lienzoRef = useRef<HTMLCanvasElement>(null);
  const escenaRef = useRef<EscenaGlobos | null>(null);
  const [listo, setListo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modo, setModo] = useState<Modo>("globo");
  const [formatoId, setFormatoId] = useState("R-12");
  const formato = formatoPorId(formatoId) ?? FORMATOS_GLOBO[2]!;
  const colores = useMemo(() => coloresDelFormato(formato.id), [formato.id]);
  const [codigo, setCodigo] = useState("009");
  const color = colores.find((c) => c.codigo === codigo) ?? colores[0];
  const [infladoCm, setInfladoCm] = useState(formato.infladoDecoracionCm);
  const [vista, setVista] = useState<"uno" | "todos">("uno");
  // Módulos
  const [moduloId, setModuloId] = useState<TipoModulo>("cuarteto");
  const modulo = moduloPorId(moduloId) ?? MODULOS[2]!;
  const [coloresModulo, setColoresModulo] = useState<string[]>(["009", "009", "009", "009", "009", "009"]);
  const [ranura, setRanura] = useState<number | null>(null);
  const [verAnclas, setVerAnclas] = useState(true);
  // Columna (los colores de la espiralada de Sempertex: Amarillo y Fucsia opuestos, Azul Caribe y Verde Lima opuestos)
  const [patron, setPatron] = useState<PatronColumna>("espiral");
  const [alturaCm, setAlturaCm] = useState(180);
  const [coloresColumna, setColoresColumna] = useState<string[]>(["020", "038", "012", "031"]);
  // Arco (comparte patrón y colores con la columna: es la misma trenza sobre una curva)
  const [forma, setForma] = useState<FormaArco>("redondo");
  const [anchoArcoCm, setAnchoArcoCm] = useState(300);
  const [altoArcoCm, setAltoArcoCm] = useState(240);
  // Decoración: una flor por propiedades, sola o colgada de las anclas de la columna o del arco.
  const [flor, setFlor] = useState<PropiedadesFlor>(FLORES_PREDEFINIDAS[0]!.propiedades);
  const [donde, setDonde] = useState<DondeDecoracion>("columna");
  const [regla, setRegla] = useState<ReglaDecoracion>({ cadaNiveles: 2, caras: 2 });
  // Pared: malla Link-O-Loon tipo flor.
  const [pared, setPared] = useState<OpcionesPared>(PARED_INICIAL);

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

  const inflado = infladoValido(formato, infladoCm);
  const armado = useMemo(() => armarModulo(modulo, formato, inflado), [modulo, formato, inflado]);
  const datosPatron = PATRONES_COLUMNA.find((p) => p.id === patron) ?? PATRONES_COLUMNA[1]!;
  const arco = useMemo(() => armarArco({ formato, infladoCm: inflado, forma, anchoCm: anchoArcoCm, altoCm: altoArcoCm, patron, colores: coloresColumna.slice(0, datosPatron.colores) }), [formato, inflado, forma, anchoArcoCm, altoArcoCm, patron, coloresColumna, datosPatron.colores]);
  const florArmada = useMemo(() => armarFlor(flor), [flor]);
  const paredArmada = useMemo(() => armarPared({
    formato: formatoPorId(pared.formatoId)!, infladoCm: pared.infladoCm, anchoCm: pared.anchoCm, altoCm: pared.altoCm, patron: pared.patron, colores: pared.colores,
    union: { formato: formatoPorId("R-5")!, infladoCm: pared.union.infladoCm, codigo: pared.union.codigo },
  }), [pared]);
  const columna = useMemo(() => armarColumna({ formato, infladoCm: inflado, alturaCm, patron, colores: coloresColumna.slice(0, datosPatron.colores) }), [formato, inflado, alturaCm, patron, coloresColumna, datosPatron.colores]);
  const refModulo = (i: number): ReferenciaSempertex | undefined => {
    const c = coloresModulo[i] ?? codigo;
    return colores.find((x) => x.codigo === c) ?? color;
  };

  // Decoración: la estructura elegida (o nada) y una flor en cada ancla que cumple la regla.
  const escenaDecoracion = useMemo((): GloboDecoracion[] => {
    if (donde === "sola") return florArmada.globos;
    if (donde === "pared") {
      const cada = Math.max(1, regla.cadaNiveles);
      const flores = paredArmada.anclas.filter((a) => a.fila % cada === 0 && a.columna % cada === 0).flatMap((ancla) => colocarEn(florArmada.globos, ancla));
      return [...paredArmada.globos.map((g) => ({ formatoId: g.formatoId, infladoCm: g.infladoCm, codigo: g.codigo, nudo: g.nudo, direccion: g.direccion, cuelloExtraCm: g.cuelloExtraCm })), ...flores];
    }
    const estructura = donde === "arco" ? arco : columna;
    const base: GloboDecoracion[] = estructura.globos.map((g) => ({ formatoId: formato.id, infladoCm: inflado, codigo: g.codigo, nudo: g.nudo, direccion: g.direccion, cuelloExtraCm: g.cuelloExtraCm }));
    const flores = elegirAnclas(estructura.anclas, regla).flatMap((ancla) => colocarEn(florArmada.globos, ancla));
    return [...base, ...flores];
  }, [donde, arco, columna, paredArmada, regla, florArmada, formato.id, inflado]);
  const materialesDecoracion = useMemo(() => materialesPorFormato(escenaDecoracion), [escenaDecoracion]);
  const floresPuestas = donde === "sola" ? 1
    : donde === "pared" ? paredArmada.anclas.filter((a) => a.fila % Math.max(1, regla.cadaNiveles) === 0 && a.columna % Math.max(1, regla.cadaNiveles) === 0).length
      : elegirAnclas((donde === "arco" ? arco : columna).anclas, regla).length;

  // Lo que se ve.
  useEffect(() => {
    const escena = escenaRef.current;
    if (!listo || !escena || !color) return;
    if (modo === "pared") {
      escena.mostrarModulo(paredArmada.globos.map((g) => {
        const ref = referenciaPorCodigo(g.codigo);
        return { formato: formatoPorId(g.formatoId) ?? formato, infladoCm: g.infladoCm, hex: ref?.hexGlobo ?? "#ffffff", familia: ref?.familia ?? "fashion", nudo: g.nudo, direccion: g.direccion, cuelloExtraCm: g.cuelloExtraCm };
      }), []);
    } else if (modo === "decoracion") {
      escena.mostrarModulo(escenaDecoracion.map((g) => {
        const ref = referenciaPorCodigo(g.codigo);
        return { formato: formatoPorId(g.formatoId) ?? formato, infladoCm: g.infladoCm, hex: ref?.hexGlobo ?? "#ffffff", familia: ref?.familia ?? "fashion", nudo: g.nudo, direccion: g.direccion, cuelloExtraCm: g.cuelloExtraCm };
      }), []);
    } else if (modo === "columna" || modo === "arco") {
      const globos: GloboColocadoEnEscena[] = (modo === "arco" ? arco.globos : columna.globos).map((g) => {
        const ref = colores.find((x) => x.codigo === g.codigo) ?? color;
        return { formato, infladoCm: inflado, hex: ref.hexGlobo, familia: ref.familia, nudo: g.nudo, direccion: g.direccion, cuelloExtraCm: g.cuelloExtraCm };
      });
      escena.mostrarModulo(globos, []);
    } else if (modo === "modulo") {
      const globos: GloboColocadoEnEscena[] = armado.globos.map((g) => {
        const ref = colores.find((x) => x.codigo === coloresModulo[g.indice]) ?? color;
        return { formato, infladoCm: inflado, hex: ref.hexGlobo, familia: ref.familia, nudo: g.nudo, direccion: g.direccion, cuelloExtraCm: g.cuelloExtraCm };
      });
      escena.mostrarModulo(globos, verAnclas ? armado.anclas.map((a) => a.posicion) : []);
    } else if (vista === "todos") {
      const fila: GloboEnEscena[] = FORMATOS_GLOBO.filter((f) => f.tipo === "redondo" && color.formatos.includes(f.id))
        .map((f) => ({ formato: f, infladoCm: f.infladoDecoracionCm, hex: color.hexGlobo, familia: color.familia }));
      escena.mostrar(fila);
    } else {
      escena.mostrar([{ formato, infladoCm: inflado, hex: color.hexGlobo, familia: color.familia }]);
    }
  }, [listo, modo, vista, formato, inflado, color, colores, coloresModulo, armado, verAnclas, columna, arco, escenaDecoracion, paredArmada]);

  function elegirFormato(f: FormatoGlobo) {
    setFormatoId(f.id);
    setInfladoCm(f.infladoDecoracionCm);
    const disponibles = coloresDelFormato(f.id);
    if (!disponibles.some((c) => c.codigo === codigo)) setCodigo(disponibles[0]?.codigo ?? codigo);
    setColoresModulo((actual) => actual.map((c) => (disponibles.some((d) => d.codigo === c) ? c : disponibles[0]?.codigo ?? c)));
    setColoresColumna((actual) => actual.map((c) => (disponibles.some((d) => d.codigo === c) ? c : disponibles[0]?.codigo ?? c)));
    setVista("uno");
  }

  function cambiarModo(nuevo: Modo) {
    setModo(nuevo);
    if (nuevo === "modulo" && !FORMATOS_MODULO.includes(formato.id as (typeof FORMATOS_MODULO)[number])) elegirFormato(formatoPorId("R-12")!);
    if ((nuevo === "columna" || nuevo === "arco" || nuevo === "decoracion") && !FORMATOS_COLUMNA.includes(formato.id as (typeof FORMATOS_COLUMNA)[number])) elegirFormato(formatoPorId("R-12")!);
    setRanura(null);
  }

  function elegirColor(nuevo: string) {
    setCodigo(nuevo);
    if (modo === "columna" || modo === "arco") {
      setColoresColumna((actual) => (ranura === null ? actual.map(() => nuevo) : actual.map((c, i) => (i === ranura ? nuevo : c))));
      return;
    }
    if (modo !== "modulo") return;
    // Con una ranura elegida cambia solo ese globo; sin ranura, todo el módulo queda de ese color.
    setColoresModulo((actual) => (ranura === null ? actual.map(() => nuevo) : actual.map((c, i) => (i === ranura ? nuevo : c))));
  }

  const porFamilia = useMemo(() => {
    const grupos = new Map<string, typeof colores>();
    for (const c of colores) grupos.set(c.familia, [...(grupos.get(c.familia) ?? []), c]);
    return [...grupos.entries()];
  }, [colores]);

  const materiales = materialesModulo(coloresModulo.slice(0, modulo.globos));
  const formatosVisibles = modo === "modulo"
    ? FORMATOS_GLOBO.filter((f) => FORMATOS_MODULO.includes(f.id as (typeof FORMATOS_MODULO)[number]))
    : modo === "columna" || modo === "arco" ? FORMATOS_GLOBO.filter((f) => FORMATOS_COLUMNA.includes(f.id as (typeof FORMATOS_COLUMNA)[number])) : FORMATOS_GLOBO;
  const seleccionado = (i: number) => (modo === "modulo" ? coloresModulo[i] : codigo);

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

      <div role="tablist" aria-label="Qué modelar" className="inline-flex w-fit gap-1 rounded-full bg-superficie p-1 ring-1 ring-borde">
        {([["globo", "Globos"], ["modulo", "Módulos"], ["columna", "Columna"], ["arco", "Arco"], ["pared", "Pared"], ["decoracion", "Decoración"]] as const).map(([valor, etiqueta]) => (
          <button key={valor} type="button" role="tab" aria-selected={modo === valor} onClick={() => cambiarModo(valor)}
            className={`min-h-10 rounded-full px-5 text-sm font-medium ${modo === valor ? "bg-acento text-sobre-acento" : "text-texto hover:bg-superficie-suave"}`}>
            {etiqueta}
          </button>
        ))}
      </div>

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
        <aside className="order-2 flex min-w-0 flex-col gap-4 lg:order-1" aria-label="Elegir el globo">
          {modo === "pared" ? (
            <PanelPared valor={pared} onCambio={setPared} />
          ) : modo === "decoracion" ? (
            <PanelFlor flor={flor} onFlor={setFlor} donde={donde} onDonde={setDonde} regla={regla} onRegla={setRegla} />
          ) : (<>
          {modo === "modulo" && (
            <section className="rounded-2xl bg-superficie p-3 ring-1 ring-borde">
              <h2 className="mb-2 text-sm font-semibold text-texto">Módulo</h2>
              <div className="grid grid-cols-2 gap-1.5">
                {MODULOS.map((m) => (
                  <button key={m.id} type="button" onClick={() => { setModuloId(m.id); setRanura(null); }} aria-pressed={m.id === modulo.id}
                    className={`${BOTON} ${m.id === modulo.id ? ACTIVO : INACTIVO}`}>
                    {m.nombre} <span className="font-mono text-xs opacity-75">×{m.globos}</span>
                  </button>
                ))}
              </div>
              <p className="mt-2 text-xs text-texto-suave">{modulo.armado}</p>
            </section>
          )}

          {modo === "arco" && (
            <section className="rounded-2xl bg-superficie p-3 ring-1 ring-borde">
              <h2 className="mb-2 text-sm font-semibold text-texto">Forma del arco</h2>
              <div className="grid grid-cols-3 gap-1.5">
                {FORMAS_ARCO.map((f) => (
                  <button key={f.id} type="button" onClick={() => setForma(f.id)} aria-pressed={f.id === forma}
                    className={`${BOTON} ${f.id === forma ? ACTIVO : INACTIVO}`}>{f.nombre}</button>
                ))}
              </div>
              <p className="mt-2 text-xs text-texto-suave">{FORMAS_ARCO.find((f) => f.id === forma)?.descripcion}</p>
            </section>
          )}

          {(modo === "columna" || modo === "arco") && (
            <section className="rounded-2xl bg-superficie p-3 ring-1 ring-borde">
              <h2 className="mb-2 text-sm font-semibold text-texto">Trenza de cuartetos</h2>
              <div className="grid grid-cols-3 gap-1.5">
                {PATRONES_COLUMNA.map((p) => (
                  <button key={p.id} type="button" onClick={() => { setPatron(p.id); setRanura(null); }} aria-pressed={p.id === patron}
                    className={`${BOTON} ${p.id === patron ? ACTIVO : INACTIVO}`}>{p.nombre}</button>
                ))}
              </div>
              <p className="mt-2 text-xs text-texto-suave">{datosPatron.descripcion}</p>
              {modo === "columna" ? (
                <>
                  <label htmlFor="altura" className="mt-3 flex items-baseline justify-between text-sm font-semibold text-texto">
                    Altura <span className="font-mono text-xs font-normal text-texto-suave">{(alturaCm / 100).toLocaleString("es-CO", { maximumFractionDigits: 2 })} m · {columna.niveles} cuartetos</span>
                  </label>
                  <input id="altura" type="range" min={40} max={260} step={5} value={alturaCm} onChange={(e) => setAlturaCm(Number(e.target.value))} className="mt-2 w-full accent-[var(--color-acento,#7c3aed)]" />
                </>
              ) : (
                <>
                  <label htmlFor="ancho-arco" className="mt-3 flex items-baseline justify-between text-sm font-semibold text-texto">
                    Ancho <span className="font-mono text-xs font-normal text-texto-suave">{(anchoArcoCm / 100).toLocaleString("es-CO", { maximumFractionDigits: 2 })} m</span>
                  </label>
                  <input id="ancho-arco" type="range" min={100} max={500} step={10} value={anchoArcoCm} onChange={(e) => setAnchoArcoCm(Number(e.target.value))} className="mt-2 w-full accent-[var(--color-acento,#7c3aed)]" />
                  <label htmlFor="alto-arco" className="mt-3 flex items-baseline justify-between text-sm font-semibold text-texto">
                    Alto <span className="font-mono text-xs font-normal text-texto-suave">{(altoArcoCm / 100).toLocaleString("es-CO", { maximumFractionDigits: 2 })} m · {arco.niveles} cuartetos</span>
                  </label>
                  <input id="alto-arco" type="range" min={100} max={350} step={10} value={altoArcoCm} onChange={(e) => setAltoArcoCm(Number(e.target.value))} className="mt-2 w-full accent-[var(--color-acento,#7c3aed)]" />
                </>
              )}
              {datosPatron.colores > 1 && (
                <>
                  <p className="mb-2 mt-3 text-xs text-texto-suave">{ranura === null ? "Toca un color de abajo para toda la columna, o elige un puesto para cambiar solo ese." : `Elige el color ${ranura + 1}.`}</p>
                  <div className="flex flex-wrap items-center gap-2">
                    {Array.from({ length: datosPatron.colores }, (_, i) => {
                      const ref = colores.find((x) => x.codigo === coloresColumna[i]);
                      return (
                        <button key={i} type="button" onClick={() => setRanura(ranura === i ? null : i)} aria-pressed={ranura === i}
                          aria-label={`Color ${i + 1}: ${ref?.nombreCompleto ?? ""}`} title={`Color ${i + 1}: ${ref?.nombreCompleto ?? ""}`}
                          className={`grid size-10 place-items-center rounded-full font-mono text-xs ring-2 ring-offset-2 ring-offset-superficie ${ranura === i ? "ring-acento" : "ring-borde"}`}
                          style={{ background: ref?.hexGlobo, color: "rgba(0,0,0,.55)" }}>{i + 1}</button>
                      );
                    })}
                  </div>
                </>
              )}
            </section>
          )}

          <section className="rounded-2xl bg-superficie p-3 ring-1 ring-borde">
            <h2 className="mb-2 text-sm font-semibold text-texto">{modo === "modulo" ? "Globo del módulo" : modo === "columna" || modo === "arco" ? "Globo de los cuartetos" : "Formato"}</h2>
            <div className="grid grid-cols-3 gap-1.5">
              {formatosVisibles.map((f) => (
                <button key={f.id} type="button" onClick={() => elegirFormato(f)} aria-pressed={(modo !== "globo" || vista === "uno") && f.id === formato.id}
                  className={`${BOTON} ${(modo !== "globo" || vista === "uno") && f.id === formato.id ? ACTIVO : INACTIVO}`}>
                  {f.id}
                </button>
              ))}
            </div>
            {modo === "globo" && (
              <button type="button" onClick={() => setVista(vista === "todos" ? "uno" : "todos")} aria-pressed={vista === "todos"}
                className={`mt-2 inline-flex w-full items-center justify-center gap-2 ${BOTON} ${vista === "todos" ? ACTIVO : INACTIVO}`}>
                {vista === "todos" ? <Circle className="size-4" aria-hidden /> : <Rows3 className="size-4" aria-hidden />}
                {vista === "todos" ? "Ver un solo globo" : "Todos los tamaños lado a lado"}
              </button>
            )}
          </section>

          {(modo !== "globo" || vista === "uno") && (
            <section className="rounded-2xl bg-superficie p-3 ring-1 ring-borde">
              <label htmlFor="inflado" className="flex items-baseline justify-between text-sm font-semibold text-texto">
                Inflado <span className="font-mono text-xs font-normal text-texto-suave">{formatoCm(inflado)} de {formatoCm(formato.diametroMaxCm)} máx.</span>
              </label>
              <input id="inflado" type="range" min={Math.round(formato.diametroMaxCm * 0.4 * 10) / 10} max={formato.diametroMaxCm} step={0.5}
                value={inflado} onChange={(e) => setInfladoCm(Number(e.target.value))} className="mt-2 w-full accent-[var(--color-acento,#7c3aed)]" />
              <button type="button" onClick={() => setInfladoCm(formato.infladoDecoracionCm)} className="mt-1 text-xs text-acento underline-offset-2 hover:underline">
                Inflado de decoración ({formatoCm(formato.infladoDecoracionCm)})
              </button>
              {modo === "globo" && <p className="mt-2 text-xs text-texto-suave">{formato.descripcion}</p>}
            </section>
          )}

          {modo === "modulo" && (
            <section className="rounded-2xl bg-superficie p-3 ring-1 ring-borde">
              <h2 className="text-sm font-semibold text-texto">Color de cada globo</h2>
              <p className="mb-2 text-xs text-texto-suave">{ranura === null ? "Elige un color para todo el módulo, o toca un globo para cambiar solo ese." : `Elige el color del globo ${ranura + 1}.`}</p>
              <div className="flex flex-wrap items-center gap-2">
                {Array.from({ length: modulo.globos }, (_, i) => {
                  const ref = refModulo(i);
                  return (
                    <button key={i} type="button" onClick={() => setRanura(ranura === i ? null : i)} aria-pressed={ranura === i}
                      aria-label={`Globo ${i + 1}: ${ref?.nombreCompleto ?? ""}`} title={`Globo ${i + 1}: ${ref?.nombreCompleto ?? ""}`}
                      className={`grid size-10 place-items-center rounded-full font-mono text-xs ring-2 ring-offset-2 ring-offset-superficie ${ranura === i ? "ring-acento" : "ring-borde"}`}
                      style={{ background: ref?.hexGlobo, color: "rgba(0,0,0,.55)" }}>{i + 1}</button>
                  );
                })}
                {ranura !== null && <button type="button" onClick={() => setRanura(null)} className="text-xs text-acento underline-offset-2 hover:underline">Todo el módulo</button>}
              </div>
              <label className="mt-3 flex items-center gap-2 text-sm text-texto" htmlFor="ver-anclas">
                <input id="ver-anclas" type="checkbox" checked={verAnclas} onChange={(e) => setVerAnclas(e.target.checked)} />
                <Anchor className="size-4 text-acento" aria-hidden /> Ver anclas ({armado.anclas.length})
              </label>
              <p className="mt-1 text-xs text-texto-suave">Las anclas son los puntos donde se cuelga una decoración: el centro y los huecos entre globos.</p>
            </section>
          )}

          <section className="min-h-0 rounded-2xl bg-superficie p-3 ring-1 ring-borde">
            <h2 className="mb-1 text-sm font-semibold text-texto">Color <span className="font-normal text-texto-suave">· {colores.length} en {formato.id}</span></h2>
            <div className="flex max-h-[42vh] flex-col gap-3 overflow-y-auto pr-1">
              {porFamilia.map(([familia, lista]) => (
                <div key={familia}>
                  <p className="mb-1 font-mono text-[0.7rem] uppercase tracking-wider text-texto-suave">{NOMBRE_FAMILIA[familia] ?? familia}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {lista.map((c) => {
                      const marcado = modo === "columna" || modo === "arco"
                        ? (ranura === null ? coloresColumna.slice(0, datosPatron.colores).every((x) => x === c.codigo) : coloresColumna[ranura] === c.codigo)
                        : modo === "modulo" ? (ranura === null ? coloresModulo.slice(0, modulo.globos).every((x) => x === c.codigo) : seleccionado(ranura) === c.codigo) : c.codigo === color?.codigo;
                      return (
                        <button key={c.codigo} type="button" onClick={() => elegirColor(c.codigo)} aria-pressed={marcado}
                          title={`${c.nombreCompleto} ${c.codigo}`} aria-label={`${c.nombreCompleto} ${c.codigo}`}
                          className={`size-9 rounded-full ring-2 ring-offset-2 ring-offset-superficie ${marcado ? "ring-acento" : "ring-transparent hover:ring-borde"}`}
                          style={{ background: c.hexGlobo, boxShadow: "inset 0 0 0 1px rgba(0,0,0,.12)" }} />
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </section>
          </>)}
        </aside>

        <section className="order-1 flex min-w-0 flex-col gap-2 lg:order-2" aria-label="Visor 3D">
          <div className="relative h-[58vh] min-h-[320px] overflow-hidden rounded-2xl bg-superficie-suave ring-1 ring-borde lg:h-[calc(100dvh-220px)]">
            <canvas ref={lienzoRef} className="block h-full w-full touch-none" aria-label="Modelo en 3D: arrastra para girar, rueda o pellizca para acercar" />
            {!listo && !error && <p className="absolute inset-0 grid place-items-center text-sm text-texto-suave">Cargando el visor 3D…</p>}
            {error && <p role="alert" className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-texto">{error}</p>}
            {color && (
              <div className="pointer-events-none absolute left-3 top-3 max-w-[80%] rounded-xl bg-superficie/90 px-3 py-2 text-sm shadow-sm ring-1 ring-borde backdrop-blur">
                {modo === "pared" ? (
                  <>
                    <p className="font-semibold text-texto">Malla {pared.formatoId} tipo flor · {(paredArmada.anchoCm / 100).toLocaleString("es-CO", { maximumFractionDigits: 2 })} × {(paredArmada.altoCm / 100).toLocaleString("es-CO", { maximumFractionDigits: 2 })} m</p>
                    <p className="font-mono text-xs text-texto-suave">{paredArmada.eslabones} eslabones · {paredArmada.uniones} parejas de unión ({paredArmada.uniones * 2} R-5)</p>
                    <ul className="mt-1 text-xs text-texto">
                      {paredArmada.materiales.map((m) => {
                        const ref = referenciaPorCodigo(m.codigo);
                        return <li key={`${m.formatoId}|${m.codigo}`}>{m.cantidad} × {m.formatoId} {ref?.nombreCompleto ?? m.codigo} <span className="font-mono text-texto-suave">{m.codigo}</span></li>;
                      })}
                    </ul>
                  </>
                ) : modo === "decoracion" ? (
                  <>
                    <p className="font-semibold text-texto">{donde === "sola" ? "Flor de globos" : `${floresPuestas} flores en ${donde === "arco" ? "el arco" : donde === "pared" ? "la pared" : "la columna"}`} · {flor.petalos.cantidad} pétalos {flor.petalos.formatoId}{flor.centro ? ` + centro ${flor.centro.formatoId}` : ""}</p>
                    <p className="font-mono text-xs text-texto-suave">{donde === "sola" ? `${florArmada.diametroCm} cm de ancho · ${florArmada.globos.length} globos` : `${escenaDecoracion.length} globos en total`}</p>
                    <ul className="mt-1 text-xs text-texto">
                      {materialesDecoracion.map((m) => {
                        const ref = referenciaPorCodigo(m.codigo);
                        return <li key={`${m.formatoId}|${m.codigo}`}>{m.cantidad} × {m.formatoId} {ref?.nombreCompleto ?? m.codigo} <span className="font-mono text-texto-suave">{m.codigo}</span></li>;
                      })}
                    </ul>
                  </>
                ) : modo === "arco" ? (
                  <>
                    <p className="font-semibold text-texto">Arco {FORMAS_ARCO.find((f) => f.id === forma)?.nombre.toLowerCase()} {datosPatron.nombre.toLowerCase()} de {formato.id} a {formatoCm(inflado)}</p>
                    <p className="font-mono text-xs text-texto-suave">{(anchoArcoCm / 100).toLocaleString("es-CO", { maximumFractionDigits: 2 })} × {(altoArcoCm / 100).toLocaleString("es-CO", { maximumFractionDigits: 2 })} m · {(arco.longitudCm / 100).toLocaleString("es-CO", { maximumFractionDigits: 1 })} m de recorrido · {arco.niveles} cuartetos · {arco.globos.length} globos</p>
                    <ul className="mt-1 text-xs text-texto">
                      {arco.materiales.map((m) => {
                        const ref = referenciaPorCodigo(m.codigo);
                        return <li key={m.codigo}>{m.cantidad} × {formato.id} {ref?.nombreCompleto ?? m.codigo} <span className="font-mono text-texto-suave">{m.codigo}</span></li>;
                      })}
                    </ul>
                  </>
                ) : modo === "columna" ? (
                  <>
                    <p className="font-semibold text-texto">Columna {datosPatron.nombre.toLowerCase()} de {formato.id} a {formatoCm(inflado)}</p>
                    <p className="font-mono text-xs text-texto-suave">{(columna.alturaCm / 100).toLocaleString("es-CO", { maximumFractionDigits: 2 })} m · {columna.niveles} cuartetos · {columna.globos.length} globos</p>
                    <ul className="mt-1 text-xs text-texto">
                      {columna.materiales.map((m) => {
                        const ref = referenciaPorCodigo(m.codigo);
                        return <li key={m.codigo}>{m.cantidad} × {formato.id} {ref?.nombreCompleto ?? m.codigo} <span className="font-mono text-texto-suave">{m.codigo}</span></li>;
                      })}
                    </ul>
                  </>
                ) : modo === "modulo" ? (
                  <>
                    <p className="font-semibold text-texto">{modulo.nombre} de {formato.id} a {formatoCm(inflado)}</p>
                    <p className="font-mono text-xs text-texto-suave">{modulo.globos} globos · {formatoCm(armado.anchoCm)} de ancho</p>
                    <ul className="mt-1 text-xs text-texto">
                      {materiales.map((m) => {
                        const ref = referenciaPorCodigo(m.codigo);
                        return <li key={m.codigo}>{m.cantidad} × {formato.id} {ref?.nombreCompleto ?? m.codigo} <span className="font-mono text-texto-suave">{m.codigo}</span></li>;
                      })}
                    </ul>
                  </>
                ) : (
                  <>
                    <p className="font-semibold text-texto">{vista === "todos" ? "Redondos de 5\" a 36\"" : formato.nombre} · {color.nombreCompleto} <span className="font-mono text-xs text-texto-suave">{color.codigo}</span></p>
                    <p className="font-mono text-xs text-texto-suave">
                      {vista === "todos"
                        ? "Inflado de decoración de cada tamaño"
                        : formato.largoCm
                          ? `${formatoCm(inflado)} de grosor × ${formatoCm(formato.largoCm)} de largo`
                          : `${formatoCm(inflado)} de diámetro`}
                      {" · "}{color.acabado}
                    </p>
                  </>
                )}
              </div>
            )}
          </div>
          <p className="text-xs text-texto-suave">Arrastra para girar · rueda o pellizca para acercar · medidas nominales del catálogo Sempertex; el color es el del globo inflado.</p>
        </section>
      </div>
    </main>
  );
}
