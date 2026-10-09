import type { ProductoFeedback } from "@/lib/feedback-ia/contrato";
import type { MotivoId } from "@/lib/feedback-ia/motivos";
import {
  armarEntrada,
  enviarCaptura,
  enviarFeedback,
  sinEscenas,
  tieneEscenas,
  type CapturasTurno,
  type DatosTurno,
  type EscenasTurno,
} from "./cliente-feedback";

/**
 * La lógica de la calificación de UN turno de la IA, sin React (`useCalificacionIA` la conecta): qué se manda, cuándo y cuántas
 * veces. Reglas del contrato (REQ-010):
 *  - las escenas viajan en la MISMA petición que califica, deshace o comenta, y solo una vez por turno;
 *  - las capturas se piden y suben solo entonces (nunca al terminar el turno), una vez por turno, sin bloquear la nota;
 *  - sin almacén (503 ALMACEN_NO_CONFIGURADO) se sigue sin captura; un 413 por el peso de las escenas se reintenta sin ellas;
 *  - dos acciones seguidas no se pisan: se manda una a la vez y la última lleva el estado completo.
 */

export type FaseEnvio = "libre" | "enviando" | "enviado" | "error";

export type EstadoCalificacion = {
  nota: number | null;
  motivos: readonly MotivoId[];
  comentario: string;
  porQueAbierto: boolean;
  deshecho: boolean;
  fase: FaseEnvio;
  /** Ya se guardó una nota o un «por qué»: se muestra «Gracias». */
  gracias: boolean;
};

export type ConfigCalificacion = {
  producto: ProductoFeedback;
  turnoId: string;
  conversacionId?: () => string | undefined;
  /** Se lee al enviar, no al dibujar: así siempre trae lo último. */
  datos: () => DatosTurno;
  escenas?: () => EscenasTurno;
  /** Solo se llama cuando la persona califica, deshace o comenta. */
  capturas?: () => Promise<CapturasTurno>;
  buscar?: typeof fetch;
};

export type ControladorCalificacion = {
  leer: () => EstadoCalificacion;
  suscribir: (oyente: () => void) => () => void;
  calificar: (nota: number) => void;
  alternarPorQue: () => void;
  alternarMotivo: (motivo: MotivoId) => void;
  escribirComentario: (texto: string) => void;
  enviarPorQue: () => void;
  marcarDeshecho: () => void;
  reintentar: () => void;
  /** Pone la configuración más reciente (los datos del turno se leen al enviar, no al crear). */
  usar: (config: ConfigCalificacion) => void;
  /** Resuelve cuando no hay nada en vuelo (las pruebas esperan a que termine lo pendiente). */
  esperar: () => Promise<void>;
};

const INICIAL: EstadoCalificacion = { nota: null, motivos: [], comentario: "", porQueAbierto: false, deshecho: false, fase: "libre", gracias: false };

export function crearControlador(configInicial: ConfigCalificacion): ControladorCalificacion {
  let config = configInicial;
  const oyentes = new Set<() => void>();
  let estado = INICIAL;
  let enVuelo: Promise<void> | null = null;
  let sucio = false;
  let porQueTocado = false;
  let escenasEnviadas = false;
  let capturasPedidas = false;
  let sinAlmacen = false;
  let subida: Promise<void> = Promise.resolve();

  const poner = (cambio: Partial<EstadoCalificacion>) => {
    estado = { ...estado, ...cambio };
    for (const oyente of [...oyentes]) oyente();
  };

  async function subirCapturas(): Promise<void> {
    if (!config.capturas || capturasPedidas || sinAlmacen) return;
    capturasPedidas = true;
    let fallo = false;
    try {
      const capturas = await config.capturas();
      for (const momento of ["antes", "despues"] as const) {
        const imagen = capturas[momento];
        if (!imagen || sinAlmacen) continue;
        const resultado = await enviarCaptura({ turnoId: config.turnoId, producto: config.producto, momento, conversacionId: config.conversacionId?.(), imagen }, config.buscar);
        if (resultado === "sin_almacen") sinAlmacen = true;
        else if (resultado === "error") fallo = true;
      }
    } catch {
      fallo = true;
    }
    // Una captura que no subió se vuelve a intentar con la siguiente acción de la persona.
    if (fallo) capturasPedidas = false;
  }

  async function enviarUna(): Promise<void> {
    const actual = estado;
    const conEscenas = !escenasEnviadas && config.escenas !== undefined;
    const entrada = armarEntrada({
      producto: config.producto,
      turnoId: config.turnoId,
      conversacionId: config.conversacionId?.(),
      datos: config.datos(),
      calificacion: actual.nota,
      ...(porQueTocado ? { motivos: actual.motivos, comentario: actual.comentario } : {}),
      deshecho: actual.deshecho,
      escenas: conEscenas ? config.escenas?.() : undefined,
    });
    if (!entrada) {
      poner({ fase: "libre" });
      return;
    }
    poner({ fase: "enviando" });
    let resultado = await enviarFeedback(entrada, config.buscar);
    // Escenas que no caben en el cuerpo: la nota vale más que ellas.
    if (!resultado.ok && resultado.estado === 413 && tieneEscenas(entrada)) {
      escenasEnviadas = true;
      resultado = await enviarFeedback(sinEscenas(entrada), config.buscar);
    }
    if (!resultado.ok) {
      poner({ fase: "error" });
      return;
    }
    if (tieneEscenas(entrada)) escenasEnviadas = true;
    const guardoOpinion = entrada.calificacion !== undefined || porQueTocado;
    poner({ fase: "enviado", gracias: estado.gracias || guardoOpinion });
    subida = subirCapturas();
  }

  function vaciar(): void {
    if (enVuelo) { sucio = true; return; }
    enVuelo = (async () => {
      try {
        do {
          sucio = false;
          await enviarUna();
        } while (sucio);
      } finally {
        enVuelo = null;
      }
    })();
  }

  return {
    leer: () => estado,
    suscribir(oyente) {
      oyentes.add(oyente);
      return () => { oyentes.delete(oyente); };
    },
    calificar(nota) {
      if (!Number.isInteger(nota) || nota < 1 || nota > 10) return;
      if (estado.nota === nota && estado.fase !== "error") return;
      poner({ nota });
      vaciar();
    },
    alternarPorQue: () => poner({ porQueAbierto: !estado.porQueAbierto }),
    alternarMotivo(motivo) {
      porQueTocado = true;
      poner({ motivos: estado.motivos.includes(motivo) ? estado.motivos.filter((m) => m !== motivo) : [...estado.motivos, motivo] });
    },
    escribirComentario(texto) {
      porQueTocado = true;
      poner({ comentario: texto });
    },
    enviarPorQue() {
      porQueTocado = true;
      poner({ porQueAbierto: false });
      vaciar();
    },
    marcarDeshecho() {
      if (estado.deshecho) return;
      poner({ deshecho: true, porQueAbierto: true });
      vaciar();
    },
    reintentar: vaciar,
    usar(nueva) { config = nueva; },
    async esperar() {
      while (enVuelo) await enVuelo;
      await subida;
    },
  };
}
