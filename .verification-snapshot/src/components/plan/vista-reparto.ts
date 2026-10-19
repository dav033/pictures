import { esCancelacion } from "@/lib/plan/peticion-plan-editar";
import { relojNavegador, type FaseAutoguardado, type Reloj } from "./autoguardado";

/**
 * Vista previa en vivo del deslizador "Colores de la pieza" sobre un confeti
 * (ADR-0028 §10 y §13): mientras el decorador arrastra, Python dibuja el
 * reparto que lleva la barra (el mismo `repartir` que guardará la edición) y
 * la pieza cambia de color con él. Este módulo decide CUÁNDO pedir y QUÉ
 * dibujo vale; pedir (la petición a /api/plan-patron) lo hace quien lo crea.
 * Sin React: el reloj se inyecta y las pruebas lo manejan con uno falso.
 *
 * - Una petición a la vez. Lo que cambie mientras tanto se junta y sale solo
 *   lo último (gana el más nuevo); los repartos intermedios nunca se piden.
 *   La petición en vuelo no se cancela por otro cambio: si se cancelara con
 *   cada movimiento, arrastrando no llegaría nunca ninguna.
 * - Entre el comienzo de dos peticiones pasan al menos `intervaloMs`.
 * - Cada respuesta que llega es un dibujo más nuevo que el anterior y se
 *   muestra aunque ya haya otro reparto esperando: así la pieza cambia
 *   durante el arrastre y no solo al final.
 * - `mostrar(null)` (la barra vuelve a mostrar el plan: se guardó, se deshizo,
 *   cambió por fuera o el control se desmontó) cancela lo que vuela y
 *   descarta el dibujo; una respuesta que llegue tarde no cuenta.
 * - Un fallo (red, `sin_patron`, `patron_activo`) deja la vista previa
 *   apagada, sin mensaje: la barra sigue sola con su estimación, como sin
 *   patrón. No se vuelve a pedir hasta que la barra vuelva al plan.
 * - Qué reparto pedir lo decide `repartoADibujar`: uno que no se pudo
 *   guardar deja de dibujarse.
 */

export type EstadoVistaReparto<R> = {
  /** Último dibujo de Python; `null` sin vista previa. */
  vista: R | null;
  /** El reparto que dibuja `vista`. */
  participaciones: readonly number[] | null;
  /** Hay un reparto más nuevo que `vista` pedido o esperando su turno. */
  actualizando: boolean;
  /** La vista previa falló y quedó apagada hasta que la barra vuelva al plan. */
  apagada: boolean;
};

export type OpcionesVistaReparto<R> = {
  /** Pide el dibujo de un reparto (fracciones en el orden de `materiales`). */
  pedir: (participaciones: readonly number[], signal: AbortSignal) => Promise<R>;
  /** Pausa mínima entre el comienzo de dos peticiones. */
  intervaloMs?: number;
  reloj?: Reloj;
  /** Un fallo real (no una cancelación), para registrarlo. */
  alFallar?: (error: unknown) => void;
};

export type VistaReparto<R> = {
  estado: () => EstadoVistaReparto<R>;
  suscribir: (oyente: () => void) => () => void;
  /** Lo que muestra la barra ahora; `null`: lo que ya tiene el plan (sin vista previa). */
  mostrar: (participaciones: readonly number[] | null) => void;
  /** Otra función de pedir para las próximas peticiones (la del último render). */
  usarPedir: (pedir: OpcionesVistaReparto<R>["pedir"]) => void;
};

export const INTERVALO_VISTA_REPARTO_MS = 100;

function iguales(a: readonly number[] | null, b: readonly number[] | null): boolean {
  if (a === null || b === null) return a === b;
  return a.length === b.length && a.every((valor, indice) => valor === b[indice]);
}

/**
 * El reparto que Python dibuja en vivo, o `null` para dibujar el del plan.
 * Solo el que la barra muestra mientras se arrastra o mientras ese cambio
 * espera su pausa o se guarda: un reparto que no se guardó (fase `error`)
 * no se dibuja, porque el bloque del patrón y el resumen mostrarían algo que
 * el plan no tiene y que "Aprobar", "Editar patrón" y la hoja de armado no
 * usan. La barra conserva ese valor, con el motivo y "Reintentar".
 */
export function repartoADibujar(
  mostrados: readonly number[] | null,
  enPlan: readonly number[],
  momento: { arrastrando: boolean; fase: FaseAutoguardado },
): readonly number[] | null {
  if (!mostrados || iguales(mostrados, enPlan)) return null;
  const enCamino = momento.arrastrando || momento.fase === "esperando" || momento.fase === "guardando";
  return enCamino ? mostrados : null;
}

export function crearVistaReparto<R>(opciones: OpcionesVistaReparto<R>): VistaReparto<R> {
  const { intervaloMs = INTERVALO_VISTA_REPARTO_MS, reloj = relojNavegador, alFallar } = opciones;
  let pedir = opciones.pedir;
  /** Lo que muestra la barra (lo que habría que dibujar). */
  let objetivo: readonly number[] | null = null;
  /** Último reparto que salió hacia Python en esta interacción. */
  let pedido: readonly number[] | null = null;
  let enVuelo: { numero: number; controlador: AbortController } | null = null;
  let numero = 0;
  let enfriando = false;
  let vista: { valor: R; participaciones: readonly number[] } | null = null;
  let apagada = false;
  let instantanea: EstadoVistaReparto<R> = { vista: null, participaciones: null, actualizando: false, apagada: false };
  const oyentes = new Set<() => void>();

  function calcular(): EstadoVistaReparto<R> {
    const actualizando = objetivo !== null && !apagada && (enVuelo !== null || !iguales(objetivo, vista?.participaciones ?? null));
    return { vista: vista?.valor ?? null, participaciones: vista?.participaciones ?? null, actualizando, apagada };
  }

  function emitir(): void {
    const siguiente = calcular();
    if (
      siguiente.vista === instantanea.vista
      && siguiente.participaciones === instantanea.participaciones
      && siguiente.actualizando === instantanea.actualizando
      && siguiente.apagada === instantanea.apagada
    ) return;
    instantanea = siguiente;
    for (const oyente of oyentes) oyente();
  }

  function bombear(): void {
    if (apagada || !objetivo || enVuelo || enfriando || iguales(objetivo, pedido)) return;
    const participaciones = objetivo;
    const propio = { numero: ++numero, controlador: new AbortController() };
    enVuelo = propio;
    pedido = participaciones;
    enfriando = true;
    reloj(() => {
      enfriando = false;
      bombear();
    }, intervaloMs);
    let respuesta: Promise<R>;
    try {
      respuesta = pedir(participaciones, propio.controlador.signal);
    } catch (error) {
      respuesta = Promise.reject(error);
    }
    respuesta.then(
      (valor) => {
        // La barra volvió al plan en el camino: este dibujo ya no es de nadie.
        if (enVuelo?.numero !== propio.numero) return;
        enVuelo = null;
        vista = { valor, participaciones };
        emitir();
        bombear();
      },
      (error: unknown) => {
        if (enVuelo?.numero !== propio.numero || esCancelacion(error)) return;
        enVuelo = null;
        vista = null;
        apagada = true;
        alFallar?.(error);
        emitir();
      },
    );
    emitir();
  }

  return {
    estado: () => instantanea,
    suscribir(oyente) {
      oyentes.add(oyente);
      return () => oyentes.delete(oyente);
    },
    mostrar(participaciones) {
      if (participaciones === null) {
        // De vuelta al plan: lo que vuele ya no cuenta y la próxima interacción empieza de cero.
        objetivo = null;
        pedido = null;
        vista = null;
        apagada = false;
        enVuelo?.controlador.abort();
        enVuelo = null;
        emitir();
        return;
      }
      if (iguales(participaciones, objetivo)) return;
      objetivo = [...participaciones];
      bombear();
      emitir();
    },
    usarPedir(siguiente) {
      pedir = siguiente;
    },
  };
}
