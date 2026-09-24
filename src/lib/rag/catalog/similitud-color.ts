import { HEX_COLORES_OBSERVABLES, PALETA_COLORES_V2 } from "@/lib/rag/taxonomy/v2";

/**
 * Distancia perceptual entre colores del catálogo. Se exporta al contrato
 * `catalog-search.v1` como `x-tonos-colores-catalogo`
 * (`scripts/ops/export-domain-contract-schemas.ts`), el mismo patrón que
 * `estructuras-oficiales.ts` usa para `x-geometria-estructuras-oficiales`:
 * esta tabla es la única fuente, y `services/ai-api/app/catalog.py` la lee de
 * ahí para resolver un color que el snapshot activo no tiene al más cercano que
 * sí, en vez de dejarlo caer en silencio.
 *
 * MODELO. Antes esto era un ángulo de tono y nada más, y medía mal de dos
 * formas que costaban ventas:
 *
 * - Sin luminosidad ni saturación, `naranja` y `cafe` distaban 0,011 —
 *   indistinguibles—, `dorado` y `crema` 0,022, y `fucsia` y `rosado` 0,083.
 *   Un pedido de rosa palo podía resolverse a fucsia.
 * - Los colores sin tono (los neutros) empataban todos en 0,35 y el empate se
 *   rompía POR ORDEN ALFABÉTICO, así que `gris` resolvía a `negro` en vez de a
 *   `plateado`: una foto gris mate compraba globos negros.
 *
 * Ahora la distancia es ΔE (CIE76) sobre CIELAB, derivada de los hex nominales
 * de la paleta. Medido: naranja/cafe 51, dorado/crema 56, fucsia/rosado 48,
 * gris/negro 51 y gris/plateado 16 — el gris llega a plateado por un factor de
 * tres— mientras los pares de verdad parecidos siguen juntos (violeta/morado
 * 19). No hacen falta familias neutras: la luminosidad ya las separa.
 */

export type Lab = readonly [number, number, number];

/**
 * sRGB de 8 bits a CIELAB (D65). Se exporta porque la medición de dominancia
 * (`dominancia-color.ts`) clasifica píxeles contra `LAB_COLORES` y tiene que
 * usar exactamente esta conversión: con dos implementaciones, un píxel podría
 * caer en un color distinto del que le asigna la tabla y la medida dejaría de
 * ser comparable con la sustitución del catálogo.
 */
export function labDeRgb(rojo: number, verde: number, azul: number): Lab {
  const canales = [rojo, verde, azul]
    .map((valor) => valor / 255)
    .map((valor) => (valor > 0.04045 ? ((valor + 0.055) / 1.055) ** 2.4 : valor / 12.92));
  const [r, g, b] = canales as [number, number, number];
  // sRGB -> XYZ (D65) -> CIELAB.
  const x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047;
  const y = r * 0.2126 + g * 0.7152 + b * 0.0722;
  const z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
  const f = (t: number): number => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

function labDeHex(hex: string): Lab {
  const entero = Number.parseInt(hex.slice(1), 16);
  return labDeRgb((entero >> 16) & 255, (entero >> 8) & 255, entero & 255);
}

/** CIELAB de cada color medible. Incluye `gris`, que se observa aunque no se venda. */
export const LAB_COLORES: Readonly<Record<string, Lab>> = Object.fromEntries(
  Object.entries(HEX_COLORES_OBSERVABLES).map(([color, hex]) => [color, labDeHex(hex)]),
);

/**
 * ΔE por encima del cual no se sustituye nada: sustituir exige una distancia,
 * y sin ella la búsqueda debe reportar NO_MATCH honestamente en vez de ofrecer
 * cualquier cosa.
 *
 * El número sale de mirar los 300 pares de la paleta, no de la intuición. En la
 * franja que decide (38-50) están, por orden: burdeos→rojo 41, morado→lila 43,
 * rojo→naranja 44, rosado→fucsia 48, lila→violeta 49. Con 45 entran las que un
 * decorador aceptaría —el burdeos que el catálogo no vende cae en rojo, el
 * morado en lila— y queda fuera rosado→fucsia, que es justamente la patología
 * que el modelo de tono causaba: un rosa palo resuelto a fucsia. Admite 78 de
 * 300 pares; con 40 serían 59 y se perdería el burdeos, con 50 serían 88 y
 * volvería el fucsia.
 */
export const DELTA_E_MAXIMO = 45;

/**
 * Escala 0..1, para no romper a los consumidores que ordenaban con la escala
 * anterior (`plan-editar/route.ts` la usa para rankear alternativas). 0 es
 * idéntico; `PUNTUACION_DESCONOCIDA` marca "nada que medir".
 */
const ESCALA = 100;
export const PUNTUACION_DESCONOCIDA = DELTA_E_MAXIMO / ESCALA;

function normalizarColor(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
}

function deltaE(uno: Lab, otro: Lab): number {
  return Math.hypot(uno[0] - otro[0], uno[1] - otro[1], uno[2] - otro[2]);
}

/**
 * Cuanto más bajo, más cerca visualmente. Una coincidencia exacta da 0: antes
 * devolvía 1 —la peor nota—, así que las alternativas del mismo color de una
 * pieza (Reflex Rojo para un Fashion Rojo) quedaban detrás de cualquier otro
 * tono y se caían de las 12 que muestra la tarjeta.
 */
export function puntuacionCromatica(actuales: string[], candidatas: string[]): number {
  const base = actuales.map(normalizarColor).filter(Boolean);
  const opciones = candidatas.map(normalizarColor).filter(Boolean);
  if (!base.length || !opciones.length) return PUNTUACION_DESCONOCIDA;
  if (opciones.some((color) => base.includes(color))) return 0;

  const puntuaciones: number[] = [];
  for (const actual of base) {
    const labActual = LAB_COLORES[actual];
    if (!labActual) continue;
    for (const candidata of opciones) {
      const labCandidata = LAB_COLORES[candidata];
      if (labCandidata) puntuaciones.push(Math.min(deltaE(labActual, labCandidata) / ESCALA, 1));
    }
  }
  return puntuaciones.length ? Math.min(...puntuaciones) : PUNTUACION_DESCONOCIDA;
}

/** Forma de `x-tonos-colores-catalogo` en el contrato `catalog-search.v1` exportado. */
export type TonosColoresCatalogoContrato = {
  lab: Record<string, [number, number, number]>;
  delta_e_maximo: number;
  escala: number;
  /** Colores que la foto puede mostrar pero el catálogo no vende (hoy `gris`). */
  colores_sin_venta: string[];
};

/**
 * La tabla de distancia cromática como la extensión de JSON Schema que la
 * exportación del contrato inyecta en `catalog-search.v1`.
 * `services/ai-api/app/catalog.py` la lee con `contract_schema("CatalogSearch")`
 * para elegir, ante un color que el snapshot no tiene, el más cercano que sí.
 */
export function tonosColoresCatalogo(): TonosColoresCatalogoContrato {
  return {
    lab: Object.fromEntries(Object.entries(LAB_COLORES).map(([color, lab]) => [color, [...lab] as [number, number, number]])),
    delta_e_maximo: DELTA_E_MAXIMO,
    escala: ESCALA,
    colores_sin_venta: COLORES_SIN_VENTA,
  };
}

const PALETA_VENDIBLE: ReadonlySet<string> = new Set(PALETA_COLORES_V2);

/** Colores medibles que no están en la paleta del catálogo: se observan, no se compran. */
export const COLORES_SIN_VENTA: string[] = Object.keys(LAB_COLORES).filter((color) => !PALETA_VENDIBLE.has(color)).sort();

/**
 * El color del catálogo con el que se compra un color que la foto muestra y el
 * catálogo no vende (la foto dice `gris`, se compra `plateado`). `undefined`
 * cuando el color sí se vende —no necesita reemplazo— o cuando nada le queda
 * cerca. Una pieza que lleva este color no ha perdido el de la foto.
 */
export function colorDeCompraSinVenta(color: string): string | undefined {
  const normalizado = normalizarColor(color);
  if (!COLORES_SIN_VENTA.includes(normalizado)) return undefined;
  return colorCatalogoMasCercano(normalizado, PALETA_COLORES_V2);
}

/**
 * El color de `disponibles` más cercano a `pedido`, por el mismo ranking que
 * usa `puntuacionCromatica` (la coincidencia exacta gana; si no, la menor
 * distancia, con desempate alfabético solo para que el resultado sea
 * determinista). `undefined` cuando `disponibles` está vacío.
 *
 * Nada relacionado: el color pedido es una palabra que la tabla no conoce (el
 * analizador se inventa algunas, «frambuesa»), así que no puntúa contra nada y
 * ganaría el primero por orden alfabético. Así fue como una foto frambuesa
 * acabó resolviéndose a amarillo. Sustituir exige una distancia.
 */
export function colorCatalogoMasCercano(pedido: string, disponibles: readonly string[]): string | undefined {
  const normalizado = normalizarColor(pedido);
  const opciones = [...new Set(disponibles.map(normalizarColor).filter(Boolean))];
  if (!normalizado || opciones.length === 0) return undefined;
  if (opciones.includes(normalizado)) return normalizado;
  let mejor: string | undefined;
  let mejorPuntuacion = Infinity;
  for (const opcion of opciones) {
    const puntuacion = puntuacionCromatica([normalizado], [opcion]);
    if (puntuacion < mejorPuntuacion || (puntuacion === mejorPuntuacion && (mejor === undefined || opcion < mejor))) {
      mejorPuntuacion = puntuacion;
      mejor = opcion;
    }
  }
  return mejorPuntuacion >= PUNTUACION_DESCONOCIDA ? undefined : mejor;
}
