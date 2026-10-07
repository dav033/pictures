"use client";

import type { ReactNode } from "react";
import { Dices, Minus, Plus } from "lucide-react";
import { AdornosGuirnaldaSchema, TamanosGuirnaldaSchema } from "@/lib/plan/armado-guirnalda-organica";
import { FormaColumnaOrganicaSchema, VolumenColumnaOrganicaSchema, type ArmadoColumnaOrganicaV1 } from "@/lib/plan/armado-columna-organica";
import type { LimitesColumnaOrganica, OpcionesArmadoColumnaOrganica } from "@/lib/plan/opciones-armado-columna-organica";
import { metrosCliente } from "@/lib/plan/presentacion-cliente";
import { DeslizadorColumna, GrupoOpcionesColumna, InterruptorColumna, SeleccionColumna } from "../columna/controles-columna";
import { colorDe, type ColorLeyenda } from "../patron/leyenda";
import { useVozCliente } from "../motor/voz-editor";
import {
  PASO_FRACCION,
  conAcabado,
  conAdorno,
  conColorAgregado,
  conColorQuitado,
  conEstilo,
  conForma,
  conFormaLista,
  conGloboGrande,
  conInterruptorDeForma,
  conMaterial,
  conMaterialDeGloboGrande,
  conMezclaDeColores,
  conPesoDeColor,
  conPesoDeTamano,
  conReparto,
  conRol,
  conSemilla,
  conTamanoDeGloboGrande,
  conTamanos,
  conVolumen,
  pesoDeTamano,
  rangoDeAlto,
  rangoDeGrosorBase,
  rangoDeGrosorPunta,
  rangoDeInclinacion,
  rangoDeSerpenteo,
  rangoDelContrato,
  valorEnRango,
  type RangoControl,
} from "./borrador-columna-organica";

/**
 * Los ajustes del editor de columnas orgánicas del motor (ADR-0035, paso 3). Presentación pura: recibe el borrador, lo
 * que el motor admite (`opciones`) y los rangos vivos con este armado puesto (`limites`), y devuelve el siguiente
 * borrador con `onCambiar`. No cuenta, no mide y no dibuja nada: cada mando cambia UN campo del armado y el motor, al
 * dibujarlo, dice lo que eso provoca.
 *
 * **El globo grande de la punta** va arriba del todo, fuera de los apartados: poner o quitarlo es lo primero que se
 * toca en una columna. Con él puesto se elige su tamaño (solo los que guardan proporción con la punta, que dice el
 * motor) y su color.
 *
 * Los apartados van plegados para no agrandar la tarjeta; el de los colores, que es lo que más se toca, abierto.
 * Los deslizadores aplican al soltar (un arrastre es una sola petición al motor) y miden al menos 44 px de alto.
 */

const porcentaje = new Intl.NumberFormat("es-CO", { style: "percent", maximumFractionDigits: 0 });
const decimal = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 2 });
const entero = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 });

const NOMBRES_ROL: Readonly<Record<string, string>> = { normal: "Normal", acento: "Acento (globos sueltos)" };

type Props = {
  borrador: ArmadoColumnaOrganicaV1;
  opciones: OpcionesArmadoColumnaOrganica;
  limites: LimitesColumnaOrganica;
  leyenda: readonly ColorLeyenda[];
  onCambiar: (siguiente: ArmadoColumnaOrganicaV1) => void;
};

function Apartado({ titulo, resumen, abierto = false, testid, children }: { titulo: string; resumen?: string; abierto?: boolean; testid: string; children: ReactNode }) {
  return (
    <details open={abierto} data-testid={testid} className="group rounded-xl bg-superficie ring-1 ring-borde-suave ring-inset">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 text-[13px] font-semibold text-texto focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acento">
        <span>{titulo}</span>
        {resumen && <span className="min-w-0 truncate text-xs font-normal text-texto-suave">{resumen}</span>}
      </summary>
      <div className="space-y-3 border-t border-borde-suave px-3 py-3">{children}</div>
    </details>
  );
}

type Medida = { etiqueta: string; ayuda?: string; valor: number; rango: RangoControl; onConfirmar: (valor: number) => void; testid: string };

function EnMetros({ etiqueta, ayuda, valor, rango, onConfirmar, testid }: Medida) {
  return <DeslizadorColumna etiqueta={etiqueta} ayuda={ayuda} valor={valorEnRango(valor, rango)} valorReal={valor} min={rango.min} max={rango.max} paso={rango.paso} formato={metrosCliente} onConfirmar={onConfirmar} testid={testid} />;
}

function EnPorcentaje({ etiqueta, ayuda, valor, rango, onConfirmar, testid }: Medida) {
  return <DeslizadorColumna etiqueta={etiqueta} ayuda={ayuda} valor={valorEnRango(valor, rango)} valorReal={valor} min={rango.min} max={rango.max} paso={rango.paso} formato={(v) => porcentaje.format(v)} onConfirmar={onConfirmar} testid={testid} />;
}

function EnCantidad({ etiqueta, ayuda, valor, rango, onConfirmar, testid, formato = (v) => entero.format(v) }: Medida & { formato?: (valor: number) => string }) {
  return <DeslizadorColumna etiqueta={etiqueta} ayuda={ayuda} valor={valorEnRango(valor, rango)} valorReal={valor} min={rango.min} max={rango.max} paso={rango.paso} formato={formato} onConfirmar={onConfirmar} testid={testid} />;
}

/** Hacia dónde se corre la punta, con palabras y no con el número del motor. */
function ladoInclinado(valor: number): string {
  if (Math.abs(valor) < 0.025) return "recta";
  return `${metrosCliente(Math.abs(valor))} a la ${valor < 0 ? "izquierda" : "derecha"}`;
}

const AYUDA_SIN_GLOBO_GRANDE = "Ningún globo guarda proporción con una punta tan gruesa: adelgázala para poder poner un globo grande arriba.";

export function ControlesColumnaOrganica({ borrador, opciones, limites, leyenda, onCambiar }: Props) {
  // En la guiada no se muestran los mandos de decorador (papel del color, hasta dónde llega la banda).
  const cliente = useVozCliente();
  const rangoDe = {
    ondulacion: rangoDelContrato(FormaColumnaOrganicaSchema.shape.ondulacion, PASO_FRACCION),
    irregularidad: rangoDelContrato(VolumenColumnaOrganicaSchema.shape.irregularidad, PASO_FRACCION),
    relleno: rangoDelContrato(VolumenColumnaOrganicaSchema.shape.relleno, PASO_FRACCION),
    racimo: rangoDelContrato(VolumenColumnaOrganicaSchema.shape.racimo, 1),
    salientes: rangoDelContrato(VolumenColumnaOrganicaSchema.shape.salientes, PASO_FRACCION),
    grandesAbajo: rangoDelContrato(TamanosGuirnaldaSchema.shape.grandesAbajo, PASO_FRACCION),
    inflado: rangoDelContrato(TamanosGuirnaldaSchema.shape.inflado, PASO_FRACCION),
    variacion: rangoDelContrato(TamanosGuirnaldaSchema.shape.variacion, 0.05),
    adorno: rangoDelContrato(AdornosGuirnaldaSchema.shape.follaje, 0.1),
    mezcla: { min: 0, max: 1, paso: PASO_FRACCION } satisfies RangoControl,
    peso: { min: 0, max: 100, paso: 5 } satisfies RangoControl,
    pesoDeColor: { min: 1, max: 100, paso: 1 } satisfies RangoControl,
  };
  const paleta = borrador.colores.paleta;
  const coloresDePieza = leyenda.length;
  const opcionesDeColor = Array.from({ length: coloresDePieza }, (_, indice) => ({ valor: String(indice), etiqueta: colorDe(leyenda, indice).etiqueta }));
  const puedeAgregar = paleta.length < opciones.max_materiales && new Set(paleta.map((entrada) => entrada.material)).size < coloresDePieza;
  const { corona } = borrador;
  const sinGloboGrande = limites.coronaTamanos.length === 0;
  return (
    <div className="space-y-2" data-testid="controles-columna-organica">
      <div className="space-y-1 rounded-xl bg-superficie px-3 py-1 ring-1 ring-borde-suave ring-inset">
        <InterruptorColumna
          etiqueta="Globo grande arriba"
          ayuda={corona.activa ? "Quita el globo grande de la punta y la columna termina en sus globos." : sinGloboGrande ? AYUDA_SIN_GLOBO_GRANDE : "Pon un globo grande en la punta de la columna."}
          activo={corona.activa}
          onCambiar={(activo) => onCambiar(conGloboGrande(borrador, activo, limites.coronaTamanos))}
          testid="mando-globo-grande-organica"
        />
        {corona.activa && (
          <div className="grid gap-2 pb-2 @sm:grid-cols-2">
            <SeleccionColumna
              etiqueta="Tamaño del globo grande"
              ayuda="Solo se ofrecen los tamaños que guardan proporción con la punta de esta columna."
              opciones={limites.coronaTamanos.map((pulgadas) => ({ valor: String(pulgadas), etiqueta: `${pulgadas}″` }))}
              valor={String(corona.tamano)}
              onCambiar={(v) => onCambiar(conTamanoDeGloboGrande(borrador, Number(v)))}
              testid="tamano-globo-grande-organica"
            />
            <SeleccionColumna
              etiqueta="Color del globo grande"
              ayuda="Qué color de la pieza lleva el globo de arriba."
              opciones={opcionesDeColor}
              valor={String(corona.material)}
              onCambiar={(v) => onCambiar(conMaterialDeGloboGrande(borrador, Number(v)))}
              testid="color-globo-grande-organica"
            />
          </div>
        )}
      </div>

      <Apartado titulo="Forma" resumen={metrosCliente(borrador.forma.altoM)} testid="apartado-forma-columna-organica">
        <SeleccionColumna
          etiqueta="Empezar desde una forma lista"
          ayuda="Cambia la silueta, el volumen y los tamaños de una vez; no toca tus colores ni el globo grande de arriba. Después puedes ajustar cada cosa."
          opciones={[{ valor: "", etiqueta: "Elige una forma…" }, ...opciones.formas.map((lista) => ({ valor: lista.id, etiqueta: lista.nombre }))]}
          valor=""
          onCambiar={(v) => { const hallada = opciones.formas.find((lista) => lista.id === v); if (hallada) onCambiar(conFormaLista(borrador, hallada)); }}
          testid="forma-lista-columna-organica"
        />
        <EnMetros etiqueta="Alto" ayuda="De la base a la punta. Con un cuerpo más grueso hace falta más alto." valor={borrador.forma.altoM} rango={rangoDeAlto(limites)} onConfirmar={(v) => onCambiar(conForma(borrador, "altoM", v))} testid="alto-columna-organica" />
        <EnCantidad etiqueta="Inclinación" ayuda="Hacia dónde se corre la punta respecto a la base." valor={borrador.forma.inclinacionM} rango={rangoDeInclinacion(limites)} formato={ladoInclinado} onConfirmar={(v) => onCambiar(conForma(borrador, "inclinacionM", v))} testid="inclinacion-columna-organica" />
        <EnMetros etiqueta="Curva en S" ayuda="Cuánto se va la columna a un lado y al otro, como una S." valor={borrador.forma.serpenteoM} rango={rangoDeSerpenteo(limites)} onConfirmar={(v) => onCambiar(conForma(borrador, "serpenteoM", v))} testid="serpenteo-columna-organica" />
        <EnPorcentaje etiqueta="Ondulación" ayuda="Cuánto tiembla la línea: 0 es recta." valor={borrador.forma.ondulacion} rango={rangoDe.ondulacion} onConfirmar={(v) => onCambiar(conForma(borrador, "ondulacion", v))} testid="ondulacion-columna-organica" />
        <InterruptorColumna etiqueta="Persona de escala" ayuda="Dibuja una persona de 1,70 m al lado para ver el tamaño. No cambia los globos." activo={borrador.forma.persona} onCambiar={(activo) => onCambiar(conInterruptorDeForma(borrador, "persona", activo))} testid="persona-columna-organica" />
        <InterruptorColumna etiqueta="Suelo" ayuda="Dibuja la línea del piso. No cambia los globos." activo={borrador.forma.suelo} onCambiar={(activo) => onCambiar(conInterruptorDeForma(borrador, "suelo", activo))} testid="suelo-columna-organica" />
      </Apartado>

      <Apartado titulo="Volumen" resumen={`${metrosCliente(borrador.volumen.grosorPatasM)} a ${metrosCliente(borrador.volumen.grosorCimaM)}`} testid="apartado-volumen-columna-organica">
        <SeleccionColumna
          etiqueta="Cuánto se llena"
          ayuda="Un estilo listo cambia el grosor, el relleno y los racimos; el de «gigantes» añade globos de 24″ y 36″ en la base."
          opciones={[{ valor: "", etiqueta: "Elige un estilo…" }, ...opciones.estilos.map((estilo) => ({ valor: estilo.id, etiqueta: estilo.nombre }))]}
          valor=""
          onCambiar={(v) => { const hallado = opciones.estilos.find((estilo) => estilo.id === v); if (hallado) onCambiar(conEstilo(borrador, hallado)); }}
          testid="estilo-columna-organica"
        />
        <EnMetros etiqueta="Grosor en la base" ayuda="Qué tan ancha queda la columna al pie, donde se apoya." valor={borrador.volumen.grosorPatasM} rango={rangoDeGrosorBase(limites)} onConfirmar={(v) => onCambiar(conVolumen(borrador, "grosorPatasM", v))} testid="grosor-base-columna-organica" />
        <EnMetros etiqueta="Grosor en la punta" ayuda="Qué tan ancha queda arriba: más delgada, más se afina hacia el final." valor={borrador.volumen.grosorCimaM} rango={rangoDeGrosorPunta(limites)} onConfirmar={(v) => onCambiar(conVolumen(borrador, "grosorCimaM", v))} testid="grosor-punta-columna-organica" />
        <EnPorcentaje etiqueta="Relleno" ayuda="Qué tan llena va la columna de globos." valor={borrador.volumen.relleno} rango={rangoDe.relleno} onConfirmar={(v) => onCambiar(conVolumen(borrador, "relleno", v))} testid="relleno-columna-organica" />
        <EnPorcentaje etiqueta="Qué tan desparejo queda el borde" ayuda="En 0 el borde queda liso; subiéndolo, los globos entran y salen como en una pieza hecha a mano." valor={borrador.volumen.irregularidad} rango={rangoDe.irregularidad} onConfirmar={(v) => onCambiar(conVolumen(borrador, "irregularidad", v))} testid="irregularidad-columna-organica" />
        <EnCantidad etiqueta="Globos por racimo" ayuda="Cuántos globos se atan juntos en cada racimo; con más, el bulto se ve más tupido." valor={borrador.volumen.racimo} rango={rangoDe.racimo} onConfirmar={(v) => onCambiar(conVolumen(borrador, "racimo", v))} testid="racimo-columna-organica" />
        <EnPorcentaje etiqueta="Globos que asoman del borde" ayuda="Cuántos globos sobresalen del bulto para que el borde no quede recto." valor={borrador.volumen.salientes} rango={rangoDe.salientes} onConfirmar={(v) => onCambiar(conVolumen(borrador, "salientes", v))} testid="salientes-columna-organica" />
      </Apartado>

      <Apartado titulo="Tamaños de globo" testid="apartado-tamanos-columna-organica">
        <p className="text-xs leading-relaxed text-texto-suave">Cuánto pesa cada tamaño en la mezcla (0 lo quita). Un tamaño que no cabe en el grosor lo quita el motor y te lo dice.</p>
        {opciones.tamanos.map((pulgadas) => (
          <EnCantidad key={pulgadas} etiqueta={`Globos de ${pulgadas}″`} valor={pesoDeTamano(borrador, pulgadas)} rango={rangoDe.peso} formato={(v) => (v === 0 ? "no lleva" : entero.format(v))} onConfirmar={(v) => onCambiar(conPesoDeTamano(borrador, pulgadas, v))} testid={`peso-tamano-${pulgadas}-columna-organica`} />
        ))}
        <EnPorcentaje etiqueta="Dónde van los globos grandes" ayuda="En 0 van repartidos por toda la columna; subiéndolo, se bajan a la base." valor={borrador.tamanos.grandesAbajo} rango={rangoDe.grandesAbajo} onConfirmar={(v) => onCambiar(conTamanos(borrador, "grandesAbajo", v))} testid="grandes-abajo-columna-organica" />
        <EnPorcentaje etiqueta="Qué tan inflados" ayuda="Qué tan inflado va cada globo respecto a su tamaño." valor={borrador.tamanos.inflado} rango={rangoDe.inflado} onConfirmar={(v) => onCambiar(conTamanos(borrador, "inflado", v))} testid="inflado-columna-organica" />
        <EnPorcentaje etiqueta="Globos de distinto tamaño" ayuda="Cuánto cambia el tamaño de un globo al de al lado, como cuando se infla a mano." valor={borrador.tamanos.variacion} rango={rangoDe.variacion} onConfirmar={(v) => onCambiar(conTamanos(borrador, "variacion", v))} testid="variacion-columna-organica" />
      </Apartado>

      <Apartado titulo="Colores" resumen={`${paleta.length} ${paleta.length === 1 ? "color" : "colores"}`} abierto testid="apartado-colores-columna-organica">
        {paleta.map((entrada, posicion) => {
          const numero = posicion + 1;
          const color = colorDe(leyenda, entrada.material);
          return (
            <fieldset key={posicion} data-testid={`color-columna-organica-${numero}`} className="space-y-2 rounded-xl bg-superficie-suave p-2.5 ring-1 ring-borde-suave ring-inset">
              <legend className="flex items-center gap-2 px-1 text-xs font-semibold text-texto">
                <span aria-hidden="true" className="inline-block size-3.5 rounded-full ring-1 ring-borde" style={{ background: color.hex }} />
                {`Color ${numero}`}
              </legend>
              <SeleccionColumna etiqueta={`Color ${numero}`} ayuda="Qué color de la pieza va en este lugar de la mezcla." opciones={opcionesDeColor} valor={String(entrada.material)} onCambiar={(v) => onCambiar(conMaterial(borrador, posicion, Number(v)))} testid={`material-columna-organica-${numero}`} />
              <EnCantidad etiqueta={`Cuánto pesa el color ${numero}`} ayuda="Cuántos globos de este color hay frente a los demás: más peso, más se ve." valor={entrada.peso} rango={rangoDe.pesoDeColor} onConfirmar={(v) => onCambiar(conPesoDeColor(borrador, posicion, v))} testid={`peso-columna-organica-${numero}`} />
              <div className="grid gap-2 @sm:grid-cols-2">
                <SeleccionColumna etiqueta={`Acabado del color ${numero}`} ayuda="Cambia el aspecto del globo (brillo, confeti, transparencia), no su color." opciones={opciones.acabados.map((acabado) => ({ valor: acabado.valor, etiqueta: acabado.texto }))} valor={entrada.acabado} onCambiar={(v) => { const hallado = opciones.acabados.find((acabado) => acabado.valor === v); if (hallado) onCambiar(conAcabado(borrador, posicion, hallado.valor)); }} testid={`acabado-columna-organica-${numero}`} />
                {!cliente && <SeleccionColumna etiqueta={`Papel del color ${numero}`} ayuda="Normal va dentro de los racimos; acento son globos sueltos que asoman por fuera." opciones={opciones.roles.map((rol) => ({ valor: rol, etiqueta: NOMBRES_ROL[rol] ?? rol }))} valor={entrada.rol} onCambiar={(v) => { const hallado = opciones.roles.find((rol) => rol === v); if (hallado) onCambiar(conRol(borrador, posicion, hallado)); }} testid={`rol-columna-organica-${numero}`} />}
              </div>
              <button
                type="button"
                onClick={() => onCambiar(conColorQuitado(borrador, posicion))}
                disabled={paleta.length <= 1}
                aria-label={`Quitar el color ${numero} de la paleta`}
                data-testid={`quitar-color-columna-organica-${numero}`}
                className="ui-button-secondary ui-pressable min-h-11 px-3 text-xs disabled:opacity-50"
              >
                <Minus className="size-3.5" aria-hidden="true" />Quitar de la paleta
              </button>
            </fieldset>
          );
        })}
        <button
          type="button"
          onClick={() => onCambiar(conColorAgregado(borrador, coloresDePieza, opciones.max_materiales))}
          disabled={!puedeAgregar}
          data-testid="agregar-color-columna-organica"
          className="ui-button-secondary ui-pressable min-h-11 px-3.5 text-[13px] disabled:opacity-50"
        >
          <Plus className="size-3.5" aria-hidden="true" />Agregar un color de la pieza
        </button>
        <GrupoOpcionesColumna
          etiqueta="Cómo se reparten los colores"
          ayuda={opciones.repartos.find((reparto) => reparto.valor === borrador.colores.reparto)?.ayuda}
          opciones={opciones.repartos.map((reparto) => ({ valor: reparto.valor, etiqueta: reparto.texto }))}
          valor={borrador.colores.reparto}
          onCambiar={(v) => { const hallado = opciones.repartos.find((reparto) => reparto.valor === v); if (hallado) onCambiar(conReparto(borrador, hallado.valor)); }}
          testid="reparto-columna-organica"
        />
        <EnPorcentaje etiqueta="Mezcla entre colores" ayuda="Qué tan difuminado queda el paso de un color al otro." valor={borrador.colores.mezcla} rango={rangoDe.mezcla} onConfirmar={(v) => onCambiar(conMezclaDeColores(borrador, v))} testid="mezcla-colores-columna-organica" />
      </Apartado>

      <Apartado titulo="Adornos y disposición" testid="apartado-adornos-columna-organica">
        <p className="text-xs leading-relaxed text-texto-suave">Ramas de follaje y flores por metro de columna. No son globos: se listan, no se compran en esta cotización.</p>
        <EnCantidad etiqueta="Follaje" ayuda="Cuántas ramas verdes se meten entre los globos por cada metro de columna." valor={borrador.adornos.follaje} rango={rangoDe.adorno} formato={(v) => `${decimal.format(v)} por metro`} onConfirmar={(v) => onCambiar(conAdorno(borrador, "follaje", v))} testid="follaje-columna-organica" />
        <EnCantidad etiqueta="Flores" ayuda="Cuántas flores se meten entre los globos por cada metro de columna." valor={borrador.adornos.flores} rango={rangoDe.adorno} formato={(v) => `${decimal.format(v)} por metro`} onConfirmar={(v) => onCambiar(conAdorno(borrador, "flores", v))} testid="flores-columna-organica" />
        <button
          type="button"
          onClick={() => onCambiar(conSemilla(borrador, 1 + Math.floor(Math.random() * 99999)))}
          data-testid="otra-disposicion-columna-organica"
          className="ui-button-secondary ui-pressable min-h-11 px-3.5 text-[13px]"
        >
          <Dices className="size-3.5" aria-hidden="true" />Probar otra disposición de los globos
        </button>
      </Apartado>
    </div>
  );
}
