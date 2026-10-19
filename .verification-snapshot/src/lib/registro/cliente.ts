/**
 * Registro desde el navegador (vistas clásica y guiada). Solo APIs del navegador: nada de Node ni de
 * `@/lib/registro` de servidor. Envía a POST /api/registro-cliente, que lo deja en el registro general y,
 * si trae id de conversación, en el archivo de auditoría de esa conversación (`accion_cliente` / `error`).
 *
 * Garantías: nunca lanza; máximo ~30 eventos por minuto y pestaña (el resto se cuenta y se informa en el
 * siguiente envío); un fallo al enviar no genera otro evento (sin bucles); sendBeacon cuando existe.
 *
 * Ids de conversación (para la segunda pasada): `obtenerIdConversacion(vista)` crea/lee uno por vista en
 * sessionStorage con forma `<vista>-AAAAMMDD-HHMMSS-<aleatorio>`; `nuevaConversacion(vista)` lo renueva al
 * empezar de cero; `cabecerasConversacion(vista)` da {x-conversacion-id, x-vista} para cada fetch al servidor.
 */
import type { CargaEventoCliente, NivelRegistro } from "./tipos";

const RUTA = "/api/registro-cliente";
const LIMITE_POR_MINUTO = 30;
const MAX_BYTES = 12_000;
const MAX_CADENA = 2_000;
const CLAVE_SESION = "registro:sesion";
const PREFIJO_CONVERSACION = "registro:conversacion:";
const CLAVE_ACTIVA = "registro:conversacion-activa";
const CLAVE_VISTA_ACTIVA = "registro:vista-activa";

let envios: number[] = [];
let suprimidos = 0;
let enviando = false;
let sesionEnMemoria: string | undefined;
const conversacionesEnMemoria = new Map<string, string>();
let activaEnMemoria: string | undefined;
let vistaActivaEnMemoria: string | undefined;
let fetchOriginal: typeof fetch | undefined;

function hayNavegador(): boolean {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

function aleatorio(longitud: number): string {
  try {
    const bytes = new Uint8Array(longitud);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => "abcdefghijkmnpqrstuvwxyz23456789"[byte % 32]).join("");
  } catch {
    return Math.random().toString(36).slice(2, 2 + longitud).padEnd(longitud, "0");
  }
}

function leerAlmacen(clave: string): string | undefined {
  try {
    return window.sessionStorage.getItem(clave) ?? undefined;
  } catch {
    return undefined;
  }
}

function guardarAlmacen(clave: string, valor: string): void {
  try {
    window.sessionStorage.setItem(clave, valor);
  } catch {
    // Modo privado estricto o cuota: se sigue en memoria.
  }
}

/** Id de esta pestaña (sessionStorage): agrupa los eventos de una misma sesión de navegador. */
export function idSesionPestana(): string {
  if (!hayNavegador()) return "servidor";
  const guardada = leerAlmacen(CLAVE_SESION) ?? sesionEnMemoria;
  if (guardada) return guardada;
  const nueva = `pestana-${aleatorio(10)}`;
  sesionEnMemoria = nueva;
  guardarAlmacen(CLAVE_SESION, nueva);
  return nueva;
}

function sello(fecha: Date): string {
  const dos = (numero: number) => String(numero).padStart(2, "0");
  return `${fecha.getFullYear()}${dos(fecha.getMonth() + 1)}${dos(fecha.getDate())}-${dos(fecha.getHours())}${dos(fecha.getMinutes())}${dos(fecha.getSeconds())}`;
}

function vistaSegura(vista: string): string {
  return vista.replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 16) || "vista";
}

/** Renueva el id de conversación de la vista (al empezar una conversación nueva) y lo deja como activo. */
export function nuevaConversacion(vista: string): string {
  const id = `${vistaSegura(vista)}-${sello(new Date())}-${aleatorio(6)}`;
  conversacionesEnMemoria.set(vista, id);
  activaEnMemoria = id;
  vistaActivaEnMemoria = vista;
  if (hayNavegador()) {
    guardarAlmacen(`${PREFIJO_CONVERSACION}${vista}`, id);
    guardarAlmacen(CLAVE_ACTIVA, id);
    guardarAlmacen(CLAVE_VISTA_ACTIVA, vista);
  }
  return id;
}

/** Id de la conversación en curso de la vista (lo crea si no existe) y lo deja como activo. */
export function obtenerIdConversacion(vista: string): string {
  if (!hayNavegador()) return conversacionesEnMemoria.get(vista) ?? nuevaConversacion(vista);
  const existente = leerAlmacen(`${PREFIJO_CONVERSACION}${vista}`) ?? conversacionesEnMemoria.get(vista);
  if (!existente) return nuevaConversacion(vista);
  activaEnMemoria = existente;
  vistaActivaEnMemoria = vista;
  guardarAlmacen(CLAVE_ACTIVA, existente);
  guardarAlmacen(CLAVE_VISTA_ACTIVA, vista);
  return existente;
}

/** La última conversación usada en esta pestaña (para atribuir errores globales del navegador). */
export function conversacionActiva(): string | undefined {
  if (!hayNavegador()) return activaEnMemoria;
  return leerAlmacen(CLAVE_ACTIVA) ?? activaEnMemoria;
}

/**
 * Instalado una vez por CapturaErroresCliente (layout raíz): intercepta `window.fetch` y añade
 * x-conversacion-id / x-vista de la conversación activa a las peticiones del mismo origen a /api/* que no las
 * traigan ya. Devuelve cómo desinstalarlo. Las vistas solo llaman a `obtenerIdConversacion(vista)` al montar y a
 * `nuevaConversacion(vista)` al vaciar.
 */
export function instalarCabecerasConversacionEnFetch(): () => void {
  if (!hayNavegador() || fetchOriginal) return () => undefined;
  const original = window.fetch.bind(window);
  fetchOriginal = original;
  const interceptado = (entrada: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    try {
      const url = typeof entrada === "string" ? entrada : entrada instanceof URL ? entrada.href : entrada.url;
      const destino = new URL(url, window.location.href);
      const conversacion = conversacionActiva();
      if (conversacion && destino.origin === window.location.origin && destino.pathname.startsWith("/api/") && destino.pathname !== RUTA) {
        const cabeceras = new Headers(init?.headers ?? (entrada instanceof Request ? entrada.headers : undefined));
        if (!cabeceras.has("x-conversacion-id")) cabeceras.set("x-conversacion-id", conversacion);
        const vista = leerAlmacen(CLAVE_VISTA_ACTIVA) ?? vistaActivaEnMemoria;
        if (vista && !cabeceras.has("x-vista")) cabeceras.set("x-vista", vista);
        return original(entrada, { ...init, headers: cabeceras });
      }
    } catch {
      // Ante cualquier duda, la petición sale tal cual.
    }
    return original(entrada, init);
  };
  window.fetch = interceptado as typeof fetch;
  return () => {
    if (fetchOriginal && window.fetch === (interceptado as typeof fetch)) window.fetch = fetchOriginal;
    fetchOriginal = undefined;
  };
}

/** Cabeceras a añadir en cada fetch de la vista al servidor. */
export function cabecerasConversacion(vista: string): Record<string, string> {
  return { "x-conversacion-id": obtenerIdConversacion(vista), "x-vista": vista };
}

function reemplazo(_clave: string, valor: unknown): unknown {
  if (typeof valor === "string") return valor.length > MAX_CADENA ? `${valor.slice(0, MAX_CADENA)}…[recortado]` : valor;
  if (valor instanceof Error) return { nombre: valor.name, mensaje: valor.message.slice(0, MAX_CADENA), pila: valor.stack?.split("\n").slice(0, 12).join("\n").slice(0, 4_000) };
  if (typeof valor === "bigint") return valor.toString();
  if (typeof valor === "function") return "[función]";
  return valor;
}

function serializar(carga: CargaEventoCliente): string {
  let texto: string;
  try {
    texto = JSON.stringify(carga, reemplazo);
  } catch {
    texto = JSON.stringify({ ...carga, datos: { noSerializable: true } });
  }
  if (texto.length <= MAX_BYTES) return texto;
  let vistaPrevia = "";
  try {
    vistaPrevia = JSON.stringify(carga.datos, reemplazo)?.slice(0, 6_000) ?? "";
  } catch {
    vistaPrevia = "";
  }
  return JSON.stringify({ ...carga, datos: { recortado: true, vistaPrevia } }, reemplazo);
}

function permitido(): boolean {
  const ahora = Date.now();
  envios = envios.filter((momento) => ahora - momento < 60_000);
  if (envios.length >= LIMITE_POR_MINUTO) {
    suprimidos += 1;
    return false;
  }
  envios.push(ahora);
  return true;
}

function enviar(cuerpo: string): void {
  if (enviando) return;
  enviando = true;
  try {
    let entregado = false;
    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      try {
        entregado = navigator.sendBeacon(RUTA, new Blob([cuerpo], { type: "application/json" }));
      } catch {
        entregado = false;
      }
    }
    if (!entregado && typeof fetch === "function") {
      // Un fallo de red aquí se descarta en silencio: registrar el fallo del registro sería un bucle.
      void fetch(RUTA, { method: "POST", headers: { "Content-Type": "application/json" }, body: cuerpo, keepalive: true, credentials: "same-origin" }).catch(() => undefined);
    }
  } catch {
    // Nunca lanza.
  } finally {
    enviando = false;
  }
}

/**
 * Registra un evento de la interfaz: botones/chips pulsados, fallos de SSE, reintentos… Con `idConversacion`
 * (o la conversación activa si se pasa `"activa"`) queda también en el archivo de auditoría de esa conversación.
 */
export function registrarEventoCliente(
  evento: string,
  datos?: Record<string, unknown>,
  idConversacion?: string,
  opciones: { nivel?: NivelRegistro; tipo?: CargaEventoCliente["tipo"]; vista?: string } = {},
): void {
  try {
    if (!hayNavegador() || !permitido()) return;
    const conversacion = idConversacion === "activa" ? conversacionActiva() : idConversacion;
    const carga: CargaEventoCliente = {
      evento: evento.slice(0, 80),
      nivel: opciones.nivel ?? "info",
      tipo: opciones.tipo ?? (opciones.nivel === "error" ? "error" : "accion"),
      ...(datos ? { datos } : {}),
      ...(conversacion ? { idConversacion: conversacion } : {}),
      ...(opciones.vista ? { vista: opciones.vista } : {}),
      ruta: window.location.pathname.slice(0, 300),
      sesion: idSesionPestana(),
      ts: new Date().toISOString(),
      ...(suprimidos ? { suprimidos } : {}),
    };
    suprimidos = 0;
    enviar(serializar(carga));
  } catch {
    // Nunca lanza.
  }
}

/** Atajo para errores atrapados por la vista (p. ej. un SSE que se cortó). */
export function registrarErrorCliente(evento: string, error: unknown, datos: Record<string, unknown> = {}, idConversacion?: string): void {
  const detalle = error instanceof Error
    ? { nombre: error.name, mensaje: error.message, pila: error.stack }
    : { mensaje: typeof error === "string" ? error : (() => { try { return JSON.stringify(error); } catch { return String(error); } })() };
  registrarEventoCliente(evento, { ...datos, error: detalle }, idConversacion, { nivel: "error", tipo: "error" });
}
