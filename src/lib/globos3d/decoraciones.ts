import { formatoPorId } from "./formatos";
import { centroCuerpo, nudoCm } from "./geometria";
import type { Vec3 } from "./modulos";

/**
 * Decoraciones hijas (por ahora, flores de globos), definidas solo por propiedades y colgadas de anclas.
 *
 * - **Qué es**: `PropiedadesFlor` describe la flor (pétalos: cuántos, de qué globo, inflado, color, apertura y
 *   giro; centro: si lleva, de qué globo, inflado, color y si es uno o un trío). `armarFlor` la arma en su propio
 *   espacio, mirando hacia +Y, con los nudos amarrados al centro como un módulo real.
 * - **Dónde va**: una estructura expone `Ancla`s (posición + normal hacia fuera). `colocarEn` lleva la flor a un
 *   ancla girándola para que mire hacia la normal. Las reglas (cada N niveles, en 1/2/4 caras) eligen las anclas.
 * Las flores predefinidas son solo valores iniciales: todo se puede cambiar por propiedades.
 * Unidades: cm.
 */
export type ParteGlobo = { formatoId: string; infladoCm: number; codigo: string };

export type PropiedadesFlor = {
  petalos: ParteGlobo & {
    cantidad: number;
    /** 0° = pétalos planos; 60° = flor en copa. */
    aperturaGrados: number;
    /** Giro de la flor sobre su eje. */
    giroGrados: number;
  };
  centro: (ParteGlobo & { cantidad: 1 | 3 }) | null;
};

export type GloboDecoracion = { formatoId: string; infladoCm: number; codigo: string; nudo: Vec3; direccion: Vec3; cuelloExtraCm: number };

export type FlorArmada = { globos: GloboDecoracion[]; diametroCm: number; altoCm: number };

export type Ancla = { posicion: Vec3; normal: Vec3 };

export const FLORES_PREDEFINIDAS: ReadonlyArray<{ id: string; nombre: string; descripcion: string; propiedades: PropiedadesFlor }> = [
  {
    id: "flor5", nombre: "Flor de 5 pétalos", descripcion: "Cinco R-5 en quinteto con un centro dorado: la flor clásica de las paredes de cuartetos.",
    propiedades: { petalos: { formatoId: "R-5", infladoCm: 12, codigo: "012", cantidad: 5, aperturaGrados: 15, giroGrados: 0 }, centro: { formatoId: "R-5", infladoCm: 8, codigo: "570", cantidad: 1 } },
  },
  {
    id: "flor4", nombre: "Flor de 4 pétalos", descripcion: "Cuatro R-5 en cruz con centro: más pequeña y geométrica.",
    propiedades: { petalos: { formatoId: "R-5", infladoCm: 11, codigo: "012", cantidad: 4, aperturaGrados: 10, giroGrados: 45 }, centro: { formatoId: "R-5", infladoCm: 7, codigo: "570", cantidad: 1 } },
  },
  {
    id: "flor_grande", nombre: "Flor grande de quinteto", descripcion: "Quinteto de R-9 con un trío de R-5 al centro.",
    propiedades: { petalos: { formatoId: "R-9", infladoCm: 18, codigo: "009", cantidad: 5, aperturaGrados: 20, giroGrados: 0 }, centro: { formatoId: "R-5", infladoCm: 9, codigo: "012", cantidad: 3 } },
  },
  {
    id: "margarita", nombre: "Margarita", descripcion: "Seis pétalos blancos abiertos con centro amarillo.",
    propiedades: { petalos: { formatoId: "R-5", infladoCm: 12, codigo: "005", cantidad: 6, aperturaGrados: 5, giroGrados: 0 }, centro: { formatoId: "R-5", infladoCm: 10, codigo: "020", cantidad: 1 } },
  },
];

const rad = (g: number) => (g * Math.PI) / 180;
const normalizar = (v: Vec3): Vec3 => { const n = Math.hypot(v.x, v.y, v.z) || 1; return { x: v.x / n, y: v.y / n, z: v.z / n }; };
const tipoCuerpo = (formatoId: string) => (formatoPorId(formatoId)?.tipo === "link" ? "link" : "redondo");

/** Anillo de `n` globos alrededor de +Y, inclinados `apertura`, que se tocan aplastándose un poco (como un módulo). */
function anillo(parte: ParteGlobo, n: number, aperturaGrados: number, giroGrados: number): GloboDecoracion[] {
  const d = parte.infladoCm;
  const natural = centroCuerpo(tipoCuerpo(parte.formatoId), d);
  const amarre = nudoCm(d);
  const direcciones: Vec3[] = [];
  for (let i = 0; i < n; i++) {
    const a = rad(giroGrados) + (2 * Math.PI * i) / n;
    direcciones.push(normalizar({ x: Math.cos(a) * Math.cos(rad(aperturaGrados)), y: Math.sin(rad(aperturaGrados)), z: Math.sin(a) * Math.cos(rad(aperturaGrados)) }));
  }
  let minima = Infinity;
  for (let i = 0; i < n && n >= 2; i++) {
    const p = direcciones[i]!, q = direcciones[(i + 1) % n]!;
    minima = Math.min(minima, Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z));
  }
  const distancia = Math.max(natural + amarre, Number.isFinite(minima) ? (d * 0.88) / minima : 0);
  return direcciones.map((direccion) => ({
    formatoId: parte.formatoId, infladoCm: d, codigo: parte.codigo,
    nudo: { x: direccion.x * amarre, y: direccion.y * amarre, z: direccion.z * amarre },
    direccion, cuelloExtraCm: Math.max(0, distancia - natural - amarre),
  }));
}

export function armarFlor(propiedades: PropiedadesFlor): FlorArmada {
  const { petalos, centro } = propiedades;
  const cantidad = Math.max(3, Math.min(8, Math.round(petalos.cantidad)));
  const globos = anillo(petalos, cantidad, petalos.aperturaGrados, petalos.giroGrados);
  if (centro) {
    if (centro.cantidad === 3) globos.push(...anillo(centro, 3, 55, petalos.giroGrados + 60));
    else globos.push({ formatoId: centro.formatoId, infladoCm: centro.infladoCm, codigo: centro.codigo, nudo: { x: 0, y: 0, z: 0 }, direccion: { x: 0, y: 1, z: 0 }, cuelloExtraCm: 0 });
  }
  const dP = petalos.infladoCm;
  const alcance = centroCuerpo(tipoCuerpo(petalos.formatoId), dP) + (globos[0]?.cuelloExtraCm ?? 0) + dP / 2;
  return { globos, diametroCm: Math.round(2 * alcance * Math.cos(rad(petalos.aperturaGrados))), altoCm: Math.round(centro ? centro.infladoCm * 1.3 : dP) };
}

/** Lleva una decoración armada (mirando a +Y) a un ancla: la gira para que mire a la normal y la traslada. */
export function colocarEn(globos: readonly GloboDecoracion[], ancla: Ancla): GloboDecoracion[] {
  const n = normalizar(ancla.normal);
  // Base ortonormal con Y local = normal.
  const auxiliar: Vec3 = Math.abs(n.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  const xLocal = normalizar({ x: auxiliar.y * n.z - auxiliar.z * n.y, y: auxiliar.z * n.x - auxiliar.x * n.z, z: auxiliar.x * n.y - auxiliar.y * n.x });
  const zLocal = { x: n.y * xLocal.z - n.z * xLocal.y, y: n.z * xLocal.x - n.x * xLocal.z, z: n.x * xLocal.y - n.y * xLocal.x };
  const mundo = (v: Vec3): Vec3 => ({ x: v.x * xLocal.x + v.y * n.x + v.z * zLocal.x, y: v.x * xLocal.y + v.y * n.y + v.z * zLocal.y, z: v.x * xLocal.z + v.y * n.z + v.z * zLocal.z });
  return globos.map((g) => {
    const p = mundo(g.nudo);
    return { ...g, nudo: { x: p.x + ancla.posicion.x, y: p.y + ancla.posicion.y, z: p.z + ancla.posicion.z }, direccion: mundo(g.direccion) };
  });
}

/** Regla de colocación sobre una trenza (columna o arco): cada cuántos cuartetos y en cuántas caras. */
export type ReglaDecoracion = { cadaNiveles: number; caras: 1 | 2 | 4 };

/** Elige anclas de trenza según la regla. Las anclas vienen con su nivel y su hueco (0-3). */
export function elegirAnclas<T extends { nivel: number; hueco: number }>(anclas: readonly T[], regla: ReglaDecoracion): T[] {
  const cada = Math.max(1, Math.round(regla.cadaNiveles));
  const huecos = regla.caras === 4 ? [0, 1, 2, 3] : regla.caras === 2 ? [0, 2] : [0];
  return anclas.filter((a) => a.nivel % cada === 0 && huecos.includes(a.hueco));
}

/** Materiales de un conjunto de globos, agrupados por formato y color, en orden de aparición. */
export function materialesPorFormato(globos: ReadonlyArray<{ formatoId: string; codigo: string }>): Array<{ formatoId: string; codigo: string; cantidad: number }> {
  const cuenta = new Map<string, { formatoId: string; codigo: string; cantidad: number }>();
  for (const g of globos) {
    const clave = `${g.formatoId}|${g.codigo}`;
    const actual = cuenta.get(clave);
    if (actual) actual.cantidad += 1;
    else cuenta.set(clave, { formatoId: g.formatoId, codigo: g.codigo, cantidad: 1 });
  }
  return [...cuenta.values()];
}
