import type {
  ArmadoGuirnaldaResuelto,
  FormaGuirnalda,
  InsumoGuirnalda,
  PosicionRemateGuirnalda,
  SoporteGuirnalda,
  UnidadRacimoGuirnalda,
} from "@/lib/plan/armado-guirnalda";
import { ESTRUCTURAS_OFICIALES } from "@/lib/plan/estructuras-oficiales";
import type { LineaMaterial } from "@/lib/plan/resuelto";
import { colorDeCodigo } from "../bouquet/leyenda-bouquet";
import { leyendaPatron, type ColorLeyenda } from "../patron/leyenda";

/**
 * Textos y leyenda del armado de una guirnalda (ADR-0032): un número por
 * globo comprado (el `codigo` que Python dio a cada material y tamaño), con el
 * color que se compra y la descripción de Python ("R-12 blanco fashion"), y
 * los nombres en español de lo que el decorador elige. Solo presentación:
 * nada de aquí cuenta, arma ni valida; qué admite cada pieza lo dice Python.
 */

type ArmadoGuirnalda = ArmadoGuirnaldaResuelto["armado"];

function mayusculaInicial(texto: string): string {
  return texto ? `${texto.charAt(0).toUpperCase()}${texto.slice(1)}` : texto;
}

/**
 * Una entrada por código, en orden. La muestra de color sale de la leyenda de
 * los patrones (`leyendaPatron`, con el color y el acabado que Python dice que
 * se compran y el tono de la línea resuelta); el número y el nombre son los de Python.
 */
export function leyendaGuirnalda(resuelto: Pick<ArmadoGuirnaldaResuelto, "leyenda">, lineas: readonly LineaMaterial[] = []): ColorLeyenda[] {
  const entradas = [...resuelto.leyenda].sort((a, b) => a.codigo - b.codigo);
  const materiales = entradas.map((entrada) => ({
    product_id: entrada.product_id ?? "",
    ...(entrada.color ? { color: entrada.color } : {}),
    ...(entrada.acabado ? { acabado: entrada.acabado } : {}),
  }));
  return leyendaPatron(materiales, lineas).map((color, posicion) => {
    const entrada = entradas[posicion]!;
    const etiqueta = mayusculaInicial(entrada.descripcion);
    return { ...color, indice: entrada.material, numero: entrada.codigo, etiqueta, muestra: { ...color.muestra, etiqueta } };
  });
}

export { colorDeCodigo };

/** Lo que el editor MUESTRA de cada soporte; cuáles admite la pieza lo dice Python (`opciones.soportes`). */
export const NOMBRE_SOPORTE: Readonly<Record<SoporteGuirnalda, { nombre: string; ayuda: string }>> = {
  pared: { nombre: "En pared", ayuda: "Fijada a la pared con la tira y ganchos o pegante." },
  colgada: { nombre: "Colgada", ayuda: "Cuelga con cuerda de sus puntos de anclaje." },
  piso: { nombre: "En el piso", ayuda: "Apoyada en el piso, con pesas para que no se mueva." },
  mesa: { nombre: "Sobre la mesa", ayuda: "Recorre la mesa, sobre su borde o su centro." },
  sobre_estructura: { nombre: "Sobre otra pieza", ayuda: "Abrazada a otra pieza del plan, siguiendo su forma." },
};

export const NOMBRE_FORMA: Readonly<Record<FormaGuirnalda, string>> = {
  recta: "Recta",
  curva: "Curva",
  ondulada: "Ondulada",
  u_invertida: "U invertida",
  arco_caido: "Arco caído",
};

export const NOMBRE_UNIDAD: Readonly<Record<UnidadRacimoGuirnalda, { singular: string; plural: string }>> = {
  trio: { singular: "trío", plural: "tríos" },
  cuarteto: { singular: "cuarteto", plural: "cuartetos" },
  quinteto: { singular: "quinteto", plural: "quintetos" },
};

export const NOMBRE_POSICION: Readonly<Record<PosicionRemateGuirnalda, string>> = {
  extremo_izq: "Extremo izquierdo",
  extremo_der: "Extremo derecho",
  centro: "Al centro",
  cada_n: "A lo largo",
};

export const NOMBRE_INSUMO: Readonly<Record<InsumoGuirnalda, string>> = {
  tira: "Tira perforada",
  cuerda: "Cuerda",
  ganchos: "Ganchos",
  pegante: "Pegante",
  pesa: "Pesas",
  amarres: "Amarres",
  tijeras: "Tijeras",
  bomba: "Bomba infladora",
};

/**
 * Si la forma cuelga y lleva caída: lo dice la tabla de geometría del
 * contrato (`x-geometria-estructuras-oficiales`, dueño
 * `estructuras-oficiales.ts`), la misma que lee Python.
 */
export function formaConCaida(forma: FormaGuirnalda): boolean {
  return ESTRUCTURAS_OFICIALES.guirnalda.geometria?.formas?.[forma]?.conCaida === true;
}

const numero = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 2 });

/** "0,4 m". */
export function metros(valor: number): string {
  return `${numero.format(valor)} m`;
}

/** "1–1,75 h": la duración estimada que escribió Python. */
export function horas(duracion: ArmadoGuirnaldaResuelto["duracion_estimada"]): string {
  return duracion.horas_min === duracion.horas_max
    ? `${numero.format(duracion.horas_min)} h`
    : `${numero.format(duracion.horas_min)}–${numero.format(duracion.horas_max)} h`;
}

const SINGULAR: Readonly<Record<string, string>> = { ganchos: "gancho", pesas: "pesa", amarres: "amarre", puntos: "punto" };

/** "4 m de tira", "3 ganchos", "22 puntos de pegante", "tijeras": lo que Python escribió en cantidad y unidad. */
export function insumoTexto(insumo: ArmadoGuirnaldaResuelto["insumos"][number]): string {
  const unidad = insumo.cantidad === 1 ? SINGULAR[insumo.unidad] ?? insumo.unidad : insumo.unidad;
  const cantidad = `${numero.format(insumo.cantidad)} ${unidad}`;
  switch (insumo.insumo) {
    case "tira":
    case "cuerda":
      return `${cantidad} de ${insumo.insumo}`;
    case "pegante":
      return `${cantidad} de pegante`;
    case "tijeras":
    case "bomba":
      return NOMBRE_INSUMO[insumo.insumo].toLowerCase();
    default:
      return cantidad;
  }
}

/**
 * Resumen de una línea de lo que el armado necesita y no se cotiza, y cuánto
 * toma: "4 m de tira · ≈ 8,5 m de cuerda · 3 ganchos · … · armado ≈ 1–1,75 h".
 * Lo que Python marcó estimado lleva "≈"; la duración siempre lo es.
 */
export function resumenInsumosGuirnalda(insumos: ArmadoGuirnaldaResuelto["insumos"], duracion: ArmadoGuirnaldaResuelto["duracion_estimada"] | null): string {
  const partes = insumos.map((insumo) => `${insumo.estimado ? "≈ " : ""}${insumoTexto(insumo)}`);
  if (duracion) partes.push(`armado ≈ ${horas(duracion)}`);
  return partes.join(" · ");
}

/** "12 cuartetos de 12″". */
export function racimosTexto(armado: ArmadoGuirnalda, cantidad: number): string {
  const nombre = NOMBRE_UNIDAD[armado.racimo.unidad];
  return `${cantidad} ${cantidad === 1 ? nombre.singular : nombre.plural} de ${armado.racimo.tamano_pulg_base}″`;
}

/** "Ondulada", "Arco caído con 0,4 m de caída, 3 anclajes". */
export function formaTexto(armado: ArmadoGuirnalda): string {
  const caida = armado.caida_m !== undefined && formaConCaida(armado.forma) ? ` con ${metros(armado.caida_m)} de caída` : "";
  const anclajes = armado.puntos_de_anclaje !== undefined ? `, ${armado.puntos_de_anclaje} anclajes` : "";
  return `${NOMBRE_FORMA[armado.forma]}${caida}${anclajes}`;
}

/** "R-12 blanco fashion (3)": el nombre de un código para leer en voz alta o en la hoja. */
export function nombreCodigo(leyenda: readonly ColorLeyenda[], codigo: number): string {
  return `${colorDeCodigo(leyenda, codigo).etiqueta} (${codigo})`;
}

/**
 * Los racimos en orden de lectura, de izquierda a derecha, con lo que va
 * junto a cada uno (los remates que Python puso ahí): el texto alternativo
 * de la gráfica y la lista de la hoja. Solo junta lo que Python devolvió.
 */
export function racimosEnOrden(resuelto: Pick<ArmadoGuirnaldaResuelto, "racimos" | "remates">, leyenda: readonly ColorLeyenda[]): Array<{ numero: number; codigos: number[]; texto: string; remates: number[] }> {
  return [...resuelto.racimos].sort((a, b) => a.numero - b.numero).map((racimo) => {
    const remates = resuelto.remates.flatMap((remate) => remate.racimos.filter((numeroRacimo) => numeroRacimo === racimo.numero).map(() => remate.codigo));
    const junto = remates.length ? `; junto a él, remate: ${remates.map((codigo) => nombreCodigo(leyenda, codigo)).join(", ")}` : "";
    return {
      numero: racimo.numero,
      codigos: racimo.codigos,
      remates,
      texto: `Racimo ${racimo.numero}: ${racimo.codigos.map((codigo) => nombreCodigo(leyenda, codigo)).join(", ")}${junto}`,
    };
  });
}

/** "14 globos chicos: 8 de R-5 blanco fashion (1), 6 de R-5 dorado reflex (6)". */
export function cantidadesTexto(codigos: ReadonlyArray<{ codigo: number; cantidad: number }>, leyenda: readonly ColorLeyenda[]): string {
  return codigos.map(({ codigo, cantidad }) => `${cantidad} de ${nombreCodigo(leyenda, codigo)}`).join(", ");
}
