"use client";

import type { ReactNode } from "react";
import { ChartColumn, FlaskConical, LayoutGrid, ListChecks, Settings2, Shield, Trash2 } from "lucide-react";
import type { NivelCreatividad } from "@/lib/ia/creatividad";
import type { ModoVista } from "@/lib/estado/modo-vista";
import { SwitchModoVista } from "@/components/modo/SwitchModoVista";
import { InterruptorTema } from "@/components/ui/interruptor-tema";
import { MenuApp, type ItemMenu } from "./MenuApp";
import { SelectorCreatividad } from "./SelectorCreatividad";

type Props = {
  /** "Cumpleaños · rosa y plata · hasta $ 1.500.000" o null si el brief está vacío. */
  contexto: string | null;
  creatividad: NivelCreatividad;
  onCreatividad: (nivel: NivelCreatividad) => void;
  modoVista: ModoVista;
  onModoVista: (modo: ModoVista) => void;
  onLimpiar: () => void;
  limpiarDeshabilitado: boolean;
  /** Abre la hoja de selección manual; undefined cuando no aplica (hay propuesta en modo usuario). */
  onAbrirSeleccion?: () => void;
  totalSeleccion: number;
  /** Controles técnicos: se muestran en una barra aparte solo en modo dev. */
  barraDev?: ReactNode;
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
export function CabeceraApp({ contexto, creatividad, onCreatividad, modoVista, onModoVista, onLimpiar, limpiarDeshabilitado, onAbrirSeleccion, totalSeleccion, barraDev }: Props) {
  const esDev = modoVista === "dev";
  const items: ItemMenu[] = [
    { tipo: "enlace", id: "catalogo", etiqueta: "Explorar catálogo", href: "/catalogo", icono: <LayoutGrid className="size-4" /> },
    ...(onAbrirSeleccion
      ? [{ tipo: "accion" as const, id: "seleccion", etiqueta: totalSeleccion > 0 ? `Tu selección (${totalSeleccion})` : "Tu selección", onSeleccionar: onAbrirSeleccion, icono: <ListChecks className="size-4" /> }]
      : []),
    { tipo: "accion", id: "limpiar", etiqueta: "Limpiar chat", onSeleccionar: onLimpiar, deshabilitado: limpiarDeshabilitado, icono: <Trash2 className="size-4" /> },
    ...(esDev
      ? ([
          { tipo: "separador", id: "sep-dev" },
          { tipo: "enlace", id: "estadisticas", etiqueta: "Estadísticas", href: "/estadisticas", icono: <ChartColumn className="size-4" /> },
          { tipo: "enlace", id: "laboratorio", etiqueta: "Laboratorio JSON", href: "/laboratorio-referencias", icono: <FlaskConical className="size-4" /> },
          { tipo: "enlace", id: "admin", etiqueta: "Panel de administración", href: "/admin", icono: <Shield className="size-4" /> },
          { tipo: "enlace", id: "lora", etiqueta: "Configuración LoRA", href: "/configuracion-lora", icono: <Settings2 className="size-4" /> },
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
          {contexto && <p className="truncate" title={contexto}>{contexto}</p>}
        </div>
        <div className="app-acciones">
          <SelectorCreatividad valor={creatividad} onCambiar={onCreatividad} />
          <InterruptorTema />
          <SwitchModoVista modo={modoVista} onCambiar={onModoVista} />
          <MenuApp items={items} />
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
