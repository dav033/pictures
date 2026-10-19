"use client";

import { useEffect, useState, type KeyboardEvent } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { motion, useReducedMotion } from "motion/react";
import { Info, LoaderCircle, Redo2, RotateCcw, TriangleAlert, Undo2, X } from "lucide-react";
import type { ArmadoBouquetResuelto, ArmadoBouquetV1 } from "@/lib/plan/armado-bouquet";
import type { EstructuraResuelta, PlanResuelto } from "@/lib/plan/resuelto";
import type { EstructuraOficial } from "@/lib/plan/estructuras-oficiales";
import { productoCliente, ubicacionCliente } from "@/lib/plan/presentacion-cliente";
import { useFocoDeRetorno } from "@/components/ui/foco-retorno";
import type { ResumenAutoguardado } from "../autoguardado";
import { useAutoguardado } from "../usarAutoguardado";
import { vistaDeAutoguardado, type VistaEstadoGuardado } from "../EstadoGuardado";
import { LeyendaPatron } from "../patron/LeyendaPatron";
import { intercambiables, intercambiar, mismaPosicion, mismoArmado, type Posicion } from "./borrador-armado";
import { globosDeLineas, leyendaBouquet, resumenInsumos } from "./leyenda-bouquet";
import { GraficaBouquet } from "./GraficaBouquet";
import { ControlesBouquet } from "./ControlesBouquet";
import { PieEditorBouquet } from "./PieEditorBouquet";
import { useArranqueArmado, useVistaArmado } from "./usarVistaArmado";
import type { PedidoEstiloArmado } from "./arranque-armado";

type EstructuraDeclarada = PlanResuelto["plan"]["estructuras"][number];

type Props = {
  /** Cierra el editor; `fin` resuelve cuando termina lo que quedaba por guardar. */
  onCerrar: (fin: Promise<ResumenAutoguardado<ArmadoBouquetV1 | null>>) => void;
  /** Plan declarado: la vista previa se pide sobre el que había al abrir. */
  plan: PlanResuelto["plan"];
  estructura: EstructuraResuelta;
  /** La estructura del plan de ahora: su `armado_bouquet` es lo que ya está guardado. */
  declarada: EstructuraDeclarada;
  oficial?: EstructuraOficial;
  /** Armado resuelto que traía el plan al abrir (`plan_resuelto.armados_bouquet`). */
  resuelto: ArmadoBouquetResuelto | null;
  /** Guarda el armado en la propuesta (o lo quita con `null`); resuelve el motivo si no se guardó. */
  onGuardar: (armado: ArmadoBouquetV1 | null) => Promise<string | null>;
  /** La propuesta estaba aprobada: la imagen no se regenera sola. */
  aprobada?: boolean;
};

/** `presente: null` = la pieza sin armado (se ve la receta de Python, que no está en el plan hasta que el decorador la toca). */
type Historia = { pasado: (ArmadoBouquetV1 | null)[]; presente: ArmadoBouquetV1 | null; futuro: (ArmadoBouquetV1 | null)[] };

const MAX_HISTORIA = 60;
/** Pausa sin cambios antes de guardar: varios intercambios seguidos son un solo guardado. */
const ESPERA_GUARDADO_MS = 700;

/**
 * Editor del armado de un bouquet (ADR-0030, segunda entrega): hoja inferior
 * en móvil, dos columnas en escritorio. A la izquierda lo que devuelve Python
 * (la gráfica por niveles, la leyenda y los insumos); a la derecha el estilo y
 * la disposición de los números. Los globos se intercambian en la gráfica.
 *
 * Sin botón "Aplicar": cada borrador que Python dibuja sin rechazo se guarda
 * solo tras una pausa corta (`useAutoguardado`). Un intercambio que Python
 * rechaza se deshace y su frase queda a la vista. Abrir para mirar no cambia
 * la propuesta: la receta de Python ("Crear armado") es solo una vista hasta
 * que el decorador la retoca, elige un estilo o pulsa "Usar sugerencia".
 * TypeScript no arma ni cuenta nada: lo que se ve es lo que Python devolvió.
 */
export function EditorBouquet({ onCerrar, plan, estructura, declarada, oficial, resuelto, onGuardar, aprobada = false }: Props) {
  const reducir = useReducedMotion();
  const focoRetorno = useFocoDeRetorno();
  const [inicio] = useState(() => ({
    armado: declarada.armado_bouquet ?? null,
    resuelto,
    pieza: { plan, estructuraId: estructura.estructura_id, globos: globosDeLineas(estructura.lineas) },
  }));
  const armadoEnPlan = declarada.armado_bouquet ?? null;
  const [historia, setHistoria] = useState<Historia>({ pasado: [], presente: inicio.armado, futuro: [] });
  const [seleccion, setSeleccion] = useState<Posicion | null>(null);
  // La frase de Python del último intercambio rechazado (ya deshecho), hasta el siguiente gesto.
  const [rechazo, setRechazo] = useState<string | null>(null);
  const { vista, opciones, cargando, error, estadoBorrador, reintentar, sembrar } = useVistaArmado({
    pieza: inicio.pieza,
    armado: historia.presente,
    inicial: inicio.armado && inicio.resuelto ? inicio.resuelto : null,
    alRechazar: (mensaje) => {
      setRechazo(mensaje);
      deshacer({ conservarAviso: true });
    },
  });
  const leyenda = leyendaBouquet(vista ?? inicio.resuelto ?? { leyenda: [] }, estructura.lineas);
  const { estado: guardado, control: autoguardado } = useAutoguardado<ArmadoBouquetV1 | null>({
    enPlan: inicio.armado,
    iguales: mismoArmado,
    esperaMs: ESPERA_GUARDADO_MS,
    validar: true,
    guardar: onGuardar,
  });
  // Sin armado en el borrador, los controles parten de la receta a la vista; tocarlos la vuelve del decorador y se guarda.
  const borrador = historia.presente ?? vista?.armado ?? null;
  const sugerenciaSinUsar = historia.presente === null && estadoBorrador === "listo" && vista !== null ? vista.armado : null;
  const nombrePieza = oficial?.nombre ?? productoCliente(estructura.nombre);
  const motivoRechazo = estadoBorrador === "rechazado" ? error?.mensaje ?? null : null;
  // Otro estilo o disposición: Python arma su receta, se dibuja tal cual y pasa a ser el borrador.
  const estilos = useArranqueArmado({
    pieza: inicio.pieza,
    alLlegar: (llegada) => {
      sembrar(llegada);
      cambiar(llegada.armado.armado, { conservarEstilo: true });
    },
  });

  // Cada borrador nuevo va al autoguardado; quitar el armado no necesita vista previa ni pausa.
  useEffect(() => {
    autoguardado.cambiar(historia.presente, historia.presente === null ? { inmediato: true, valido: true } : undefined);
  }, [autoguardado, historia.presente]);

  // Solo se guarda lo que Python dibujó; lo que rechazó se deshace y no se guarda.
  useEffect(() => {
    if (historia.presente === null) return;
    if (estadoBorrador === "listo") autoguardado.validar(historia.presente, { ok: true });
    else if (motivoRechazo) autoguardado.validar(historia.presente, { ok: false, motivo: motivoRechazo });
  }, [autoguardado, historia.presente, estadoBorrador, motivoRechazo]);

  function cambiar(siguiente: ArmadoBouquetV1 | null, { conservarEstilo = false } = {}): void {
    if (!conservarEstilo) estilos.cancelar();
    setRechazo(null);
    setSeleccion(null);
    setHistoria((actual) => ({ pasado: [...actual.pasado, actual.presente].slice(-MAX_HISTORIA), presente: siguiente, futuro: [] }));
  }

  function deshacer({ conservarAviso = false } = {}): void {
    estilos.cancelar();
    if (!conservarAviso) setRechazo(null);
    setSeleccion(null);
    setHistoria((actual) => {
      const [previo] = actual.pasado.slice(-1);
      if (previo === undefined) return actual;
      return { pasado: actual.pasado.slice(0, -1), presente: previo, futuro: [actual.presente, ...actual.futuro] };
    });
  }

  function rehacer(): void {
    estilos.cancelar();
    setRechazo(null);
    setSeleccion(null);
    setHistoria((actual) => {
      const [siguiente, ...resto] = actual.futuro;
      if (siguiente === undefined) return actual;
      return { pasado: [...actual.pasado, actual.presente], presente: siguiente, futuro: resto };
    });
  }

  function atajos(evento: KeyboardEvent<HTMLDivElement>): void {
    if (!(evento.ctrlKey || evento.metaKey)) return;
    const tecla = evento.key.toLowerCase();
    if (tecla === "z") {
      evento.preventDefault();
      if (evento.shiftKey) rehacer();
      else deshacer();
    } else if (tecla === "y") {
      evento.preventDefault();
      rehacer();
    }
  }

  /** Primer toque: marca el globo; segundo: los intercambia (los números solo entre sí). */
  function seleccionar(posicion: Posicion): void {
    setRechazo(null);
    if (!seleccion) {
      setSeleccion(posicion);
      return;
    }
    if (mismaPosicion(seleccion, posicion)) {
      setSeleccion(null);
      return;
    }
    if (!intercambiables(seleccion, posicion)) {
      setSeleccion(posicion);
      return;
    }
    const nuevo = borrador ? intercambiar(borrador, seleccion, posicion) : null;
    setSeleccion(null);
    if (nuevo) cambiar(nuevo);
  }

  function elegirEstilo(pedido: PedidoEstiloArmado): void {
    setRechazo(null);
    setSeleccion(null);
    estilos.elegir(pedido);
  }

  function cerrar(): void {
    onCerrar(autoguardado.cerrar());
  }

  const estadoGuardado: VistaEstadoGuardado = estadoBorrador === "fallido" && guardado.fase === "esperando" && error
    ? { tipo: "error", motivo: error.mensaje, onReintentar: reintentar }
    : vistaDeAutoguardado(guardado, armadoEnPlan ? "Cambios guardados en tu propuesta" : "Tu propuesta quedó sin armado en esta pieza", autoguardado.reintentar);
  const insumos = vista ? resumenInsumos(vista.insumos, vista.duracion_estimada) : "";

  return (
    <Dialog.Root open onOpenChange={(abierto) => { if (!abierto) cerrar(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-overlay backdrop-blur-[2px]" />
        <Dialog.Content asChild {...focoRetorno} onKeyDown={atajos}>
          <motion.div
            data-testid="editor-armado"
            initial={reducir ? false : { opacity: 0, y: 28 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, ease: [0.23, 1, 0.32, 1] }}
            className="fixed inset-x-0 bottom-0 z-50 flex max-h-[94dvh] flex-col overflow-hidden rounded-t-[1.75rem] border border-borde-suave bg-superficie shadow-[0_24px_64px_var(--sombra)] md:inset-x-4 md:top-1/2 md:bottom-auto md:mx-auto md:h-[min(50rem,calc(100dvh-3rem))] md:max-h-none md:max-w-[64rem] md:-translate-y-1/2 md:rounded-3xl"
          >
            <span aria-hidden="true" className="mx-auto mt-2 block h-1 w-10 shrink-0 rounded-full bg-borde md:hidden" />
            <header className="flex items-start justify-between gap-3 px-4 pb-3 pt-2 md:px-6 md:pt-5">
              <div className="min-w-0">
                <p className="text-xs font-medium text-acento">Armado del bouquet</p>
                <Dialog.Title className="mt-0.5 truncate text-lg font-semibold tracking-tight text-texto md:text-xl">
                  {nombrePieza} <span className="font-normal text-texto-suave">{ubicacionCliente(estructura)}</span>
                </Dialog.Title>
                <Dialog.Description className="mt-0.5 text-xs text-texto-suave">Elige el estilo, dónde van los números e intercambia globos en la gráfica. Cada cambio se guarda solo.</Dialog.Description>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button type="button" onClick={() => deshacer()} disabled={!historia.pasado.length} aria-label="Deshacer" title="Deshacer (Ctrl+Z)" className="ui-icon-button">
                  <Undo2 className="size-4" aria-hidden="true" />
                </button>
                <button type="button" onClick={rehacer} disabled={!historia.futuro.length} aria-label="Rehacer" title="Rehacer (Ctrl+Shift+Z)" className="ui-icon-button">
                  <Redo2 className="size-4" aria-hidden="true" />
                </button>
                <Dialog.Close aria-label="Cerrar editor de armado" className="ml-1 grid size-10 place-items-center rounded-xl bg-acento-suave text-texto hover:text-acento focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acento">
                  <X className="size-4" aria-hidden="true" />
                </Dialog.Close>
              </div>
            </header>

            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain md:grid md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] md:overflow-hidden">
              <section aria-label="Vista previa del armado" className="order-1 flex shrink-0 flex-col gap-2 border-y border-borde-suave bg-superficie-suave px-4 py-3 md:min-h-0 md:overflow-y-auto md:border-y-0 md:border-r md:px-6 md:py-4">
                <div className="relative min-h-64 flex-1 rounded-2xl bg-superficie p-2 ring-1 ring-borde-suave ring-inset md:min-h-72">
                  {vista ? (
                    <GraficaBouquet
                      key={vista.armado.variante}
                      resuelto={vista}
                      leyenda={leyenda}
                      seleccion={seleccion ? [seleccion] : []}
                      onSeleccionar={seleccionar}
                      className="h-64 md:h-full md:min-h-72"
                    />
                  ) : error && !cargando ? (
                    <div className="grid h-64 place-items-center px-4 text-center text-[13px] text-texto-suave md:h-full">
                      <div className="space-y-2">
                        <p className="font-medium text-error">{error.mensaje}</p>
                        {!error.armadoInvalido && (
                          <button type="button" onClick={reintentar} className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-semibold text-acento ring-1 ring-acento/40 ring-inset hover:bg-acento-suave focus-visible:outline-2 focus-visible:outline-acento">
                            <RotateCcw className="size-3.5" aria-hidden="true" />Reintentar
                          </button>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="brillo-carga h-64 rounded-xl md:h-full" aria-hidden="true" />
                  )}
                  {cargando && vista && (
                    <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-superficie px-2 py-0.5 text-[11px] text-texto-suave ring-1 ring-borde-suave" role="status">
                      <LoaderCircle className="size-3 animate-spin text-acento motion-reduce:animate-none" aria-hidden="true" />Dibujando…
                    </span>
                  )}
                </div>
                {/* La frase de Python de un intercambio rechazado: siempre montada para que el lector la anuncie. */}
                <p role="status" aria-live="polite" data-testid="rechazo-armado" className="min-h-4 text-xs font-medium text-error empty:hidden">
                  {rechazo && <span className="flex items-start gap-1.5"><TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden="true" />{rechazo} Volví a como estaba.</span>}
                </p>
                {vista && (
                  <div className="space-y-1.5">
                    <LeyendaPatron leyenda={leyenda} etiqueta="Leyenda del armado" />
                    {insumos && <p data-testid="insumos-armado" className="text-xs text-texto-suave"><span className="font-semibold text-texto">Necesita:</span> {insumos}</p>}
                    {vista.avisos.length > 0 && (
                      <ul aria-label="Avisos del armado" className="space-y-0.5 text-xs text-texto-suave">
                        {vista.avisos.map((aviso) => <li key={aviso} className="flex gap-1.5"><Info className="mt-px size-3.5 shrink-0 text-texto-tenue" aria-hidden="true" />{aviso}</li>)}
                      </ul>
                    )}
                  </div>
                )}
              </section>
              <section aria-label="Ajustes del armado" className="order-2 shrink-0 px-4 py-4 md:min-h-0 md:overflow-y-auto md:px-6 md:py-5">
                <ControlesBouquet
                  borrador={borrador}
                  opciones={opciones}
                  conNumeros={Boolean(vista?.numero ?? borrador?.numero)}
                  estilo={{ pendiente: estilos.pendiente, error: estilos.error, onElegir: elegirEstilo }}
                  eligiendo={seleccion !== null}
                />
              </section>
            </div>

            <PieEditorBouquet
              estado={estadoGuardado}
              avisoRegenerar={aprobada && guardado.fase !== "quieto"}
              puedeQuitar={historia.presente !== null}
              puedeRestablecer={!mismoArmado(historia.presente, inicio.armado)}
              tituloRestablecer={inicio.armado ? "Volver al armado que tenía la pieza al abrir" : "Volver a como estaba al abrir: sin armado en tu propuesta"}
              onQuitar={() => cambiar(null)}
              onRestablecer={() => cambiar(inicio.armado)}
              onUsarSugerencia={sugerenciaSinUsar ? () => cambiar(sugerenciaSinUsar) : undefined}
              onListo={cerrar}
            />
          </motion.div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
