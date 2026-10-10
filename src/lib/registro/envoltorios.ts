import { randomUUID } from "node:crypto";
import type { ChatPort, FragmentoChat, PeticionChat, TurnoChat } from "@sempertex/agente-core";
import { resumenBanderas } from "../ia/nucleo/feature-flags";
import { configuracion } from "./configuracion";
import { contextoActual, idConversacionEfectivo } from "./contexto";
import { rutaConversacion } from "./escritor";
import { huellaBase64, huellaDataUrl, redactar, sanearTexto, serializarError, sha256 } from "./redaccion";
import { avisarCierre } from "./observadores-llamadas";
import { auditar } from "./registro";
import type {
  ContextoRegistro,
  DatosImagen,
  DatosLlamadaIa,
  LlamadaHerramientaAuditada,
  ReferenciaImagenAuditada,
  TokensIa,
} from "./tipos";

/**
 * Envoltorios LISTOS PARA APLICAR alrededor de cada punto donde una IA decide o se llama a un proveedor.
 * Ninguno cambia el comportamiento: devuelven exactamente lo que devuelve la función envuelta, relanzan
 * exactamente su error, y cualquier fallo del propio registro se traga. El inventario de dónde aplicarlos
 * está en scripts/test/test-guardia-proveedores-ia.ts (la guardia que falla si aparece uno sin envolver).
 */

/* ---------- Deduplicación por conversación (prompts, mensajes y esquemas completos solo la 1.ª vez) ---------- */

declare global {
  var __registroVistos: Map<string, Set<string>> | undefined;
}

function vistos(): Map<string, Set<string>> {
  if (!globalThis.__registroVistos) globalThis.__registroVistos = new Map();
  return globalThis.__registroVistos;
}

/** `true` si esa huella ya se escribió en el archivo de esta conversación; si no, la marca. */
function yaVisto(contexto: ContextoRegistro | undefined, huella: string): boolean {
  try {
    const clave = rutaConversacion(idConversacionEfectivo(contexto));
    const mapa = vistos();
    let conjunto = mapa.get(clave);
    if (!conjunto) {
      if (mapa.size >= 2_000) {
        const primera = mapa.keys().next().value;
        if (primera !== undefined) mapa.delete(primera);
      }
      conjunto = new Set();
      mapa.set(clave, conjunto);
    }
    if (conjunto.has(huella)) return true;
    if (conjunto.size < 10_000) conjunto.add(huella);
    return false;
  } catch {
    return false;
  }
}

function huellaDe(valorRedactado: unknown): string {
  try {
    return sha256(JSON.stringify(valorRedactado) ?? "undefined").slice(0, 16);
  } catch {
    return "sin-huella";
  }
}

function redactarAuditoria(valor: unknown, limiteCadena?: number): unknown {
  const limite = limiteCadena ?? configuracion().limiteCadenaAuditoria;
  return redactar(valor, limite > configuracion().limiteCadenaAuditoria ? { limiteCadena: limite, profundidadMax: 32, maxElementos: 2_000, maxClaves: 1_000 } : { limiteCadena: limite });
}

/**
 * Banderas de IA y modelos configurados en el momento de la llamada (nombres, booleanos y nombres de modelo:
 * ningún secreto; ver `resumenBanderas`). Van en CADA `llamada_ia`: son pocas y así cada llamada se lee sola.
 */
function banderasActuales(): Record<string, unknown> | undefined {
  try {
    return {
      ...resumenBanderas(),
      GEMINI_CHAT_MODEL: process.env.GEMINI_CHAT_MODEL ?? "(por defecto)",
      OPENCODE_CAPTION_MODEL: process.env.OPENCODE_CAPTION_MODEL ?? "(por defecto)",
    };
  } catch {
    return undefined;
  }
}

function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor);
}

function texto(valor: unknown): string | undefined {
  return typeof valor === "string" ? valor : undefined;
}

function numero(valor: unknown): number | undefined {
  return typeof valor === "number" && Number.isFinite(valor) ? valor : undefined;
}

/* ---------- Llamada genérica a una IA ---------- */

export interface DescripcionLlamadaIa {
  proveedor: string;
  modelo?: string;
  /** "chat_guiado", "chat_clasico", "analisis_foto", "parser_intencion", "embedding", "caption_flux"… */
  proposito: string;
  /** Prompt de sistema completo (se guarda entero la 1.ª vez que su sha aparece en la conversación). */
  sistema?: string;
  versionSistema?: string;
  mensajes?: readonly unknown[];
  herramientas?: unknown;
  parametros?: Record<string, unknown>;
  /** Caracteres por cadena en la auditoría de esta llamada (p. ej. ~200 kB para las que pasan por el Python). */
  limiteCadena?: number;
}

export interface ResultadoLlamadaIa {
  texto?: string;
  llamadasHerramientas?: LlamadaHerramientaAuditada[];
  motivoFin?: string;
  bloqueo?: string;
  tokens?: TokensIa;
  modelo?: string;
  costeEstimadoUsd?: number;
  interrumpida?: boolean;
  crudo?: unknown;
}

export interface LlamadaIaEnCurso {
  readonly id: string;
  terminar(resultado: ResultadoLlamadaIa): void;
  fallar(error: unknown, parcial?: ResultadoLlamadaIa): void;
}

function nombresHerramientas(herramientas: unknown): string[] {
  const nombres: string[] = [];
  const visitar = (valor: unknown, profundidad: number): void => {
    if (profundidad > 3 || nombres.length > 100) return;
    if (Array.isArray(valor)) {
      for (const item of valor) visitar(item, profundidad + 1);
      return;
    }
    if (!esObjeto(valor)) return;
    const nombre = texto(valor.nombre) ?? texto(valor.name);
    if (nombre) nombres.push(nombre);
    if (Array.isArray(valor.functionDeclarations)) visitar(valor.functionDeclarations, profundidad + 1);
  };
  visitar(herramientas, 0);
  return nombres;
}

/**
 * Cada mensaje completo (redactado) la primera vez que aparece en el archivo de la conversación; después solo
 * `{ref: sha, rol}`. El historial que se reenvía en cada turno no multiplica el tamaño del archivo.
 */
export function deduplicarMensajes(mensajes: readonly unknown[], contexto: ContextoRegistro | undefined = contextoActual(), limiteCadena?: number): unknown[] {
  return mensajes.map((mensaje) => {
    const redactado = redactarAuditoria(mensaje, limiteCadena);
    const huella = huellaDe(redactado);
    const rol = esObjeto(mensaje) ? texto(mensaje.rol) ?? texto(mensaje.role) : undefined;
    if (yaVisto(contexto, `mensaje:${huella}`)) return { ref: huella, ...(rol ? { rol } : {}) };
    return esObjeto(redactado) ? { sha: huella, ...redactado } : { sha: huella, valor: redactado };
  });
}

function describirParaAuditoria(descripcion: DescripcionLlamadaIa, id: string, contexto: ContextoRegistro | undefined): DatosLlamadaIa {
  const datos: DatosLlamadaIa = {
    llamada: id,
    proveedor: descripcion.proveedor,
    ...(descripcion.modelo ? { modelo: descripcion.modelo } : {}),
    proposito: descripcion.proposito,
  };
  if (descripcion.sistema !== undefined) {
    const huella = sha256(descripcion.sistema);
    datos.sistema = {
      sha256: huella,
      caracteres: descripcion.sistema.length,
      ...(descripcion.versionSistema ? { version: descripcion.versionSistema } : {}),
      ...(yaVisto(contexto, `sistema:${huella}`) ? {} : { texto: descripcion.sistema }),
    };
  }
  if (descripcion.mensajes) datos.mensajes = deduplicarMensajes(descripcion.mensajes, contexto, descripcion.limiteCadena);
  if (descripcion.herramientas !== undefined) {
    const redactadas = redactarAuditoria(descripcion.herramientas);
    const huella = huellaDe(redactadas);
    datos.herramientas = yaVisto(contexto, `herramientas:${huella}`)
      ? { ref: huella, nombres: nombresHerramientas(descripcion.herramientas) }
      : { sha: huella, nombres: nombresHerramientas(descripcion.herramientas), lista: redactadas };
  }
  if (descripcion.parametros) {
    const parametros: Record<string, unknown> = {};
    for (const [clave, valor] of Object.entries(descripcion.parametros)) {
      if (valor === undefined) continue;
      const redactado = redactarAuditoria(valor);
      const serializado = JSON.stringify(redactado) ?? "";
      // Esquemas de respuesta y otros parámetros grandes: completos solo la primera vez.
      if (serializado.length > 1_500) {
        const huella = huellaDe(redactado);
        parametros[clave] = yaVisto(contexto, `parametro:${clave}:${huella}`) ? { ref: huella } : { sha: huella, valor: redactado };
      } else {
        parametros[clave] = redactado;
      }
    }
    datos.parametros = parametros;
  }
  const banderas = banderasActuales();
  if (banderas) datos.banderas = banderas;
  return datos;
}

/** Emite `llamada_ia` ya y devuelve con qué cerrar la `respuesta_ia` (una sola vez). Nunca lanza. */
export function iniciarLlamadaIa(descripcion: DescripcionLlamadaIa): LlamadaIaEnCurso {
  const id = randomUUID().slice(0, 13);
  const inicio = performance.now();
  const contexto = contextoActual();
  try {
    auditar("llamada_ia", describirParaAuditoria(descripcion, id, contexto), { contexto, ...(descripcion.limiteCadena ? { limiteCadena: descripcion.limiteCadena } : {}) });
  } catch {
    // Nunca lanza.
  }
  let cerrada = false;
  const cerrar = (resultado: ResultadoLlamadaIa, error?: unknown): void => {
    if (cerrada) return;
    cerrada = true;
    try {
      const ms = Math.round(performance.now() - inicio);
      auditar("respuesta_ia", {
        llamada: id,
        proveedor: descripcion.proveedor,
        proposito: descripcion.proposito,
        ...resultado,
        modelo: resultado.modelo ?? descripcion.modelo,
        ms,
        ...(error !== undefined ? { error: serializarError(error) } : {}),
      }, { contexto, ms, ...(descripcion.limiteCadena ? { limiteCadena: descripcion.limiteCadena } : {}) });
    } catch {
      // Nunca lanza.
    }
    try {
      avisarCierre(descripcion, resultado, error);
    } catch {
      // Nunca lanza.
    }
  };
  return {
    id,
    terminar: (resultado) => cerrar(resultado),
    fallar: (error, parcial) => cerrar(parcial ?? {}, error),
  };
}

/** Envuelve una llamada asíncrona a una IA: devuelve/lanza exactamente lo mismo que `ejecutar`. */
export async function auditarLlamadaIa<T>(
  descripcion: DescripcionLlamadaIa,
  ejecutar: () => Promise<T>,
  extraer?: (resultado: T) => ResultadoLlamadaIa,
): Promise<T> {
  const llamada = iniciarLlamadaIa(descripcion);
  let resultado: T;
  try {
    resultado = await ejecutar();
  } catch (error) {
    llamada.fallar(error);
    throw error;
  }
  try {
    llamada.terminar(extraer ? extraer(resultado) : { crudo: resultado });
  } catch {
    llamada.terminar({ crudo: "[no se pudo extraer la respuesta]" });
  }
  return resultado;
}

/** Variante síncrona (p. ej. `spawnSync` del CLI que genera captions de órdenes). */
export function auditarLlamadaIaSincrona<T>(
  descripcion: DescripcionLlamadaIa,
  ejecutar: () => T,
  extraer?: (resultado: T) => ResultadoLlamadaIa,
): T {
  const llamada = iniciarLlamadaIa(descripcion);
  let resultado: T;
  try {
    resultado = ejecutar();
  } catch (error) {
    llamada.fallar(error);
    throw error;
  }
  try {
    llamada.terminar(extraer ? extraer(resultado) : { crudo: resultado });
  } catch {
    llamada.terminar({ crudo: "[no se pudo extraer la respuesta]" });
  }
  return resultado;
}

/**
 * Envuelve cualquier función asíncrona que llame a una IA (p. ej. `GenerarEstructurado` de Happie): por
 * defecto los argumentos van como `mensajes` y el resultado como `crudo`.
 */
export function envolverFuncionIa<A extends unknown[], R>(
  fn: (...argumentos: A) => Promise<R>,
  opciones: {
    proveedor: string;
    proposito: string;
    modelo?: string | ((...argumentos: A) => string | undefined);
    describir?: (...argumentos: A) => Partial<DescripcionLlamadaIa>;
    extraer?: (resultado: R) => ResultadoLlamadaIa;
  },
): (...argumentos: A) => Promise<R> {
  return (...argumentos: A) => {
    let descripcion: DescripcionLlamadaIa;
    try {
      const modelo = typeof opciones.modelo === "function" ? opciones.modelo(...argumentos) : opciones.modelo;
      descripcion = {
        proveedor: opciones.proveedor,
        proposito: opciones.proposito,
        ...(modelo ? { modelo } : {}),
        mensajes: [argumentos.length === 1 ? argumentos[0] : argumentos],
        ...(opciones.describir ? opciones.describir(...argumentos) : {}),
      };
    } catch {
      descripcion = { proveedor: opciones.proveedor, proposito: opciones.proposito };
    }
    return auditarLlamadaIa(descripcion, () => fn(...argumentos), opciones.extraer);
  };
}

/* ---------- ChatPort (@sempertex/agente-core): Gemini directo, Gemini vía Python, Amaterasu ---------- */

const MARCA_ENVUELTO = Symbol.for("demo-decoracion.registro.envuelto");

function yaEnvuelto(valor: object): boolean {
  return (valor as { [MARCA_ENVUELTO]?: unknown })[MARCA_ENVUELTO] === true;
}

function marcar<T extends object>(valor: T): T {
  try {
    Object.defineProperty(valor, MARCA_ENVUELTO, { value: true, enumerable: false });
  } catch {
    // Objeto congelado: solo se pierde la protección contra doble envoltura.
  }
  return valor;
}

export function resultadoDeTurno(turno: TurnoChat): ResultadoLlamadaIa {
  return {
    texto: turno.texto,
    llamadasHerramientas: turno.llamadas.map((llamada) => ({ nombre: llamada.nombre, ...(llamada.id ? { id: llamada.id } : {}), argumentos: llamada.args })),
    ...(turno.finishReason ? { motivoFin: turno.finishReason } : {}),
    ...(turno.blockReason ? { bloqueo: turno.blockReason } : {}),
    tokens: {
      entrada: turno.uso.entrada,
      salida: turno.uso.salida,
      ...(turno.uso.pensamiento !== undefined ? { pensamiento: turno.uso.pensamiento } : {}),
      ...(turno.uso.cacheados !== undefined ? { cacheados: turno.uso.cacheados } : {}),
      ...(turno.uso.cacheEscritos !== undefined ? { cacheEscritos: turno.uso.cacheEscritos } : {}),
      ...(turno.uso.promptHerramientas !== undefined ? { promptHerramientas: turno.uso.promptHerramientas } : {}),
    },
    modelo: turno.modelo,
    ...(turno.bytesImagenEnviados !== undefined ? { crudo: { bytesImagenEnviados: turno.bytesImagenEnviados } } : {}),
  };
}

const MAX_TEXTO_STREAM = 200_000;

async function* flujoChatAuditado(flujo: AsyncIterable<FragmentoChat>, descripcion: DescripcionLlamadaIa): AsyncGenerator<FragmentoChat> {
  const llamada = iniciarLlamadaIa(descripcion);
  let acumulado = "";
  let cerrada = false;
  try {
    for await (const fragmento of flujo) {
      if (fragmento.tipo === "texto") {
        if (acumulado.length < MAX_TEXTO_STREAM) acumulado += fragmento.delta;
      } else if (fragmento.tipo === "fin" && !cerrada) {
        cerrada = true;
        llamada.terminar(resultadoDeTurno(fragmento));
      }
      yield fragmento;
    }
  } catch (error) {
    if (!cerrada) {
      cerrada = true;
      llamada.fallar(error, { texto: acumulado, interrumpida: true });
    }
    throw error;
  } finally {
    // El consumidor dejó de leer (cancelación, plazo) o el flujo terminó sin «fin».
    if (!cerrada) llamada.terminar({ texto: acumulado, interrumpida: true });
  }
}

/**
 * Envuelve un ChatPort: cada `turno`/`turnoStream` deja `llamada_ia` (sistema, historial, herramientas,
 * parámetros) y `respuesta_ia` (texto, llamadas a herramientas, motivo de fin, tokens, ms o error).
 * Idempotente: envolver dos veces no duplica la auditoría.
 */
export function envolverChatPort(chat: ChatPort, opciones: { proposito: string; versionSistema?: string; parametros?: Record<string, unknown> }): ChatPort {
  if (yaEnvuelto(chat)) return chat;
  const describir = (peticion: PeticionChat): DescripcionLlamadaIa => ({
    proveedor: chat.id,
    modelo: chat.modelo,
    proposito: opciones.proposito,
    sistema: peticion.sistema,
    ...(opciones.versionSistema ? { versionSistema: opciones.versionSistema } : {}),
    mensajes: peticion.historial,
    herramientas: peticion.herramientas,
    parametros: { temperatura: peticion.temperatura, maxTokens: peticion.maxTokens, thinkingLevel: chat.thinkingLevel, ...opciones.parametros },
  });
  const envuelto: ChatPort = {
    get id() {
      return chat.id;
    },
    get modelo() {
      return chat.modelo;
    },
    get thinkingLevel() {
      return chat.thinkingLevel;
    },
    turno: (peticion) => auditarLlamadaIa(describir(peticion), () => chat.turno(peticion), resultadoDeTurno),
    turnoStream: (peticion) => {
      // Se abre el flujo aquí mismo, como sin el envoltorio: un error síncrono del puerto se lanza igual que antes.
      let flujo: AsyncIterable<FragmentoChat>;
      try {
        flujo = chat.turnoStream(peticion);
      } catch (error) {
        iniciarLlamadaIa(describir(peticion)).fallar(error);
        throw error;
      }
      return flujoChatAuditado(flujo, describir(peticion));
    },
  };
  return marcar(envuelto);
}

/* ---------- Cliente @google/genai directo (getGeminiClient) ---------- */

function textoDeContenido(valor: unknown): string | undefined {
  if (typeof valor === "string") return valor;
  const partes = esObjeto(valor) && Array.isArray(valor.parts) ? valor.parts : Array.isArray(valor) ? valor : undefined;
  if (!partes) return valor === undefined ? undefined : JSON.stringify(redactarAuditoria(valor));
  return partes.map((parte) => (typeof parte === "string" ? parte : esObjeto(parte) ? texto(parte.text) ?? "" : "")).join("");
}

function comoLista(valor: unknown): unknown[] {
  if (valor === undefined) return [];
  return Array.isArray(valor) ? valor : [valor];
}

export function describirPeticionGemini(parametros: unknown, proposito: string): DescripcionLlamadaIa {
  const peticion = esObjeto(parametros) ? parametros : {};
  const config = esObjeto(peticion.config) ? peticion.config : {};
  const resto: Record<string, unknown> = {};
  for (const [clave, valor] of Object.entries(config)) {
    if (clave === "systemInstruction" || clave === "tools" || clave === "abortSignal" || clave === "httpOptions") continue;
    resto[clave] = valor;
  }
  const sistema = textoDeContenido(config.systemInstruction);
  return {
    proveedor: "gemini",
    ...(texto(peticion.model) ? { modelo: texto(peticion.model) } : {}),
    proposito,
    ...(sistema !== undefined ? { sistema } : {}),
    mensajes: comoLista(peticion.contents),
    ...(config.tools !== undefined ? { herramientas: config.tools } : {}),
    parametros: resto,
  };
}

/** Texto, llamadas a funciones, motivo de fin y tokens de un GenerateContentResponse (sin tocar el getter `.text`). */
export function extraerRespuestaGemini(respuesta: unknown): ResultadoLlamadaIa {
  if (!esObjeto(respuesta)) return { crudo: respuesta };
  const candidatos = Array.isArray(respuesta.candidates) ? respuesta.candidates : [];
  const candidato = esObjeto(candidatos[0]) ? candidatos[0] : {};
  const contenido = esObjeto(candidato.content) ? candidato.content : {};
  const partes = Array.isArray(contenido.parts) ? contenido.parts.filter(esObjeto) : [];
  const llamadas: LlamadaHerramientaAuditada[] = [];
  let salida = "";
  for (const parte of partes) {
    if (typeof parte.text === "string" && parte.thought !== true) salida += parte.text;
    if (esObjeto(parte.functionCall)) {
      const llamada = parte.functionCall;
      llamadas.push({ nombre: texto(llamada.name) ?? "?", ...(texto(llamada.id) ? { id: texto(llamada.id) } : {}), argumentos: llamada.args });
    }
  }
  const uso = esObjeto(respuesta.usageMetadata) ? respuesta.usageMetadata : {};
  const retroalimentacion = esObjeto(respuesta.promptFeedback) ? respuesta.promptFeedback : {};
  return {
    texto: salida,
    ...(llamadas.length ? { llamadasHerramientas: llamadas } : {}),
    ...(texto(candidato.finishReason) ? { motivoFin: texto(candidato.finishReason) } : {}),
    ...(texto(retroalimentacion.blockReason) ? { bloqueo: texto(retroalimentacion.blockReason) } : {}),
    tokens: {
      entrada: numero(uso.promptTokenCount),
      salida: numero(uso.candidatesTokenCount),
      pensamiento: numero(uso.thoughtsTokenCount),
      cacheados: numero(uso.cachedContentTokenCount),
      promptHerramientas: numero(uso.toolUsePromptTokenCount),
    },
    ...(texto(respuesta.modelVersion) ? { modelo: texto(respuesta.modelVersion) } : {}),
  };
}

function extraerEmbedding(respuesta: unknown): ResultadoLlamadaIa {
  const embeddings = esObjeto(respuesta) && Array.isArray(respuesta.embeddings) ? respuesta.embeddings : [];
  const primero = esObjeto(embeddings[0]) && Array.isArray(embeddings[0].values) ? embeddings[0].values : [];
  return { crudo: { embeddings: embeddings.length, dimensiones: primero.length } };
}

async function* flujoGeminiAuditado(flujo: AsyncIterable<unknown>, llamada: LlamadaIaEnCurso): AsyncGenerator<unknown> {
  let acumulado = "";
  const llamadas: LlamadaHerramientaAuditada[] = [];
  let ultimo: ResultadoLlamadaIa = {};
  let cerrada = false;
  try {
    for await (const fragmento of flujo) {
      const parcial = extraerRespuestaGemini(fragmento);
      if (parcial.texto && acumulado.length < MAX_TEXTO_STREAM) acumulado += parcial.texto;
      if (parcial.llamadasHerramientas) llamadas.push(...parcial.llamadasHerramientas);
      ultimo = parcial;
      yield fragmento;
    }
    cerrada = true;
    llamada.terminar({ ...ultimo, texto: acumulado, ...(llamadas.length ? { llamadasHerramientas: llamadas } : {}) });
  } catch (error) {
    cerrada = true;
    llamada.fallar(error, { texto: acumulado, interrumpida: true });
    throw error;
  } finally {
    if (!cerrada) llamada.terminar({ ...ultimo, texto: acumulado, interrumpida: true });
  }
}

function esIterableAsincrono(valor: unknown): valor is AsyncIterable<unknown> {
  return typeof valor === "object" && valor !== null && Symbol.asyncIterator in valor;
}

/**
 * Proxy sobre un cliente `GoogleGenAI`: `models.generateContent`, `generateContentStream` y `embedContent`
 * quedan auditados; todo lo demás pasa intacto. Tipado como el cliente original.
 */
export function envolverClienteGemini<T extends object>(cliente: T, opciones: { proposito: string; propositoEmbedding?: string }): T {
  if (yaEnvuelto(cliente)) return cliente;
  const modelosAuditados = (modelos: object): object => new Proxy(modelos, {
    get(objetivo, propiedad, receptor) {
      const valor: unknown = Reflect.get(objetivo, propiedad, receptor);
      if (typeof valor !== "function") return valor;
      if (propiedad === "generateContent") {
        return (parametros: unknown) => auditarLlamadaIa(
          describirPeticionGemini(parametros, opciones.proposito),
          () => Promise.resolve(Reflect.apply(valor, objetivo, [parametros]) as unknown),
          extraerRespuestaGemini,
        );
      }
      if (propiedad === "generateContentStream") {
        return async (parametros: unknown) => {
          const llamada = iniciarLlamadaIa(describirPeticionGemini(parametros, opciones.proposito));
          let flujo: unknown;
          try {
            flujo = await (Reflect.apply(valor, objetivo, [parametros]) as unknown);
          } catch (error) {
            llamada.fallar(error);
            throw error;
          }
          if (!esIterableAsincrono(flujo)) {
            llamada.terminar({ crudo: "[respuesta no iterable]" });
            return flujo;
          }
          return flujoGeminiAuditado(flujo, llamada);
        };
      }
      if (propiedad === "embedContent") {
        return (parametros: unknown) => auditarLlamadaIa(
          describirPeticionGemini(parametros, opciones.propositoEmbedding ?? "embedding"),
          () => Promise.resolve(Reflect.apply(valor, objetivo, [parametros]) as unknown),
          extraerEmbedding,
        );
      }
      return valor;
    },
  });
  return new Proxy(cliente, {
    get(objetivo, propiedad, receptor) {
      // La marca de «ya envuelto» la responde el proxy y NO se define en el cliente real: `Object.defineProperty` sobre un proxy sin
      // trampa la reenvía al objetivo, y `getGeminiClient` (que cachea el cliente) devolvía desde la 2.ª llamada el cliente SIN
      // envolver: solo la primera petición de cada proceso dejaba `llamada_ia`/`respuesta_ia` (conversación 3d-20261009-103125-92b58a).
      if (propiedad === MARCA_ENVUELTO) return true;
      const valor: unknown = Reflect.get(objetivo, propiedad, receptor);
      if (propiedad === "models" && typeof valor === "object" && valor !== null) return modelosAuditados(valor);
      return valor;
    },
  });
}

/* ---------- fetch auditado: Python ai-api (python) y proveedores HTTP como fal (http) ---------- */

export interface OpcionesFetchAuditado {
  tipo: "python" | "http";
  /** Para `http`: "fal", "happia"… */
  proveedor?: string;
  /** No auditar ciertas peticiones (p. ej. los sondeos de estado de la cola de fal). */
  omitir?: (url: string, metodo: string) => boolean;
  /** No leer respuestas más grandes que esto (por defecto 8 MB). */
  maxBytesRespuesta?: number;
  /**
   * Solo `python`: para las rutas donde el Python llama a un modelo (intent-parse, lectura-unica, *-referencia,
   * embed…), el propósito. Esas peticiones emiten además `llamada_ia`/`respuesta_ia` (proveedor "python") con
   * el cuerpo completo, y el evento `python` apunta a ellas en vez de repetir los cuerpos.
   */
  propositoIa?: (ruta: string) => string | undefined;
}

type EntradaFetch = string | URL | Request;

/** Texto, modelo y tokens de la respuesta de una operación de IA del Python (`{text, model, usage}`), si los trae. */
function resultadoIaPython(respuesta: unknown): ResultadoLlamadaIa {
  if (!esObjeto(respuesta)) return {};
  const uso = esObjeto(respuesta.usage) ? respuesta.usage : undefined;
  return {
    ...(texto(respuesta.text) !== undefined ? { texto: texto(respuesta.text) } : {}),
    ...(texto(respuesta.model) ? { modelo: texto(respuesta.model) } : {}),
    ...(uso ? { tokens: { entrada: numero(uso.prompt_token_count), salida: numero(uso.candidates_token_count), pensamiento: numero(uso.thoughts_token_count), cacheados: numero(uso.cached_content_token_count) } } : {}),
  };
}

function cuerpoLegible(cuerpo: unknown): unknown {
  if (cuerpo === undefined || cuerpo === null) return undefined;
  if (typeof cuerpo === "string") {
    try {
      return JSON.parse(cuerpo) as unknown;
    } catch {
      return cuerpo;
    }
  }
  if (cuerpo instanceof URLSearchParams) return cuerpo.toString();
  if (typeof FormData !== "undefined" && cuerpo instanceof FormData) return "[form-data]";
  return cuerpo;
}

function cabeceraDe(cabeceras: HeadersInit | undefined, nombre: string): string | undefined {
  if (!cabeceras) return undefined;
  try {
    return new Headers(cabeceras).get(nombre) ?? undefined;
  } catch {
    return undefined;
  }
}

function urlSaneada(url: string): string {
  return sanearTexto(url.startsWith("data:") ? "[data-url]" : url);
}

async function leerCopia(copia: Response | undefined, tipoContenido: string): Promise<unknown> {
  if (!copia) return undefined;
  const contenido = await copia.text();
  if (tipoContenido.includes("ndjson")) {
    return contenido.split("\n").filter((linea) => linea.trim()).slice(0, 2_000).map((linea) => {
      try {
        return JSON.parse(linea) as unknown;
      } catch {
        return linea;
      }
    });
  }
  if (tipoContenido.includes("json")) {
    try {
      return JSON.parse(contenido) as unknown;
    } catch {
      return contenido;
    }
  }
  return contenido;
}

/**
 * Devuelve un `fetch` que audita petición y respuesta (`python` o `http`) sin alterar ninguna de las dos: la
 * respuesta se clona de forma síncrona antes de devolverla y la copia se lee en segundo plano.
 */
export function crearFetchAuditado(base: typeof fetch, opciones: OpcionesFetchAuditado): typeof fetch {
  const maxBytes = opciones.maxBytesRespuesta ?? 8 * 1024 * 1024;
  const envuelto = async (entrada: EntradaFetch, init?: RequestInit): Promise<Response> => {
    let url = "";
    let metodo = "GET";
    let ruta = "";
    try {
      url = typeof entrada === "string" ? entrada : entrada instanceof URL ? entrada.href : entrada.url;
      metodo = (init?.method ?? (typeof entrada === "object" && "method" in entrada ? entrada.method : "GET")).toUpperCase();
      ruta = url;
      ruta = new URL(url).pathname;
    } catch {
      // Se audita con lo que haya.
    }
    if (!configuracion().activo || opciones.omitir?.(url, metodo)) return base(entrada, init);
    const contexto = contextoActual();
    const inicio = performance.now();
    const cuerpoEnviado = cuerpoLegible(init?.body);
    let llamadaIa: LlamadaIaEnCurso | undefined;
    try {
      const proposito = opciones.tipo === "python" ? opciones.propositoIa?.(ruta) : undefined;
      if (proposito) {
        const peticion = esObjeto(cuerpoEnviado) && cuerpoEnviado.payload !== undefined ? cuerpoEnviado.payload : cuerpoEnviado;
        const modelo = esObjeto(peticion) ? texto(peticion.model) ?? texto(peticion.modelo) : undefined;
        llamadaIa = iniciarLlamadaIa({ proveedor: "python", ...(modelo ? { modelo } : {}), proposito, mensajes: [peticion], parametros: { rutaPython: ruta }, limiteCadena: configuracion().limiteCadenaCuerpos });
      }
    } catch {
      llamadaIa = undefined;
    }
    const emitir = (campos: { estado?: number; cuerpoRecibido?: unknown; ms: number; msCuerpo?: number; error?: unknown }): void => {
      try {
        if (llamadaIa) {
          const respuestaIa = esObjeto(campos.cuerpoRecibido) && campos.cuerpoRecibido.payload !== undefined ? campos.cuerpoRecibido.payload : campos.cuerpoRecibido;
          if (campos.error !== undefined) llamadaIa.fallar(campos.error);
          else if ((campos.estado ?? 0) >= 400) llamadaIa.fallar(new Error(`El Python respondió ${String(campos.estado)}`), { crudo: respuestaIa });
          else llamadaIa.terminar({ ...resultadoIaPython(respuestaIa), crudo: respuestaIa });
        }
        const comun = {
          metodo,
          ...(campos.estado !== undefined ? { estado: campos.estado } : {}),
          cuerpoEnviado: llamadaIa ? { verLlamadaIa: llamadaIa.id } : cuerpoEnviado,
          ...(campos.cuerpoRecibido !== undefined ? { cuerpoRecibido: llamadaIa ? { verRespuestaIa: llamadaIa.id } : campos.cuerpoRecibido } : {}),
          ms: Math.round(campos.ms),
          ...(campos.msCuerpo !== undefined ? { msCuerpo: Math.round(campos.msCuerpo) } : {}),
          ...(campos.error !== undefined ? { error: serializarError(campos.error) } : {}),
        };
        if (opciones.tipo === "python") {
          const requestId = cabeceraDe(init?.headers, "x-request-id");
          auditar("python", { ...comun, ruta, ...(requestId ? { requestId } : {}) }, { contexto, ms: campos.ms });
        } else {
          auditar("http", { ...comun, proveedor: opciones.proveedor ?? "http", url: urlSaneada(url) }, { contexto, ms: campos.ms });
        }
      } catch {
        // Nunca lanza.
      }
    };
    let respuesta: Response;
    try {
      respuesta = await base(entrada, init);
    } catch (error) {
      emitir({ ms: performance.now() - inicio, error });
      throw error;
    }
    const ms = performance.now() - inicio;
    try {
      const tipoContenido = respuesta.headers.get("content-type") ?? "";
      const longitud = Number(respuesta.headers.get("content-length"));
      const binario = /^(image|video|audio)\/|octet-stream|zip|pdf/.test(tipoContenido);
      // Un flujo (NDJSON del chat vía Python, SSE) no se clona: la copia mantendría viva la conexión cuando el
      // consumidor la corta, y el Python seguiría generando. Su contenido queda en la `respuesta_ia` del ChatPort.
      const flujo = /ndjson|event-stream/.test(tipoContenido);
      if (!respuesta.body || binario || flujo || (Number.isFinite(longitud) && longitud > maxBytes)) {
        emitir({ estado: respuesta.status, ms, cuerpoRecibido: { tipoContenido, ...(Number.isFinite(longitud) && longitud > 0 ? { bytes: longitud } : {}), omitido: binario ? "binario" : flujo ? "flujo (ver respuesta_ia)" : respuesta.body ? "demasiado grande" : "sin cuerpo" } });
      } else {
        // Clonar ANTES de devolver: el llamante consume el original y la copia se lee en segundo plano.
        const copia = respuesta.clone();
        void leerCopia(copia, tipoContenido).then(
          (cuerpoRecibido) => emitir({ estado: respuesta.status, ms, msCuerpo: performance.now() - inicio, cuerpoRecibido }),
          (error: unknown) => emitir({ estado: respuesta.status, ms, msCuerpo: performance.now() - inicio, cuerpoRecibido: { omitido: "no legible", motivo: serializarError(error).mensaje } }),
        );
      }
    } catch {
      emitir({ estado: respuesta.status, ms });
    }
    return respuesta;
  };
  return envuelto as typeof fetch;
}

/* ---------- Herramientas del bucle de tool-calling ---------- */

/**
 * Envuelve cada manejador de un registro de herramientas (`RegistroHerramientas` de agente-core o el
 * objeto literal de /api/asistente-guiado): `herramienta` con argumentos, resultado, ok, ms o error.
 */
export function envolverRegistroHerramientas<R extends Record<string, (...argumentos: never[]) => Promise<unknown>>>(registro: R): R {
  if (yaEnvuelto(registro)) return registro;
  const envuelto: Record<string, (...argumentos: never[]) => Promise<unknown>> = {};
  for (const [nombre, manejador] of Object.entries(registro)) {
    envuelto[nombre] = async (...argumentos: never[]) => {
      const inicio = performance.now();
      const contexto = contextoActual();
      const args: unknown = argumentos[0];
      const llamada: unknown = argumentos[1];
      const llamadaId = esObjeto(llamada) ? texto(llamada.id) : undefined;
      try {
        const resultado = await manejador(...argumentos);
        try {
          const ms = Math.round(performance.now() - inicio);
          const ok = !(esObjeto(resultado) && resultado.ok === false);
          auditar("herramienta", { nombre, ...(llamadaId ? { llamadaId } : {}), argumentos: args, resultado, ok, ms }, { contexto, ms });
        } catch {
          // Nunca lanza.
        }
        return resultado;
      } catch (error) {
        try {
          const ms = Math.round(performance.now() - inicio);
          auditar("herramienta", { nombre, ...(llamadaId ? { llamadaId } : {}), argumentos: args, ok: false, ms, error: serializarError(error) }, { contexto, ms });
        } catch {
          // Nunca lanza.
        }
        throw error;
      }
    };
  }
  return marcar(envuelto as R);
}

/* ---------- Generación de imagen (fal / FLUX, directo o vía Python) ---------- */

export interface DescripcionImagen {
  proveedor: string;
  endpoint?: string;
  modelo?: string;
  prompt?: string;
  referencias?: readonly ReferenciaImagenAuditada[];
  parametros?: Record<string, unknown>;
  costeEstimadoUsd?: number;
}

export interface ResultadoImagenAuditable {
  url?: string;
  base64?: string;
  mime?: string;
  proveedorRequestId?: string;
}

function referenciaAuditada(referencia: ReferenciaImagenAuditada): Record<string, unknown> {
  const huella = referencia.base64 ? huellaBase64(referencia.base64) : referencia.url ? huellaDataUrl(referencia.url) : undefined;
  return {
    ...(referencia.id ? { id: referencia.id } : {}),
    ...(referencia.rol ? { rol: referencia.rol } : {}),
    ...(referencia.mime ? { mime: referencia.mime } : {}),
    ...(huella ?? {}),
    ...(!huella && referencia.url ? { url: urlSaneada(referencia.url) } : {}),
  };
}

/** Un evento `imagen` por generación: prompt, referencias como hash, parámetros, resultado, ms y coste. */
export async function auditarGeneracionImagen<T>(
  descripcion: DescripcionImagen,
  ejecutar: () => Promise<T>,
  extraer?: (resultado: T) => ResultadoImagenAuditable,
): Promise<T> {
  const contexto = contextoActual();
  const inicio = performance.now();
  const base = (): Omit<DatosImagen, "ms"> => ({
    proveedor: descripcion.proveedor,
    ...(descripcion.endpoint ? { endpoint: descripcion.endpoint } : {}),
    ...(descripcion.modelo ? { modelo: descripcion.modelo } : {}),
    ...(descripcion.prompt !== undefined ? { prompt: descripcion.prompt } : {}),
    ...(descripcion.referencias ? { referencias: descripcion.referencias.map(referenciaAuditada) } : {}),
    ...(descripcion.parametros ? { parametros: descripcion.parametros } : {}),
    ...(descripcion.costeEstimadoUsd !== undefined ? { costeEstimadoUsd: descripcion.costeEstimadoUsd } : {}),
  });
  let resultado: T;
  try {
    resultado = await ejecutar();
  } catch (error) {
    try {
      const ms = Math.round(performance.now() - inicio);
      auditar("imagen", { ...base(), ms, error: serializarError(error) }, { contexto, ms });
    } catch {
      // Nunca lanza.
    }
    throw error;
  }
  try {
    const ms = Math.round(performance.now() - inicio);
    const extraido = extraer?.(resultado);
    const huella = extraido?.base64 ? huellaBase64(extraido.base64) : undefined;
    auditar("imagen", {
      ...base(),
      ms,
      ...(extraido
        ? {
            resultado: {
              ...(extraido.url ? { url: urlSaneada(extraido.url) } : {}),
              ...(huella ? { imagen: huella.imagen, bytes: huella.bytes } : {}),
              ...(extraido.mime ? { mime: extraido.mime } : {}),
              ...(extraido.proveedorRequestId ? { proveedorRequestId: extraido.proveedorRequestId } : {}),
            },
          }
        : {}),
    }, { contexto, ms });
  } catch {
    // Nunca lanza.
  }
  return resultado;
}
