import { ThinkingLevel } from "@google/genai";
import sharp from "sharp";
import { getGeminiClient, MODELO_CHAT } from "@/lib/gemini";
import { registrarGemini, resultadoTelemetria } from "@/lib/ia/nucleo/telemetria-llamadas";
import { decidir } from "@/lib/registro/servidor";
import { costeFlashUsd, type FotoLectura, type UsoModelo } from "./leer-foto-ia";
import type { GloboDetectado } from "./medir-con-detecciones";

/**
 * **Gemini detecta los globos de la foto uno por uno** (una caja `box_2d` y un color por globo): lo que mejor mide el
 * modelo, y con lo que `medir-con-detecciones.ts` corrige la lectura (escala, tamaños, grosor y mezcla de cada tramo,
 * colores). En la foto entera se salta la mitad (los chicos y los tapados), así que se parte en un mosaico de 3 × 3 con
 * solape, cada trozo ampliado, en paralelo; las cajas vuelven a coordenadas de la foto y las repetidas del solape se funden.
 * Solo lee: nunca genera imágenes. Cada trozo queda en la telemetría con su coste (≈ US$0,001).
 */

export const PROPOSITO_DETECCION_GLOBOS = "deteccion_globos_foto";
const LADOS = 3;
const SOLAPE = 0.15;
const LADO_TROZO_PX = 1024;
const IOU_REPETIDA = 0.4;
const COLORES_DETECCION = ["dorado", "plateado", "blanco", "negro", "rosa", "fucsia", "rojo", "vino", "naranja", "amarillo", "verde", "azul", "azul marino", "morado", "lila", "nude", "beige", "cafe", "gris", "confeti", "transparente", "otro"] as const;

const PEDIDO = "Detecta TODOS los globos de látex visibles en esta imagen, uno por uno: grandes, medianos y los chiquitos (5 pulgadas), también los parcialmente tapados si se ve al menos media esfera. No cuentes globos de foil (letras, números, figuras). Devuelve una lista JSON de objetos {\"box_2d\": [ymin, xmin, ymax, xmax] normalizado 0-1000, \"color\": el color del globo}. No te saltes ninguno.";

const ESQUEMA = {
  type: "array",
  items: {
    type: "object",
    properties: {
      box_2d: { type: "array", items: { type: "integer" }, minItems: 4, maxItems: 4 },
      color: { type: "string", enum: [...COLORES_DETECCION] },
    },
    required: ["box_2d", "color"],
  },
};

type Caja = [number, number, number, number];
export type Deteccion = { globos: GloboDetectado[]; uso: UsoModelo; costeEstimadoUsd: number; trozos: number; fallidos: number };

function iou(a: Caja, b: Caja): number {
  const y0 = Math.max(a[0], b[0]), x0 = Math.max(a[1], b[1]), y1 = Math.min(a[2], b[2]), x1 = Math.min(a[3], b[3]);
  const inter = Math.max(0, y1 - y0) * Math.max(0, x1 - x0);
  const area = (q: Caja) => (q[2] - q[0]) * (q[3] - q[1]);
  return inter / (area(a) + area(b) - inter || 1);
}

/** Funde las cajas repetidas (del solape entre trozos): de mayor a menor, se queda la primera de cada grupo. */
export function fundirRepetidas(globos: readonly GloboDetectado[]): GloboDetectado[] {
  const salida: GloboDetectado[] = [];
  const area = (g: GloboDetectado) => (g.box_2d[2]! - g.box_2d[0]!) * (g.box_2d[3]! - g.box_2d[1]!);
  for (const g of [...globos].sort((a, b) => area(b) - area(a))) {
    if (salida.every((f) => iou(g.box_2d as Caja, f.box_2d as Caja) < IOU_REPETIDA)) salida.push(g);
  }
  return salida;
}

/** Los trozos del mosaico (fracciones de la foto), con solape. */
export function trozosDelMosaico(lados = LADOS, solape = SOLAPE): Array<{ x0: number; y0: number; x1: number; y1: number }> {
  const paso = 1 / lados;
  return Array.from({ length: lados * lados }, (_, k) => {
    const i = Math.floor(k / lados), j = k % lados;
    return { x0: Math.max(0, j * paso - solape / 2), x1: Math.min(1, (j + 1) * paso + solape / 2), y0: Math.max(0, i * paso - solape / 2), y1: Math.min(1, (i + 1) * paso + solape / 2) };
  });
}

/** Detecta los globos de la foto. Lanza solo si no responde ningún trozo; un trozo que falla queda en `fallidos`. */
export async function detectarGlobos(foto: FotoLectura, opciones: { signal?: AbortSignal; superficie?: string } = {}): Promise<Deteccion> {
  const cliente = getGeminiClient(PROPOSITO_DETECCION_GLOBOS);
  if (!cliente) throw new Error("La IA no está configurada en este servidor.");
  const imagen = sharp(foto.bytes).rotate();
  const { width = 0, height = 0 } = await imagen.metadata();
  if (!width || !height) throw new Error("No se pudo leer la foto para detectar los globos.");
  const trozos = trozosDelMosaico();
  const resultados = await Promise.all(trozos.map(async (t) => {
    const inicio = Date.now();
    const left = Math.floor(t.x0 * width), top = Math.floor(t.y0 * height);
    const ancho = Math.max(1, Math.floor((t.x1 - t.x0) * width)), alto = Math.max(1, Math.floor((t.y1 - t.y0) * height));
    try {
      const bytes = await sharp(foto.bytes).rotate().extract({ left, top, width: ancho, height: alto }).resize({ width: LADO_TROZO_PX }).jpeg({ quality: 90 }).toBuffer();
      const r = await cliente.models.generateContent({
        model: MODELO_CHAT,
        contents: [{ role: "user", parts: [{ inlineData: { mimeType: "image/jpeg", data: bytes.toString("base64") } }, { text: PEDIDO }] }],
        config: { responseMimeType: "application/json", responseJsonSchema: ESQUEMA, thinkingConfig: { thinkingLevel: ThinkingLevel.LOW }, maxOutputTokens: 16_000, temperature: 0.5, abortSignal: opciones.signal },
      });
      const uso: UsoModelo = { entrada: r.usageMetadata?.promptTokenCount ?? 0, salida: r.usageMetadata?.candidatesTokenCount ?? 0, pensamiento: r.usageMetadata?.thoughtsTokenCount ?? 0 };
      registrarGemini({ flujo: "analisis_referencia", capacidad: "analisis_referencia_inventario", modelo: MODELO_CHAT, inicio, resultado: "ok", contexto: { superficie: opciones.superficie ?? "deteccion_globos" }, usage: r.usageMetadata, bytesImagenEntrada: bytes.byteLength, thinkingLevel: "low", finishReason: r.candidates?.[0]?.finishReason });
      const texto = (r.candidates?.[0]?.content?.parts ?? []).filter((p) => typeof p.text === "string" && p.thought !== true).map((p) => p.text).join("");
      const crudo: unknown = JSON.parse(texto || "[]");
      const globos: GloboDetectado[] = (Array.isArray(crudo) ? crudo : []).flatMap((g: unknown) => {
        const caja = (g as { box_2d?: unknown }).box_2d, color = (g as { color?: unknown }).color;
        if (!Array.isArray(caja) || caja.length !== 4 || !caja.every((n) => typeof n === "number")) return [];
        const [a, b, c, d] = caja as number[];
        // Del trozo a la foto entera.
        const caja2d: Caja = [Math.round((t.y0 + (a! / 1000) * (t.y1 - t.y0)) * 1000), Math.round((t.x0 + (b! / 1000) * (t.x1 - t.x0)) * 1000), Math.round((t.y0 + (c! / 1000) * (t.y1 - t.y0)) * 1000), Math.round((t.x0 + (d! / 1000) * (t.x1 - t.x0)) * 1000)];
        return [{ box_2d: caja2d, color: typeof color === "string" ? color : "otro" }];
      });
      return { globos, uso, ok: true };
    } catch (error) {
      registrarGemini({ flujo: "analisis_referencia", capacidad: "analisis_referencia_inventario", modelo: MODELO_CHAT, inicio, resultado: resultadoTelemetria(error), contexto: { superficie: opciones.superficie ?? "deteccion_globos" }, thinkingLevel: "low" });
      return { globos: [] as GloboDetectado[], uso: { entrada: 0, salida: 0, pensamiento: 0 }, ok: false };
    }
  }));
  const fallidos = resultados.filter((r) => !r.ok).length;
  if (fallidos === resultados.length) throw new Error("La IA no pudo detectar los globos de la foto.");
  const uso = resultados.reduce<UsoModelo>((s, r) => ({ entrada: s.entrada + r.uso.entrada, salida: s.salida + r.uso.salida, pensamiento: s.pensamiento + r.uso.pensamiento }), { entrada: 0, salida: 0, pensamiento: 0 });
  const globos = fundirRepetidas(resultados.flatMap((r) => r.globos));
  decidir("modelo:deteccion_globos", "globos detectados en la foto", { globos: globos.length, trozos: trozos.length, fallidos, tokens: uso, costeEstimadoUsd: costeFlashUsd(uso) }, { entrada: { bytesFoto: foto.bytes.byteLength } });
  return { globos, uso, costeEstimadoUsd: costeFlashUsd(uso), trozos: trozos.length, fallidos };
}

// ----------------------------------------------------------------------------------------------------------
// Fondos y muebles
// ----------------------------------------------------------------------------------------------------------

/** Un fondo o mueble del catálogo detectado en la foto: su caja (0-1000) y su id. */
export type FondoDetectado = { box_2d: readonly number[]; id: string };

/**
 * Detecta los fondos y muebles del catálogo (pared de lentejuelas, panel redondo, mesa, pedestales…) con su caja, en la
 * foto entera: el lector los mide a ojo (una pared de 0,42 del ancho la leyó de 0,55) y con la caja quedan donde van.
 */
export async function detectarFondos(foto: FotoLectura, catalogo: ReadonlyArray<{ id: string; descripcion: string }>, opciones: { signal?: AbortSignal; superficie?: string } = {}): Promise<{ fondos: FondoDetectado[]; uso: UsoModelo; costeEstimadoUsd: number }> {
  const cliente = getGeminiClient(PROPOSITO_DETECCION_GLOBOS);
  if (!cliente) throw new Error("La IA no está configurada en este servidor.");
  const inicio = Date.now();
  const ids = [...catalogo.map((c) => c.id), "otro"];
  const pedido = `Detecta los fondos de escenografía y muebles de la foto (NO los globos) y devuelve cada uno con su box_2d [ymin, xmin, ymax, xmax] normalizado 0-1000 y su id del catálogo. La caja abarca el objeto entero aunque haya globos delante (estima el borde tapado por la forma del objeto). Catálogo: ${catalogo.map((c) => `${c.id}: ${c.descripcion}`).join(" · ")}. Lo que no esté en el catálogo, id "otro".`;
  const esquema = { type: "array", items: { type: "object", properties: { box_2d: { type: "array", items: { type: "integer" }, minItems: 4, maxItems: 4 }, id: { type: "string", enum: ids } }, required: ["box_2d", "id"] } };
  try {
    const r = await cliente.models.generateContent({
      model: MODELO_CHAT,
      contents: [{ role: "user", parts: [{ inlineData: { mimeType: foto.mime, data: Buffer.from(foto.bytes).toString("base64") } }, { text: pedido }] }],
      config: { responseMimeType: "application/json", responseJsonSchema: esquema, thinkingConfig: { thinkingLevel: ThinkingLevel.LOW }, maxOutputTokens: 4000, temperature: 0.3, abortSignal: opciones.signal },
    });
    const uso: UsoModelo = { entrada: r.usageMetadata?.promptTokenCount ?? 0, salida: r.usageMetadata?.candidatesTokenCount ?? 0, pensamiento: r.usageMetadata?.thoughtsTokenCount ?? 0 };
    registrarGemini({ flujo: "analisis_referencia", capacidad: "analisis_referencia_inventario", modelo: MODELO_CHAT, inicio, resultado: "ok", contexto: { superficie: opciones.superficie ?? "deteccion_fondos" }, usage: r.usageMetadata, bytesImagenEntrada: foto.bytes.byteLength, thinkingLevel: "low", finishReason: r.candidates?.[0]?.finishReason });
    const texto = (r.candidates?.[0]?.content?.parts ?? []).filter((p) => typeof p.text === "string" && p.thought !== true).map((p) => p.text).join("");
    const crudo: unknown = JSON.parse(texto || "[]");
    const fondos = (Array.isArray(crudo) ? crudo : []).flatMap((f: unknown): FondoDetectado[] => {
      const caja = (f as { box_2d?: unknown }).box_2d, id = (f as { id?: unknown }).id;
      return Array.isArray(caja) && caja.length === 4 && caja.every((n) => typeof n === "number") && typeof id === "string" && id !== "otro" ? [{ box_2d: caja as number[], id }] : [];
    });
    return { fondos, uso, costeEstimadoUsd: costeFlashUsd(uso) };
  } catch (error) {
    registrarGemini({ flujo: "analisis_referencia", capacidad: "analisis_referencia_inventario", modelo: MODELO_CHAT, inicio, resultado: resultadoTelemetria(error), contexto: { superficie: opciones.superficie ?? "deteccion_fondos" }, thinkingLevel: "low" });
    throw error;
  }
}
