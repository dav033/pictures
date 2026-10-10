import type { FilaBomba } from "./bomba-segundos";
import type { LineaFlor } from "./hoja-armado-anexos";
import type { CapaHoja } from "./hoja-armado-capas";
import type { FilaCompacta } from "./hoja-armado-compacta";
import type { LineaAparte, LineaColorCapa } from "./hoja-armado-comun";
import type { TramoHoja } from "./hoja-armado-tramos";
import type { CuartetoHoja } from "./hoja-armado-trenza";

/**
 * - `anillos`: columna o módulo con capas del tamaño del módulo, dibujadas vistas desde arriba;
 * - `capas`: pieza con capas de tamaños distintos (un cono, una columna irregular): una tabla por capa;
 * - `trenza`: arco o guirnalda clásicos, cuarteto a cuarteto a lo largo del recorrido;
 * - `paredes`: malla o trenzas, por tramos de un extremo al otro;
 * - `alturas`: el resto, en franjas de altura (para contar, no para armar por capas).
 */
export type ModoHoja = "anillos" | "capas" | "trenza" | "paredes" | "alturas";

/** Una pieza hecha de módulos: dúos, tríos, cuartetos… (los globos van en grupos de `globosPorGrupo`). */
export type NotaModulo = { etiqueta: string; globosPorGrupo: number };

/** Una estructura de la hoja: una pieza, o varias iguales juntas. Todo lo de adentro es de UNA copia; `unidades` dice cuántas hay. */
export type EstructuraHoja = {
  id: string;
  nombre: string;
  /** Cuántas copias iguales de la estructura hay en la escena. */
  unidades: number;
  modulo?: NotaModulo;
  /** El patrón de color de la trenza (un color, espiralada, salvavidas…). */
  patron?: { nombre: string; descripcion: string };
  modo: ModoHoja;
  /** Cómo leer las tablas de esta pieza cuando no son capas de armado. */
  nota?: string;
  /** Dónde está el 1 y hacia dónde sube la numeración. */
  sentido?: string;
  avisos: string[];
  /** Modo anillos. */
  capas: CapaHoja[];
  /** Modos capas, paredes y alturas. */
  tramos: TramoHoja[];
  /** Modo trenza. */
  cuartetos: CuartetoHoja[];
  /** Globos que no están en ninguna capa (el remate, los acentos). */
  aparte: LineaAparte[];
  /** Todos los globos de una copia, por color. */
  colores: LineaColorCapa[];
  /** Tubos y links de una copia: se compran e inflan enteros, no por capa. */
  tubos: LineaColorCapa[];
  /** Flores artificiales de una copia, metidas entre los globos. */
  flores: LineaFlor[];
  /** El relleno de un globo burbuja (confeti o plumas), si lo lleva. */
  relleno?: string;
  globosPorUnidad: number;
  /** La bomba de una copia, por formato (globos y tubitos). */
  filasBomba: FilaBomba[];
  /** Globos de todas las copias. */
  totalGlobos: number;
  segundosPorUnidad: number;
  /** Segundos de bomba de todas las copias. */
  segundosBomba: number;
  /** Lo que se imprime de la estructura: dos piezas con la misma firma se juntan en una sola (ver `hoja-armado-estructura.ts`). */
  firma: string;
};

export type LineaLista = { formatoId: string; codigo: string; nombreColor: string; hex: string; cantidad: number };

export type HojaArmado = {
  nombre: string;
  piezas: number;
  globos: number;
  estructuras: EstructuraHoja[];
  /** Piezas pequeñas y tubos: una fila por lo que llevan, no una página por pieza. */
  compactas: FilaCompacta[];
  /** Piezas sin globos de látex ni tubos (flores, mesas, utilería, metalizados): solo se nombran, con cuántas hay. */
  otrasPiezas: string[];
  lista: LineaLista[];
  segundosBomba: number;
  avisos: string[];
};

export type TrozoEstructura = {
  tipo: "estructura";
  estructura: EstructuraHoja;
  /** El primer trozo trae el resumen de la pieza; los demás dicen «(continúa)». */
  primero: boolean;
  capas: CapaHoja[];
  tramos: TramoHoja[];
  cuartetos: CuartetoHoja[];
};
export type TrozoCompacta = { tipo: "compacta"; filas: FilaCompacta[]; primero: boolean };
export type TrozoOtras = { tipo: "otras"; nombres: string[] };
export type TrozoLista = { tipo: "lista"; lineas: LineaLista[]; primero: boolean; ultimo: boolean };
export type TrozoHoja = TrozoEstructura | TrozoCompacta | TrozoOtras | TrozoLista;

/** Una página impresa: uno o varios trozos (las estructuras pequeñas comparten página). */
export type PaginaHoja = { numero: number; trozos: TrozoHoja[] };
