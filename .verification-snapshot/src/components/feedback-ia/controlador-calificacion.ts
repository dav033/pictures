import type { ProductoFeedback } from "@/lib/feedback-ia/contrato";
import type { MotivoId } from "@/lib/feedback-ia/motivos";
import {
  armarEntrada,
  enviarCaptura,
  esEntradaVacia,
  enviarFeedback,
  firmaEscena,
  sinEscenas,
  tieneEscenas,
  type CapturasTurno,
  type DatosTurno,
  type EscenasTurno,
} from "./cliente-feedback";
import { pedirCalificacionGuardada, recordarCalificacion, recordarTurnoNuevo } from "./carga-calificaciones";
import { desmarcarRegistrado, marcarRegistrado, yaRegistrado } from "./registro-turnos";

/**
 * La lógica de la calificación de UN turno de la IA, sin React (`useCalificacionIA` la conecta): qué se manda, cuándo y cuántas
 * veces. Reglas del contrato (REQ-010):
 *  - un turno PRODUCIDO en esta página se registra una vez al terminar (`registrarTerminado`, POST con sus datos y pasos); un turno
 *    RESTAURADO al cargar no se registra nunca: su calificación guardada se pide (GET agrupado, `cargarGuardada`) y se muestra;
 *  - cada POST exitoso recuerda la calificación (`recordarCalificacion`) para que al volver a montar se vea la última;
 *  - las escenas viajan en la MISMA petición que califica, deshace o comenta; una vez por turno y, si la escena de «después» cambió
 *    desde entonces (el plan del cliente llega después del texto), UNA vez más;
 *  - las capturas se piden y suben solo entonces, una vez por turno, sin bloquear la nota;
 *  - sin almacén (503 ALMACEN_NO_CONFIGURADO) se sigue sin captura; un 413 por el peso de las escenas se reintenta sin ellas;
 *  - dos acciones seguidas no se pisan: se manda una a la vez y la última lleva el estado completo;
 *  - un turno calificado desde otro navegador (403 TURNO_AJENO) se deja en paz, sin reintentos.
 */

export type FaseEnvio = "libre" | "enviando" | "enviado" | "error" | "ajeno";

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
  /** `true`: la persona deshizo o corrigió el turno (abre el «por qué»). `false`: lo rehizo. */
  fijarDeshecho: (deshecho: boolean) => void;
  reintentar: () => void;
  /** Pide la calificación que ya se guardó para este turno y, si la persona no ha hecho nada aún, la muestra. */
  cargarGuardada: () => Promise<void>;
  /** Registra el turno producido en esta página (POST sin nota), una sola vez por página. */
  registrarTerminado: () => Promise<void>;
  /** Pone la configuración más reciente (los datos del turno se leen al enviar, no al crear). */
  usar: (config: ConfigCalificacion) => void;
  /** Resuelve cuando no hay nada en vuelo (las pruebas esperan a que termine lo pendiente). */
  esperar: () => Promise<void>;
};

const INICIAL: EstadoCalificacion = { nota: null, motivos: [], comentario: "", porQueAbierto: false, deshecho: false, fase: "libre", gracias: false };
/** Cuántas veces más (además de la primera) se mandan las escenas si la de «después» cambió. */
const REENVIOS_DE_ESCENAS = 1;

export function crearControlador(configInicial: ConfigCalificacion): ControladorCalificacion {
  let config = configInicial;
  const oyentes = new Set<() => void>();
  let estado = INICIAL;
  let enVuelo: Promise<void> | null = null;
  let sucio = false;
  let porQueTocado = false;
  let huboDeshecho = false;
  let escenasEnviadas = false;
  let firmaEnviada = "";
  let reenvios = 0;
  let capturasPedidas = false;
  let sinAlmacen = false;
  let subida: Promise<void> = Promise.resolve();
  let registro: Promise<void> = Promise.resolve();

  const clave = () => `${config.producto}:${config.turnoId}`;
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
    if (actual.fase === "ajeno") return;
    const escenas = config.escenas?.();
    const firma = firmaEscena(escenas?.despues);
    const conEscenas = escenas !== undefined && (!escenasEnviadas || (reenvios < REENVIOS_DE_ESCENAS && firma !== firmaEnviada));
    const entrada = armarEntrada({
      producto: config.producto,
      turnoId: config.turnoId,
      conversacionId: config.conversacionId?.(),
      datos: config.datos(),
      calificacion: actual.nota,
      ...(porQueTocado ? { motivos: actual.motivos, comentario: actual.comentario } : {}),
      deshecho: actual.deshecho ? true : huboDeshecho ? false : undefined,
      escenas: conEscenas ? escenas : undefined,
    });
    if (!entrada || esEntradaVacia(entrada)) {
      poner({ fase: "libre" });
      return;
    }
    poner({ fase: "enviando" });
    let resultado = await enviarFeedback(entrada, config.buscar);
    // Escenas que no caben en el cuerpo: la nota vale más que ellas.
    if (!resultado.ok && resultado.estado === 413 && tieneEscenas(entrada)) {
      escenasEnviadas = true;
      firmaEnviada = firma;
      reenvios = REENVIOS_DE_ESCENAS;
      resultado = await enviarFeedback(sinEscenas(entrada), config.buscar);
    }
    if (!resultado.ok) {
      poner({ fase: resultado.codigo === "TURNO_AJENO" ? "ajeno" : "error" });
      return;
    }
    if (tieneEscenas(entrada)) {
      if (escenasEnviadas) reenvios += 1;
      escenasEnviadas = true;
      firmaEnviada = firma;
    }
    const guardoOpinion = entrada.calificacion !== undefined || porQueTocado;
    poner({ fase: "enviado", gracias: estado.gracias || guardoOpinion });
    recordarCalificacion(config.producto, { turnoId: config.turnoId, calificacion: estado.nota, motivos: [...estado.motivos], comentario: estado.comentario, deshecho: estado.deshecho });
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

  async function cargarGuardada(): Promise<void> {
    const guardada = await pedirCalificacionGuardada(config.producto, config.turnoId, config.buscar);
    // Lo que la persona ya hizo (o está enviando) manda sobre lo guardado.
    if (!guardada || estado.nota !== null || estado.fase !== "libre" || porQueTocado || huboDeshecho) return;
    const { calificacion, motivos, comentario, deshecho } = guardada;
    // Un turno deshecho guardado cuenta como deshecho: si luego lo rehace, ese «rehizo» sí se manda.
    if (deshecho) huboDeshecho = true;
    poner({ nota: calificacion, motivos, comentario, deshecho, gracias: calificacion !== null || motivos.length > 0 || comentario !== "" });
  }

  return {
    leer: () => estado,
    suscribir(oyente) {
      oyentes.add(oyente);
      return () => { oyentes.delete(oyente); };
    },
    calificar(nota) {
      if (!Number.isInteger(nota) || nota < 1 || nota > 10 || estado.fase === "ajeno") return;
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
      if (estado.fase === "ajeno") return;
      porQueTocado = true;
      poner({ porQueAbierto: false });
      vaciar();
    },
    fijarDeshecho(deshecho) {
      if (estado.deshecho === deshecho) return;
      if (deshecho) huboDeshecho = true;
      poner(deshecho ? { deshecho: true, porQueAbierto: true } : { deshecho: false });
      vaciar();
    },
    reintentar: vaciar,
    cargarGuardada,
    registrarTerminado() {
      // Ya registrado en esta página (remontaje): solo se muestra lo que ya se guardó, sin volver a registrar.
      if (yaRegistrado(clave())) return cargarGuardada();
      marcarRegistrado(clave());
      // Sea o no que haya algo que registrar, un turno nuevo no tiene nada guardado: volver a montarlo no lo consulta.
      recordarTurnoNuevo(config.producto, config.turnoId);
      const entrada = armarEntrada({ producto: config.producto, turnoId: config.turnoId, conversacionId: config.conversacionId?.(), datos: config.datos() });
      // Un turno sin pedido ni respuesta no tiene nada que registrar: la primera nota de la persona lo registra con sus datos.
      if (!entrada || esEntradaVacia(entrada)) return registro;
      registro = (async () => {
        const resultado = await enviarFeedback(entrada, config.buscar);
        if (resultado.ok) return;
        // Un fallo de red o de base se vuelve a intentar con el próximo montaje; un turno ajeno se deja.
        if (resultado.codigo === "TURNO_AJENO") poner({ fase: "ajeno" });
        else desmarcarRegistrado(clave());
      })();
      return registro;
    },
    usar(nueva) { config = nueva; },
    async esperar() {
      while (enVuelo) await enVuelo;
      await subida;
      await registro;
    },
  };
}
