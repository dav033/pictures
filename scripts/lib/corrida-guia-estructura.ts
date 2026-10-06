/**
 * La corrida comparativa con y sin guía de estructura (ADR-0033), para
 * `scripts/ops/generar-guia-estructura.ts`. Aquí vive la lógica, importable y
 * sin efectos al cargar, para que la vista previa se pueda probar sin red.
 *
 * UNA SOLA VARIABLE: la bandera `GUIA_ESTRUCTURA_V1`. Cada caso
 * (`escenas-guia-estructura.ts`) y cada semilla dan dos celdas:
 * - `sin`: lo que manda hoy `/api/generate` sin foto del espacio: el caption
 *   canónico completo a `fal-ai/flux-2/lora`;
 * - `con`: lo que mandaría con la bandera encendida: `/edit` con la guía como
 *   primera imagen (y la carta si cabe), sus notas delante y el caption
 *   compactado para que el prompt entero siga dentro de
 *   `LORA_PROMPT_MAX_LENGTH`. La compactación es parte de la bandera, no una
 *   segunda variable: sin ella las notas no caben.
 * El LoRA, la escala, el guidance, el tamaño y las semillas son los mismos.
 *
 * El cierre (solo tras gastar) mide cada imagen contra su guía
 * (`medir-guia.ts`: IoU de silueta y presencia de cada color) y arma una hoja
 * comparativa guía | sin | con.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp, { type OverlayOptions } from "sharp";
import { decodificarPixeles } from "@/lib/ia/amaterasu/decodificar-pixeles";
import { LORA_PROMPT_MAX_LENGTH } from "@/lib/ia/kagutsuchi/lora-caption-compiler";
import { preflightLoraPrompt } from "@/lib/ia/kagutsuchi/lora-prompt-preflight";
import { elegirCaptionConGuia } from "@/lib/ia/kagutsuchi/guia-estructura";
import { prepararGuiaEstructura, type GuiaPreparada } from "@/lib/ia/kagutsuchi/rasterizar-guia";
import { buildLoraEditPrompt, reservaNotasGuia, type ImagenGuiaLora } from "@/lib/ia/kagutsuchi/sempertex-lora";
import type { Celda, Manifiesto } from "./fal-evaluacion";
import { captionDeCaso, casosGuia, type CasoGuia } from "./escenas-guia-estructura";
import { medirContraGuia, type MedidaGuia } from "./medir-guia";

export type GuiaDeCaso = { caso: CasoGuia["nombre"]; guia: GuiaPreparada; promptSin: string; promptCon: string; conCarta: boolean };

function captionBase(prompt: string): string {
  return prompt;
}

function exigirPreflight(caso: CasoGuia, clauses: Parameters<typeof preflightLoraPrompt>[0]["clauses"], prompt: string, etiqueta: string): void {
  const reporte = preflightLoraPrompt({ sceneSpec: caso.escena, clauses, prompt });
  if (!reporte.ok) throw new Error(`${caso.nombre} (${etiqueta}): el preflight rechaza el prompt (${reporte.errors.join("; ")})`);
}

/** Las celdas de la corrida y la guía de cada caso. Sin red: solo compila, rasteriza y pasa el preflight. */
export async function prepararCorridaGuia(opciones: { escala: number; semillas: readonly number[] }): Promise<{ celdas: Celda[]; guias: GuiaDeCaso[] }> {
  const guias: GuiaDeCaso[] = [];
  const celdas: Celda[] = [];
  for (const caso of casosGuia()) {
    const guia = await prepararGuiaEstructura(caso.plan, "3:2");
    if (!guia) throw new Error(`${caso.nombre}: el plan ya no admite guía`);
    const completo = captionDeCaso(caso);
    const promptSin = completo.prompt;
    exigirPreflight(caso, completo.clauses, promptSin, "sin guía");
    const elegido = elegirCaptionConGuia<ReturnType<typeof captionDeCaso>, ImagenGuiaLora>({
      imagenes: guia.imagenes,
      maximo: LORA_PROMPT_MAX_LENGTH,
      reserva: reservaNotasGuia,
      compilar: (maxLength) => captionDeCaso(caso, maxLength),
      cabe: (compilacion, imagenes) => preflightLoraPrompt({ sceneSpec: caso.escena, clauses: compilacion.clauses, prompt: buildLoraEditPrompt(compilacion.prompt, imagenes) }).ok,
    });
    if (!elegido) throw new Error(`${caso.nombre}: las notas de la guía no caben ni sin la carta`);
    const promptCon = buildLoraEditPrompt(elegido.compilacion.prompt, elegido.imagenes);
    exigirPreflight(caso, elegido.compilacion.clauses, promptCon, "con guía");
    guias.push({ caso: caso.nombre, guia, promptSin, promptCon, conCarta: elegido.imagenes.length > 1 });
    for (const seed of opciones.semillas) {
      celdas.push({ id: `${caso.nombre}-sin-seed${seed}`, prompt: captionBase(promptSin), lora: opciones.escala, seed, nota: `${caso.nombre}, sin guía: fal-ai/flux-2/lora, caption completo` });
      celdas.push({
        id: `${caso.nombre}-con-seed${seed}`,
        prompt: captionBase(promptCon),
        lora: opciones.escala,
        seed,
        imagenes: elegido.imagenes.map((imagen) => `data:${imagen.mime};base64,${imagen.base64}`),
        nota: `${caso.nombre}, con guía${elegido.imagenes.length > 1 ? " y carta" : " (sin carta: no cabía)"}: /edit, caption compactado`,
      });
    }
  }
  return { celdas, guias };
}

/**
 * Dónde van las imágenes: fuera del repositorio (AGENTS.md: ni imágenes ni
 * salidas de evaluación en el repo). `--out` elige otra carpeta, también fuera.
 */
export function directorioSalida(pedido: string | undefined, artifactId: string, raizRepo = process.cwd()): string {
  const destino = path.resolve(pedido || path.join(os.tmpdir(), "demo-decoracion-eval", `guia-estructura-${artifactId}`));
  const relativo = path.relative(path.resolve(raizRepo), destino);
  if (!relativo.startsWith("..") && !path.isAbsolute(relativo)) {
    throw new Error(`SALIDA_EN_EL_REPO: ${destino} está dentro del repositorio; usa --out con una carpeta de fuera.`);
  }
  return destino;
}

export type FilaMedida = { celda: string; caso: string; brazo: "sin" | "con"; seed: number; medida: MedidaGuia };

async function pixelesDe(archivo: Buffer) {
  const muestra = await decodificarPixeles(archivo);
  return { ancho: muestra.ancho, alto: muestra.alto, rgb: muestra.rgb };
}

/** Mide cada imagen generada contra la guía de su caso y arma la hoja guía | sin | con. */
export async function cerrarCorridaGuia(manifiesto: Manifiesto, outDir: string, guias: readonly GuiaDeCaso[]): Promise<{ medidas: FilaMedida[]; hoja: string | null }> {
  const medidas: FilaMedida[] = [];
  const miniatura = 384;
  const filas: Array<{ guia: Buffer; sin?: Buffer; con?: Buffer }> = [];
  for (const { caso, guia } of guias) {
    const guiaPng = Buffer.from(guia.imagenes[0].base64, "base64");
    fs.writeFileSync(path.join(outDir, `${caso}-guia.png`), guiaPng);
    const pixelesGuia = await pixelesDe(guiaPng);
    const objetivos = guia.colores.map((hex) => ({ hex, nombre: hex }));
    const porSemilla = new Map<number, { sin?: Buffer; con?: Buffer }>();
    for (const resultado of manifiesto.resultados) {
      const id = String(resultado.celda);
      const coincide = new RegExp(`^${caso}-(sin|con)-seed(\\d+)$`).exec(id);
      if (!coincide || resultado.ok !== true || typeof resultado.archivo !== "string") continue;
      const brazo = coincide[1] as "sin" | "con";
      const seed = Number(coincide[2]);
      const png = fs.readFileSync(resultado.archivo);
      medidas.push({ celda: id, caso, brazo, seed, medida: medirContraGuia(await pixelesDe(png), pixelesGuia, objetivos) });
      porSemilla.set(seed, { ...porSemilla.get(seed), [brazo]: png });
    }
    for (const par of porSemilla.values()) filas.push({ guia: guiaPng, ...par });
  }
  fs.writeFileSync(path.join(outDir, "medidas.json"), JSON.stringify(medidas, null, 2));
  for (const fila of medidas) {
    const { silueta, color } = fila.medida;
    const colores = color.colores.map((item) => `${item.objetivo.hex}:${item.neutro ? "neutro" : item.encontrado ? `${Math.round(item.presencia * 100)}% Δ${item.deltaTono?.toFixed(0)}° c${Math.round((item.razonCroma ?? 0) * 100)}%` : "ausente"}`).join(" ");
    console.log(`${fila.celda.padEnd(32)} IoU alineada ${silueta ? silueta.iouAlineada.toFixed(2) : "—"} · encuadre ${silueta ? silueta.iouEncuadre.toFixed(2) : "—"} · alto/ancho ${silueta ? `${silueta.razonGenerada.toFixed(2)} (guía ${silueta.razonGuia.toFixed(2)})` : "—"} · ${colores}`);
  }
  if (!filas.length) return { medidas, hoja: null };
  const alto = Math.round((miniatura * 2) / 3);
  const celda = async (png: Buffer | undefined) => png
    ? sharp(png).resize(miniatura, alto, { fit: "contain", background: "#ffffff" }).png().toBuffer()
    : sharp({ create: { width: miniatura, height: alto, channels: 3, background: "#dddddd" } }).png().toBuffer();
  const piezas: OverlayOptions[] = [];
  for (const [indice, fila] of filas.entries()) {
    const imagenes = await Promise.all([celda(fila.guia), celda(fila.sin), celda(fila.con)]);
    imagenes.forEach((input, columna) => piezas.push({ input, left: columna * miniatura, top: indice * alto }));
  }
  const hoja = path.join(outDir, "hoja-comparativa.png");
  await sharp({ create: { width: miniatura * 3, height: alto * filas.length, channels: 3, background: "#ffffff" } }).composite(piezas).png().toFile(hoja);
  return { medidas, hoja };
}
