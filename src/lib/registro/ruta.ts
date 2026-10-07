import { configuracion } from "./configuracion";
import { conContexto, contextoActual, contextoDesdeRequest } from "./contexto";
import { deduplicarMensajes } from "./envoltorios";
import { huellaBase64, huellaDataUrl, serializarError } from "./redaccion";
import { auditar, registrar } from "./registro";
import { CABECERA_CONVERSACION, CABECERA_SOLICITUD, type ContextoRegistro, type DatosEntradaUsuario, type NivelRegistro } from "./tipos";

/**
 * `conRegistro(nombreRuta, handler)`: envoltorio de Route Handlers para la segunda pasada. Abre el contexto
 * de correlación, deja `peticion.inicio`/`peticion.fin` (estado, ms) en el general, audita `entrada_usuario`
 * (cuerpo redactado) y `salida` (JSON redactado, o el flujo SSE resumido: texto, eventos, herramientas, fin y
 * errores), registra el error con su pila si el handler lanza (y lo relanza), y añade x-request-id /
 * x-conversacion-id a la respuesta. La respuesta y el error son los mismos que sin el envoltorio.
 */

export interface OpcionesConRegistro {
  /** Vista por defecto si la petición no trae x-vista (p. ej. "guiada" en /api/asistente-guiado). */
  vista?: string;
  auditarEntrada?: boolean;
  auditarSalida?: boolean;
  /** No se lee para auditoría un cuerpo mayor que esto (por defecto 30 MB). */
  maxBytesCuerpo?: number;
}

function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor);
}

async function leerCuerpo(request: Request, maxBytes: number): Promise<{ cuerpo?: unknown; bytes?: number }> {
  const metodo = request.method.toUpperCase();
  if (metodo === "GET" || metodo === "HEAD" || !request.body) return {};
  const longitud = Number(request.headers.get("content-length"));
  const bytes = Number.isFinite(longitud) && longitud > 0 ? longitud : undefined;
  if (bytes !== undefined && bytes > maxBytes) return { bytes, cuerpo: { omitido: "cuerpo demasiado grande para auditar", bytes } };
  const tipo = request.headers.get("content-type") ?? "";
  if (!tipo.includes("json")) return { bytes, cuerpo: { omitido: "cuerpo no JSON", tipoContenido: tipo } };
  try {
    const texto = await request.clone().text();
    try {
      return { bytes: bytes ?? Buffer.byteLength(texto), cuerpo: JSON.parse(texto) as unknown };
    } catch {
      return { bytes: bytes ?? Buffer.byteLength(texto), cuerpo: texto };
    }
  } catch {
    return { bytes };
  }
}

function buscarAdjuntos(valor: unknown, salida: unknown[], profundidad = 0): void {
  if (salida.length >= 20 || profundidad > 5) return;
  if (typeof valor === "string") {
    const huella = huellaDataUrl(valor);
    if (huella) salida.push(huella);
    return;
  }
  if (Array.isArray(valor)) {
    for (const item of valor) buscarAdjuntos(item, salida, profundidad + 1);
    return;
  }
  if (!esObjeto(valor)) return;
  if (typeof valor.base64 === "string" && valor.base64.length > 64) {
    salida.push({ ...huellaBase64(valor.base64), ...(typeof valor.mime === "string" ? { mime: valor.mime } : {}) });
    return;
  }
  for (const interno of Object.values(valor)) buscarAdjuntos(interno, salida, profundidad + 1);
}

function textoUltimoUsuario(cuerpo: Record<string, unknown>): string | undefined {
  const mensajes = Array.isArray(cuerpo.messages) ? cuerpo.messages : Array.isArray(cuerpo.mensajes) ? cuerpo.mensajes : undefined;
  if (mensajes) {
    for (let indice = mensajes.length - 1; indice >= 0; indice -= 1) {
      const mensaje: unknown = mensajes[indice];
      if (!esObjeto(mensaje)) continue;
      const rol = mensaje.role ?? mensaje.rol;
      if (rol !== "user" && rol !== "usuario") continue;
      const contenido = mensaje.content ?? mensaje.texto;
      if (typeof contenido === "string") return contenido;
    }
  }
  for (const clave of ["mensaje", "texto", "prompt", "instruccion", "revisionInstruction"]) {
    if (typeof cuerpo[clave] === "string") return cuerpo[clave] as string;
  }
  return undefined;
}

const CLAVES_ESTADO_CLIENTE = ["estadoGuiado", "brief", "planVigente", "creatividad", "referenceBlueprint", "plan", "alcancePropuesta"];

/** `entrada_usuario` a partir del cuerpo: texto del último mensaje del usuario, adjuntos como hash, estado del cliente. */
export function entradaDesdeCuerpo(metodo: string, cuerpo: unknown, contexto?: ContextoRegistro): DatosEntradaUsuario {
  const datos: DatosEntradaUsuario = { metodo };
  if (cuerpo === undefined) return datos;
  if (!esObjeto(cuerpo)) return { ...datos, cuerpo };
  const texto = textoUltimoUsuario(cuerpo);
  if (texto !== undefined) datos.texto = texto;
  const adjuntos: unknown[] = [];
  buscarAdjuntos(cuerpo, adjuntos);
  if (adjuntos.length) datos.adjuntos = adjuntos;
  const estado: Record<string, unknown> = {};
  for (const clave of CLAVES_ESTADO_CLIENTE) if (cuerpo[clave] !== undefined) estado[clave] = cuerpo[clave];
  if (Object.keys(estado).length) datos.estadoCliente = estado;
  // El historial que el cliente reenvía en cada turno: cada mensaje completo solo la primera vez.
  datos.cuerpo = Array.isArray(cuerpo.messages) ? { ...cuerpo, messages: deduplicarMensajes(cuerpo.messages, contexto) } : cuerpo;
  return datos;
}

function nivelPorEstado(estado: number): NivelRegistro {
  if (estado >= 500) return "error";
  if (estado >= 400) return "warn";
  return "info";
}

const MAX_TEXTO_SSE = 200_000;

/** Observa un flujo SSE sin alterarlo y, al cerrarse (o cancelarse), audita la `salida` resumida. */
export function observadorSse(contexto: ContextoRegistro, inicio: number, estado: number, senal?: AbortSignal): TransformStream<Uint8Array, Uint8Array> {
  const decodificador = new TextDecoder();
  let pendiente = "";
  let bytes = 0;
  let texto = "";
  let fin: unknown;
  let cerrado = false;
  const eventos: Record<string, number> = {};
  const herramientas: unknown[] = [];
  const errores: unknown[] = [];
  const otros: unknown[] = [];
  const procesar = (bloque: string): void => {
    let tipo = "message";
    const lineasDatos: string[] = [];
    for (const linea of bloque.split(/\r?\n/)) {
      if (linea.startsWith("event:")) tipo = linea.slice(6).trim();
      else if (linea.startsWith("data:")) lineasDatos.push(linea.slice(5).replace(/^ /, ""));
    }
    if (!lineasDatos.length) return;
    let carga: unknown = lineasDatos.join("\n");
    try {
      carga = JSON.parse(carga as string) as unknown;
    } catch {
      // Texto plano.
    }
    const tipoCarga = esObjeto(carga) && typeof carga.type === "string" ? carga.type : tipo;
    eventos[tipoCarga] = (eventos[tipoCarga] ?? 0) + 1;
    if (esObjeto(carga) && typeof carga.delta === "string") {
      if (texto.length < MAX_TEXTO_SSE) texto += carga.delta;
    } else if (tipoCarga === "herramienta") {
      if (herramientas.length < 200) herramientas.push(carga);
    } else if (tipoCarga === "error") {
      if (errores.length < 50) errores.push(carga);
    } else if (tipoCarga === "fin") {
      fin = carga;
    } else if (otros.length < 50) {
      otros.push(carga);
    }
  };
  const cerrar = (cancelada: boolean): void => {
    if (cerrado) return;
    cerrado = true;
    try {
      const ms = performance.now() - inicio;
      auditar("salida", {
        estado,
        tipoContenido: "text/event-stream",
        texto,
        eventos,
        ...(herramientas.length ? { herramientas } : {}),
        ...(fin !== undefined ? { fin } : {}),
        ...(errores.length ? { errores } : {}),
        ...(otros.length ? { cuerpo: { otrosEventos: otros } } : {}),
        bytes,
        ms: Math.round(ms),
        ...(cancelada ? { cancelada: true } : {}),
      }, { contexto, ms });
    } catch {
      // Nunca lanza.
    }
  };
  senal?.addEventListener("abort", () => setTimeout(() => cerrar(true), 1_000), { once: true });
  const transformador: Transformer<Uint8Array, Uint8Array> & { cancel?: (razon: unknown) => void } = {
    transform(fragmento, controlador) {
      controlador.enqueue(fragmento);
      try {
        bytes += fragmento.byteLength;
        pendiente += decodificador.decode(fragmento, { stream: true });
        let separador = /\r?\n\r?\n/.exec(pendiente);
        while (separador) {
          procesar(pendiente.slice(0, separador.index));
          pendiente = pendiente.slice(separador.index + separador[0].length);
          separador = /\r?\n\r?\n/.exec(pendiente);
        }
        if (pendiente.length > 5_000_000) pendiente = "";
      } catch {
        // Observar nunca rompe el flujo.
      }
    },
    flush() {
      try {
        if (pendiente.trim()) procesar(pendiente);
      } catch {
        // Nada.
      }
      cerrar(false);
    },
    cancel() {
      cerrar(true);
    },
  };
  return new TransformStream<Uint8Array, Uint8Array>(transformador);
}

function anadirCabeceras(respuesta: Response, contexto: ContextoRegistro): void {
  try {
    if (!respuesta.headers.has(CABECERA_SOLICITUD)) respuesta.headers.set(CABECERA_SOLICITUD, contexto.solicitud);
    if (contexto.conversacion && !respuesta.headers.has(CABECERA_CONVERSACION)) respuesta.headers.set(CABECERA_CONVERSACION, contexto.conversacion);
  } catch {
    // Cabeceras inmutables (respuesta reenviada): se deja como está.
  }
}

function observarSalida(respuesta: Response, contexto: ContextoRegistro, inicio: number, senal: AbortSignal): Response {
  const tipoContenido = respuesta.headers.get("content-type") ?? "";
  const ms = performance.now() - inicio;
  try {
    if (tipoContenido.includes("text/event-stream") && respuesta.body) {
      const observado = respuesta.body.pipeThrough(observadorSse(contexto, inicio, respuesta.status, senal));
      return new Response(observado, { status: respuesta.status, statusText: respuesta.statusText, headers: respuesta.headers });
    }
    if (respuesta.body && tipoContenido.includes("json")) {
      const copia = respuesta.clone();
      void copia.text().then(
        (texto) => {
          let cuerpo: unknown = texto;
          try {
            cuerpo = JSON.parse(texto) as unknown;
          } catch {
            // Se audita el texto.
          }
          auditar("salida", { estado: respuesta.status, tipoContenido, cuerpo, ms: Math.round(ms) }, { contexto, ms });
        },
        () => auditar("salida", { estado: respuesta.status, tipoContenido, ms: Math.round(ms), cuerpo: { omitido: "no legible" } }, { contexto, ms }),
      );
      return respuesta;
    }
    const longitud = Number(respuesta.headers.get("content-length"));
    auditar("salida", { estado: respuesta.status, tipoContenido, ...(Number.isFinite(longitud) && longitud > 0 ? { bytes: longitud } : {}), ms: Math.round(ms) }, { contexto, ms });
  } catch {
    // La respuesta sale igual.
  }
  return respuesta;
}

export function conRegistro<A extends unknown[]>(
  nombreRuta: string,
  handler: (request: Request, ...resto: A) => Promise<Response> | Response,
  opciones: OpcionesConRegistro = {},
): (request: Request, ...resto: A) => Promise<Response> {
  return async (request: Request, ...resto: A): Promise<Response> => {
    // Fuera de Next (scripts de tsx que importan la ruta) el registro está inactivo: la ruta corre tal cual.
    if (!configuracion().activo) return handler(request, ...resto);
    const inicio = performance.now();
    let metodo = "GET";
    let contexto: ContextoRegistro;
    let leido: { cuerpo?: unknown; bytes?: number } = {};
    try {
      metodo = request.method.toUpperCase();
      if (opciones.auditarEntrada !== false) leido = await leerCuerpo(request, opciones.maxBytesCuerpo ?? 30 * 1024 * 1024);
      contexto = contextoDesdeRequest(request, leido.cuerpo, { ruta: nombreRuta, vista: opciones.vista });
    } catch {
      return handler(request, ...resto);
    }
    return conContexto(contexto, async () => {
      const vigente = contextoActual() ?? contexto;
      try {
        registrar("info", "peticion.inicio", { metodo, ...(leido.bytes !== undefined ? { bytes: leido.bytes } : {}), entorno: configuracion().entorno });
        if (opciones.auditarEntrada !== false && metodo !== "GET" && metodo !== "HEAD") {
          auditar("entrada_usuario", entradaDesdeCuerpo(metodo, leido.cuerpo, vigente), { contexto: vigente });
        }
      } catch {
        // El handler corre igual.
      }
      let respuesta: Response;
      try {
        respuesta = await handler(request, ...resto);
      } catch (error) {
        const ms = performance.now() - inicio;
        registrar("error", "peticion.error", { metodo }, { error, ms });
        auditar("error", { origen: nombreRuta, error: serializarError(error) }, { contexto: vigente, ms });
        throw error;
      }
      try {
        const ms = performance.now() - inicio;
        registrar(nivelPorEstado(respuesta.status), "peticion.fin", { metodo, estado: respuesta.status, tipoContenido: respuesta.headers.get("content-type") ?? undefined }, { ms });
        anadirCabeceras(respuesta, vigente);
        if (opciones.auditarSalida === false) return respuesta;
        return observarSalida(respuesta, vigente, inicio, request.signal);
      } catch {
        return respuesta;
      }
    });
  };
}
