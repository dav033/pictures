import { FORMATOS_GLOBO, NOMBRE_FAMILIA, coloresDelFormato } from "@/lib/globos3d/formatos";
import { MODULOS, moduloPorId, type TipoModulo } from "@/lib/globos3d/modulos";
import { referenciaPorCodigo, seFabricaEn, type ReferenciaSempertex } from "@/lib/plan/referencia-sempertex";
import { GLOBOS_POR_TIPO } from "./simetrias";

/**
 * La configuración de un módulo del estudio: el tipo, el tamaño y el color de CADA globo, en el orden en que los
 * coloca `armarModulo` (el globo `i` de `colores` es el globo `i` del módulo).
 *
 * El color y el acabado viajan juntos en un solo dato, el código del catálogo Sempertex («015» = Fashion Rojo, «915» =
 * Reflex Cristal Rojo): el catálogo ya trae el acabado dentro del código, así que guardar aparte un «acabado» solo
 * dejaría escribir combinaciones que no existen. El acabado se lee del catálogo (`acabadoDe`).
 */
export type ConfigModulo = { tipo: TipoModulo; formatoId: string; colores: readonly string[] };

/** Lo que llega de fuera (formulario, API, texto interpretado): puede traer menos colores que globos. */
export type EntradaModulo = { tipo: string; formatoId?: string; colores: readonly string[] };

export type ResultadoConfig = { ok: true; config: ConfigModulo; avisos: string[] } | { ok: false; errores: string[] };

export const FORMATO_POR_DEFECTO = "R-12";

/** Los tamaños que ofrece el estudio: los globos redondos del módulo (el Link-O-Loon no se vende como módulo suelto). */
export const FORMATOS_ESTUDIO: readonly string[] = ["R-5", "R-9", "R-12", "R-18", "R-24"];

/** Los cinco módulos de `modulos.ts`; la pareja se muestra como «Dúo». */
export const TIPOS_ESTUDIO: ReadonlyArray<{ id: TipoModulo; nombre: string; globos: number }> = MODULOS.map((m) => ({
  id: m.id,
  nombre: m.id === "pareja" ? "Dúo" : m.nombre,
  globos: m.globos,
}));

export function nombreTipo(tipo: TipoModulo): string {
  return TIPOS_ESTUDIO.find((t) => t.id === tipo)?.nombre ?? tipo;
}

const CODIGO = /^[0-9]{3}$/;

/**
 * Valida y completa lo que llega. Regla para los globos que faltan (documentada y probada): los colores se repiten
 * **en ciclo** (`colores[i % k]`). Con un solo color, todos los globos de ese color; con dos colores, los globos pares
 * de uno y los impares del otro, que en cuarteto, quinteto y sexteto es justo «una pareja (o trío) de cada color»,
 * porque `armarModulo` alterna arriba/abajo con `i % 2`. Más colores que globos no se recorta: es un error.
 */
export function resolverConfig(entrada: EntradaModulo): ResultadoConfig {
  const errores: string[] = [];
  const avisos: string[] = [];
  const modulo = moduloPorId(entrada.tipo);
  if (!modulo) errores.push(`Tipo de módulo desconocido: «${entrada.tipo}». Los hay de ${MODULOS.map((m) => m.id).join(", ")}.`);
  const formatoId = entrada.formatoId ?? FORMATO_POR_DEFECTO;
  if (!FORMATOS_ESTUDIO.includes(formatoId) || !FORMATOS_GLOBO.some((f) => f.id === formatoId)) {
    errores.push(`Tamaño no disponible en el estudio: «${formatoId}». Los hay de ${FORMATOS_ESTUDIO.join(", ")}.`);
  }
  if (entrada.colores.length === 0) errores.push("Falta al menos un color.");
  for (const codigo of new Set(entrada.colores)) {
    if (!CODIGO.test(codigo) || !referenciaPorCodigo(codigo)) errores.push(`El color «${codigo}» no está en el catálogo Sempertex.`);
  }
  if (modulo && entrada.colores.length > modulo.globos) {
    errores.push(`${nombreTipo(modulo.id)} lleva ${modulo.globos} globos y llegaron ${entrada.colores.length} colores.`);
  }
  if (errores.length > 0 || !modulo) return { ok: false, errores };

  const colores = Array.from({ length: modulo.globos }, (_, i) => entrada.colores[i % entrada.colores.length]!);
  if (entrada.colores.length < modulo.globos && entrada.colores.length > 1) {
    avisos.push(`Llegaron ${entrada.colores.length} colores para ${modulo.globos} globos: se repiten en ciclo.`);
  }
  for (const codigo of new Set(colores)) {
    if (!seFabricaEn(codigo, formatoId)) {
      const ref = referenciaPorCodigo(codigo);
      avisos.push(`${ref?.nombreCompleto ?? codigo} (${codigo}) no se fabrica en ${formatoId}; el render lo muestra igual.`);
    }
  }
  return { ok: true, config: { tipo: modulo.id, formatoId, colores }, avisos };
}

/** Acabado comercial del código («Fashion», «Reflex»…), tal como lo nombra el catálogo. */
export function acabadoDe(codigo: string): string {
  const ref = referenciaPorCodigo(codigo);
  return ref ? NOMBRE_FAMILIA[ref.familia] ?? ref.familia : "";
}

/** «Fashion Rojo» (nombre completo del catálogo) o el código si no existe. */
export function nombreColor(codigo: string): string {
  return referenciaPorCodigo(codigo)?.nombreCompleto ?? codigo;
}

/** Los colores que se fabrican en el tamaño, agrupados por acabado y en el orden de la lámina: para el selector. */
export function coloresPorAcabado(formatoId: string): Array<{ familia: string; nombre: string; colores: ReferenciaSempertex[] }> {
  const mapa = new Map<string, ReferenciaSempertex[]>();
  for (const c of coloresDelFormato(formatoId)) mapa.set(c.familia, [...(mapa.get(c.familia) ?? []), c]);
  return [...mapa.entries()].map(([familia, colores]) => ({ familia, nombre: NOMBRE_FAMILIA[familia] ?? familia, colores }));
}

export const globosDe = (tipo: TipoModulo): number => GLOBOS_POR_TIPO[tipo];
