"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown, Minus, Plus } from "lucide-react";
import type { ArmadoArcoV1, FormaArco, TamanoArco } from "@/lib/plan/armado-arco";
import type { ControlPatronArco, LimitesArco, OpcionesArmadoArco, PatronArcoAdmitido } from "@/lib/plan/opciones-armado-arco";
import type { ColorLeyenda } from "../patron/leyenda";
import {
  conAlto,
  conAncho,
  conColor,
  conColorAgregado,
  conControl,
  conForma,
  conGlobosAncho,
  conInflado,
  conPatron,
  conTamanoGlobo,
  conUltimoColorQuitado,
  patronDisponible,
  rangoDeAlto,
  rangoDeAncho,
  rangoDeColores,
  rangoDeGlobosAncho,
  rangoDeInflado,
  valorDeControl,
  valorEnRango,
} from "./borrador-arco";
import { DeslizadorArco, GrupoOpcionesArco, InterruptorArco, SeleccionArco } from "./controles-arco";

/**
 * Los ajustes del arco (ADR-0035, paso 1), en tres apartados plegables para no agrandar la tarjeta: el diseño de
 * color (patrón y sus mandos), la forma y el tamaño, y el globo.
 *
 * **Lo que se ofrece lo dice el motor** (un patrón nuevo aparece aquí en cuanto también está en el contrato `armado-arco.v1`;
 * mientras no lo esté, la vista previa lo ignora en vez de romperse). Los patrones, sus mandos con etiqueta, ayuda, rango, paso y valor por
 * defecto salen de `opciones` (`opciones_admitidas`); los rangos del ancho, el alto y los globos a lo ancho, de
 * `limites` (`limites_de`), que cambian con el armado puesto (un globo R36 sube el ancho mínimo). Aquí no hay
 * ninguna lista de patrones ni de rangos: lo único escrito a mano es el idioma de lo que el motor no publica
 * (los nombres de la forma y de los apartados) y el paso de dos deslizadores. Cada cambio devuelve un borrador
 * nuevo que el motor dibuja; nada se cuenta ni se mide aquí.
 */

type Props = {
  borrador: ArmadoArcoV1;
  /** Lo que el motor admite; viene con cada dibujo que devuelve. */
  opciones: OpcionesArmadoArco;
  limites: LimitesArco;
  /** Los colores de la pieza por índice de material, como la leyenda del patrón. */
  leyenda: readonly ColorLeyenda[];
  onCambiar: (siguiente: ArmadoArcoV1) => void;
};

/** El motor publica las claves de la forma, no su nombre ni su ayuda. */
const TEXTO_FORMA: Readonly<Record<FormaArco, { nombre: string; ayuda: string }>> = {
  alto: { nombre: "Alta", ayuda: "Más alta que ancha, como un portal." },
  semi: { nombre: "Semicírculo", ayuda: "Media circunferencia: el alto sale del ancho." },
  herradura: { nombre: "Herradura", ayuda: "Curva arriba y patas rectas abajo." },
};

const numero = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 2 });
const metros = (valor: number) => `${numero.format(valor)} m`;
const entero = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 });
const porcentaje = new Intl.NumberFormat("es-CO", { style: "percent", maximumFractionDigits: 0 });

/** Un apartado plegable: el título es el botón (44 px), con el foco visible. */
function Apartado({ titulo, resumen, abierto, children, testid }: { titulo: string; resumen?: string; abierto?: boolean; children: ReactNode; testid: string }) {
  const [desplegado, setDesplegado] = useState(Boolean(abierto));
  return (
    <details open={desplegado} onToggle={(evento) => setDesplegado(evento.currentTarget.open)} data-testid={testid} className="group rounded-xl bg-superficie ring-1 ring-borde-suave ring-inset">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 rounded-xl px-3 text-[13px] font-semibold text-texto focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acento [&::-webkit-details-marker]:hidden">
        <span className="min-w-0 truncate">{titulo}{resumen && <span className="ml-2 font-normal text-texto-suave">{resumen}</span>}</span>
        <ChevronDown className="size-4 shrink-0 text-texto-suave transition-transform group-open:rotate-180 motion-reduce:transition-none" aria-hidden="true" />
      </summary>
      <div className="space-y-3 px-3 pb-3 pt-1">{children}</div>
    </details>
  );
}

/** Un mando del patrón tal como el motor lo describe: interruptor, lista de opciones o deslizador. */
function MandoDelPatron({ control, borrador, onCambiar }: { control: ControlPatronArco; borrador: ArmadoArcoV1; onCambiar: (siguiente: ArmadoArcoV1) => void }) {
  const valor = valorDeControl(borrador, control);
  const testid = `mando-patron-${control.clave}`;
  if (control.interruptor) {
    return <InterruptorArco etiqueta={control.etiqueta} ayuda={control.ayuda} activo={valor >= 1} onCambiar={(activo) => onCambiar(conControl(borrador, control.clave, activo ? 1 : 0))} testid={testid} />;
  }
  const seleccion = control.seleccion;
  if (seleccion) {
    return (
      <SeleccionArco
        etiqueta={control.etiqueta}
        ayuda={control.ayuda}
        opciones={seleccion.map((nombre, indice) => ({ valor: String(indice), etiqueta: nombre }))}
        valor={String(valor)}
        onCambiar={(elegido) => onCambiar(conControl(borrador, control.clave, Number(elegido)))}
        testid={testid}
      />
    );
  }
  return (
    <DeslizadorArco
      etiqueta={control.etiqueta}
      ayuda={control.ayuda}
      valor={valorEnRango(valor, control)}
      min={control.min}
      max={control.max}
      paso={control.paso}
      formato={(actual) => numero.format(actual)}
      onConfirmar={(nuevo) => onCambiar(conControl(borrador, control.clave, nuevo))}
      testid={testid}
    />
  );
}

/**
 * Qué color de la pieza cumple cada papel del patrón (Centro, Franja 1…): se elige uno por uno. Un patrón de lista
 * (franjas, bloques) también admite más o menos posiciones, dentro de lo que el motor publica. Cada color de la
 * pieza que el armado no toma se dice antes de guardar (aviso del motor sobre el dibujo): no se compraría.
 */
function ColoresDelPatron({ patron, borrador, leyenda, onCambiar }: { patron: PatronArcoAdmitido; borrador: ArmadoArcoV1; leyenda: readonly ColorLeyenda[]; onCambiar: (siguiente: ArmadoArcoV1) => void }) {
  const papel = (posicion: number): string => patron.roles?.[posicion] ?? (patron.lista ? `${patron.lista.etiqueta} ${posicion + 1}` : `Color ${posicion + 1}`);
  const { min, max } = rangoDeColores(patron);
  const deLaPieza = leyenda.map((color) => ({ valor: String(color.indice), etiqueta: `${color.numero}. ${color.etiqueta}` }));
  // Un índice del borrador que la pieza ya no tiene (se quitó un color) no se disfraza de otro: se nombra tal cual.
  const opcionesDe = (indice: number) => (leyenda.some((color) => color.indice === indice) ? deLaPieza : [...deLaPieza, { valor: String(indice), etiqueta: "Un color que la pieza ya no tiene" }]);
  const boton = "ui-button-secondary ui-pressable min-h-11 px-3.5 py-1.5 text-[13px]";
  return (
    <div data-testid="colores-del-patron" className="space-y-2">
      <p className="text-[13px] font-medium text-texto">Colores de la pieza que usa</p>
      <div className="grid gap-x-6 gap-y-2 @md:grid-cols-2">
        {borrador.materiales.map((indice, posicion) => (
          <SeleccionArco
            key={posicion}
            etiqueta={papel(posicion)}
            opciones={opcionesDe(indice)}
            valor={String(indice)}
            onCambiar={(elegido) => onCambiar(conColor(borrador, posicion, Number(elegido)))}
            testid={`mando-color-${posicion}`}
          />
        ))}
      </div>
      {patron.lista && max > min && (
        <div className="flex flex-wrap gap-2">
          <button type="button" className={boton} disabled={borrador.materiales.length >= max} onClick={() => onCambiar(conColorAgregado(borrador, patron, leyenda.length))} data-testid="agregar-color">
            <Plus className="size-3.5" aria-hidden="true" />Agregar {patron.lista.etiqueta.toLowerCase()}
          </button>
          <button type="button" className={boton} disabled={borrador.materiales.length <= min} onClick={() => onCambiar(conUltimoColorQuitado(borrador, patron))} data-testid="quitar-color">
            <Minus className="size-3.5" aria-hidden="true" />Quitar la última
          </button>
        </div>
      )}
    </div>
  );
}

export function ControlesArco({ borrador, opciones, limites, leyenda, onCambiar }: Props) {
  const coloresDePieza = leyenda.length;
  const patron = opciones.patrones.find((descrito) => descrito.id === borrador.patron);
  const ancho = rangoDeAncho(limites);
  const alto = rangoDeAlto(limites);
  const globosAncho = rangoDeGlobosAncho(limites);
  const inflado = rangoDeInflado();
  const semicirculo = borrador.geometria.forma === "semi";

  return (
    <div data-testid="controles-arco" className="space-y-2">
      <Apartado titulo="Diseño de color" resumen={patron?.nombre} abierto testid="apartado-patron">
        <SeleccionArco
          etiqueta="Patrón"
          opciones={opciones.patrones.map((descrito) => ({
            valor: descrito.id,
            etiqueta: patronDisponible(descrito, coloresDePieza) ? descrito.nombre : `${descrito.nombre} (pide ${descrito.min_colores} colores)`,
            deshabilitada: !patronDisponible(descrito, coloresDePieza) && descrito.id !== borrador.patron,
          }))}
          valor={borrador.patron}
          onCambiar={(elegido) => {
            const descrito = opciones.patrones.find((candidato) => candidato.id === elegido);
            if (descrito) onCambiar(conPatron(borrador, descrito, coloresDePieza));
          }}
          testid="mando-patron"
        />
        {patron && <ColoresDelPatron patron={patron} borrador={borrador} leyenda={leyenda} onCambiar={onCambiar} />}
        {patron && patron.controles.length > 0 && (
          <div className="grid gap-x-6 gap-y-3 @md:grid-cols-2">
            {patron.controles.map((control) => <MandoDelPatron key={`${patron.id}-${control.clave}`} control={control} borrador={borrador} onCambiar={onCambiar} />)}
          </div>
        )}
      </Apartado>

      <Apartado titulo="Forma y tamaño" resumen={`${TEXTO_FORMA[borrador.geometria.forma].nombre}, ${metros(valorEnRango(borrador.geometria.anchoM, ancho))}`} testid="apartado-forma">
        <GrupoOpcionesArco<FormaArco>
          etiqueta="Forma"
          ayuda={TEXTO_FORMA[borrador.geometria.forma].ayuda}
          opciones={opciones.formas.map((forma) => ({ valor: forma, etiqueta: TEXTO_FORMA[forma].nombre, descripcion: TEXTO_FORMA[forma].ayuda }))}
          valor={borrador.geometria.forma}
          onCambiar={(forma) => onCambiar(conForma(borrador, forma))}
          testid="mando-forma"
        />
        <div className="grid gap-x-6 gap-y-3 @md:grid-cols-2">
          <DeslizadorArco
            etiqueta="Ancho"
            ayuda="Medido por fuera. El mínimo sube con el tamaño del globo."
            valor={valorEnRango(borrador.geometria.anchoM, ancho)}
            min={ancho.min}
            max={ancho.max}
            paso={ancho.paso}
            formato={metros}
            onConfirmar={(valor) => onCambiar(conAncho(borrador, valor))}
            testid="mando-ancho"
          />
          {semicirculo ? (
            <p data-testid="alto-del-semicirculo" className="self-end text-xs leading-relaxed text-texto-suave">El alto de un semicírculo sale de su ancho: no se elige.</p>
          ) : (
            <DeslizadorArco
              etiqueta="Alto"
              ayuda="Medido por fuera. Depende de la forma."
              valor={valorEnRango(borrador.geometria.altoM, alto)}
              min={alto.min}
              max={alto.max}
              paso={alto.paso}
              formato={metros}
              onConfirmar={(valor) => onCambiar(conAlto(borrador, valor))}
              testid="mando-alto"
            />
          )}
          <DeslizadorArco
            etiqueta="Globos a lo ancho"
            ayuda="Cuántos globos hay de lado a lado de la banda: más globos, banda más gruesa."
            valor={valorEnRango(borrador.geometria.globosAncho, globosAncho)}
            min={globosAncho.min}
            max={globosAncho.max}
            paso={globosAncho.paso}
            formato={(valor) => entero.format(valor)}
            textoValor={(valor) => `${entero.format(valor)} globos a lo ancho`}
            onConfirmar={(valor) => onCambiar(conGlobosAncho(borrador, valor))}
            testid="mando-globos-ancho"
          />
        </div>
      </Apartado>

      <Apartado titulo="Globo" resumen={`R${borrador.globo.nominal}`} testid="apartado-globo">
        <GrupoOpcionesArco<TamanoArco>
          etiqueta="Tamaño del globo"
          ayuda="R es redondo y el número, las pulgadas. Un globo más grande pide un arco más ancho."
          opciones={opciones.tamanos.map((nominal) => ({ valor: nominal, etiqueta: `R${nominal}`, descripcion: `Redondo de ${nominal} pulgadas` }))}
          valor={borrador.globo.nominal}
          onCambiar={(nominal) => onCambiar(conTamanoGlobo(borrador, nominal))}
          testid="mando-tamano-globo"
        />
        <DeslizadorArco
          etiqueta="Inflado"
          ayuda="Cuánto se infla cada globo respecto a lo normal: menos, quedan más chicos; más, más grandes."
          valor={valorEnRango(borrador.globo.inflado, inflado)}
          min={inflado.min}
          max={inflado.max}
          paso={inflado.paso}
          formato={(valor) => porcentaje.format(valor)}
          textoValor={(valor) => `${porcentaje.format(valor)} del tamaño normal`}
          onConfirmar={(valor) => onCambiar(conInflado(borrador, valor))}
          testid="mando-inflado"
        />
      </Apartado>
    </div>
  );
}
