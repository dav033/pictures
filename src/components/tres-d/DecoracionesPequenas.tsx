"use client";

import { useContext, useMemo, useRef, useState } from "react";
import { Flower2 } from "lucide-react";
import type { Escena, EscenaArmada } from "@/lib/globos3d/escena";
import { agregarDecoracion, decoracionesPorGrupo, miniaturaDecoracion, repartoSugerido, type DecoracionPequena, type DestinoDecoracion, type Miniatura } from "@/lib/globos3d/decoraciones-escena";
import { ACTIVO, BOTON, Deslizador, INACTIVO } from "./PanelFlor";
import { ArrastreDecoracionContexto } from "./arrastre-decoracion";
import { UtileriaFiesta } from "./UtileriaFiesta";

/** Las predefinidas por grupo, con su miniatura: no cambian, se calculan una vez. */
const GRUPOS = decoracionesPorGrupo().map((g) => ({ ...g, decoraciones: g.decoraciones.map((d) => ({ ...d, miniatura: miniaturaDecoracion(d.decoracion) })) }));

/** Corazón de lado 2 con la punta abajo (y = 1) y los lóbulos arriba (y = −1). */
const CORAZON = "M0,1 C-0.6,0.55 -1.05,0.1 -1,-0.35 C-0.95,-0.85 -0.35,-1.05 0,-0.55 C0.35,-1.05 0.95,-0.85 1,-0.35 C1.05,0.1 0.6,0.55 0,1 Z";

/** Dibujo de frente de una decoración: globos como elipses (o corazones) y tubitos como trazos gruesos. */
export function MiniaturaDecoracion({ miniatura, nombre, className }: { miniatura: Miniatura; nombre: string; className?: string }) {
  const { caja, formas } = miniatura;
  return (
    <svg viewBox={`${caja.x} ${caja.y} ${caja.ancho} ${caja.alto}`} role="img" aria-label={`Dibujo de ${nombre}`} className={className}>
      {formas.map((f, i) => {
        if (f.tipo === "tubito") {
          const puntos = f.puntos.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
          const Linea = f.cerrado ? "polygon" : "polyline";
          // Papel (fantasma, telaraña): sin la sombra del látex; el relleno pinta la figura.
          if (f.papel) return <Linea key={i} points={puntos} fill={f.papel.relleno ? f.hex : "none"} stroke={f.hex} strokeWidth={f.grosor} strokeLinecap="round" strokeLinejoin="round" />;
          return (
            <g key={i} fill="none" strokeLinecap="round" strokeLinejoin="round">
              <Linea points={puntos} stroke="rgba(0,0,0,.22)" strokeWidth={f.grosor + 0.8} />
              <Linea points={puntos} stroke={f.hex} strokeWidth={f.grosor} />
            </g>
          );
        }
        const brillo = { cx: -f.ry * 0.3, cy: -f.ry * 0.35, r: f.ry * 0.28 };
        return (
          <g key={i}>
            <g transform={`translate(${f.cx.toFixed(2)} ${f.cy.toFixed(2)})`}>
              {f.corazon
                ? <path d={CORAZON} transform={`rotate(${(f.giroGrados + 90).toFixed(1)}) scale(${f.ry.toFixed(2)} ${f.rx.toFixed(2)})`} fill={f.hex} stroke="rgba(0,0,0,.22)" strokeWidth={0.6 / Math.max(f.rx, f.ry)} />
                : <ellipse rx={f.rx} ry={f.ry} transform={`rotate(${f.giroGrados.toFixed(1)})`} fill={f.hex} stroke="rgba(0,0,0,.22)" strokeWidth={0.6} />}
              {!f.estampado && <circle cx={brillo.cx} cy={brillo.cy} r={brillo.r} fill="#fff" opacity={0.35} />}
            </g>
            {/* Lo impreso (iris, cara de calabaza), ya en coordenadas del dibujo. */}
            {f.estampado?.map((c, k) => <polygon key={k} points={c.puntos.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" ")} fill={c.hex} />)}
          </g>
        );
      })}
    </svg>
  );
}

type Props = {
  escena: Escena;
  onEscena: (e: Escena) => void;
  armada: EscenaArmada;
  /** La pieza elegida en la lista: si tiene anclas, se ofrece colgar la decoración de ella. */
  seleccion?: string | null;
  onSeleccion?: (id: string | null) => void;
};

const copiasEn = (n: number) => `${n} ${n === 1 ? "copia" : "copias"}`;

/**
 * Sección «Decoraciones pequeñas» de la pestaña Escena: flores, moños, estrellas… ya armados, por grupo, con su
 * dibujo y cuántos globos llevan. Con el ratón se arrastran al visor y se sueltan sobre una estructura (columna,
 * arco, aro, guirnalda, pared de globos: la estructura es un lienzo) o en una pared o el techo. Al tocar una (o con
 * el dedo) se abre debajo qué hacer con ella: colgarla de la pieza elegida (si tiene anclas), repetida cada N
 * anclas, o ponerla suelta en la pared del fondo, el piso o el techo.
 */
export function DecoracionesPequenas({ escena, onEscena, armada, seleccion = null, onSeleccion }: Props) {
  const [elegida, setElegida] = useState<string | null>(null);
  const [cadaPedido, setCadaPedido] = useState<{ nodo: string; cada: number } | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const arrastrar = useContext(ArrastreDecoracionContexto);
  /** Dónde se apretó la última tarjeta: un clic lejos de ahí fue un arrastre (no abre las opciones). */
  const apretada = useRef<{ x: number; y: number } | null>(null);

  const nodo = escena.nodos.find((n) => n.id === seleccion) ?? null;
  const anclas = useMemo(() => (nodo ? armada.porNodo.find((x) => x.id === nodo.id)?.anclas ?? [] : []), [armada, nodo]);
  const puedeColgar = nodo !== null && anclas.length > 0;
  const cada = cadaPedido && nodo && cadaPedido.nodo === nodo.id ? cadaPedido.cada : undefined;
  const reparto = useMemo(() => repartoSugerido(anclas, cada), [anclas, cada]);
  const total = GRUPOS.reduce((s, g) => s + g.decoraciones.length, 0);

  const tocar = (id: string) => { setElegida(elegida === id ? null : id); setAviso(null); };

  const poner = (d: DecoracionPequena, destino: DestinoDecoracion) => {
    const { escena: nueva, id } = agregarDecoracion(escena, d.decoracion, destino, { nombre: d.nombre, idBase: d.id.replace(/_/g, "-") });
    onEscena(nueva);
    if (destino.en === "ancla") {
      setAviso(`Listo: «${d.nombre}» quedó colgada en «${nodo?.nombre ?? "la pieza"}» (${copiasEn(reparto.copias)}, ${reparto.copias * d.globos} globos). Ya está en la lista de piezas.`);
    } else {
      const donde = destino.en === "pared" ? "en la pared del fondo" : destino.en === "piso" ? "en el piso" : "colgada del techo";
      setAviso(`Listo: «${d.nombre}» quedó ${donde} y la dejé elegida para que la muevas con «Dónde va».`);
      onSeleccion?.(id);
    }
  };

  return (
    <section className="flex flex-col gap-2 rounded-2xl bg-superficie p-3 ring-1 ring-borde" aria-label="Decoraciones pequeñas">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-texto"><Flower2 className="size-4 text-acento" aria-hidden /> Decoraciones pequeñas <span className="font-normal text-texto-suave">· {total} listas</span></h2>
      <p className="text-xs text-texto-suave">
        Flores, moños y estrellas ya armados. {arrastrar ? <><b className="text-texto">Arrástrala al visor</b> y suéltala sobre una columna, un arco, un aro, una guirnalda, una pared de globos o una pared (se marcan en verde), o tócala y elige dónde va.</> : "Toca una y elige dónde va."}{" "}
        {puedeColgar
          ? <>Puedes colgarla de <b className="text-texto">«{nodo.nombre}»</b> (la pieza elegida) o ponerla suelta en la sala.</>
          : <>Para colgarla de una columna, un arco o una pared de globos, primero toca esa pieza en la lista de arriba.</>}
      </p>
      {GRUPOS.map((g) => {
        const abierta = g.decoraciones.find((d) => d.id === elegida);
        return (
          <div key={g.id} className="flex flex-col gap-1">
            <h3 className="text-xs font-semibold text-texto">{g.nombre}</h3>
            <div className="grid grid-cols-3 gap-1">
              {g.decoraciones.map((d) => {
                const activa = d.id === elegida;
                return (
                  <button key={d.id} type="button" aria-pressed={activa} aria-expanded={activa} title={arrastrar ? `${d.descripcion} — arrástrala al visor` : d.descripcion}
                    onPointerDown={(e) => {
                      apretada.current = { x: e.clientX, y: e.clientY };
                      // Con el dedo se toca y se elige (arrastrar movería la lista); con ratón o lápiz, se arrastra al visor.
                      if (!arrastrar || e.button !== 0 || e.pointerType === "touch") return;
                      e.preventDefault();
                      arrastrar({ decoracion: d.decoracion, nombre: d.nombre, idBase: d.id.replace(/_/g, "-") }, { x: e.clientX, y: e.clientY });
                    }}
                    onClick={(e) => {
                      const desde = apretada.current;
                      apretada.current = null;
                      if (desde && e.detail > 0 && Math.hypot(e.clientX - desde.x, e.clientY - desde.y) > 6) return;
                      tocar(d.id);
                    }}
                    className={`flex min-h-24 select-none flex-col items-center gap-0.5 rounded-xl p-1.5 text-center ring-1 transition-colors ${arrastrar ? "cursor-grab active:cursor-grabbing" : ""} ${activa ? "bg-superficie-suave ring-2 ring-acento" : "bg-superficie ring-borde hover:bg-superficie-suave"}`}>
                    <MiniaturaDecoracion miniatura={d.miniatura} nombre={d.nombre} className="size-14" />
                    <span className="text-[0.7rem] leading-tight text-texto">{d.nombre}</span>
                    <span className="text-[0.65rem] text-texto-suave">{d.noEsGlobo ? "no es globo" : `${d.globos} globos`}</span>
                  </button>
                );
              })}
            </div>
            {abierta && (
              <div className="flex flex-col gap-2 rounded-xl bg-superficie-suave p-2 ring-1 ring-acento/60" aria-label={`Dónde poner ${abierta.nombre}`}>
                <p className="text-xs text-texto"><b>{abierta.nombre}</b> · {abierta.noEsGlobo ? "escenografía de papel (no es globo, no se cotiza)" : `${abierta.globos} globos`}. <span className="text-texto-suave">{abierta.descripcion}</span></p>
                {puedeColgar && (
                  <>
                    <p className="text-[0.7rem] text-texto-suave">Se repite en las anclas de «{nodo.nombre}» (los puntos morados del visor), de las que miran al frente.</p>
                    <Deslizador id="deco-cada" etiqueta="Cada cuántas anclas" valor={reparto.cada} min={0} max={Math.min(anclas.length, 40)} paso={1}
                      texto={reparto.cada === 0 ? "solo una" : `1 de cada ${reparto.cada} · ${copiasEn(reparto.copias)}`}
                      onCambio={(v) => setCadaPedido({ nodo: nodo.id, cada: v })} />
                    <button type="button" onClick={() => poner(abierta, { en: "ancla", padreId: nodo.id, cada: reparto.cada, ancla: reparto.ancla })} className={`${BOTON} ${ACTIVO}`}>
                      Colgar en «{nodo.nombre}» · {copiasEn(reparto.copias)} ({reparto.copias * abierta.globos} globos)
                    </button>
                  </>
                )}
                <p className="text-[0.7rem] text-texto-suave">{puedeColgar ? "O ponla suelta (una sola):" : "Ponla en la sala (una sola):"}</p>
                <div className="grid grid-cols-3 gap-1">
                  <button type="button" onClick={() => poner(abierta, { en: "pared" })} className={`${BOTON} ${INACTIVO} text-xs`}>En la pared del fondo</button>
                  <button type="button" onClick={() => poner(abierta, { en: "piso" })} className={`${BOTON} ${INACTIVO} text-xs`}>En el piso</button>
                  <button type="button" onClick={() => poner(abierta, { en: "techo" })} className={`${BOTON} ${INACTIVO} text-xs`}>Del techo</button>
                </div>
                {aviso && <p role="status" className="rounded-lg bg-superficie p-2 text-xs text-texto ring-1 ring-borde">{aviso}</p>}
              </div>
            )}
          </div>
        );
      })}
      {/* Banderines, platos, vasos… (productos Sempertex de fiesta, no globos). */}
      <UtileriaFiesta escena={escena} onEscena={onEscena} armada={armada} seleccion={seleccion} onSeleccion={onSeleccion} />
    </section>
  );
}
