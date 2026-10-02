import { MAX_CANTIDAD, MAX_COP, MAX_UTILIDAD_PORCENTAJE } from "./profesional";

/**
 * Cómo se lee lo que escribe quien cotiza en los campos numéricos del precio al
 * cliente, y qué se le dice cuando no se puede leer. Aquí no se calcula nada:
 * solo se convierte texto en un número (o se explica por qué no se pudo) para
 * que Python reciba valores ya válidos. Los topes son los del modelo de Python
 * (`profesional.ts`): se explican, no se cambian. Sin React.
 *
 * Reglas de lectura (las de siempre; este módulo no las cambia):
 * - Pesos: enteros. El punto separa los miles ("12.500"); no hay decimales.
 * - Cantidad y ganancia: hasta dos decimales, con coma o con punto.
 */

const MILES = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 });
const PESOS = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });

/** Pesos enteros como se escriben en Colombia: "12.000", "$ 12.000" o "12000". Los decimales no existen en COP. */
export function leerPesos(texto: string): number | null {
  const limpio = texto.replace(/[\s$.]/g, "");
  if (!/^\d+$/.test(limpio)) return null;
  const valor = Number(limpio);
  return Number.isSafeInteger(valor) && valor <= MAX_COP ? valor : null;
}

/**
 * Lo escrito con los miles separados, como se ve un precio en Colombia:
 * "1000" -> "1.000". Es SOLO estetico: `leerPesos` quita los puntos, asi que el
 * valor que se envia a Python sigue siendo 1000. Descarta todo lo que no sea
 * digito (el "$" que alguien pegue, espacios), y una cadena sin digitos vuelve
 * vacia para poder borrar el campo.
 */
export function formatearPesos(texto: string): string {
  const digitos = texto.replace(/\D/g, "");
  if (!digitos) return "";
  // Sin ceros a la izquierda: "007" se escribe "7", no "007".
  const limpio = digitos.replace(/^0+(?=\d)/, "");
  return limpio.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/**
 * Lo que queda escrito en un campo de pesos tras una tecla.
 *
 * Como `formatearPesos`, salvo un caso: una coma seguida de cero, uno o dos
 * dígitos al final ("12,", "12,5", "12,50"). Eso es alguien escribiendo
 * decimales, y esos no existen en pesos. Tirar la coma en silencio convertía
 * "12,5" en 125 sin avisar (diez veces más de lo escrito), así que el texto se
 * deja tal cual: `leerPesos` no lo lee y el campo explica por qué. Con tres
 * dígitos tras la coma ("40,000") es la coma de miles de otro país y se
 * formatea como siempre ("40.000"). Al borrar no se aplica: borrar un dígito
 * de "1.000" deja "1.00", que no es un decimal sino un número a reformatear.
 */
export function escrituraPesos(escrito: string, borrando: boolean): string {
  if (!borrando && /^[\s$]*\d[\d.\s]*,\d{0,2}\s*$/.test(escrito)) return escrito;
  return formatearPesos(escrito);
}

/**
 * Donde dejar el cursor despues de reformatear: al final del digito numero
 * `digitos` del texto ya formateado. Sin esto el cursor salta al final y
 * corregir una cifra en medio es imposible.
 */
export function posicionTrasDigitos(texto: string, digitos: number): number {
  if (digitos <= 0) return 0;
  let vistos = 0;
  for (let i = 0; i < texto.length; i += 1) {
    if (/\d/.test(texto[i]!)) {
      vistos += 1;
      if (vistos === digitos) return i + 1;
    }
  }
  return texto.length;
}

/** Hasta dos decimales, con coma o punto: "2", "1,5", "0.25". */
function leerDecimal(texto: string, maximo: number): number | null {
  const limpio = texto.trim().replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(limpio)) return null;
  const valor = Number(limpio);
  return valor <= maximo ? valor : null;
}

export function leerCantidad(texto: string): number | null {
  const valor = leerDecimal(texto, MAX_CANTIDAD);
  return valor !== null && valor > 0 ? valor : null;
}

export function leerPorcentaje(texto: string): number | null {
  return leerDecimal(texto.replace("%", ""), MAX_UTILIDAD_PORCENTAJE);
}

/** El número que alguien intentó escribir, si es uno ("1,234" -> 1.234), para saber qué tiene de malo. */
function numeroIntentado(texto: string): { valor: number; decimales: number } | null {
  const limpio = texto.trim().replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(limpio)) return null;
  return { valor: Number(limpio), decimales: limpio.split(".")[1]?.length ?? 0 };
}

/**
 * Por qué un valor en pesos no se puede leer, en lenguaje de persona y con el
 * ejemplo de qué escribir; `null` si se lee. `vacio` es lo que se dice cuando
 * el campo está en blanco (cambia según el campo).
 */
export function errorDePesos(texto: string, vacio: string): string | null {
  if (leerPesos(texto) !== null) return null;
  if (!texto.trim()) return vacio;
  if (/^[\s$]*\d[\d.\s]*,\d{0,2}\s*$/.test(texto)) return "El peso no lleva decimales: escribe 13, no 12,5. El punto separa los miles (12.500).";
  if (/^[\s$]*\d{1,3}(,\d{3})+\s*$/.test(texto)) return "Para los miles usa punto: 40.000, no 40,000.";
  if (texto.includes("-")) return "No puede ser negativo.";
  const digitos = texto.replace(/[\s$.]/g, "");
  if (/^\d+$/.test(digitos)) return `Es demasiado grande: el máximo es $ ${MILES.format(MAX_COP)}.`;
  return "Escribe solo cifras en pesos, por ejemplo 12.500.";
}

/** Por qué una cantidad no se puede leer (en blanco incluido); `null` si se lee. */
export function errorDeCantidad(texto: string): string | null {
  if (leerCantidad(texto) !== null) return null;
  if (!texto.trim()) return "Escribe cuántas unidades, por ejemplo 2 o 1,5.";
  if (texto.includes("-")) return "No puede ser negativa.";
  if (/^\d{1,3}(\.\d{3})+$/.test(texto.trim())) return "Aquí el punto separa decimales, no miles: para 12.500 escribe 12500.";
  const intento = numeroIntentado(texto);
  if (intento) {
    if (intento.decimales > 2) return "Usa hasta 2 decimales, por ejemplo 1,25.";
    if (intento.valor === 0) return "La cantidad debe ser mayor que 0.";
    if (intento.valor > MAX_CANTIDAD) return `El máximo es ${MILES.format(MAX_CANTIDAD)}.`;
  }
  return "Escribe un número, por ejemplo 2 o 1,5.";
}

/** Por qué la ganancia escrita no se puede leer; `null` si se lee o está en blanco (en blanco es «sin ganancia»). */
export function errorDeGanancia(texto: string): string | null {
  if (!texto.trim() || leerPorcentaje(texto) !== null) return null;
  if (texto.includes("-")) return "No puede ser negativa.";
  const intento = numeroIntentado(texto.replace("%", ""));
  if (intento) {
    if (intento.decimales > 2) return "Usa hasta 2 decimales, por ejemplo 12,5.";
    if (intento.valor > MAX_UTILIDAD_PORCENTAJE) return `No puede pasar de ${MILES.format(MAX_UTILIDAD_PORCENTAJE)} %.`;
  }
  return "Escribe un porcentaje, por ejemplo 30 o 12,5.";
}

/**
 * Lo que se entendió de un valor en pesos, para decírselo a quien lo escribió:
 * «= $ 125». Solo refleja `leerPesos` (no lee nada por su cuenta) y solo habla
 * cuando sirve: si no se pudo leer (ahí habla el mensaje de error), o si lo
 * escrito no traía ningún punto ni coma (los miles se separan solos: "1000" ya
 * se ve "1.000"), o si ya se ve igual que el valor ("13", "12.500", "$ 40.000"),
 * calla.
 *
 * `crudo` es lo que tecleó la persona (con sus puntos y comas) y `formateado`
 * lo que quedó en el campo tras `escrituraPesos`: «12.5» queda «125» y aquí se
 * dice «= $ 125», que es justo la sorpresa que había que mostrar.
 */
export function ecoDePesos(crudo: string, formateado: string): string | null {
  const valor = leerPesos(formateado);
  if (valor === null) return null;
  const visto = crudo.replace(/[\s$]/g, "");
  if (visto === formateado || !/[.,]/.test(visto)) return null;
  return `= ${PESOS.format(valor)}`;
}

/** Porcentajes de ganancia que se ofrecen como atajo; no son un valor por defecto: el campo empieza vacío. */
export const FICHAS_GANANCIA: readonly number[] = [20, 30, 40];

/** La ficha que coincide con lo escrito en el campo de ganancia, o `null` (vacío, otro valor o ilegible). */
export function fichaActiva(texto: string): number | null {
  const valor = leerPorcentaje(texto);
  return valor !== null && FICHAS_GANANCIA.includes(valor) ? valor : null;
}
