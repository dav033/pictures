"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { ChartColumn, FlaskConical, LayoutGrid, ListChecks, Monitor, Moon, Shield, Sun, Trash2 } from "lucide-react";
import { OPCIONES_TEMA } from "@/lib/tema/tema";
import { useTema } from "@/lib/tema/use-tema";
import type { NivelCreatividad } from "@/lib/ia/escena/creatividad";
import type { ModoVista } from "@/lib/estado/modo-vista";
import { ConmutadorVista } from "@/components/guiado/ConmutadorVista";
import { SwitchModoVista } from "@/components/modo/SwitchModoVista";
import { InterruptorTema } from "@/components/ui/interruptor-tema";
import { MenuApp, type ItemMenu } from "./MenuApp";
import { SelectorCreatividad } from "./SelectorCreatividad";

type Props = {
  /** "Cumpleaños · rosa y plata · hasta $ 1.500.000" o null si el brief está vacío. */
  contexto: string | null;
  creatividad?: NivelCreatividad;
  onCreatividad?: (nivel: NivelCreatividad) => void;
  modoVista: ModoVista;
  onModoVista: (modo: ModoVista) => void;
  onLimpiar: () => void;
  limpiarDeshabilitado: boolean;
  /** Cómo se llama esa acción en el menú (la guiada: «Empezar de nuevo», que confirma antes); por defecto «Limpiar chat». */
  etiquetaLimpiar?: string;
  iconoLimpiar?: ReactNode;
  /** Abre la hoja de selección manual; undefined cuando no aplica (hay propuesta en modo usuario). */
  onAbrirSeleccion?: () => void;
  totalSeleccion: number;
  /** Controles técnicos: se muestran en una barra aparte solo en modo dev. */
  barraDev?: ReactNode;
  /** Vista guiada: sin el interruptor «Modo dev» (el cliente no lo necesita). La clásica no lo pasa. */
  ocultarModoDev?: boolean;
};

/** Marca simple de la maqueta: cuadro violeta con un anillo y un punto. */
function MarcaIcono() {
  return (
    <span className="app-marca-icono" aria-hidden="true">
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
        <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeOpacity="0.65" strokeWidth="1.2" />
        <circle cx="8" cy="8" r="1.8" fill="currentColor" />
      </svg>
    </span>
  );
}

/**
 * Cabecera de una sola línea (maquetas Main y EstadoInicial): marca, contexto
 * del evento al centro, creatividad compacta, tema, "Modo dev" y menú.
 */
export function CabeceraApp({ contexto, creatividad, onCreatividad, modoVista, onModoVista, onLimpiar, limpiarDeshabilitado, etiquetaLimpiar = "Limpiar chat", iconoLimpiar, onAbrirSeleccion, totalSeleccion, barraDev, ocultarModoDev = false }: Props) {
  const pathname = usePathname();
  const esDev = modoVista === "dev";
  // Vista guiada (pensada para el móvil): tema y menú con el blanco táctil de 44 px; la clásica conserva su cabecera compacta.
  const tactil = pathname === "/asistente";
  const { preferencia: preferenciaTema, cambiar: cambiarTema } = useTema();
  const ICONO_TEMA = { light: <Sun className="size-4" />, dark: <Moon className="size-4" />, sistema: <Monitor className="size-4" /> } as const;
  const items: ItemMenu[] = [
    { tipo: "enlace", id: "catalogo", etiqueta: "Explorar catálogo", href: "/catalogo", icono: <LayoutGrid className="size-4" /> },
    ...(onAbrirSeleccion
      ? [{ tipo: "accion" as const, id: "seleccion", etiqueta: totalSeleccion > 0 ? `Tu selección (${totalSeleccion})` : "Tu selección", onSeleccionar: onAbrirSeleccion, icono: <ListChecks className="size-4" /> }]
      : []),
    { tipo: "accion", id: "limpiar", etiqueta: etiquetaLimpiar, onSeleccionar: onLimpiar, deshabilitado: limpiarDeshabilitado, icono: iconoLimpiar ?? <Trash2 className="size-4" /> },
    pathname === "/asistente"
      ? { tipo: "enlace", id: "vista-clasica", etiqueta: "Vista clásica", href: "/" }
      : { tipo: "enlace", id: "vista-guiada", etiqueta: "Asistente guiado", href: "/asistente" },
    // D10: the header switch flips light/dark quickly; here the customer can also go back to "Sistema".
    { tipo: "separador", id: "sep-tema" },
    { tipo: "titulo", id: "titulo-tema", etiqueta: "Tema" },
    ...OPCIONES_TEMA.map((opcion): ItemMenu => ({ tipo: "opcion", id: `tema-${opcion.valor}`, etiqueta: opcion.etiqueta, marcado: preferenciaTema === opcion.valor, onSeleccionar: () => cambiarTema(opcion.valor), icono: ICONO_TEMA[opcion.valor] })),
    ...(esDev
      ? ([
          { tipo: "separador", id: "sep-dev" },
          { tipo: "enlace", id: "estadisticas", etiqueta: "Estadísticas", href: "/estadisticas", icono: <ChartColumn className="size-4" /> },
          { tipo: "enlace", id: "laboratorio", etiqueta: "Laboratorio JSON", href: "/laboratorio-referencias", icono: <FlaskConical className="size-4" /> },
          { tipo: "enlace", id: "admin", etiqueta: "Panel de administración", href: "/admin", icono: <Shield className="size-4" /> },
        ] satisfies ItemMenu[])
      : []),
  ];

  return (
    <>
      <header className="app-header">
        <div className="app-marca">
          <MarcaIcono />
          <h1 className="sr-only truncate text-sm font-semibold tracking-[-0.015em] min-[480px]:not-sr-only">Asistente de decoración</h1>
        </div>
        <div className="app-contexto" data-testid="contexto-evento">
          <AnimatePresence mode="wait" initial={false}>
            {contexto && (
              <motion.p key={contexto} className="truncate" title={contexto} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.2 }}>
                {contexto}
              </motion.p>
            )}
          </AnimatePresence>
        </div>
        <div className="app-acciones">
          <ConmutadorVista />
          {creatividad !== undefined && onCreatividad && <SelectorCreatividad valor={creatividad} onCambiar={onCreatividad} />}
          <InterruptorTema className={tactil ? "size-11" : ""} />
          {!ocultarModoDev && <SwitchModoVista modo={modoVista} onCambiar={onModoVista} />}
          <MenuApp items={items} {...(tactil ? { claseBoton: "ui-icon-button size-11" } : {})} />
        </div>
      </header>
      {contexto && <p className="app-contexto-movil truncate">{contexto}</p>}
      {esDev && barraDev && (
        <div className="app-barra-dev" aria-label="Controles de desarrollo" role="group">
          {barraDev}
        </div>
      )}
    </>
  );
}
