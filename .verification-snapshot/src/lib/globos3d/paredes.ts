import type { FormatoGlobo } from "./formatos";
import { centroCuerpo, nudoCm } from "./geometria";
import type { GloboColocado, Vec3 } from "./modulos";

/**
 * Malla Link-O-Loon tipo flor (Celebra ed. 2, p. 40 · «Mural flor»): cadenetas de LOL en diagonal que se cruzan;
 * en cada cruce, una pareja de R-6 (aquí R-5) amarra las uniones. Cada eslabón va de un «centro de flor» a una
 * «esquina», así que alrededor de cada centro quedan 4 pétalos: la flor de 4 pétalos que se colorea como bloque
 * (de ahí los rombos y dameros de color).
 *
 * Medidas de Sempertex (por m²: LOL 6 = 8 cadenetas de 8, LOL 9 = 6 de 6, LOL 12 = 4 de 4; inflados 12/18/24 cm):
 * en una malla diagonal entran 2/L² eslabones por m², así que el eslabón mide L ≈ 1,47 × inflado (LOL-12 a
 * 24 cm: 35 cm; 16 por m²). La pared queda en el plano XY, apoyada en el piso (y = 0), mirando hacia +Z.
 * Unidades: cm.
 */
export type PatronMalla = "un_color" | "damero" | "rombos" | "franjas";

export const PATRONES_MALLA: ReadonlyArray<{ id: PatronMalla; nombre: string; descripcion: string; colores: number }> = [
  { id: "un_color", nombre: "Un color", descripcion: "Todas las flores del mismo color.", colores: 1 },
  { id: "damero", nombre: "Damero", descripcion: "Flores alternadas de dos colores, como un tablero.", colores: 2 },
  { id: "rombos", nombre: "Rombos", descripcion: "Anillos de color en rombo alrededor del centro de la pared.", colores: 4 },
  { id: "franjas", nombre: "Franjas", descripcion: "Franjas diagonales de flores de cada color.", colores: 4 },
];

export const LARGO_ESLABON_POR_DIAMETRO = 1.47;

export type GloboDePared = GloboColocado & { codigo: string; formatoId: string; infladoCm: number };
/** Ancla de la pared: un centro de flor (fila, columna), con la normal hacia fuera (+Z). */
export type AnclaPared = { fila: number; columna: number; posicion: Vec3; normal: Vec3 };

export type ParedArmada = {
  globos: GloboDePared[];
  anclas: AnclaPared[];
  eslabones: number;
  uniones: number;
  anchoCm: number;
  altoCm: number;
  materiales: Array<{ formatoId: string; codigo: string; cantidad: number }>;
};

function colorFlor(patron: PatronMalla, colores: readonly string[], fila: number, columna: number, filas: number, columnas: number): string {
  const c = (i: number) => colores[((i % colores.length) + colores.length) % Math.max(1, colores.length)] ?? colores[0] ?? "005";
  switch (patron) {
    case "un_color": return c(0);
    case "damero": return c(fila + columna);
    case "franjas": return c(fila + columna);
    case "rombos": return c(Math.abs(fila - Math.floor(filas / 2)) + Math.abs(columna - Math.floor(columnas / 2)));
  }
}

export function armarPared(opciones: {
  formato: FormatoGlobo; infladoCm: number; anchoCm: number; altoCm: number; patron: PatronMalla; colores: readonly string[];
  /** Las parejas de unión (R-5 a 10 cm, como las R-6 de la revista). */
  union: { formato: FormatoGlobo; infladoCm: number; codigo: string };
}): ParedArmada {
  const { formato, infladoCm, anchoCm, altoCm, patron, colores, union } = opciones;
  const largo = infladoCm * LARGO_ESLABON_POR_DIAMETRO;
  const a = largo / Math.SQRT2; // paso de la retícula: los nodos están en (i·a, j·a) con i + j par
  const columnas = Math.max(2, Math.round(anchoCm / a) + 1);
  const filas = Math.max(2, Math.round(altoCm / a) + 1);
  const existe = (i: number, j: number) => i >= 0 && j >= 0 && i < columnas && j < filas && (i + j) % 2 === 0;
  // Centros de flor: nodos con i par; esquinas: i impar. Cada eslabón une un centro con una esquina.
  const centroBloque = (i: number, j: number) => ({ fila: Math.floor(j / 2), columna: Math.floor(i / 2) });
  const filasFlor = Math.ceil(filas / 2), columnasFlor = Math.ceil(columnas / 2);
  const natural = centroCuerpo("link", infladoCm);
  const globos: GloboDePared[] = [];
  let eslabones = 0;
  for (let i = 0; i < columnas; i += 2) {
    for (let j = 0; j < filas; j++) {
      if (!existe(i, j)) continue;
      const bloque = centroBloque(i, j);
      const codigo = colorFlor(patron, colores, bloque.fila, bloque.columna, filasFlor, columnasFlor);
      for (const [di, dj] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
        if (!existe(i + di, j + dj)) continue;
        // El eslabón: su cuerpo centrado en el punto medio, a lo largo de la diagonal (del centro a la esquina).
        const direccion: Vec3 = { x: di / Math.SQRT2, y: dj / Math.SQRT2, z: 0 };
        const medio = { x: (i + di / 2) * a, y: (j + dj / 2) * a };
        globos.push({
          indice: globos.length, formatoId: formato.id, infladoCm, codigo,
          nudo: { x: medio.x - direccion.x * natural, y: medio.y - direccion.y * natural, z: 0 },
          direccion, cuelloExtraCm: 0, parte: "malla",
        });
        eslabones += 1;
      }
    }
  }
  // Una pareja de unión en cada nodo: un globito hacia el frente y otro hacia atrás.
  let uniones = 0;
  const amarre = nudoCm(union.infladoCm);
  for (let i = 0; i < columnas; i++) {
    for (let j = 0; j < filas; j++) {
      if (!existe(i, j)) continue;
      for (const z of [1, -1]) {
        globos.push({ indice: globos.length, formatoId: union.formato.id, infladoCm: union.infladoCm, codigo: union.codigo, nudo: { x: i * a, y: j * a, z: z * amarre }, direccion: { x: 0, y: 0, z }, cuelloExtraCm: 0, parte: "union" });
      }
      uniones += 1;
    }
  }
  const anclas: AnclaPared[] = [];
  for (let i = 0; i < columnas; i += 2) for (let j = 0; j < filas; j++) if (existe(i, j)) anclas.push({ ...centroBloque(i, j), posicion: { x: i * a, y: j * a, z: union.infladoCm * 0.9 }, normal: { x: 0, y: 0, z: 1 } });
  const cuenta = new Map<string, { formatoId: string; codigo: string; cantidad: number }>();
  for (const g of globos) {
    const clave = `${g.formatoId}|${g.codigo}`;
    const actual = cuenta.get(clave);
    if (actual) actual.cantidad += 1; else cuenta.set(clave, { formatoId: g.formatoId, codigo: g.codigo, cantidad: 1 });
  }
  return { globos, anclas, eslabones, uniones, anchoCm: Math.round((columnas - 1) * a), altoCm: Math.round((filas - 1) * a), materiales: [...cuenta.values()] };
}
