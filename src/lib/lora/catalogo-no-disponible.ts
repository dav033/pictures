/**
 * A restricted LoRA mode (training_1/2) can only offer products from its
 * dataset. When that pool cannot be resolved (mode not configured, dataset
 * variants missing from the published catalog...) the conversation itself is
 * still valid: only catalog access must fail closed. This module is the single
 * owner of that rule for the chat.
 */

import { MENSAJE_CLIENTE_CATALOGO_NO_DISPONIBLE } from "@/lib/ia/herramientas/mensajes-cliente";

export const STATUS_CATALOGO_LORA_NO_DISPONIBLE = "CATALOGO_LORA_NO_DISPONIBLE" as const;

/** Stable `LORA_*` code of a mode-resolver failure, or `null` for any other error. */
export function causaCatalogoLora(error: unknown): string | null {
  if (!(error instanceof Error)) return null;
  return /^(LORA_[A-Z_]+)\b/.exec(error.message)?.[1] ?? null;
}

/** Tool result returned instead of touching the catalog while the LoRA pool is unavailable. */
export function respuestaCatalogoLoraNoDisponible(causa: string): {
  ok: false;
  status: typeof STATUS_CATALOGO_LORA_NO_DISPONIBLE;
  causa: string;
  accion_requerida: string;
  mensaje_cliente: string;
} {
  return {
    ok: false,
    status: STATUS_CATALOGO_LORA_NO_DISPONIBLE,
    causa,
    mensaje_cliente: MENSAJE_CLIENTE_CATALOGO_NO_DISPONIBLE,
    accion_requerida:
      "El catálogo del modo de visualización activo no está disponible por un problema técnico de configuración. No busques, no propongas productos, no inventes precios y no confirmes selecciones ni planes. NO digas que no hay inventario, productos o stock: eso es falso. Dile al cliente que hay un problema técnico temporal para mostrar el catálogo en este modo y que puede seguir contándote los detalles del evento.",
  };
}
