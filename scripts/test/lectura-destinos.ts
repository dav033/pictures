import type { LecturaFoto } from "../../src/lib/globos3d/lectura-foto";

/**
 * **El libro de cuentas de la lectura de una foto**: para CADA campo hoja de `LecturaFotoSchema`, quién lo consume —
 * `compilar` (`compilar-lectura.ts` y lo que llama), `medir` (`medir-con-detecciones.ts`: lo mide o lo corrige con los globos
 * detectados) o `prompt` (lo que ve el modelo del agente: `resumenParaAgente`)— o `ignorado`, con la razón. Un campo que se
 * produce y nadie consume es un defecto: la regla del dueño es que no haya propiedades huérfanas.
 *
 * `RutaHoja` se deduce del tipo de la lectura: si se agrega o se quita un campo del esquema, este archivo no compila hasta que se
 * declare su destino (`satisfies Record<RutaHoja, Destino>`), y `test-lectura-destinos.ts` lo comprueba también contra el JSON
 * Schema y prueba que los campos agregados por la medición con detecciones cambian de verdad lo que se compila.
 *
 * Las rutas: `piezas[]<tipo>.campo`; los arrays con `[]`; los objetos con `.`.
 */

type Hojas<T, P extends string> =
  T extends readonly (infer U)[] ? Hojas<U, `${P}[]`>
  : T extends { tipo: infer K extends string } ? Campos<T, `${P}<${K}>`>
  : T extends object ? Campos<T, P>
  : P;
type Campos<T, P extends string> = { [K in keyof T & string]-?: Hojas<NonNullable<T[K]>, P extends "" ? K : `${P}.${K}`> }[keyof T & string];

export type RutaHoja = Hojas<LecturaFoto, "">;

export type Consumidor = "compilar" | "medir" | "prompt";
export type Destino = readonly [Consumidor, ...Consumidor[]] | { readonly ignorado: string };

const C = ["compilar"] as const;
const CM = ["compilar", "medir"] as const;
const P = ["prompt"] as const;


export const DESTINOS = {
  resumen: P,
  aspecto: CM,
  "escala.altoImagenCm": CM,
  "escala.referencia": P,
  pisoY: CM,
  "sala.pared": C,
  "sala.piso": C,

  "piezas[]<guirnalda_organica>.tipo": C,
  "piezas[]<guirnalda_organica>.puntos[].x": CM,
  "piezas[]<guirnalda_organica>.puntos[].y": CM,
  "piezas[]<guirnalda_organica>.puntos[].grosor": ["compilar", "medir", "prompt"] as const,
  "piezas[]<guirnalda_organica>.puntos[].mezcla.gigantes": CM,
  "piezas[]<guirnalda_organica>.puntos[].mezcla.grandes": CM,
  "piezas[]<guirnalda_organica>.puntos[].mezcla.medianos": CM,
  "piezas[]<guirnalda_organica>.puntos[].mezcla.chicos": CM,
  "piezas[]<guirnalda_organica>.puntos[].dominante": CM,
  "piezas[]<guirnalda_organica>.tamanos.R-36": C,
  "piezas[]<guirnalda_organica>.tamanos.R-24": C,
  "piezas[]<guirnalda_organica>.tamanos.R-18": C,
  "piezas[]<guirnalda_organica>.tamanos.R-12": C,
  "piezas[]<guirnalda_organica>.tamanos.R-9": C,
  "piezas[]<guirnalda_organica>.tamanos.R-5": C,
  "piezas[]<guirnalda_organica>.mezcla.gigantes": CM,
  "piezas[]<guirnalda_organica>.mezcla.grandes": CM,
  "piezas[]<guirnalda_organica>.mezcla.medianos": CM,
  "piezas[]<guirnalda_organica>.mezcla.chicos": CM,
  "piezas[]<guirnalda_organica>.mezcla.diametroGigante": CM,
  "piezas[]<guirnalda_organica>.mezcla.diametroGrande": CM,
  "piezas[]<guirnalda_organica>.mezcla.diametroMediano": CM,
  "piezas[]<guirnalda_organica>.mezcla.diametroChico": CM,
  "piezas[]<guirnalda_organica>.mezcla.formatoGigante": CM,
  "piezas[]<guirnalda_organica>.mezcla.formatoGrande": CM,
  "piezas[]<guirnalda_organica>.mezcla.formatoMediano": CM,
  "piezas[]<guirnalda_organica>.mezcla.formatoChico": CM,
  "piezas[]<guirnalda_organica>.racimos": C,
  "piezas[]<guirnalda_organica>.coloresPorEscalon[].escalon": CM,
  "piezas[]<guirnalda_organica>.coloresPorEscalon[].pesos[]": CM,
  "piezas[]<guirnalda_organica>.anclas[].x": CM,
  "piezas[]<guirnalda_organica>.anclas[].y": CM,
  "piezas[]<guirnalda_organica>.anclas[].escalon": CM,
  "piezas[]<guirnalda_organica>.anclas[].color": CM,
  "piezas[]<guirnalda_organica>.anclas[].diametro": CM,
  "piezas[]<guirnalda_organica>.follaje[]": ["compilar", "prompt"] as const,
  "piezas[]<guirnalda_organica>.colores[].nombre": ["compilar", "medir", "prompt"] as const,
  "piezas[]<guirnalda_organica>.colores[].hex": CM,
  "piezas[]<guirnalda_organica>.colores[].peso": ["compilar", "medir", "prompt"] as const,
  "piezas[]<guirnalda_organica>.colores[].acabado": ["compilar", "medir", "prompt"] as const,
  "piezas[]<guirnalda_organica>.nota": C,

  "piezas[]<columna_organica>.tipo": C,
  "piezas[]<columna_organica>.forma": ["compilar", "prompt"] as const,
  "piezas[]<columna_organica>.x": CM,
  "piezas[]<columna_organica>.yBase": ["compilar", "medir", "prompt"] as const,
  "piezas[]<columna_organica>.yArriba": ["compilar", "medir", "prompt"] as const,
  "piezas[]<columna_organica>.ancho": CM,
  "piezas[]<columna_organica>.grosor": CM,
  "piezas[]<columna_organica>.tamanos.R-36": C,
  "piezas[]<columna_organica>.tamanos.R-24": C,
  "piezas[]<columna_organica>.tamanos.R-18": C,
  "piezas[]<columna_organica>.tamanos.R-12": C,
  "piezas[]<columna_organica>.tamanos.R-9": C,
  "piezas[]<columna_organica>.tamanos.R-5": C,
  "piezas[]<columna_organica>.mezcla.gigantes": C,
  "piezas[]<columna_organica>.mezcla.grandes": C,
  "piezas[]<columna_organica>.mezcla.medianos": C,
  "piezas[]<columna_organica>.mezcla.chicos": C,
  "piezas[]<columna_organica>.mezcla.diametroGigante": C,
  "piezas[]<columna_organica>.mezcla.diametroGrande": C,
  "piezas[]<columna_organica>.mezcla.diametroMediano": C,
  "piezas[]<columna_organica>.mezcla.diametroChico": C,
  "piezas[]<columna_organica>.mezcla.formatoGigante": C,
  "piezas[]<columna_organica>.mezcla.formatoGrande": C,
  "piezas[]<columna_organica>.mezcla.formatoMediano": C,
  "piezas[]<columna_organica>.mezcla.formatoChico": C,
  "piezas[]<columna_organica>.racimos": C,
  "piezas[]<columna_organica>.colores[].nombre": ["compilar", "prompt"] as const,
  "piezas[]<columna_organica>.colores[].hex": C,
  "piezas[]<columna_organica>.colores[].peso": ["compilar", "prompt"] as const,
  "piezas[]<columna_organica>.colores[].acabado": ["compilar", "prompt"] as const,
  "piezas[]<columna_organica>.nota": C,

  "piezas[]<racimo_piso>.tipo": C,
  "piezas[]<racimo_piso>.x": CM,
  "piezas[]<racimo_piso>.yPie": ["compilar", "medir", "prompt"] as const,
  "piezas[]<racimo_piso>.yArriba": ["compilar", "medir", "prompt"] as const,
  "piezas[]<racimo_piso>.ancho": ["compilar", "medir", "prompt"] as const,
  "piezas[]<racimo_piso>.tamanos.R-36": C,
  "piezas[]<racimo_piso>.tamanos.R-24": C,
  "piezas[]<racimo_piso>.tamanos.R-18": C,
  "piezas[]<racimo_piso>.tamanos.R-12": C,
  "piezas[]<racimo_piso>.tamanos.R-9": C,
  "piezas[]<racimo_piso>.tamanos.R-5": C,
  "piezas[]<racimo_piso>.mezcla.gigantes": CM,
  "piezas[]<racimo_piso>.mezcla.grandes": CM,
  "piezas[]<racimo_piso>.mezcla.medianos": CM,
  "piezas[]<racimo_piso>.mezcla.chicos": CM,
  "piezas[]<racimo_piso>.mezcla.diametroGigante": C,
  "piezas[]<racimo_piso>.mezcla.diametroGrande": C,
  "piezas[]<racimo_piso>.mezcla.diametroMediano": C,
  "piezas[]<racimo_piso>.mezcla.diametroChico": C,
  "piezas[]<racimo_piso>.mezcla.formatoGigante": C,
  "piezas[]<racimo_piso>.mezcla.formatoGrande": C,
  "piezas[]<racimo_piso>.mezcla.formatoMediano": C,
  "piezas[]<racimo_piso>.mezcla.formatoChico": C,
  "piezas[]<racimo_piso>.racimos": C,
  "piezas[]<racimo_piso>.coloresPorEscalon[].escalon": CM,
  "piezas[]<racimo_piso>.coloresPorEscalon[].pesos[]": CM,
  "piezas[]<racimo_piso>.colores[].nombre": ["compilar", "medir", "prompt"] as const,
  "piezas[]<racimo_piso>.colores[].hex": CM,
  "piezas[]<racimo_piso>.colores[].peso": ["compilar", "medir", "prompt"] as const,
  "piezas[]<racimo_piso>.colores[].acabado": ["compilar", "medir", "prompt"] as const,
  "piezas[]<racimo_piso>.nota": C,

  "piezas[]<columna_clasica>.tipo": C,
  "piezas[]<columna_clasica>.x": CM,
  "piezas[]<columna_clasica>.yBase": ["compilar", "medir", "prompt"] as const,
  "piezas[]<columna_clasica>.yArriba": ["compilar", "medir", "prompt"] as const,
  "piezas[]<columna_clasica>.colores[].nombre": ["compilar", "prompt"] as const,
  "piezas[]<columna_clasica>.colores[].hex": C,
  "piezas[]<columna_clasica>.colores[].peso": ["prompt"] as const,
  "piezas[]<columna_clasica>.colores[].acabado": ["compilar", "prompt"] as const,
  "piezas[]<columna_clasica>.nota": C,

  "piezas[]<guirnalda_clasica>.tipo": C,
  "piezas[]<guirnalda_clasica>.x1": ["compilar", "prompt"] as const,
  "piezas[]<guirnalda_clasica>.x2": ["compilar", "prompt"] as const,
  "piezas[]<guirnalda_clasica>.y": C,
  "piezas[]<guirnalda_clasica>.caida": C,
  "piezas[]<guirnalda_clasica>.colores[].nombre": ["compilar", "prompt"] as const,
  "piezas[]<guirnalda_clasica>.colores[].hex": C,
  "piezas[]<guirnalda_clasica>.colores[].peso": ["prompt"] as const,
  "piezas[]<guirnalda_clasica>.colores[].acabado": ["compilar", "prompt"] as const,
  "piezas[]<guirnalda_clasica>.nota": C,

  "piezas[]<globo>.tipo": C,
  "piezas[]<globo>.x": CM,
  "piezas[]<globo>.y": CM,
  "piezas[]<globo>.diametro": ["compilar", "medir", "prompt"] as const,
  "piezas[]<globo>.en": ["compilar", "prompt"] as const,
  "piezas[]<globo>.colores[].nombre": ["compilar", "prompt"] as const,
  "piezas[]<globo>.colores[].hex": C,
  "piezas[]<globo>.colores[].peso": ["prompt"] as const,
  "piezas[]<globo>.colores[].acabado": ["compilar", "prompt"] as const,
  "piezas[]<globo>.nota": C,

  "piezas[]<ramo_helio>.tipo": C,
  "piezas[]<ramo_helio>.x": CM,
  "piezas[]<ramo_helio>.yBase": CM,
  "piezas[]<ramo_helio>.yArriba": CM,
  "piezas[]<ramo_helio>.cantidad": ["compilar", "medir", "prompt"] as const,
  "piezas[]<ramo_helio>.colores[].nombre": ["compilar", "prompt"] as const,
  "piezas[]<ramo_helio>.colores[].hex": C,
  "piezas[]<ramo_helio>.colores[].peso": ["prompt"] as const,
  "piezas[]<ramo_helio>.colores[].acabado": ["compilar", "prompt"] as const,
  "piezas[]<ramo_helio>.nota": C,

  "piezas[]<decoracion>.tipo": C,
  "piezas[]<decoracion>.id": ["compilar", "prompt"] as const,
  "piezas[]<decoracion>.x": CM,
  "piezas[]<decoracion>.y": CM,
  "piezas[]<decoracion>.cantidad": ["compilar", "medir", "prompt"] as const,
  "piezas[]<decoracion>.colores[].nombre": ["compilar", "prompt"] as const,
  "piezas[]<decoracion>.colores[].hex": C,
  "piezas[]<decoracion>.colores[].peso": ["prompt"] as const,
  "piezas[]<decoracion>.colores[].acabado": ["compilar", "prompt"] as const,
  "piezas[]<decoracion>.nota": C,

  "piezas[]<metalizado>.tipo": C,
  "piezas[]<metalizado>.texto": ["compilar", "medir", "prompt"] as const,
  "piezas[]<metalizado>.cursiva": ["compilar", "prompt"] as const,
  "piezas[]<metalizado>.x": CM,
  "piezas[]<metalizado>.y": CM,
  "piezas[]<metalizado>.alto": CM,
  "piezas[]<metalizado>.colores[].nombre": ["compilar", "prompt"] as const,
  "piezas[]<metalizado>.colores[].hex": { ignorado: "el foil se pide por el nombre del color («rosa oro»); el hex no se usa" },
  "piezas[]<metalizado>.colores[].peso": ["prompt"] as const,
  "piezas[]<metalizado>.colores[].acabado": ["prompt"] as const,
  "piezas[]<metalizado>.nota": C,

  "piezas[]<fondo>.tipo": C,
  "piezas[]<fondo>.id": ["compilar", "medir", "prompt"] as const,
  "piezas[]<fondo>.x": CM,
  "piezas[]<fondo>.yBase": CM,
  "piezas[]<fondo>.ancho": CM,
  "piezas[]<fondo>.alto": CM,
  "piezas[]<fondo>.texto": ["compilar", "prompt"] as const,
  "piezas[]<fondo>.colores[].nombre": ["prompt"] as const,
  "piezas[]<fondo>.colores[].hex": C,
  "piezas[]<fondo>.colores[].peso": ["prompt"] as const,
  "piezas[]<fondo>.colores[].acabado": ["compilar", "prompt"] as const,
  "piezas[]<fondo>.nota": C,

  "piezas[]<otro>.tipo": C,
  "piezas[]<otro>.descripcion": ["compilar", "prompt"] as const,
} as const satisfies Record<RutaHoja, Destino>;
