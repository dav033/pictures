"use client";

import { useState, type KeyboardEvent } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { motion, useReducedMotion } from "motion/react";
import { Redo2, RotateCcw, Undo2, X } from "lucide-react";
import type { PatronColor, PatronColorResuelto, PintadoPatronColor } from "@/lib/plan/patron-color";
import type { EstructuraResuelta, PlanResuelto } from "@/lib/plan/resuelto";
import type { EstructuraOficial } from "@/lib/plan/estructuras-oficiales";
import { productoCliente, ubicacionCliente } from "@/lib/plan/presentacion-cliente";
import { useFocoDeRetorno } from "@/components/ui/foco-retorno";
import { celdasConPendientes, conPintado, enPropuesta, mismoDiseno, pintadosPendientes, sinPintados } from "./borrador";
import { leyendaPatron } from "./leyenda";
import { ControlesPatron, GaleriaEstilos } from "./ControlesPatron";
import { LienzoPatron, ResumenVistaPatron, type ModoVistaPatron } from "./PanelVistaPatron";
import type { Pincel } from "./GraficaPatron";
import { useVistaPrevia } from "./usarVistaPrevia";

type EstructuraDeclarada = PlanResuelto["plan"]["estructuras"][number];

type Props = {
  onCerrar: () => void;
  /** Plan declarado: la vista previa se pide sobre él. */
  plan: PlanResuelto["plan"];
  estructura: EstructuraResuelta;
  declarada: EstructuraDeclarada;
  oficial?: EstructuraOficial;
  /** Expansión aplicada que ya trae el plan (`plan_resuelto.patrones_color`). */
  resuelto: PatronColorResuelto | null;
  /** Aplica el patrón (o lo quita con `null`); devuelve el mensaje de error o `null` si salió bien. */
  onAplicar: (patron: PatronColor | null) => Promise<string | null>;
};

type Historia = { pasado: PatronColor[]; presente: PatronColor | null; futuro: PatronColor[]; grupo: string | null };

const MAX_HISTORIA = 60;

/**
 * Editor del patrón de color de una pieza (ADR-0028 §13): hoja inferior en
 * móvil, dos columnas en escritorio. A la izquierda lo que devuelve Python
 * (vista pseudo-3D o gráfica numerada con pincel, conteo y avisos); a la
 * derecha los estilos y parámetros del patrón declarativo. Deshacer es local;
 * "Aplicar patrón" pasa por la edición del plan de siempre.
 */
export function EditorPatron({ onCerrar, plan, estructura, declarada, oficial, resuelto, onAplicar }: Props) {
  const reducir = useReducedMotion();
  const focoRetorno = useFocoDeRetorno();
  const inicial = declarada.patron_color ?? null;
  const leyenda = leyendaPatron(declarada.materiales, estructura.lineas);
  const [historia, setHistoria] = useState<Historia>({ pasado: [], presente: inicial, futuro: [], grupo: null });
  const [modo, setModo] = useState<ModoVistaPatron>("vista");
  const [pincel, setPincel] = useState<Pincel>({ material: leyenda.length > 1 ? 1 : 0, alcance: "globo" });
  const [aplicando, setAplicando] = useState(false);
  const [errorAplicar, setErrorAplicar] = useState<string | null>(null);
  const { vista, sugerencia, cargando, error, reintentar } = useVistaPrevia({
    plan,
    estructuraId: estructura.estructura_id,
    // Sin patrón en el plan, el borrador empieza siendo la sugerencia que devuelva Python.
    patron: historia.presente,
    inicial: inicial && resuelto ? resuelto : null,
  });
  const borrador = historia.presente ?? vista?.patron ?? null;
  const puntoDePartida = inicial ?? sugerencia?.patron ?? null;
  const geometria = vista?.geometria ?? (declarada.tipo === "pared" ? "rejilla" : "racimos");
  const globosPorRacimo = borrador?.globos_por_racimo
    ?? (borrador?.base.modo === "espiral" ? borrador.base.racimo.length : vista?.geometria === "racimos" ? vista.columnas : 4);
  const pendientes = borrador && vista ? pintadosPendientes(borrador, vista.patron) : [];
  const celdas = vista ? celdasConPendientes(vista.celdas, pendientes) : null;
  const nombrePieza = oficial?.nombre ?? productoCliente(estructura.nombre);
  const medidas = declarada.medidas;
  const proporcion = medidas?.alto_m && medidas.ancho_m ? medidas.alto_m / medidas.ancho_m : undefined;
  const sinCambios = enPropuesta(borrador, inicial);
  // El conteo a la vista es el de la última respuesta de Python, que puede ir detrás del borrador.
  const conteoEnPropuesta = enPropuesta(vista?.patron, inicial);
  const puedeAplicar = Boolean(borrador) && !aplicando && !error?.patronInvalido && !sinCambios;
  const contexto = {
    participaciones: declarada.materiales.map((material) => material.participacion ?? 0),
    globosPorRacimo,
    referencia: puntoDePartida,
  };

  function cambiar(siguiente: PatronColor, grupo?: string): void {
    setErrorAplicar(null);
    setHistoria((actual) => {
      const presente = actual.presente ?? borrador;
      if (!presente) return { ...actual, presente: siguiente };
      // Un deslizador arrastrado es un solo paso de deshacer.
      if (grupo && grupo === actual.grupo) return { ...actual, presente: siguiente, futuro: [] };
      return { pasado: [...actual.pasado, presente].slice(-MAX_HISTORIA), presente: siguiente, futuro: [], grupo: grupo ?? null };
    });
  }

  function deshacer(): void {
    setHistoria((actual) => {
      const previo = actual.pasado.at(-1);
      const presente = actual.presente ?? borrador;
      if (!previo || !presente) return actual;
      return { pasado: actual.pasado.slice(0, -1), presente: previo, futuro: [presente, ...actual.futuro], grupo: null };
    });
  }

  function rehacer(): void {
    setHistoria((actual) => {
      const [siguiente, ...resto] = actual.futuro;
      const presente = actual.presente ?? borrador;
      if (!siguiente || !presente) return actual;
      return { pasado: [...actual.pasado, presente], presente: siguiente, futuro: resto, grupo: null };
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

  async function aplicar(patron: PatronColor | null): Promise<void> {
    if (aplicando) return;
    setAplicando(true);
    setErrorAplicar(null);
    const fallo = await onAplicar(patron);
    // Si salió bien, la tarjeta cierra el editor con el plan nuevo.
    if (fallo) {
      setErrorAplicar(fallo);
      setAplicando(false);
    }
  }

  function pintar(pintado: PintadoPatronColor): void {
    if (borrador) cambiar(conPintado(borrador, pintado));
  }

  return (
    <Dialog.Root open onOpenChange={(abierto) => { if (!abierto && !aplicando) onCerrar(); }}>
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
                <Dialog.Description className="mt-0.5 text-xs text-texto-suave">Elige un estilo, ajusta sus colores o pinta {declarada.tipo === "pared" ? "globo por globo" : "racimo por racimo"} en la gráfica.</Dialog.Description>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button type="button" onClick={deshacer} disabled={!historia.pasado.length || aplicando} aria-label="Deshacer" title="Deshacer (Ctrl+Z)" className="ui-icon-button">
                  <Undo2 className="size-4" aria-hidden="true" />
                </button>
                <button type="button" onClick={rehacer} disabled={!historia.futuro.length || aplicando} aria-label="Rehacer" title="Rehacer (Ctrl+Shift+Z)" className="ui-icon-button">
                  <Redo2 className="size-4" aria-hidden="true" />
                </button>
                <Dialog.Close disabled={aplicando} aria-label="Cerrar editor de patrón" className="ml-1 grid size-10 place-items-center rounded-xl bg-acento-suave text-texto hover:text-acento focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acento disabled:opacity-50">
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
                  deshabilitado={aplicando}
                />
              </section>
              <section aria-label="Conteo del patrón" className="order-3 shrink-0 border-t border-borde-suave bg-superficie-suave px-4 py-3 empty:hidden md:order-none md:col-start-1 md:row-start-2 md:max-h-72 md:overflow-y-auto md:border-b-0 md:border-r md:px-6 md:pb-4 md:pt-1">
                <ResumenVistaPatron vista={vista} enPropuesta={conteoEnPropuesta} leyenda={leyenda} repeticiones={estructura.repeticiones} modo={modo} cargando={cargando} error={error} onReintentar={reintentar} />
              </section>
              <section aria-label="Ajustes del patrón" className="order-2 shrink-0 px-4 py-4 md:order-none md:col-start-2 md:row-span-2 md:row-start-1 md:min-h-0 md:overflow-y-auto md:px-6 md:py-5">
                {borrador ? (
                  <ControlesPatron
                    patron={borrador}
                    leyenda={leyenda}
                    tipo={declarada.tipo}
                    geometria={geometria}
                    contexto={contexto}
                    onCambiar={cambiar}
                    deshabilitado={aplicando}
                  />
                ) : error && !cargando ? (
                  // Python no pudo sugerir un patrón para esta pieza (p. ej. un
                  // color con tan poca participación que el preset lo deja sin
                  // globos): el decorador elige el estilo y Python lo valida.
                  <div className="@container">
                    <GaleriaEstilos patron={null} tipo={declarada.tipo} contexto={contexto} onCambiar={cambiar} deshabilitado={aplicando} />
                  </div>
                ) : (
                  <div className="space-y-2" aria-hidden="true">
                    {[0, 1, 2].map((indice) => <div key={indice} className="brillo-carga h-14 rounded-xl" />)}
                  </div>
                )}
              </section>
            </div>

            <footer className="border-t border-borde-suave bg-superficie px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] pt-3 md:px-6 md:pb-4">
              {errorAplicar && <p role="alert" className="mb-2 rounded-xl bg-error-suave px-3 py-2 text-xs font-medium text-error">{errorAplicar}</p>}
              <div className="flex flex-wrap items-center justify-between gap-2">
                {inicial ? (
                  <button type="button" onClick={() => void aplicar(null)} disabled={aplicando} aria-label="Quitar patrón" className="h-10 rounded-[0.8rem] px-2.5 text-[13px] font-medium text-texto-suave hover:bg-error-suave hover:text-error focus-visible:outline-2 focus-visible:outline-acento disabled:opacity-50 sm:px-3">
                    {/* En 360 px los tres botones caben en una fila solo con la etiqueta corta. */}
                    Quitar<span className="hidden sm:inline"> patrón</span>
                  </button>
                ) : <span className="text-xs text-texto-suave">{borrador ? "Aún no está en tu propuesta: aplícalo para que cuente en tu cotización." : ""}</span>}
                <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
                  <button
                    type="button"
                    onClick={() => { if (puntoDePartida) cambiar(puntoDePartida); }}
                    disabled={!puntoDePartida || !borrador || aplicando || mismoDiseno(borrador, puntoDePartida)}
                    className="inline-flex h-10 items-center gap-1.5 rounded-[0.8rem] px-2 text-[13px] font-medium text-texto-suave hover:bg-superficie-2 hover:text-texto focus-visible:outline-2 focus-visible:outline-acento disabled:opacity-40 sm:px-3"
                  >
                    <RotateCcw className="size-3.5" aria-hidden="true" />Restablecer
                  </button>
                  <button type="button" data-testid="aplicar-patron" onClick={() => { if (borrador) void aplicar(borrador); }} disabled={!puedeAplicar} className="ui-button-primary ui-pressable h-10 px-3.5 sm:px-4">
                    {aplicando ? "Aplicando…" : sinCambios ? "Sin cambios" : "Aplicar patrón"}
                  </button>
                </div>
              </div>
            </footer>
          </motion.div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
