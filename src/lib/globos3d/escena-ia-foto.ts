import { z } from "zod";
import type { Part } from "@google/genai";
import { MIMES_FOTO, TOPE_BYTES_FOTO } from "@/lib/taller/buscar-foto";
import { LADO_MAXIMO_LECTURA, motivoFotoInvalida, respuestaDeErrorLectura } from "@/lib/taller/escena-desde-foto";
import type { Escena } from "./escena";
import type { ResultadoHerramienta } from "./herramientas-escena";
import { ModelarDesdeFotoSchema } from "./herramientas-escena-foto";
import type { FotoLectura } from "./leer-foto-ia";
import { combinarEscenaDeFoto, resumenParaAgente, type Modelado } from "./modelar-desde-foto";

/**
 * La foto adjunta a un pedido de `/api/escena-ia` (REQ-001 paso 8): el navegador la manda ya reducida en el cuerpo
 * JSON (`foto: { mime, base64 }`); aquí se valida, se normaliza, se lee con la IA de visión y se compila a escena
 * (`modelar-desde-foto.ts`). Con la sala vacía se arma sola; con piezas puestas, el modelo decide con la herramienta
 * `modelar_desde_foto` si reemplaza o suma. El modelo también VE la foto, y el resumen de la lectura con las plantillas
 * más parecidas de la biblioteca entra en su primer mensaje. Todo con dependencias inyectadas (sin red en las pruebas).
 */

/** Largo máximo del base64 de una foto de `TOPE_BYTES_FOTO` bytes. */
const MAX_BASE64 = Math.ceil((TOPE_BYTES_FOTO * 4) / 3) + 8;

export const FotoCuerpoSchema = z.object({
  mime: z.enum(MIMES_FOTO as [string, ...string[]]),
  base64: z.string().min(100).max(MAX_BASE64).regex(/^[A-Za-z0-9+/]+={0,2}$/),
});
export type FotoCuerpo = z.infer<typeof FotoCuerpoSchema>;

export type DependenciasFotoIA = {
  normalizar: (bytes: Uint8Array, lado: number) => Promise<Uint8Array>;
  modelar: (foto: FotoLectura, signal?: AbortSignal) => Promise<Modelado>;
};

export type FotoPreparada = {
  modelado: Modelado;
  /** La foto normalizada, como parte del mensaje al modelo. */
  imagen: Part;
  /** La escena con la foto ya armada (si la sala estaba vacía) o la misma que llegó. */
  escena: Escena;
  aplicada: boolean;
  /** El resumen de la lectura para el primer mensaje del modelo. */
  texto: string;
  /** Qué hizo la ruta antes de que hablara el modelo (para las acciones del cliente y el registro). */
  resumenAccion: string | null;
};

export type ResultadoPrepararFoto = ({ ok: true } & FotoPreparada) | { ok: false; status: number; error: string; sinIA: boolean };

const piezasEnTexto = (n: number) => `${n} pieza${n === 1 ? "" : "s"}`;

/** Valida, lee y (con la sala vacía) arma la foto adjunta. Nunca lanza: los errores vuelven como `ok: false` con su estado HTTP. */
export async function prepararFotoAdjunta(foto: FotoCuerpo, escena: Escena, deps: DependenciasFotoIA, maxNodos: number, signal?: AbortSignal): Promise<ResultadoPrepararFoto> {
  const bytes = new Uint8Array(Buffer.from(foto.base64, "base64"));
  const invalida = motivoFotoInvalida(bytes.byteLength, foto.mime);
  if (invalida) return { ok: false, ...invalida, sinIA: false };
  let normalizada: Uint8Array;
  try {
    normalizada = await deps.normalizar(bytes, LADO_MAXIMO_LECTURA);
  } catch {
    return { ok: false, status: 400, error: "No se pudo leer la foto: el archivo no es una imagen válida.", sinIA: false };
  }
  let modelado: Modelado;
  try {
    modelado = await deps.modelar({ bytes: normalizada, mime: "image/jpeg" }, signal);
  } catch (error) {
    return { ok: false, ...respuestaDeErrorLectura(error) };
  }
  const vacia = escena.nodos.length === 0;
  const armada = vacia ? combinarEscenaDeFoto(escena, modelado.escena, "reemplazar", maxNodos) : null;
  const aplicada = armada !== null;
  const resumenAccion = aplicada ? `Armé en la escena lo que leí de la foto: ${piezasEnTexto(armada.nodos.length)}${modelado.omitidas.length ? `; ${modelado.omitidas.length} cosas de la foto no son del taller y no se armaron` : ""}.` : null;
  const estado = aplicada
    ? `YA SE ARMÓ en la escena (${armada.nodos.map((n) => n.id).join(", ")}). Compárala con la foto y corrige solo diferencias claras.`
    : "NO se aplicó todavía (la sala ya tiene piezas): llama modelar_desde_foto con el modo que pida el usuario.";
  return {
    ok: true, modelado, imagen: { inlineData: { mimeType: "image/jpeg", data: Buffer.from(normalizada).toString("base64") } },
    escena: armada ?? escena, aplicada, texto: resumenParaAgente(modelado, estado), resumenAccion,
  };
}

/** `modelar_desde_foto` llamada por el modelo: aplica la foto ya leída a la escena de ahora. */
export function aplicarModeladoDeFoto(escena: Escena, foto: FotoPreparada | null, argumentos: unknown, maxNodos: number): ResultadoHerramienta {
  if (!foto) return { ok: false, escena, error: "No hay foto adjunta en este mensaje: no hay nada que modelar." };
  const a = ModelarDesdeFotoSchema.safeParse(argumentos ?? {});
  if (!a.success) return { ok: false, escena, error: "Parámetros no válidos: modo debe ser «reemplazar» o «sumar»." };
  const nueva = combinarEscenaDeFoto(escena, foto.modelado.escena, a.data.modo, maxNodos);
  if (!nueva) return { ok: false, escena, error: `La escena pasaría de ${maxNodos} piezas: usa el modo «reemplazar» o quita piezas antes.` };
  return { ok: true, escena: nueva, consulta: false, resumen: `Armé lo leído de la foto (${a.data.modo}): ${piezasEnTexto(foto.modelado.escena.nodos.length)}; la escena tiene ahora ${piezasEnTexto(nueva.nodos.length)}.` };
}

export const REGLAS_FOTO = `FOTO ADJUNTA: el mensaje trae una foto de una decoración y su lectura (piezas, colores, medidas, posiciones) ya calculada por un lector de visión; tú también ves la foto.
- Si el Estado dice «YA SE ARMÓ», la escena ya tiene lo leído. Después de tu respuesta el taller captura la escena 3D con la cámara de la foto y te la devuelve junto a la foto para comparar y corregir en hasta 2 rondas automáticas (tamaños, silueta, grosor, colores): aquí NO afines de memoria. Míralo con ver_escena y corrige solo lo que la lectura dice claramente distinto de la foto (un color o una pieza que no coincide); si se ve bien, no cambies nada. Responde corto.
- Si dice «NO se aplicó», llama modelar_desde_foto una vez: modo «reemplazar» si piden hacerla o rehacerla como la foto, «sumar» si piden agregarla a lo que hay; si dudas, «sumar».
- NUNCA agregues piezas que no se ven en la foto. Lo que figura en «No se arman» (torta, letreros de luz, muebles…) no se hace: dilo en la respuesta.
- Si una plantilla de la biblioteca tiene parecido alto (0,9 o más), menciónala por su nombre y ofrécela; no la insertes sin que la pidan.`;
