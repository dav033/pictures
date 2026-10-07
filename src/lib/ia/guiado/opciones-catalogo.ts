import { normalizarBusqueda } from "@/lib/biblioteca-sempertex/biblioteca";

/**
 * Dueño (2026-10-06): «no quiero que el sistema ofrezca cosas que no tiene; no quiero que ofrezca dorado y blanco cuando
 * no tiene imágenes así». El prompt ya pide ofrecer solo temáticas del catálogo; esto lo garantiza en el servidor: en la
 * línea final «Opciones: a | b | c», toda opción que nombre colores o una temática debe corresponder a una temática con
 * decoraciones. Las demás opciones (edades, ciudades, «Otra temática», sí/no…) se conservan.
 */
const PALABRAS_DE_ESTILO = [
  "rosa", "rosado", "rosada", "fucsia", "dorado", "dorada", "oro", "blanco", "blanca", "negro", "negra", "azul", "celeste",
  "plateado", "plateada", "plata", "lila", "morado", "morada", "violeta", "purpura", "verde", "rojo", "roja", "naranja",
  "amarillo", "amarilla", "turquesa", "coral", "champagne", "beige", "crema", "pastel", "multicolor", "arcoiris", "neon",
  "cromado", "metalizado", "princesa", "princesas", "dinosaurio", "dinosaurios", "superheroe", "superheroes", "videojuego",
  "videojuegos", "unicornio", "unicornios", "espacio", "safari", "selva", "futbol", "frozen", "sirena", "sirenas", "tropical",
  "elegante", "romantico", "romantica", "infantil", "colorida", "colorido", "halloween",
];

function palabrasDeEstilo(texto: string): string[] {
  const palabras = normalizarBusqueda(texto).split(/[^a-z0-9]+/).filter(Boolean);
  return palabras.filter((palabra) => PALABRAS_DE_ESTILO.includes(palabra));
}

const raiz = (palabra: string) => palabra.replace(/(?:as|os|a|o|es|s)$/, "");

/** ¿La opción nombra una temática del catálogo? Todas sus palabras de estilo deben estar en una misma temática. */
function correspondeACatalogo(opcion: string, tematicas: readonly string[]): boolean {
  const estilo = palabrasDeEstilo(opcion).map(raiz);
  return tematicas.some((tematica) => {
    const propias = new Set(palabrasDeEstilo(tematica).map(raiz));
    return estilo.every((palabra) => propias.has(palabra));
  });
}

/** Las opciones de la línea final «Opciones: a | b | c» (vacío si no la hay). */
export function opcionesDeTexto(texto: string): string[] {
  const ultima = texto.trimEnd().split("\n").at(-1) ?? "";
  const coincide = /^(\**\s*opciones\s*:\**\s*)(.+)$/i.exec(ultima.trim());
  return coincide ? coincide[2]!.split("|").map((opcion) => opcion.trim()).filter(Boolean) : [];
}

/** Para la auditoría del saneo: qué opciones quitó y cuáles añadió (temáticas del catálogo). */
export function diferenciaOpciones(antes: string, despues: string): { quitadas: string[]; anadidas: string[] } {
  const previas = opcionesDeTexto(antes);
  const finales = opcionesDeTexto(despues);
  return { quitadas: previas.filter((opcion) => !finales.includes(opcion)), anadidas: finales.filter((opcion) => !previas.includes(opcion)) };
}

export function sanearOpcionesCatalogo(texto: string, tematicas: readonly string[]): string {
  if (!tematicas.length) return texto;
  const lineas = texto.trimEnd().split("\n");
  const ultima = lineas.at(-1) ?? "";
  const coincide = /^(\**\s*opciones\s*:\**\s*)(.+)$/i.exec(ultima.trim());
  if (!coincide) return texto;
  const opciones = coincide[2]!.split("|").map((opcion) => opcion.trim()).filter(Boolean);
  const deEstilo = opciones.filter((opcion) => palabrasDeEstilo(opcion).length > 0);
  if (!deEstilo.length) return texto;
  const validas = opciones.filter((opcion) => !palabrasDeEstilo(opcion).length || correspondeACatalogo(opcion, tematicas));
  const quedanDeEstilo = validas.filter((opcion) => palabrasDeEstilo(opcion).length > 0).length;
  // Si el modelo propuso estilos y casi ninguno existe, se ofrecen directamente las temáticas del catálogo.
  const finales = quedanDeEstilo >= Math.min(2, deEstilo.length)
    ? validas
    : [...tematicas.slice(0, 5), ...validas.filter((opcion) => !palabrasDeEstilo(opcion).length)].slice(0, 6);
  return [...lineas.slice(0, -1), `Opciones: ${finales.join(" | ")}`].join("\n");
}
