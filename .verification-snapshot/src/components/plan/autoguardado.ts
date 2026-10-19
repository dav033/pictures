/**
 * Autoguardado de un control de la propuesta (ADR-0028 §13): el decorador
 * mueve, pinta o arrastra y el cambio llega solo al plan, sin un botón
 * "Aplicar". Este módulo decide CUÁNDO guardar y QUÉ valor; guardar (la
 * edición firmada del plan) lo hace quien lo crea. Sin React: el reloj se
 * inyecta y las pruebas lo manejan con uno falso.
 *
 * - Un cambio espera `esperaMs` sin otro cambio: un arrastre no son veinte
 *   guardados.
 * - Con `validar`, un borrador solo se guarda cuando su vista previa salió
 *   bien (`validar(valor, { ok: true })`): nunca uno que Python rechazó.
 * - Un guardado a la vez. Lo que cambie mientras tanto se junta y al terminar
 *   se guarda solo lo último. El guardado en vuelo no se cancela: el servidor
 *   ya está firmando un plan.
 * - Lo que el plan ya lleva (`iguales`) no se vuelve a guardar.
 * - Si un guardado falla, el plan se queda como estaba y el motivo queda a la
 *   vista con `reintentar`; otro cambio lo vuelve a intentar solo.
 * - `cerrar` guarda ya lo que esperaba (sin esperar la vista previa: el
 *   servidor valida igual y su rechazo vuelve como error) y resuelve cuando no
 *   queda nada por guardar, con el resumen de la sesión. Lo que no llegó por
 *   un fallo (no por un rechazo) vuelve en el resumen para reintentarlo.
 * - `alPendiente` avisa cuando hay algo sin guardar todavía (esperando o
 *   guardándose): aprobar la propuesta tiene que esperarlo.
 */

/** Programa `accion` dentro de `ms` y devuelve cómo cancelarla. */
export type Reloj = (accion: () => void, ms: number) => () => void;

export type FaseAutoguardado =
  /** Nada que decir: sin cambios en esta sesión o todos iguales al plan. */
  | "quieto"
  /** Hay un cambio esperando la pausa o su vista previa. */
  | "esperando"
  | "guardando"
  /** Lo último quedó en el plan. */
  | "guardado"
  /** El borrador actual no se guarda: su vista previa lo rechazó. Espera otro cambio. */
  | "rechazado"
  /** El último guardado falló; el plan sigue como estaba. */
  | "error";

export type EstadoAutoguardado = {
  fase: FaseAutoguardado;
  /** Por qué no se guardó (fases `rechazado` y `error`). */
  motivo: string | null;
  /** Guardados que salieron bien en esta sesión. */
  guardados: number;
};

export type ResumenAutoguardado<T = unknown> = {
  guardados: number;
  /** Motivo si lo último que pidió el decorador no quedó en el plan. */
  error: string | null;
  /** Lo último que no quedó por un fallo que vale la pena reintentar (no un rechazo de la vista previa). */
  sinGuardar: { valor: T } | null;
};

export type ResultadoValidacion = { ok: true } | { ok: false; motivo: string };

export type OpcionesAutoguardado<T> = {
  /** Lo que el plan lleva al empezar. */
  enPlan: T;
  /** Mismo valor para el plan (declarativo: `mismoDiseno` en los patrones). */
  iguales: (a: T, b: T) => boolean;
  /** Edita el plan; resuelve `null` si quedó guardado o el motivo si no. */
  guardar: (valor: T) => Promise<string | null>;
  /** Pausa sin cambios antes de guardar. */
  esperaMs: number;
  /** Los borradores esperan `validar(valor, { ok: true })` antes de guardarse. */
  validar?: boolean;
  /** Motivo cuando `guardar` falla sin decir por qué. */
  respaldo?: string;
  reloj?: Reloj;
  /** Empieza (`true`) o termina (`false`) un cambio sin guardar todavía: fases `esperando` y `guardando`. */
  alPendiente?: (pendiente: boolean) => void;
};

export type Autoguardado<T> = {
  estado: () => EstadoAutoguardado;
  suscribir: (oyente: () => void) => () => void;
  /** El decorador cambió el valor. `inmediato` salta la pausa; `valido` no espera vista previa. */
  cambiar: (valor: T, opciones?: { inmediato?: boolean; valido?: boolean }) => void;
  /** Resultado de la vista previa de `valor` (se ignora si ya no es el borrador). */
  validar: (valor: T, resultado: ResultadoValidacion) => void;
  /** Vuelve a intentar el guardado que falló. */
  reintentar: () => void;
  /** El plan cambió por fuera (otra edición, deshacer): lo que lleva ahora. */
  sincronizar: (enPlan: T) => void;
  /** Guarda ya lo pendiente; resuelve cuando no queda nada en vuelo. */
  cerrar: () => Promise<ResumenAutoguardado<T>>;
  /** Otra función de guardado para los próximos guardados (la del último render). */
  usarGuardar: (guardar: (valor: T) => Promise<string | null>) => void;
};

const RESPALDO = "No se pudo guardar el cambio.";

/** Algo del decorador todavía no está en el plan. */
function pendiente(fase: FaseAutoguardado): boolean {
  return fase === "esperando" || fase === "guardando";
}

export const relojNavegador: Reloj = (accion, ms) => {
  const id = setTimeout(accion, ms);
  return () => clearTimeout(id);
};

type Validez = "pendiente" | "valido" | "rechazado";
type Borrador<T> = { valor: T; validez: Validez; motivo: string | null };

export function crearAutoguardado<T>(opciones: OpcionesAutoguardado<T>): Autoguardado<T> {
  const { iguales, esperaMs, validar: requiereValidacion = false, respaldo = RESPALDO, reloj = relojNavegador, alPendiente } = opciones;
  let enPlan = opciones.enPlan;
  let guardar = opciones.guardar;
  /** Último cambio que todavía no salió hacia el plan. */
  let borrador: Borrador<T> | null = null;
  /**
   * Último valor recibido: el mismo objeto dos veces (un efecto que se repite)
   * no es un cambio. Vale mientras el plan no cambie por fuera: tras un
   * "Deshacer", volver a elegir ese mismo valor sí es un cambio.
   */
  let ultimo: { valor: T } | null = null;
  let enVuelo = false;
  let pausaCumplida = false;
  let cancelarPausa: (() => void) | null = null;
  let fallido: { valor: T; motivo: string } | null = null;
  let guardados = 0;
  let cerrado = false;
  let alTerminar: Array<(resumen: ResumenAutoguardado<T>) => void> = [];
  let instantanea: EstadoAutoguardado = { fase: "quieto", motivo: null, guardados: 0 };
  const oyentes = new Set<() => void>();

  function calcular(): EstadoAutoguardado {
    if (enVuelo) return { fase: "guardando", motivo: null, guardados };
    if (borrador?.validez === "rechazado") return { fase: "rechazado", motivo: borrador.motivo, guardados };
    if (borrador) return { fase: "esperando", motivo: null, guardados };
    if (fallido) return { fase: "error", motivo: fallido.motivo, guardados };
    return { fase: guardados > 0 ? "guardado" : "quieto", motivo: null, guardados };
  }

  function emitir(): void {
    const siguiente = calcular();
    if (siguiente.fase === instantanea.fase && siguiente.motivo === instantanea.motivo && siguiente.guardados === instantanea.guardados) return;
    const antes = pendiente(instantanea.fase);
    instantanea = siguiente;
    if (pendiente(siguiente.fase) !== antes) alPendiente?.(!antes);
    for (const oyente of oyentes) oyente();
  }

  function quitarPausa(): void {
    cancelarPausa?.();
    cancelarPausa = null;
  }

  function revisarFin(): void {
    if (!cerrado || enVuelo || (borrador && borrador.validez !== "rechazado")) return;
    const resumen: ResumenAutoguardado<T> = {
      guardados,
      error: fallido?.motivo ?? borrador?.motivo ?? null,
      sinGuardar: fallido ? { valor: fallido.valor } : null,
    };
    const pendientes = alTerminar;
    alTerminar = [];
    for (const resolver of pendientes) resolver(resumen);
  }

  function enviar(valor: T): void {
    enVuelo = true;
    let pedido: Promise<string | null>;
    try {
      pedido = guardar(valor);
    } catch {
      pedido = Promise.resolve(respaldo);
    }
    pedido
      .then((motivo) => motivo, () => respaldo)
      .then((motivo) => {
        enVuelo = false;
        if (motivo === null) {
          enPlan = valor;
          guardados += 1;
          fallido = null;
        } else if (!borrador) {
          fallido = { valor, motivo };
        }
        // Con un cambio más nuevo esperando, ese es el que cuenta: se guarda a continuación.
        intentar();
      });
  }

  function intentar(): void {
    if (!enVuelo && borrador) {
      if (iguales(borrador.valor, enPlan)) {
        borrador = null;
      } else if (pausaCumplida || cerrado) {
        const listo = borrador.validez === "valido" || (cerrado && borrador.validez === "pendiente");
        if (listo) {
          const { valor } = borrador;
          borrador = null;
          enviar(valor);
        }
      }
    }
    emitir();
    revisarFin();
  }

  return {
    estado: () => instantanea,
    suscribir(oyente) {
      oyentes.add(oyente);
      return () => oyentes.delete(oyente);
    },
    cambiar(valor, { inmediato = false, valido = false } = {}) {
      if (cerrado || (ultimo && ultimo.valor === valor)) return;
      ultimo = { valor };
      fallido = null;
      borrador = { valor, validez: !requiereValidacion || valido ? "valido" : "pendiente", motivo: null };
      quitarPausa();
      pausaCumplida = inmediato;
      if (!inmediato) {
        cancelarPausa = reloj(() => {
          cancelarPausa = null;
          pausaCumplida = true;
          intentar();
        }, esperaMs);
      }
      intentar();
    },
    validar(valor, resultado) {
      if (cerrado || !borrador || !iguales(borrador.valor, valor)) return;
      borrador = resultado.ok ? { ...borrador, validez: "valido", motivo: null } : { ...borrador, validez: "rechazado", motivo: resultado.motivo };
      intentar();
    },
    reintentar() {
      if (cerrado || !fallido || enVuelo || borrador) return;
      borrador = { valor: fallido.valor, validez: "valido", motivo: null };
      fallido = null;
      quitarPausa();
      pausaCumplida = true;
      intentar();
    },
    sincronizar(valor) {
      if (!iguales(valor, enPlan)) ultimo = null;
      // Mientras un guardado vuela, el plan que cuenta es el que ese guardado firme.
      if (enVuelo) return;
      enPlan = valor;
      intentar();
    },
    cerrar() {
      if (!cerrado) {
        cerrado = true;
        quitarPausa();
        pausaCumplida = true;
        intentar();
      }
      return new Promise<ResumenAutoguardado<T>>((resolver) => {
        alTerminar.push(resolver);
        revisarFin();
      });
    },
    usarGuardar(siguiente) {
      guardar = siguiente;
    },
  };
}
