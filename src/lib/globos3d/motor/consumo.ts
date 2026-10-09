import type { EspecClienteV1 } from "./espec-cliente-v1";

/**
 * **El registro de propiedades huérfanas.** Un dato que se determina y nadie lee es la causa de la mayoría de los
 * defectos de este producto (lo que se dibuja no es lo que se cobra, el color que se pide no es el que sale). Por eso
 * cada hoja de `EspecClienteV1` declara aquí a dónde va: si la espec gana un campo y nadie lo declara, esto deja de
 * compilar (`satisfies Record<RutaHoja<EspecClienteV1>, Destino>`); y si se declara y no lo lee nadie, lo atrapa la
 * prueba de mutación de `test-motor-guiada-consumo.ts`.
 *
 * - `escena`: cambia lo que se arma (geometría, globos, colores en la escena).
 * - `bom`: cambia la lista de materiales o su hash.
 * - `flux`: entra a la imagen que se genera desde la misma geometría (sin campos hoy: la fase 4 los declarará).
 * - `ui`: lo muestra la interfaz (nombres, origen); la prueba solo comprueba que cambie el hash, porque el lector está fuera del motor.
 * - `{ ignorado }`: el motor lo ignora a propósito, con el motivo.
 */
export type Destino = "escena" | "bom" | "flux" | "ui" | { ignorado: string };

type Hoja<T, Ruta extends string = ""> =
  T extends readonly (infer Elemento)[] ? Hoja<Elemento, Ruta>
    : T extends object ? { [K in keyof T & string]-?: Hoja<NonNullable<T[K]>, Ruta extends "" ? K : `${Ruta}.${K}`> }[keyof T & string]
      : Ruta;

/** Las rutas con punto de todas las hojas de un tipo (`piezas.medidas.anchoM`); los arreglos no suman índice. */
export type RutaHoja<T> = Hoja<T>;

export const CONSUMO = {
  version: "bom",
  "origen.tipo": "ui",
  "origen.ideaIds": "ui",
  "piezas.id": "escena",
  "piezas.oficial": "escena",
  "piezas.nombre": "ui",
  "piezas.lugar": "escena",
  "piezas.medidas.anchoM": "escena",
  "piezas.medidas.altoM": "escena",
  "piezas.medidas.largoM": "escena",
  "piezas.medidas.grosorM": "escena",
  "piezas.colores.codigo": "escena",
  "piezas.colores.nombre": { ignorado: "Lo leerá el prompt de la imagen (fase 4); mientras tanto solo viaja con la espec." },
  "piezas.colores.peso": "escena",
  "piezas.tamanos": "escena",
  "piezas.densidad": "escena",
  "piezas.forma": "escena",
  "piezas.flores.cantidad": "escena",
  "piezas.flores.petalos": "escena",
  "piezas.flores.codigo": "escena",
  "piezas.flores.centro": "escena",
  "piezas.unidades": "escena",
  "piezas.capas": "escena",
  "piezas.remate.formatoId": "escena",
  "piezas.remate.codigo": "escena",
  "piezas.declarada.materiales.formatoId": "bom",
  "piezas.declarada.materiales.codigo": "bom",
  "piezas.declarada.materiales.cantidad": "bom",
  "piezas.declarada.motivo": "ui",
} as const satisfies Record<RutaHoja<EspecClienteV1>, Destino>;
