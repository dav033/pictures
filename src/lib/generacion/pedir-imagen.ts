import { z } from "zod";

/**
 * Pide la imagen a /api/generate y, si la respuesta se corta, la recupera antes de volver a pagarla. Del navegador
 * (sin dependencias de servidor); las pruebas inyectan `fetch`, ids, reloj y esperas.
 *
 * Producción, 2026-10-07 (guiada-20261007-071126-x7w4dx): el servidor generó la imagen y respondió 200 en 11 s, pero
 * en el móvil (Firefox Android, 5G) el fetch falló con «NetworkError» y la guiada mostró «No pude dibujarla esta vez».
 * El dueño: «esto de que no se puede dibujar no puede pasar». Ahora:
 *  1. cada intento lleva su id (`x-solicitud-imagen`): el servidor anota la solicitud y guarda la imagen al terminar;
 *  2. un corte (red, tiempo, 5xx) consulta primero /api/generate/recuperar con ese id: si está lista, se usa (sin
 *     pagar otra); si sigue en curso, se espera un poco y se vuelve a preguntar;
 *  3. solo si de verdad no existe, UN reintento silencioso (otro id) antes de dar el error. Un tiempo agotado no se
 *     reintenta solo (ya fueron 90 s de espera): el cliente decide con «Reintentar imagen».
 *  Un rechazo del servidor (4xx: plan sin aprobar, payload inválido…) no se recupera ni se reintenta: daría igual.
 */

export const CABECERA_SOLICITUD_IMAGEN = "x-solicitud-imagen";
export const RUTA_RECUPERAR_IMAGEN = "/api/generate/recuperar";
/** La ruta que hace la imagen de un plan de Python. Un plan del motor 3D va por la suya, que el llamador pasa en `ruta`. */
export const RUTA_GENERAR_IMAGEN = "/api/generate";

/** De /api/generate interesan la imagen (PNG, JPEG o WebP) y su aviso de lo no cotizado. */
export const ImagenGeneradaSchema = z.object({
  imagen: z.string().regex(/^data:image\/(?:png|jpeg|webp);base64,/),
  avisoNoCotizado: z.string().trim().min(1).max(300).optional().catch(undefined),
}).passthrough();

const RecuperacionSchema = z.discriminatedUnion("estado", [
  z.object({ estado: z.literal("lista"), imagen: z.string().regex(/^data:image\/(?:png|jpeg|webp);base64,/), avisoNoCotizado: z.string().trim().min(1).max(300).optional().catch(undefined) }).passthrough(),
  z.object({ estado: z.literal("en_curso") }).passthrough(),
  z.object({ estado: z.literal("fallida") }).passthrough(),
  z.object({ estado: z.literal("no_encontrada") }).passthrough(),
]);

/** Por qué no llegó la imagen. `red`, `tiempo` y `servidor` se consultan antes de rendirse; el resto, no. */
export type ClaseFalloImagen = "red" | "tiempo" | "servidor" | "rechazo" | "respuesta_invalida" | "cancelada";

export class ErrorImagen extends Error {
  readonly clase: ClaseFalloImagen;
  readonly status: number | undefined;
  /** El `codigo` que el servidor puso en su rechazo (`{ error, codigo }`), si lo trajo. */
  readonly codigo: string | undefined;
  constructor(clase: ClaseFalloImagen, mensaje: string, status?: number, codigo?: string) {
    super(mensaje);
    this.name = "ErrorImagen";
    this.clase = clase;
    this.status = status;
    this.codigo = codigo;
  }
}

/** Rechazos 429 que NO son pasajeros aunque el estado lo parezca: otra imagen en un rato, no en un reintento ni en una consulta. */
const CODIGOS_DEFINITIVOS: ReadonlySet<string> = new Set(["TOPE_DE_IMAGENES_NAVEGADOR"]);

const CODIGO_DEL_SERVIDOR = z.object({ codigo: z.string().min(1).max(60) }).passthrough();
async function codigoDeLaRespuesta(respuesta: Response): Promise<string | undefined> {
  try { return CODIGO_DEL_SERVIDOR.safeParse(await respuesta.json() as unknown).data?.codigo; } catch { return undefined; }
}

export type ImagenObtenida = {
  imagen: string;
  avisoNoCotizado?: string;
  /** Cómo llegó: directa, recuperada tras un corte, o en el reintento silencioso. */
  via: "directa" | "recuperada" | "reintento" | "reintento_recuperada";
  solicitudId: string;
  intentos: number;
};

export type DependenciasImagen = {
  fetch: (entrada: string, init?: RequestInit) => Promise<Response>;
  nuevoId: () => string;
  /** Espera `ms` o lanza si `senal` se aborta antes. */
  esperar: (ms: number, senal: AbortSignal) => Promise<void>;
  ahora: () => number;
};

export type OpcionesPedirImagen = {
  /** Qué ruta hace la imagen; por defecto /api/generate (Python). La recuperación tras un corte es la misma para todas. */
  ruta?: string;
  /** Con `false` un corte sin imagen recuperable NO repite la petición (cada intento paga una imagen): el cliente decide con «Reintentar». */
  reintentoSilencioso?: boolean;
  cuerpo: unknown;
  planHash: string;
  /** Cancelación de fuera (empezar de nuevo, otra conversación): corta todo sin recuperar ni reintentar. */
  senal: AbortSignal;
  /** Tope de cada intento de /api/generate. */
  limiteIntentoMs: number;
  /** Cada paso (corte, consulta, recuperación, reintento) para la auditoría de la vista. */
  alEvento?: (evento: string, datos: Record<string, unknown>) => void;
  dependencias?: Partial<DependenciasImagen>;
};

/** Entre consultas mientras la imagen sigue «en curso» o la red todavía no vuelve. */
export const PAUSA_CONSULTA_MS = 2_500;
/** Cuánto se sigue preguntando por una solicitud en curso antes de rendirse (el servidor corta a los 120 s). */
export const ESPERA_RECUPERACION_MS = 100_000;
/** Consultas seguidas que fallan por red antes de darla por perdida. */
export const MAX_CONSULTAS_SIN_RED = 4;
const LIMITE_CONSULTA_MS = 20_000;

function esperarPorDefecto(ms: number, senal: AbortSignal): Promise<void> {
  return new Promise((resolver, rechazar) => {
    if (senal.aborted) { rechazar(senal.reason); return; }
    const alTerminar = () => { senal.removeEventListener("abort", alAbortar); resolver(); };
    const reloj = setTimeout(alTerminar, ms);
    function alAbortar(): void { clearTimeout(reloj); rechazar(senal.reason); }
    senal.addEventListener("abort", alAbortar, { once: true });
  });
}

function dependenciasCompletas(parciales: Partial<DependenciasImagen> | undefined): DependenciasImagen {
  return {
    // Siempre el `fetch` del momento: el interceptor de registro (x-conversacion-id, x-vista) se instala en window.fetch.
    fetch: parciales?.fetch ?? ((entrada, init) => fetch(entrada, init)),
    nuevoId: parciales?.nuevoId ?? (() => crypto.randomUUID()),
    esperar: parciales?.esperar ?? esperarPorDefecto,
    ahora: parciales?.ahora ?? (() => Date.now()),
  };
}

/** Un controlador que se aborta con la señal de fuera o con su propio reloj («tiempo»). */
function senalConTope(exterior: AbortSignal, ms: number): { senal: AbortSignal; vencida: () => boolean; soltar: () => void } {
  const control = new AbortController();
  let vencida = false;
  const alAbortar = () => control.abort(exterior.reason);
  if (exterior.aborted) control.abort(exterior.reason);
  else exterior.addEventListener("abort", alAbortar, { once: true });
  const reloj = setTimeout(() => { vencida = true; control.abort("tiempo"); }, ms);
  return {
    senal: control.signal,
    vencida: () => vencida,
    soltar: () => { clearTimeout(reloj); exterior.removeEventListener("abort", alAbortar); },
  };
}

function textoCausa(causa: unknown): string {
  return causa instanceof Error ? `${causa.name}: ${causa.message}`.slice(0, 300) : String(causa).slice(0, 300);
}

/** 408, 425, 429 y 5xx pueden ser pasajeros (o llegar tras una imagen ya hecha): se consulta antes de rendirse. */
function statusPasajero(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

export async function pedirImagenConRecuperacion(opciones: OpcionesPedirImagen): Promise<ImagenObtenida> {
  const dep = dependenciasCompletas(opciones.dependencias);
  const avisar = (evento: string, datos: Record<string, unknown>) => {
    try { opciones.alEvento?.(evento, datos); } catch { /* El registro nunca cambia el resultado. */ }
  };
  const cuerpo = JSON.stringify(opciones.cuerpo);
  const ruta = opciones.ruta ?? RUTA_GENERAR_IMAGEN;

  async function pedirUna(solicitudId: string): Promise<{ imagen: string; avisoNoCotizado?: string }> {
    const tope = senalConTope(opciones.senal, opciones.limiteIntentoMs);
    const clasificar = (causa: unknown): ErrorImagen => {
      if (causa instanceof ErrorImagen) return causa;
      if (opciones.senal.aborted) return new ErrorImagen("cancelada", "Se canceló la imagen.");
      if (tope.vencida()) return new ErrorImagen("tiempo", `La imagen no llegó en ${Math.round(opciones.limiteIntentoMs / 1000)} s.`);
      // TypeError «NetworkError when attempting to fetch resource» / «Failed to fetch», o un cuerpo cortado a medias.
      return new ErrorImagen("red", textoCausa(causa));
    };
    try {
      const respuesta = await dep.fetch(ruta, {
        method: "POST",
        headers: { "Content-Type": "application/json", [CABECERA_SOLICITUD_IMAGEN]: solicitudId },
        body: cuerpo,
        signal: tope.senal,
      });
      if (!respuesta.ok) {
        const codigo = await codigoDeLaRespuesta(respuesta);
        const pasajero = statusPasajero(respuesta.status) && !(codigo && CODIGOS_DEFINITIVOS.has(codigo));
        throw new ErrorImagen(pasajero ? "servidor" : "rechazo", `${ruta} respondió con estado ${respuesta.status}.`, respuesta.status, codigo);
      }
      let datos: unknown;
      try {
        datos = await respuesta.json() as unknown;
      } catch (causa) {
        throw clasificar(causa);
      }
      const salida = ImagenGeneradaSchema.safeParse(datos);
      if (!salida.success) throw new ErrorImagen("respuesta_invalida", `La respuesta de ${ruta} no trae una imagen válida.`, respuesta.status);
      return { imagen: salida.data.imagen, ...(salida.data.avisoNoCotizado ? { avisoNoCotizado: salida.data.avisoNoCotizado } : {}) };
    } catch (causa) {
      throw clasificar(causa);
    } finally {
      tope.soltar();
    }
  }

  /** Pregunta por la solicitud cortada hasta que esté lista, se sepa que no existe o se acabe la espera. */
  async function recuperar(solicitudId: string, intento: number): Promise<{ imagen: string; avisoNoCotizado?: string } | null> {
    const inicio = dep.ahora();
    const url = `${RUTA_RECUPERAR_IMAGEN}?solicitud=${encodeURIComponent(solicitudId)}&plan=${encodeURIComponent(opciones.planHash)}`;
    let consultas = 0;
    let sinRed = 0;
    let noEncontrada = 0;
    for (;;) {
      if (opciones.senal.aborted) throw new ErrorImagen("cancelada", "Se canceló la imagen.");
      consultas += 1;
      let estado: string;
      const tope = senalConTope(opciones.senal, LIMITE_CONSULTA_MS);
      try {
        const respuesta = await dep.fetch(url, { method: "GET", cache: "no-store", signal: tope.senal });
        if (respuesta.status === 400 || respuesta.status === 503) {
          estado = respuesta.status === 503 ? "no_disponible" : "consulta_invalida";
        } else if (!respuesta.ok) {
          estado = `http_${respuesta.status}`;
          sinRed += 1;
        } else {
          const leida = RecuperacionSchema.safeParse(await respuesta.json() as unknown);
          estado = leida.success ? leida.data.estado : "respuesta_invalida";
          if (leida.success && leida.data.estado === "lista") {
            avisar("imagen.recuperada", { solicitudId, intento, consultas, esperaMs: dep.ahora() - inicio });
            return { imagen: leida.data.imagen, ...(leida.data.avisoNoCotizado ? { avisoNoCotizado: leida.data.avisoNoCotizado } : {}) };
          }
          sinRed = 0;
        }
      } catch (causa) {
        if (opciones.senal.aborted) throw new ErrorImagen("cancelada", "Se canceló la imagen.");
        estado = "sin_red";
        sinRed += 1;
        avisar("imagen.consulta_sin_red", { solicitudId, intento, consultas, causa: textoCausa(causa) });
      } finally {
        tope.soltar();
      }
      avisar("imagen.consulta", { solicitudId, intento, consultas, estado });
      if (estado === "no_encontrada") noEncontrada += 1;
      // «No encontrada» dos veces seguidas: la solicitud de verdad no llegó (la primera puede adelantarse a la anotación).
      const rendirse = estado === "fallida" || estado === "no_disponible" || estado === "consulta_invalida" || estado === "respuesta_invalida"
        || noEncontrada >= 2 || sinRed >= MAX_CONSULTAS_SIN_RED || dep.ahora() - inicio >= ESPERA_RECUPERACION_MS;
      if (rendirse) return null;
      await dep.esperar(PAUSA_CONSULTA_MS, opciones.senal).catch((causa: unknown) => {
        if (opciones.senal.aborted) throw new ErrorImagen("cancelada", "Se canceló la imagen.");
        throw causa;
      });
    }
  }

  let ultimoError: ErrorImagen | null = null;
  const intentosMaximos = opciones.reintentoSilencioso === false ? 1 : 2;
  for (let intento = 1; intento <= intentosMaximos; intento += 1) {
    const solicitudId = dep.nuevoId();
    if (intento === 2) avisar("imagen.reintento_silencioso", { solicitudId, porque: ultimoError?.clase ?? null });
    try {
      const salida = await pedirUna(solicitudId);
      return { ...salida, via: intento === 1 ? "directa" : "reintento", solicitudId, intentos: intento };
    } catch (causa) {
      const error = causa instanceof ErrorImagen ? causa : new ErrorImagen("red", textoCausa(causa));
      ultimoError = error;
      if (error.clase === "cancelada" || error.clase === "rechazo" || error.clase === "respuesta_invalida") throw error;
      avisar("imagen.corte", { solicitudId, intento, clase: error.clase, status: error.status ?? null, causa: error.message });
      const recuperada = await recuperar(solicitudId, intento);
      if (recuperada) return { ...recuperada, via: intento === 1 ? "recuperada" : "reintento_recuperada", solicitudId, intentos: intento };
      // Un tiempo agotado no se repite solo: serían otros 90 s sin aviso.
      if (error.clase === "tiempo") throw error;
    }
  }
  throw ultimoError ?? new ErrorImagen("red", "La imagen no llegó.");
}
