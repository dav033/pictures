import type { FormatoGlobo } from "./formatos";
import { centroCuerpo } from "./geometria";
import { armarModulo, moduloPorId, materialesModulo, type GloboColocado, type Vec3 } from "./modulos";

/**
 * La columna de cuartetos (la «trenza» de Sempertex): cuartetos apilados sobre una cuerda, cada uno girado 1/8
 * de vuelta (45°) respecto al de abajo para que encaje en los huecos. Patrones de color de «Conceptos y técnicas»:
 * - un color;
 * - espiralada: cada cuarteto con sus 4 colores en el mismo orden; el giro de 1/8 dibuja la espiral;
 * - salvavidas: bloques de cuartetos de un solo color (2 cuartetos por bloque);
 * - zig-zag: como la espiralada, pero se gira 2 cuartetos a un lado y los 2 siguientes al otro.
 * La separación entre niveles sale de la fórmula de Sempertex (cuartetos por metro): R-12 a 25 cm, 5 por metro;
 * R-9 a 18 cm, 7; R-5 a 12 cm, 10. Es decir, unos 0,8 diámetros por nivel.
 */
export type PatronColumna = "un_color" | "espiral" | "salvavidas" | "zigzag";

export const PATRONES_COLUMNA: ReadonlyArray<{ id: PatronColumna; nombre: string; descripcion: string; colores: number }> = [
  { id: "un_color", nombre: "Un color", descripcion: "Todos los cuartetos del mismo color.", colores: 1 },
  { id: "espiral", nombre: "Espiralada", descripcion: "Cada cuarteto con 4 colores en el mismo orden; al girar 1/8 por nivel se forma la espiral.", colores: 4 },
  { id: "salvavidas", nombre: "Salvavidas", descripcion: "Bloques de 2 cuartetos de un solo color, alternando.", colores: 2 },
  { id: "zigzag", nombre: "Zig-zag", descripcion: "Se giran 2 cuartetos a la izquierda y los 2 siguientes a la derecha.", colores: 4 },
];

export const PASO_POR_DIAMETRO = 0.8;
/**
 * Distancia del eje de la columna al centro de cada globo, en diámetros. En la columna la cuerda aprieta el
 * cuarteto: los nudos quedan metidos hacia dentro y los globos se aplastan entre sí, sin hueco en el centro
 * (dueño, 2026-10-07: «los globos están muy separados»). Un cuarteto suelto queda a ~0,73.
 */
export const RADIO_COLUMNA_POR_DIAMETRO = 0.62;
const GIRO = Math.PI / 4; // 1/8 de vuelta

export type GloboDeColumna = GloboColocado & { codigo: string; nivel: number };

export type ColumnaArmada = {
  niveles: number;
  alturaCm: number;
  pasoCm: number;
  globos: GloboDeColumna[];
  materiales: Array<{ codigo: string; cantidad: number }>;
};

function rotarY(v: Vec3, angulo: number): Vec3 {
  const c = Math.cos(angulo), s = Math.sin(angulo);
  return { x: v.x * c + v.z * s, y: v.y, z: -v.x * s + v.z * c };
}

/** Color de un globo según el patrón: `posicion` es su lugar dentro del cuarteto (0-3). */
function colorDe(patron: PatronColumna, colores: readonly string[], nivel: number, posicion: number): string {
  const c = (i: number) => colores[i % Math.max(1, colores.length)] ?? colores[0] ?? "005";
  switch (patron) {
    case "un_color": return c(0);
    case "salvavidas": return c(Math.floor(nivel / 2));
    default: return c(posicion);
  }
}

/** Ángulo acumulado del nivel: siempre al mismo lado, o en zig-zag (2 niveles a un lado, 2 al otro). */
function anguloDe(patron: PatronColumna, nivel: number): number {
  if (patron !== "zigzag") return nivel * GIRO;
  let angulo = 0;
  for (let i = 1; i <= nivel; i++) angulo += Math.floor((i - 1) / 2) % 2 === 0 ? GIRO : -GIRO;
  return angulo;
}

export function armarColumna(opciones: { formato: FormatoGlobo; infladoCm: number; alturaCm: number; patron: PatronColumna; colores: readonly string[] }): ColumnaArmada {
  const { formato, infladoCm, alturaCm, patron, colores } = opciones;
  // En la columna la cuerda aprieta el cuarteto: las dos parejas casi no se separan en altura (el cuarteto
  // suelto se ve más abierto). Con 0,12 rad la espiral queda limpia.
  const cuarteto = { ...moduloPorId("cuarteto")!, inclinacion: 0.12 };
  const base = armarModulo(cuarteto, formato, infladoCm);
  // Cada cuerpo se acerca al eje: el nudo se corre hacia dentro lo que haga falta (queda oculto entre los globos).
  const natural = centroCuerpo(formato.tipo === "link" ? "link" : "redondo", infladoCm);
  const radio = infladoCm * RADIO_COLUMNA_POR_DIAMETRO;
  const apretados = base.globos.map((g) => {
    const horizontal = Math.hypot(g.direccion.x, g.direccion.z) || 1;
    const desde = radio / horizontal - natural; // a lo largo de la dirección, desde el eje hasta el nudo
    return { ...g, nudo: { x: g.direccion.x * desde, y: g.direccion.y * desde, z: g.direccion.z * desde }, cuelloExtraCm: 0 };
  });
  const pasoCm = infladoCm * PASO_POR_DIAMETRO;
  const niveles = Math.max(1, Math.round(alturaCm / pasoCm));
  const globos: GloboDeColumna[] = [];
  for (let nivel = 0; nivel < niveles; nivel++) {
    const angulo = anguloDe(patron, nivel);
    const y = nivel * pasoCm;
    for (const g of apretados) {
      const nudo = rotarY(g.nudo, angulo);
      globos.push({
        ...g,
        indice: nivel * base.globos.length + g.indice,
        nudo: { x: nudo.x, y: nudo.y + y, z: nudo.z },
        direccion: rotarY(g.direccion, angulo),
        codigo: colorDe(patron, colores, nivel, g.indice),
        nivel,
      });
    }
  }
  return {
    niveles,
    // Alto real: del borde de abajo del primer cuarteto al de arriba del último.
    alturaCm: Math.round((niveles - 1) * pasoCm + base.altoCm),
    pasoCm,
    globos,
    materiales: materialesModulo(globos.map((g) => g.codigo)),
  };
}
