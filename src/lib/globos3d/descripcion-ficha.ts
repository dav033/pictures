/**
 * La descripción de una ficha de la biblioteca, con palabras de cliente. Las notas de las ideas, las referencias y las bases
 * están escritas por quien armó la pieza, para quien la mantiene: «Igual: … Distinto: …», con los colores medidos en la foto
 * (#hex, ΔE), la escala en píxeles y avisos como «la idea no publica productos». Eso no ayuda a quien elige una decoración:
 * aquí se queda lo que lleva la pieza y en qué se aparta de la foto, sin las cuentas de quien la midió. La nota original no
 * cambia (la IA de escena y la búsqueda siguen leyéndola entera); esto es solo lo que se muestra.
 */

/** Marcas de sección de las notas: lo que lleva la pieza («Igual», «Se parece») y en qué se aparta de la foto («Distinto», «No»). */
const MARCA_SECCION = /(^|\.\s+)(Igual|Distinto|Se parece|No):\s*/g;

const ENCABEZADO: Readonly<Record<string, string>> = { Igual: "Lleva", "Se parece": "Lleva", Distinto: "Respecto a la foto", No: "Respecto a la foto" };

/** Lo que solo dice cómo se midió o qué trae la página de la idea: un paréntesis con esto se quita entero. */
const MEDIDA_DE_FOTO = /#[0-9a-f]{6}|ΔE|\bpx\b|\bescala (?:por|sale)\b|no (?:publica|lista|trae) productos/i;

/** Una frase que solo explica cómo se calculó la escala o qué no publica la idea: se quita entera. */
const FRASE_DE_MEDICION = /\bpx\b|ΔE|\bla escala\b|tamaño conocido|no (?:publica|lista|trae) productos|sin productos publicados|la ficha no trae|no da la medida|\bMisma foto que #\d+|se reusa su digitalización/i;

/** Los paréntesis sin anidar que cumplen `quitar`, de adentro hacia afuera. */
function sinParentesis(texto: string, quitar: RegExp): string {
  let actual = texto;
  for (let previo = ""; previo !== actual;) {
    previo = actual;
    actual = actual.replace(/\s*\([^()]*\)/g, (grupo) => (quitar.test(grupo) ? "" : grupo));
  }
  return actual;
}

/** Los colores medidos de la foto, sin el tono medido: «rojo #cf010e → Fashion Rojo 015» queda «rojo: Fashion Rojo 015». */
function sinTonosMedidos(texto: string): string {
  return texto
    .replace(/\b(?:mide|miden|medido)\s+#[0-9a-f]{6}(?:\s*\([^)]*\))?\s*→\s*/gi, "va en ")
    .replace(/\s*\b(?:mide|miden|medido|medidos)\s+#[0-9a-f]{6}(?:–#[0-9a-f]{6})?/gi, "")
    .replace(/\s*#[0-9a-f]{6}(?:–#[0-9a-f]{6})?\s*→\s*/gi, ": ")
    .replace(/\s*#[0-9a-f]{6}(?:–#[0-9a-f]{6})?/gi, "");
}

const EN_LENGUAJE_DE_CLIENTE: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bColores medidos(?: en la foto)?(?:\s*\([^)]*\))?/g, "Colores"],
  [/\bcolores medidos(?: en la foto)?(?:\s*\([^)]*\))?/g, "colores"],
  [/\bmide (?=más|el |la )/g, "se ve "],
  [/\bno se modelan\b/g, "no van"],
  [/\bno se modela\b/g, "no va"],
  [/\bel motor\b/g, "el Taller 3D"],
  [/\bdel motor\b/g, "del Taller 3D"],
  [/\bde la tabla\b/g, "de la gama Sempertex"],
];

/** Una frase que quedó empezando por «medidos» (después de quitar «la idea no publica productos»): son los colores. */
const COLORES_SIN_ROTULO = /(^|[.;]\s+)medidos\b/g;

/** Las frases (separadas por «;» o por un punto) que no son de cliente se quitan; lo demás se une como estaba. */
function sinFrasesDeMedicion(texto: string): string {
  return texto
    .split(/(;\s+|(?<=\.)\s+(?=[A-ZÁÉÍÓÚÑ¿«]))/)
    .reduce<string[]>((salida, trozo, i, trozos) => {
      if (i % 2 === 1) return salida;
      if (FRASE_DE_MEDICION.test(trozo)) return salida;
      return [...salida, trozo + (trozos[i + 1] ?? "")];
    }, [])
    .join("")
    .replace(/;\s*$/, ".");
}

function limpiarSeccion(texto: string): string {
  let limpio = sinParentesis(texto, MEDIDA_DE_FOTO);
  limpio = sinTonosMedidos(limpio);
  for (const [patron, reemplazo] of EN_LENGUAJE_DE_CLIENTE) limpio = limpio.replace(patron, reemplazo);
  limpio = sinFrasesDeMedicion(limpio).replace(COLORES_SIN_ROTULO, "$1Colores");
  return limpio.replace(/\s+([,.;:])/g, "$1").replace(/\s{2,}/g, " ").replace(/^[;:,\s]+/, "").trim();
}

/**
 * La nota de una ficha con palabras de cliente: una línea «Lleva: …» y otra «Respecto a la foto: …». Un texto que no es una nota
 * de pieza (una descripción de catálogo, una referencia del dueño) pasa igual, salvo las cuentas de medición que pudiera traer.
 */
export function descripcionParaCliente(nota: string): string {
  const partes: Array<{ encabezado: string; texto: string }> = [];
  const marcas = [...nota.matchAll(MARCA_SECCION)];
  if (marcas.length === 0) return limpiarSeccion(nota);
  const antes = nota.slice(0, marcas[0]!.index!).trim();
  if (antes) partes.push({ encabezado: "", texto: antes });
  marcas.forEach((m, i) => {
    const desde = m.index! + m[0].length;
    const hasta = marcas[i + 1]?.index ?? nota.length;
    partes.push({ encabezado: ENCABEZADO[m[2]!]!, texto: nota.slice(desde, hasta).trim() });
  });
  return partes
    .map((p) => ({ ...p, texto: limpiarSeccion(p.texto) }))
    .filter((p) => p.texto.length > 0)
    .map((p) => (p.encabezado ? `${p.encabezado}: ${p.texto}` : p.texto))
    .map((linea) => (/[.!?»)]$/.test(linea) ? linea : `${linea}.`))
    .join("\n");
}
