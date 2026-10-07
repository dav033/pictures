import type { FormatoGlobo } from "./formatos";
import { centroCuerpo } from "./geometria";
import { armarModulo, moduloPorId, materialesModulo, type GloboColocado, type Vec3 } from "./modulos";

/**
 * La trenza de cuartetos de Sempertex a lo largo de cualquier recorrido: cuartetos apretados (los globos a 0,62
 * diámetros del eje, los nudos metidos hacia dentro), cada uno perpendicular al recorrido y girado 1/8 de vuelta
 * respecto al anterior. Una columna es un recorrido recto hacia arriba; un arco, una curva de piso a piso.
 * Patrones de color de «Conceptos y técnicas»: un color, espiralada, salvavidas y zig-zag.
 * La separación entre cuartetos sale de la fórmula de Sempertex (R-12 a 25 cm: 5 por metro; R-9 a 18 cm: 7;
 * R-5 a 12 cm: 10), unos 0,8 diámetros. Unidades: cm; el recorrido va en el plano XY (y hacia arriba).
 */
export type PatronTrenza = "un_color" | "espiral" | "salvavidas" | "zigzag";

export const PATRONES_TRENZA: ReadonlyArray<{ id: PatronTrenza; nombre: string; descripcion: string; colores: number }> = [
  { id: "un_color", nombre: "Un color", descripcion: "Todos los cuartetos del mismo color.", colores: 1 },
  { id: "espiral", nombre: "Espiralada", descripcion: "Cada cuarteto con 4 colores en el mismo orden; al girar 1/8 por nivel se forma la espiral.", colores: 4 },
  { id: "salvavidas", nombre: "Salvavidas", descripcion: "Bloques de 2 cuartetos de un solo color, alternando.", colores: 2 },
  { id: "zigzag", nombre: "Zig-zag", descripcion: "Se giran 2 cuartetos a la izquierda y los 2 siguientes a la derecha.", colores: 4 },
];

export const PASO_POR_DIAMETRO = 0.8;
/**
 * Distancia del eje de la trenza al centro de cada globo, en diámetros. La cuerda aprieta el cuarteto: los
 * nudos quedan metidos hacia dentro y los globos se aplastan entre sí, sin hueco en el centro (dueño,
 * 2026-10-07: «los globos están muy separados»). Un cuarteto suelto queda a ~0,73.
 */
export const RADIO_TRENZA_POR_DIAMETRO = 0.62;
const GIRO = Math.PI / 4; // 1/8 de vuelta

export type Punto2 = { x: number; y: number };
export type GloboDeTrenza = GloboColocado & { codigo: string; nivel: number };

/** Un ancla de la trenza: el hueco `hueco` (0-3) entre dos globos vecinos del cuarteto `nivel`, hacia fuera. */
export type AnclaTrenza = { nivel: number; hueco: number; posicion: Vec3; normal: Vec3 };

export type TrenzaArmada = {
  niveles: number;
  anclas: AnclaTrenza[];
  longitudCm: number;
  pasoCm: number;
  globos: GloboDeTrenza[];
  materiales: Array<{ codigo: string; cantidad: number }>;
};

export type OpcionesTrenza = {
  formato: FormatoGlobo;
  infladoCm: number;
  patron: PatronTrenza;
  colores: readonly string[];
  /** Polilínea del eje (cm, plano XY). */
  recorrido: readonly Punto2[];
  /** «paso»: un cuarteto cada paso desde el inicio (columna). «extremos»: reparte para tocar ambos extremos (arco). */
  reparto: "paso" | "extremos";
};

function rotarY(v: Vec3, angulo: number): Vec3 {
  const c = Math.cos(angulo), s = Math.sin(angulo);
  return { x: v.x * c + v.z * s, y: v.y, z: -v.x * s + v.z * c };
}

function colorDe(patron: PatronTrenza, colores: readonly string[], nivel: number, posicion: number): string {
  const c = (i: number) => colores[i % Math.max(1, colores.length)] ?? colores[0] ?? "005";
  switch (patron) {
    case "un_color": return c(0);
    case "salvavidas": return c(Math.floor(nivel / 2));
    default: return c(posicion);
  }
}

function anguloDe(patron: PatronTrenza, nivel: number): number {
  if (patron !== "zigzag") return nivel * GIRO;
  let angulo = 0;
  for (let i = 1; i <= nivel; i++) angulo += Math.floor((i - 1) / 2) % 2 === 0 ? GIRO : -GIRO;
  return angulo;
}

export function longitudRecorrido(recorrido: readonly Punto2[]): number {
  let total = 0;
  for (let i = 1; i < recorrido.length; i++) total += Math.hypot(recorrido[i]!.x - recorrido[i - 1]!.x, recorrido[i]!.y - recorrido[i - 1]!.y);
  return total;
}

/** Punto y tangente (unitaria) del recorrido a la distancia `s` (cm) desde el inicio. */
function enRecorrido(recorrido: readonly Punto2[], s: number): { punto: Punto2; tangente: Punto2 } {
  let resto = s;
  for (let i = 1; i < recorrido.length; i++) {
    const a = recorrido[i - 1]!, b = recorrido[i]!;
    const largo = Math.hypot(b.x - a.x, b.y - a.y);
    if (resto <= largo || i === recorrido.length - 1) {
      const t = largo > 0 ? Math.min(1, resto / largo) : 0;
      return { punto: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, tangente: { x: (b.x - a.x) / (largo || 1), y: (b.y - a.y) / (largo || 1) } };
    }
    resto -= largo;
  }
  const ultimo = recorrido[recorrido.length - 1] ?? { x: 0, y: 0 };
  return { punto: ultimo, tangente: { x: 0, y: 1 } };
}

export function armarTrenza(opciones: OpcionesTrenza): TrenzaArmada {
  const { formato, infladoCm, patron, colores, recorrido, reparto } = opciones;
  // La cuerda aprieta el cuarteto: las dos parejas casi no se separan a lo largo del eje.
  const cuarteto = { ...moduloPorId("cuarteto")!, inclinacion: 0.12 };
  const base = armarModulo(cuarteto, formato, infladoCm);
  const natural = centroCuerpo(formato.tipo === "link" ? "link" : "redondo", infladoCm);
  const radio = infladoCm * RADIO_TRENZA_POR_DIAMETRO;
  // Cuarteto apretado alrededor del eje Y local: cada cuerpo a `radio` del eje, el nudo corrido hacia dentro.
  const apretados = base.globos.map((g) => {
    const horizontal = Math.hypot(g.direccion.x, g.direccion.z) || 1;
    const desde = radio / horizontal - natural;
    return { ...g, nudo: { x: g.direccion.x * desde, y: g.direccion.y * desde, z: g.direccion.z * desde }, cuelloExtraCm: 0 };
  });

  const pasoCm = infladoCm * PASO_POR_DIAMETRO;
  const longitudCm = longitudRecorrido(recorrido);
  const niveles = reparto === "paso" ? Math.max(1, Math.round(longitudCm / pasoCm)) : Math.max(2, Math.round(longitudCm / pasoCm) + 1);
  const separacion = reparto === "paso" ? pasoCm : longitudCm / (niveles - 1);

  // Huecos entre globos vecinos del cuarteto (en su marco local): a medio camino entre los dos, sobre la
  // superficie de la canaleta que forman, con la normal hacia fuera.
  const mitad = Math.PI / apretados.length;
  const profundidadHueco = radio * Math.cos(mitad) + Math.sqrt(Math.max(0, (infladoCm / 2) ** 2 - (radio * Math.sin(mitad)) ** 2));
  const huecosLocales = apretados.map((g, k) => {
    const otro = apretados[(k + 1) % apretados.length]!;
    const x = g.direccion.x + otro.direccion.x, z = g.direccion.z + otro.direccion.z;
    const largo = Math.hypot(x, z) || 1;
    const normal: Vec3 = { x: x / largo, y: 0, z: z / largo };
    return { hueco: k, normal, posicion: { x: normal.x * profundidadHueco, y: 0, z: normal.z * profundidadHueco } };
  });

  const globos: GloboDeTrenza[] = [];
  const anclas: AnclaTrenza[] = [];
  for (let nivel = 0; nivel < niveles; nivel++) {
    const { punto, tangente } = enRecorrido(recorrido, nivel * separacion);
    // Marco local: el eje del cuarteto (Y local) sigue la tangente; X local queda en el plano del recorrido y
    // Z local sale del plano.
    const eje: Vec3 = { x: tangente.x, y: tangente.y, z: 0 };
    const lado: Vec3 = { x: tangente.y, y: -tangente.x, z: 0 };
    const fuera: Vec3 = { x: 0, y: 0, z: 1 };
    const mundo = (v: Vec3): Vec3 => ({
      x: v.x * lado.x + v.y * eje.x + v.z * fuera.x,
      y: v.x * lado.y + v.y * eje.y + v.z * fuera.y,
      z: v.x * lado.z + v.y * eje.z + v.z * fuera.z,
    });
    const angulo = anguloDe(patron, nivel);
    for (const g of apretados) {
      const nudo = mundo(rotarY(g.nudo, angulo));
      globos.push({
        ...g,
        indice: nivel * apretados.length + g.indice,
        nudo: { x: nudo.x + punto.x, y: nudo.y + punto.y, z: nudo.z },
        direccion: mundo(rotarY(g.direccion, angulo)),
        codigo: colorDe(patron, colores, nivel, g.indice),
        nivel,
      });
    }
    for (const h of huecosLocales) {
      const p = mundo(rotarY(h.posicion, angulo));
      anclas.push({ nivel, hueco: h.hueco, posicion: { x: p.x + punto.x, y: p.y + punto.y, z: p.z }, normal: mundo(rotarY(h.normal, angulo)) });
    }
  }
  return { niveles, anclas, longitudCm: Math.round(longitudCm), pasoCm, globos, materiales: materialesModulo(globos.map((g) => g.codigo)) };
}
