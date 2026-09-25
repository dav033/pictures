"use client";

import { useEffect, useState, type KeyboardEvent } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { motion, useReducedMotion } from "motion/react";
import { Redo2, Undo2, X } from "lucide-react";
import type { ModoPatronColor, PatronColor, PatronColorResuelto, PintadoPatronColor } from "@/lib/plan/patron-color";
import type { EstructuraResuelta, PlanResuelto } from "@/lib/plan/resuelto";
import type { EstructuraOficial } from "@/lib/plan/estructuras-oficiales";
import { productoCliente, ubicacionCliente } from "@/lib/plan/presentacion-cliente";
import { useFocoDeRetorno } from "@/components/ui/foco-retorno";
import type { ResumenAutoguardado } from "../autoguardado";
import { useAutoguardado } from "../usarAutoguardado";
import { vistaDeAutoguardado, type VistaEstadoGuardado } from "../EstadoGuardado";
import { borradorALaVista, celdasConPendientes, conPintado, enPropuesta, mismoDiseno, pintadosPendientes, sinPintados } from "./borrador";
import { leyendaPatron } from "./leyenda";
import { ControlesPatron, GaleriaEstilos } from "./ControlesPatron";
import { LienzoPatron, ResumenVistaPatron, type ModoVistaPatron } from "./PanelVistaPatron";
import type { Pincel } from "./GraficaPatron";
import { avisosDelCambioDeEstilo, useArranqueEstilo, useVistaPrevia } from "./usarVistaPrevia";
import { PieEditorPatron } from "./PieEditorPatron";

type EstructuraDeclarada = PlanResuelto["plan"]["estructuras"][number];

type Props = {
  /** Cierra el editor; `fin` resuelve cuando termina lo que quedaba por guardar. */
  onCerrar: (fin: Promise<ResumenAutoguardado<PatronColor | null>>) => void;
  /** Plan declarado: la vista previa se pide sobre el que había al abrir. */
  plan: PlanResuelto["plan"];
  estructura: EstructuraResuelta;
  /** La estructura del plan de ahora: su `patron_color` es lo que ya está guardado. */
  declarada: EstructuraDeclarada;
  oficial?: EstructuraOficial;
  /** Expansión aplicada que traía el plan al abrir (`plan_resuelto.patrones_color`). */
  resuelto: PatronColorResuelto | null;
  /** Guarda el patrón en la propuesta (o lo quita con `null`); resuelve el motivo si no se guardó. */
  onGuardar: (patron: PatronColor | null) => Promise<string | null>;
  /** La propuesta estaba aprobada: la imagen no se regenera sola. */
  aprobada?: boolean;
};

/** `presente: null` = la pieza sin patrón (se ve la sugerencia de Python, que no está en el plan hasta que el decorador la toca). */
type Historia = { pasado: (PatronColor | null)[]; presente: PatronColor | null; futuro: (PatronColor | null)[]; grupo: string | null };

const MAX_HISTORIA = 60;
/** Pausa sin cambios antes de guardar: un arrastre o varios toques seguidos son un solo guardado. */
const ESPERA_GUARDADO_MS = 700;

/**
 * Editor del patrón de color de una pieza (ADR-0028 §13): hoja inferior en
 * móvil, dos columnas en escritorio. A la izquierda lo que devuelve Python
 * (vista pseudo-3D o gráfica numerada con pincel, conteo y avisos); a la
 * derecha los estilos y parámetros del patrón declarativo.
 *
 * Sin botón "Aplicar": cada borrador que Python dibuja sin rechazo se guarda
 * solo en la propuesta tras una pausa corta (`useAutoguardado`), por la misma
 * edición del plan de siempre. Deshacer y rehacer son locales y lo que dejan
 * también se guarda. Abrir para mirar no cambia la propuesta: la sugerencia
 * de Python ("Crear patrón") es solo una vista hasta que el decorador la
 * retoca o pulsa "Usar sugerencia", y cerrar sin tocar nada no guarda nada.
 * "Quitar patrón" guarda la pieza sin patrón al instante.
 *
 * Los estilos, sus direcciones y el espejo son los que Python admite para la
 * pieza (`modos_admitidos`); elegir otro estilo pide a Python su punto de
 * partida y esa respuesta es el borrador nuevo.
 */
export function EditorPatron({ onCerrar, plan, estructura, declarada, oficial, resuelto, onGuardar, aprobada = false }: Props) {
  const reducir = useReducedMotion();
  const focoRetorno = useFocoDeRetorno();
  // Lo que había al abrir: "Restablecer" vuelve aquí y la vista previa se pide sobre ese plan y lo que compraba la pieza.
  const [inicio] = useState(() => ({
    patron: declarada.patron_color ?? null,
    resuelto,
    pieza: { plan, estructuraId: estructura.estructura_id, lineas: estructura.lineas },
  }));
  const patronEnPlan = declarada.patron_color ?? null;
  const [historia, setHistoria] = useState<Historia>({ pasado: [], presente: inicio.patron, futuro: [], grupo: null });
  const [modo, setModo] = useState<ModoVistaPatron>("vista");
  const [pincel, setPincel] = useState<Pincel>({ material: declarada.materiales.length > 1 ? 1 : 0, alcance: "globo" });
  // Lo que Python avisó al armar el último estilo elegido (lo que quitó del borrador): va junto a los estilos.
  const [avisosEstilo, setAvisosEstilo] = useState<{ modo: ModoPatronColor; avisos: string[] } | null>(null);
  const { vista, modos, cargando, error, estadoBorrador, reintentar, sembrar } = useVistaPrevia({
    pieza: inicio.pieza,
    patron: historia.presente,
    inicial: inicio.patron && inicio.resuelto ? inicio.resuelto : null,
  });
  // Cada número con el color que Python le dio (lo que se compra), del último dibujo o del plan al abrir.
  const leyenda = leyendaPatron(declarada.materiales, estructura.lineas, vista?.conteo ?? inicio.resuelto?.conteo);
  const { estado: guardado, control: autoguardado } = useAutoguardado<PatronColor | null>({
    enPlan: inicio.patron,
    iguales: mismoDiseno,
    esperaMs: ESPERA_GUARDADO_MS,
    validar: true,
    guardar: onGuardar,
  });
  // Sin patrón en el borrador, los controles parten de la sugerencia a la vista; tocarlos la vuelve del decorador y se guarda.
  const borrador = borradorALaVista(historia.presente, vista);
  const sugerenciaSinUsar = historia.presente === null && estadoBorrador === "listo" && vista !== null ? vista.patron : null;
  const geometria = vista?.geometria ?? (declarada.tipo === "pared" ? "rejilla" : "racimos");
  // En racimos, las `columnas` de lo que dibujó Python son los globos de cada racimo (ADR-0028 §2): la regla es suya.
  // Lo que el decorador acaba de fijar se muestra ya, antes de que Python lo dibuje, para que dos toques seguidos sumen dos.
  const globosPorRacimo = borrador?.globos_por_racimo ?? (vista?.geometria === "racimos" ? vista.columnas : null);
  const pendientes = borrador && vista ? pintadosPendientes(borrador, vista.patron) : [];
  const celdas = vista ? celdasConPendientes(vista.celdas, pendientes) : null;
  const nombrePieza = oficial?.nombre ?? productoCliente(estructura.nombre);
  const medidas = declarada.medidas;
  const proporcion = medidas?.alto_m && medidas.ancho_m ? medidas.alto_m / medidas.ancho_m : undefined;
  // El conteo a la vista es el de la última respuesta de Python, que puede ir detrás del borrador.
  const conteoEnPropuesta = enPropuesta(vista?.patron, patronEnPlan);
  const motivoRechazo = estadoBorrador === "rechazado" ? error?.mensaje ?? null : null;
  // Otro estilo: Python arma su punto de partida desde el borrador (conserva lo que el estilo admite), se dibuja tal cual y pasa a ser el borrador.
  const estilos = useArranqueEstilo({
    pieza: inicio.pieza,
    borrador,
    alLlegar: (detallada) => {
      const avisos = avisosDelCambioDeEstilo(vista, detallada.patron);
      setAvisosEstilo(avisos.length ? { modo: detallada.patron.patron.base.modo, avisos } : null);
      sembrar(detallada);
      cambiar(detallada.patron.patron, undefined, { conservarEstilo: true });
    },
  });
  // El aviso sigue mientras el decorador ajusta ese estilo; deshacer, restablecer u otro estilo lo retiran.
  const avisosDelEstilo = avisosEstilo && borrador?.base.modo === avisosEstilo.modo ? avisosEstilo.avisos : [];
  const eleccionEstilo = {
    onElegir: (modo: ModoPatronColor) => {
      setAvisosEstilo(null);
      estilos.elegir(modo);
    },
    pendiente: estilos.pendiente,
    error: estilos.error,
    avisos: avisosDelEstilo,
  };

  // Cada borrador nuevo va al autoguardado; quitar el patrón no necesita vista previa ni pausa.
  useEffect(() => {
    autoguardado.cambiar(historia.presente, historia.presente === null ? { inmediato: true, valido: true } : undefined);
  }, [autoguardado, historia.presente]);

  // Solo se guarda lo que Python dibujó; lo que rechazó se queda en el editor.
  useEffect(() => {
    if (historia.presente === null) return;
    if (estadoBorrador === "listo") autoguardado.validar(historia.presente, { ok: true });
    else if (motivoRechazo) autoguardado.validar(historia.presente, { ok: false, motivo: motivoRechazo });
  }, [autoguardado, historia.presente, estadoBorrador, motivoRechazo]);

  function cambiar(siguiente: PatronColor | null, grupo?: string, { conservarEstilo = false } = {}): void {
    // El último gesto manda: un estilo que Python todavía estaba armando ya no se pone encima.
    if (!conservarEstilo) estilos.cancelar();
    setHistoria((actual) => {
      // Un deslizador arrastrado es un solo paso de deshacer.
      if (grupo && grupo === actual.grupo) return { ...actual, presente: siguiente, futuro: [] };
      return { pasado: [...actual.pasado, actual.presente].slice(-MAX_HISTORIA), presente: siguiente, futuro: [], grupo: grupo ?? null };
    });
  }

  function deshacer(): void {
    estilos.cancelar();
    setAvisosEstilo(null);
    setHistoria((actual) => {
      const [previo] = actual.pasado.slice(-1);
      if (previo === undefined) return actual;
      return { pasado: actual.pasado.slice(0, -1), presente: previo, futuro: [actual.presente, ...actual.futuro], grupo: null };
    });
  }

  function rehacer(): void {
    estilos.cancelar();
    setAvisosEstilo(null);
    setHistoria((actual) => {
      const [siguiente, ...resto] = actual.futuro;
      if (siguiente === undefined) return actual;
      return { pasado: [...actual.pasado, actual.presente], presente: siguiente, futuro: resto, grupo: null };
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

  function pintar(pintado: PintadoPatronColor): void {
    if (borrador) cambiar(conPintado(borrador, pintado));
  }

  // Cerrar no espera al servidor: lo pendiente se guarda ya y la tarjeta cuenta
  // cómo terminó; lo que no llegó por un fallo lo puede reintentar desde ahí.
  function cerrar(): void {
    onCerrar(autoguardado.cerrar());
  }

  const estadoGuardado: VistaEstadoGuardado = estadoBorrador === "fallido" && guardado.fase === "esperando" && error
    // Sin vista previa (red, servidor) no se sabe si Python lo acepta: reintentar es pedirla otra vez.
    ? { tipo: "error", motivo: error.mensaje, onReintentar: reintentar }
    : vistaDeAutoguardado(guardado, patronEnPlan ? "Cambios guardados en tu propuesta" : "Tu propuesta quedó sin patrón en esta pieza", autoguardado.reintentar);

  return (
    <Dialog.Root open onOpenChange={(abierto) => { if (!abierto) cerrar(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-overlay backdrop-blur-[2px]" />
        <Dialog.Content asChild {...focoRetorno} onKeyDown={atajos}>
          <motion.div
            data-testid="editor-patron"
            initial={reducir ? false : { opacity: 0, y: 28 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, ease: [0.23, 1, 0.32, 1] }}
            className="fixed inset-x-0 bottom-0 z-50 flex max-h-[94dvh] flex-col overflow-hidden rounded-t-[1.75rem] border border-borde-suave bg-superficie shadow-[0_24px_64px_var(--sombra)] md:inset-x-4 md:top-1/2 md:bottom-auto md:mx-auto md:h-[min(54rem,calc(100dvh-3rem))] md:max-h-none md:max-w-[70rem] md:-translate-y-1/2 md:rounded-3xl"
          >
            <span aria-hidden="true" className="mx-auto mt-2 block h-1 w-10 shrink-0 rounded-full bg-borde md:hidden" />
            <header className="flex items-start justify-between gap-3 px-4 pb-3 pt-2 md:px-6 md:pt-5">
              <div className="min-w-0">
                <p className="text-xs font-medium text-acento">Patrón de color</p>
                <Dialog.Title className="mt-0.5 truncate text-lg font-semibold tracking-tight text-texto md:text-xl">
                  {nombrePieza} <span className="font-normal text-texto-suave">{ubicacionCliente(estructura)}</span>
                </Dialog.Title>
                <Dialog.Description className="mt-0.5 text-xs text-texto-suave">Elige un estilo, ajusta sus colores o pinta {declarada.tipo === "pared" ? "globo por globo" : "racimo por racimo"} en la gráfica. Cada cambio se guarda solo.</Dialog.Description>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button type="button" onClick={deshacer} disabled={!historia.pasado.length} aria-label="Deshacer" title="Deshacer (Ctrl+Z)" className="ui-icon-button">
                  <Undo2 className="size-4" aria-hidden="true" />
                </button>
                <button type="button" onClick={rehacer} disabled={!historia.futuro.length} aria-label="Rehacer" title="Rehacer (Ctrl+Shift+Z)" className="ui-icon-button">
                  <Redo2 className="size-4" aria-hidden="true" />
                </button>
                <Dialog.Close aria-label="Cerrar editor de patrón" className="ml-1 grid size-10 place-items-center rounded-xl bg-acento-suave text-texto hover:text-acento focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acento">
                  <X className="size-4" aria-hidden="true" />
                </Dialog.Close>
              </div>
            </header>

            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain md:grid md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] md:grid-rows-[minmax(0,1fr)_auto] md:overflow-hidden">
              {/* En móvil la vista queda fija arriba mientras se desplazan los ajustes; la gráfica, más alta, crece con la hoja (sin un segundo desplazamiento) y su pincel queda fijo arriba. */}
              <section aria-label="Vista previa del patrón" className={`order-1 shrink-0 border-y border-borde-suave bg-superficie-suave px-4 py-2.5 ${modo === "grafica" ? "" : "sticky top-0 z-10 h-[42dvh]"} min-h-64 md:static md:col-start-1 md:row-start-1 md:h-auto md:min-h-0 md:border-y-0 md:border-r md:px-6 md:pb-3 md:pt-4`}>
                <LienzoPatron
                  vista={vista}
                  origen={borrador?.origen}
                  celdas={celdas}
                  leyenda={leyenda}
                  tipo={declarada.tipo}
                  oficialId={oficial?.id ?? declarada.estructura_oficial}
                  espejo={estructura.ubicacion === "lateral_derecho"}
                  proporcion={proporcion}
                  nombrePieza={nombrePieza}
                  modo={modo}
                  onModo={setModo}
                  pincel={pincel}
                  onPincel={setPincel}
                  pintados={borrador?.pintados ?? []}
                  onPintar={pintar}
                  onBorrarPintados={() => { if (borrador) cambiar(sinPintados(borrador)); }}
                  cargando={cargando}
                  error={error}
                  onReintentar={reintentar}
                />
              </section>
              <section aria-label="Conteo del patrón" className="order-3 shrink-0 border-t border-borde-suave bg-superficie-suave px-4 py-3 empty:hidden md:order-none md:col-start-1 md:row-start-2 md:max-h-72 md:overflow-y-auto md:border-b-0 md:border-r md:px-6 md:pb-4 md:pt-1">
                <ResumenVistaPatron vista={vista} avisosAparte={avisosDelEstilo} enPropuesta={conteoEnPropuesta} leyenda={leyenda} repeticiones={estructura.repeticiones} modo={modo} cargando={cargando} error={error} onReintentar={reintentar} />
              </section>
              <section aria-label="Ajustes del patrón" className="order-2 shrink-0 px-4 py-4 md:order-none md:col-start-2 md:row-span-2 md:row-start-1 md:min-h-0 md:overflow-y-auto md:px-6 md:py-5">
                {borrador ? (
                  <ControlesPatron
                    patron={borrador}
                    leyenda={leyenda}
                    modos={modos}
                    geometria={geometria}
                    globosPorRacimo={globosPorRacimo}
                    estilo={eleccionEstilo}
                    onCambiar={cambiar}
                  />
                ) : error && !cargando ? (
                  // Python no pudo sugerir un patrón para esta pieza (p. ej. un
                  // color con tan poca participación que el preset lo deja sin
                  // globos): el decorador elige el estilo y Python arma su punto de partida.
                  <div className="@container">
                    <GaleriaEstilos patron={null} modos={modos} estilo={eleccionEstilo} />
                  </div>
                ) : (
                  <div className="space-y-2" aria-hidden="true">
                    {[0, 1, 2].map((indice) => <div key={indice} className="brillo-carga h-14 rounded-xl" />)}
                  </div>
                )}
              </section>
            </div>

            <PieEditorPatron
              estado={estadoGuardado}
              avisoRegenerar={aprobada && guardado.fase !== "quieto"}
              puedeQuitar={historia.presente !== null}
              // Lo que tenía la pieza al abrir; sin patrón, la sugerencia vuelve a ser solo una vista.
              puedeRestablecer={!mismoDiseno(historia.presente, inicio.patron)}
              tituloRestablecer={inicio.patron ? "Volver al patrón que tenía la pieza al abrir" : "Volver a como estaba al abrir: sin patrón en tu propuesta"}
              onQuitar={() => { setAvisosEstilo(null); cambiar(null); }}
              onRestablecer={() => { setAvisosEstilo(null); cambiar(inicio.patron); }}
              onUsarSugerencia={sugerenciaSinUsar ? () => { setAvisosEstilo(null); cambiar(sugerenciaSinUsar); } : undefined}
              onListo={cerrar}
            />
          </motion.div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
