import { TABLA_SEMPERTEX, referenciaPorCodigo, type ReferenciaSempertex } from "@/lib/plan/referencia-sempertex";
import { labDeRgb, type Lab } from "@/lib/rag/catalog/similitud-color";
import { avisar } from "./avisos-usuario";
import { DISTANCIA_MAXIMA_FAMILIA, distanciaLab } from "./colores-formato";
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
  // Lo que dicen los decoradores (y Pinterest, en inglés) para los colores de la tabla (2026-10-08, fotos del dueño).
  marino: "naval", navy: "naval", esmeralda: "selva", botella: "selva", blush: "nude", marfil: "crema", ivory: "crema", cream: "crema",
  gold: "dorado", silver: "plata", white: "blanco", black: "negro", pink: "rosado", red: "rojo", green: "verde", blue: "azul",
  orange: "naranja", yellow: "amarillo", purple: "violeta", lilac: "lila", chrome: "reflex", metallic: "metal",
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

export { distanciaLab };

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

const labDeHex = (hex: string): Lab => labDeRgb(parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16));
const cromaDe = (lab: Lab): number => Math.hypot(lab[1], lab[2]);
const matizDe = (lab: Lab): number => (Math.atan2(lab[2], lab[1]) * 180) / Math.PI;
const diferenciaDeMatiz = (a: number, b: number): number => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };
/** Desde esta viveza un color tiene tono propio (un verde, un rojo) y no puede salir en un foil de otro tono. */
const CROMA_CON_TONO = 25;
const MATIZ_MAXIMO_GRADOS = 50;

/** Un color con menos viveza que esta es neutro (blanco, gris, negro, plata, crema): solo puede salir en un foil neutro. */
const CROMA_NEUTRO = 8;
/** Los foiles neutros: plata, negro mate, blanco y arena (el azul pastel es casi gris, pero es azul). */
const CROMA_FOIL_NEUTRO = 10;

export type FoilElegido = {
  color: ColorMetalizado;
  /** Distancia CIELAB del globo inflado al foil elegido. */
  distancia: number;
  /** El dorado brillante va a Oro por regla (es lo que la tienda vende como «dorado»): no es una aproximación aunque el hex se aleje. */
  porRegla: boolean;
};

/**
 * El color de foil (metalizado) más parecido a un color Sempertex.
 * - Un dorado brillante (Metal, Reflex, Silk) es el foil Oro; el dorado mate es solo para quien lo pide mate (Fashion no tiene dorado).
 * - Un color con tono (un verde) se queda en foiles del mismo tono: por distancia pura un verde quedaba en el azul pastel, que está más cerca en luz y viveza.
 * - Un color neutro (gris, blanco, negro, plata) se queda en los foiles neutros.
 */
export function foilMasParecido(codigo: string): FoilElegido {
  const ref = referenciaPorCodigo(codigo);
  if (ref && /dorad/i.test(ref.nombreCompleto) && !/rosa/i.test(ref.nombreCompleto)) {
    return { color: "oro", distancia: distanciaLab(ref.hexGlobo, COLORES_METALIZADO.oro.hex), porRegla: true };
  }
  const hex = ref?.hexGlobo ?? COLORES_METALIZADO.oro.hex;
  const claves = Object.keys(COLORES_METALIZADO) as ColorMetalizado[];
  const lab = labDeHex(hex);
  const croma = cromaDe(lab);
  const masCercano = (pool: readonly ColorMetalizado[]): ColorMetalizado | undefined => [...pool].sort((x, y) => distanciaLab(hex, COLORES_METALIZADO[x].hex) - distanciaLab(hex, COLORES_METALIZADO[y].hex))[0];
  const delMismoTono = (cromaMinimoFoil: number) => claves.filter((k) => {
    const foil = labDeHex(COLORES_METALIZADO[k].hex);
    return cromaDe(foil) >= cromaMinimoFoil && diferenciaDeMatiz(matizDe(foil), matizDe(lab)) <= MATIZ_MAXIMO_GRADOS;
  });
  let color: ColorMetalizado | undefined;
  if (croma >= CROMA_CON_TONO) color = masCercano(delMismoTono(CROMA_CON_TONO / 2));
  else if (croma < CROMA_NEUTRO) color = masCercano(claves.filter((k) => cromaDe(labDeHex(COLORES_METALIZADO[k].hex)) < CROMA_FOIL_NEUTRO));
  else {
    // Un pastel (un rosado pálido) tiene poca viveza pero sí tono: su foil es del mismo tono si queda cerca; si no (un chocolate, un menta), el más cercano
    // entre los neutros y los del mismo tono, nunca uno de otro tono (un menta en el azul pastel).
    const mismoTono = delMismoTono(CROMA_FOIL_NEUTRO);
    const delTono = masCercano(mismoTono);
    if (delTono && distanciaLab(hex, COLORES_METALIZADO[delTono].hex) <= DISTANCIA_MAXIMA_FAMILIA) color = delTono;
    else color = masCercano([...mismoTono, ...claves.filter((k) => cromaDe(labDeHex(COLORES_METALIZADO[k].hex)) < CROMA_FOIL_NEUTRO)]);
  }
  color ??= masCercano(claves) ?? "oro";
  return { color, distancia: distanciaLab(hex, COLORES_METALIZADO[color].hex), porRegla: false };
}

export const metalizadoMasParecido = (codigo: string): ColorMetalizado => foilMasParecido(codigo).color;

/**
 * Pasada `DISTANCIA_MAXIMA_FAMILIA` (la misma con que el taller da un color por otro de su familia) el foil ya es otro color que el pedido y la persona
 * se tiene que enterar. Por debajo (un rojo al foil Rojo: 8) es el mismo color; por encima (un verde al Verde vibrante: 56) no.
 */
export const foilEsAproximado = (f: FoilElegido): boolean => !f.porRegla && f.distancia > DISTANCIA_MAXIMA_FAMILIA;

/**
 * El único sitio que avisa de un foil aproximado (crear, recolorear y editar_globos): lo anota en `notas` como aviso para el usuario y devuelve `true`.
 * Las palabras que dan el aviso por dicho son solo las de decir que no viene en ese color: nombrar el foil o el color no lo es.
 */
export function avisarFoilAproximado(notas: string[], pedido: string, codigo: string): boolean {
  const foil = foilMasParecido(codigo);
  if (!foilEsAproximado(foil)) return false;
  avisar(notas, `El foil no viene en «${pedido}»: puse ${COLORES_METALIZADO[foil.color].nombre}, el foil más parecido.`, "no viene en", "más parecid", "mas parecid");
  return true;
}

/** Los formatos que existen (para los mensajes de error). */
export const listaFormatos = (): string => FORMATOS_GLOBO.map((f) => f.id).join(", ");
