"use client";

import { useEffect, useRef } from "react";
import { LoaderCircle, TriangleAlert } from "lucide-react";
import type { ModoAdmitido, ModoPatronColor, PatronColor } from "@/lib/plan/patron-color";
import { conGlobosPorRacimo, editar } from "./borrador";
import { nombreRacimo, type ColorLeyenda } from "./leyenda";
import { controlesDeModo, ESTILOS_MODO, ETIQUETA_DIRECCION, iconoDeModo } from "./modos";
import { IconoEstilo } from "./IconoEstilo";
import { AcentosPatron } from "./AcentosPatron";
import { Apartado, Contador, Interruptor, Segmentado } from "./controles-comunes";
import { ParametrosModo, type CambioPatron } from "./ParametrosModo";

/** Elegir un estilo: Python arma su punto de partida; `pendiente` y `error` dicen cómo va ese pedido. */
export type EleccionEstilo = {
  onElegir: (modo: ModoPatronColor) => void;
  pendiente?: ModoPatronColor | null;
  error?: { modo: ModoPatronColor; mensaje: string } | null;
  /** Lo que Python avisó al armar el estilo elegido (lo que quitó del borrador), mientras el borrador sigue en ese estilo. */
  avisos?: readonly string[];
};

type Props = {
  patron: PatronColor;
  leyenda: readonly ColorLeyenda[];
  /** Estilos que Python admite para la pieza, en su orden (`null` mientras no respondió). */
  modos: readonly ModoAdmitido[] | null;
  geometria: "racimos" | "rejilla";
  /** Globos por racimo con que Python dibuja la pieza; `null` mientras no la dibujó. */
  globosPorRacimo: number | null;
  estilo: EleccionEstilo;
  onCambiar: CambioPatron;
  deshabilitado?: boolean;
};

type PropsGaleria = {
  /** `null` mientras no hay borrador (Python no pudo sugerir uno): ninguna ficha activa. */
  patron: PatronColor | null;
  modos: readonly ModoAdmitido[] | null;
  estilo: EleccionEstilo;
  deshabilitado?: boolean;
};

/**
 * Galería de estilos: exactamente los modos que Python admite para la pieza,
 * en su orden, con el nombre del oficio y su esquema. Tocar el estilo del
 * borrador no cambia nada; otro pide a Python su punto de partida.
 */
export function GaleriaEstilos({ patron, modos, estilo, deshabilitado = false }: PropsGaleria) {
  const activo = patron?.base.modo ?? null;
  const avisos = estilo.avisos ?? [];
  const listaAvisos = useRef<HTMLUListElement>(null);
  const claveAvisos = avisos.join("|");
  // Un aviso nuevo queda a la vista aunque caiga justo bajo el borde de un teléfono (solo lo mínimo, sin saltos).
  useEffect(() => {
    if (!claveAvisos) return;
    const reducir = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    listaAvisos.current?.scrollIntoView({ block: "nearest", behavior: reducir ? "auto" : "smooth" });
  }, [claveAvisos]);
  return (
    <Apartado titulo="Estilo" ayuda={patron ? "Elige uno y ajústalo; la vista cambia al instante" : "Elige uno para empezar tu patrón"}>
      <div>
        {modos ? (
          <ul className="grid grid-cols-2 gap-1.5 @md:grid-cols-3" data-testid="galeria-estilos">
            {modos.map(({ modo }) => {
              const elegido = modo === activo;
              const cargando = estilo.pendiente === modo;
              const { nombre, ayuda } = ESTILOS_MODO[modo];
              return (
                <li key={modo}>
                  <button
                    type="button"
                    aria-pressed={elegido}
                    aria-busy={cargando || undefined}
                    data-modo={modo}
                    disabled={deshabilitado}
                    onClick={() => { if (!elegido) estilo.onElegir(modo); }}
                    className={`flex h-full w-full items-center gap-2.5 rounded-xl p-2 text-left ring-1 ring-inset transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acento disabled:opacity-50 ${elegido ? "bg-acento-suave ring-2 ring-acento" : cargando ? "bg-superficie-suave ring-acento/50" : "bg-superficie ring-borde-suave hover:bg-superficie-suave hover:ring-borde"}`}
                  >
                    <span className={`grid size-9 shrink-0 place-items-center rounded-lg ${elegido ? "bg-superficie text-acento" : "bg-superficie-2 text-texto-suave"}`}>
                      {cargando
                        ? <LoaderCircle className="size-5 animate-spin text-acento motion-reduce:animate-none" aria-hidden="true" />
                        : <IconoEstilo estilo={iconoDeModo(modo, patron)} className="size-6" />}
                    </span>
                    <span className="min-w-0">
                      <span className={`block text-[13px] font-semibold leading-tight ${elegido ? "text-acento" : "text-texto"}`}>{nombre}</span>
                      <span className="block text-[11px] leading-snug text-texto-suave">{ayuda}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          // Python todavía no dijo qué estilos admite la pieza.
          <ul className="grid grid-cols-2 gap-1.5 @md:grid-cols-3" aria-hidden="true">
            {[0, 1, 2, 3].map((indice) => <li key={indice} className="brillo-carga h-14 rounded-xl" />)}
          </ul>
        )}
        {/* Siempre montada (una región viva solo anuncia lo que cambia dentro de ella) y vacía no ocupa lugar. Va junto al estilo tocado, también en un teléfono. */}
        <div role="status" aria-live="polite" data-testid="avisos-estilo">
          {avisos.length > 0 && (
            <ul ref={listaAvisos} aria-label="Al cambiar de estilo" className="mt-2 space-y-1 rounded-xl bg-aviso-suave px-3 py-2 text-xs font-medium text-aviso">
              {avisos.map((aviso) => <li key={aviso} className="flex gap-1.5"><TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden="true" />{aviso}</li>)}
            </ul>
          )}
        </div>
      </div>
      {estilo.error && (
        <p role="alert" data-testid="error-estilo" className="flex items-start gap-2 rounded-xl bg-aviso-suave px-3 py-2 text-xs font-medium text-aviso">
          <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1">{ESTILOS_MODO[estilo.error.modo].nombre}: {estilo.error.mensaje}</span>
        </p>
      )}
    </Apartado>
  );
}

/**
 * Todos los parámetros del patrón a la derecha del editor: estilo, colores del
 * modo, tamaño del racimo, y la dirección y el espejo cuando Python los admite
 * para ese estilo (`modos_admitidos`), además de los acentos.
 */
export function ControlesPatron({ patron, leyenda, modos, geometria, globosPorRacimo, estilo, onCambiar, deshabilitado = false }: Props) {
  const { direcciones, espejo } = controlesDeModo(modos, patron.base.modo);
  return (
    <div className="@container space-y-5">
      <GaleriaEstilos patron={patron} modos={modos} estilo={estilo} deshabilitado={deshabilitado} />
      <ParametrosModo patron={patron} leyenda={leyenda} geometria={geometria} onCambiar={onCambiar} deshabilitado={deshabilitado} />
      {geometria === "racimos" && globosPorRacimo !== null && (
        <Apartado titulo="Globos por racimo" ayuda="Pareja, trío, cuarteto…: cuántos globos amarras en cada racimo">
          <Contador
            etiqueta="Globos por racimo"
            valor={globosPorRacimo}
            min={2}
            max={8}
            deshabilitado={deshabilitado}
            onCambiar={(globos) => onCambiar(conGlobosPorRacimo(patron, globos))}
            formato={(valor) => `${valor} · ${nombreRacimo(valor)}`}
          />
        </Apartado>
      )}
      {direcciones.length > 0 && (
        <Apartado titulo="Dirección">
          <Segmentado
            etiqueta="Dirección del patrón"
            valor={patron.direccion ?? "longitudinal"}
            deshabilitado={deshabilitado}
            onCambiar={(direccion) => onCambiar(editar(patron, { direccion: direccion === "longitudinal" ? undefined : direccion }))}
            opciones={direcciones.map((direccion) => ({ valor: direccion, etiqueta: ETIQUETA_DIRECCION[direccion] }))}
          />
        </Apartado>
      )}
      {espejo && (
        <Interruptor
          activo={patron.simetria === "espejo"}
          deshabilitado={deshabilitado}
          etiqueta="Simetría espejo"
          descripcion="El lado derecho repite el izquierdo, desde cada pie hasta la clave"
          onCambiar={(activo) => onCambiar(editar(patron, { simetria: activo ? "espejo" : undefined }))}
        />
      )}
      <AcentosPatron patron={patron} leyenda={leyenda} geometria={geometria} onCambiar={onCambiar} deshabilitado={deshabilitado} />
    </div>
  );
}
