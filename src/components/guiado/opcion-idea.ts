/**
 * Los chips «Cuánto cuesta» y «Aprender a hacerlo» tras elegir una idea son pasos enlatados: no necesitan al modelo.
 * Antes iban a /api/chat, donde el modelo proponía y Python armaba un plan NUEVO (115 globos) distinto del plan
 * exacto guardado de la idea (101/102): dos cifras para lo mismo y un turno pagado por un paso fijo (REQ-015, D2/D5).
 * Aquí vive su ciclo (ruta, espera del plan exacto, éxito, fallo, reinicio), puro: sin React ni red, para probarlo sin navegador.
 */

export type OpcionEnlatada = "costear" | "comprar" | "aprender" | "contratar";
export type AccionIdea = "costear" | "aprender";

export type RutaOpcionIdea =
  /** Ya hay un plan: la acción se resuelve sobre su tarjeta. */
  | "accion-plan"
  /** Hay una idea elegida y aún no hay plan: se pide el plan exacto de la idea (sin modelo) y luego la acción. */
  | "plan-exacto-de-idea"
  /** Sin idea ni plan, o una opción que ya resuelve la vista por su cuenta: camino de siempre (/api/chat). */
  | "chat";

/** No mira si la idea se puede SUMAR a un plan (figuras, topes): cotizar o aprender una idea no depende de eso. */
export function rutaOpcionIdea(opcion: OpcionEnlatada, contexto: { hayIdea: boolean; hayPlan: boolean; ideaEnElPlan: boolean }): RutaOpcionIdea {
  if (opcion !== "costear" && opcion !== "aprender") return "chat";
  if (contexto.hayPlan) return !contexto.hayIdea || contexto.ideaEnElPlan ? "accion-plan" : "plan-exacto-de-idea";
  return contexto.hayIdea ? "plan-exacto-de-idea" : "chat";
}

/** El chip queda elegido (pastilla) solo cuando su acción se aceptó: el del plan exacto espera a que el plan llegue. */
export function marcarChipAlElegir(ruta: RutaOpcionIdea): boolean {
  return ruta !== "plan-exacto-de-idea";
}

/** La única petición del cliente por chip: la misma si la acción acaba en el turno de siempre. */
export const TEXTO_OPCION_IDEA: Readonly<Record<AccionIdea, (titulo: string | null) => string>> = {
  costear: () => "Quiero saber cuánto cuestan los materiales.",
  aprender: (titulo) => (titulo ? `Quiero aprender a hacerlo: armar «${titulo}» paso a paso.` : "Quiero aprender a hacerlo paso a paso."),
};

/** Cómo terminó el pedido del plan exacto de la idea (`/api/plan-idea` o el motor 3D). */
export type ResultadoPlanIdea = "ok" | "sin-plan-guardado" | "fallo" | "detenido" | "obsoleto";

/**
 * 404 = la idea no tiene plan guardado; 422 = su plan no se puede armar solo (sin globos disponibles): ninguno es un fallo
 * que se arregle reintentando. Un plazo vencido es un fallo, no un «Detener» del cliente.
 */
export function resultadoPlanIdea(intento: { ok: true } | { ok: false; estado: number | null; detenido: boolean }, porTiempo: boolean): Exclude<ResultadoPlanIdea, "obsoleto"> {
  if (intento.ok) return "ok";
  if (intento.detenido && !porTiempo) return "detenido";
  return intento.estado === 404 || intento.estado === 422 ? "sin-plan-guardado" : "fallo";
}

/**
 * Una acción enlatada que espera el plan exacto de su idea: atada al mensaje donde se coloca ESE plan y a la conversación
 * (`sesion`, que «Empezar de nuevo» cambia). `opcionesId`: el mensaje de los chips, que se marca al resolverse.
 */
export type EsperaOpcionIdea = Readonly<{ accion: AccionIdea; ideaId: string; mensajeId: string; sesion: number; opcionesId: string | null }>;

export type EventoOpcionIdea =
  /** Terminó el pedido del plan exacto que se colocaba en `mensajeId`. */
  | { tipo: "resultado"; mensajeId: string; resultado: ResultadoPlanIdea }
  /** Hay un plan vigente nuevo (o ninguno) en la vista. */
  | { tipo: "plan"; mensajeId: string | null; ideas: readonly string[]; sesion: number }
  /** «Empezar de nuevo» / «Limpiar chat». */
  | { tipo: "reinicio" }
  /** El cliente pidió otra cosa (un texto, otra opción): la acción de antes ya no se ejecuta. */
  | { tipo: "otra-accion" };

export type PasoOpcionIdea = {
  espera: EsperaOpcionIdea | null;
  /** Ya se puede resolver sobre el plan, sin otra burbuja del cliente (ya la dijo al tocar el chip). */
  resolver?: EsperaOpcionIdea;
  /**
   * Sin plan guardado (o no se arma sola): la MISMA petición va al servidor con `accionIdea`, que la responde por reglas
   * (precio de su lista curada o sus pasos), sin modelo (D-043).
   */
  turnoReglas?: EsperaOpcionIdea;
  /** Falló o se detuvo: se ofrece repetir ESTA acción, sin modelo; el chip sigue disponible. */
  reintento?: EsperaOpcionIdea;
};

export function avanzarOpcionIdea(espera: EsperaOpcionIdea | null, evento: EventoOpcionIdea): PasoOpcionIdea {
  if (!espera) return { espera: null };
  switch (evento.tipo) {
    case "reinicio":
    case "otra-accion":
      return { espera: null };
    case "resultado":
      if (evento.mensajeId !== espera.mensajeId) return { espera };
      switch (evento.resultado) {
        // El plan ya está (o estará) en su mensaje: lo resuelve el evento «plan», en cualquier orden.
        case "ok": return { espera };
        case "sin-plan-guardado": return { espera: null, turnoReglas: espera };
        case "fallo":
        case "detenido": return { espera: null, reintento: espera };
        case "obsoleto": return { espera: null };
      }
      return { espera: null };
    case "plan":
      if (evento.sesion !== espera.sesion) return { espera: null };
      if (evento.mensajeId !== espera.mensajeId || !evento.ideas.includes(espera.ideaId)) return { espera };
      return { espera: null, resolver: espera };
  }
}

/**
 * La acción de la idea que viaja con el turno: solo con la idea elegida, sin plan y sin alcance de propuesta (lo mismo que
 * exige el contrato); si no, el servidor la rechazaría.
 */
export function accionIdeaDelTurno(pedida: AccionIdea | undefined, contexto: { hayIdea: boolean; hayPlan: boolean; hayAlcance: boolean }): AccionIdea | undefined {
  return pedida && contexto.hayIdea && !contexto.hayPlan && !contexto.hayAlcance ? pedida : undefined;
}

/** Elegir negocio o uso personal con una idea elegida y sin plan sigue su «Cuánto cuesta» por reglas, sin modelo (D-043). */
export function accionIdeaAlElegirUso(contexto: { hayIdea: boolean; hayPlan: boolean; ideaEnElPlan?: boolean }): AccionIdea | undefined {
  return contexto.hayIdea && (!contexto.hayPlan || contexto.ideaEnElPlan === false) ? "costear" : undefined;
}

/** An explicit idea action keeps its selected ID and excludes unrelated plan/proposal context required by the v1 contract. */
export function estadoDelTurnoDeIdea<T extends { planActual?: unknown; motorPlan?: unknown; alcancePropuesta?: unknown; piezaPedida?: unknown }>(estado: T, accion: AccionIdea | undefined, decoracionId: string | undefined) {
  const accionIdea = accionIdeaDelTurno(accion, { hayIdea: Boolean(decoracionId), hayPlan: false, hayAlcance: false });
  if (!accionIdea || !decoracionId) return estado;
  const resto = { ...estado };
  delete resto.planActual;
  delete resto.motorPlan;
  delete resto.alcancePropuesta;
  delete resto.piezaPedida;
  return { ...resto, decoracionId, accionIdea };
}

/** Only appended ideas inherit the existing plan's provenance. An exact replacement owns only its chosen idea. */
export function ideasTrasArmarIdea(idea: { id: string; sumada: boolean } | undefined, anteriores: readonly string[]): string[] {
  return idea ? [...new Set([...(idea.sumada ? anteriores : []), idea.id])].slice(-12) : [];
}
