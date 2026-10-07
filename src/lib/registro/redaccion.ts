import { createHash } from "node:crypto";
import type { ErrorSerializado } from "./tipos";

/**
 * Redacción obligatoria de todo lo que se registra (ver la cabecera de tipos.ts). Funciones puras salvo la
 * lista de secretos del entorno, que se relee cada minuto para seguir una rotación en caliente. Nada aquí
 * lanza: un valor que no se puede inspeccionar se sustituye por una marca.
 */

export const MARCA_OCULTO = "[oculto]";

export interface OpcionesRedaccion {
  /** Caracteres máximos por cadena (auditoría 20 000, general 2 000). */
  limiteCadena: number;
  profundidadMax?: number;
  maxClaves?: number;
  maxElementos?: number;
}

export function sha256(datos: string | Uint8Array): string {
  return createHash("sha256").update(datos).digest("hex");
}

/* ---------- Claves con secretos ---------- */

const EXACTAS = new Set(["key", "pwd", "pass", "auth", "sig", "falkey", "xfalkey", "xapikey", "otp"]);
const CONTIENE = ["apikey", "secret", "password", "passwd", "contrasena", "llave", "privatekey", "credential", "authorization", "cookie", "signature"];
const TERMINA = ["token"];

export function normalizarClave(clave: string): string {
  return clave.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** `tokens`, `maxOutputTokens` o `prompt_token_count` no son secretos; `approval_token`, `x-fal-key` o `apiKey` sí. */
export function esClaveSecreta(clave: string): boolean {
  const normal = normalizarClave(clave);
  if (!normal) return false;
  if (EXACTAS.has(normal)) return true;
  if (CONTIENE.some((parte) => normal.includes(parte))) return true;
  return TERMINA.some((final) => normal.endsWith(final));
}

/* ---------- Secretos dentro de textos ---------- */

let secretosEntorno: { valores: string[]; leido: number } | undefined;

/** Valores de variables de entorno con nombre de secreto (nunca se imprimen: solo se usan para taparlos). */
function valoresSecretosDelEntorno(): string[] {
  const ahora = Date.now();
  if (secretosEntorno && ahora - secretosEntorno.leido < 60_000) return secretosEntorno.valores;
  const valores: string[] = [];
  try {
    for (const [nombre, valor] of Object.entries(process.env)) {
      if (!valor || valor.length < 8 || !esClaveSecreta(nombre)) continue;
      if (/^(true|false|\d+)$/i.test(valor)) continue;
      valores.push(valor);
    }
  } catch {
    // process.env inaccesible: se sigue solo con los patrones.
  }
  valores.sort((a, b) => b.length - a.length);
  secretosEntorno = { valores, leido: ahora };
  return valores;
}

const PATRONES_SECRETOS: ReadonlyArray<readonly [RegExp, string]> = [
  // Cabeceras pegadas en un texto: el token debe tener algún dígito para no tapar «Key features…».
  [/\b(Bearer|Key|Basic|Token)\s+(?=[A-Za-z0-9._~+/=:-]*\d)[A-Za-z0-9._~+/=:-]{16,}/g, `$1 ${MARCA_OCULTO}`],
  [/AIza[0-9A-Za-z_-]{35}/g, MARCA_OCULTO],
  [/\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{20,}/g, MARCA_OCULTO],
  [/\bshp(?:at|ss|ca|pa)_[A-Za-z0-9]{16,}/g, MARCA_OCULTO],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}/g, MARCA_OCULTO],
  // Llave de fal: uuid:hex.
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9a-f]{24,}\b/gi, MARCA_OCULTO],
  // usuario:clave@ en URLs (DATABASE_URL y similares).
  [/\b([a-z][a-z0-9+.-]*:\/\/)([^\s:@/]+):([^\s@/]+)@/gi, `$1$2:${MARCA_OCULTO}@`],
  // Parámetros de consulta con credenciales.
  [/([?&](?:key|api_key|apikey|api-key|token|access_token|id_token|auth|sig|signature|secret|password|x-amz-signature|x-amz-credential|x-amz-security-token|x-goog-signature|x-goog-credential)=)[^&#\s"'<>]*/gi, `$1${MARCA_OCULTO}`],
];

const RE_DATA_URL_EN_TEXTO = /data:([\w.+-]+\/[\w.+-]+);base64,([A-Za-z0-9+/=_-]{64,})/g;

/** Tapa secretos conocidos dentro de un texto libre (mensajes, URLs, pilas). */
export function sanearTexto(texto: string): string {
  let salida = texto;
  try {
    if (salida.includes("base64,")) {
      salida = salida.replace(RE_DATA_URL_EN_TEXTO, (_todo, mime: string, datos: string) => {
        const huella = huellaBase64(datos);
        return `[data-url ${mime} sha256=${huella.imagen.slice(0, 16)} bytes=${huella.bytes}]`;
      });
    }
    for (const valor of valoresSecretosDelEntorno()) {
      if (salida.includes(valor)) salida = salida.split(valor).join(MARCA_OCULTO);
    }
    for (const [patron, reemplazo] of PATRONES_SECRETOS) {
      patron.lastIndex = 0;
      salida = salida.replace(patron, reemplazo);
    }
  } catch {
    return "[texto no saneable]";
  }
  return salida;
}

/* ---------- Binarios ---------- */

const RE_DATA_URL = /^data:([\w.+-]+\/[\w.+-]+)(?:;[\w.+-]+=[\w.+-]+)*;base64,([\s\S]*)$/;
const RE_BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
const RE_BASE64_URL = /^[A-Za-z0-9_-]+={0,2}$/;

export function bytesBase64(base64: string): number {
  const limpio = base64.replace(/\s/g, "");
  const relleno = limpio.endsWith("==") ? 2 : limpio.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((limpio.length * 3) / 4) - relleno);
}

/** {imagen: sha256 de los bytes decodificados, bytes}. El hash coincide con `sha256sum` del archivo. */
export function huellaBase64(base64: string): { imagen: string; bytes: number } {
  try {
    const bytes = Buffer.from(base64.replace(/\s/g, ""), "base64");
    return { imagen: sha256(bytes), bytes: bytes.length };
  } catch {
    return { imagen: sha256(base64), bytes: bytesBase64(base64) };
  }
}

export function pareceBase64(texto: string, minimo = 512): boolean {
  if (texto.length < minimo) return false;
  return RE_BASE64.test(texto) || RE_BASE64_URL.test(texto);
}

/** Huella de una data URL completa, o `undefined` si el texto no lo es. */
export function huellaDataUrl(texto: string): { imagen: string; bytes: number; mime: string } | undefined {
  if (!texto.startsWith("data:")) return undefined;
  const partes = RE_DATA_URL.exec(texto.slice(0, 200).includes(";base64,") ? texto : "");
  if (!partes) return undefined;
  return { ...huellaBase64(partes[2] ?? ""), mime: partes[1] ?? "desconocido" };
}

/* ---------- Recorte ---------- */

const RE_MARCA_RECORTE = /…\[recortado: \d+ caracteres más\]$/;

export function recortarTexto(texto: string, limite: number): string {
  if (texto.length <= limite) return texto;
  // Ya recortado con un límite igual o parecido: no se vuelve a cortar la marca.
  if (RE_MARCA_RECORTE.test(texto) && texto.length <= limite + 48) return texto;
  return `${texto.slice(0, limite)}…[recortado: ${texto.length - limite} caracteres más]`;
}

/* ---------- Errores ---------- */

function recortarPila(pila: string | undefined): string | undefined {
  if (!pila) return undefined;
  return sanearTexto(pila.split("\n").slice(0, 16).map((linea) => linea.slice(0, 300)).join("\n"));
}

export function serializarError(error: unknown, profundidad = 0): ErrorSerializado {
  try {
    if (error instanceof Error) {
      const salida: ErrorSerializado = {
        nombre: error.name || "Error",
        mensaje: recortarTexto(sanearTexto(String(error.message ?? "")), 4_000),
      };
      const pila = recortarPila(error.stack);
      if (pila) salida.pila = pila;
      const conCodigo = error as Error & { code?: unknown; cause?: unknown };
      if (typeof conCodigo.code === "string" || typeof conCodigo.code === "number") salida.codigo = String(conCodigo.code);
      if (conCodigo.cause !== undefined && profundidad < 3) {
        salida.causa = conCodigo.cause instanceof Error
          ? serializarError(conCodigo.cause, profundidad + 1)
          : recortarTexto(sanearTexto(textoSeguro(conCodigo.cause)), 1_000);
      }
      const extra: Record<string, unknown> = {};
      for (const clave of Object.keys(error)) {
        if (clave === "name" || clave === "message" || clave === "stack" || clave === "code" || clave === "cause") continue;
        extra[clave] = (error as unknown as Record<string, unknown>)[clave];
      }
      if (Object.keys(extra).length) {
        const redactado = redactar(extra, { limiteCadena: 1_000, profundidadMax: 4, maxClaves: 40, maxElementos: 20 });
        if (redactado && typeof redactado === "object") salida.extra = redactado as Record<string, unknown>;
      }
      return salida;
    }
    if (typeof error === "string") return { nombre: "Error", mensaje: recortarTexto(sanearTexto(error), 4_000) };
    return { nombre: typeof error, mensaje: recortarTexto(textoSeguro(redactar(error, { limiteCadena: 1_000, profundidadMax: 4 })), 4_000) };
  } catch {
    return { nombre: "Error", mensaje: "[error no serializable]" };
  }
}

function textoSeguro(valor: unknown): string {
  if (typeof valor === "string") return valor;
  try {
    return JSON.stringify(valor) ?? String(valor);
  } catch {
    return String(valor);
  }
}

/* ---------- Redacción de valores arbitrarios ---------- */

const TIPOS_BINARIOS = typeof ArrayBuffer !== "undefined";

function esBinario(valor: object): valor is ArrayBuffer | ArrayBufferView {
  if (!TIPOS_BINARIOS) return false;
  return valor instanceof ArrayBuffer || ArrayBuffer.isView(valor);
}

function huellaBinario(valor: ArrayBuffer | ArrayBufferView): { binario: string; bytes: number } {
  const vista = valor instanceof ArrayBuffer ? new Uint8Array(valor) : new Uint8Array(valor.buffer, valor.byteOffset, valor.byteLength);
  return { binario: sha256(vista), bytes: vista.byteLength };
}

function redactarCadena(texto: string, clave: string | undefined, opciones: OpcionesRedaccion): unknown {
  const dataUrl = huellaDataUrl(texto);
  if (dataUrl) return dataUrl;
  const claveNormal = clave ? normalizarClave(clave) : "";
  if ((claveNormal.includes("base64") || claveNormal.includes("b64")) && texto.length >= 64 && pareceBase64(texto, 64)) return huellaBase64(texto);
  if (pareceBase64(texto)) return huellaBase64(texto);
  return recortarTexto(sanearTexto(texto), opciones.limiteCadena);
}

function redactarValor(valor: unknown, clave: string | undefined, profundidad: number, ancestros: Set<object>, opciones: Required<OpcionesRedaccion>): unknown {
  if (valor === null || valor === undefined) return valor;
  switch (typeof valor) {
    case "string":
      return redactarCadena(valor, clave, opciones);
    case "number":
      return Number.isFinite(valor) ? valor : String(valor);
    case "boolean":
      return valor;
    case "bigint":
      return valor.toString();
    case "symbol":
      return valor.toString();
    case "function":
      return `[función ${valor.name || "anónima"}]`;
    default:
      break;
  }
  const objeto = valor as object;
  if (objeto === process.env) return "[process.env omitido]";
  if (ancestros.has(objeto)) return "[circular]";
  if (profundidad >= opciones.profundidadMax) return "[profundidad máxima]";
  if (objeto instanceof Error) return serializarError(objeto);
  if (objeto instanceof Date) return Number.isNaN(objeto.getTime()) ? "Invalid Date" : objeto.toISOString();
  if (objeto instanceof URL) return recortarTexto(sanearTexto(objeto.href), opciones.limiteCadena);
  if (objeto instanceof RegExp) return objeto.toString();
  if (esBinario(objeto)) return huellaBinario(objeto);
  if (objeto instanceof Promise) return "[promesa]";
  if (typeof AbortSignal !== "undefined" && objeto instanceof AbortSignal) return objeto.aborted ? "[AbortSignal abortada]" : "[AbortSignal]";
  if (typeof ReadableStream !== "undefined" && objeto instanceof ReadableStream) return "[stream]";
  if (typeof Blob !== "undefined" && objeto instanceof Blob) return { blob: objeto.type || "desconocido", bytes: objeto.size };
  if (typeof Headers !== "undefined" && objeto instanceof Headers) {
    const cabeceras: Record<string, unknown> = {};
    objeto.forEach((valorCabecera, nombre) => {
      cabeceras[nombre] = esClaveSecreta(nombre) ? MARCA_OCULTO : recortarTexto(sanearTexto(valorCabecera), 500);
    });
    return cabeceras;
  }
  if (typeof Request !== "undefined" && objeto instanceof Request) return { metodo: objeto.method, url: sanearTexto(objeto.url) };
  if (typeof Response !== "undefined" && objeto instanceof Response) return { estado: objeto.status, url: sanearTexto(objeto.url), tipoContenido: objeto.headers.get("content-type") };

  ancestros.add(objeto);
  try {
    if (Array.isArray(objeto)) {
      const salida: unknown[] = [];
      const limite = Math.min(objeto.length, opciones.maxElementos);
      for (let indice = 0; indice < limite; indice += 1) salida.push(redactarValor(objeto[indice], clave, profundidad + 1, ancestros, opciones));
      if (objeto.length > limite) salida.push(`…[${objeto.length - limite} elementos más]`);
      return salida;
    }
    if (objeto instanceof Map) {
      const salida: Record<string, unknown> = {};
      let cuenta = 0;
      for (const [claveMapa, valorMapa] of objeto) {
        if (cuenta++ >= opciones.maxClaves) break;
        const nombre = String(claveMapa);
        salida[nombre] = esClaveSecreta(nombre) ? MARCA_OCULTO : redactarValor(valorMapa, nombre, profundidad + 1, ancestros, opciones);
      }
      return salida;
    }
    if (objeto instanceof Set) return redactarValor([...objeto], clave, profundidad, ancestros, opciones);
    const conToJson = objeto as { toJSON?: unknown };
    if (typeof conToJson.toJSON === "function") {
      try {
        const json: unknown = (conToJson.toJSON as () => unknown).call(objeto);
        if (json !== objeto) return redactarValor(json, clave, profundidad + 1, ancestros, opciones);
      } catch {
        return "[toJSON falló]";
      }
    }
    const salida: Record<string, unknown> = {};
    const claves = Object.keys(objeto);
    const limite = Math.min(claves.length, opciones.maxClaves);
    for (let indice = 0; indice < limite; indice += 1) {
      const nombre = claves[indice]!;
      let interno: unknown;
      try {
        interno = (objeto as Record<string, unknown>)[nombre];
      } catch {
        interno = "[getter falló]";
      }
      if (interno === undefined) continue;
      salida[nombre] = esClaveSecreta(nombre) && interno !== null && interno !== "" ? MARCA_OCULTO : redactarValor(interno, nombre, profundidad + 1, ancestros, opciones);
    }
    if (claves.length > limite) salida["…"] = `${claves.length - limite} claves más`;
    return salida;
  } finally {
    ancestros.delete(objeto);
  }
}

/** Copia JSON-segura y redactada de cualquier valor. Nunca lanza. */
export function redactar(valor: unknown, opciones: OpcionesRedaccion): unknown {
  try {
    return redactarValor(valor, undefined, 0, new Set<object>(), {
      profundidadMax: 12,
      maxClaves: 300,
      maxElementos: 500,
      ...opciones,
    });
  } catch {
    return "[valor no redactable]";
  }
}

/* ---------- Resumen para el registro general ---------- */

function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor);
}

/**
 * Lo escalar de primer nivel de un valor YA redactado: textos cortos, números, booleanos, huellas de
 * imagen, mensajes de error y cuántos elementos traía cada lista. Lo que va al registro general.
 */
export function resumirDatos(valor: unknown): unknown {
  if (!esObjeto(valor)) return typeof valor === "string" ? recortarTexto(valor, 160) : valor;
  const resumen: Record<string, unknown> = {};
  let cuenta = 0;
  for (const [clave, interno] of Object.entries(valor)) {
    if (cuenta++ >= 40) break;
    if (typeof interno === "string") resumen[clave] = recortarTexto(interno, 160);
    else if (typeof interno === "number" || typeof interno === "boolean") resumen[clave] = interno;
    else if (Array.isArray(interno)) resumen[`${clave}_n`] = interno.length;
    else if (esObjeto(interno)) {
      if (typeof interno.imagen === "string") resumen[clave] = { imagen: interno.imagen.slice(0, 16), bytes: interno.bytes };
      else if (typeof interno.mensaje === "string") resumen[clave] = { nombre: interno.nombre, mensaje: recortarTexto(interno.mensaje, 300) };
      else {
        const plano: Record<string, unknown> = {};
        let escalares = 0;
        for (const [subclave, subvalor] of Object.entries(interno)) {
          if (escalares >= 8) break;
          if (typeof subvalor === "number" || typeof subvalor === "boolean") { plano[subclave] = subvalor; escalares += 1; }
          else if (typeof subvalor === "string" && subvalor.length <= 80) { plano[subclave] = subvalor; escalares += 1; }
        }
        resumen[clave] = escalares ? plano : `{${Object.keys(interno).length} claves}`;
      }
    }
  }
  return resumen;
}
