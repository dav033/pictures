"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown, Minus, Plus } from "lucide-react";
import { MODOS_COLUMNA, type ArmadoColumnaV1, type RemateColumna, type TamanoColumna } from "@/lib/plan/armado-columna";
import type { ControlPatronColumna, LimitesColumna, OpcionesArmadoColumna, PatronColumnaAdmitido } from "@/lib/plan/opciones-armado-columna";
import type { ColorLeyenda } from "../patron/leyenda";
import {
  conAlto,
  conBase,
  conColor,
  conColorAgregado,
  conControl,
  conEscalonado,
  conGloboGrande,
  conGlobosCapa,
  conInfladoCampo,
  conModoAltura,
  conOtraVariacion,
  conPatron,
  conRemateCantidad,
  conRemateColor,
  conRemateFoil,
  conRemateTamano,
  conRemateTipo,
  conTamanoAbajo,
  conTamanoArriba,
  conUltimoColorQuitado,
  pasoDeMando,
  patronDisponible,
  rangoDeAlto,
  rangoDeColores,
  rangoDeFoil,
  rangoDeInflado,
  tamanosDeRemate,
  valorDeControl,
  valorEnRango,
} from "./borrador-columna";
import { DeslizadorColumna, GrupoOpcionesColumna, InterruptorColumna, SeleccionColumna } from "./controles-columna";

/**
 * Los ajustes de la columna (ADR-0035, paso 3), en cuatro apartados plegables para no agrandar la tarjeta: el diseño
 * de color (patrón, colores y sus mandos), la forma y el tamaño, el remate y cómo se inflan los globos.
 *
 * **Lo que se ofrece lo dice el motor.** Los nueve patrones y los rangos de cada mando salen de `opciones`
 * (`opciones_admitidas`); el alto que cabe, el foil y qué globo o racimo guarda proporción como remate, de `limites`
 * (`limites_de`), que cambian con el armado puesto (un globo R36 sube el alto mínimo). Lo único escrito a mano es el
 * idioma de lo que el motor publica solo como clave: los nombres de los mandos de cada patrón y los de los remates y
 * los apartados. Cada cambio devuelve un borrador nuevo que el motor dibuja; nada se cuenta ni se mide aquí.
 */

type Props = {
  borrador: ArmadoColumnaV1;
  /** Lo que el motor admite; viene con cada dibujo que devuelve. */
  opciones: OpcionesArmadoColumna;
  limites: LimitesColumna;
  /** Los colores de la pieza por índice de material, como la leyenda del patrón. */
  leyenda: readonly ColorLeyenda[];
  onCambiar: (siguiente: ArmadoColumnaV1) => void;
};

/** El motor publica la clave de cada mando, no su nombre ni su ayuda. */
const TEXTO_MANDO: Readonly<Record<string, { etiqueta: string; ayuda: string }>> = {
  vueltas: { etiqueta: "Vueltas", ayuda: "Cuántas veces se repiten los colores dando la vuelta a la columna." },
  inclinacion: { etiqueta: "Inclinación", ayuda: "Qué tan en diagonal sube cada franja; en 0 quedan rectas." },
  grosor: { etiqueta: "Capas por franja", ayuda: "Cuántas capas seguidas llevan el mismo color." },
  periodo: { etiqueta: "Capas por zigzag", ayuda: "Cada cuántas capas cambia de sentido." },
  amplitud: { etiqueta: "Qué tan marcado el zigzag", ayuda: "Cuánto se inclina cada quiebre: abajo del todo casi no se nota." },
  repet: { etiqueta: "Rombos alrededor", ayuda: "Cuántos rombos caben dando la vuelta." },
  alto: { etiqueta: "Alto del rombo", ayuda: "Capas que mide cada rombo." },
  grueso: { etiqueta: "Grosor del rombo", ayuda: "Qué parte del rombo ocupa el color." },
  sepCapas: { etiqueta: "Capas entre puntos", ayuda: "Cuánta distancia hay de un punto al siguiente hacia arriba." },
  puntos: { etiqueta: "Puntos por vuelta", ayuda: "Cuántos puntos hay en cada capa con punto." },
  suavidad: { etiqueta: "Suavidad", ayuda: "Cuántos globos se cuelan entre un tono y el siguiente." },
  invertir: { etiqueta: "Invertir el sentido", ayuda: "Cambia qué tono va abajo y cuál arriba." },
};

/**
 * Un mando que el motor publica y que esta pantalla todavía no sabe nombrar. Antes se enseñaba su clave cruda
 * (`sepCapas`, `variacion_tam`): una palabra del motor que al decorador no le dice nada. Mientras falte su nombre
 * aquí, el mando se ofrece con una frase de oficio en vez de la clave.
 */
const MANDO_SIN_NOMBRE = {
  etiqueta: "Otro ajuste de este patrón",
  ayuda: "Este patrón trae un ajuste que todavía no tiene nombre aquí: muévelo y mira cómo cambia el dibujo.",
} as const;

const TEXTO_REMATE: Readonly<Record<RemateColumna, { nombre: string; ayuda: string }>> = {
  ninguno: { nombre: "Ninguno", ayuda: "La columna termina en el último anillo de globos." },
  globo: { nombre: "Globo", ayuda: "Un globo grande en la punta." },
  racimo: { nombre: "Racimo", ayuda: "Varios globos chicos juntos en la punta." },
  estrella: { nombre: "Estrella", ayuda: "Una estrella de foil, que no cuenta como globo de látex." },
  corazon: { nombre: "Corazón", ayuda: "Un corazón de foil, que no cuenta como globo de látex." },
};

const TEXTO_MODO: Readonly<Record<(typeof MODOS_COLUMNA)[number], string>> = {
  altura: "por altura",
  capas: "capa por capa",
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

/** Un mando del patrón tal como el motor lo describe: interruptor (0 o 1) o deslizador. */
function MandoDelPatron({ control, borrador, onCambiar }: { control: ControlPatronColumna; borrador: ArmadoColumnaV1; onCambiar: (siguiente: ArmadoColumnaV1) => void }) {
  const valor = valorDeControl(borrador, control);
  const testid = `mando-patron-${control.clave}`;
  const texto: { etiqueta: string; ayuda?: string } = TEXTO_MANDO[control.clave] ?? MANDO_SIN_NOMBRE;
  if (control.min === 0 && control.max === 1 && Number.isInteger(control.defecto)) {
    return <InterruptorColumna etiqueta={texto.etiqueta} ayuda={texto.ayuda} activo={valor >= 1} onCambiar={(activo) => onCambiar(conControl(borrador, control.clave, activo ? 1 : 0))} testid={testid} />;
  }
  return (
    <DeslizadorColumna
      etiqueta={texto.etiqueta}
      ayuda={texto.ayuda}
      valor={valorEnRango(valor, control)} valorReal={valor}
      min={control.min}
      max={control.max}
      paso={pasoDeMando(control)}
      formato={(actual) => numero.format(actual)}
      onConfirmar={(nuevo) => onCambiar(conControl(borrador, control.clave, nuevo))}
      testid={testid}
    />
  );
}

/**
 * Qué color de la pieza va en cada lugar del patrón (Color 1, Color 2…): se elige uno por uno, y se pueden agregar o
 * quitar lugares dentro de lo que el patrón admite. Cada color de la pieza que el armado no toma se dice antes de
 * guardar (aviso del motor sobre el dibujo): no se compraría.
 */
function ColoresDelPatron({ patron, borrador, leyenda, onCambiar }: { patron: PatronColumnaAdmitido; borrador: ArmadoColumnaV1; leyenda: readonly ColorLeyenda[]; onCambiar: (siguiente: ArmadoColumnaV1) => void }) {
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
          <SeleccionColumna
            key={posicion}
            etiqueta={posicion === 0 ? "Color principal" : `Color ${posicion + 1}`}
            opciones={opcionesDe(indice)}
            valor={String(indice)}
            onCambiar={(elegido) => onCambiar(conColor(borrador, posicion, Number(elegido)))}
            testid={`mando-color-${posicion}`}
          />
        ))}
      </div>
      {max > min && (
        <div className="flex flex-wrap gap-2">
          <button type="button" className={boton} disabled={borrador.materiales.length >= max} onClick={() => onCambiar(conColorAgregado(borrador, patron, leyenda.length))} data-testid="agregar-color">
            <Plus className="size-3.5" aria-hidden="true" />Agregar un color
          </button>
          <button type="button" className={boton} disabled={borrador.materiales.length <= min} onClick={() => onCambiar(conUltimoColorQuitado(borrador, patron))} data-testid="quitar-color">
            <Minus className="size-3.5" aria-hidden="true" />Quitar el último
          </button>
        </div>
      )}
    </div>
  );
}

export function ControlesColumna({ borrador, opciones, limites, leyenda, onCambiar }: Props) {
  const coloresDePieza = leyenda.length;
  const patron = opciones.patrones.find((descrito) => descrito.id === borrador.patron);
  const alto = rangoDeAlto(limites);
  const foil = rangoDeFoil(limites);
  const porCapas = borrador.modo === "capas";
  const tamanosRemate = tamanosDeRemate(limites, borrador.remate.tipo);
  const conFoil = borrador.remate.tipo === "estrella" || borrador.remate.tipo === "corazon";
  const colorDelRemate = leyenda.map((color) => ({ valor: String(color.indice), etiqueta: `${color.numero}. ${color.etiqueta}` }));
  const infladoDe = (campo: "inflado" | "tamano" | "compresion" | "variacion_tam" | "variacion_tono" | "desorden", paso: number) => rangoDeInflado(campo, paso);

  return (
    <div data-testid="controles-columna" className="space-y-2">
      <div className="rounded-xl bg-superficie px-3 py-1 ring-1 ring-borde-suave ring-inset">
        <InterruptorColumna
          etiqueta="Globo grande arriba"
          ayuda={borrador.remate.tipo === "globo" ? "Quita el globo grande de la punta y la columna termina en el último anillo." : borrador.remate.tipo === "ninguno" ? "Pon un globo grande en la punta de la columna." : `Hoy lleva ${TEXTO_REMATE[borrador.remate.tipo].nombre.toLowerCase()} en la punta; al encender esto lo cambia por un globo grande.`}
          activo={borrador.remate.tipo === "globo"}
          onCambiar={(activo) => onCambiar(conGloboGrande(borrador, activo))}
          testid="mando-globo-grande"
        />
      </div>
      <Apartado titulo="Diseño de color" resumen={porCapas ? "Capa por capa" : patron?.nombre} abierto testid="apartado-patron">
        {porCapas ? (
          <div data-testid="columna-por-capas" className="space-y-2 rounded-xl bg-superficie-suave px-3 py-2.5 text-xs leading-relaxed text-texto-suave">
            <p>Esta columna está armada {TEXTO_MODO.capas}: cada anillo trae su tamaño y sus colores, y el patrón no decide nada. Aquí puedes ajustar el remate, la forma y los globos.</p>
            <button type="button" onClick={() => onCambiar(conModoAltura(borrador))} data-testid="pasar-a-patron" className="ui-button-secondary ui-pressable min-h-11 px-3.5 py-1.5 text-[13px]">
              Armarla con un patrón
            </button>
          </div>
        ) : (
          <>
            <SeleccionColumna
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
          </>
        )}
      </Apartado>

      <Apartado titulo="Forma y tamaño" resumen={`${metros(valorEnRango(borrador.cuerpo.alto_m, alto))}, ${entero.format(borrador.cuerpo.globos_capa)} globos por capa`} testid="apartado-forma">
        <div className="grid gap-x-6 gap-y-3 @md:grid-cols-2">
          <DeslizadorColumna
            etiqueta="Alto"
            ayuda="Medido sin el remate. El mínimo y el máximo cambian con el tamaño del globo."
            valor={valorEnRango(borrador.cuerpo.alto_m, alto)} valorReal={borrador.cuerpo.alto_m}
            min={alto.min}
            max={alto.max}
            paso={alto.paso}
            formato={metros}
            onConfirmar={(valor) => onCambiar(conAlto(borrador, valor))}
            testid="mando-alto"
          />
          <GrupoOpcionesColumna<number>
            etiqueta="Globos por capa"
            ayuda="Cuántos globos forman cada anillo; 4 es el cuarteto clásico."
            opciones={Array.from({ length: opciones.globos_capa.max - opciones.globos_capa.min + 1 }, (_, indice) => opciones.globos_capa.min + indice).map((cuantos) => ({ valor: cuantos, etiqueta: String(cuantos) }))}
            valor={borrador.cuerpo.globos_capa}
            onCambiar={(cuantos) => onCambiar(conGlobosCapa(borrador, cuantos))}
            testid="mando-globos-capa"
          />
        </div>
        <GrupoOpcionesColumna<TamanoColumna>
          etiqueta="Tamaño de los globos de abajo"
          ayuda="R es redondo y el número, las pulgadas."
          opciones={opciones.tamanos.map((tamano) => ({ valor: tamano, etiqueta: `R${tamano}`, descripcion: `Redondo de ${tamano} pulgadas` }))}
          valor={borrador.cuerpo.abajo}
          onCambiar={(tamano) => onCambiar(conTamanoAbajo(borrador, tamano))}
          testid="mando-tamano-abajo"
        />
        <GrupoOpcionesColumna<TamanoColumna>
          etiqueta="Tamaño de los globos de arriba"
          ayuda="Si es distinto del de abajo, la columna se afina o se ensancha por tramos."
          opciones={opciones.tamanos.map((tamano) => ({ valor: tamano, etiqueta: `R${tamano}`, descripcion: `Redondo de ${tamano} pulgadas` }))}
          valor={borrador.cuerpo.arriba}
          onCambiar={(tamano) => onCambiar(conTamanoArriba(borrador, tamano))}
          testid="mando-tamano-arriba"
        />
        <InterruptorColumna etiqueta="Capas escalonadas" ayuda="Cada capa gira medio paso y sus globos caen en los huecos de la de abajo; apagado, quedan uno sobre otro." activo={borrador.cuerpo.escalonado} onCambiar={(activo) => onCambiar(conEscalonado(borrador, activo))} testid="mando-escalonado" />
        <InterruptorColumna etiqueta="Base con peso" ayuda="Un plato al pie que la sostiene; suma 6 cm de alto." activo={borrador.cuerpo.base} onCambiar={(activo) => onCambiar(conBase(borrador, activo))} testid="mando-base" />
      </Apartado>

      <Apartado titulo="Remate" resumen={TEXTO_REMATE[borrador.remate.tipo].nombre} abierto testid="apartado-remate">
        <GrupoOpcionesColumna<RemateColumna>
          etiqueta="Otro remate en la punta"
          ayuda={TEXTO_REMATE[borrador.remate.tipo].ayuda}
          opciones={opciones.remates.map((tipo) => ({ valor: tipo, etiqueta: TEXTO_REMATE[tipo].nombre, descripcion: TEXTO_REMATE[tipo].ayuda }))}
          valor={borrador.remate.tipo}
          onCambiar={(tipo) => onCambiar(conRemateTipo(borrador, tipo))}
          testid="mando-remate-tipo"
        />
        {tamanosRemate.length > 0 && (
          <GrupoOpcionesColumna<TamanoColumna>
            etiqueta={borrador.remate.tipo === "racimo" ? "Tamaño de los globos del racimo" : "Tamaño del globo de la punta"}
            ayuda="Solo se ofrecen los tamaños que guardan proporción con esta columna."
            opciones={opciones.tamanos.filter((tamano) => tamanosRemate.includes(tamano) || tamano === borrador.remate.tamano).map((tamano) => ({ valor: tamano, etiqueta: `R${tamano}`, descripcion: `Redondo de ${tamano} pulgadas` }))}
            valor={borrador.remate.tamano}
            onCambiar={(tamano) => onCambiar(conRemateTamano(borrador, tamano))}
            testid="mando-remate-tamano"
          />
        )}
        {borrador.remate.tipo === "racimo" && (
          <GrupoOpcionesColumna<number>
            etiqueta="Globos del racimo"
            ayuda="Cuántos globos chicos se atan juntos en la punta."
            opciones={[3, 4, 5].map((cuantos) => ({ valor: cuantos, etiqueta: String(cuantos) }))}
            valor={borrador.remate.cantidad}
            onCambiar={(cuantos) => onCambiar(conRemateCantidad(borrador, cuantos))}
            testid="mando-remate-cantidad"
          />
        )}
        {conFoil && (
          <DeslizadorColumna
            etiqueta="Alto del foil"
            ayuda="Lo que mide la figura de foil. El máximo sale del ancho de la columna."
            valor={valorEnRango(borrador.remate.foil_m, foil)} valorReal={borrador.remate.foil_m}
            min={foil.min}
            max={foil.max}
            paso={foil.paso}
            formato={metros}
            onConfirmar={(valor) => onCambiar(conRemateFoil(borrador, valor))}
            testid="mando-remate-foil"
          />
        )}
        {borrador.remate.tipo !== "ninguno" && (
          <SeleccionColumna
            etiqueta="Color del remate"
            ayuda="Qué color de la pieza lleva el globo, el racimo o la figura de la punta."
            opciones={colorDelRemate.some((color) => color.valor === String(borrador.remate.material)) ? colorDelRemate : [...colorDelRemate, { valor: String(borrador.remate.material), etiqueta: "Un color que la pieza ya no tiene" }]}
            valor={String(borrador.remate.material)}
            onCambiar={(elegido) => onCambiar(conRemateColor(borrador, Number(elegido)))}
            testid="mando-remate-color"
          />
        )}
      </Apartado>

      <Apartado titulo="Globos" resumen={porcentaje.format(borrador.inflado.inflado)} testid="apartado-globos">
        <DeslizadorColumna
          etiqueta="Qué tan inflados"
          ayuda="Cuánto se infla cada globo respecto a lo normal: menos, quedan más chicos; más, más grandes."
          valor={valorEnRango(borrador.inflado.inflado, infladoDe("inflado", 0.05))}
          min={infladoDe("inflado", 0.05).min}
          max={infladoDe("inflado", 0.05).max}
          paso={0.05}
          formato={(valor) => porcentaje.format(valor)}
          textoValor={(valor) => `${porcentaje.format(valor)} del tamaño normal`}
          onConfirmar={(valor) => onCambiar(conInfladoCampo(borrador, "inflado", valor))}
          testid="mando-inflado"
        />
        <DeslizadorColumna
          etiqueta="Qué tan apretados van en la capa"
          ayuda="En 1 los globos de una capa se tocan; más arriba, se aprietan entre sí."
          valor={valorEnRango(borrador.inflado.tamano, infladoDe("tamano", 0.02))}
          min={infladoDe("tamano", 0.02).min}
          max={infladoDe("tamano", 0.02).max}
          paso={0.02}
          formato={(valor) => numero.format(valor)}
          onConfirmar={(valor) => onCambiar(conInfladoCampo(borrador, "tamano", valor))}
          testid="mando-tamano-relativo"
        />
        <DeslizadorColumna
          etiqueta="Separación entre capas"
          ayuda="Qué tan juntas quedan las capas: menos separación, más globos en el mismo alto."
          valor={valorEnRango(borrador.inflado.compresion, infladoDe("compresion", 0.02))}
          min={infladoDe("compresion", 0.02).min}
          max={infladoDe("compresion", 0.02).max}
          paso={0.02}
          formato={(valor) => numero.format(valor)}
          onConfirmar={(valor) => onCambiar(conInfladoCampo(borrador, "compresion", valor))}
          testid="mando-compresion"
        />
        <DeslizadorColumna
          etiqueta="Globos de distinto tamaño"
          ayuda="Cuánto varía el tamaño de un globo a otro, como en una columna hecha a mano."
          valor={valorEnRango(borrador.inflado.variacion_tam, infladoDe("variacion_tam", 0.01))}
          min={infladoDe("variacion_tam", 0.01).min}
          max={infladoDe("variacion_tam", 0.01).max}
          paso={0.01}
          formato={(valor) => porcentaje.format(valor)}
          onConfirmar={(valor) => onCambiar(conInfladoCampo(borrador, "variacion_tam", valor))}
          testid="mando-variacion-tamano"
        />
        <DeslizadorColumna
          etiqueta="Tonos que varían"
          ayuda="Cuánto cambia el tono de un globo al de al lado."
          valor={valorEnRango(borrador.inflado.variacion_tono, infladoDe("variacion_tono", 0.01))}
          min={infladoDe("variacion_tono", 0.01).min}
          max={infladoDe("variacion_tono", 0.01).max}
          paso={0.01}
          formato={(valor) => porcentaje.format(valor)}
          onConfirmar={(valor) => onCambiar(conInfladoCampo(borrador, "variacion_tono", valor))}
          testid="mando-variacion-tono"
        />
        <DeslizadorColumna
          etiqueta="Globos fuera de su lugar"
          ayuda="Cuánto se sale cada globo de su lugar."
          valor={valorEnRango(borrador.inflado.desorden, infladoDe("desorden", 0.01))}
          min={infladoDe("desorden", 0.01).min}
          max={infladoDe("desorden", 0.01).max}
          paso={0.01}
          formato={(valor) => porcentaje.format(valor)}
          onConfirmar={(valor) => onCambiar(conInfladoCampo(borrador, "desorden", valor))}
          testid="mando-desorden"
        />
        <button type="button" onClick={() => onCambiar(conOtraVariacion(borrador))} data-testid="otra-variacion" className="ui-button-secondary ui-pressable min-h-11 px-3.5 py-1.5 text-[13px]">
          Otra variación
        </button>
      </Apartado>
    </div>
  );
}
