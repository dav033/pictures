"use client";

import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import { MousePointer2, MoveVertical, RotateCw, Scan } from "lucide-react";
import type { Caja } from "@/lib/globos3d/escena";
import type { EscenaGlobos, VistaFija } from "./escena-globos";
import { FLOTANTE, HERRAMIENTA, HERRAMIENTA_ON, HERRAMIENTA_VISTA, HERRAMIENTA_VISTA_ON } from "./ui-taller";

/** Qué hace arrastrar la pieza elegida en el visor. */
export type Herramienta = "mover" | "girar" | "altura";

const VISTAS_ESCENA: ReadonlyArray<{ id: VistaFija; nombre: string; etiqueta: string }> = [
  { id: "frente", nombre: "Frente", etiqueta: "Vista de frente" }, { id: "arriba", nombre: "Arriba", etiqueta: "Vista de arriba" }, { id: "3d", nombre: "3D", etiqueta: "Vista 3D" },
];
const VISTAS_SOLITARIO: ReadonlyArray<{ id: VistaFija; nombre: string; etiqueta: string }> = [
  { id: "frente", nombre: "Frente", etiqueta: "Vista de frente" }, { id: "lado", nombre: "Lado", etiqueta: "Vista de lado" }, { id: "3d", nombre: "3D", etiqueta: "Vista 3D" },
];

/** Barra flotante arriba del visor: elegir y mover, girar, subir o bajar; vistas fijas; encuadrar todo. */
export function BarraHerramientas({ solitario, herramienta, onHerramienta, vista, onVista, onEncuadrar }: {
  solitario: boolean; herramienta: Herramienta; onHerramienta: (h: Herramienta) => void; vista: VistaFija | null; onVista: (v: VistaFija) => void; onEncuadrar: () => void;
}) {
  const herramientas: ReadonlyArray<{ id: Herramienta; etiqueta: string; icono: ReactNode }> = [
    { id: "mover", etiqueta: "Elegir y mover (arrastra la pieza)", icono: <MousePointer2 className="size-[18px]" aria-hidden /> },
    { id: "girar", etiqueta: "Girar pieza (arrastra de lado; Q/E con el teclado)", icono: <RotateCw className="size-[18px]" aria-hidden /> },
    { id: "altura", etiqueta: "Subir o bajar (arrastra hacia arriba o abajo; RePág/AvPág)", icono: <MoveVertical className="size-[18px]" aria-hidden /> },
  ];
  const vistas = solitario ? VISTAS_SOLITARIO : VISTAS_ESCENA;
  return (
    <div role="toolbar" aria-label="Herramientas del visor" className={`pointer-events-auto flex items-center gap-0.5 rounded-xl p-1 ${FLOTANTE}`}>
      {!solitario && <>
        {herramientas.map((h) => (
          <button key={h.id} type="button" onClick={() => onHerramienta(h.id)} aria-pressed={herramienta === h.id} aria-label={h.etiqueta} title={h.etiqueta}
            className={`${HERRAMIENTA} ${herramienta === h.id ? HERRAMIENTA_ON : ""}`}>{h.icono}</button>
        ))}
        <span aria-hidden className="mx-1 h-5 w-px bg-taller-borde" />
      </>}
      {vistas.map((v) => (
        <button key={v.id} type="button" onClick={() => onVista(v.id)} aria-pressed={vista === v.id} aria-label={v.etiqueta} title={v.etiqueta}
          className={`${HERRAMIENTA_VISTA} ${vista === v.id ? HERRAMIENTA_VISTA_ON : ""}`}>{v.nombre}</button>
      ))}
      <span aria-hidden className="mx-1 h-5 w-px bg-taller-borde" />
      <button type="button" onClick={onEncuadrar} aria-label="Encuadrar todo" title="Encuadrar todo" className={HERRAMIENTA}><Scan className="size-[18px]" aria-hidden /></button>
    </div>
  );
}

/** Las esquinas de una caja en la pantalla, relativas al contenedor del visor (las que quedan delante de la cámara). */
function enPantalla(visor: EscenaGlobos, caja: Caja, contenedor: HTMLElement) {
  const r = contenedor.getBoundingClientRect();
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const x of [caja.min.x, caja.max.x]) for (const y of [caja.min.y, caja.max.y]) for (const z of [caja.min.z, caja.max.z]) {
    const p = visor.aPantalla({ x, y, z });
    if (!p) continue;
    minX = Math.min(minX, p.x - r.left); minY = Math.min(minY, p.y - r.top); maxX = Math.max(maxX, p.x - r.left); maxY = Math.max(maxY, p.y - r.top);
  }
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY, ancho: r.width, alto: r.height } : null;
}

/**
 * La etiqueta de la pieza elegida («Columna izquierda · 1,8 m»), pegada encima de su caja. Se recoloca cada vez que el
 * visor dibuja (girar la cámara, arrastrar), escribiendo en el DOM: no pasa por React ni rehace nada del visor.
 */
export function EtiquetaElegida({ visor, caja, texto, contenedor }: { visor: EscenaGlobos | null; caja: Caja | null; texto: string; contenedor: RefObject<HTMLElement | null> }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!visor || !caja) return;
    const poner = () => {
      const el = ref.current, cont = contenedor.current;
      if (!el || !cont) return;
      const p = enPantalla(visor, caja, cont);
      if (!p || p.maxY < 0 || p.minY > p.alto) { el.style.visibility = "hidden"; return; }
      const left = Math.max(8, Math.min(p.ancho - el.offsetWidth - 8, p.minX));
      const top = Math.max(64, p.minY - 32);
      el.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
      el.style.visibility = "visible";
    };
    poner();
    return visor.alDibujar(poner);
  }, [visor, caja, contenedor, texto]);
  if (!caja) return null;
  return (
    <div ref={ref} aria-hidden style={{ visibility: "hidden" }}
      className="pointer-events-none absolute left-0 top-0 z-[5] flex h-6 max-w-[60%] items-center truncate whitespace-nowrap rounded-md bg-taller-primario px-2 text-xs font-medium text-taller-sobre-primario shadow-[0_2px_8px_var(--sombra)]">
      {texto}
    </div>
  );
}

const nf = (cm: number) => `${(cm / 100).toLocaleString("es-CO", { maximumFractionDigits: 2 })} m`;

/**
 * Regla de alturas junto a la pieza del editor solitario (0 · 0,5 m · 1 m … y su alto), pegada a su costado derecho:
 * se recoloca en cada cuadro como la etiqueta.
 */
export function ReglaAlturas({ visor, caja, contenedor }: { visor: EscenaGlobos | null; caja: Caja | null; contenedor: RefObject<HTMLElement | null> }) {
  const linea = useRef<HTMLDivElement>(null);
  const marcas = useRef<Array<HTMLSpanElement | null>>([]);
  const alto = caja ? Math.max(0, caja.max.y) : 0;
  const alturas = caja ? [...Array.from({ length: Math.floor(alto / 50) + 1 }, (_, i) => i * 50).filter((h) => alto - h > 18), alto] : [];
  const clave = alturas.join("|");
  useEffect(() => {
    if (!visor || !caja) return;
    const hs = clave.split("|").map(Number);
    const poner = () => {
      const cont = contenedor.current;
      if (!cont) return;
      const r = cont.getBoundingClientRect();
      const x = caja.max.x + 25, z = (caja.min.z + caja.max.z) / 2;
      const puntos = hs.map((y) => visor.aPantalla({ x, y, z }));
      puntos.forEach((p, i) => {
        const el = marcas.current[i];
        if (!el) return;
        if (!p) { el.style.visibility = "hidden"; return; }
        el.style.transform = `translate(${Math.round(p.x - r.left)}px, ${Math.round(p.y - r.top - 7)}px)`;
        el.style.visibility = "visible";
      });
      const abajo = puntos[0], arriba = puntos[puntos.length - 1];
      if (linea.current) {
        if (abajo && arriba) {
          linea.current.style.transform = `translate(${Math.round(abajo.x - r.left - 2)}px, ${Math.round(arriba.y - r.top)}px)`;
          linea.current.style.height = `${Math.max(0, Math.round(abajo.y - arriba.y))}px`;
          linea.current.style.visibility = "visible";
        } else linea.current.style.visibility = "hidden";
      }
    };
    poner();
    return visor.alDibujar(poner);
  }, [visor, caja, contenedor, clave]);
  if (!caja || alto < 20) return null;
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 z-[4] overflow-hidden">
      <div ref={linea} style={{ visibility: "hidden" }} className="absolute left-0 top-0 w-px border-l border-taller-medio/60" />
      {alturas.map((h, i) => (
        <span key={h} ref={(el) => { marcas.current[i] = el; }} style={{ visibility: "hidden" }}
          className="absolute left-0 top-0 whitespace-nowrap pl-1.5 font-mono text-[11px] leading-none text-taller-suave before:mr-1 before:inline-block before:h-px before:w-1.5 before:bg-taller-medio before:align-middle before:content-['']">
          {h === 0 ? "0" : nf(h)}
        </span>
      ))}
    </div>
  );
}
