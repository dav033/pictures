"use client";

import { useRef, useState, type ReactNode } from "react";
import { ClipboardList, Info, LoaderCircle, Palette, Pencil, RotateCcw, TriangleAlert } from "lucide-react";
import { delaPieza, textoEditar, type NombrePieza } from "@/lib/plan/nombre-pieza";
import { MarcoEdicion } from "../motor/MarcoEdicion";
import { VistaMotor } from "../motor/VistaMotor";
import { borradorDe, camposMedidaDe, cambiosDe, densidadesDe, formasDe, piezaConBorrador, type BorradorPieza, type CambiosPieza } from "./borrador-pieza";
import { EditorPiezaSinMotor } from "./EditorPiezaSinMotor";
import { SelectorFormaPieza } from "./SelectorFormaPieza";
import { useVistaDibujoEstructura } from "./usarVistaDibujoEstructura";
import { type PanelDibujoEstructura, type PiezaDibujoEstructura } from "./vista-dibujo-estructura";
import type { PendientesAjustes } from "../cola-ajustes";

/**
 * «Forma de la pieza» dentro del detalle de una estructura: el dibujo de una pieza **que ningún motor arma**
 * —la pared, el aro circular, el techo de globos y el centro de mesa—.
 *
 * Gemelo de `BloqueArcoOrganico` en todo lo que es plomería (pide su dibujo, conserva el anterior mientras
 * llega el nuevo, reintenta un fallo) y distinto en lo que importa: **aquí no hay cifras y no hay nada que
 * guardar**. Los dibujos son esquemáticos y lo dice su propio encabezado —«No calculan cantidades: la medida
 * es la típica de cada estructura, no la del trabajo»—, así que no traen conteo, ni compra, ni medidas reales,
 * ni avisos del motor. Lo que la pieza lleva, cuesta y se compra está donde siempre, en las líneas de la
 * tarjeta y en su total, calculado por `plan.py`; el aro circular, con su `π × diámetro`.
 *
 * **Hay una cosa que guardar, y una sola: la forma de la pieza** (`onCambiarForma`). Las `formas` del repo
 * dueño (`clasificador-decoraciones/src/lib/referencias/variantes.ts`) ya están portadas a
 * `src/lib/plan/formas-pieza.ts` y viajan en el plan como `estructuras[].forma`, así que el decorador elige
 * en rombos, de malla o media luna y el dibujo obedece. Sigue sin haber **cifras** que guardar: la forma
 * cambia la silueta, no cuántos globos lleva la pieza ni lo que cuesta, que son los de `plan.py`. Sin
 * `onCambiarForma` (la tarjeta de solo lectura) el bloque es exactamente lo que era: solo el dibujo.
 *
 * El lienzo **no es cuadrado y cambia con la pieza** (600 × 560 la pared, 600 × 600 el aro y el centro de mesa,
 * 640 × 420 el techo), así que `VistaMotor` recibe `lienzo` y `alto` por separado, los dos tal como los manda
 * Python.
 */

type Props = {
  /** Sobre qué se pide el dibujo: el plan a la vista, la pieza declarada y su mezcla de tamaños resuelta. */
  pieza: PiezaDibujoEstructura;
  nombrePieza: string;
  /**
   * Las dos acciones del patrón de color, que son de `BloquePatron` y no de este bloque.
   *
   * Llegan aquí porque este bloque ocupa su hueco en las piezas que ningún motor arma, y sin ellas una pared
   * se quedaba sin poder editar su patrón. Opcionales: una pieza de un solo color no tiene patrón que editar.
   */
  onEditarPatron?: () => void;
  onHojaArmado?: () => void;
  /**
   * Guarda la forma elegida de la pieza (`null` la quita) y resuelve el motivo si no quedó. Sin esto el bloque
   * no ofrece el selector: es la tarjeta de solo lectura, que no edita nada.
   */
  onCambiarForma?: (forma: string | null) => Promise<string | null>;
  /** El contador de cambios sin guardar de la tarjeta: aprobar espera también por el selector de forma. */
  pendientes?: PendientesAjustes;
  /** Mientras se guarda un cambio: el botón del editor sigue enfocable y el toque no hace nada. */
  ocupado?: boolean;
  /**
   * Guarda en **una** edición lo que el editor de la pieza cambió —forma, densidad y medidas, lo que la fórmula de
   * la propuesta lee— y resuelve el motivo si no quedó. Con él, el encabezado ofrece «Editar pared» (o «Editar
   * aro», «Editar techo»…) en vez del selector de forma suelto. Sin él, el bloque es el de antes.
   */
  onGuardarPropiedades?: (cambios: CambiosPieza) => Promise<string | null>;
  /** Cómo se llama la pieza en los textos («Editar pared», «Forma del aro»). */
  nombre?: NombrePieza;
};

const botonReintentar = "ui-button-secondary ui-pressable min-h-11 px-3 py-1.5 text-xs";
/** El dibujo al lado de la nota cuando hay sitio, y encima cuando no. */
const MARCO = "relative h-64 overflow-hidden rounded-xl bg-superficie ring-1 ring-borde-suave ring-inset @md:h-auto @md:w-64 @md:min-h-64 @md:shrink-0";

export function BloqueDibujoEstructura({ pieza, nombrePieza, onEditarPatron, onHojaArmado, onCambiarForma, pendientes, ocupado = false, onGuardarPropiedades, nombre }: Props) {
  // El editor arranca con lo que el plan trae y no se guarda nada hasta «Guardar»: el dibujo que se ve mientras
  // tanto es el del borrador (su forma), con la misma pausa y "gana la última" que el del plan.
  const [sesion, setSesion] = useState<{ enPlan: BorradorPieza; borrador: BorradorPieza } | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [errorGuardado, setErrorGuardado] = useState<string | null>(null);
  const botonEditar = useRef<HTMLButtonElement | null>(null);
  const oficial = pieza.declarada.estructura_oficial;
  const campos = camposMedidaDe(oficial, pieza.declarada.tipo);
  const { estado, reintentar } = useVistaDibujoEstructura(sesion ? piezaConBorrador(pieza, sesion.borrador.forma) : pieza);
  const cerrar = () => {
    setSesion(null);
    setErrorGuardado(null);
    // El botón vuelve a existir en el render siguiente: el foco regresa a donde estaba el decorador.
    window.requestAnimationFrame(() => botonEditar.current?.focus());
  };
  const cambios = sesion ? cambiosDe(sesion.enPlan, sesion.borrador, campos) : null;
  const guardar = async () => {
    if (!sesion || !onGuardarPropiedades || !cambios || guardando) return;
    setGuardando(true);
    setErrorGuardado(null);
    const motivo = await onGuardarPropiedades(cambios);
    setGuardando(false);
    if (motivo === null) cerrar();
    else setErrorGuardado(motivo);
  };
  const accion = onGuardarPropiedades && nombre && !sesion ? (
    <button
      ref={botonEditar}
      type="button"
      aria-disabled={ocupado || undefined}
      title={ocupado ? "Espera a que termine de guardarse el último cambio" : undefined}
      onClick={() => {
        if (ocupado) return;
        const enPlan = borradorDe(pieza.declarada);
        setSesion({ enPlan, borrador: enPlan });
      }}
      data-testid="editar-pieza-sin-motor"
      className="ui-button-secondary ui-pressable min-h-11 shrink-0 px-3.5 py-1.5 text-[13px]"
    >
      <Pencil className="size-3.5" aria-hidden="true" />{textoEditar(nombre)}
    </button>
  ) : undefined;
  const editor = sesion && nombre && onGuardarPropiedades ? (
    <EditorPiezaSinMotor
      nombre={nombre}
      borrador={sesion.borrador}
      formas={formasDe(oficial)}
      densidades={densidadesDe(oficial)}
      campos={campos}
      hayCambios={cambios !== null}
      guardando={guardando}
      errorGuardado={errorGuardado}
      ocupado={ocupado}
      onCambiar={(borrador) => setSesion((actual) => (actual ? { ...actual, borrador } : actual))}
      onGuardar={() => void guardar()}
      onDescartar={cerrar}
      onRestablecer={() => setSesion((actual) => (actual ? { ...actual, borrador: actual.enPlan } : actual))}
    />
  ) : undefined;
  return (
    <PanelDibujo
      estado={estado}
      nombrePieza={nombrePieza}
      titulo={nombre ? `Forma ${delaPieza(nombre)}` : "Forma de la pieza"}
      onReintentar={reintentar}
      onEditarPatron={onEditarPatron}
      onHojaArmado={onHojaArmado}
      forma={pieza.declarada.forma}
      oficial={oficial}
      // Con el editor de la pieza, la forma se elige dentro de él: el selector suelto sobraría.
      onCambiarForma={onGuardarPropiedades && nombre ? undefined : onCambiarForma}
      pendientes={pendientes}
      ocupado={ocupado}
      accion={accion}
      editor={editor}
    />
  );
}

/** Presentación: lo que se ve en cada estado (cargando, error y la pieza dibujada). */
function PanelDibujo({ estado, nombrePieza, titulo, onReintentar, onEditarPatron, onHojaArmado, forma, oficial, onCambiarForma, pendientes, ocupado, accion, editor }: {
  estado: PanelDibujoEstructura;
  nombrePieza: string;
  titulo: string;
  accion?: ReactNode;
  editor?: ReactNode;
  onReintentar: () => void;
  onEditarPatron?: () => void;
  onHojaArmado?: () => void;
  forma?: string;
  oficial?: string;
  onCambiarForma?: (forma: string | null) => Promise<string | null>;
  pendientes?: PendientesAjustes;
  ocupado: boolean;
}) {
  return (
    <section aria-label={titulo} data-testid="bloque-dibujo-estructura" data-fase={estado.fase} className="@container rounded-2xl bg-superficie-suave p-3 ring-1 ring-borde-suave ring-inset">
      {estado.fase === "listo" ? (
        <PiezaDibujada estado={estado} nombrePieza={nombrePieza} titulo={titulo} onReintentar={onReintentar} accion={accion} editor={editor} />
      ) : (
        <div className="space-y-2">
          {accion ? (
            <div className="flex items-start justify-between gap-2">
              <p className="self-center text-[13px] font-semibold text-texto">{titulo}</p>
              {accion}
            </div>
          ) : (
            <p className="text-[13px] font-semibold text-texto">{titulo}</p>
          )}
          {estado.fase === "cargando" ? (
            <p role="status" className="brillo-carga flex items-center gap-1.5 rounded-xl bg-superficie px-3 py-6 text-center text-xs text-texto-suave">
              <LoaderCircle className="size-3.5 animate-spin text-acento motion-reduce:animate-none" aria-hidden="true" />
              Dibujando la pieza…
            </p>
          ) : (
            <div role="alert" className="flex flex-wrap items-center gap-2 rounded-xl bg-error-suave px-3 py-2 text-xs font-medium text-error">
              <TriangleAlert className="size-3.5 shrink-0" aria-hidden="true" />
              <span className="min-w-0 flex-1">{estado.mensaje}</span>
              <button type="button" onClick={onReintentar} data-testid="reintentar-dibujo-estructura" className={botonReintentar}>
                <RotateCcw className="size-3.5" aria-hidden="true" />Reintentar
              </button>
            </div>
          )}
          {editor}
        </div>
      )}
      {/*
        El selector de forma va DENTRO de esta sección y después de todo lo demás, a propósito: así no se
        inserta ningún hermano antes de los controles que vienen después en la tarjeta y ningún `useId` se
        desplaza (es la misma razón por la que el dibujo comparte hueco con el bloque del patrón). Solo
        aparece con `onCambiarForma` y con una oficial que ofrezca formas.
      */}
      {onCambiarForma && oficial !== undefined && (
        <SelectorFormaPieza oficial={oficial} forma={forma} onGuardar={onCambiarForma} ocupado={ocupado} pendientes={pendientes} />
      )}
      <AccionesDelPatron onEditar={onEditarPatron} onHojaArmado={onHojaArmado} ocupado={ocupado} />
    </section>
  );
}

/**
 * «Editar patrón» y «Hoja de armado», que son del patrón de color y no del dibujo.
 *
 * Viven aquí porque este bloque ocupa el hueco de `BloquePatron` en las piezas que ningún motor arma, y con él
 * se iban sus dos acciones: una pared se quedaba sin poder editar su patrón, que es justo la pieza que más lo
 * necesita (un mural, unas franjas, un ajedrez). El dibujo no cambia nada de lo que hacen; solo les da sitio.
 *
 * Van fuera del `if` del estado a propósito: si el dibujo no llega, el patrón se sigue pudiendo editar.
 */
function AccionesDelPatron({ onEditar, onHojaArmado, ocupado }: {
  onEditar?: () => void;
  onHojaArmado?: () => void;
  ocupado: boolean;
}) {
  if (!onEditar && !onHojaArmado) return null;
  return (
    <div className="flex flex-wrap gap-2 pt-3">
      {onEditar && (
        // No se deshabilita mientras se guarda, igual que en `BloquePatron`: al cerrar el editor con un cambio
        // pendiente el foco vuelve a este botón, y un botón `disabled` no lo recibe y lo dejaba en <body>.
        <button
          type="button"
          aria-disabled={ocupado || undefined}
          title={ocupado ? "Espera a que termine de guardarse el último cambio" : undefined}
          onClick={() => {
            if (!ocupado) onEditar();
          }}
          data-testid="editar-patron"
          className="ui-button-secondary ui-pressable min-h-11 gap-1.5 px-3 text-[13px]"
        >
          <Palette className="size-4" aria-hidden="true" />Editar patrón
        </button>
      )}
      {onHojaArmado && (
        <button
          type="button"
          onClick={onHojaArmado}
          aria-haspopup="dialog"
          data-testid="abrir-hoja-armado"
          className="ui-button-secondary ui-pressable min-h-11 gap-1.5 px-3 text-[13px]"
        >
          <ClipboardList className="size-4" aria-hidden="true" />Hoja de armado
        </button>
      )}
    </div>
  );
}

/** La pieza dibujada, con la nota de que el dibujo es un esquema y no una medida del trabajo. */
function PiezaDibujada({ estado, nombrePieza, titulo, onReintentar, accion, editor }: {
  estado: Extract<PanelDibujoEstructura, { fase: "listo" }>;
  nombrePieza: string;
  titulo: string;
  onReintentar: () => void;
  accion?: ReactNode;
  editor?: ReactNode;
}) {
  const { grafica, actualizando, fallo } = estado;
  // Un dibujo que no es el de la pieza a la vista (el nuevo está en camino o no se pudo dibujar) se ve apagado.
  const tenue = actualizando ? "opacity-60 transition-opacity motion-reduce:transition-none" : "";
  return (
    <MarcoEdicion editor={editor}>
    <div aria-busy={actualizando} className="flex flex-col gap-3 @md:flex-row">
      <div className={`${MARCO} ${tenue}`}>
        <VistaMotor
          svg={grafica.svg}
          lienzo={grafica.ancho}
          alto={grafica.alto}
          etiqueta={`${nombrePieza}: dibujo de su forma`}
          className="absolute inset-0 size-full p-1.5"
        />
      </div>
      <div className="min-w-0 flex-1 space-y-2.5">
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 self-center">
            <p className="text-[13px] font-semibold text-texto">{titulo}</p>
            <span aria-live="polite" className="inline-flex items-center gap-1 text-[11px] font-medium text-texto-suave">
              {actualizando && <><LoaderCircle className="size-3 animate-spin text-acento motion-reduce:animate-none" aria-hidden="true" />Actualizando…</>}
            </span>
          </div>
          {accion}
        </div>
        <p className="flex items-start gap-1.5 text-xs text-texto-suave">
          <Info className="mt-px size-3.5 shrink-0 text-texto-tenue" aria-hidden="true" />
          <span className="min-w-0 flex-1">
            Es un esquema de cómo se ve la pieza con sus colores: la medida del dibujo es la típica de esta
            estructura, no la del trabajo. Lo que lleva y lo que cuesta son las líneas y el total de esta tarjeta.
          </span>
        </p>
        {fallo && (
          <div role="alert" className="flex flex-wrap items-center gap-2 rounded-xl bg-error-suave px-3 py-2 text-xs font-medium text-error">
            <TriangleAlert className="size-3.5 shrink-0" aria-hidden="true" />
            <span className="min-w-0 flex-1">{fallo} El dibujo es el último que llegó.</span>
            <button type="button" onClick={onReintentar} data-testid="reintentar-dibujo-estructura" className={botonReintentar}>
              <RotateCcw className="size-3.5" aria-hidden="true" />Reintentar
            </button>
          </div>
        )}
      </div>
    </div>
    </MarcoEdicion>
  );
}
