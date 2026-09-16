/**
 * Lo que sobrevive en TypeScript del motor geométrico tras el paso 5 del
 * ADR-0023: la tabla de mezclas y el parseo de los tamaños obligatorios.
 *
 * Nada de esto cuenta globos. El conteo, el despiece y las medidas son de
 * `services/ai-api/app/plan.py`, que es el único dueño. Aquí quedan dos
 * comprobaciones de conversación, que ocurren ANTES de resolver y sirven para
 * que el modelo corrija el plan por sí mismo en vez de que el resolutor lo
 * rechace:
 *
 * - `mezclasCompatiblesConDiametros`, que le dice al modelo qué mezclas puede
 *   cubrir un producto con los diámetros que tiene en el catálogo;
 * - `tamanosObligatorios`, para avisar de que lo que falta de cubrir es
 *   justamente el tamaño que pidió el cliente.
 *
 * DEUDA CONOCIDA, con condición de retirada. Tres cosas de aquí siguen
 * existiendo también en `plan.py`:
 *
 * - la tabla `MEZCLAS` (`_MIXES`);
 * - el regex `TAMANO_OBLIGATORIO` (`_MANDATORY_SIZE`);
 * - y `sustitucionAdmisible` con `DIAMETROS_ESTANDAR` (`_admissible_substitution`,
 *   `_DIAMETROS_ESTANDAR`), que es la más delicada de las tres porque no es una
 *   tabla sino una regla ejecutable, y decide qué se puede vender: de ella sale
 *   `mezclas_compatibles`, que es lo que el modelo usa para elegir producto. Si
 *   Python cambiara el tope de 1.5 y esto no, el chat le prometería al cliente
 *   mezclas que el resolutor rechaza después, en bucle.
 *
 * La salida limpia es exportarlas al contrato `plan-decoracion.v1` como ya se
 * hace con `x-geometria-estructuras-oficiales`, que Python lee desde ahí, y que
 * este módulo lea del mismo sitio. Hasta entonces, cualquier cambio hay que
 * hacerlo en los dos lados.
 */

export type Mezcla = "clasica" | "organica_fina" | "organica_gruesa" | "solo_grandes";

/** Una línea del despiece de una estructura, tal como la devuelve el resolutor. */
export type LineaDespiece = { tamano: string; pulgadas: number; cantidad: number; color?: string };

type ProporcionTamano = { pulgadas: number; proporcion: number };

/**
 * "organica_fina" refleja un orgánico de referencia de cobertura media: R-12
 * domina el volumen, R-5/R-9 llenan huecos y R-18/R-24 son acentos visibles.
 * Las demás son variaciones razonables que requieren su propia calibración.
 */
const MEZCLAS: Record<Mezcla, ProporcionTamano[]> = {
  clasica: [{ pulgadas: 12, proporcion: 1 }],
  organica_fina: [
    { pulgadas: 5, proporcion: 0.21 },
    { pulgadas: 9, proporcion: 0.18 },
    { pulgadas: 12, proporcion: 0.54 },
    { pulgadas: 18, proporcion: 0.05 },
    { pulgadas: 24, proporcion: 0.02 },
  ],
  organica_gruesa: [
    { pulgadas: 9, proporcion: 0.25 },
    { pulgadas: 12, proporcion: 0.45 },
    { pulgadas: 18, proporcion: 0.2 },
    { pulgadas: 24, proporcion: 0.1 },
  ],
  solo_grandes: [
    { pulgadas: 18, proporcion: 0.6 },
    { pulgadas: 24, proporcion: 0.4 },
  ],
};

export const MEZCLAS_DISPONIBLES = Object.keys(MEZCLAS) as Mezcla[];

/** Diámetros (pulgadas) que pide cada mezcla, de menor a mayor. */
export function pulgadasDeMezcla(mezcla: Mezcla): number[] {
  return MEZCLAS[mezcla].map((tamano) => tamano.pulgadas);
}

const DIAMETROS_ESTANDAR = [5, 9, 12, 18, 24] as const;

/**
 * Un tamaño se puede servir con el escalón contiguo si no crece más de la mitad.
 * Sin ese tope, un R-5 que no existía se sustituía por un R-24 y convertía una
 * columna corriente en 29 paquetes de globos gigantes.
 */
function sustitucionAdmisible(pedido: number, disponible: number): boolean {
  if (pedido === disponible) return true;
  const pedidoIndex = DIAMETROS_ESTANDAR.indexOf(pedido as (typeof DIAMETROS_ESTANDAR)[number]);
  const disponibleIndex = DIAMETROS_ESTANDAR.indexOf(disponible as (typeof DIAMETROS_ESTANDAR)[number]);
  if (pedidoIndex < 0 || disponibleIndex < 0 || Math.abs(pedidoIndex - disponibleIndex) !== 1) return false;
  return Math.max(pedido, disponible) / Math.min(pedido, disponible) <= 1.5;
}

/**
 * Mezclas que un producto puede cubrir con sus diámetros redondos disponibles,
 * aplicando la misma sustitución admisible que usa la resolución. Sirve para
 * que el modelo elija una mezcla que el catálogo real puede servir: en el
 * catálogo local solo el 18 % de los productos redondos cubre `organica_fina`.
 */
export function mezclasCompatiblesConDiametros(diametros: readonly number[]): Mezcla[] {
  return MEZCLAS_DISPONIBLES.filter((mezcla) =>
    pulgadasDeMezcla(mezcla).every((pedido) => diametros.some((disponible) => sustitucionAdmisible(pedido, disponible))),
  );
}

/**
 * `restricciones.tamanos[].valor` es texto libre del modelo: solo se acepta un
 * entero positivo de hasta tres cifras, con "R-", "R" o sin prefijo ("R-12",
 * "R12", "12"), que es lo único que emite el extractor determinista
 * (`restricciones.ts`). Los espacios ASCII se toleran a los lados porque el
 * esquema Python no recorta el valor como sí hace zod. Lo que no encaja se
 * ignora: no se redondea ni se rechaza el plan.
 */
const TAMANO_OBLIGATORIO = /^[ \t\n\r\f\v]*R?-?(\d{1,3})[ \t\n\r\f\v]*$/i;

/** Pulgadas que el cliente hizo obligatorias, de menor a mayor y sin repetir. */
export function tamanosObligatorios(
  restricciones?: { tamanos?: readonly { valor: string; polaridad?: string }[] } | null,
): number[] {
  const pulgadas = new Set<number>();
  for (const tamano of restricciones?.tamanos ?? []) {
    if ((tamano.polaridad ?? "obligatorio") !== "obligatorio") continue;
    const encontrado = TAMANO_OBLIGATORIO.exec(tamano.valor);
    if (!encontrado) continue;
    const valor = Number(encontrado[1]);
    if (valor > 0) pulgadas.add(valor);
  }
  return [...pulgadas].sort((a, b) => a - b);
}

/**
 * Prefijo con el que el resolutor marca sus advertencias de puerta física
 * dentro de `advertencias` (ADR-0023 paso 4, espejo de `PHYSICAL_GATE_PREFIX`
 * en `services/ai-api/app/plan.py`). El resto de advertencias del plan son
 * avisos que no bloquean (ADR-0022): estas sí, y por eso van marcadas. Python
 * es dueño de la medición; Next, de la política de bloqueo.
 */
export const PREFIJO_PUERTA_FISICA = "puerta_fisica:";

/** Advertencias de puerta física de un plan ya resuelto, sin el prefijo. */
export function advertenciasPuertaFisica(advertencias: readonly string[]): string[] {
  return advertencias
    .filter((aviso) => aviso.startsWith(PREFIJO_PUERTA_FISICA))
    .map((aviso) => aviso.slice(PREFIJO_PUERTA_FISICA.length));
}
