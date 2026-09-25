import type { ArmadoBouquetResuelto, DisposicionNumero, RolNivelBouquet, UnidadBouquet, VarianteBouquet } from "@/lib/plan/armado-bouquet";
import type { GloboVistaArmado } from "@/lib/plan/peticion-armado";
import type { LineaMaterial } from "@/lib/plan/resuelto";
import { leyendaPatron, type ColorLeyenda } from "../patron/leyenda";

/**
 * Leyenda numerada de un armado de bouquet (ADR-0030): un número por globo
 * comprado, el `codigo` que Python dio a cada material, con el color que se
 * compra y la descripción que Python escribió ("R-12 blanco fashion",
 * "Corazón dorado 18″"). Solo presentación: nada de aquí cuenta ni arma.
 */

const HEX_DESCONOCIDO = "#9ca3af";

function mayusculaInicial(texto: string): string {
  return texto ? `${texto.charAt(0).toUpperCase()}${texto.slice(1)}` : texto;
}

/**
 * Una entrada por código, en orden. La muestra de color sale de la misma
 * leyenda que usan los patrones (`leyendaPatron`, con el color y el acabado
 * que Python dice que se compran y el tono de la línea resuelta); el número y
 * el nombre son los de Python.
 */
export function leyendaBouquet(resuelto: Pick<ArmadoBouquetResuelto, "leyenda">, lineas: readonly LineaMaterial[] = []): ColorLeyenda[] {
  const entradas = [...resuelto.leyenda].sort((a, b) => a.codigo - b.codigo);
  const materiales = entradas.map((entrada) => ({
    product_id: entrada.product_id,
    ...(entrada.color ? { color: entrada.color } : {}),
    ...(entrada.acabado ? { acabado: entrada.acabado } : {}),
  }));
  return leyendaPatron(materiales, lineas).map((color, posicion) => {
    const entrada = entradas[posicion]!;
    const etiqueta = mayusculaInicial(entrada.descripcion);
    return { ...color, indice: entrada.material, numero: entrada.codigo, etiqueta, muestra: { ...color.muestra, etiqueta } };
  });
}

/** Entrada de un código que la leyenda no conoce (no debería pasar): gris, con el número. */
export function colorDeCodigo(leyenda: readonly ColorLeyenda[], codigo: number): ColorLeyenda {
  return leyenda.find((color) => color.numero === codigo) ?? {
    indice: codigo - 1,
    numero: codigo,
    etiqueta: `Globo ${codigo}`,
    muestra: { color: "", etiqueta: `Globo ${codigo}`, fondo: HEX_DESCONOCIDO, conBorde: false },
    hex: HEX_DESCONOCIDO,
    brillo: "mate",
    numeroClaro: false,
  };
}

/**
 * Los globos de la pieza para la vista previa, de sus líneas resueltas: uno
 * por variante, solo los campos del contrato. Clasifican; nunca cuentan.
 */
export function globosDeLineas(lineas: readonly LineaMaterial[]): GloboVistaArmado[] {
  const vistas = new Set<string>();
  const globos: GloboVistaArmado[] = [];
  for (const linea of lineas) {
    if (vistas.has(linea.variant_id)) continue;
    vistas.add(linea.variant_id);
    globos.push({
      product_id: linea.product_id,
      variant_id: linea.variant_id,
      titulo: linea.titulo,
      forma: linea.forma,
      diam_pulg: linea.diam_pulg,
      tamano_codigo: linea.tamano_codigo,
      color: linea.color,
      acabado: linea.acabado,
    });
  }
  return globos;
}

/** Lo que el editor MUESTRA de cada estilo; cuáles admite la pieza lo dice Python. */
export const ETIQUETA_VARIANTE: Readonly<Record<VarianteBouquet, { nombre: string; ayuda: string }>> = {
  base_aire: { nombre: "Con base (aire)", ayuda: "Globos con aire fijados sobre una base; remate y números en varilla" },
  helio_apilado: { nombre: "Helio apilado", ayuda: "Capas a la misma altura, una sobre otra" },
  helio_escalonado: { nombre: "Helio escalonado", ayuda: "Globos a distintas alturas alrededor de la pieza central" },
};

export const ETIQUETA_DISPOSICION: Readonly<Record<DisposicionNumero, string>> = {
  centro: "Al centro",
  lados: "A los lados",
  arriba: "Arriba",
};

export const NOMBRE_UNIDAD: Readonly<Record<UnidadBouquet, { singular: string; plural: string }>> = {
  suelto: { singular: "globo suelto", plural: "globos sueltos" },
  pareja: { singular: "pareja", plural: "parejas" },
  trio: { singular: "trío", plural: "tríos" },
  cuarteto: { singular: "cuarteto", plural: "cuartetos" },
  quinteto: { singular: "quinteto", plural: "quintetos" },
  sexteto: { singular: "sexteto", plural: "sextetos" },
};

export const NOMBRE_ROL: Readonly<Record<RolNivelBouquet, string>> = {
  base: "base",
  cuerpo: "cuerpo",
  capa: "capa",
  alrededor: "alrededor",
  acento: "acentos",
  relleno: "relleno de la burbuja",
};

/** "1 cuarteto" / "3 tríos". */
export function unidadesTexto(cantidad: number, unidad: UnidadBouquet): string {
  const nombre = NOMBRE_UNIDAD[unidad];
  return `${cantidad} ${cantidad === 1 ? nombre.singular : nombre.plural}`;
}

const numero = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 3 });
const SINGULAR_UNIDAD: Readonly<Record<string, string>> = { pesas: "pesa", cintas: "cinta", varillas: "varilla", bases: "base" };

/** "1 pesa de 80 g o más cada una". Lo que Python escribió en `detalle`, sin el paréntesis aclaratorio. */
function insumoTexto(insumo: ArmadoBouquetResuelto["insumos"][number]): string {
  const unidad = insumo.cantidad === 1 ? SINGULAR_UNIDAD[insumo.unidad] ?? insumo.unidad : insumo.unidad;
  const cantidad = `${numero.format(insumo.cantidad)} ${unidad}`;
  if (insumo.insumo === "helio") return `${cantidad} de helio`;
  if (insumo.insumo === "pesa") {
    const detalle = insumo.detalle.split(" (")[0]?.trim();
    return detalle ? `${cantidad} ${detalle}` : cantidad;
  }
  return cantidad;
}

/**
 * Resumen de una línea de lo que el armado necesita y no se cotiza:
 * "1 pesa de 80 g o más cada una · 7 cintas · ≈ 0,106 m³ de helio · flota 18–24 h".
 * Lo estimado por Python lleva "≈".
 */
export function resumenInsumos(insumos: ArmadoBouquetResuelto["insumos"], duracion: ArmadoBouquetResuelto["duracion_estimada"]): string {
  const partes = insumos.map((insumo) => `${insumo.estimado ? "≈ " : ""}${insumoTexto(insumo)}`);
  if (duracion) partes.push(`flota ${duracion.horas_min}–${duracion.horas_max} h`);
  return partes.join(" · ");
}
