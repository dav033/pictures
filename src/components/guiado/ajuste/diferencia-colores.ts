import { z } from "zod";
import { listaNatural } from "@/lib/ia/guiado/propuesta-composicion";
import { colorCliente } from "../formato";
import { formatoPesos } from "../precio-chat";
import { confirmacionDelCambio, globosEnTexto, piezaConArticulo, piezasAjustables, type CambioPlan, type PlanGuiado } from "./ajuste-plan-guiado";

/**
 * Lo que de verdad cambió al cambiar un color (juez 2026-10-11, D4). El navegador conserva la parte de cada color, pero
 * Python vuelve a contar la pieza y puede mover a los demás colores (36→33) y darle al nuevo otra cifra que la del que
 * reemplazó (11→20). Aquí se comparan los globos por color del plan de antes y del que firmó Python, para que el panel
 * «Cambiar» y el chat digan la misma diferencia real y nunca «quedaron igual» si alguna cifra se movió. Puro: sin red.
 */

type Reemplazo = Extract<CambioPlan, { tipo: "reemplazar-color" }>;

export type CambioDeColor = { color: string; antes: number; despues: number };

export type DiferenciaCambioColor = {
  /** El color que salió (en las piezas que cambiaron) y sus globos en el plan de antes. */
  anterior: { color: string; globos: number };
  /** El globo que entró y sus globos en el plan de Python. */
  nuevo: { color: string; globos: number; /** Los globos que ese color ya tenía en el plan de antes (0 si es un color nuevo). */ yaTenia: number; /** El cambio fue solo en algunas piezas: las cifras de este color son las de esas piezas. */ enAlgunasPiezas: boolean };
  /** Los demás colores cuya cifra se movió, en el orden del plan. */
  otros: CambioDeColor[];
  /** «en la columna derecha» si el color viejo sigue en otras piezas; null si cambió en todas. */
  donde: string | null;
};

export type UsoPrecio = "personal" | "negocio";

/**
 * Los precios de los materiales del plan de antes y del nuevo (las cotizaciones tal como llegan) y el uso con que el
 * cliente ve el precio: en el negocio no se dice una cifra personal (como `textoMaterialesDesde`).
 */
export type PreciosDelCambio = { antes?: unknown; despues?: unknown; uso?: UsoPrecio | null };

const TotalSchema = z.object({ total: z.number().int().positive(), incluyeIva: z.boolean().optional() }).passthrough();

function normal(texto: string | null | undefined): string {
  return (texto ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLocaleLowerCase("es");
}

type ColorContado = { estructuraId: string; color: string; productId: string; etiqueta: string; globos: number };

function coloresContados(plan: PlanGuiado): ColorContado[] {
  return piezasAjustables(plan).flatMap((pieza) => pieza.colores.map((color) => ({ estructuraId: pieza.estructuraId, color: color.color, productId: color.productId, etiqueta: color.etiqueta, globos: color.globos })));
}

/** Globos por color (con el nombre que ve el cliente) de los que no son el color que cambió. */
function porEtiqueta(colores: readonly ColorContado[]): Map<string, number> {
  const suma = new Map<string, number>();
  for (const color of colores) suma.set(color.etiqueta, (suma.get(color.etiqueta) ?? 0) + color.globos);
  return suma;
}

/**
 * La diferencia por color entre el plan de antes y el que resolvió Python. `piezasConColor`: las piezas que recibieron el
 * color nuevo (el servidor puede dejar alguna fuera); sin ellas, las del cambio o todas.
 */
export function diferenciaCambioColor(antes: PlanGuiado, despues: PlanGuiado, cambio: Reemplazo, piezasConColor?: readonly string[]): DiferenciaCambioColor {
  const piezas = piezasConColor?.length ? new Set(piezasConColor) : cambio.estructuraIds?.length ? new Set(cambio.estructuraIds) : null;
  const tocada = (color: ColorContado) => !piezas || piezas.has(color.estructuraId);
  const esNuevo = (color: ColorContado) => tocada(color) && color.productId === cambio.globo.productId && normal(color.color) === normal(cambio.globo.color);
  const esViejo = (color: ColorContado) => tocada(color) && normal(color.color) === normal(cambio.color) && (!cambio.productIdAnterior || color.productId === cambio.productIdAnterior) && !esNuevo(color);
  const deAntes = coloresContados(antes);
  const deDespues = coloresContados(despues);
  const viejos = deAntes.filter(esViejo);
  const etiquetasViejas = [...new Set(viejos.map((color) => color.etiqueta))];
  const otrosAntes = porEtiqueta(deAntes.filter((color) => !esViejo(color) && !esNuevo(color)));
  const otrosDespues = porEtiqueta(deDespues.filter((color) => !esNuevo(color)));
  const otros = [...new Set([...otrosAntes.keys(), ...otrosDespues.keys()])]
    .map((color) => ({ color, antes: otrosAntes.get(color) ?? 0, despues: otrosDespues.get(color) ?? 0 }))
    .filter((otro) => otro.antes !== otro.despues);
  const conElViejo = new Set(deDespues.filter((color) => normal(color.color) === normal(cambio.color) && (!cambio.productIdAnterior || color.productId === cambio.productIdAnterior)).map((color) => color.estructuraId));
  const cambiadas = antes.plan.estructuras.filter((estructura) => viejos.some((color) => color.estructuraId === estructura.estructura_id));
  return {
    anterior: { color: etiquetasViejas.length === 1 ? etiquetasViejas[0]!.toLocaleLowerCase("es") : colorCliente(cambio.color), globos: viejos.reduce((suma, color) => suma + color.globos, 0) },
    nuevo: { color: cambio.globo.nombre, globos: deDespues.filter(esNuevo).reduce((suma, color) => suma + color.globos, 0), yaTenia: deAntes.filter(esNuevo).reduce((suma, color) => suma + color.globos, 0), enAlgunasPiezas: piezas !== null },
    otros: otros.map((otro) => ({ ...otro, color: otro.color.toLocaleLowerCase("es") })),
    donde: conElViejo.size && cambiadas.length ? `en ${listaNatural(cambiadas.map(piezaConArticulo))}` : null,
  };
}

function textoPrecio(precios: PreciosDelCambio): string {
  if (precios.uso === "negocio") return "";
  const antes = TotalSchema.safeParse(precios.antes);
  const despues = TotalSchema.safeParse(precios.despues);
  if (!despues.success) return "";
  const materiales = `Los materiales (uso personal${despues.data.incluyeIva === false ? "" : ", con IVA"})`;
  const nuevo = formatoPesos(despues.data.total);
  if (!antes.success) return ` ${materiales} quedan en ${nuevo}.`;
  if (antes.data.total === despues.data.total) return ` ${materiales} siguen en ${nuevo}.`;
  return ` ${materiales} pasan de ${formatoPesos(antes.data.total)} a ${nuevo}.`;
}

/** «Listo: Fashion Naranja en lugar de verde lima…» con las cifras que quedaron; «igual» solo si no se movió ninguna. */
export function textoCambioColor(cambio: Reemplazo, diferencia: DiferenciaCambioColor, precios: PreciosDelCambio = {}): string {
  const { anterior, nuevo, otros } = diferencia;
  const mismaCifra = nuevo.globos === anterior.globos;
  const cabeza = `Listo: ${cambio.globo.nombre} en lugar de ${anterior.color}${diferencia.donde ? ` ${diferencia.donde}` : ""}; las medidas no cambiaron.`;
  const suma = nuevo.yaTenia + anterior.globos;
  const delNuevo = nuevo.yaTenia > 0
    ? `${nuevo.color} ya tenía ${globosEnTexto(nuevo.yaTenia)}${nuevo.enAlgunasPiezas ? " en esas piezas" : " en el plan"}; ahora lleva ${globosEnTexto(nuevo.globos)}, con los de ${anterior.color} (tenía ${anterior.globos.toLocaleString("es-CO")})${nuevo.globos === suma ? "" : `. Al volver a contar, la suma de ${suma.toLocaleString("es-CO")} quedó en ${nuevo.globos.toLocaleString("es-CO")}`}`
    : mismaCifra
    ? `${nuevo.color} lleva ${globosEnTexto(nuevo.globos)}, los mismos que tenía ${anterior.color}`
    : `${nuevo.color} lleva ${globosEnTexto(nuevo.globos)} (${anterior.color} tenía ${anterior.globos.toLocaleString("es-CO")})`;
  const resto = otros.length
    ? `. Al volver a contar cambiaron otros colores: ${listaNatural(otros.map((otro) => `${otro.color} ${otro.despues.toLocaleString("es-CO")} (antes ${otro.antes.toLocaleString("es-CO")})`))}.`
    : mismaCifra ? "; los demás colores quedaron igual." : "; los demás colores conservan sus globos.";
  return `${cabeza} ${delNuevo}${resto}${textoPrecio(precios)}`;
}

/**
 * La confirmación de un cambio hecho, la misma del panel «Cambiar» y del chat: con `nuevo` (el plan de Python), el
 * cambio de color dice su diferencia real y el precio; los demás cambios, la confirmación de siempre.
 */
export function confirmacionCambioHecho(base: PlanGuiado, cambio: CambioPlan, piezasConColor: readonly string[] | undefined, nuevo: PlanGuiado | undefined, precios: PreciosDelCambio = {}): string {
  if (cambio.tipo === "reemplazar-color" && nuevo) return textoCambioColor(cambio, diferenciaCambioColor(base, nuevo, cambio, piezasConColor), precios);
  return confirmacionDelCambio(base, cambio, piezasConColor, nuevo);
}
