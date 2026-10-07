import type { FormatoGlobo } from "./formatos";
import { centroCuerpo } from "./geometria";

/**
 * Los módulos básicos de Sempertex («Conceptos y técnicas · Cómo unir globos»), armados en 3D:
 * - pareja: dos globos inflados y medidos, anudados entre sí;
 * - trío: un globo anudado a una pareja;
 * - cuarteto: dos parejas entrelazadas;
 * - quinteto: una pareja y un trío entrelazados;
 * - sexteto: dos tríos entrelazados.
 *
 * Todos los nudos se juntan en el centro y cada cuerpo sale hacia fuera, repartido en el plano horizontal
 * (como va un módulo dentro de una columna). La distancia del nudo al centro del cuerpo es la que pide el
 * cuello; si con esa distancia los cuerpos vecinos se montarían, el globo se separa hasta que apenas se tocan
 * (en el látex real, los cuellos estirados hacen lo mismo). Cuarteto y sexteto alternan una leve inclinación
 * arriba/abajo: son dos parejas (o dos tríos) cruzados, uno sobre el otro.
 * Unidades: centímetros; y hacia arriba; el centro del módulo (los nudos) en el origen.
 */
export type TipoModulo = "pareja" | "trio" | "cuarteto" | "quinteto" | "sexteto";

export type Modulo = { id: TipoModulo; nombre: string; globos: number; armado: string; inclinacion: number };

export const MODULOS: readonly Modulo[] = [
  { id: "pareja", nombre: "Pareja (dúo)", globos: 2, armado: "Infla y mide dos globos y anúdalos entre sí.", inclinacion: 0 },
  { id: "trio", nombre: "Trío", globos: 3, armado: "Infla y mide un globo y anúdalo a una pareja.", inclinacion: 0 },
  { id: "cuarteto", nombre: "Cuarteto", globos: 4, armado: "Toma dos parejas y entrelázalas en cruz.", inclinacion: 0.12 },
  { id: "quinteto", nombre: "Quinteto", globos: 5, armado: "Toma una pareja y un trío y entrelázalos.", inclinacion: 0.06 },
  { id: "sexteto", nombre: "Sexteto", globos: 6, armado: "Toma dos tríos y entrelázalos.", inclinacion: 0.16 },
];

export type Vec3 = { x: number; y: number; z: number };

/** Un globo colocado: dónde queda su nudo y hacia dónde apunta (nudo → cuerpo), en cm. */
export type GloboColocado = { indice: number; nudo: Vec3; direccion: Vec3 };

/** Un punto donde se puede colgar una decoración hija (una flor, un moño): por ahora el centro y los huecos. */
export type Ancla = { tipo: "centro" | "hueco"; posicion: Vec3; normal: Vec3 };

export type ModuloArmado = { globos: GloboColocado[]; anclas: Ancla[]; anchoCm: number; altoCm: number };

const normalizar = (v: Vec3): Vec3 => {
  const n = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / n, y: v.y / n, z: v.z / n };
};

export function moduloPorId(id: string): Modulo | undefined {
  return MODULOS.find((m) => m.id === id);
}

/**
 * Coloca los globos del módulo. `diametroCm` es el inflado; el tipo de globo (redondo o Link-O-Loon) decide
 * cuánto cuello hay entre el nudo y el cuerpo.
 */
export function armarModulo(modulo: Modulo, formato: FormatoGlobo, diametroCm: number): ModuloArmado {
  const n = modulo.globos;
  const natural = centroCuerpo(formato.tipo === "link" ? "link" : "redondo", diametroCm);
  // Distancia mínima entre centros vecinos para que los cuerpos no se monten (un poco menos que el diámetro:
  // el látex se aplasta donde se tocan).
  const contacto = n >= 2 ? (diametroCm * 0.97) / (2 * Math.sin(Math.PI / n)) : 0;
  const distancia = Math.max(natural, contacto);
  const globos: GloboColocado[] = [];
  for (let i = 0; i < n; i++) {
    const angulo = (2 * Math.PI * i) / n + (n === 2 ? 0 : Math.PI / n);
    const inclinacion = modulo.inclinacion * (i % 2 === 0 ? 1 : -1);
    const direccion = normalizar({ x: Math.cos(angulo), y: inclinacion, z: Math.sin(angulo) });
    const separar = distancia - natural; // si hubo que alejar el cuerpo, el nudo se corre por el cuello
    globos.push({ indice: i, nudo: { x: direccion.x * separar, y: direccion.y * separar, z: direccion.z * separar }, direccion });
  }
  const anclas: Ancla[] = [{ tipo: "centro", posicion: { x: 0, y: diametroCm * 0.35, z: 0 }, normal: { x: 0, y: 1, z: 0 } }];
  if (n >= 3) {
    for (let i = 0; i < n; i++) {
      const medio = (2 * Math.PI * (i + 0.5)) / n + Math.PI / n;
      const r = distancia * Math.cos(Math.PI / n) + diametroCm * 0.15;
      anclas.push({ tipo: "hueco", posicion: { x: Math.cos(medio) * r, y: 0, z: Math.sin(medio) * r }, normal: normalizar({ x: Math.cos(medio), y: 0, z: Math.sin(medio) }) });
    }
  }
  const alcance = distancia + diametroCm / 2;
  return { globos, anclas, anchoCm: Math.round(alcance * 2), altoCm: Math.round(diametroCm * (1 + modulo.inclinacion * 2)) };
}

/** Lista de materiales del módulo: cuántos globos de cada color (por código Sempertex), en orden de aparición. */
export function materialesModulo(colores: readonly string[]): Array<{ codigo: string; cantidad: number }> {
  const cuenta = new Map<string, number>();
  for (const codigo of colores) cuenta.set(codigo, (cuenta.get(codigo) ?? 0) + 1);
  return [...cuenta.entries()].map(([codigo, cantidad]) => ({ codigo, cantidad }));
}
