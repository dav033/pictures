import "server-only";

import fs from "node:fs";
import path from "node:path";

/**
 * Estado real del LoRA en producción y de qué está hecho su entrenamiento.
 *
 * Se lee de `data/processed/lora-v004-composicion.json`, que genera
 * `scripts/analizar-composicion-lora.ts` contando sobre los 154 captions
 * del dataset. Es contable porque el recaptionado usó vocabulario controlado;
 * si el dataset cambia, hay que volver a correr ese script.
 */

export type Elemento = { nombre: string; captions: number; pct: number; imagenes?: string[] };
export type ElementoShopify = { producto: string; variante: string | null; sku: string | null; fotos: number; pct: number };
export type Composicion = {
  generado: string;
  fuente: string;
  lora: { etiqueta: string; trigger: string; url: string | null; steps: number; learning_rate: number; epocas: number; costo_usd: number; rank: number };
  dataset: { imagenes: number; palabras_mediana: number; palabras_min: number; palabras_max: number };
  composicion: Array<{ grupo: string; elementos: Elemento[] }>;
  shopify: { fotos_analizadas: number; elementos_representados: number; elementos: ElementoShopify[] };
  encuadre: Elemento[];
};

const RUTA = path.join(process.cwd(), "data/processed/lora-v004-composicion.json");

export function leerComposicionLocal(): Composicion | null {
  try {
    return JSON.parse(fs.readFileSync(RUTA, "utf8")) as Composicion;
  } catch {
    return null;
  }
}
