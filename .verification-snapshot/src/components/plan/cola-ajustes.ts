/**
 * Las ediciones de una propuesta pasan de una en una, cada una sobre el plan
 * que firmó la anterior. Los controles que guardan solos (deslizadores, editor
 * de patrón) encadenan ediciones sin esperar a que React vuelva a pintar con
 * el plan nuevo: la base sale de aquí, no de la prop, que va un render detrás.
 * Una edición en curso no se cancela (el servidor ya firma); una que falla
 * deja la base como estaba. Sin React.
 */
type Trabajo<P> = (base: P) => Promise<P>;

/**
 * Lo que un "Deshacer" revierte de una vez: una edición suelta o toda una
 * sesión del editor de patrón. Solo se deshace mientras sea lo último que
 * cambió el plan: si otra edición se coló entre las suyas, llegó después o
 * sigue en camino, volver al plan de antes la borraría sin avisar.
 */
export type TramoAjustes<P extends object> = {
  /** Encola una edición del tramo (como `ColaAjustes.encolar`). */
  encolar: (trabajo: Trabajo<P>) => Promise<P>;
  /** Hay algo que deshacer, nada ajeno lo pisó y no queda ninguna edición en camino. */
  deshacible: () => boolean;
  /**
   * Encola la vuelta al plan de antes del tramo. En su turno, si sigue siendo
   * deshacible, `alVolver` publica ese plan; si no, el plan no se toca.
   * Resuelve si se deshizo.
   */
  deshacer: (alVolver: (anterior: P) => void) => Promise<boolean>;
};

export type ColaAjustes<P extends object> = {
  /** Plan sobre el que se hará la próxima edición. */
  base: () => P;
  /** Ediciones en cola o en vuelo. */
  pendientes: () => number;
  /** Corre `trabajo` cuando terminen las anteriores; su plan (resuelto) pasa a ser la base. */
  encolar: (trabajo: Trabajo<P>) => Promise<P>;
  /** Un tramo nuevo, vacío hasta que una de sus ediciones sale bien. */
  tramo: () => TramoAjustes<P>;
  /** Un plan que la tarjeta acaba de publicar fuera de `encolar`. */
  fijar: (plan: P) => void;
  /**
   * El plan que llega por props. Solo cuenta si viene de fuera (el chat armó
   * otro): uno que esta cola ya conoce puede ser un render atrasado respecto
   * de la última edición y no debe pisarla.
   */
  sincronizar: (plan: P) => void;
};

export function crearColaAjustes<P extends object>(inicial: P, alCambiar?: (pendientes: number) => void): ColaAjustes<P> {
  let base = inicial;
  let pendientes = 0;
  let cola: Promise<unknown> = Promise.resolve();
  const conocidos = new WeakSet<P>([inicial]);

  function fijar(plan: P): void {
    base = plan;
    conocidos.add(plan);
  }

  function contar(delta: number): void {
    pendientes += delta;
    alCambiar?.(pendientes);
  }

  /** `alFirmar` recibe la base sobre la que corrió el trabajo y el plan que firmó. */
  function encolar(trabajo: Trabajo<P>, alFirmar?: (desde: P, plan: P) => void): Promise<P> {
    contar(1);
    const turno = cola.then(async () => {
      const desde = base;
      const plan = await trabajo(desde);
      fijar(plan);
      alFirmar?.(desde, plan);
      return plan;
    });
    // La siguiente espera a esta salga bien o mal; el fallo lo recibe quien encoló.
    cola = turno.then(() => contar(-1), () => contar(-1));
    return turno;
  }

  function tramo(): TramoAjustes<P> {
    /** Plan antes de la primera edición del tramo que salió bien (`null`: ninguna todavía). */
    let anterior: P | null = null;
    /** Último plan que firmó el tramo. */
    let ultimo: P | null = null;
    /** Una edición ajena se coló entre dos del tramo: deshacerlo ya no es seguro. */
    let intercalado = false;
    const vigente = (actual: P): boolean => !intercalado && ultimo !== null && actual === ultimo;
    return {
      encolar: (trabajo) => encolar(trabajo, (desde, plan) => {
        if (ultimo === null) anterior = desde;
        else if (desde !== ultimo) intercalado = true;
        ultimo = plan;
      }),
      deshacible: () => pendientes === 0 && vigente(base),
      deshacer(alVolver) {
        let deshecho = false;
        return encolar(async (actual) => {
          if (!vigente(actual) || anterior === null) return actual;
          const vuelta = anterior;
          anterior = null;
          ultimo = null;
          deshecho = true;
          alVolver(vuelta);
          return vuelta;
        }).then(() => deshecho);
      },
    };
  }

  return {
    base: () => base,
    pendientes: () => pendientes,
    encolar: (trabajo) => encolar(trabajo),
    tramo,
    fijar,
    sincronizar(plan) {
      if (!conocidos.has(plan)) fijar(plan);
    },
  };
}

/**
 * Cuántos controles de la tarjeta tienen un cambio que todavía no está en el
 * plan, incluido el que espera su pausa y aún no llegó a la cola. Cada control
 * avisa con su propio `avisador` (lo cuenta una vez, se repita o no el aviso).
 */
export type PendientesAjustes = {
  cantidad: () => number;
  avisador: () => (pendiente: boolean) => void;
};

export function crearPendientesAjustes(alCambiar?: (cantidad: number) => void): PendientesAjustes {
  let cantidad = 0;
  return {
    cantidad: () => cantidad,
    avisador() {
      let marcado = false;
      return (pendiente) => {
        if (pendiente === marcado) return;
        marcado = pendiente;
        cantidad += pendiente ? 1 : -1;
        alCambiar?.(cantidad);
      };
    },
  };
}
