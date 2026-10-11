import { coloresRealesVariante } from "@/lib/plan/colores-producto";
import type { FilaCatalogo } from "./crosswalk-variantes";

/**
 * **«El mismo globo» de las presentaciones del catálogo** (D-038): qué otros paquetes de la tienda son del mismo globo que una variante.
 * Es la regla de `mismo_globo` de Python (`services/ai-api/app/presentaciones.py`, revisión 3) sobre lo que `_candidate` de
 * `services/ai-api/app/plan.py` saca de cada fila del catálogo, atributo por atributo:
 * - mismo producto;
 * - código de talla: el texto sin espacios de los bordes, o ninguno si queda vacío (`_text`);
 * - diámetro: un número, y uno negativo es ninguno;
 * - forma: igual que la talla (`_text`);
 * - colores de la variante (`_variant_real_colors`): los suyos —sin tildes, en minúscula y sin repetir— y, si no tiene, los del producto;
 *   un título que dice «gris» y no «plata» cambia «plateado» por «gris»; uno con un tono de vino cambia «rojo» por «burdeos»
 *   (`coloresRealesVariante`, la copia de esa regla con su vector de paridad en `contracts/domain/v1/golden/plan-resolution/`).
 * Igualdad de cada atributo, sin tallas ni formas «cercanas». Los vectores de esta regla, sacados del código de Python, están en
 * `contracts/domain/v1/golden/mismo-globo/vectores.json` y los ata `test-cotizar-curada`.
 * Diferencia a propósito: aquí la variante pedida puede no estar a la venta (una lista curada con un paquete que ya no se vende) y
 * aun así se compra de los demás paquetes de su globo; Python parte de una variante vendible. Puro: sin red ni base.
 */
export type FilaDePresentaciones = FilaCatalogo & { pedida: string };

/** Una fila de la consulta de presentaciones: cada variante del producto de una variante pedida, con lo que decide si es del mismo globo. */
export type FilaCrudaDePresentaciones = {
  pedida: string;
  snapshot: string;
  productId: string;
  tituloProducto: string;
  coloresProducto: readonly string[];
  variantId: string;
  tituloVariante: string | null;
  codigoTamano: string | null;
  forma: string | null;
  diamPulg: number | null;
  coloresVariante: readonly string[];
  unidadesPaq: number | null;
  precio: number | null;
  /** A la venta como la cotiza Python: disponible, en COP, con precio y paquete. */
  vendible: boolean;
};

const texto = (valor: string | null): string | null => {
  const recortado = (valor ?? "").trim();
  return recortado || null;
};

const diametro = (valor: number | null): number | null => (valor !== null && Number.isFinite(valor) && valor >= 0 ? valor : null);

/** Lo que distingue un globo de otro entre las variantes de un producto. */
export function claveDelGlobo(fila: FilaCrudaDePresentaciones): string {
  return JSON.stringify([
    fila.productId, texto(fila.codigoTamano), diametro(fila.diamPulg), texto(fila.forma),
    coloresRealesVariante(texto(fila.tituloProducto), fila.coloresVariante, fila.coloresProducto),
  ]);
}

/** Por cada variante pedida, los paquetes vendibles de su mismo globo (ella incluida si se vende), de menor a mayor id de variante. */
export function presentacionesDelMismoGlobo(filas: readonly FilaCrudaDePresentaciones[]): FilaDePresentaciones[] {
  const porPedida = new Map<string, FilaCrudaDePresentaciones[]>();
  for (const fila of filas) porPedida.set(fila.pedida, [...(porPedida.get(fila.pedida) ?? []), fila]);
  const salida: FilaDePresentaciones[] = [];
  for (const [pedida, delProducto] of porPedida) {
    const referencia = delProducto.find((fila) => fila.variantId === pedida);
    if (!referencia) continue;
    const clave = claveDelGlobo(referencia);
    const hermanas = delProducto.filter((fila) => fila.vendible && fila.unidadesPaq !== null && fila.unidadesPaq > 0 && fila.precio !== null && fila.precio > 0 && claveDelGlobo(fila) === clave);
    for (const fila of hermanas.sort((a, b) => (a.variantId < b.variantId ? -1 : a.variantId > b.variantId ? 1 : 0))) {
      salida.push({
        pedida, snapshot: fila.snapshot, productId: fila.productId, tituloProducto: fila.tituloProducto, variantId: fila.variantId, tituloVariante: fila.tituloVariante,
        codigoTamano: fila.codigoTamano, unidadesPaq: fila.unidadesPaq!, precio: fila.precio!, coloresDerivados: fila.coloresVariante.length ? [...fila.coloresVariante] : null,
      });
    }
  }
  return salida;
}
