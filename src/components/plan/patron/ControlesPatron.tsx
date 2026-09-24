"use client";

import type { PatronColor } from "@/lib/plan/patron-color";
import { conGlobosPorRacimo, editar, patronDeEstilo, type ContextoEstilo } from "./borrador";
import { nombreRacimo, type ColorLeyenda } from "./leyenda";
import { admiteEspejo, direccionesPara, estiloDe, estilosParaTipo, type DireccionPatron } from "./modos";
import { IconoEstilo } from "./IconoEstilo";
import { AcentosPatron } from "./AcentosPatron";
import { Apartado, Contador, Interruptor, Segmentado } from "./controles-comunes";
import { ParametrosModo, type CambioPatron } from "./ParametrosModo";

type Props = {
  patron: PatronColor;
  leyenda: readonly ColorLeyenda[];
  tipo: string;
  geometria: "racimos" | "rejilla";
  contexto: ContextoEstilo;
  onCambiar: CambioPatron;
  deshabilitado?: boolean;
};

const ETIQUETA_DIRECCION: Readonly<Record<DireccionPatron, string>> = {
  longitudinal: "Por filas",
  transversal: "Por columnas",
  diagonal: "En diagonal",
};

type PropsGaleria = Pick<Props, "tipo" | "contexto" | "onCambiar" | "deshabilitado"> & {
  /** `null` mientras no hay borrador (Python no pudo sugerir uno): ninguna ficha activa. */
  patron: PatronColor | null;
};

/** Galería de estilos con el nombre del oficio y su esquema. */
export function GaleriaEstilos({ patron, tipo, contexto, onCambiar, deshabilitado = false }: PropsGaleria) {
  const activo = patron ? estiloDe(patron) : null;
  return (
    <Apartado titulo="Estilo" ayuda={patron ? "Elige uno y ajústalo; la vista cambia al instante" : "Elige uno para empezar tu patrón"}>
      <ul className="grid grid-cols-2 gap-1.5 @md:grid-cols-3">
        {estilosParaTipo(tipo).map((estilo) => {
          const elegido = estilo.id === activo;
          return (
            <li key={estilo.id}>
              <button
                type="button"
                aria-pressed={elegido}
                disabled={deshabilitado}
                onClick={() => { if (!elegido) onCambiar(patronDeEstilo(estilo.id, patron, contexto)); }}
                className={`flex h-full w-full items-center gap-2.5 rounded-xl p-2 text-left ring-1 ring-inset transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acento disabled:opacity-50 ${elegido ? "bg-acento-suave ring-2 ring-acento" : "bg-superficie ring-borde-suave hover:bg-superficie-suave hover:ring-borde"}`}
              >
                <span className={`grid size-9 shrink-0 place-items-center rounded-lg ${elegido ? "bg-superficie text-acento" : "bg-superficie-2 text-texto-suave"}`}>
                  <IconoEstilo estilo={estilo.id} className="size-6" />
                </span>
                <span className="min-w-0">
                  <span className={`block text-[13px] font-semibold leading-tight ${elegido ? "text-acento" : "text-texto"}`}>{estilo.nombre}</span>
                  <span className="block text-[11px] leading-snug text-texto-suave">{estilo.ayuda}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </Apartado>
  );
}

/**
 * Todos los parámetros del patrón a la derecha del editor: estilo, colores del
 * modo, tamaño del racimo, dirección (paredes), espejo (arcos) y acentos.
 */
export function ControlesPatron({ patron, leyenda, tipo, geometria, contexto, onCambiar, deshabilitado = false }: Props) {
  const modo = patron.base.modo;
  const direcciones = direccionesPara(tipo, modo);
  return (
    <div className="@container space-y-5">
      <GaleriaEstilos patron={patron} tipo={tipo} contexto={contexto} onCambiar={onCambiar} deshabilitado={deshabilitado} />
      <ParametrosModo patron={patron} leyenda={leyenda} geometria={geometria} onCambiar={onCambiar} deshabilitado={deshabilitado} />
      {geometria === "racimos" && (
        <Apartado titulo="Globos por racimo" ayuda="Pareja, trío, cuarteto…: cuántos globos amarras en cada racimo">
          <Contador
            etiqueta="Globos por racimo"
            valor={contexto.globosPorRacimo}
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
            etiqueta="Dirección del patrón en la pared"
            valor={patron.direccion ?? "longitudinal"}
            deshabilitado={deshabilitado}
            onCambiar={(direccion) => onCambiar(editar(patron, { direccion: direccion === "longitudinal" ? undefined : direccion }))}
            opciones={direcciones.map((direccion) => ({ valor: direccion, etiqueta: ETIQUETA_DIRECCION[direccion] }))}
          />
        </Apartado>
      )}
      {admiteEspejo(tipo, modo) && (
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
