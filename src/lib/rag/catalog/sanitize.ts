import { createHash } from "node:crypto";
import { nombreCategoria, nombreOcasion } from "@/lib/shopify/derivar";

const PATRON_NULL_BYTE = new RegExp(String.fromCharCode(0), "g");

/** Trim, normalización Unicode, sin null bytes, sin whitespace repetido (plan §2.4). */
export function sanitizeTexto(texto: string): string {
  return texto
    .normalize("NFC")
    .replace(PATRON_NULL_BYTE, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function sanitizeTextoNullable(texto: string | null | undefined): string | null {
  if (texto == null) return null;
  const limpio = sanitizeTexto(texto);
  return limpio.length > 0 ? limpio : null;
}

type InsumosSearchText = {
  titulo: string;
  categoria: string | null;
  descripcion: string | null;
  tags: string[];
  colores: string[];
  acabados: string[];
  ocasiones: string[];
  skus: string[];
};

/**
 * Texto determinístico para full-text/embeddings (plan §2.9). Nunca incluye
 * precio ni stock — son volátiles y no deben afectar el embedding. El SKU
 * SÍ se incluye a propósito (no es volátil, es un identificador estable de
 * catálogo) porque el plan exige "producto por SKU recuperable" como
 * criterio de aceptación de Fase 3 y eso solo funciona si full-text lo indexa
 * (plan §3.7: "esto cubre mejor búsquedas como SKU-PX392").
 */
export function construirSearchText(insumos: InsumosSearchText): string {
  const partes = [
    `title: ${insumos.titulo}`,
    insumos.categoria ? `category: ${nombreCategoria(insumos.categoria)}` : null,
    insumos.descripcion ? `description: ${insumos.descripcion}` : null,
    insumos.tags.length ? `tags: ${insumos.tags.join(", ")}` : null,
    insumos.colores.length ? `colors: ${insumos.colores.join(", ")}` : null,
    insumos.acabados.length ? `finishes: ${insumos.acabados.join(", ")}` : null,
    insumos.ocasiones.length ? `events: ${insumos.ocasiones.map(nombreOcasion).join(", ")}` : null,
    insumos.skus.length ? `sku: ${insumos.skus.join(", ")}` : null,
  ].filter((p): p is string => p !== null);

  return partes.join(" | ");
}

/** Fingerprint semántico (plan §2.10): mientras no cambie, no hay que regenerar el embedding. */
export function hashSearchText(searchText: string): string {
  return createHash("sha256").update(searchText, "utf-8").digest("hex");
}
