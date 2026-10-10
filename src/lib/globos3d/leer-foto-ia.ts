import { ThinkingLevel, type Content } from "@google/genai";
import { z } from "zod";
import { MODELO_CHAT } from "@/lib/gemini";
import { costeClaudeUsd } from "@/lib/ia/claude/precios";
import { clienteGenerativoDe, destinoGenerativo, type DestinoGenerativo } from "@/lib/ia/nucleo/cliente-generativo";
import { paraGoogleSchema } from "@/lib/ia/nucleo/esquema-google";
import { registrarSegunProveedor, resultadoTelemetria } from "@/lib/ia/nucleo/telemetria-llamadas";
import { decidir } from "@/lib/registro/servidor";
import { corregirFondosLeidos } from "./fondos-sinonimos";
import { ESQUEMA_LECTURA_FOTO, LecturaFotoSchema, PiezaLeidaSchema, type LecturaFoto } from "./lectura-foto";
import { PEDIDO_LECTURA, construirPromptLectura } from "./prompt-lectura-foto";

/**
 * **Gemini lee la foto** (REQ-001 paso 7): visión de Gemini Flash con salida estructurada (el esquema de
 * `lectura-foto.ts`) → una `LecturaFoto` que `compilar-lectura.ts` convierte en escena. Solo texto/JSON de salida:
 * aquí nunca se generan imágenes. La validación es la de Zod; si la respuesta no cumple, se reintenta UNA vez
 * mostrándole al modelo su error, y si aun así quedan piezas válidas se conservan y se anota cuáles se descartaron.
 * Cada intento queda en el registro (`decidir`) y en la telemetría (`registrarSegunProveedor`) con su coste estimado.
 * W5: el cliente lo da el registro (`clienteGenerativoDe`): Gemini en producción (la misma petición de siempre) y Claude
 * Haiku en local cuando está activo (la imagen va como bloque de imagen y el esquema como herramienta forzada).
 */

/** El propósito con que se audita el cliente de Gemini. */
export const PROPOSITO_LECTURA_FOTO = "lectura_foto_escena";
const SUPERFICIE = "/api/escena-desde-foto";
const MAX_TOKENS_SALIDA = 12_000;
/** Más baja que la de fábrica (1,0): una lectura debe repetirse parecido de una corrida a otra. */
const TEMPERATURA_LECTURA = 0.3;

export type UsoModelo = { entrada: number; salida: number; pensamiento: number };
export type FotoLectura = { bytes: Uint8Array; mime: string };
export type Generacion = { texto: string; uso: UsoModelo; finishReason?: string };
export type PeticionLectura = { sistema: string; contents: Content[]; esquema: Record<string, unknown>; signal?: AbortSignal };
/** Quién habla con el modelo (inyectable: las pruebas no tocan la red). */
export type GenerarLectura = (peticion: PeticionLectura) => Promise<Generacion>;

export type ResultadoLectura = {
  lectura: LecturaFoto;
  /** Piezas que el modelo escribió mal aun tras el reintento y que se dejaron fuera. */
  descartadas: string[];
  uso: UsoModelo;
  costeEstimadoUsd: number;
  intentos: number;
  modelo: string;
};

export type CausaErrorLectura = "sin_ia" | "modelo" | "invalida";
export class ErrorLecturaFoto extends Error {
  constructor(mensaje: string, readonly causa: CausaErrorLectura) { super(mensaje); }
}

/** US$ de una llamada con los precios de Gemini Flash (US$0,50 por millón de entrada; US$3 por millón de salida y pensamiento). */
export function costeFlashUsd(uso: UsoModelo): number {
  return Math.round(((uso.entrada * 0.5 + (uso.salida + uso.pensamiento) * 3) / 1e6) * 1e5) / 1e5;
}

/**
 * Con un modelo de Claude, sus precios (sin desglose de caché: el exacto queda en `respuesta_ia`); si no, `costeFlashUsd`.
 * Por Claude Code (`transporte: "cli"`) 0: lo paga la suscripción, no hay factura por llamada.
 */
export function costeUsoUsd(uso: UsoModelo, modelo: string, transporte?: DestinoGenerativo["transporte"]): number {
  if (transporte === "cli") return 0;
  const claude = costeClaudeUsd(modelo, { input_tokens: uso.entrada, output_tokens: uso.salida + uso.pensamiento });
  return claude === undefined ? costeFlashUsd(uso) : Math.round(claude * 1e5) / 1e5;
}

/** El destino de la telemetría cuando la generación viene inyectada (pruebas): Gemini, como siempre. */
const GEMINI_INYECTADO: DestinoGenerativo = { proveedor: "gemini", modelo: MODELO_CHAT };

const sumarUso = (a: UsoModelo, b: UsoModelo): UsoModelo => ({ entrada: a.entrada + b.entrada, salida: a.salida + b.salida, pensamiento: a.pensamiento + b.pensamiento });
const corto = (t: string, n: number) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);

// ----------------------------------------------------------------------------------------------------------
// Esquema para Gemini
// ----------------------------------------------------------------------------------------------------------

/**
 * Campos de la lectura que el modelo no escribe: los calculan las detecciones de globos y de fondos (`medir-con-detecciones.ts`,
 * `medir-fondos.ts`) y solo
 * los traen las lecturas a mano. Fuera del esquema de Gemini, que con ellos pasa de su tope de complejidad (la API
 * rechaza el esquema entero con «invalid argument»; comprobado el 2026-10-09 quitando uno u otro).
 */
export const SOLO_MEDIDOS: ReadonlySet<string> = new Set(["coloresPorEscalon", "dominante", "anclas", "cajas"]);

/** Por encima de estos valores, una enumeración va al esquema de Gemini como texto libre (ver `paraGemini`). */
export const ENUM_MAXIMO_PARA_GEMINI = 20;

/**
 * Lo que Gemini no digiere del esquema de Zod: `const` de una cadena → `enum` de un valor, y `maxItems` (con `maxItems: 30`
 * en las piezas, cada una con sus colores, rechaza el esquema entero con «invalid argument»; comprobado contra la API real
 * el 2026-10-09). Los topes de cantidad los vuelve a exigir Zod al validar y el prompt los dice.
 */

function paraGemini(nodo: unknown): unknown {
  if (Array.isArray(nodo)) return nodo.map(paraGemini);
  if (nodo === null || typeof nodo !== "object") return nodo;
  return Object.fromEntries(Object.entries(nodo as Record<string, unknown>).flatMap(([clave, valor]) => {
    if (clave === "maxItems") return [];
    if (clave === "const") return [["enum", [valor]]];
    // Un catálogo largo (los ids de fondos y muebles) va como texto: con él, las enumeraciones del esquema pasan del tope
    // de Gemini. El prompt lista el catálogo y Zod rechaza un id que no exista (y la lectura se reintenta con el error).
    if (clave === "enum" && Array.isArray(valor) && valor.length > ENUM_MAXIMO_PARA_GEMINI) return [];
    if (clave === "properties" && valor && typeof valor === "object") return [[clave, paraGemini(Object.fromEntries(Object.entries(valor as Record<string, unknown>).filter(([k]) => !SOLO_MEDIDOS.has(k))))]];
    if (clave === "required" && Array.isArray(valor)) return [[clave, valor.filter((k) => !SOLO_MEDIDOS.has(String(k)))]];
    return [[clave, paraGemini(valor)]];
  }));
}

/** El esquema de la lectura en el subconjunto de JSON Schema de Gemini (sin `$schema`, `additionalProperties`, `const`, `maxItems` ni catálogos largos). */
export function esquemaLecturaParaGemini(): Record<string, unknown> {
  return paraGemini(paraGoogleSchema(ESQUEMA_LECTURA_FOTO)) as Record<string, unknown>;
}

// ----------------------------------------------------------------------------------------------------------
// Validación de lo que escribió el modelo
// ----------------------------------------------------------------------------------------------------------

const textoDeIssues = (error: z.ZodError) => error.issues.slice(0, 8).map((i) => `${i.path.join(".") || "(raíz)"}: ${i.message}`).join("; ");

/** `correcciones`: los ids de fondo inventados que se arreglaron antes de validar (`fondos-sinonimos.ts`), para el registro. */
export type Validacion = { ok: true; lectura: LecturaFoto; correcciones: string[] } | { ok: false; error: string; correcciones: string[]; parcial: { lectura: LecturaFoto; descartadas: string[] } | null };

/** La lectura del texto del modelo; si falla, el motivo y, si hay piezas buenas, la lectura parcial con las descartadas. */
export function validarLectura(texto: string): Validacion {
  let sinCorregir: unknown;
  try { sinCorregir = JSON.parse(texto); } catch (e) { return { ok: false, error: `La respuesta no es JSON válido (${e instanceof Error ? e.message : String(e)}).`, correcciones: [], parcial: null }; }
  // Un id de fondo inventado no justifica una segunda lectura entera: se mapea a un sinónimo o la pieza pasa a «otro».
  const { crudo, correcciones } = corregirFondosLeidos(sinCorregir);
  const completo = LecturaFotoSchema.safeParse(crudo);
  if (completo.success) return { ok: true, lectura: completo.data, correcciones };
  const error = textoDeIssues(completo.error);
  const piezas = typeof crudo === "object" && crudo !== null && Array.isArray((crudo as { piezas?: unknown }).piezas) ? (crudo as { piezas: unknown[] }).piezas : null;
  if (!piezas) return { ok: false, error, correcciones, parcial: null };
  const cabecera = LecturaFotoSchema.omit({ piezas: true }).safeParse(crudo);
  if (!cabecera.success) return { ok: false, error, correcciones, parcial: null };
  const buenas: LecturaFoto["piezas"] = [], descartadas: string[] = [];
  piezas.forEach((p, i) => {
    const r = PiezaLeidaSchema.safeParse(p);
    if (r.success) buenas.push(r.data);
    else descartadas.push(`Pieza ${i + 1} (${typeof p === "object" && p !== null && "tipo" in p ? String((p as { tipo: unknown }).tipo) : "?"}): ${textoDeIssues(r.error)}`);
  });
  return { ok: false, error, correcciones, parcial: buenas.length ? { lectura: { ...cabecera.data, piezas: buenas.slice(0, 30) }, descartadas } : null };
}

// ----------------------------------------------------------------------------------------------------------
// El modelo
// ----------------------------------------------------------------------------------------------------------

/** El generador real: el modelo del registro (Gemini Flash; Claude en local) con la foto, salida JSON con el esquema de la lectura. */
export const generarConModelo: GenerarLectura = async ({ sistema, contents, esquema, signal }) => {
  const generativo = clienteGenerativoDe(PROPOSITO_LECTURA_FOTO);
  if (!generativo) throw new ErrorLecturaFoto("La IA no está configurada en este servidor.", "sin_ia");
  const r = await generativo.cliente.models.generateContent({
    model: generativo.modelo,
    contents,
    config: { systemInstruction: sistema, responseMimeType: "application/json", responseJsonSchema: esquema, thinkingConfig: { thinkingLevel: ThinkingLevel.LOW }, maxOutputTokens: MAX_TOKENS_SALIDA, temperature: TEMPERATURA_LECTURA, abortSignal: signal },
  });
  const partes = r.candidates?.[0]?.content?.parts ?? [];
  return {
    texto: partes.filter((p) => typeof p.text === "string" && p.thought !== true).map((p) => p.text).join("").trim(),
    uso: { entrada: r.usageMetadata?.promptTokenCount ?? 0, salida: r.usageMetadata?.candidatesTokenCount ?? 0, pensamiento: r.usageMetadata?.thoughtsTokenCount ?? 0 },
    finishReason: r.candidates?.[0]?.finishReason,
  };
};

export type OpcionesLectura = {
  generar?: GenerarLectura;
  /** Ids de referencias del dueño que NO van de ejemplo (la evaluación excluye la foto que mide). */
  excluirEjemplos?: readonly string[];
  signal?: AbortSignal;
  /** Para la telemetría: de dónde vino el pedido. */
  superficie?: string;
};

/**
 * Lee la foto: una llamada a Gemini y, si su JSON no cumple el esquema, una segunda con el error a la vista.
 * Lanza `ErrorLecturaFoto` si la IA no responde o no deja ni una pieza válida.
 */
export async function leerFotoConIA(foto: FotoLectura, opciones: OpcionesLectura = {}): Promise<ResultadoLectura> {
  const generar = opciones.generar ?? generarConModelo;
  const destino = opciones.generar ? GEMINI_INYECTADO : destinoGenerativo();
  const sistema = construirPromptLectura(opciones.excluirEjemplos);
  const esquema = esquemaLecturaParaGemini();
  const imagen = { inlineData: { mimeType: foto.mime, data: Buffer.from(foto.bytes).toString("base64") } };
  const contents: Content[] = [{ role: "user", parts: [imagen, { text: PEDIDO_LECTURA }] }];
  let uso: UsoModelo = { entrada: 0, salida: 0, pensamiento: 0 };
  let ultimo: Validacion | null = null;

  for (let intento = 1; intento <= 2; intento++) {
    const inicio = Date.now();
    let g: Generacion;
    try {
      g = await generar({ sistema, contents, esquema, signal: opciones.signal });
    } catch (error) {
      registrarSegunProveedor(destino.proveedor, { flujo: "analisis_referencia", capacidad: "analisis_referencia_inventario", modelo: destino.modelo, inicio, resultado: resultadoTelemetria(error), contexto: { superficie: opciones.superficie ?? SUPERFICIE, intento }, bytesImagenEntrada: foto.bytes.byteLength, thinkingLevel: destino.esfuerzo ?? "low" });
      if (error instanceof ErrorLecturaFoto) throw error;
      decidir("modelo:lectura_foto", "la IA no pudo leer la foto", { error: corto(error instanceof Error ? error.message : String(error), 300), intento });
      throw new ErrorLecturaFoto(error instanceof Error ? error.message : String(error), "modelo");
    }
    uso = sumarUso(uso, g.uso);
    registrarSegunProveedor(destino.proveedor, {
      flujo: "analisis_referencia", capacidad: "analisis_referencia_inventario", modelo: destino.modelo, inicio, resultado: "ok", contexto: { superficie: opciones.superficie ?? SUPERFICIE, intento },
      usage: { promptTokenCount: g.uso.entrada, candidatesTokenCount: g.uso.salida, thoughtsTokenCount: g.uso.pensamiento }, bytesImagenEntrada: foto.bytes.byteLength, thinkingLevel: destino.esfuerzo ?? "low", finishReason: g.finishReason,
    });
    const validada = validarLectura(g.texto);
    decidir("modelo:lectura_foto", validada.ok ? "lectura de la foto válida" : "lectura de la foto con errores de esquema", {
      intento, ok: validada.ok, error: validada.ok ? null : corto(validada.error, 400), tokens: g.uso, costeEstimadoUsd: costeUsoUsd(g.uso, destino.modelo, destino.transporte), modelo: destino.modelo, finishReason: g.finishReason ?? null,
      piezas: validada.ok ? validada.lectura.piezas.map((p) => p.tipo) : null, ...(validada.correcciones.length ? { fondosCorregidos: validada.correcciones } : {}),
    }, { entrada: { bytesFoto: foto.bytes.byteLength, mime: foto.mime } });
    if (validada.ok) return { lectura: validada.lectura, descartadas: [], uso, costeEstimadoUsd: costeUsoUsd(uso, destino.modelo, destino.transporte), intentos: intento, modelo: destino.modelo };
    ultimo = validada;
    contents.push(
      { role: "model", parts: [{ text: corto(g.texto, 20_000) }] },
      { role: "user", parts: [{ text: `Tu JSON no cumple el esquema: ${corto(validada.error, 1500)}. Devuelve la lectura COMPLETA corregida, solo el JSON.` }] },
    );
  }

  if (ultimo && !ultimo.ok && ultimo.parcial) {
    return { lectura: ultimo.parcial.lectura, descartadas: ultimo.parcial.descartadas, uso, costeEstimadoUsd: costeUsoUsd(uso, destino.modelo, destino.transporte), intentos: 2, modelo: destino.modelo };
  }
  throw new ErrorLecturaFoto(`La IA no devolvió una lectura válida de la foto${ultimo && !ultimo.ok ? `: ${corto(ultimo.error, 300)}` : ""}.`, "invalida");
}
