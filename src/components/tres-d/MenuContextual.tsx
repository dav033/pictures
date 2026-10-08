"use client";

import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as EventoTeclado, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Copy, Flower2, Palette, Pencil, Trash2, Wrench } from "lucide-react";

/** Lo que se puede pedir desde el menú de una pieza. */
export type AccionMenu = "editar" | "duplicar" | "colgar" | "colores" | "eliminar-con" | "eliminar-sin" | "editar-sostiene";

type Props = {
  /** Dónde se abre (coordenadas de cliente: junto al puntero, al dedo o a la pieza). */
  x: number;
  y: number;
  nombre: string;
  /** Cuántas decoraciones lleva la pieza (`null` mientras se calcula): con alguna, «Eliminar» pregunta si con ellas. */
  decoraciones: number | null;
  /** Si es una decoración colgada: la estructura que la sostiene («Editar la estructura que la sostiene»). */
  sostiene: { nombre: string } | null;
  /** Acciones que no aplican aquí (en el editor solitario, la raíz no se quita ni se vuelve a abrir). */
  ocultar?: readonly AccionMenu[];
  /** Abierto con el dedo: va por encima del dedo y los primeros ms no acepta toques (el que lo abrió no pulsa nada). */
  tactil?: boolean;
  onAccion: (accion: AccionMenu) => void;
  onCerrar: () => void;
};

const BLOQUEO_TACTIL_MS = 350;
const ITEM = "flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-left text-sm text-texto outline-none hover:bg-superficie-suave focus-visible:bg-superficie-suave focus-visible:ring-2 focus-visible:ring-acento lg:min-h-9";

type Opcion = { accion: AccionMenu | "eliminar" | "volver"; texto: string; icono?: ReactNode; peligro?: boolean };

/**
 * Menú contextual de una pieza de la escena (clic derecho, mantener presionado, tecla Menú/Shift+F10 o el botón «⋯»):
 * Editar sola, Duplicar, Colgar decoración, Cambiar colores, Eliminar (si lleva decoraciones pregunta, dentro del
 * menú, si con ellas o sin ellas) y, en una decoración colgada, Editar la estructura que la sostiene.
 * Accesible: `role="menu"`, foco en la primera opción, flechas/Inicio/Fin para moverse, Esc o Tab lo cierran y el foco
 * vuelve a donde estaba. Va en un portal (el visor recorta lo que se sale).
 */
export function MenuContextual({ x, y, nombre, decoraciones, sostiene, ocultar = [], tactil = false, onAccion, onCerrar }: Props) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [paso, setPaso] = useState<"acciones" | "confirmar">("acciones");
  const [pos, setPos] = useState({ left: x, top: y });
  // Con el dedo, los primeros ms no se aceptan toques.
  const [aceptaToques, setAceptaToques] = useState(!tactil);
  useEffect(() => {
    if (!tactil) return;
    const t = setTimeout(() => setAceptaToques(true), BLOQUEO_TACTIL_MS);
    return () => clearTimeout(t);
  }, [tactil]);
  const [focoPrevio] = useState(() => (typeof document !== "undefined" && document.activeElement instanceof HTMLElement ? document.activeElement : null));

  const opciones: Opcion[] = paso === "confirmar"
    ? [
      { accion: "eliminar-con", texto: `Sí, con sus ${decoraciones ?? ""} decoraciones`, icono: <Trash2 className="size-4" aria-hidden />, peligro: true },
      { accion: "eliminar-sin", texto: "No, solo la estructura (ellas se quedan)", icono: <Trash2 className="size-4" aria-hidden /> },
      { accion: "volver", texto: "Cancelar" },
    ]
    : ([
      { accion: "editar", texto: "Editar sola", icono: <Pencil className="size-4" aria-hidden /> },
      ...(sostiene ? [{ accion: "editar-sostiene", texto: `Editar la estructura que la sostiene (${sostiene.nombre})`, icono: <Wrench className="size-4" aria-hidden /> } as const] : []),
      { accion: "duplicar", texto: decoraciones ? "Duplicar (con sus decoraciones)" : "Duplicar", icono: <Copy className="size-4" aria-hidden /> },
      { accion: "colgar", texto: "Colgar decoración", icono: <Flower2 className="size-4" aria-hidden /> },
      { accion: "colores", texto: "Cambiar colores", icono: <Palette className="size-4" aria-hidden /> },
      { accion: "eliminar", texto: decoraciones ? `Eliminar… (lleva ${decoraciones} decoraciones)` : "Eliminar", icono: <Trash2 className="size-4" aria-hidden />, peligro: true },
    ] satisfies Opcion[]).filter((o) => !(ocultar as readonly string[]).includes(o.accion) && !(o.accion === "eliminar" && ocultar.includes("eliminar-sin")));

  // Dentro de la pantalla (con el dedo, por encima de él para que no lo tape ni lo pulse al soltar).
  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const { width, height } = menu.getBoundingClientRect();
    const margen = 8;
    const left = Math.max(margen, Math.min(window.innerWidth - width - margen, tactil ? x - width / 2 : x + 2));
    const arriba = tactil ? y - height - 24 : y + 2;
    const top = Math.max(margen, Math.min(window.innerHeight - height - margen, arriba < margen && tactil ? y + 24 : arriba));
    setPos((p) => (p.left === left && p.top === top ? p : { left, top }));
  }, [x, y, tactil, paso, decoraciones]);

  // El foco en la primera opción (al abrir y al pasar a la pregunta).
  useEffect(() => { menuRef.current?.querySelector<HTMLElement>("[role='menuitem']")?.focus(); }, [paso]);

  // Clic fuera, otra ventana o cambio de tamaño lo cierran; al cerrarse, el foco vuelve a donde estaba.
  useEffect(() => {
    const fuera = (e: PointerEvent) => { if (!menuRef.current?.contains(e.target as Node)) onCerrar(); };
    const cerrar = () => onCerrar();
    window.addEventListener("pointerdown", fuera, true);
    window.addEventListener("resize", cerrar);
    window.addEventListener("blur", cerrar);
    return () => {
      window.removeEventListener("pointerdown", fuera, true);
      window.removeEventListener("resize", cerrar);
      window.removeEventListener("blur", cerrar);
      if (focoPrevio?.isConnected) focoPrevio.focus({ preventScroll: true });
    };
  }, [onCerrar, focoPrevio]);

  const elegir = (o: Opcion) => {
    if (!aceptaToques) return;
    if (o.accion === "volver") { setPaso("acciones"); return; }
    if (o.accion === "eliminar") {
      if (decoraciones) { setPaso("confirmar"); return; }
      onAccion("eliminar-sin");
      return;
    }
    onAccion(o.accion);
  };

  const alTeclado = (e: EventoTeclado<HTMLDivElement>) => {
    const items = [...(menuRef.current?.querySelectorAll<HTMLElement>("[role='menuitem']") ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    const ir = (k: number) => items[(k + items.length) % items.length]?.focus();
    if (e.key === "Escape") { if (paso === "confirmar") setPaso("acciones"); else onCerrar(); }
    else if (e.key === "Tab") onCerrar();
    else if (e.key === "ArrowDown") ir(i + 1);
    else if (e.key === "ArrowUp") ir(i - 1);
    else if (e.key === "Home") ir(0);
    else if (e.key === "End") ir(items.length - 1);
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  if (typeof document === "undefined") return null;
  return createPortal(
    <div ref={menuRef} role="menu" aria-label={paso === "confirmar" ? `¿Quitar «${nombre}» con sus decoraciones?` : `Acciones de «${nombre}»`} onKeyDown={alTeclado}
      onContextMenu={(e) => e.preventDefault()} style={{ left: pos.left, top: pos.top }}
      className="fixed z-[70] flex w-max min-w-52 max-w-[min(22rem,calc(100vw-16px))] flex-col gap-0.5 rounded-xl bg-superficie p-1 shadow-lg ring-1 ring-borde">
      <p className="truncate px-3 pb-1 pt-1.5 text-xs font-semibold text-texto-suave" aria-hidden>
        {paso === "confirmar" ? `«${nombre}» lleva ${decoraciones} decoraciones. ¿Quitarla con ellas?` : nombre}
      </p>
      {opciones.map((o) => (
        <button key={o.accion} type="button" role="menuitem" tabIndex={-1} onClick={() => elegir(o)} className={`${ITEM} ${o.peligro ? "text-red-700 dark:text-red-300" : ""}`}>
          {o.icono}{o.texto}
        </button>
      ))}
    </div>,
    document.body,
  );
}
