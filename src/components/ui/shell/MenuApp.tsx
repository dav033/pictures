"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Check, MoreHorizontal } from "lucide-react";

export type ItemMenu =
  | { tipo: "enlace"; id: string; etiqueta: string; href: string; icono?: ReactNode }
  | { tipo: "accion"; id: string; etiqueta: string; onSeleccionar: () => void; deshabilitado?: boolean; icono?: ReactNode }
  /** One choice of a group (e.g. the theme): `role="menuitemradio"` with `aria-checked`. */
  | { tipo: "opcion"; id: string; etiqueta: string; marcado: boolean; onSeleccionar: () => void; icono?: ReactNode }
  /** Visible, non-focusable label of the group that follows. */
  | { tipo: "titulo"; id: string; etiqueta: string }
  | { tipo: "separador"; id: string };

type Props = {
  items: readonly ItemMenu[];
  etiqueta?: string;
  /** Ícono del botón (por defecto "⋯"). */
  icono?: ReactNode;
  claseBoton?: string;
  /** El compositor inferior abre hacia arriba; la cabecera, hacia abajo. */
  lado?: "abajo" | "arriba";
  alineacion?: "derecha" | "izquierda";
  testId?: string;
};

function itemsEnfocables(contenedor: HTMLElement | null): HTMLElement[] {
  return Array.from(contenedor?.querySelectorAll<HTMLElement>("[role='menuitem']:not([aria-disabled='true']), [role='menuitemradio']") ?? []);
}

/**
 * Menú "⋯" de la cabecera. Patrón menu button de WAI-ARIA: Enter/Espacio o
 * flecha abajo abren y enfocan el primer ítem; flechas, Inicio y Fin
 * recorren; Escape cierra y devuelve el foco al botón; clic fuera cierra.
 */
export function MenuApp({ items, etiqueta = "Más opciones", icono, claseBoton = "ui-icon-button", lado = "abajo", alineacion = "derecha", testId = "menu-app" }: Props) {
  const [abierto, setAbierto] = useState(false);
  const contenedorRef = useRef<HTMLDivElement>(null);
  const botonRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!abierto) return;
    const alClicFuera = (evento: MouseEvent) => {
      if (!contenedorRef.current?.contains(evento.target as Node)) setAbierto(false);
    };
    document.addEventListener("mousedown", alClicFuera);
    const primero = window.requestAnimationFrame(() => itemsEnfocables(contenedorRef.current)[0]?.focus());
    return () => {
      document.removeEventListener("mousedown", alClicFuera);
      window.cancelAnimationFrame(primero);
    };
  }, [abierto]);

  function cerrar(devolverFoco: boolean) {
    setAbierto(false);
    if (devolverFoco) botonRef.current?.focus();
  }

  function alTeclear(evento: KeyboardEvent<HTMLDivElement>) {
    if (!abierto) {
      if (evento.key === "ArrowDown" && evento.target === botonRef.current) {
        evento.preventDefault();
        setAbierto(true);
      }
      return;
    }
    const lista = itemsEnfocables(contenedorRef.current);
    const actual = lista.indexOf(document.activeElement as HTMLElement);
    const mover = (indice: number) => {
      evento.preventDefault();
      lista[(indice + lista.length) % lista.length]?.focus();
    };
    if (evento.key === "Escape") {
      evento.preventDefault();
      cerrar(true);
    } else if (evento.key === "ArrowDown") mover(actual + 1);
    else if (evento.key === "ArrowUp") mover(actual - 1);
    else if (evento.key === "Home") mover(0);
    else if (evento.key === "End") mover(lista.length - 1);
    else if (evento.key === "Tab") setAbierto(false);
  }

  return (
    <div ref={contenedorRef} className="relative" onKeyDown={alTeclear}>
      <button
        ref={botonRef}
        type="button"
        aria-label={etiqueta}
        aria-haspopup="menu"
        aria-expanded={abierto}
        aria-controls={abierto ? menuId : undefined}
        data-testid={testId}
        onClick={() => setAbierto((valor) => !valor)}
        className={claseBoton}
      >
        {icono ?? <MoreHorizontal className="size-[1.125rem]" aria-hidden="true" />}
      </button>
      {abierto && (
        <div
          id={menuId}
          role="menu"
          aria-label={etiqueta}
          className="app-menu"
          style={{
            ...(lado === "arriba" ? { top: "auto", bottom: "calc(100% + 0.375rem)" } : {}),
            ...(alineacion === "izquierda" ? { right: "auto", left: 0 } : {}),
          }}
        >
          {items.map((item) => {
            if (item.tipo === "separador") return <div key={item.id} role="separator" className="app-menu-separador" />;
            if (item.tipo === "titulo") return <div key={item.id} role="presentation" className="app-menu-titulo">{item.etiqueta}</div>;
            if (item.tipo === "opcion") {
              return (
                <button
                  key={item.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={item.marcado}
                  tabIndex={-1}
                  data-testid={`${testId}-${item.id}`}
                  className="app-menu-item"
                  onClick={() => {
                    cerrar(true);
                    item.onSeleccionar();
                  }}
                >
                  {item.icono && <span className="text-texto-suave" aria-hidden="true">{item.icono}</span>}
                  <span className="flex-1">{item.etiqueta}</span>
                  <Check className={`size-4 text-acento ${item.marcado ? "" : "invisible"}`} aria-hidden="true" />
                </button>
              );
            }
            const contenido = (
              <>
                {item.icono && <span className="text-texto-suave" aria-hidden="true">{item.icono}</span>}
                {item.etiqueta}
              </>
            );
            if (item.tipo === "enlace") {
              return (
                <Link key={item.id} href={item.href} role="menuitem" tabIndex={-1} className="app-menu-item" onClick={() => setAbierto(false)}>
                  {contenido}
                </Link>
              );
            }
            return (
              <button
                key={item.id}
                type="button"
                role="menuitem"
                tabIndex={-1}
                disabled={item.deshabilitado}
                aria-disabled={item.deshabilitado || undefined}
                className="app-menu-item"
                onClick={() => {
                  // Focus goes back to the menu button, so a dialog the action opens returns there on close.
                  cerrar(true);
                  item.onSeleccionar();
                }}
              >
                {contenido}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
