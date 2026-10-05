"use client";

import type { ReactNode } from "react";
import { Dices, Minus, Plus } from "lucide-react";
import { AdornosGuirnaldaSchema, TamanosGuirnaldaSchema } from "@/lib/plan/armado-guirnalda-organica";
import { FormaArcoOrganicoSchema, VolumenArcoOrganicoSchema, type ArmadoArcoOrganicoV1 } from "@/lib/plan/armado-arco-organico";
import type { LimitesArcoOrganico, OpcionesArmadoArcoOrganico } from "@/lib/plan/opciones-armado-arco-organico";
import { metrosCliente } from "@/lib/plan/presentacion-cliente";
import { DeslizadorArco, GrupoOpcionesArco, InterruptorArco, SeleccionArco } from "../arco/controles-arco";
import { colorDe, type ColorLeyenda } from "../patron/leyenda";
import {
  PASO_FRACCION,
  conAcabado,
  conAdorno,
  conColorAgregado,
  conColorQuitado,
  conEstilo,
  conForma,
  conFormaLista,
  conInterruptorDeForma,
  conMaterial,
  conMezclaDeColores,
  conPesoDeColor,
  conPesoDeTamano,
  conReparto,
  conRol,
  conSemilla,
  conTamanos,
  conVolumen,
  pesoDeTamano,
  rangoDeAlto,
  rangoDeAncho,
  rangoDeGrosorCima,
  rangoDeGrosorPatas,
  rangoDelContrato,
  valorEnRango,
  type RangoControl,
} from "./borrador-arco-organico";

/**
 * Los ajustes del editor de arcos orgánicos del motor (ADR-0035). Presentación pura: recibe el borrador, lo que el
 * motor admite (`opciones`) y los rangos vivos con este armado puesto (`limites`), y devuelve el siguiente borrador
 * con `onCambiar`. No cuenta, no mide y no dibuja nada: cada mando cambia UN campo del armado y el motor, al
 * dibujarlo, dice lo que eso provoca.
 *
 * **El medio arco** va arriba del todo, fuera de los apartados: decidir si la banda baja por las dos patas o
 * termina en el aire es lo primero que se toca, y es lo que distingue a un arco de un medio arco (la taxonomía
 * retiró `semiarco` justamente porque todo medio arco es este armado con `forma.corte` menor que 1). Con el medio
 * arco puesto aparece por qué lado sube.
 *
 * Los apartados van plegados para no agrandar la tarjeta; el de los colores, que es lo que más se toca, abierto.
 * Los deslizadores aplican al soltar (un arrastre es una sola petición al motor) y miden al menos 44 px de alto.
 */

const porcentaje = new Intl.NumberFormat("es-CO", { style: "percent", maximumFractionDigits: 0 });
const decimal = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 2 });
const entero = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 });

const NOMBRES_ROL: Readonly<Record<string, string>> = { normal: "Normal", acento: "Acento (globos sueltos)" };

type Props = {
  borrador: ArmadoArcoOrganicoV1;
  opciones: OpcionesArmadoArcoOrganico;
  limites: LimitesArcoOrganico;
  leyenda: readonly ColorLeyenda[];
  onCambiar: (siguiente: ArmadoArcoOrganicoV1) => void;
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
  return <DeslizadorArco etiqueta={etiqueta} ayuda={ayuda} valor={valorEnRango(valor, rango)} valorReal={valor} min={rango.min} max={rango.max} paso={rango.paso} formato={metrosCliente} onConfirmar={onConfirmar} testid={testid} />;
}

function EnPorcentaje({ etiqueta, ayuda, valor, rango, onConfirmar, testid }: Medida) {
  return <DeslizadorArco etiqueta={etiqueta} ayuda={ayuda} valor={valorEnRango(valor, rango)} valorReal={valor} min={rango.min} max={rango.max} paso={rango.paso} formato={(v) => porcentaje.format(v)} onConfirmar={onConfirmar} testid={testid} />;
}

function EnCantidad({ etiqueta, ayuda, valor, rango, onConfirmar, testid, formato = (v) => entero.format(v) }: Medida & { formato?: (valor: number) => string }) {
  return <DeslizadorArco etiqueta={etiqueta} ayuda={ayuda} valor={valorEnRango(valor, rango)} valorReal={valor} min={rango.min} max={rango.max} paso={rango.paso} formato={formato} onConfirmar={onConfirmar} testid={testid} />;
}

/** Dónde cae la cima a lo largo del arco, con palabras y no con el número del motor. */
function dondeLaCima(valor: number): string {
  if (Math.abs(valor - 0.5) < 0.02) return "centrada";
  return `hacia la ${valor < 0.5 ? "izquierda" : "derecha"}`;
}

/** Cuánto se cierra la curva: el número del motor no dice nada al decorador, la silueta sí. */
function cierreDeLaCurva(valor: number): string {
  if (valor < 2) return "abierta, como una loma";
  if (valor < 2.6) return "de arco";
  return "cerrada, como una herradura";
}

/** Qué lado va más cargado de globos (y con los más grandes). */
function ladoCargado(valor: number): string {
  if (Math.abs(valor) < 0.05) return "parejo";
  return `${porcentaje.format(Math.abs(valor))} a la ${valor < 0 ? "izquierda" : "derecha"}`;
}

/** Hasta dónde llega la banda: el arco completo, o un medio arco que termina en el aire. */
function hastaDondeLlega(valor: number): string {
  return valor >= 0.999 ? "hasta el otro pie" : `${porcentaje.format(valor)} del recorrido`;
}

export function ControlesArcoOrganico({ borrador, opciones, limites, leyenda, onCambiar }: Props) {
  const rangoDe = {
    cima: rangoDelContrato(FormaArcoOrganicoSchema.shape.cima, 0.01),
    curva: rangoDelContrato(FormaArcoOrganicoSchema.shape.curva, 0.1),
    ondulacion: rangoDelContrato(FormaArcoOrganicoSchema.shape.ondulacion, PASO_FRACCION),
    carga: rangoDelContrato(FormaArcoOrganicoSchema.shape.carga, PASO_FRACCION),
    corte: rangoDelContrato(FormaArcoOrganicoSchema.shape.corte, 0.02),
    irregularidad: rangoDelContrato(VolumenArcoOrganicoSchema.shape.irregularidad, PASO_FRACCION),
    relleno: rangoDelContrato(VolumenArcoOrganicoSchema.shape.relleno, PASO_FRACCION),
    racimo: rangoDelContrato(VolumenArcoOrganicoSchema.shape.racimo, 1),
    salientes: rangoDelContrato(VolumenArcoOrganicoSchema.shape.salientes, PASO_FRACCION),
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
  const { forma } = borrador;
  // Un medio arco es este mismo armado cortado antes de bajar: el espejo solo tiene sentido entonces.
  const medioArco = forma.corte < 1;
  return (
    <div className="space-y-2" data-testid="controles-arco-organico">
      <div className="space-y-1 rounded-xl bg-superficie px-3 py-1 ring-1 ring-borde-suave ring-inset">
        <EnCantidad
          etiqueta="Hasta dónde llega la banda"
          ayuda="Con el recorrido completo la banda baja por las dos patas; acortándolo queda un medio arco que termina en el aire."
          valor={forma.corte}
          rango={rangoDe.corte}
          formato={hastaDondeLlega}
          onConfirmar={(v) => onCambiar(conForma(borrador, "corte", v))}
          testid="corte-arco-organico"
        />
        {medioArco && (
          <div className="pb-2">
            <InterruptorArco
              etiqueta="Que suba por la derecha"
              ayuda="Corta el medio arco por el otro lado. No cambia ningún globo: es el mismo arco en espejo."
              activo={forma.espejo}
              onCambiar={(activo) => onCambiar(conInterruptorDeForma(borrador, "espejo", activo))}
              testid="espejo-arco-organico"
            />
          </div>
        )}
      </div>

      <Apartado titulo="Forma" resumen={`${metrosCliente(forma.anchoM)} × ${metrosCliente(forma.altoM)}`} testid="apartado-forma-arco-organico">
        <SeleccionArco
          etiqueta="Empezar desde una forma lista"
          ayuda="Cambia la silueta entera —incluido si es medio arco—, el volumen y los tamaños de una vez; no toca tus colores ni los adornos. Después puedes ajustar cada cosa."
          opciones={[{ valor: "", etiqueta: "Elige una forma…" }, ...opciones.formas.map((lista) => ({ valor: lista.id, etiqueta: lista.nombre }))]}
          valor=""
          onCambiar={(v) => { const hallada = opciones.formas.find((lista) => lista.id === v); if (hallada) onCambiar(conFormaLista(borrador, hallada)); }}
          testid="forma-lista-arco-organico"
        />
        <EnMetros etiqueta="Ancho" ayuda="De pie a pie, por el piso." valor={forma.anchoM} rango={rangoDeAncho(limites)} onConfirmar={(v) => onCambiar(conForma(borrador, "anchoM", v))} testid="ancho-arco-organico" />
        <EnMetros etiqueta="Alto" ayuda="Del piso a la cima. Con un arco más ancho o una banda más gruesa hace falta más alto." valor={forma.altoM} rango={rangoDeAlto(limites)} onConfirmar={(v) => onCambiar(conForma(borrador, "altoM", v))} testid="alto-arco-organico" />
        <EnCantidad etiqueta="Dónde queda la cima" ayuda="Si el punto más alto cae en el centro o corrido hacia un lado." valor={forma.cima} rango={rangoDe.cima} formato={dondeLaCima} onConfirmar={(v) => onCambiar(conForma(borrador, "cima", v))} testid="cima-arco-organico" />
        <EnCantidad etiqueta="Qué tan cerrada va la curva" ayuda="De una loma abierta a una herradura que se recoge en los pies." valor={forma.curva} rango={rangoDe.curva} formato={cierreDeLaCurva} onConfirmar={(v) => onCambiar(conForma(borrador, "curva", v))} testid="curva-arco-organico" />
        <EnPorcentaje etiqueta="Ondulación" ayuda="Cuánto tiembla la línea: 0 es limpia." valor={forma.ondulacion} rango={rangoDe.ondulacion} onConfirmar={(v) => onCambiar(conForma(borrador, "ondulacion", v))} testid="ondulacion-arco-organico" />
        <EnCantidad etiqueta="Lado más cargado" ayuda="Ese lado queda más grueso y se lleva los globos más grandes." valor={forma.carga} rango={rangoDe.carga} formato={ladoCargado} onConfirmar={(v) => onCambiar(conForma(borrador, "carga", v))} testid="carga-arco-organico" />
        <InterruptorArco etiqueta="Suelo" ayuda="Dibuja la línea del piso. No cambia los globos." activo={forma.suelo} onCambiar={(activo) => onCambiar(conInterruptorDeForma(borrador, "suelo", activo))} testid="suelo-arco-organico" />
      </Apartado>

      <Apartado titulo="Volumen" resumen={`${metrosCliente(borrador.volumen.grosorPatasM)} a ${metrosCliente(borrador.volumen.grosorCimaM)}`} testid="apartado-volumen-arco-organico">
        <SeleccionArco
          etiqueta="Cuánto se llena"
          ayuda="Un estilo listo cambia el grosor, el relleno y los racimos; el de «gigantes» añade globos de 24″ y 36″."
          opciones={[{ valor: "", etiqueta: "Elige un estilo…" }, ...opciones.estilos.map((estilo) => ({ valor: estilo.id, etiqueta: estilo.nombre }))]}
          valor=""
          onCambiar={(v) => { const hallado = opciones.estilos.find((estilo) => estilo.id === v); if (hallado) onCambiar(conEstilo(borrador, hallado)); }}
          testid="estilo-arco-organico"
        />
        <EnMetros etiqueta="Grosor en los pies" ayuda="Qué tan ancha va la banda donde el arco se apoya." valor={borrador.volumen.grosorPatasM} rango={rangoDeGrosorPatas(limites)} onConfirmar={(v) => onCambiar(conVolumen(borrador, "grosorPatasM", v))} testid="grosor-patas-arco-organico" />
        <EnMetros etiqueta="Grosor en la cima" ayuda="Qué tan ancha va la banda arriba: una banda gruesa taparía la abertura, y el motor lo acota." valor={borrador.volumen.grosorCimaM} rango={rangoDeGrosorCima(limites)} onConfirmar={(v) => onCambiar(conVolumen(borrador, "grosorCimaM", v))} testid="grosor-cima-arco-organico" />
        <EnPorcentaje etiqueta="Relleno" ayuda="Qué tan llena va la banda de globos." valor={borrador.volumen.relleno} rango={rangoDe.relleno} onConfirmar={(v) => onCambiar(conVolumen(borrador, "relleno", v))} testid="relleno-arco-organico" />
        <EnPorcentaje etiqueta="Qué tan desparejo queda el borde" ayuda="En 0 el borde queda liso; subiéndolo, los globos entran y salen como en una pieza hecha a mano." valor={borrador.volumen.irregularidad} rango={rangoDe.irregularidad} onConfirmar={(v) => onCambiar(conVolumen(borrador, "irregularidad", v))} testid="irregularidad-arco-organico" />
        <EnCantidad etiqueta="Globos por racimo" ayuda="Cuántos globos se atan juntos en cada racimo; con más, el bulto se ve más tupido." valor={borrador.volumen.racimo} rango={rangoDe.racimo} onConfirmar={(v) => onCambiar(conVolumen(borrador, "racimo", v))} testid="racimo-arco-organico" />
        <EnPorcentaje etiqueta="Globos que asoman del borde" ayuda="Cuántos globos sobresalen del bulto para que el borde no quede recto." valor={borrador.volumen.salientes} rango={rangoDe.salientes} onConfirmar={(v) => onCambiar(conVolumen(borrador, "salientes", v))} testid="salientes-arco-organico" />
      </Apartado>

      <Apartado titulo="Tamaños de globo" testid="apartado-tamanos-arco-organico">
        <p className="text-xs leading-relaxed text-texto-suave">Cuánto pesa cada tamaño en la mezcla (0 lo quita). Un tamaño que no cabe en el grosor lo quita el motor y te lo dice.</p>
        {opciones.tamanos.map((pulgadas) => (
          <EnCantidad key={pulgadas} etiqueta={`Globos de ${pulgadas}″`} valor={pesoDeTamano(borrador, pulgadas)} rango={rangoDe.peso} formato={(v) => (v === 0 ? "no lleva" : entero.format(v))} onConfirmar={(v) => onCambiar(conPesoDeTamano(borrador, pulgadas, v))} testid={`peso-tamano-${pulgadas}-arco-organico`} />
        ))}
        <EnPorcentaje etiqueta="Dónde van los globos grandes" ayuda="En 0 van repartidos por toda la banda; subiéndolo, se bajan a los pies." valor={borrador.tamanos.grandesAbajo} rango={rangoDe.grandesAbajo} onConfirmar={(v) => onCambiar(conTamanos(borrador, "grandesAbajo", v))} testid="grandes-abajo-arco-organico" />
        <EnPorcentaje etiqueta="Qué tan inflados" ayuda="Qué tan inflado va cada globo respecto a su tamaño." valor={borrador.tamanos.inflado} rango={rangoDe.inflado} onConfirmar={(v) => onCambiar(conTamanos(borrador, "inflado", v))} testid="inflado-arco-organico" />
        <EnPorcentaje etiqueta="Globos de distinto tamaño" ayuda="Cuánto cambia el tamaño de un globo al de al lado, como cuando se infla a mano." valor={borrador.tamanos.variacion} rango={rangoDe.variacion} onConfirmar={(v) => onCambiar(conTamanos(borrador, "variacion", v))} testid="variacion-arco-organico" />
      </Apartado>

      <Apartado titulo="Colores" resumen={`${paleta.length} ${paleta.length === 1 ? "color" : "colores"}`} abierto testid="apartado-colores-arco-organico">
        {paleta.map((entrada, posicion) => {
          const numero = posicion + 1;
          const color = colorDe(leyenda, entrada.material);
          return (
            <fieldset key={posicion} data-testid={`color-arco-organico-${numero}`} className="space-y-2 rounded-xl bg-superficie-suave p-2.5 ring-1 ring-borde-suave ring-inset">
              <legend className="flex items-center gap-2 px-1 text-xs font-semibold text-texto">
                <span aria-hidden="true" className="inline-block size-3.5 rounded-full ring-1 ring-borde" style={{ background: color.hex }} />
                {`Color ${numero}`}
              </legend>
              <SeleccionArco etiqueta={`Color ${numero}`} ayuda="Qué color de la pieza va en este lugar de la mezcla." opciones={opcionesDeColor} valor={String(entrada.material)} onCambiar={(v) => onCambiar(conMaterial(borrador, posicion, Number(v)))} testid={`material-arco-organico-${numero}`} />
              <EnCantidad etiqueta={`Cuánto pesa el color ${numero}`} ayuda="Cuántos globos de este color hay frente a los demás: más peso, más se ve." valor={entrada.peso} rango={rangoDe.pesoDeColor} onConfirmar={(v) => onCambiar(conPesoDeColor(borrador, posicion, v))} testid={`peso-arco-organico-${numero}`} />
              <div className="grid gap-2 @sm:grid-cols-2">
                <SeleccionArco etiqueta={`Acabado del color ${numero}`} ayuda="Cambia el aspecto del globo (brillo, confeti, transparencia), no su color." opciones={opciones.acabados.map((acabado) => ({ valor: acabado.valor, etiqueta: acabado.texto }))} valor={entrada.acabado} onCambiar={(v) => { const hallado = opciones.acabados.find((acabado) => acabado.valor === v); if (hallado) onCambiar(conAcabado(borrador, posicion, hallado.valor)); }} testid={`acabado-arco-organico-${numero}`} />
                <SeleccionArco etiqueta={`Papel del color ${numero}`} ayuda="Normal va dentro de los racimos; acento son globos sueltos que asoman por fuera." opciones={opciones.roles.map((rol) => ({ valor: rol, etiqueta: NOMBRES_ROL[rol] ?? rol }))} valor={entrada.rol} onCambiar={(v) => { const hallado = opciones.roles.find((rol) => rol === v); if (hallado) onCambiar(conRol(borrador, posicion, hallado)); }} testid={`rol-arco-organico-${numero}`} />
              </div>
              <button
                type="button"
                onClick={() => onCambiar(conColorQuitado(borrador, posicion))}
                disabled={paleta.length <= 1}
                aria-label={`Quitar el color ${numero} de la paleta`}
                data-testid={`quitar-color-arco-organico-${numero}`}
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
          data-testid="agregar-color-arco-organico"
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
          testid="reparto-arco-organico"
        />
        <EnPorcentaje etiqueta="Mezcla entre colores" ayuda="Qué tan difuminado queda el paso de un color al otro." valor={borrador.colores.mezcla} rango={rangoDe.mezcla} onConfirmar={(v) => onCambiar(conMezclaDeColores(borrador, v))} testid="mezcla-colores-arco-organico" />
      </Apartado>

      <Apartado titulo="Adornos y disposición" testid="apartado-adornos-arco-organico">
        <p className="text-xs leading-relaxed text-texto-suave">Ramas de follaje y flores por metro de banda. No son globos: se listan, no se compran en esta cotización.</p>
        <EnCantidad etiqueta="Follaje" ayuda="Cuántas ramas verdes se meten entre los globos por cada metro de banda." valor={borrador.adornos.follaje} rango={rangoDe.adorno} formato={(v) => `${decimal.format(v)} por metro`} onConfirmar={(v) => onCambiar(conAdorno(borrador, "follaje", v))} testid="follaje-arco-organico" />
        <EnCantidad etiqueta="Flores" ayuda="Cuántas flores se meten entre los globos por cada metro de banda." valor={borrador.adornos.flores} rango={rangoDe.adorno} formato={(v) => `${decimal.format(v)} por metro`} onConfirmar={(v) => onCambiar(conAdorno(borrador, "flores", v))} testid="flores-arco-organico" />
        <button
          type="button"
          onClick={() => onCambiar(conSemilla(borrador, 1 + Math.floor(Math.random() * 99999)))}
          data-testid="otra-disposicion-arco-organico"
          className="ui-button-secondary ui-pressable min-h-11 px-3.5 text-[13px]"
        >
          <Dices className="size-3.5" aria-hidden="true" />Probar otra disposición de los globos
        </button>
      </Apartado>
    </div>
  );
}
