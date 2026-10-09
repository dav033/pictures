import { ThinkingLevel } from "@google/genai";
import sharp from "sharp";
import { getGeminiClient, MODELO_CHAT } from "@/lib/gemini";
import { registrarGemini, resultadoTelemetria } from "@/lib/ia/nucleo/telemetria-llamadas";
import { decidir } from "@/lib/registro/servidor";
import { FONDOS_CATALOGO } from "./fondos-escenografia";
import { costeFlashUsd, type FotoLectura, type UsoModelo } from "./leer-foto-ia";
import { COLORES_DETECCION } from "./medir-colores";
import type { FondoDetectado, GloboDetectado } from "./medir-con-detecciones";
import { fundirRepetidas, trozosDelMosaico } from "./mosaico-deteccion";
import { cajasSospechosas, recorteDeCaja } from "./racimos-detectados";

export { fundirRepetidas, trozosDelMosaico } from "./mosaico-deteccion";
export type { FondoDetectado } from "./medir-con-detecciones";

/**
 * **Gemini detecta los globos de la foto uno por uno** (una caja `box_2d` y un color por globo) **y los fondos del catálogo**:
 * lo que mejor mide el modelo, y con lo que `medir-con-detecciones.ts` corrige la lectura (escala, tamaños, grosor y mezcla
 * de cada tramo, colores, fondos). En la foto entera se salta la mitad de los globos (los chicos y los tapados), así que se
 * parte en un mosaico de 3 × 3 con solape, cada trozo ampliado, en paralelo; las cajas vuelven a coordenadas de la foto y las
 * repetidas del solape se funden (`mosaico-deteccion.ts`); las cajas que se salen del tamaño de las demás se le enseñan recortadas a la IA y las que encierran un racimo entero se quitan (`racimos-detectados.ts`). La foto se decodifica una sola vez. Solo lee: nunca genera
 * imágenes. Cada llamada queda en la telemetría con su coste (≈ US$0,001 por trozo).
 *
 * La taxonomía de telemetría no tiene una capacidad aparte para esto: va como inventario de análisis de referencias, y
 * la `superficie` lleva el sufijo `:deteccion` para distinguirla de la lectura de la misma foto.
 */

export const PROPOSITO_DETECCION_GLOBOS = "deteccion_globos_foto";
const LADO_TROZO_PX = 1024;
const CALIDAD_JPEG = 90;
const TOKENS_SALIDA_TROZO = 16_000;
const TOKENS_SALIDA_FONDOS = 4000;
const TEMPERATURA_DETECCION = 0.5;
const TEMPERATURA_FONDOS = 0.3;
const LADO_RECORTE_PX = 512;
/** Una caja con al menos estos globos distintos dentro es un racimo (con 2 puede ser un globo y su reflejo, o uno que asoma). */
const GLOBOS_DE_UN_RACIMO = 3;
/** Si el globo más grande ocupa al menos este % del ancho de la caja, la caja es ese globo (con otros pegados), no un racimo. */
const PARTE_DEL_MAYOR_EN_UN_GLOBO = 70;
/** Pausa antes de reintentar la revisión (una cuota pasajera tras los nueve trozos). */
const ESPERA_REINTENTO_MS = 1500;
const TOKENS_SALIDA_RACIMOS = 2000;

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

/** `racimos`: las cajas grandes revisadas, las quitadas por ser un racimo entero y, si la revisión falló, por qué (se midieron todas). */
export type RevisionRacimos = { revisadas: number; quitadas: number; fallo?: string };
export type Deteccion = { globos: GloboDetectado[]; fondos: FondoDetectado[]; uso: UsoModelo; costeEstimadoUsd: number; trozos: number; fallidos: number; racimos: RevisionRacimos };

type Caja = [number, number, number, number];
const SIN_USO: UsoModelo = { entrada: 0, salida: 0, pensamiento: 0 };
const sumarUso = (a: UsoModelo, b: UsoModelo): UsoModelo => ({ entrada: a.entrada + b.entrada, salida: a.salida + b.salida, pensamiento: a.pensamiento + b.pensamiento });
const usoDe = (m: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number } | undefined): UsoModelo => ({ entrada: m?.promptTokenCount ?? 0, salida: m?.candidatesTokenCount ?? 0, pensamiento: m?.thoughtsTokenCount ?? 0 });

/** La lista JSON de lo que respondió el modelo (sin las partes de pensamiento). */
function jsonDe(partes: ReadonlyArray<{ text?: string; thought?: boolean }> | undefined): unknown {
  const texto = (partes ?? []).filter((p) => typeof p.text === "string" && p.thought !== true).map((p) => p.text).join("");
  return JSON.parse(texto || "[]");
}

const esCaja = (c: unknown): c is number[] => Array.isArray(c) && c.length === 4 && c.every((n) => typeof n === "number" && Number.isFinite(n));

/** La foto decodificada UNA vez y ya girada según su EXIF: sus píxeles y sus medidas de verdad (los de después de girar). */
async function decodificar(foto: FotoLectura): Promise<{ data: Buffer; width: number; height: number; channels: 1 | 2 | 3 | 4 }> {
  const { data, info } = await sharp(foto.bytes).rotate().raw().toBuffer({ resolveWithObject: true });
  if (!info.width || !info.height) throw new Error("No se pudo leer la foto para detectar los globos.");
  return { data, width: info.width, height: info.height, channels: info.channels };
}

/** Detecta los globos y los fondos de la foto. Lanza solo si no responde ningún trozo; un trozo que falla queda en `fallidos`. */
export async function detectarGlobos(foto: FotoLectura, opciones: { signal?: AbortSignal; superficie?: string } = {}): Promise<Deteccion> {
  const cliente = getGeminiClient(PROPOSITO_DETECCION_GLOBOS);
  if (!cliente) throw new Error("La IA no está configurada en este servidor.");
  const superficie = opciones.superficie ? `${opciones.superficie}:deteccion` : "deteccion_globos";
  const { data, width, height, channels } = await decodificar(foto);
  const trozos = trozosDelMosaico();
  const [resultados, fondos] = await Promise.all([
    Promise.all(trozos.map(async (t) => {
      const inicio = Date.now();
      const left = Math.floor(t.x0 * width), top = Math.floor(t.y0 * height);
      const ancho = Math.max(1, Math.floor((t.x1 - t.x0) * width)), alto = Math.max(1, Math.floor((t.y1 - t.y0) * height));
      try {
        const bytes = await sharp(data, { raw: { width, height, channels } }).extract({ left, top, width: ancho, height: alto }).resize({ width: LADO_TROZO_PX }).jpeg({ quality: CALIDAD_JPEG }).toBuffer();
        const r = await cliente.models.generateContent({
          model: MODELO_CHAT,
          contents: [{ role: "user", parts: [{ inlineData: { mimeType: "image/jpeg", data: bytes.toString("base64") } }, { text: PEDIDO }] }],
          config: { responseMimeType: "application/json", responseJsonSchema: ESQUEMA, thinkingConfig: { thinkingLevel: ThinkingLevel.LOW }, maxOutputTokens: TOKENS_SALIDA_TROZO, temperature: TEMPERATURA_DETECCION, abortSignal: opciones.signal },
        });
        const crudo = jsonDe(r.candidates?.[0]?.content?.parts);
        registrarGemini({ flujo: "analisis_referencia", capacidad: "analisis_referencia_inventario", modelo: MODELO_CHAT, inicio, resultado: "ok", contexto: { superficie }, usage: r.usageMetadata, bytesImagenEntrada: bytes.byteLength, thinkingLevel: "low", finishReason: r.candidates?.[0]?.finishReason });
        const globos: GloboDetectado[] = (Array.isArray(crudo) ? crudo : []).flatMap((g: unknown) => {
          const caja = (g as { box_2d?: unknown }).box_2d, color = (g as { color?: unknown }).color;
          if (!esCaja(caja)) return [];
          const [a, b, c, d] = caja as Caja;
          // Del trozo a la foto entera.
          const caja2d: Caja = [Math.round((t.y0 + (a / 1000) * (t.y1 - t.y0)) * 1000), Math.round((t.x0 + (b / 1000) * (t.x1 - t.x0)) * 1000), Math.round((t.y0 + (c / 1000) * (t.y1 - t.y0)) * 1000), Math.round((t.x0 + (d / 1000) * (t.x1 - t.x0)) * 1000)];
          return [{ box_2d: caja2d, color: typeof color === "string" ? color : "otro" }];
        });
        return { globos, uso: usoDe(r.usageMetadata), ok: true };
      } catch (error) {
        registrarGemini({ flujo: "analisis_referencia", capacidad: "analisis_referencia_inventario", modelo: MODELO_CHAT, inicio, resultado: resultadoTelemetria(error), contexto: { superficie }, thinkingLevel: "low" });
        return { globos: [] as GloboDetectado[], uso: SIN_USO, ok: false };
      }
    })),
    // Los fondos no son imprescindibles: si fallan, la lectura va con los que leyó el modelo.
    // La foto ya girada (con el mismo sistema de coordenadas que los trozos), no los bytes originales con su EXIF.
    sharp(data, { raw: { width, height, channels } }).jpeg({ quality: CALIDAD_JPEG }).toBuffer()
      .then((bytes) => detectarFondos({ bytes, mime: "image/jpeg" }, FONDOS_CATALOGO, { signal: opciones.signal, superficie }))
      .catch((error: unknown) => {
        decidir("modelo:deteccion_fondos", "no se pudieron detectar los fondos de la foto", { error: error instanceof Error ? error.message.slice(0, 300) : String(error) });
        return { fondos: [] as FondoDetectado[], uso: SIN_USO, costeEstimadoUsd: 0 };
      }),
  ]);
  const fallidos = resultados.filter((r) => !r.ok).length;
  if (fallidos === resultados.length) {
    decidir("modelo:deteccion_globos", "ningún trozo de la foto respondió: sin detección de globos", { trozos: trozos.length, fallidos }, { entrada: { bytesFoto: foto.bytes.byteLength } });
    throw new Error("La IA no pudo detectar los globos de la foto.");
  }
  let uso = sumarUso(resultados.reduce<UsoModelo>((s, r) => sumarUso(s, r.uso), SIN_USO), fondos.uso);
  const racimos = await descartarRacimos(cliente, { data, width, height, channels }, fundirRepetidas(resultados.flatMap((r) => r.globos)), { signal: opciones.signal, superficie });
  const globos = racimos.globos;
  uso = sumarUso(uso, racimos.uso);
  const costeEstimadoUsd = costeFlashUsd(uso);
  decidir("modelo:deteccion_globos", "globos y fondos detectados en la foto", { globos: globos.length, fondos: fondos.fondos.map((f) => f.id), trozos: trozos.length, fallidos, tokens: uso, costeEstimadoUsd }, { entrada: { bytesFoto: foto.bytes.byteLength } });
  return { globos, fondos: fondos.fondos, uso, costeEstimadoUsd, trozos: trozos.length, fallidos, racimos: racimos.revision };
}

// ----------------------------------------------------------------------------------------------------------
// Racimos tomados por un globo
// ----------------------------------------------------------------------------------------------------------

type Pixeles = { data: Buffer; width: number; height: number; channels: 1 | 2 | 3 | 4 };

/**
 * Las cajas que se salen del tamaño de las demás (`cajasSospechosas`) se recortan y se le enseñan a la IA en UNA llamada:
 * las que son varios globos (un racimo entero en una caja) se quitan antes de medir, para que no pasen por globos gigantes.
 * Si la llamada falla, se queda todo como estaba (y queda registrado).
 */
export async function descartarRacimos(cliente: NonNullable<ReturnType<typeof getGeminiClient>>, px: Pixeles, globos: GloboDetectado[], opciones: { signal?: AbortSignal; superficie: string }): Promise<{ globos: GloboDetectado[]; uso: UsoModelo; revision: RevisionRacimos }> {
  const sospechosas = cajasSospechosas(globos);
  if (!sospechosas.length) return { globos, uso: SIN_USO, revision: { revisadas: 0, quitadas: 0 } };
  // Sin revisión se miden todas, como antes, y queda dicho por qué.
  const sinRevisar = (fallo: string, uso: UsoModelo = SIN_USO) => {
    decidir("modelo:deteccion_globos", "no se pudieron revisar las cajas grandes: se miden todas", { revisadas: sospechosas.length, fallo });
    return { globos, uso, revision: { revisadas: sospechosas.length, quitadas: 0, fallo } };
  };
  const mensaje = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 200);
  let recortes: Buffer[];
  try {
    recortes = await Promise.all(sospechosas.map(async (i) => {
      const r = recorteDeCaja(globos[i]!);
      const left = Math.floor(r.x0 * px.width), top = Math.floor(r.y0 * px.height);
      const ancho = Math.max(1, Math.floor((r.x1 - r.x0) * px.width)), alto = Math.max(1, Math.floor((r.y1 - r.y0) * px.height));
      return sharp(px.data, { raw: { width: px.width, height: px.height, channels: px.channels } }).extract({ left, top, width: ancho, height: alto }).resize({ width: LADO_RECORTE_PX, height: LADO_RECORTE_PX, fit: "inside" }).jpeg({ quality: CALIDAD_JPEG }).toBuffer();
    }));
  } catch (error) {
    // Un recorte que falla no es una llamada a la IA: no va a su telemetría.
    return sinRevisar(`no se pudieron recortar las cajas: ${mensaje(error)}`);
  }
  const pedido = `Te paso ${recortes.length} recortes de una foto de decoración con globos, numerados del 1 al ${recortes.length} en orden. En cada uno hay una caja en el centro que alguien marcó como «un globo». Para cada recorte dime: "globos", cuántos globos DISTINTOS ocupan esa caja central (cada globo es un contorno redondo propio; un globo cromado, perlado o metalizado refleja otros globos y la sala en su superficie: esos reflejos NO son globos; los vecinos que solo asoman por el borde no cuentan), y "mayor", qué parte del ANCHO de la caja ocupa el globo más grande que hay en ella, de 0 a 100 (un globo gigante que llena la caja es 90 o más aunque tenga globos chicos pegados delante; en un racimo de globos parecidos, el mayor ocupa la mitad o menos). Devuelve una lista JSON con un objeto por recorte: {"recorte": número, "globos": número, "mayor": número}.`;
  const partes = recortes.flatMap((bytes, k) => [{ text: `Recorte ${k + 1}:` }, { inlineData: { mimeType: "image/jpeg", data: bytes.toString("base64") } }]);
  const esquema = { type: "array", items: { type: "object", properties: { recorte: { type: "integer" }, globos: { type: "integer" }, mayor: { type: "integer" } }, required: ["recorte", "globos", "mayor"] } };
  const pedir = () => cliente.models.generateContent({
    model: MODELO_CHAT,
    contents: [{ role: "user", parts: [...partes, { text: pedido }] }],
    config: { responseMimeType: "application/json", responseJsonSchema: esquema, thinkingConfig: { thinkingLevel: ThinkingLevel.LOW }, maxOutputTokens: TOKENS_SALIDA_RACIMOS, temperature: TEMPERATURA_FONDOS, abortSignal: opciones.signal },
  });
  const inicio = Date.now();
  let r: Awaited<ReturnType<typeof pedir>>;
  try {
    // Llega justo después de los nueve trozos y los fondos: un fallo pasajero (cuota, red) se reintenta una vez, tras una pausa.
    r = await pedir().catch(async (error: unknown) => {
      if (opciones.signal?.aborted) throw error;
      await new Promise((listo) => setTimeout(listo, ESPERA_REINTENTO_MS));
      return pedir();
    });
  } catch (error) {
    registrarGemini({ flujo: "analisis_referencia", capacidad: "analisis_referencia_inventario", modelo: MODELO_CHAT, inicio, resultado: resultadoTelemetria(error), contexto: { superficie: `${opciones.superficie}:racimos` }, thinkingLevel: "low" });
    // Lo que canceló el usuario se cancela, no se mide a medias.
    if (opciones.signal?.aborted) throw error;
    return sinRevisar(mensaje(error));
  }
  registrarGemini({ flujo: "analisis_referencia", capacidad: "analisis_referencia_inventario", modelo: MODELO_CHAT, inicio, resultado: "ok", contexto: { superficie: `${opciones.superficie}:racimos` }, usage: r.usageMetadata, bytesImagenEntrada: recortes.reduce((s, b) => s + b.byteLength, 0), thinkingLevel: "low", finishReason: r.candidates?.[0]?.finishReason });
  let crudo: unknown;
  try { crudo = jsonDe(r.candidates?.[0]?.content?.parts); } catch { crudo = null; }
  if (!Array.isArray(crudo)) return sinRevisar(`la respuesta no trae la lista de recortes (${r.candidates?.[0]?.finishReason ?? "sin motivo"})`, usoDe(r.usageMetadata));
  const racimos = new Set(crudo.flatMap((v: unknown) => {
    const k = (v as { recorte?: unknown }).recorte, n = (v as { globos?: unknown }).globos, mayor = (v as { mayor?: unknown }).mayor;
    // Un racimo: varios globos y ninguno que llene la caja (un gigante con globos chicos pegados delante sigue siendo un globo).
    const esRacimo = typeof n === "number" && n >= GLOBOS_DE_UN_RACIMO && typeof mayor === "number" && mayor < PARTE_DEL_MAYOR_EN_UN_GLOBO;
    return typeof k === "number" && esRacimo && sospechosas[k - 1] !== undefined ? [sospechosas[k - 1]!] : [];
  }));
  decidir("modelo:deteccion_globos", "cajas grandes revisadas: los racimos tomados por un globo no se miden", { revisadas: sospechosas.length, racimos: racimos.size, cajas: [...racimos].map((i) => globos[i]!.box_2d) });
  return { globos: globos.filter((_, i) => !racimos.has(i)), uso: usoDe(r.usageMetadata), revision: { revisadas: sospechosas.length, quitadas: racimos.size } };
}

// ----------------------------------------------------------------------------------------------------------
// Fondos y muebles
// ----------------------------------------------------------------------------------------------------------

/**
 * Detecta los fondos y muebles del catálogo (pared de lentejuelas, panel redondo, mesa, pedestales…) con su caja, en la
 * foto entera: el lector los mide a ojo (una pared de 0,42 del ancho la leyó de 0,55) y con la caja quedan donde van.
 */
export async function detectarFondos(foto: FotoLectura, catalogo: ReadonlyArray<{ id: string; descripcion: string }>, opciones: { signal?: AbortSignal; superficie?: string } = {}): Promise<{ fondos: FondoDetectado[]; uso: UsoModelo; costeEstimadoUsd: number }> {
  const cliente = getGeminiClient(PROPOSITO_DETECCION_GLOBOS);
  if (!cliente) throw new Error("La IA no está configurada en este servidor.");
  const inicio = Date.now();
  const superficie = opciones.superficie ?? "deteccion_fondos";
  const ids = [...catalogo.map((c) => c.id), "otro"];
  const pedido = `Detecta los fondos de escenografía y muebles de la foto (NO los globos) y devuelve cada uno con su box_2d [ymin, xmin, ymax, xmax] normalizado 0-1000 y su id del catálogo. La caja abarca el objeto entero aunque haya globos delante (estima el borde tapado por la forma del objeto). Catálogo: ${catalogo.map((c) => `${c.id}: ${c.descripcion}`).join(" · ")}. Lo que no esté en el catálogo, id "otro".`;
  const esquema = { type: "array", items: { type: "object", properties: { box_2d: { type: "array", items: { type: "integer" }, minItems: 4, maxItems: 4 }, id: { type: "string", enum: ids } }, required: ["box_2d", "id"] } };
  try {
    const r = await cliente.models.generateContent({
      model: MODELO_CHAT,
      contents: [{ role: "user", parts: [{ inlineData: { mimeType: foto.mime, data: Buffer.from(foto.bytes).toString("base64") } }, { text: pedido }] }],
      config: { responseMimeType: "application/json", responseJsonSchema: esquema, thinkingConfig: { thinkingLevel: ThinkingLevel.LOW }, maxOutputTokens: TOKENS_SALIDA_FONDOS, temperature: TEMPERATURA_FONDOS, abortSignal: opciones.signal },
    });
    const crudo = jsonDe(r.candidates?.[0]?.content?.parts);
    const uso = usoDe(r.usageMetadata);
    registrarGemini({ flujo: "analisis_referencia", capacidad: "analisis_referencia_inventario", modelo: MODELO_CHAT, inicio, resultado: "ok", contexto: { superficie }, usage: r.usageMetadata, bytesImagenEntrada: foto.bytes.byteLength, thinkingLevel: "low", finishReason: r.candidates?.[0]?.finishReason });
    const fondos = (Array.isArray(crudo) ? crudo : []).flatMap((f: unknown): FondoDetectado[] => {
      const caja = (f as { box_2d?: unknown }).box_2d, id = (f as { id?: unknown }).id;
      return esCaja(caja) && typeof id === "string" && id !== "otro" ? [{ box_2d: caja, id }] : [];
    });
    return { fondos, uso, costeEstimadoUsd: costeFlashUsd(uso) };
  } catch (error) {
    registrarGemini({ flujo: "analisis_referencia", capacidad: "analisis_referencia_inventario", modelo: MODELO_CHAT, inicio, resultado: resultadoTelemetria(error), contexto: { superficie }, thinkingLevel: "low" });
    throw error;
  }
}
