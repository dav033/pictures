import type { PlanDecoracion } from "./tipos";

/**
 * Number figures must spell the number the customer asked for (E2E 2026-09-15,
 * D4): for "los 40 de mi esposo" the plan bought the foil balloons "Número 0"
 * and "Número 1" instead of 4 and 0.
 *
 * Rule:
 * - A requested number is a 1–3 digit number the customer attaches to the
 *   celebration: "los 40", "mis 15", "sus 60", "cumple 5", "número 30", "40
 *   años". A number followed by anything else ("30 personas", "2 arcos", "50
 *   mil") is not one.
 * - A number figure is a catalog foil/number balloon whose title names one digit
 *   ("Globo Metalizado Numero 4 Plata"). Printed latex balloons that mention a
 *   number ("2 Caras Numero 40") are not figures.
 * - Every structure with number figures must carry exactly the digits of one
 *   requested number (as a set: "44" needs the 4). Structures without figures,
 *   or a request without a number, are not checked.
 * Pure: the catalog titles and categories come from this turn's search.
 */

const NORMALIZAR = (texto: string) => texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** What may follow a celebration number: end, punctuation or a connector — never a noun such as "personas". */
const DESPUES_DE_NUMERO = "(?=\\s*(?:$|[.,;:!?)]|(?:de|del|anos|anitos|para|y|e|en|con|que|el|la|este|esta|mi|su|sus|ya|pero)\\b))";
const NUMERO_CELEBRACION = new RegExp(
  `\\b(?:los|las|sus|mis|tus|nuestros|cumple|cumplen|cumplir|cumplira|cumpleanos|numero|numeros|edad)\\s+(\\d{1,3})${DESPUES_DE_NUMERO}`
  + `|\\b(\\d{1,3})\\s*(?:anos|anitos|abriles|primaveras)\\b`,
  "g",
);

export function numerosPedidos(texto: string): string[] {
  const numeros: string[] = [];
  for (const coincidencia of NORMALIZAR(texto).matchAll(NUMERO_CELEBRACION)) {
    const numero = String(Number(coincidencia[1] ?? coincidencia[2]));
    if (numero !== "0" && !numeros.includes(numero)) numeros.push(numero);
  }
  return numeros;
}

const CATEGORIAS_FIGURA_NUMERO = new Set(["globo_metalizado", "globo_numero_letra"]);
const DIGITO_EN_TITULO = /\bnumero\s+(\d)(?!\d)/;

/** The digit of a number figure, or null when the product is not one. */
export function digitoDeFiguraNumero(producto: { titulo: string; categoria: string | null } | undefined): string | null {
  if (!producto?.categoria || !CATEGORIAS_FIGURA_NUMERO.has(producto.categoria)) return null;
  return DIGITO_EN_TITULO.exec(NORMALIZAR(producto.titulo))?.[1] ?? null;
}

function unir(valores: readonly string[]): string {
  return valores.length <= 1 ? (valores[0] ?? "") : `${valores.slice(0, -1).join(", ")} y ${valores.at(-1)}`;
}

/** Customer-facing errors (no ids or codes), one per structure whose figures spell another number. */
export function validarNumerosPedidos(
  plan: Pick<PlanDecoracion, "estructuras">,
  productos: ReadonlyMap<string, { titulo: string; categoria: string | null }>,
  numeros: readonly string[],
): string[] {
  if (numeros.length === 0) return [];
  const errores: string[] = [];
  for (const estructura of plan.estructuras) {
    const digitos = [...new Set(estructura.materiales.map((material) => digitoDeFiguraNumero(productos.get(material.product_id))).filter((digito): digito is string => digito !== null))];
    if (digitos.length === 0) continue;
    const coincide = numeros.some((numero) => {
      const esperados = new Set(numero.split(""));
      return esperados.size === digitos.length && digitos.every((digito) => esperados.has(digito));
    });
    if (coincide) continue;
    const pedido = numeros[0]!;
    const esperados = [...new Set(pedido.split(""))];
    errores.push(`Pediste el número ${pedido} y los globos de número de la propuesta son ${unir(digitos.sort())}: deben ser ${unir(esperados)}.`);
  }
  return [...new Set(errores)];
}
