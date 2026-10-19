import { colorDeCompraSinVenta } from "@/lib/rag/catalog/similitud-color";
import { clasificarColores, plegarTexto } from "@/lib/rag/taxonomy/v2";
import { coloresNombradosReferencia } from "./colores-referencia";

/**
 * Colores de la foto que el plan confirmado NO compra (comparador clásica-guiada, 2026-10-06: la guiada decía «Veo dos
 * columnas en plata cromado, blanco perlado, rosa pastel y transparente» y su plan salía sin transparente; con la foto
 * 07 se perdía el vino). Determinista y sobre el plan mismo, sin volver a la lectura:
 *
 * - Lo que cada pieza DEBE llevar es `colores_referencia`, que el servidor copia en cada estructura que materializa
 *   un elemento de la foto (`aplicarColoresReferencia`: los colores que la lectura nombró en ese elemento, en el
 *   vocabulario del catálogo y con el mismo tope que usa el plan, `coloresDominantesReferencia`).
 * - Lo que lleva son los colores de sus líneas resueltas por Python (`estructuras[].lineas[].color`, unidades > 0).
 *   Un color que el catálogo no vende cuenta como cubierto por el que lo representa («gris» por «plateado»).
 *
 * `soloEstos`: con colores que eligió el cliente («Otros colores», una idea agregada) solo se exigen los de la foto que
 * siguen en esa lista; los demás los quitó él. Puro e importable desde el navegador.
 */

export type ColorFotoFaltante = {
  color: string;
  /** Piezas que materializan un elemento de la foto con ese color y no lo llevan. */
  piezas: Array<{ estructura_id: string; nombre: string }>;
  /** Con qué se armaron, según la sustitución que anotó el resolutor («plateado, blanco, rosado»), si la hay. */
  entregado?: string;
};

type PlanLeido = {
  plan?: { estructuras?: ReadonlyArray<{ estructura_id?: unknown; nombre?: unknown; colores_referencia?: unknown }> };
  estructuras?: ReadonlyArray<{ estructura_id?: unknown; lineas?: ReadonlyArray<{ color?: unknown; unidades?: unknown }> }>;
  sustituciones?: ReadonlyArray<{ estructura_id?: unknown; pedido?: unknown; entregado?: unknown }>;
};

/** El color en el vocabulario del catálogo («vino» → «burdeos», «Plata» → «plateado»), plegado. */
function canonico(color: string): string {
  const plegado = plegarTexto(color);
  const clase = clasificarColores(plegado).values[0];
  return clase ? plegarTexto(clase) : plegado;
}

function textos(valor: unknown): string[] {
  return Array.isArray(valor) ? valor.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

export function coloresFotoFaltantes(plan: unknown, opciones: { soloEstos?: readonly string[] } = {}): ColorFotoFaltante[] {
  if (!plan || typeof plan !== "object") return [];
  const leido = plan as PlanLeido;
  const permitidos = opciones.soloEstos
    ? new Set(opciones.soloEstos.flatMap((color) => [canonico(color), ...coloresNombradosReferencia([color]).map((item) => canonico(item.color))]))
    : null;
  const faltantes = new Map<string, ColorFotoFaltante>();
  for (const estructura of leido.plan?.estructuras ?? []) {
    if (typeof estructura.estructura_id !== "string") continue;
    const pedidos = textos(estructura.colores_referencia);
    if (!pedidos.length) continue;
    const lineas = leido.estructuras?.find((resuelta) => resuelta.estructura_id === estructura.estructura_id)?.lineas ?? [];
    const lleva = new Set(lineas
      .filter((linea) => typeof linea.color === "string" && (typeof linea.unidades !== "number" || linea.unidades > 0))
      .map((linea) => canonico(linea.color as string)));
    // Sin líneas resueltas no hay con qué comparar: no se acusa a la pieza de nada.
    if (!lleva.size) continue;
    for (const pedido of pedidos) {
      const color = canonico(pedido);
      const representante = colorDeCompraSinVenta(pedido);
      if (lleva.has(color) || (representante && lleva.has(canonico(representante)))) continue;
      if (permitidos && !permitidos.has(color)) continue;
      const nombre = typeof estructura.nombre === "string" && estructura.nombre.trim() ? estructura.nombre.trim() : estructura.estructura_id;
      const sustitucion = (leido.sustituciones ?? []).find((item) => item.estructura_id === estructura.estructura_id && typeof item.pedido === "string" && canonico(item.pedido) === color);
      const actual = faltantes.get(color) ?? { color: plegarTexto(pedido), piezas: [] };
      actual.piezas.push({ estructura_id: estructura.estructura_id, nombre });
      if (!actual.entregado && typeof sustitucion?.entregado === "string" && sustitucion.entregado.trim()) actual.entregado = sustitucion.entregado.trim();
      faltantes.set(color, actual);
    }
  }
  return [...faltantes.values()];
}

function lista(items: readonly string[]): string {
  return items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} y ${items.at(-1)}`;
}

/**
 * La frase de la tarjeta cuando, después del reintento, el plan sigue sin un color de la foto: «No encontré globo
 * transparente que sirviera para Columna izquierda y Columna derecha; en su lugar usé plateado, blanco y rosado.».
 * Null si no falta ninguno.
 */
export function avisoColoresFoto(plan: unknown, opciones: { soloEstos?: readonly string[] } = {}): string | null {
  const faltantes = coloresFotoFaltantes(plan, opciones);
  if (!faltantes.length) return null;
  return faltantes.map((faltante) => {
    const entregado = faltante.entregado ? lista(faltante.entregado.split(/\s*,\s*/).filter(Boolean)) : "";
    return `No encontré globo ${faltante.color} que sirviera para ${lista(faltante.piezas.map((pieza) => pieza.nombre))}${entregado ? `; en su lugar usé ${entregado}` : ""}.`;
  }).join(" ");
}
