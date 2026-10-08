import { TABLA_SEMPERTEX, referenciaPorCodigo, type ReferenciaSempertex } from "@/lib/plan/referencia-sempertex";
import { labDeRgb } from "@/lib/rag/catalog/similitud-color";
import { FORMATOS_GLOBO, coloresDelFormato, formatoPorId } from "./formatos";
import { COLORES_METALIZADO, type ColorMetalizado } from "./metalizados";

/**
 * Colores de las herramientas de la IA del taller 3D (`herramientas-escena.ts`): un color pedido por código
 * Sempertex («609») o por nombre («rosado pastel», «dorado», «réflex rojo») → el código oficial que se fabrica en el
 * formato de la pieza, con error claro (y el más parecido que sí viene) o, en el recolor de toda la escena, con el
 * más parecido del formato y una nota. Puro y sin red.
 */

/** Error que se le devuelve tal cual al modelo (con su sugerencia). */
export class ErrorHerramienta extends Error {}
export const fallar = (mensaje: string): never => { throw new ErrorHerramienta(mensaje); };

export const plegar = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const VACIAS = new Set(["de", "del", "la", "el", "color", "globo", "globos", "tono", "y", "en"]);
/** Variantes de una palabra de color a la forma de la tabla. */
const VARIANTES: Readonly<Record<string, string>> = {
  rosada: "rosado", blanca: "blanco", dorada: "dorado", oro: "dorado", plateado: "plata", plateada: "plata", roja: "rojo", amarilla: "amarillo",
  negra: "negro", morado: "violeta", morada: "violeta", purpura: "violeta", anaranjado: "naranja", marron: "cafe", champagne: "champana",
  verdes: "verde", azules: "azul", rosados: "rosado", rosadas: "rosado", blancos: "blanco", blancas: "blanco", dorados: "dorado", doradas: "dorado",
  rojos: "rojo", rojas: "rojo", negros: "negro", negras: "negro", amarillos: "amarillo", amarillas: "amarillo", plateados: "plata", plateadas: "plata",
  morados: "violeta", moradas: "violeta", violetas: "violeta", naranjas: "naranja", cafes: "cafe", grises: "gris", fucsias: "fucsia",
};
/** Palabras de acabado: eligen la familia. */
export const FAMILIAS_POR_PALABRA: Readonly<Record<string, readonly string[]>> = {
  pastel: ["pastelMate", "pastelDusk"], mate: ["pastelMate"], dusk: ["pastelDusk"], metal: ["metal"], metalico: ["metal"], metalica: ["metal"],
  metalizado: ["metal"], metalizada: ["metal"], satin: ["satin"], satinado: ["satin"], satinada: ["satin"], reflex: ["reflex"], cromado: ["reflex"],
  cromada: ["reflex"], espejo: ["reflex"], silk: ["silk"], seda: ["silk"], neon: ["neon"], fluorescente: ["neon"], fashion: ["fashion"],
};
/** Palabras que traen color y acabado a la vez. */
const PISTAS: Readonly<Record<string, { color: string; familias: readonly string[] }>> = { celeste: { color: "azul", familias: ["pastelMate"] } };
/** Ante la duda, la familia más común en decoración. */
const PRIORIDAD_FAMILIA = ["fashion", "pastelMate", "metal", "reflex", "satin", "silk", "pastelDusk", "neon", "cristal"];

export const palabras = (texto: string) => plegar(texto).split(/[^a-z0-9]+/).filter((p) => p && !VACIAS.has(p)).map((p) => VARIANTES[p] ?? p);
export const nombreDe = (r: Pick<ReferenciaSempertex, "codigo" | "nombreCompleto">) => `${r.codigo} ${r.nombreCompleto}`;

export function distanciaLab(a: string, b: string): number {
  const lab = (hex: string) => labDeRgb(parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16));
  const [l1, a1, b1] = lab(a), [l2, a2, b2] = lab(b);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}

/** El color del formato más parecido (por el color del globo inflado). */
export function masParecido(ref: ReferenciaSempertex, formatoId: string): ReferenciaSempertex | undefined {
  return coloresDelFormato(formatoId).filter((r) => r.codigo !== ref.codigo).sort((x, y) => distanciaLab(ref.hexGlobo, x.hexGlobo) - distanciaLab(ref.hexGlobo, y.hexGlobo))[0];
}

/** Busca un color por nombre en toda la tabla; devuelve el mejor y los otros que también encajan igual de bien. */
export function buscarPorNombre(pedido: string): { mejor: ReferenciaSempertex; otros: ReferenciaSempertex[] } | null {
  const tokens = palabras(pedido);
  const familias = new Set<string>();
  const color: string[] = [];
  for (const t of tokens) {
    const pista = PISTAS[t];
    if (pista) { color.push(pista.color); if (!tokens.some((x) => FAMILIAS_POR_PALABRA[x])) pista.familias.forEach((f) => familias.add(f)); continue; }
    const fam = FAMILIAS_POR_PALABRA[t];
    if (fam) fam.forEach((f) => familias.add(f)); else color.push(t);
  }
  if (!color.length) return null;
  const puntuadas = TABLA_SEMPERTEX.referencias.flatMap((r) => {
    if (familias.size && !familias.has(r.familia)) return [];
    const nombre = palabras(r.nombre);
    if (!color.every((c) => nombre.includes(c))) return [];
    const prioridad = PRIORIDAD_FAMILIA.indexOf(r.familia);
    return [{ r, sobra: nombre.length - color.length, puntos: (nombre.length - color.length) * 10 + (prioridad < 0 ? 9 : prioridad) }];
  }).sort((a, b) => a.puntos - b.puntos);
  const mejor = puntuadas[0];
  if (!mejor) return null;
  return { mejor: mejor.r, otros: puntuadas.slice(1).filter((p) => p.sobra === mejor.sobra).map((p) => p.r) };
}

export type ColorResuelto = { codigo: string; nota?: string };

/**
 * Un color pedido (código o nombre) → código Sempertex que se fabrica en ese formato. Error claro si no existe o
 * no viene en el formato, con el más parecido que sí viene.
 */
export function resolverColor(pedido: string, formatoId: string): ColorResuelto {
  const formato = formatoPorId(formatoId) ?? fallar(`El formato «${formatoId}» no existe. Formatos: ${FORMATOS_GLOBO.map((f) => f.id).join(", ")}.`);
  const enFormato = (codigo: string) => coloresDelFormato(formato.id).some((r) => r.codigo === codigo);
  const codigo = pedido.match(/\b(\d{3})\b/)?.[1];
  let ref: ReferenciaSempertex;
  let nota: string | undefined;
  if (codigo) {
    ref = referenciaPorCodigo(codigo) ?? fallar(`El color ${codigo} no está en la tabla oficial Sempertex. Usa listar_colores con el formato ${formato.id}.`);
  } else {
    const hallado = buscarPorNombre(pedido) ?? fallar(`No encontré el color «${pedido}» en la tabla Sempertex. Usa listar_colores con el formato ${formato.id} para ver los que hay.`);
    // Si el mejor no viene en el formato pero otro igual de bueno sí (Metal Dorado no, Reflex Dorado sí), ese.
    ref = enFormato(hallado.mejor.codigo) ? hallado.mejor : hallado.otros.find((r) => enFormato(r.codigo)) ?? hallado.mejor;
    const otros = hallado.otros.filter((r) => r.codigo !== ref.codigo && enFormato(r.codigo));
    nota = `«${pedido}» → ${nombreDe(ref)}${otros.length ? ` (también hay ${otros.slice(0, 3).map(nombreDe).join(", ")})` : ""}`;
  }
  if (!enFormato(ref.codigo)) {
    const sugerido = masParecido(ref, formato.id);
    fallar(`El color ${nombreDe(ref)} no se fabrica en ${formato.id}.${sugerido ? ` El más parecido que sí viene en ${formato.id} es ${nombreDe(sugerido)}.` : ""}`);
  }
  return nota ? { codigo: ref.codigo, nota } : { codigo: ref.codigo };
}

/** Resuelve una lista de colores y junta las notas. */
export function resolverColores(pedidos: readonly string[], formatoId: string, notas: string[]): string[] {
  return pedidos.map((p) => { const r = resolverColor(p, formatoId); if (r.nota) notas.push(r.nota); return r.codigo; });
}

export const nombreColor = (codigo: string) => { const r = referenciaPorCodigo(codigo); return r ? nombreDe(r) : codigo; };

/** Los colores (código y formatos donde aparece) de cualquier dato del taller, en orden de aparición. */
export function coloresDeDato(valor: unknown): Array<{ codigo: string; formatos: string[] }> {
  const salida = new Map<string, Set<string>>();
  const anotar = (codigo: unknown, formatos: readonly string[]) => {
    if (typeof codigo !== "string" || !/^\d{3}$/.test(codigo)) return;
    const s = salida.get(codigo) ?? new Set<string>();
    formatos.forEach((f) => s.add(f));
    salida.set(codigo, s);
  };
  const recorrer = (v: unknown) => {
    if (Array.isArray(v)) { v.forEach(recorrer); return; }
    if (typeof v !== "object" || v === null) return;
    const o = v as Record<string, unknown>;
    const formatos = [o.formatoId, ...["grande", "chico"].map((k) => { const x = o[k]; return typeof x === "object" && x !== null ? (x as Record<string, unknown>).formatoId : undefined; })]
      .filter((f): f is string => typeof f === "string");
    for (const [clave, x] of Object.entries(o)) {
      if (clave === "codigo") anotar(x, formatos);
      else if ((clave === "codigos" || clave === "colores") && Array.isArray(x)) x.forEach((c) => (typeof c === "string" ? anotar(c, formatos) : recorrer(c)));
      else recorrer(x);
    }
  };
  recorrer(valor);
  return [...salida.entries()].map(([codigo, formatos]) => ({ codigo, formatos: [...formatos] }));
}

// ----------------------------------------------------------------------------------------------------------
// Lo que usan la creación de estructuras, el recolor de la escena y la biblioteca
// ----------------------------------------------------------------------------------------------------------

/** La referencia de un pedido (código o nombre) sin mirar el formato: la mejor de la tabla, o `null`. */
export function referenciaDePedido(pedido: string): ReferenciaSempertex | null {
  const codigo = pedido.match(/\b(\d{3})\b/)?.[1];
  if (codigo) return referenciaPorCodigo(codigo) ?? null;
  return buscarPorNombre(pedido)?.mejor ?? null;
}

/** Los códigos que encajan con un pedido (el mejor y los igual de buenos de otras familias): para filtrar por color. */
export function codigosDePedido(pedido: string): string[] {
  const codigo = pedido.match(/\b(\d{3})\b/)?.[1];
  if (codigo) return referenciaPorCodigo(codigo) ? [codigo] : [];
  const hallado = buscarPorNombre(pedido);
  return hallado ? [hallado.mejor.codigo, ...hallado.otros.map((r) => r.codigo)] : [];
}

/** Le pone el acabado («metal», «pastel», «reflex»…) a un pedido que no trae acabado ni código. */
export function conAcabado(pedido: string, acabado: string | undefined): string {
  if (!acabado?.trim() || /\b\d{3}\b/.test(pedido)) return pedido;
  const trae = palabras(pedido).some((p) => FAMILIAS_POR_PALABRA[p] !== undefined || p === "cristal");
  return trae ? pedido : `${pedido} ${acabado.trim()}`;
}

/**
 * Como `resolverColor`, pero sin fallar por el formato: el código que se fabrica en TODOS los `formatos` (si no
 * hay ninguno común, en el primero); si el pedido no viene, el más parecido que sí, con una nota. Solo falla si el
 * color no existe en la tabla.
 */
export function resolverColorFlexible(pedido: string, formatos: readonly string[], notas: string[]): string {
  const lista = [...new Set(formatos)].filter((f) => formatoPorId(f));
  const enTodos = (codigo: string) => lista.every((f) => coloresDelFormato(f).some((r) => r.codigo === codigo));
  const primero = lista[0];
  if (primero) {
    try {
      const r = resolverColor(pedido, primero);
      if (enTodos(r.codigo)) { if (r.nota) notas.push(r.nota); return r.codigo; }
    } catch (error) {
      if (!(error instanceof ErrorHerramienta) || !/no se fabrica/.test(error.message)) throw error;
    }
  }
  const ref = referenciaDePedido(pedido) ?? fallar(`No encontré el color «${pedido}» en la tabla Sempertex. Usa listar_colores para ver los que hay.`);
  if (!primero) return ref.codigo;
  const comunes = coloresDelFormato(primero).filter((r) => enTodos(r.codigo));
  const opciones = comunes.length ? comunes : coloresDelFormato(primero);
  const mejor = [...opciones].sort((x, y) => distanciaLab(ref.hexGlobo, x.hexGlobo) - distanciaLab(ref.hexGlobo, y.hexGlobo))[0] ?? ref;
  if (mejor.codigo !== ref.codigo) notas.push(`${nombreDe(ref)} no viene en ${lista.join("/")}: puse ${nombreDe(mejor)}, el más parecido`);
  return mejor.codigo;
}

/** Formatos de la técnica orgánica, del más usado al menos. */
export const FORMATOS_ORGANICOS = ["R-12", "R-9", "R-5", "R-18", "R-24"] as const;

/** Los formatos orgánicos en que se fabrica un color. */
export const formatosOrganicosDe = (codigo: string): string[] => FORMATOS_ORGANICOS.filter((f) => coloresDelFormato(f).some((c) => c.codigo === codigo));

/**
 * Un color para una pieza orgánica (que mezcla tamaños): el código pedido si viene en algún formato orgánico, con
 * los formatos donde se fabrica; si no, el más parecido en R-12.
 */
export function resolverColorOrganico(pedido: string, notas: string[]): { codigo: string; formatos: string[] } {
  for (const f of FORMATOS_ORGANICOS) {
    try {
      const r = resolverColor(pedido, f);
      if (r.nota) notas.push(r.nota);
      return { codigo: r.codigo, formatos: formatosOrganicosDe(r.codigo) };
    } catch (error) {
      if (!(error instanceof ErrorHerramienta) || !/no se fabrica/.test(error.message)) throw error;
    }
  }
  const codigo = resolverColorFlexible(pedido, ["R-12"], notas);
  return { codigo, formatos: formatosOrganicosDe(codigo) };
}

/** El color de foil (metalizado) más parecido a un color Sempertex. */
export function metalizadoMasParecido(codigo: string): ColorMetalizado {
  const hex = referenciaPorCodigo(codigo)?.hexGlobo ?? COLORES_METALIZADO.oro.hex;
  const claves = Object.keys(COLORES_METALIZADO) as ColorMetalizado[];
  return [...claves].sort((a, b) => distanciaLab(hex, COLORES_METALIZADO[a].hex) - distanciaLab(hex, COLORES_METALIZADO[b].hex))[0] ?? "oro";
}

/** Los formatos que existen (para los mensajes de error). */
export const listaFormatos = (): string => FORMATOS_GLOBO.map((f) => f.id).join(", ");
