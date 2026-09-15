import { createHash } from "node:crypto";
import { isAbsolute, relative, resolve } from "node:path";
import { SuiteSchema } from "./cli-reconocimiento";
import { familiaDesdeClaseOficial } from "./familia-clase";

/**
 * Builds a recognition suite from the manually collected folder
 * (`estructuras-manual/`: one subfolder per candidate class plus `_registro.csv`).
 *
 * Only rows with a verifiable permission reach the suite: cc0, cc-by,
 * dominio-publico or escrito:<id>. BY-SA, empty or unknown permissions are
 * excluded and reported (guía 04 §2). The candidate class is a curation hint,
 * never ground truth. No personal data (author, page URL, title) is copied.
 */

/** Folder classes after the user retired the dense / non-dense split (2026-09-15). */
export const CLASES_MANUALES = [
  "arco", "arco_organico", "semiarco", "semiarco_organico", "columna", "columna_organica", "guirnalda", "aro_circular",
  "pared", "centro_mesa", "bouquet", "figura", "techo_globos", "negativo", "no_se",
] as const;
export type ClaseManual = (typeof CLASES_MANUALES)[number];

const PERMISO_VALIDO = /^(cc0|cc-by|dominio-publico|escrito:[A-Za-z0-9._-]{1,80})$/;

/** Minimal RFC 4180 parser with auto-detected `,` or `;` delimiter (Excel in es-CO saves with `;`). */
export function leerCsv(texto: string): Record<string, string>[] {
  const limpio = texto.replace(/^﻿/, "");
  const primeraLinea = limpio.split(/\r?\n/, 1)[0] ?? "";
  const separador = (primeraLinea.match(/;/g)?.length ?? 0) > (primeraLinea.match(/,/g)?.length ?? 0) ? ";" : ",";
  const filas: string[][] = [];
  let fila: string[] = [];
  let campo = "";
  let comillas = false;
  for (let i = 0; i < limpio.length; i += 1) {
    const c = limpio[i]!;
    if (comillas) {
      if (c === '"' && limpio[i + 1] === '"') { campo += '"'; i += 1; }
      else if (c === '"') comillas = false;
      else campo += c;
    } else if (c === '"') comillas = true;
    else if (c === separador) { fila.push(campo); campo = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && limpio[i + 1] === "\n") i += 1;
      fila.push(campo); campo = "";
      if (fila.some((valor) => valor.trim() !== "")) filas.push(fila);
      fila = [];
    } else campo += c;
  }
  fila.push(campo);
  if (fila.some((valor) => valor.trim() !== "")) filas.push(fila);
  const [cabecera, ...resto] = filas;
  if (!cabecera) return [];
  const nombres = cabecera.map((nombre) => nombre.trim());
  return resto.map((valores) => Object.fromEntries(nombres.map((nombre, indice) => [nombre, (valores[indice] ?? "").trim()])));
}

export type MotivoExclusion = "sin_permiso" | "by_sa_revision_legal" | "permiso_no_reconocido" | "archivo_inexistente" | "fuera_de_la_carpeta" | "formato_no_admitido" | "clase_desconocida" | "duplicado_exacto" | "negativo_o_no_se";

export type ItemManual = { sha256: string; archivo: string; clase: ClaseManual; permiso: string };

export type ResultadoImportacion = {
  aceptadas: ItemManual[];
  excluidas: Array<{ archivo: string; motivo: MotivoExclusion }>;
  por_clase: Record<string, number>;
  por_familia: Record<string, number>;
};

function formatoImagen(bytes: Uint8Array): boolean {
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const png = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  const webp = String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
  return jpeg || png || webp;
}

/** Pure selection over the registry rows; file access is injected. */
export type ExcepcionPermiso = { id: string; aprobadaEn: string; registro: string };

/**
 * `excepcion`: owner-approved exception for rows with an empty permission. They
 * are accepted as `excepcion:<id>` (internal evaluation only); BY-SA and
 * unrecognized permissions stay excluded even then.
 */
export function importarRegistro(filas: readonly Record<string, string>[], raiz: string, leerBytes: (ruta: string) => Uint8Array | null, excepcion?: ExcepcionPermiso): ResultadoImportacion {
  const aceptadas: ItemManual[] = [];
  const excluidas: ResultadoImportacion["excluidas"] = [];
  const vistos = new Set<string>();
  for (const fila of filas) {
    const archivo = (fila.archivo ?? "").replace(/\//g, "\\");
    const excluir = (motivo: MotivoExclusion) => excluidas.push({ archivo, motivo });
    const clase = (fila.clase_candidata || archivo.split("\\")[0] || "") as ClaseManual;
    if (!(CLASES_MANUALES as readonly string[]).includes(clase)) { excluir("clase_desconocida"); continue; }
    if (clase === "negativo" || clase === "no_se") { excluir("negativo_o_no_se"); continue; }
    const declarado = (fila.permiso ?? "").trim().toLowerCase();
    if (!declarado && !excepcion) { excluir("sin_permiso"); continue; }
    const permiso = declarado || `excepcion:${excepcion!.id}`;
    if (permiso === "by-sa" || permiso === "cc-by-sa") { excluir("by_sa_revision_legal"); continue; }
    if (!declarado ? false : !PERMISO_VALIDO.test(permiso)) { excluir("permiso_no_reconocido"); continue; }
    const ruta = resolve(raiz, archivo);
    const rel = relative(resolve(raiz), ruta);
    if (rel.startsWith("..") || isAbsolute(rel)) { excluir("fuera_de_la_carpeta"); continue; }
    const bytes = leerBytes(ruta);
    if (!bytes) { excluir("archivo_inexistente"); continue; }
    if (!formatoImagen(bytes)) { excluir("formato_no_admitido"); continue; }
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    if (vistos.has(sha256)) { excluir("duplicado_exacto"); continue; }
    vistos.add(sha256);
    aceptadas.push({ sha256, archivo: rel, clase, permiso });
  }
  const contar = (claves: string[]) => claves.reduce<Record<string, number>>((acumulado, clave) => ({ ...acumulado, [clave]: (acumulado[clave] ?? 0) + 1 }), {});
  return {
    aceptadas,
    excluidas,
    por_clase: contar(aceptadas.map((item) => item.clase)),
    por_familia: contar(aceptadas.map((item) => familiaDesdeClaseOficial(item.clase))),
  };
}

/**
 * Stratified, deterministic cap for dev-seed-v0 (10–60 images, Plan A §A0.4a):
 * round-robin over families, ordered by sha256 inside each family.
 */
export function seleccionEstratificada(items: readonly ItemManual[], maximo: number): ItemManual[] {
  const porFamilia = new Map<string, ItemManual[]>();
  for (const item of [...items].sort((a, b) => a.sha256.localeCompare(b.sha256))) {
    const familia = familiaDesdeClaseOficial(item.clase);
    porFamilia.set(familia, [...(porFamilia.get(familia) ?? []), item]);
  }
  const familias = [...porFamilia.keys()].sort();
  const elegidas: ItemManual[] = [];
  for (let ronda = 0; elegidas.length < maximo; ronda += 1) {
    let agregadas = 0;
    for (const familia of familias) {
      const siguiente = porFamilia.get(familia)![ronda];
      if (siguiente && elegidas.length < maximo) { elegidas.push(siguiente); agregadas += 1; }
    }
    if (agregadas === 0) break;
  }
  return elegidas;
}

export function suiteDesdeManual(items: readonly ItemManual[], suiteId: string, excepcion?: ExcepcionPermiso) {
  const usaExcepcion = items.some((item) => item.permiso.startsWith("excepcion:"));
  if (usaExcepcion && !excepcion) throw new Error("hay ítems con excepción de permiso sin la excepción registrada");
  return SuiteSchema.parse({
    suite_id: suiteId,
    taxonomy_version: "estructuras-2.0.0",
    ...(usaExcepcion ? { excepcion_permiso: { id: excepcion!.id, aprobada_en: excepcion!.aprobadaEn, alcance: "evaluacion_interna_orientativa", registro: excepcion!.registro } } : {}),
    items: items.map((item) => ({
      image_sha256: item.sha256,
      ruta_privada: item.archivo,
      // Accepted rows carry cc0, cc-by, public domain, a written permission, or the recorded owner exception above.
      evaluacion_con_proveedor_externo: true,
      envio_proveedores_ia_permitido: true,
    })),
  });
}

/** Folder class per image (one person's curation hint, not reviewed ground truth). */
export function etiquetasCarpeta(items: readonly ItemManual[]): Record<string, ClaseManual> {
  return Object.fromEntries(items.map((item) => [item.sha256, item.clase]));
}
