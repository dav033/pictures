"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { motion, useReducedMotion } from "motion/react";
import { Info, LoaderCircle, Redo2, RotateCcw, TriangleAlert, Undo2, X } from "lucide-react";
import type { ArmadoGuirnaldaResuelto, ArmadoGuirnaldaV1 } from "@/lib/plan/armado-guirnalda";
import type { EstructuraResuelta, PlanResuelto } from "@/lib/plan/resuelto";
import type { EstructuraOficial } from "@/lib/plan/estructuras-oficiales";
import { lineaVistaGuirnalda } from "@/lib/plan/peticion-armado-guirnalda";
import { productoCliente, ubicacionCliente } from "@/lib/plan/presentacion-cliente";
import { useFocoDeRetorno } from "@/components/ui/foco-retorno";
import type { ResumenAutoguardado } from "../autoguardado";
import { useAutoguardado } from "../usarAutoguardado";
import { vistaDeAutoguardado, type VistaEstadoGuardado } from "../EstadoGuardado";
import { LeyendaPatron } from "../patron/LeyendaPatron";
import { leyendaPatron } from "../patron/leyenda";
import { PieEditorBouquet } from "../bouquet/PieEditorBouquet";
import { ControlesGuirnalda } from "./ControlesGuirnalda";
import { GraficaGuirnalda } from "./GraficaGuirnalda";
import { conRemate, mismoArmadoGuirnalda, posicionPorRacimo } from "./borrador-guirnalda";
import { horas, leyendaGuirnalda, metros, resumenInsumosGuirnalda } from "./leyenda-guirnalda";
import { useVistaGuirnalda } from "./usarVistaGuirnalda";
import { panelVistaGuirnalda } from "./vista-guirnalda";

type EstructuraDeclarada = PlanResuelto["plan"]["estructuras"][number];

type Props = {
  /** Cierra el editor; `fin` resuelve cuando termina lo que quedaba por guardar. */
  onCerrar: (fin: Promise<ResumenAutoguardado<ArmadoGuirnaldaV1 | null>>) => void;
  /** Plan declarado: la vista previa se pide sobre el que había al abrir. */
  plan: PlanResuelto["plan"];
  estructura: EstructuraResuelta;
  /** La estructura del plan de ahora: su `armado_guirnalda` es lo que ya está guardado. */
  declarada: EstructuraDeclarada;
  oficial?: EstructuraOficial;
  /** Armado resuelto que traía el plan al abrir (`plan_resuelto.armados_guirnalda`). */
  resuelto: ArmadoGuirnaldaResuelto | null;
  /** Guarda el armado en la propuesta (o lo quita con `null`); resuelve el motivo si no se guardó. */
  onGuardar: (armado: ArmadoGuirnaldaV1 | null) => Promise<string | null>;
  /** Nombre de una pieza del plan (para elegir la anfitriona). */
  nombrePieza: (estructuraId: string) => string;
  /** La propuesta estaba aprobada: la imagen no se regenera sola. */
  aprobada?: boolean;
};

/** `presente: null` = la pieza sin armado (se ve la receta de Python, que no está en el plan hasta que el decorador la toca). */
type Historia = { pasado: (ArmadoGuirnaldaV1 | null)[]; presente: ArmadoGuirnaldaV1 | null; futuro: (ArmadoGuirnaldaV1 | null)[] };
type Arrastre = { indice: number; pointerId: number; x: number; y: number; arrastrando: boolean; racimo: number | null };

const MAX_HISTORIA = 60;
/** Pausa sin cambios antes de guardar: varios ajustes seguidos son un solo guardado. */
const ESPERA_GUARDADO_MS = 700;
/** Lo que se mueve el puntero antes de que un toque sea un arrastre. */
const UMBRAL_ARRASTRE_PX = 6;

/** El racimo de la gráfica bajo el puntero (`data-racimo`), si hay uno. */
function racimoEn(x: number, y: number): number | null {
  const elemento = typeof document === "undefined" ? null : document.elementFromPoint(x, y);
  const destino = elemento?.closest("[data-racimo]");
  const numero = Number(destino?.getAttribute("data-racimo"));
  return Number.isInteger(numero) && numero > 0 ? numero : null;
}

/**
 * Editor del armado de una guirnalda (ADR-0032, E6), como el del bouquet:
 * hoja inferior en móvil, dos columnas en escritorio. A la izquierda lo que
 * devuelve Python (la gráfica con la forma real, la leyenda, los insumos y
 * la duración estimada); a la derecha el soporte, la forma, la caída, el
 * racimo, el relleno y los remates. Un remate se lleva a un racimo
 * arrastrándolo a la gráfica, o con "Mover" y las flechas.
 *
 * Sin botón "Aplicar": cada borrador que Python dibuja sin rechazo se guarda
 * solo tras una pausa corta (`useAutoguardado`) con la acción
 * `armado_guirnalda` de la edición. Un cambio que Python rechaza se deshace y
 * su frase queda a la vista. Los estados de la vista previa (cargando, error,
 * vacío, listo, actualizando) son los de `panelVistaGuirnalda`. TypeScript no
 * arma ni cuenta nada: lo que se ve es lo que Python devolvió.
 */
export function EditorGuirnalda({ onCerrar, plan, estructura, declarada, oficial, resuelto, onGuardar, nombrePieza, aprobada = false }: Props) {
  const reducir = useReducedMotion();
  const focoRetorno = useFocoDeRetorno();
  const [inicio] = useState(() => ({
    armado: declarada.armado_guirnalda ?? null,
    resuelto,
    pieza: { plan, estructuraId: estructura.estructura_id, lineas: estructura.lineas.map(lineaVistaGuirnalda) },
  }));
  const armadoEnPlan = declarada.armado_guirnalda ?? null;
  const [historia, setHistoria] = useState<Historia>({ pasado: [], presente: inicio.armado, futuro: [] });
  const [rechazo, setRechazo] = useState<string | null>(null);
  const [moviendo, setMoviendo] = useState<number | null>(null);
  const [arrastre, setArrastre] = useState<Arrastre | null>(null);
  const suprimirClic = useRef(false);
  const botonesMover = useRef(new Map<number, HTMLButtonElement>());
  const vista = useVistaGuirnalda({
    pieza: inicio.pieza,
    armado: historia.presente,
    inicial: inicio.armado && inicio.resuelto ? inicio.resuelto : null,
    alRechazar: (mensaje) => {
      setRechazo(mensaje);
      deshacer({ conservarAviso: true });
    },
  });
  const panel = panelVistaGuirnalda(vista);
  const dibujo = panel.fase === "listo" ? panel.vista : null;
  const leyenda = leyendaGuirnalda(dibujo ?? inicio.resuelto ?? { leyenda: [] }, estructura.lineas);
  const colores = leyendaPatron(declarada.materiales, estructura.lineas);
  const { estado: guardado, control: autoguardado } = useAutoguardado<ArmadoGuirnaldaV1 | null>({
    enPlan: inicio.armado,
    iguales: mismoArmadoGuirnalda,
    esperaMs: ESPERA_GUARDADO_MS,
    validar: true,
    guardar: onGuardar,
  });
  // Sin armado en el borrador, los controles parten de la receta a la vista; tocarlos la vuelve del decorador y se guarda.
  const borrador = historia.presente ?? (vista.receta && vista.borrador === "listo" ? vista.vista?.armado ?? null : null);
  const sugerenciaSinUsar = historia.presente === null && vista.borrador === "listo" && vista.vista ? vista.vista.armado : null;
  const nombreVisible = oficial?.nombre ?? productoCliente(estructura.nombre);
  const motivoRechazo = vista.borrador === "rechazado" ? vista.error?.mensaje ?? null : null;
  const indiceDestino = arrastre?.arrastrando ? arrastre.indice : moviendo;

  // Cada borrador nuevo va al autoguardado; quitar el armado no necesita vista previa ni pausa.
  useEffect(() => {
    autoguardado.cambiar(historia.presente, historia.presente === null ? { inmediato: true, valido: true } : undefined);
  }, [autoguardado, historia.presente]);

  // Solo se guarda lo que Python dibujó; lo que rechazó se deshace y no se guarda.
  useEffect(() => {
    if (historia.presente === null) return;
    if (vista.borrador === "listo") autoguardado.validar(historia.presente, { ok: true });
    else if (motivoRechazo) autoguardado.validar(historia.presente, { ok: false, motivo: motivoRechazo });
  }, [autoguardado, historia.presente, vista.borrador, motivoRechazo]);

  function cambiar(siguiente: ArmadoGuirnaldaV1 | null): void {
    setRechazo(null);
    setMoviendo(null);
    setHistoria((actual) => (mismoArmadoGuirnalda(actual.presente, siguiente) && (actual.presente === null) === (siguiente === null)
      ? actual
      : { pasado: [...actual.pasado, actual.presente].slice(-MAX_HISTORIA), presente: siguiente, futuro: [] }));
  }

  function deshacer({ conservarAviso = false } = {}): void {
    if (!conservarAviso) setRechazo(null);
    setMoviendo(null);
    setHistoria((actual) => {
      const [previo] = actual.pasado.slice(-1);
      if (previo === undefined) return actual;
      return { pasado: actual.pasado.slice(0, -1), presente: previo, futuro: [actual.presente, ...actual.futuro] };
    });
  }

  function rehacer(): void {
    setRechazo(null);
    setMoviendo(null);
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

  /** El foco vuelve al botón "Mover" del remate (los destinos de la gráfica desaparecen). */
  function volverAlRemate(indice: number): void {
    window.requestAnimationFrame(() => botonesMover.current.get(indice)?.focus());
  }

  /** El remate `indice` queda junto al racimo donde se soltó (Python decide en cuáles exactamente). */
  function soltar(indice: number, racimo: number): void {
    setMoviendo(null);
    volverAlRemate(indice);
    if (!borrador || !dibujo || !borrador.remates[indice]) return;
    const posicion = posicionPorRacimo(racimo, dibujo.racimos.length);
    if (borrador.remates[indice]!.posicion !== posicion) cambiar(conRemate(borrador, indice, { posicion }));
  }

  function elegirParaMover(indice: number | null): void {
    if (suprimirClic.current) {
      suprimirClic.current = false;
      return;
    }
    setRechazo(null);
    setMoviendo(indice);
  }

  /** Arrastre con el puntero (ratón, lápiz o dedo): la gráfica marca el racimo de abajo y al soltar ahí queda. */
  function empezarArrastre(indice: number, evento: PointerEvent<HTMLButtonElement>): void {
    if (evento.button !== 0 || !dibujo) return;
    const inicial: Arrastre = { indice, pointerId: evento.pointerId, x: evento.clientX, y: evento.clientY, arrastrando: false, racimo: null };
    setArrastre(inicial);
    let actual = inicial;
    const mover = (movimiento: globalThis.PointerEvent) => {
      if (movimiento.pointerId !== actual.pointerId) return;
      const lejos = Math.hypot(movimiento.clientX - actual.x, movimiento.clientY - actual.y) > UMBRAL_ARRASTRE_PX;
      if (!actual.arrastrando && !lejos) return;
      actual = { ...actual, arrastrando: true, racimo: racimoEn(movimiento.clientX, movimiento.clientY) };
      setArrastre(actual);
    };
    const terminar = (fin: globalThis.PointerEvent) => {
      if (fin.pointerId !== actual.pointerId) return;
      window.removeEventListener("pointermove", mover);
      window.removeEventListener("pointerup", terminar);
      window.removeEventListener("pointercancel", terminar);
      setArrastre(null);
      if (!actual.arrastrando) return;
      // El clic que sigue a soltar no debe volver a elegir el remate.
      suprimirClic.current = true;
      window.setTimeout(() => { suprimirClic.current = false; }, 0);
      const racimo = fin.type === "pointerup" ? racimoEn(fin.clientX, fin.clientY) : null;
      if (racimo !== null) soltar(actual.indice, racimo);
    };
    window.addEventListener("pointermove", mover);
    window.addEventListener("pointerup", terminar);
    window.addEventListener("pointercancel", terminar);
  }

  function cerrar(): void {
    onCerrar(autoguardado.cerrar());
  }

  const estadoGuardado: VistaEstadoGuardado = vista.borrador === "fallido" && guardado.fase === "esperando" && vista.error
    ? { tipo: "error", motivo: vista.error.mensaje, onReintentar: vista.reintentar }
    : vistaDeAutoguardado(guardado, armadoEnPlan ? "Cambios guardados en tu propuesta" : "Tu propuesta quedó sin armado en esta pieza", autoguardado.reintentar);
  const insumos = dibujo ? resumenInsumosGuirnalda(dibujo.insumos, null) : "";
  const remateMovido = indiceDestino !== null && borrador?.remates[indiceDestino] ? indiceDestino : null;
  const cambiaCompra = dibujo && inicio.resuelto && dibujo.globos_por_instancia !== inicio.resuelto.globos_por_instancia;

  return (
    <Dialog.Root open onOpenChange={(abierto) => { if (!abierto) cerrar(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-overlay backdrop-blur-[2px]" />
        <Dialog.Content
          asChild
          {...focoRetorno}
          onKeyDown={atajos}
          onEscapeKeyDown={(evento) => {
            // Escape suelta el remate que se estaba moviendo antes de cerrar el editor.
            if (moviendo !== null) {
              evento.preventDefault();
              volverAlRemate(moviendo);
              setMoviendo(null);
            }
          }}
        >
          <motion.div
            data-testid="editor-armado-guirnalda"
            initial={reducir ? false : { opacity: 0, y: 28 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, ease: [0.23, 1, 0.32, 1] }}
            className="fixed inset-x-0 bottom-0 z-50 flex max-h-[94dvh] flex-col overflow-hidden rounded-t-[1.75rem] border border-borde-suave bg-superficie shadow-[0_24px_64px_var(--sombra)] md:inset-x-4 md:top-1/2 md:bottom-auto md:mx-auto md:h-[min(52rem,calc(100dvh-3rem))] md:max-h-none md:max-w-[68rem] md:-translate-y-1/2 md:rounded-3xl"
          >
            <span aria-hidden="true" className="mx-auto mt-2 block h-1 w-10 shrink-0 rounded-full bg-borde md:hidden" />
            <header className="flex items-start justify-between gap-3 px-4 pb-3 pt-2 md:px-6 md:pt-5">
              <div className="min-w-0">
                <p className="text-xs font-medium text-acento">Armado de la guirnalda</p>
                <Dialog.Title className="mt-0.5 truncate text-lg font-semibold tracking-tight text-texto md:text-xl">
                  {nombreVisible} <span className="font-normal text-texto-suave">{ubicacionCliente(estructura)}</span>
                </Dialog.Title>
                <Dialog.Description className="mt-0.5 text-xs text-texto-suave">Elige el soporte, la forma y el racimo, y lleva los remates a un racimo. Cada cambio se guarda solo.</Dialog.Description>
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

            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain md:grid md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] md:overflow-hidden">
              <section aria-label="Vista previa del armado" data-fase={panel.fase} className="order-1 flex shrink-0 flex-col gap-2 border-y border-borde-suave bg-superficie-suave px-4 py-3 md:min-h-0 md:overflow-y-auto md:border-y-0 md:border-r md:px-6 md:py-4">
                <div className="relative min-h-56 rounded-2xl bg-superficie p-2 ring-1 ring-borde-suave ring-inset md:min-h-64">
                  {panel.fase === "listo" ? (
                    <GraficaGuirnalda
                      resuelto={panel.vista}
                      leyenda={leyenda}
                      etiqueta={`${nombreVisible}: ${panel.vista.nombre.toLowerCase()}`}
                      destino={remateMovido !== null ? { remate: `el remate ${remateMovido + 1}`, onSoltar: (racimo) => soltar(remateMovido, racimo) } : null}
                      resaltado={arrastre?.racimo ?? null}
                      enfocarDestinos={moviendo !== null && !arrastre?.arrastrando}
                      className="h-56 md:h-64"
                    />
                  ) : panel.fase === "cargando" ? (
                    <div className="brillo-carga h-56 rounded-xl md:h-64" aria-hidden="true" />
                  ) : (
                    <div className="grid h-56 place-items-center px-4 text-center text-[13px] text-texto-suave md:h-64">
                      <div className="space-y-2">
                        <p className={`font-medium ${panel.fase === "error" ? "text-error" : "text-texto"}`} data-testid={`vista-guirnalda-${panel.fase}`}>{panel.mensaje}</p>
                        {panel.fase === "error" && panel.reintentable && (
                          <button type="button" onClick={vista.reintentar} className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-semibold text-acento ring-1 ring-acento/40 ring-inset hover:bg-acento-suave focus-visible:outline-2 focus-visible:outline-acento">
                            <RotateCcw className="size-3.5" aria-hidden="true" />Reintentar
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                  {panel.fase === "listo" && panel.actualizando && vista.enVuelo && (
                    <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-superficie px-2 py-0.5 text-[11px] text-texto-suave ring-1 ring-borde-suave" role="status">
                      <LoaderCircle className="size-3 animate-spin text-acento motion-reduce:animate-none" aria-hidden="true" />Dibujando…
                    </span>
                  )}
                </div>
                {/* La frase de Python de un cambio rechazado, o que la vista previa no llegó: siempre montada para que el lector la anuncie. */}
                <p role="status" aria-live="polite" data-testid="rechazo-armado-guirnalda" className="min-h-4 text-xs font-medium text-error empty:hidden">
                  {rechazo && <span className="flex items-start gap-1.5"><TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden="true" />{rechazo} Volví a como estaba.</span>}
                  {!rechazo && panel.fase === "listo" && panel.fallo && (
                    <span className="flex flex-wrap items-center gap-1.5">
                      <TriangleAlert className="size-3.5 shrink-0" aria-hidden="true" />{panel.fallo}
                      <button type="button" onClick={vista.reintentar} className="font-semibold text-acento underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-acento">Reintentar</button>
                    </span>
                  )}
                </p>
                {remateMovido !== null && (
                  <p className="text-xs font-medium text-acento" aria-live="polite">Elige el racimo junto al que va el remate {remateMovido + 1} (flechas y Enter, o suéltalo en la gráfica). Escape cancela.</p>
                )}
                {dibujo && (
                  <div className="space-y-1.5">
                    <p className="text-xs text-texto-suave" data-testid="largo-armado-guirnalda">
                      <span className="font-semibold text-texto">{dibujo.globos_por_instancia} globos</span> · {metros(dibujo.largo_m)} de largo{dibujo.largo_cuerda_m !== dibujo.largo_m ? ` · cuerda de ${metros(dibujo.largo_cuerda_m)}` : ""} · armado ≈ {horas(dibujo.duracion_estimada)} <span className="text-texto-tenue">(estimado)</span>
                    </p>
                    {cambiaCompra && (
                      <p data-testid="cambia-compra-guirnalda" className="flex items-start gap-1.5 text-xs text-texto-suave">
                        <Info className="mt-px size-3.5 shrink-0 text-aviso" aria-hidden="true" />Con este armado la guirnalda lleva {dibujo.globos_por_instancia} globos (hoy {inicio.resuelto!.globos_por_instancia}): cambia la compra y el total.
                      </p>
                    )}
                    <LeyendaPatron leyenda={leyenda} etiqueta="Leyenda del armado" />
                    {insumos && <p data-testid="insumos-armado-guirnalda" className="text-xs text-texto-suave"><span className="font-semibold text-texto">Necesita:</span> {insumos}</p>}
                    {dibujo.avisos.length > 0 && (
                      <ul aria-label="Avisos del armado" className="space-y-0.5 text-xs text-texto-suave">
                        {dibujo.avisos.map((aviso) => <li key={aviso} className="flex gap-1.5"><Info className="mt-px size-3.5 shrink-0 text-texto-tenue" aria-hidden="true" />{aviso}</li>)}
                      </ul>
                    )}
                  </div>
                )}
              </section>
              <section aria-label="Ajustes del armado" className="order-2 shrink-0 px-4 py-4 md:min-h-0 md:overflow-y-auto md:px-6 md:py-5">
                <ControlesGuirnalda
                  borrador={borrador}
                  opciones={vista.opciones}
                  colores={colores}
                  nombrePieza={nombrePieza}
                  onCambiar={cambiar}
                  moviendo={remateMovido}
                  onMover={elegirParaMover}
                  onArrastrar={empezarArrastre}
                  registrarMover={(indice) => (nodo) => {
                    if (nodo) botonesMover.current.set(indice, nodo);
                    else botonesMover.current.delete(indice);
                  }}
                />
              </section>
            </div>

            <PieEditorBouquet
              estado={estadoGuardado}
              avisoRegenerar={aprobada && guardado.fase !== "quieto"}
              puedeQuitar={historia.presente !== null}
              puedeRestablecer={!mismoArmadoGuirnalda(historia.presente, inicio.armado)}
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
