import { z } from "zod";
import type { Part } from "@google/genai";
import { TOPE_BYTES_FOTO } from "@/lib/taller/buscar-foto";
import { motivoFotoInvalida } from "@/lib/taller/escena-desde-foto";
import { paraGoogleSchema } from "@/lib/ia/nucleo/esquema-google";
import type { Escena } from "./escena";
import { FotoCuerpoSchema } from "./escena-ia-foto";
import { resumenEscena, type DeclaracionHerramienta, type ResultadoHerramienta } from "./herramientas-escena";
import { LecturaFotoSchema, type LecturaFoto } from "./lectura-foto";
import { lineaDePiezaLeida } from "./modelar-desde-foto";
import { MAX_RONDAS_REFINAR, ReporteSchema, reporteDe, type ReporteComparacion } from "./refinado-ronda";

/**
 * **Refinado contra la foto** (REQ-001 paso 9). Después de que la IA arma la escena desde una foto, el navegador captura la
 * escena 3D con la cámara de la foto y manda las dos imágenes de vuelta a `/api/escena-ia` con `refinar`: el modelo ve
 * la foto y la captura juntas, con la lectura y `ver_escena`, enumera las diferencias concretas (tamaños, silueta, grosor,
 * colores, piezas que faltan o sobran, escala) con la herramienta `reportar_comparacion` y las corrige con las herramientas
 * de siempre. Son a lo más `MAX_RONDAS_REFINAR` rondas, automáticas y cada una con su deshacer; se paran cuando el modelo
 * no ve diferencias significativas, cuando no cambió nada o cuando el usuario las detiene. Aquí: el cuerpo, el mensaje al
 * modelo, la herramienta de reporte y la decisión de seguir o parar. Todo puro y sin red (las pruebas no tocan Gemini).
 */

/** Vueltas del modelo con herramientas en una ronda (menos que en un pedido normal: la ronda corrige, no arma de cero). */
export const MAX_PASOS_REFINAR = 5;
/** Lado mayor (px) al que se llevan la foto y la captura antes de dárselas al modelo. */
export const LADO_COMPARACION = 1024;
export const REPORTAR_COMPARACION = "reportar_comparacion";

/**
 * Las herramientas que se le ofrecen al modelo en una ronda: las de corregir (tamaños, colores, medidas, posición, quitar o
 * agregar piezas), no las de armar de cero (biblioteca, presets, grupos, disposición). Las declaraciones pesan ~80 000
 * caracteres y se reenvían en cada vuelta: con estas son la mitad, y una ronda cuesta casi la mitad.
 */
export const HERRAMIENTAS_REFINAR: readonly string[] = ["ver_escena", "ver_pieza", "contar_globos", "ajustar_tamanos", "cambiar_pieza", "editar_globos", "recolorear_escena", "poner_remate", "mover_pieza", "girar_pieza", "agregar_pieza", "agregar_mobiliario", "quitar_pieza"];

/** Las declaraciones de una ronda: las de corregir más la de reportar. */
export const declaracionesDeRefinado = (todas: readonly DeclaracionHerramienta[]): DeclaracionHerramienta[] => [...todas.filter((d) => HERRAMIENTAS_REFINAR.includes(d.name)), DECLARACION_REPORTAR];

/** La captura de la escena: JPEG de a lo más ~1024 px (el navegador la reduce); el servidor le pone tope al tamaño. */
const TOPE_BYTES_CAPTURA = 1.5 * 1024 * 1024;
export const CapturaCuerpoSchema = z.object({
  mime: z.literal("image/jpeg"),
  base64: z.string().min(100).max(Math.ceil((TOPE_BYTES_CAPTURA * 4) / 3) + 8).regex(/^[A-Za-z0-9+/]+={0,2}$/),
});

export const RefinarCuerpoSchema = z.object({
  ronda: z.number().int().min(1).max(MAX_RONDAS_REFINAR),
  /** La foto original (la misma que se adjuntó). */
  foto: FotoCuerpoSchema,
  captura: CapturaCuerpoSchema,
  /** La lectura que devolvió el servidor al armar la escena (se valida de nuevo: no se confía en el navegador). */
  lectura: LecturaFotoSchema,
});
export type RefinarCuerpo = z.infer<typeof RefinarCuerpoSchema>;

// ----------------------------------------------------------------------------------------------------------
// La herramienta de reporte
// ----------------------------------------------------------------------------------------------------------

export const DECLARACION_REPORTAR: DeclaracionHerramienta = {
  name: REPORTAR_COMPARACION,
  description: "Registra la lista de diferencias concretas entre la FOTO y la CAPTURA de la escena. Llámala UNA vez, ANTES de corregir nada. Lista vacía (o ninguna significativa) = la escena ya se ve como la foto: termina sin cambiar nada.",
  parametersJsonSchema: paraGoogleSchema(z.toJSONSchema(ReporteSchema, { target: "draft-7" })) as Record<string, unknown>,
};

/** Atiende `reportar_comparacion` (no cambia la escena; guarda el reporte en `reportes`). */
export function aplicarReporte(escena: Escena, argumentos: unknown, reportes: ReporteComparacion[]): ResultadoHerramienta {
  const reporte = reporteDe(argumentos);
  if (!reporte) return { ok: false, escena, error: "Reporte no válido: diferencias = lista de { aspecto, descripcion, significativa }." };
  reportes.push(reporte);
  const significativas = reporte.diferencias.filter((d) => d.significativa).length;
  return {
    ok: true, escena, consulta: true,
    resumen: significativas
      ? `Comparación registrada: ${reporte.diferencias.length} diferencias, ${significativas} significativas. Corrígelas ahora con las herramientas, las más notorias primero.`
      : `Comparación registrada: ${reporte.diferencias.length ? "diferencias menores, ninguna significativa" : "sin diferencias"}. No cambies nada y termina.`,
  };
}

// ----------------------------------------------------------------------------------------------------------
// La decisión de la ronda
// ----------------------------------------------------------------------------------------------------------

// ----------------------------------------------------------------------------------------------------------
// Lo que ve el modelo
// ----------------------------------------------------------------------------------------------------------

/** Las reglas de la ronda `ronda` para el sistema del modelo. */
export const reglasDeRonda = (ronda: number) => `COMPARACIÓN CON LA FOTO (la escena ya está armada desde la foto: tu trabajo es dejarla lo más parecida posible):
- Recibes DOS imágenes: la FOTO de referencia y la CAPTURA de la escena 3D actual, tomada de frente con la cámara de la foto (mismo encuadre y escala). Compáralas lado a lado, con la lectura y ver_escena del mensaje.
- PRIMERO llama reportar_comparacion UNA vez con las diferencias concretas, con números cuando se pueda, en estos aspectos: mezcla_tamanos (cuántos globos grandes, medianos y chicos hay en la foto y en la captura), silueta (el recorrido del arco o guirnalda: dónde nace, hasta dónde llega, qué tan abierto o arqueado), grosor (cuerpo más delgado o grueso que el de la foto), colores (qué color domina y cuál sobra o falta), piezas_faltantes, piezas_sobrantes, escala (todo más chico o grande) y posicion. Marca significativa solo lo que un decorador notaría a primera vista.
- Si ninguna es significativa: no cambies nada, di en una frase que ya se ve como la foto y termina.
- Si hay significativas, corrígelas de la más notoria a la menos con las herramientas normales: ajustar_tamanos (más o menos R-24/R-18/R-5…, con donde para un lado), cambiar_pieza sobre la guirnalda o columna orgánica (ancho_cm, alto_cm, grosor_cm, silueta o puntos del trazo para el recorrido y el cuerpo; colores y pesos), editar_globos, recolorear_escena, poner_remate, mover_pieza, girar_pieza, quitar_pieza o agregar_pieza. Una corrección por diferencia; no rehagas lo que ya está bien ni uses usar_preset.
- NUNCA agregues piezas que no se ven en la foto. Lo que figura en «No se arman» no se hace.
- Alturas: lo que en la foto cuelga de la pared (guirnaldas, letreros, metalizados, flores) se queda a su altura de la foto; NUNCA lo bajes al piso (altura 0) salvo que en la foto esté apoyado en el piso. Si algo queda tapado, muévelo de lado o hacia delante, no hacia abajo.
- No quites ni reduzcas los globos grandes de la guirnalda para «destapar» otra pieza (letras, figuras): si la foto tiene lo grande, se queda; lo que va por delante se mueve, no se tapa a base de quitar globos. Si una diferencia no se puede corregir con estas herramientas, dilo y déjala.
- Al terminar responde en 1 a 3 frases: qué diferencias había y qué corregiste (con los números de la verificación). Es la ronda ${ronda} de ${MAX_RONDAS_REFINAR}.`;

/** El mensaje de texto de la ronda: la lectura resumida, la escala y `ver_escena`. */
export function textoDeRefinado(ronda: number, lectura: LecturaFoto, escena: Escena): string {
  const H = lectura.escala.altoImagenCm;
  return [
    `[Ronda ${ronda} de ${MAX_RONDAS_REFINAR} de comparación con la foto. Imagen 1 = FOTO de referencia; imagen 2 = CAPTURA de la escena 3D actual, de frente, mismo encuadre.]`,
    `Lectura de la foto: ${lectura.resumen} Escala: la foto mide ${Math.round(H)} cm de alto (${lectura.escala.referencia}).`,
    `Piezas leídas (${lectura.piezas.length}):`,
    ...lectura.piezas.map((p, i) => lineaDePiezaLeida(p, i, H)),
    "",
    "ver_escena (lo que hay ahora en la escena):",
    resumenEscena(escena),
    "",
    "Compara las dos imágenes: llama reportar_comparacion y corrige las diferencias significativas.",
  ].join("\n");
}

export type PreparadoRefinar = { ok: true; partes: Part[]; lectura: LecturaFoto } | { ok: false; status: number; error: string };

/** Valida las dos imágenes, las lleva a ≤ 1024 px y arma el mensaje del modelo (texto, foto y captura). */
export async function prepararRefinado(
  refinar: RefinarCuerpo, escena: Escena, normalizar: (bytes: Uint8Array, lado: number) => Promise<Uint8Array>,
): Promise<PreparadoRefinar> {
  const bytesFoto = new Uint8Array(Buffer.from(refinar.foto.base64, "base64"));
  const bytesCaptura = new Uint8Array(Buffer.from(refinar.captura.base64, "base64"));
  const invalida = motivoFotoInvalida(bytesFoto.byteLength, refinar.foto.mime);
  if (invalida) return { ok: false, ...invalida };
  if (bytesCaptura.byteLength === 0 || bytesCaptura.byteLength > Math.min(TOPE_BYTES_CAPTURA, TOPE_BYTES_FOTO)) return { ok: false, status: 413, error: "La captura de la escena no es válida (vacía o demasiado grande)." };
  let foto: Uint8Array, captura: Uint8Array;
  try {
    [foto, captura] = await Promise.all([normalizar(bytesFoto, LADO_COMPARACION), normalizar(bytesCaptura, LADO_COMPARACION)]);
  } catch {
    return { ok: false, status: 400, error: "No se pudo leer la foto o la captura: no son imágenes válidas." };
  }
  const imagen = (bytes: Uint8Array): Part => ({ inlineData: { mimeType: "image/jpeg", data: Buffer.from(bytes).toString("base64") } });
  return { ok: true, lectura: refinar.lectura, partes: [{ text: textoDeRefinado(refinar.ronda, refinar.lectura, escena) }, { text: "FOTO de referencia:" }, imagen(foto), { text: "CAPTURA de la escena 3D actual (misma vista):" }, imagen(captura)] };
}
