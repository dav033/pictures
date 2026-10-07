"use client";

import type { ReactNode } from "react";
import { Minus, Plus } from "lucide-react";
import {
  AdornosGuirnaldaSchema,
  TamanosGuirnaldaSchema,
  VolumenGuirnaldaSchema,
  FormaGuirnaldaOrganicaSchema,
  type ArmadoGuirnaldaOrganicaV1,
} from "@/lib/plan/armado-guirnalda-organica";
import type { LimitesGuirnaldaOrganica, OpcionesArmadoGuirnaldaOrganica } from "@/lib/plan/opciones-armado-guirnalda-organica";
import { metrosCliente } from "@/lib/plan/presentacion-cliente";
import { DeslizadorArco, GrupoOpcionesArco, SeleccionArco } from "../arco/controles-arco";
import { colorDe, type ColorLeyenda } from "../patron/leyenda";
import { useVozCliente } from "../motor/voz-editor";
import {
  PASO_FRACCION,
  conAcabado,
  conAdorno,
  conColorAgregado,
  conColorQuitado,
  conForma,
  conMaterial,
  conMezclaDeColores,
  conPesoDeColor,
  conPesoDeTamano,
  conReparto,
  conRol,
  conTamanos,
  conVolumen,
  pesoDeTamano,
  rangoDeAltura,
  rangoDeColgado,
  rangoDeFestones,
  rangoDeGrosorCentro,
  rangoDeGrosorExtremos,
  rangoDeLargo,
  rangoDeOnda,
  rangoDePendiente,
  rangoDelContrato,
  valorEnRango,
  type RangoControl,
} from "./borrador-guirnalda-organica";

/**
 * Los ajustes del editor de guirnaldas del motor (ADR-0035, paso 3). Presentación pura: recibe el borrador, lo que
 * el motor admite (`opciones`) y los rangos vivos con este armado puesto (`limites`), y devuelve el siguiente borrador
 * con `onCambiar`. No cuenta, no mide y no dibuja nada: cada mando cambia UN campo del armado y el motor, al
 * dibujarlo, dice lo que eso provoca.
 *
 * Los apartados van plegados para no agrandar la tarjeta; el de los colores, que es lo que más se toca, abierto.
 * Los deslizadores aplican al soltar (un arrastre es una sola petición al motor) y miden al menos 44 px de alto.
 */

const porcentaje = new Intl.NumberFormat("es-CO", { style: "percent", maximumFractionDigits: 0 });
const decimal = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 2 });
const entero = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 });

const NOMBRES_ROL: Readonly<Record<string, string>> = { normal: "Normal", acento: "Acento (globos sueltos)" };

type Props = {
  borrador: ArmadoGuirnaldaOrganicaV1;
  opciones: OpcionesArmadoGuirnaldaOrganica;
  limites: LimitesGuirnaldaOrganica;
  leyenda: readonly ColorLeyenda[];
  onCambiar: (siguiente: ArmadoGuirnaldaOrganicaV1) => void;
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

function EnMetros({ etiqueta, ayuda, valor, rango, onConfirmar, testid }: { etiqueta: string; ayuda?: string; valor: number; rango: RangoControl; onConfirmar: (valor: number) => void; testid: string }) {
  return (
    <DeslizadorArco
      etiqueta={etiqueta}
      ayuda={ayuda}
      valor={valorEnRango(valor, rango)} valorReal={valor}
      min={rango.min}
      max={rango.max}
      paso={rango.paso}
      formato={metrosCliente}
      onConfirmar={onConfirmar}
      testid={testid}
    />
  );
}

function EnPorcentaje({ etiqueta, ayuda, valor, rango, onConfirmar, testid }: { etiqueta: string; ayuda?: string; valor: number; rango: RangoControl; onConfirmar: (valor: number) => void; testid: string }) {
  return (
    <DeslizadorArco
      etiqueta={etiqueta}
      ayuda={ayuda}
      valor={valorEnRango(valor, rango)} valorReal={valor}
      min={rango.min}
      max={rango.max}
      paso={rango.paso}
      formato={(v) => porcentaje.format(v)}
      onConfirmar={onConfirmar}
      testid={testid}
    />
  );
}

function EnCantidad({ etiqueta, ayuda, valor, rango, onConfirmar, testid, formato = (v) => entero.format(v) }: { etiqueta: string; ayuda?: string; valor: number; rango: RangoControl; onConfirmar: (valor: number) => void; testid: string; formato?: (valor: number) => string }) {
  return (
    <DeslizadorArco
      etiqueta={etiqueta}
      ayuda={ayuda}
      valor={valorEnRango(valor, rango)} valorReal={valor}
      min={rango.min}
      max={rango.max}
      paso={rango.paso}
      formato={formato}
      onConfirmar={onConfirmar}
      testid={testid}
    />
  );
}

/** Qué lado va más grueso: −1 izquierda, +1 derecha. Se dice con palabras, no con el número del motor. */
function ladoCargado(valor: number): string {
  if (Math.abs(valor) < 0.05) return "parejo";
  return `${valor < 0 ? "izquierda" : "derecha"} ${porcentaje.format(Math.abs(valor))}`;
}

export function ControlesGuirnaldaOrganica({ borrador, opciones, limites, leyenda, onCambiar }: Props) {
  // En la guiada no se muestran los mandos de decorador (papel del color, hasta dónde llega la banda).
  const cliente = useVozCliente();
  const rangoDe = {
    onda: rangoDeOnda(limites),
    ondas: rangoDelContrato(FormaGuirnaldaOrganicaSchema.shape.ondas, 1),
    carga: rangoDelContrato(FormaGuirnaldaOrganicaSchema.shape.carga, 0.25),
    irregularidad: rangoDelContrato(VolumenGuirnaldaSchema.shape.irregularidad, PASO_FRACCION),
    relleno: rangoDelContrato(VolumenGuirnaldaSchema.shape.relleno, PASO_FRACCION),
    racimo: rangoDelContrato(VolumenGuirnaldaSchema.shape.racimo, 1),
    salientes: rangoDelContrato(VolumenGuirnaldaSchema.shape.salientes, PASO_FRACCION),
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
  return (
    <div className="space-y-2" data-testid="controles-guirnalda-organica">
      <Apartado titulo="Forma" resumen={metrosCliente(borrador.forma.largoM)} testid="apartado-forma-guirnalda">
        <EnMetros etiqueta="Largo" ayuda="De un extremo al otro de la tira. Con una banda más gruesa hace falta más largo." valor={borrador.forma.largoM} rango={rangoDeLargo(limites)} onConfirmar={(v) => onCambiar(conForma(borrador, "largoM", v))} testid="largo-guirnalda" />
        <EnMetros etiqueta="Altura sobre el piso" ayuda="Dónde queda la línea guía en el extremo izquierdo." valor={borrador.forma.alturaM} rango={rangoDeAltura(limites)} onConfirmar={(v) => onCambiar(conForma(borrador, "alturaM", v))} testid="altura-guirnalda" />
        <EnMetros etiqueta="Pendiente" ayuda="Cuánto sube (+) o baja (−) el extremo derecho respecto al izquierdo." valor={borrador.forma.pendienteM} rango={rangoDePendiente(limites)} onConfirmar={(v) => onCambiar(conForma(borrador, "pendienteM", v))} testid="pendiente-guirnalda" />
        <EnMetros etiqueta="Ondulación" ayuda="Qué tanto sube y baja la tira a lo largo." valor={borrador.forma.ondaM} rango={rangoDe.onda} onConfirmar={(v) => onCambiar(conForma(borrador, "ondaM", v))} testid="onda-guirnalda" />
        <EnCantidad etiqueta="Ondas" ayuda="Cuántas ondas hay a lo largo de la tira." valor={borrador.forma.ondas} rango={rangoDe.ondas} onConfirmar={(v) => onCambiar(conForma(borrador, "ondas", v))} testid="ondas-guirnalda" />
        <EnMetros etiqueta="Colgado" ayuda="Cuánto cuelga la tira entre los puntos de sujeción; 0 es tensa." valor={borrador.forma.colgadoM} rango={rangoDeColgado(limites)} onConfirmar={(v) => onCambiar(conForma(borrador, "colgadoM", v))} testid="colgado-guirnalda" />
        <EnCantidad etiqueta="Cuántas caídas" ayuda="Cada caída es una U que cuelga entre dos puntos de sujeción." valor={borrador.forma.festones} rango={rangoDeFestones(limites)} onConfirmar={(v) => onCambiar(conForma(borrador, "festones", v))} testid="festones-guirnalda" />
        <EnCantidad etiqueta="Qué lado va más grueso" ayuda="Ese lado queda más grueso y lleva los globos más grandes." valor={borrador.forma.carga} rango={rangoDe.carga} formato={ladoCargado} onConfirmar={(v) => onCambiar(conForma(borrador, "carga", v))} testid="carga-guirnalda" />
      </Apartado>

      <Apartado titulo="Volumen" resumen={`${metrosCliente(borrador.volumen.grosorPatasM)} a ${metrosCliente(borrador.volumen.grosorCimaM)}`} testid="apartado-volumen-guirnalda">
        <EnMetros etiqueta="Grosor en los extremos" ayuda="Qué tan ancha queda la tira en las puntas, donde arranca y termina." valor={borrador.volumen.grosorPatasM} rango={rangoDeGrosorExtremos(limites)} onConfirmar={(v) => onCambiar(conVolumen(borrador, "grosorPatasM", v))} testid="grosor-extremos-guirnalda" />
        <EnMetros etiqueta="Grosor en el centro" ayuda="Qué tan ancha queda la tira en el medio: ahí es donde más se nota el volumen." valor={borrador.volumen.grosorCimaM} rango={rangoDeGrosorCentro(limites)} onConfirmar={(v) => onCambiar(conVolumen(borrador, "grosorCimaM", v))} testid="grosor-centro-guirnalda" />
        <EnPorcentaje etiqueta="Relleno" ayuda="Qué tan llena va la banda de globos." valor={borrador.volumen.relleno} rango={rangoDe.relleno} onConfirmar={(v) => onCambiar(conVolumen(borrador, "relleno", v))} testid="relleno-guirnalda" />
        <EnPorcentaje etiqueta="Qué tan desparejo queda el borde" ayuda="En 0 el borde queda liso; subiéndolo, los globos entran y salen como en una pieza hecha a mano." valor={borrador.volumen.irregularidad} rango={rangoDe.irregularidad} onConfirmar={(v) => onCambiar(conVolumen(borrador, "irregularidad", v))} testid="irregularidad-guirnalda" />
        <EnCantidad etiqueta="Globos por racimo" ayuda="Cuántos globos se atan juntos en cada racimo; con más, la tira se ve más tupida." valor={borrador.volumen.racimo} rango={rangoDe.racimo} onConfirmar={(v) => onCambiar(conVolumen(borrador, "racimo", v))} testid="racimo-guirnalda" />
        <EnPorcentaje etiqueta="Globos que asoman del borde" ayuda="Cuántos globos sobresalen del bulto para que el borde no quede recto." valor={borrador.volumen.salientes} rango={rangoDe.salientes} onConfirmar={(v) => onCambiar(conVolumen(borrador, "salientes", v))} testid="salientes-guirnalda" />
      </Apartado>

      <Apartado titulo="Tamaños de globo" testid="apartado-tamanos-guirnalda">
        <p className="text-xs leading-relaxed text-texto-suave">Cuánto pesa cada tamaño en la mezcla (0 lo quita). Un tamaño que no cabe en el grosor lo quita el motor y te lo dice.</p>
        {opciones.tamanos.map((pulgadas) => (
          <EnCantidad key={pulgadas} etiqueta={`Globos de ${pulgadas}″`} valor={pesoDeTamano(borrador, pulgadas)} rango={rangoDe.peso} formato={(v) => (v === 0 ? "no lleva" : entero.format(v))} onConfirmar={(v) => onCambiar(conPesoDeTamano(borrador, pulgadas, v))} testid={`peso-tamano-${pulgadas}-guirnalda`} />
        ))}
        <EnPorcentaje etiqueta="Dónde van los globos grandes" ayuda="En 0 van repartidos por toda la tira; subiéndolo, se bajan al borde de abajo." valor={borrador.tamanos.grandesAbajo} rango={rangoDe.grandesAbajo} onConfirmar={(v) => onCambiar(conTamanos(borrador, "grandesAbajo", v))} testid="grandes-abajo-guirnalda" />
        <EnPorcentaje etiqueta="Qué tan inflados" ayuda="Qué tan inflado va cada globo respecto a su tamaño." valor={borrador.tamanos.inflado} rango={rangoDe.inflado} onConfirmar={(v) => onCambiar(conTamanos(borrador, "inflado", v))} testid="inflado-guirnalda" />
        <EnPorcentaje etiqueta="Globos de distinto tamaño" ayuda="Cuánto cambia el tamaño de un globo al de al lado, como cuando se infla a mano." valor={borrador.tamanos.variacion} rango={rangoDe.variacion} onConfirmar={(v) => onCambiar(conTamanos(borrador, "variacion", v))} testid="variacion-guirnalda" />
      </Apartado>

      <Apartado titulo="Colores" resumen={`${paleta.length} ${paleta.length === 1 ? "color" : "colores"}`} abierto testid="apartado-colores-guirnalda">
        {paleta.map((entrada, posicion) => {
          const numero = posicion + 1;
          const color = colorDe(leyenda, entrada.material);
          return (
            <fieldset key={posicion} data-testid={`color-guirnalda-${numero}`} className="space-y-2 rounded-xl bg-superficie-suave p-2.5 ring-1 ring-borde-suave ring-inset">
              <legend className="flex items-center gap-2 px-1 text-xs font-semibold text-texto">
                <span aria-hidden="true" className="inline-block size-3.5 rounded-full ring-1 ring-borde" style={{ background: color.hex }} />
                {`Color ${numero}`}
              </legend>
              <SeleccionArco etiqueta={`Color ${numero}`} ayuda="Qué color de la pieza va en este lugar de la mezcla." opciones={opcionesDeColor} valor={String(entrada.material)} onCambiar={(v) => onCambiar(conMaterial(borrador, posicion, Number(v)))} testid={`material-guirnalda-${numero}`} />
              <EnCantidad etiqueta={`Cuánto pesa el color ${numero}`} ayuda="Cuántos globos de este color hay frente a los demás: más peso, más se ve." valor={entrada.peso} rango={rangoDe.pesoDeColor} onConfirmar={(v) => onCambiar(conPesoDeColor(borrador, posicion, v))} testid={`peso-guirnalda-${numero}`} />
              <div className="grid gap-2 @sm:grid-cols-2">
                <SeleccionArco etiqueta={`Acabado del color ${numero}`} ayuda="Cambia el aspecto del globo (brillo, confeti, transparencia), no su color." opciones={opciones.acabados.map((acabado) => ({ valor: acabado.valor, etiqueta: acabado.texto }))} valor={entrada.acabado} onCambiar={(v) => { const hallado = opciones.acabados.find((acabado) => acabado.valor === v); if (hallado) onCambiar(conAcabado(borrador, posicion, hallado.valor)); }} testid={`acabado-guirnalda-${numero}`} />
                {!cliente && <SeleccionArco etiqueta={`Papel del color ${numero}`} ayuda="Normal va dentro de los racimos; acento son globos sueltos que asoman por fuera." opciones={opciones.roles.map((rol) => ({ valor: rol, etiqueta: NOMBRES_ROL[rol] ?? rol }))} valor={entrada.rol} onCambiar={(v) => { const hallado = opciones.roles.find((rol) => rol === v); if (hallado) onCambiar(conRol(borrador, posicion, hallado)); }} testid={`rol-guirnalda-${numero}`} />}
              </div>
              <button
                type="button"
                onClick={() => onCambiar(conColorQuitado(borrador, posicion))}
                disabled={paleta.length <= 1}
                aria-label={`Quitar el color ${numero} de la paleta`}
                data-testid={`quitar-color-guirnalda-${numero}`}
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
          data-testid="agregar-color-guirnalda"
          className="ui-button-secondary ui-pressable min-h-11 px-3.5 text-[13px] disabled:opacity-50"
        >
          <Plus className="size-3.5" aria-hidden="true" />Agregar un color de la pieza
        </button>
        <GrupoOpcionesArco
          etiqueta="Cómo se reparten los colores"
          ayuda={opciones.repartos.find((reparto) => reparto.valor === borrador.colores.reparto)?.ayuda}
          opciones={opciones.repartos.map((reparto) => ({ valor: reparto.valor, etiqueta: reparto.texto }))}
          valor={borrador.colores.reparto}
          onCambiar={(v) => { const hallado = opciones.repartos.find((reparto) => reparto.valor === v); if (hallado) onCambiar(conReparto(borrador, hallado.valor)); }}
          testid="reparto-guirnalda"
        />
        <EnPorcentaje etiqueta="Mezcla entre colores" ayuda="Qué tan difuminado queda el paso de un color al otro." valor={borrador.colores.mezcla} rango={rangoDe.mezcla} onConfirmar={(v) => onCambiar(conMezclaDeColores(borrador, v))} testid="mezcla-colores-guirnalda" />
      </Apartado>

      <Apartado titulo="Adornos" testid="apartado-adornos-guirnalda">
        <p className="text-xs leading-relaxed text-texto-suave">Ramas de follaje y flores por metro de tira. No son globos: se listan, no se compran en esta cotización.</p>
        <EnCantidad etiqueta="Follaje" ayuda="Cuántas ramas verdes se meten entre los globos por cada metro de tira." valor={borrador.adornos.follaje} rango={rangoDe.adorno} formato={(v) => `${decimal.format(v)} por metro`} onConfirmar={(v) => onCambiar(conAdorno(borrador, "follaje", v))} testid="follaje-guirnalda" />
        <EnCantidad etiqueta="Flores" ayuda="Cuántas flores se meten entre los globos por cada metro de tira." valor={borrador.adornos.flores} rango={rangoDe.adorno} formato={(v) => `${decimal.format(v)} por metro`} onConfirmar={(v) => onCambiar(conAdorno(borrador, "flores", v))} testid="flores-guirnalda" />
      </Apartado>
    </div>
  );
}
