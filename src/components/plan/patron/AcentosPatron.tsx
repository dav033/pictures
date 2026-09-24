"use client";

import { Plus, X } from "lucide-react";
import type { AcentoPatronColor, PatronColor } from "@/lib/plan/patron-color";
import { editar } from "./borrador";
import type { ColorLeyenda } from "./leyenda";
import { Apartado, Contador, Segmentado, SelectorColor } from "./controles-comunes";
import type { CambioPatron } from "./ParametrosModo";

const MAX_ACENTOS = 4;

/**
 * "Acento cada N": un color que aparece a intervalos fijos sobre la base (un
 * globo del racimo o el racimo completo). Solo arma la declaración; Python
 * decide en qué racimos cae y lo cuenta.
 */
export function AcentosPatron({ patron, leyenda, geometria, onCambiar, deshabilitado = false }: {
  patron: PatronColor;
  leyenda: readonly ColorLeyenda[];
  geometria: "racimos" | "rejilla";
  onCambiar: CambioPatron;
  deshabilitado?: boolean;
}) {
  const acentos = patron.acentos ?? [];
  const unidad = geometria === "rejilla" ? { singular: "fila", plural: "filas" } : { singular: "racimo", plural: "racimos" };
  const guardar = (siguientes: AcentoPatronColor[], grupo?: string) => onCambiar(editar(patron, { acentos: siguientes.length ? siguientes : undefined }), grupo);
  const cambiar = (posicion: number, acento: AcentoPatronColor, grupo?: string) => guardar(acentos.map((otro, indice) => (indice === posicion ? acento : otro)), grupo);
  function anadir(): void {
    const material = leyenda[leyenda.length - 1]?.indice ?? 0;
    guardar([...acentos, { material, cada: 3, desde: 2, posiciones: [0] }]);
  }
  return (
    <Apartado
      titulo="Acento cada N"
      ayuda={`Un color que se repite a intervalos, por ejemplo un globo dorado cada 3 ${unidad.plural}`}
      accion={
        <button type="button" onClick={anadir} disabled={deshabilitado || acentos.length >= MAX_ACENTOS} className="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg px-2.5 text-xs font-semibold text-acento hover:bg-acento-suave focus-visible:outline-2 focus-visible:outline-acento disabled:opacity-40">
          <Plus className="size-3.5" aria-hidden="true" />Añadir
        </button>
      }
    >
      {acentos.length > 0 && (
        <ol className="space-y-2">
          {acentos.map((acento, posicion) => (
            <li key={posicion} className="space-y-2.5 rounded-xl bg-superficie p-2.5 ring-1 ring-borde-suave ring-inset">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-texto">Acento {posicion + 1}</span>
                <button type="button" aria-label={`Quitar acento ${posicion + 1}`} disabled={deshabilitado} onClick={() => guardar(acentos.filter((_, indice) => indice !== posicion))} className="grid size-8 place-items-center rounded-lg text-texto-suave hover:bg-error-suave hover:text-error focus-visible:outline-2 focus-visible:outline-acento">
                  <X className="size-3.5" aria-hidden="true" />
                </button>
              </div>
              <SelectorColor leyenda={leyenda} valor={acento.material} deshabilitado={deshabilitado} etiqueta={`Color del acento ${posicion + 1}`} onCambiar={(material) => cambiar(posicion, { ...acento, material })} />
              <div className="flex flex-wrap gap-2">
                <Contador etiqueta={`Cada cuántos ${unidad.plural}`} valor={acento.cada} min={2} max={24} deshabilitado={deshabilitado} onCambiar={(cada) => cambiar(posicion, { ...acento, cada })} formato={(valor) => `cada ${valor} ${unidad.plural}`} />
                <Contador etiqueta={`Desde qué ${unidad.singular}`} valor={acento.desde} min={1} max={24} deshabilitado={deshabilitado} onCambiar={(desde) => cambiar(posicion, { ...acento, desde })} formato={(valor) => `desde el ${valor}`} />
              </div>
              <Segmentado
                etiqueta={`Alcance del acento ${posicion + 1}`}
                valor={acento.posiciones ? "globo" : "completo"}
                deshabilitado={deshabilitado}
                onCambiar={(alcance) => {
                  const completo: AcentoPatronColor = { material: acento.material, cada: acento.cada, desde: acento.desde };
                  cambiar(posicion, alcance === "globo" ? { ...completo, posiciones: [0] } : completo);
                }}
                opciones={[{ valor: "globo", etiqueta: "Un globo" }, { valor: "completo", etiqueta: geometria === "rejilla" ? "Fila completa" : "Racimo completo" }]}
              />
            </li>
          ))}
        </ol>
      )}
    </Apartado>
  );
}
